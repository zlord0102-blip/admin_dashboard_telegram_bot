import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/app/api/_shared/adminAuth";
import { getSupabaseAdminClient } from "@/app/api/_shared/supabaseAdmin";
import { recordAdminAuditEvent } from "@/app/api/_shared/adminAudit";
import { getOrSetServerCache, invalidateServerCacheByPrefix } from "@/app/api/_shared/serverCache";
import { withAdminApiTiming } from "@/app/api/_shared/serverTiming";

const DEFAULT_SALE_CUSTOM_EMOJI_ID = "6055192572056309981";
const SALES_ADMIN_CACHE_PREFIX = "admin-sales:";
const SALES_ADMIN_CACHE_TTL_MS = 10_000;

type AdminSupabaseClient = ReturnType<typeof getSupabaseAdminClient>;

type SalesSnapshot = {
  campaigns: unknown[];
  items: unknown[];
  products: unknown[];
};

const emptySalesSnapshot = (): SalesSnapshot => ({
  campaigns: [],
  items: [],
  products: []
});

const normalizeSalesSnapshot = (value: unknown): SalesSnapshot => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return emptySalesSnapshot();
  }

  const snapshot = value as Partial<SalesSnapshot>;
  return {
    campaigns: Array.isArray(snapshot.campaigns) ? snapshot.campaigns : [],
    items: Array.isArray(snapshot.items) ? snapshot.items : [],
    products: Array.isArray(snapshot.products) ? snapshot.products : []
  };
};

const isMissingRpcError = (error: { code?: string; message?: string } | null | undefined) => {
  const message = String(error?.message || "").toLowerCase();
  return (
    error?.code === "PGRST202" ||
    message.includes("could not find the function") ||
    message.includes("schema cache") ||
    message.includes("function public.admin_bot_sales_snapshot_v1")
  );
};

const toPositiveInt = (value: unknown, fallback: number | null = null) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const toOptionalPositiveInt = (value: unknown) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const toNonNegativeInt = (value: unknown, fallback = 0) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

const cleanText = (value: unknown, fallback = "") =>
  String(value ?? fallback).replace(/\s+/g, " ").trim();

const cleanMultilineStock = (value: unknown) => {
  const raw = String(value ?? "");
  return Array.from(
    new Set(raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))
  );
};

const safeDate = (value: unknown) => {
  const parsed = new Date(String(value ?? ""));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : "";
};

const buildCampaignPayload = (body: any, { allowPaused = false } = {}) => {
  const name = cleanText(body?.name);
  const startsAt = safeDate(body?.startsAt);
  const endsAt = safeDate(body?.endsAt);
  if (!name) return { error: "Tên campaign không được trống." };
  if (!startsAt || !endsAt || new Date(endsAt) <= new Date(startsAt)) {
    return { error: "Thời gian Sale không hợp lệ." };
  }
  const allowedStatuses = allowPaused
    ? ["draft", "scheduled", "active", "paused", "ended", "cancelled"]
    : ["draft", "scheduled", "active"];
  const status = allowedStatuses.includes(String(body?.status)) ? String(body.status) : "scheduled";
  return {
    payload: {
      name,
      status,
      starts_at: startsAt,
      ends_at: endsAt,
      timezone: cleanText(body?.timezone, "Asia/Ho_Chi_Minh") || "Asia/Ho_Chi_Minh",
      default_telegram_icon: cleanText(body?.telegramIcon, "SALE") || "SALE",
      default_telegram_icon_custom_emoji_id:
        cleanText(body?.telegramIconCustomEmojiId, DEFAULT_SALE_CUSTOM_EMOJI_ID) || DEFAULT_SALE_CUSTOM_EMOJI_ID,
      total_quantity_limit: toOptionalPositiveInt(body?.totalQuantityLimit),
      per_user_limit: toOptionalPositiveInt(body?.perUserLimit),
      notify_on_start: Boolean(body?.notifyOnStart),
      notify_ending_soon: Boolean(body?.notifyEndingSoon),
      notes: cleanText(body?.notes)
    }
  };
};

