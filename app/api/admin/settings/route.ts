import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/app/api/_shared/adminAuth";
import { getSupabaseAdminClient } from "@/app/api/_shared/supabaseAdmin";
import { recordAdminAuditEvent } from "@/app/api/_shared/adminAudit";

const SETTINGS_KEYS = [
  "bank_name",
  "account_number",
  "account_name",
  "sepay_token",
  "binance_api_key",
  "binance_api_secret",
  "binance_pay_id",
  "binance_pay_merchant_enabled",
  "binance_pay_merchant_api_key",
  "binance_pay_merchant_api_secret",
  "binance_pay_merchant_base_url",
  "binance_pay_webhook_url",
  "binance_direct_address",
  "binance_direct_address_tag",
  "binance_direct_enabled",
  "binance_direct_coin",
  "binance_direct_network",
  "binance_direct_rate",
  "admin_contact",
  "support_contacts",
  "shop_intro_text",
  "support_panel_text",
  "payment_notify_bot_token",
  "payment_notify_user_id",
  "shop_page_size",
  "payment_mode",
  "show_shop",
  "show_balance",
  "show_deposit",
  "show_withdraw",
  "show_history",
  "show_language",
  "show_support"
] as const;

const SECRET_SETTING_KEYS = new Set<string>([
  "sepay_token",
  "binance_api_key",
  "binance_api_secret",
  "binance_pay_merchant_api_key",
  "binance_pay_merchant_api_secret",
  "payment_notify_bot_token"
]);

const SETTINGS_KEY_SET = new Set<string>(SETTINGS_KEYS);
const TOGGLE_KEYS = new Set<string>([
  "show_shop",
  "show_balance",
  "show_deposit",
  "show_withdraw",
  "show_history",
  "show_language",
  "show_support",
  "binance_pay_merchant_enabled"
]);

const normalizeSettingValue = (key: string, value: unknown) => {
  if (TOGGLE_KEYS.has(key)) {
    return value === "false" ? "false" : "true";
  }

  if (key === "shop_page_size") {
    const parsed = Number.parseInt(String(value || "10"), 10);
    const normalized = Number.isFinite(parsed) ? Math.min(50, Math.max(1, parsed)) : 10;
    return String(normalized);
  }

  return typeof value === "string" ? value : String(value ?? "");
};

export async function GET(request: NextRequest) {
  const adminSession = await requireAdminSession(request);
  if (adminSession.ok === false) {
    return adminSession.response;
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("settings")
    .select("key, value")
    .in("key", SETTINGS_KEYS);

  if (error) {
    return NextResponse.json({ error: error.message || "Không thể tải settings." }, { status: 500 });
  }

  const values: Record<string, string> = {};
  const secretPresent: Record<string, boolean> = {};

  for (const row of data || []) {
    const key = String(row.key || "");
    if (!SETTINGS_KEY_SET.has(key)) continue;

    const value = typeof row.value === "string" ? row.value : String(row.value ?? "");
    if (SECRET_SETTING_KEYS.has(key)) {
      values[key] = "";
      secretPresent[key] = value.trim().length > 0;
    } else {
      values[key] = value;
    }
  }

  return NextResponse.json({
    success: true,
    data: {
      values,
      secretPresent
    }
  });
}

export async function POST(request: NextRequest) {
  const adminSession = await requireAdminSession(request);
  if (adminSession.ok === false) {
    return adminSession.response;
  }

  const body = await request.json().catch(() => null);
  const settings =
    body && typeof body === "object" && !Array.isArray(body) && typeof (body as any).settings === "object"
      ? ((body as any).settings as Record<string, unknown>)
      : null;

  if (!settings) {
    return NextResponse.json({ error: "Payload settings không hợp lệ." }, { status: 400 });
  }

  const payload: Array<{ key: string; value: string }> = [];
  for (const key of SETTINGS_KEYS) {
    const rawValue = settings[key];
    if (SECRET_SETTING_KEYS.has(key) && (rawValue === undefined || String(rawValue).trim() === "")) {
      continue;
    }
    payload.push({ key, value: normalizeSettingValue(key, rawValue) });
  }

  if (payload.length) {
    const supabase = getSupabaseAdminClient();
    const { error } = await supabase.from("settings").upsert(payload);
    if (error) {
      return NextResponse.json({ error: error.message || "Không thể lưu settings." }, { status: 500 });
    }
    await recordAdminAuditEvent(supabase, {
      adminUserId: adminSession.userId,
      adminEmail: adminSession.email,
      action: "settings.update",
      entityType: "settings",
      metadata: {
        keys: payload.map((item) => item.key)
      }
    });
  }

  return NextResponse.json({ success: true, data: { updated: payload.length } });
}
