import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/app/api/_shared/adminAuth";
import { getSupabaseAdminClient } from "@/app/api/_shared/supabaseAdmin";
import { buildBinancePayWebhookAlerts } from "@/lib/binancePayWebhookAlerts";

const SETTING_KEYS = [
  "bank_name",
  "account_number",
  "account_name",
  "sepay_token",
  "binance_api_key",
  "binance_api_secret",
  "binance_pay_merchant_enabled",
  "binance_pay_merchant_api_key",
  "binance_pay_merchant_api_secret",
  "binance_pay_webhook_url",
  "payment_notify_bot_token",
  "payment_notify_user_id"
];
const CHECKER_HEALTH_SETTING_KEY = "bot_checker_health";

const parseJsonObject = (value: unknown) => {
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};

const normalizeBinancePayWebhookMetrics = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

async function loadCheckerHealthState() {
  const supabase = getSupabaseAdminClient();
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", CHECKER_HEALTH_SETTING_KEY)
    .maybeSingle();
  return parseJsonObject(data?.value);
}

const attachCheckerHealth = (snapshot: unknown, checkerHealth: Record<string, unknown>) => ({
  ...(snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) ? snapshot : {}),
  checkerHealth,
  binancePayWebhook: normalizeBinancePayWebhookMetrics(checkerHealth.binancePayWebhook),
  binancePayWebhookAlerts: buildBinancePayWebhookAlerts(
    normalizeBinancePayWebhookMetrics(checkerHealth.binancePayWebhook)
  )
});

const countRows = async (table: string, filter?: (query: any) => any) => {
  const supabase = getSupabaseAdminClient();
  let query = supabase.from(table).select("id", { count: "exact", head: true });
  if (filter) query = filter(query);
  const { count, error } = await query;
  if (error) {
    return { available: false, count: 0, error: error.message };
  }
  return { available: true, count: count || 0, error: null };
};

const isMissingRpcError = (message: string) => {
  const lowered = message.toLowerCase();
  return lowered.includes("could not find the function") || lowered.includes("schema cache") || lowered.includes("pgrst202");
};

async function buildFallbackSnapshot(threshold: number) {
  const supabase = getSupabaseAdminClient();

  const [
    pendingDeposits,
    pendingWithdrawals,
    pendingUsdtWithdrawals,
    pendingDirectOrders,
    pendingExpiredOrders
  ] = await Promise.all([
    countRows("deposits", (q) => q.eq("status", "pending")),
    countRows("withdrawals", (q) => q.eq("status", "pending")),
    countRows("usdt_withdrawals", (q) => q.eq("status", "pending")),
    countRows("direct_orders", (q) => q.eq("status", "pending")),
    countRows("direct_orders", (q) =>
      q.eq("status", "pending").lt("created_at", new Date(Date.now() - 10 * 60 * 1000).toISOString())
    )
  ]);

  const { data: settingsData } = await supabase.from("settings").select("key, value").in("key", SETTING_KEYS);
  const checkerHealth = await loadCheckerHealthState();
  const settings = Object.fromEntries(
    SETTING_KEYS.map((key) => [
      key,
      Boolean(
        (settingsData || []).find((row) => row.key === key && String(row.value || "").trim())
      )
    ])
  );

  let deliveryOutbox = {
    available: false,
    pending: 0,
    sending: 0,
    sent: 0,
    failed: 0,
    retryDue: 0
  };
  try {
    const { data, error } = await supabase.from("bot_delivery_outbox").select("status, next_retry_at").limit(1000);
    if (error) throw error;
    const now = Date.now();
    deliveryOutbox = {
      available: true,
      pending: (data || []).filter((row) => row.status === "pending").length,
      sending: (data || []).filter((row) => row.status === "sending").length,
      sent: (data || []).filter((row) => row.status === "sent").length,
      failed: (data || []).filter((row) => row.status === "failed").length,
      retryDue: (data || []).filter((row) => row.status === "pending" && Date.parse(row.next_retry_at || "") <= now).length
    };
  } catch {
    // Missing outbox table is handled as unavailable.
  }

  let stock = { threshold, count: 0, items: [] as Array<{ id: number; name: string; availableStock: number }> };
  try {
    const { data: products } = await supabase
      .from("products")
      .select("id, name, is_hidden, is_deleted")
      .eq("is_hidden", false)
      .eq("is_deleted", false)
      .limit(500);
    if (!products) throw new Error("products unavailable");
    const productIds = (products || []).map((product) => product.id);
    const stockResponse = productIds.length
      ? await supabase.from("stock").select("product_id").eq("sold", false).in("product_id", productIds)
      : { data: [] as Array<{ product_id: number }> };
    if ("error" in stockResponse && stockResponse.error) throw stockResponse.error;
    const stockRows = stockResponse.data;
    const counts = new Map<number, number>();
    for (const row of stockRows || []) {
      counts.set(Number(row.product_id), (counts.get(Number(row.product_id)) || 0) + 1);
    }
    const lowItems = (products || [])
      .map((product) => ({
        id: Number(product.id),
        name: String(product.name || `#${product.id}`),
        availableStock: counts.get(Number(product.id)) || 0
      }))
      .filter((product) => product.availableStock <= threshold)
      .sort((left, right) => left.availableStock - right.availableStock || left.id - right.id);
    stock = { threshold, count: lowItems.length, items: lowItems.slice(0, 12) };
  } catch {
    // Keep empty low-stock snapshot.
  }

  const binancePayWebhook = normalizeBinancePayWebhookMetrics(checkerHealth.binancePayWebhook);

  return {
    checkedAt: new Date().toISOString(),
    schema: {
      tables: {
        products: true,
        stock: true,
        orders: true,
        direct_orders: true,
        settings: true,
        bot_product_folders: true,
        bot_delivery_outbox: deliveryOutbox.available,
        telegram_broadcast_jobs: true,
        admin_audit_logs: false
      },
      productColumns: {},
      rpcs: {
        admin_ops_health_snapshot: false
      }
    },
    settings,
    checkerHealth,
    binancePayWebhook,
    binancePayWebhookAlerts: buildBinancePayWebhookAlerts(binancePayWebhook),
    queues: {
      pendingDeposits: pendingDeposits.count,
      pendingWithdrawals: pendingWithdrawals.count,
      pendingUsdtWithdrawals: pendingUsdtWithdrawals.count,
      pendingDirectOrders: pendingDirectOrders.count,
      pendingDirectOrdersExpired: pendingExpiredOrders.count,
      deliveryOutbox
    },
    stock
  };
}

export async function GET(request: NextRequest) {
  const adminSession = await requireAdminSession(request);
  if (adminSession.ok === false) {
    return adminSession.response;
  }

  const url = new URL(request.url);
  const threshold = Math.max(0, Math.min(Number.parseInt(url.searchParams.get("lowStock") || "5", 10) || 5, 500));
  const supabase = getSupabaseAdminClient();

  try {
    const { data, error } = await supabase.rpc("admin_ops_health_snapshot", {
      p_low_stock_threshold: threshold
    });
    if (error) {
      if (!isMissingRpcError(error.message || "")) {
        throw error;
      }
      return NextResponse.json({ success: true, data: await buildFallbackSnapshot(threshold), fallback: true });
    }
    const checkerHealth = await loadCheckerHealthState();
    return NextResponse.json({ success: true, data: attachCheckerHealth(data, checkerHealth) });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Không thể tải health snapshot."
      },
      { status: 500 }
    );
  }
}