const buildSaleItemUpdatePayload = async (
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  body: any,
  saleItemId: number
) => {
  const salePriceVnd = toNonNegativeInt(body?.salePriceVnd, -1);
  const salePriceUsdt = body?.salePriceUsdt === "" || body?.salePriceUsdt == null ? null : Number(body.salePriceUsdt);
  if (salePriceVnd < 0) return { error: "Giá Sale không hợp lệ." };
  if (salePriceUsdt !== null && !Number.isFinite(salePriceUsdt)) {
    return { error: "Giá Sale USDT không hợp lệ." };
  }

  const { data: saleItem, error: saleItemError } = await supabase
    .from("sale_items")
    .select("id,product_id,products(id,price,price_usdt)")
    .eq("id", saleItemId)
    .maybeSingle();
  if (saleItemError) throw saleItemError;
  if (!saleItem) return { error: "Món Sale không tồn tại." };

  const product = Array.isArray((saleItem as any).products)
    ? (saleItem as any).products[0]
    : (saleItem as any).products;
  const originalPrice = Number(product?.price ?? 0);
  const discountPercent =
    originalPrice > 0 ? Math.max(0, Math.round((1 - salePriceVnd / originalPrice) * 10000) / 100) : null;

  return {
    payload: {
      sale_name: cleanText(body?.saleName),
      sale_description: cleanText(body?.saleDescription),
      sale_price_vnd: salePriceVnd,
      sale_price_usdt: salePriceUsdt,
      discount_percent: discountPercent,
      promo_buy_quantity: toNonNegativeInt(body?.promoBuyQuantity),
      promo_bonus_quantity: toNonNegativeInt(body?.promoBonusQuantity),
      quantity_limit: toOptionalPositiveInt(body?.quantityLimit),
      per_user_limit: toOptionalPositiveInt(body?.perUserLimit),
      telegram_icon: cleanText(body?.telegramIcon, "SALE") || "SALE",
      telegram_icon_custom_emoji_id:
        cleanText(body?.telegramIconCustomEmojiId, DEFAULT_SALE_CUSTOM_EMOJI_ID) || DEFAULT_SALE_CUSTOM_EMOJI_ID,
      sort_position: toOptionalPositiveInt(body?.sortPosition)
    },
    productId: Number((saleItem as any).product_id)
  };
};

async function fetchProducts(supabase: AdminSupabaseClient) {
  const rpc = await supabase.rpc("get_products_with_stock");
  if (!rpc.error && Array.isArray(rpc.data)) {
    return rpc.data;
  }

  const { data, error } = await supabase
    .from("products")
    .select("id,name,price,price_usdt,telegram_icon,telegram_icon_custom_emoji_id,is_hidden,is_deleted")
    .order("id");
  if (error) throw error;
  return data ?? [];
}

async function getCampaign(supabase: AdminSupabaseClient, campaignId: number) {
  const { data, error } = await supabase
    .from("sale_campaigns")
    .select("*")
    .eq("id", campaignId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function assertNoProductTimeConflict(
  supabase: AdminSupabaseClient,
  productId: number,
  startsAt: string,
  endsAt: string,
  exceptCampaignId?: number
) {
  const { data: items, error: itemError } = await supabase
    .from("sale_items")
    .select("id,campaign_id")
    .eq("product_id", productId)
    .eq("is_enabled", true);
  if (itemError) throw itemError;
  const campaignIds = Array.from(new Set((items ?? []).map((item) => item.campaign_id).filter(Boolean)));
  if (!campaignIds.length) return;

  let query = supabase
    .from("sale_campaigns")
    .select("id,name,status,starts_at,ends_at")
    .in("id", campaignIds)
    .in("status", ["scheduled", "active"])
    .lt("starts_at", endsAt)
    .gt("ends_at", startsAt);
  if (exceptCampaignId) query = query.neq("id", exceptCampaignId);
  const { data: conflicts, error } = await query;
  if (error) throw error;
  if (conflicts?.length) {
    throw new Error(`Sản phẩm đã nằm trong Sale chồng thời gian: ${conflicts[0].name || `#${conflicts[0].id}`}.`);
  }
}

async function reserveExistingStock(
  supabase: AdminSupabaseClient,
  productId: number,
  saleItemId: number,
  quantity: number
) {
  const fetchLimit = Math.min(Math.max(quantity * 3, quantity + 50), 5000);
  const { data: stockRows, error: stockError } = await supabase
    .from("stock")
    .select("id")
    .eq("product_id", productId)
    .eq("sold", false)
    .order("id")
    .limit(fetchLimit);
  if (stockError) throw stockError;

  const stockIds = (stockRows ?? []).map((row) => Number(row.id)).filter((id) => Number.isFinite(id) && id > 0);
  if (!stockIds.length) throw new Error("Sản phẩm không còn stock chưa bán.");

  const { data: reservedRows, error: reservedError } = await supabase
    .from("sale_stock_reservations")
    .select("stock_id")
    .in("stock_id", stockIds)
    .is("released_at", null)
    .in("status", ["available", "held", "sold"]);
  if (reservedError) throw reservedError;

  const reservedIds = new Set((reservedRows ?? []).map((row) => Number(row.stock_id)));
  const availableIds = stockIds.filter((id) => !reservedIds.has(id)).slice(0, quantity);
  if (availableIds.length < quantity) {
    throw new Error(`Không đủ stock trống để đưa vào Sale. Cần ${quantity}, hiện chọn được ${availableIds.length}.`);
  }

  const { error } = await supabase.from("sale_stock_reservations").insert(
    availableIds.map((stockId) => ({
      sale_item_id: saleItemId,
      stock_id: stockId,
      status: "available"
    }))
  );
  if (error) throw error;
  return availableIds.length;
}

async function loadSalesSnapshot(supabase: AdminSupabaseClient): Promise<SalesSnapshot> {
  const [campaignsResult, itemsResult, products] = await Promise.all([
    supabase.from("sale_campaigns").select("*").order("starts_at", { ascending: false }),
    supabase
      .from("sale_items")
      .select("*,products(id,name,price,price_usdt,telegram_icon,telegram_icon_custom_emoji_id)")
      .order("created_at", { ascending: false }),
    fetchProducts(supabase)
  ]);

  if (campaignsResult.error) throw campaignsResult.error;
  if (itemsResult.error) throw itemsResult.error;

  const itemIds = Array.from(
    new Set(
      (itemsResult.data ?? [])
        .map((item) => Number(item.id))
        .filter((itemId) => Number.isFinite(itemId) && itemId > 0)
    )
  );

  let reservationRows: Array<{
    sale_item_id: number | string | null;
    status: string | null;
    held_until: string | null;
    released_at: string | null;
  }> = [];

  if (itemIds.length) {
    const { data: reservationData, error } = await supabase
      .from("sale_stock_reservations")
      .select("sale_item_id,status,held_until,released_at")
      .in("sale_item_id", itemIds);

    if (error) throw error;
    reservationRows = (reservationData ?? []) as typeof reservationRows;
  }

  const reservationStats = new Map<number, { available: number; held: number; sold: number; released: number }>();
  const now = Date.now();
  for (const row of reservationRows) {
    const saleItemId = Number(row.sale_item_id);
    if (!Number.isFinite(saleItemId)) continue;
    const stats = reservationStats.get(saleItemId) ?? { available: 0, held: 0, sold: 0, released: 0 };
    const status = String(row.status || "");
    if (status === "held" && row.held_until && new Date(row.held_until).getTime() <= now) {
      stats.available += 1;
    } else if (status === "available") {
      stats.available += 1;
    } else if (status === "held") {
      stats.held += 1;
    } else if (status === "sold") {
      stats.sold += 1;
    } else {
      stats.released += 1;
    }
    reservationStats.set(saleItemId, stats);
  }

  const items = (itemsResult.data ?? []).map((item) => ({
    ...item,
    reservation_stats: reservationStats.get(Number(item.id)) ?? { available: 0, held: 0, sold: 0, released: 0 }
  }));

  return {
    campaigns: campaignsResult.data ?? [],
    items,
    products
  };
}

async function getSalesSnapshot(supabase: AdminSupabaseClient): Promise<SalesSnapshot> {
  const rpcResult = await supabase.rpc("admin_bot_sales_snapshot_v1");
  if (!rpcResult.error) {
    return normalizeSalesSnapshot(rpcResult.data);
  }

  if (!isMissingRpcError(rpcResult.error)) {
    throw new Error(rpcResult.error.message || "Không thể tải Sale.");
  }

  return loadSalesSnapshot(supabase);
}

const invalidateSalesAdminCache = () => invalidateServerCacheByPrefix(SALES_ADMIN_CACHE_PREFIX);

async function handleGET(request: NextRequest) {
  const adminSession = await requireAdminSession(request);
  if (adminSession.ok === false) return adminSession.response;

  const supabase = getSupabaseAdminClient();
  try {
    const { value: data, hit } = await getOrSetServerCache(
      `${SALES_ADMIN_CACHE_PREFIX}snapshot:v2`,
      SALES_ADMIN_CACHE_TTL_MS,
      () => getSalesSnapshot(supabase)
    );
    const response = NextResponse.json({ success: true, data });
    response.headers.set("X-Admin-Api-Cache", hit ? "hit" : "miss");
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Không thể tải Sale." },
      { status: 500 }
    );
  }
}

async function handlePOST(request: NextRequest) {
  const adminSession = await requireAdminSession(request);
  if (adminSession.ok === false) return adminSession.response;

  const body = await request.json().catch(() => null);
  const action = typeof body?.action === "string" ? body.action : "";
  const supabase = getSupabaseAdminClient();

  try {
    if (action === "create_campaign") {
      const parsed = buildCampaignPayload(body);
      if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });
      const payload = parsed.payload!;
      const { data, error } = await supabase.from("sale_campaigns").insert(payload).select("*").single();
      if (error) throw error;
      await recordAdminAuditEvent(supabase, {
        adminUserId: adminSession.userId,
        adminEmail: adminSession.email,
        action: "sale_campaign.create",
        entityType: "sale_campaign",
        entityId: data.id,
        metadata: { status: payload.status }
      });
      invalidateSalesAdminCache();
      return NextResponse.json({ success: true, data });
    }

    if (action === "update_campaign") {
      const campaignId = toPositiveInt(body?.campaignId);
      if (!campaignId) return NextResponse.json({ error: "campaignId không hợp lệ." }, { status: 400 });
      const parsed = buildCampaignPayload(body, { allowPaused: true });
      if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });
      const payload = parsed.payload!;

      const { data: itemRows, error: itemError } = await supabase
        .from("sale_items")
        .select("product_id")
        .eq("campaign_id", campaignId)
        .eq("is_enabled", true);
      if (itemError) throw itemError;
      const productIds = Array.from(new Set((itemRows ?? []).map((item) => Number(item.product_id)).filter(Boolean)));
      for (const productId of productIds) {
        await assertNoProductTimeConflict(supabase, productId, payload.starts_at, payload.ends_at, campaignId);
      }

      const { data, error } = await supabase
        .from("sale_campaigns")
        .update(payload)
        .eq("id", campaignId)
        .select("*")
        .single();
      if (error) throw error;
      await recordAdminAuditEvent(supabase, {
        adminUserId: adminSession.userId,
        adminEmail: adminSession.email,
        action: "sale_campaign.update",
        entityType: "sale_campaign",
        entityId: campaignId,
        metadata: { status: payload.status }
      });
      invalidateSalesAdminCache();
      return NextResponse.json({ success: true, data });
    }

    if (action === "set_campaign_status") {
      const campaignId = toPositiveInt(body?.campaignId);
      const status = cleanText(body?.status).toLowerCase();
      if (!campaignId) return NextResponse.json({ error: "campaignId không hợp lệ." }, { status: 400 });
      if (!["draft", "scheduled", "active", "paused", "ended", "cancelled"].includes(status)) {
        return NextResponse.json({ error: "Trạng thái không hợp lệ." }, { status: 400 });
      }
      const { error } = await supabase.from("sale_campaigns").update({ status }).eq("id", campaignId);
      if (error) throw error;
      await recordAdminAuditEvent(supabase, {
        adminUserId: adminSession.userId,
        adminEmail: adminSession.email,
        action: "sale_campaign.set_status",
        entityType: "sale_campaign",
        entityId: campaignId,
        metadata: { status }
      });
      invalidateSalesAdminCache();
      return NextResponse.json({ success: true, data: { campaignId, status } });
    }

    if (action === "delete_campaign") {
      const campaignId = toPositiveInt(body?.campaignId);
      if (!campaignId) return NextResponse.json({ error: "campaignId không hợp lệ." }, { status: 400 });

      const campaign = await getCampaign(supabase, campaignId);
      if (!campaign) return NextResponse.json({ error: "Campaign không tồn tại." }, { status: 404 });

      const { data: itemRows, error: itemError } = await supabase
        .from("sale_items")
        .select("id")
        .eq("campaign_id", campaignId);
      if (itemError) throw itemError;

      const { error } = await supabase.from("sale_campaigns").delete().eq("id", campaignId);
      if (error) throw error;

      await recordAdminAuditEvent(supabase, {
        adminUserId: adminSession.userId,
        adminEmail: adminSession.email,
        action: "sale_campaign.delete",
        entityType: "sale_campaign",
        entityId: campaignId,
        metadata: {
          name: campaign.name,
          status: campaign.status,
          itemCount: itemRows?.length ?? 0
        }
      });
      invalidateSalesAdminCache();
      return NextResponse.json({ success: true, data: { campaignId } });
    }

    if (action === "add_item_existing_stock" || action === "add_item_new_stock") {
      const campaignId = toPositiveInt(body?.campaignId);
      const productId = toPositiveInt(body?.productId);
      const salePriceVnd = toNonNegativeInt(body?.salePriceVnd, -1);
      const salePriceUsdt = body?.salePriceUsdt === "" || body?.salePriceUsdt == null ? null : Number(body.salePriceUsdt);
      const stockQuantity = toPositiveInt(body?.stockQuantity, null);
      if (!campaignId || !productId) return NextResponse.json({ error: "Campaign hoặc sản phẩm không hợp lệ." }, { status: 400 });
      if (salePriceVnd < 0) return NextResponse.json({ error: "Giá Sale không hợp lệ." }, { status: 400 });

      const campaign = await getCampaign(supabase, campaignId);
      if (!campaign) return NextResponse.json({ error: "Campaign không tồn tại." }, { status: 404 });
      await assertNoProductTimeConflict(supabase, productId, campaign.starts_at, campaign.ends_at, campaignId);

      const { data: product, error: productError } = await supabase
        .from("products")
        .select("id,name,price,price_usdt,description,format_data")
        .eq("id", productId)
        .maybeSingle();
      if (productError) throw productError;
      if (!product) return NextResponse.json({ error: "Sản phẩm không tồn tại." }, { status: 404 });

      const newStockContents = action === "add_item_new_stock" ? cleanMultilineStock(body?.newStockText) : [];
      const reservationCount = action === "add_item_new_stock" ? newStockContents.length : Number(stockQuantity || 0);
      if (reservationCount <= 0) return NextResponse.json({ error: "Số lượng stock Sale phải lớn hơn 0." }, { status: 400 });
      if (reservationCount > 5000) return NextResponse.json({ error: "Tối đa 5.000 stock mỗi lần." }, { status: 400 });

      const discountPercent =
        Number(product.price || 0) > 0
          ? Math.max(0, Math.round((1 - salePriceVnd / Number(product.price || 1)) * 10000) / 100)
          : null;

      const { data: saleItem, error: itemError } = await supabase
        .from("sale_items")
        .insert({
          campaign_id: campaignId,
          product_id: productId,
          sale_name: cleanText(body?.saleName),
          sale_description: cleanText(body?.saleDescription),
          sale_price_vnd: salePriceVnd,
          sale_price_usdt: Number.isFinite(salePriceUsdt as number) ? salePriceUsdt : null,
          original_price_vnd: product.price ?? null,
          original_price_usdt: product.price_usdt ?? null,
          discount_percent: discountPercent,
          promo_buy_quantity: toNonNegativeInt(body?.promoBuyQuantity),
          promo_bonus_quantity: toNonNegativeInt(body?.promoBonusQuantity),
          stock_mode: action === "add_item_new_stock" ? "new_stock" : "reserved_existing",
          quantity_limit: toOptionalPositiveInt(body?.quantityLimit) ?? reservationCount,
          per_user_limit: toOptionalPositiveInt(body?.perUserLimit),
          telegram_icon: cleanText(body?.telegramIcon, "SALE") || "SALE",
          telegram_icon_custom_emoji_id: cleanText(body?.telegramIconCustomEmojiId, DEFAULT_SALE_CUSTOM_EMOJI_ID) || DEFAULT_SALE_CUSTOM_EMOJI_ID,
          sort_position: toOptionalPositiveInt(body?.sortPosition)
        })
        .select("*")
        .single();
      if (itemError) throw itemError;

      try {
        let reserved = 0;
        if (action === "add_item_new_stock") {
          const { data: insertedStock, error: stockInsertError } = await supabase
            .from("stock")
            .insert(newStockContents.map((content) => ({ product_id: productId, content })))
            .select("id");
          if (stockInsertError) throw stockInsertError;
          const stockIds = (insertedStock ?? []).map((row) => Number(row.id)).filter((id) => Number.isFinite(id) && id > 0);
          const { error: reserveError } = await supabase.from("sale_stock_reservations").insert(
            stockIds.map((stockId) => ({ sale_item_id: saleItem.id, stock_id: stockId, status: "available" }))
          );
          if (reserveError) throw reserveError;
          reserved = stockIds.length;
        } else {
          reserved = await reserveExistingStock(supabase, productId, saleItem.id, reservationCount);
        }

        await recordAdminAuditEvent(supabase, {
          adminUserId: adminSession.userId,
          adminEmail: adminSession.email,
          action: action === "add_item_new_stock" ? "sale_item.add_new_stock" : "sale_item.reserve_existing_stock",
          entityType: "sale_item",
          entityId: saleItem.id,
          metadata: { campaignId, productId, reserved }
        });
        invalidateSalesAdminCache();
        return NextResponse.json({ success: true, data: { saleItem, reserved } });
      } catch (error) {
        await supabase.from("sale_items").delete().eq("id", saleItem.id);
        throw error;
      }
    }

    if (action === "set_item_enabled") {
      const saleItemId = toPositiveInt(body?.saleItemId);
      if (!saleItemId) return NextResponse.json({ error: "saleItemId không hợp lệ." }, { status: 400 });
      const enabled = Boolean(body?.enabled);
      const { error } = await supabase.from("sale_items").update({ is_enabled: enabled }).eq("id", saleItemId);
      if (error) throw error;
      await recordAdminAuditEvent(supabase, {
        adminUserId: adminSession.userId,
        adminEmail: adminSession.email,
        action: enabled ? "sale_item.enable" : "sale_item.disable",
        entityType: "sale_item",
        entityId: saleItemId
      });
      invalidateSalesAdminCache();
      return NextResponse.json({ success: true, data: { saleItemId, enabled } });
    }

    if (action === "update_item") {
      const saleItemId = toPositiveInt(body?.saleItemId);
      if (!saleItemId) return NextResponse.json({ error: "saleItemId không hợp lệ." }, { status: 400 });
      const parsed = await buildSaleItemUpdatePayload(supabase, body, saleItemId);
      if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });

      const { data, error } = await supabase
        .from("sale_items")
        .update(parsed.payload!)
        .eq("id", saleItemId)
        .select("*")
        .single();
      if (error) throw error;
      await recordAdminAuditEvent(supabase, {
        adminUserId: adminSession.userId,
        adminEmail: adminSession.email,
        action: "sale_item.update",
        entityType: "sale_item",
        entityId: saleItemId,
        metadata: { productId: parsed.productId }
      });
      invalidateSalesAdminCache();
      return NextResponse.json({ success: true, data });
    }

    if (action === "delete_item") {
      const saleItemId = toPositiveInt(body?.saleItemId);
      if (!saleItemId) return NextResponse.json({ error: "saleItemId không hợp lệ." }, { status: 400 });

      const { data: item, error: itemError } = await supabase
        .from("sale_items")
        .select("id,campaign_id,product_id,sale_name,is_enabled")
        .eq("id", saleItemId)
        .maybeSingle();
      if (itemError) throw itemError;
      if (!item) return NextResponse.json({ error: "Món Sale không tồn tại." }, { status: 404 });

      const { data: reservationRows, error: reservationError } = await supabase
        .from("sale_stock_reservations")
        .select("status")
        .eq("sale_item_id", saleItemId);
      if (reservationError) throw reservationError;

      const reservationStats = (reservationRows ?? []).reduce<Record<string, number>>((acc, row) => {
        const status = String(row.status || "unknown");
        acc[status] = (acc[status] || 0) + 1;
        return acc;
      }, {});

      const { error } = await supabase.from("sale_items").delete().eq("id", saleItemId);
      if (error) throw error;

      await recordAdminAuditEvent(supabase, {
        adminUserId: adminSession.userId,
        adminEmail: adminSession.email,
        action: "sale_item.delete",
        entityType: "sale_item",
        entityId: saleItemId,
        metadata: {
          campaignId: item.campaign_id,
          productId: item.product_id,
          saleName: item.sale_name,
          isEnabled: item.is_enabled,
          reservationStats
        }
      });
      invalidateSalesAdminCache();
      return NextResponse.json({ success: true, data: { saleItemId } });
    }

    return NextResponse.json({ error: "Action không được hỗ trợ." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Không thể cập nhật Sale." },
      { status: 500 }
    );
  }
}

export const GET = withAdminApiTiming("GET /api/admin/sales", handleGET);
export const POST = withAdminApiTiming("POST /api/admin/sales", handlePOST);
