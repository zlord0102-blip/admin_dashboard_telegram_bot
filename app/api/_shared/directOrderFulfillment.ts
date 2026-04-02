import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildMissingRequiredRpcMessage,
  canUseUnsafeMutationFallback
} from "@/app/api/_shared/mutationFallback";

type RpcLikeResult = Record<string, unknown> | null;

export type BotDirectFulfillmentResult = {
  direct_order_id: number;
  order_id: number | null;
  user_id: number;
  product_id: number;
  product_name: string;
  description: string;
  format_data: string;
  quantity: number;
  bonus_quantity: number;
  delivered_quantity: number;
  unit_price: number;
  amount: number;
  code: string;
  order_group: string;
  items: string[];
};

export type WebsiteDirectFulfillmentResult = {
  website_direct_order_id: number;
  direct_order_id: number;
  website_order_id: number | null;
  auth_user_id: string;
  user_email: string;
  product_id: number;
  product_name: string;
  quantity: number;
  bonus_quantity: number;
  delivered_quantity: number;
  unit_price: number;
  amount: number;
  code: string;
  order_group: string;
  items: string[];
};

export class DirectOrderFulfillmentError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "DirectOrderFulfillmentError";
    this.code = code;
    this.status = status;
  }
}

const buildMissingRequiredRpcError = (rpcName: string) =>
  new DirectOrderFulfillmentError(
    "missing_required_rpc",
    buildMissingRequiredRpcMessage(rpcName),
    503
  );

const normalizeRpcData = (data: unknown): RpcLikeResult => {
  if (Array.isArray(data)) {
    return (data[0] as RpcLikeResult | undefined) ?? null;
  }
  return (data as RpcLikeResult) ?? null;
};

const toNumber = (value: unknown, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const toStringList = (value: unknown) => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? ""));
  }
  return [];
};

const isMissingRpcError = (message: string) => {
  const lowered = message.toLowerCase();
  return (
    lowered.includes("could not find the function") ||
    lowered.includes("schema cache") ||
    lowered.includes("pgrst202")
  );
};

const buildFulfillmentError = (code: string, expireMinutes: number) => {
  switch (code) {
    case "forbidden":
      return new DirectOrderFulfillmentError(code, "Forbidden.", 403);
    case "direct_order_not_found":
    case "website_direct_order_not_found":
    case "mirror_direct_order_not_found":
      return new DirectOrderFulfillmentError(code, "Order not found.", 404);
    case "direct_order_not_pending":
    case "website_direct_order_not_pending":
    case "mirror_direct_order_not_pending":
      return new DirectOrderFulfillmentError(code, "Order already processed.", 409);
    case "direct_order_expired":
    case "website_direct_order_expired":
      return new DirectOrderFulfillmentError(
        code,
        `Order expired after ${expireMinutes} minutes.`,
        409
      );
    case "not_enough_stock":
      return new DirectOrderFulfillmentError(code, "Not enough stock.", 409);
    default:
      return new DirectOrderFulfillmentError(code, code || "Failed to fulfill order.", 500);
  }
};

const mapRpcError = (message: string, expireMinutes: number) => {
  const lowered = message.toLowerCase();
  if (lowered.includes("forbidden")) {
    return buildFulfillmentError("forbidden", expireMinutes);
  }
  if (lowered.includes("direct_order_not_found")) {
    return buildFulfillmentError("direct_order_not_found", expireMinutes);
  }
  if (lowered.includes("website_direct_order_not_found")) {
    return buildFulfillmentError("website_direct_order_not_found", expireMinutes);
  }
  if (lowered.includes("mirror_direct_order_not_found")) {
    return buildFulfillmentError("mirror_direct_order_not_found", expireMinutes);
  }
  if (lowered.includes("website_direct_order_not_pending")) {
    return buildFulfillmentError("website_direct_order_not_pending", expireMinutes);
  }
  if (lowered.includes("mirror_direct_order_not_pending")) {
    return buildFulfillmentError("mirror_direct_order_not_pending", expireMinutes);
  }
  if (lowered.includes("direct_order_not_pending")) {
    return buildFulfillmentError("direct_order_not_pending", expireMinutes);
  }
  if (lowered.includes("website_direct_order_expired")) {
    return buildFulfillmentError("website_direct_order_expired", expireMinutes);
  }
  if (lowered.includes("direct_order_expired")) {
    return buildFulfillmentError("direct_order_expired", expireMinutes);
  }
  if (lowered.includes("not_enough_stock")) {
    return buildFulfillmentError("not_enough_stock", expireMinutes);
  }
  return new DirectOrderFulfillmentError("fulfillment_failed", message || "Failed to fulfill order.", 500);
};

const normalizeBotResult = (data: RpcLikeResult): BotDirectFulfillmentResult => ({
  direct_order_id: toNumber(data?.direct_order_id),
  order_id: data?.order_id == null ? null : toNumber(data.order_id),
  user_id: toNumber(data?.user_id),
  product_id: toNumber(data?.product_id),
  product_name: String(data?.product_name || `#${toNumber(data?.product_id)}`),
  description: String(data?.description || ""),
  format_data: String(data?.format_data || ""),
  quantity: toNumber(data?.quantity, 1),
  bonus_quantity: toNumber(data?.bonus_quantity, 0),
  delivered_quantity: toNumber(data?.delivered_quantity, 1),
  unit_price: toNumber(data?.unit_price, 0),
  amount: toNumber(data?.amount, 0),
  code: String(data?.code || ""),
  order_group: String(data?.order_group || ""),
  items: toStringList(data?.items)
});

const normalizeWebsiteResult = (data: RpcLikeResult): WebsiteDirectFulfillmentResult => ({
  website_direct_order_id: toNumber(data?.website_direct_order_id),
  direct_order_id: toNumber(data?.direct_order_id),
  website_order_id: data?.website_order_id == null ? null : toNumber(data.website_order_id),
  auth_user_id: String(data?.auth_user_id || ""),
  user_email: String(data?.user_email || ""),
  product_id: toNumber(data?.product_id),
  product_name: String(data?.product_name || `#${toNumber(data?.product_id)}`),
  quantity: toNumber(data?.quantity, 1),
  bonus_quantity: toNumber(data?.bonus_quantity, 0),
  delivered_quantity: toNumber(data?.delivered_quantity, 1),
  unit_price: toNumber(data?.unit_price, 0),
  amount: toNumber(data?.amount, 0),
  code: String(data?.code || ""),
  order_group: String(data?.order_group || ""),
  items: toStringList(data?.items)
});

const isDirectOrderExpired = (createdAt: string | null | undefined, expireMinutes: number) => {
  if (!createdAt) return false;
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return false;
  return Date.now() - created.getTime() >= Math.max(1, expireMinutes) * 60 * 1000;
};

async function fulfillBotDirectOrderFallback(
  supabase: SupabaseClient,
  orderId: number,
  expireMinutes: number,
  orderGroup?: string
) {
  const { data: directOrder, error: directOrderError } = await supabase
    .from("direct_orders")
    .select("id, user_id, product_id, quantity, bonus_quantity, unit_price, amount, code, status, created_at")
    .eq("id", orderId)
    .maybeSingle();

  if (directOrderError || !directOrder) {
    throw buildFulfillmentError("direct_order_not_found", expireMinutes);
  }
  if (directOrder.status !== "pending") {
    throw buildFulfillmentError("direct_order_not_pending", expireMinutes);
  }

  if (isDirectOrderExpired(directOrder.created_at, expireMinutes)) {
    await supabase.from("direct_orders").update({ status: "cancelled" }).eq("id", directOrder.id);
    throw buildFulfillmentError("direct_order_expired", expireMinutes);
  }

  const { data: product } = await supabase
    .from("products")
    .select("id, name, description, format_data")
    .eq("id", directOrder.product_id)
    .maybeSingle();

  const bonusQuantity = Math.max(0, toNumber(directOrder.bonus_quantity, 0));
  const deliverQuantity = Math.max(1, toNumber(directOrder.quantity, 1) + bonusQuantity);

  const { data: stockRows, error: stockError } = await supabase
    .from("stock")
    .select("id, content")
    .eq("product_id", directOrder.product_id)
    .eq("sold", false)
    .order("id", { ascending: true })
    .limit(deliverQuantity);

  if (stockError || !stockRows || stockRows.length < deliverQuantity) {
    await supabase.from("direct_orders").update({ status: "failed" }).eq("id", directOrder.id);
    throw buildFulfillmentError("not_enough_stock", expireMinutes);
  }

  const stockIds = stockRows.map((row) => row.id);
  const items = stockRows.map((row) => row.content);

  const { error: updateStockError } = await supabase
    .from("stock")
    .update({ sold: true })
    .in("id", stockIds);

  if (updateStockError) {
    throw new DirectOrderFulfillmentError("update_stock_failed", "Failed to update stock.", 500);
  }

  const nextOrderGroup =
    (orderGroup || "").trim() ||
    `MANUAL${directOrder.user_id}${new Date().toISOString().replace(/[-:.TZ]/g, "")}`;
  const totalPrice =
    toNumber(directOrder.amount, 0) ||
    toNumber(directOrder.unit_price, 0) * Math.max(1, toNumber(directOrder.quantity, 1));

  const { data: insertedOrderRows, error: createOrderError } = await supabase
    .from("orders")
    .insert({
      user_id: directOrder.user_id,
      product_id: directOrder.product_id,
      content: JSON.stringify(items),
      price: totalPrice,
      quantity: items.length,
      order_group: nextOrderGroup,
      created_at: new Date().toISOString()
    })
    .select("id")
    .limit(1);

  if (createOrderError) {
    throw new DirectOrderFulfillmentError("create_order_failed", "Failed to create order.", 500);
  }

  const { error: updateDirectOrderError } = await supabase
    .from("direct_orders")
    .update({ status: "confirmed" })
    .eq("id", directOrder.id);

  if (updateDirectOrderError) {
    throw new DirectOrderFulfillmentError("update_direct_order_failed", "Failed to update direct order.", 500);
  }

  return normalizeBotResult({
    direct_order_id: directOrder.id,
    order_id: insertedOrderRows?.[0]?.id ?? null,
    user_id: directOrder.user_id,
    product_id: directOrder.product_id,
    product_name: String(product?.name || `#${directOrder.product_id}`).trim(),
    description: String(product?.description || ""),
    format_data: String(product?.format_data || ""),
    quantity: directOrder.quantity,
    bonus_quantity: bonusQuantity,
    delivered_quantity: items.length,
    unit_price: toNumber(directOrder.unit_price, 0),
    amount: totalPrice,
    code: String(directOrder.code || ""),
    order_group: nextOrderGroup,
    items
  });
}

async function fulfillWebsiteDirectOrderFallback(
  supabase: SupabaseClient,
  orderId: number,
  expireMinutes: number,
  orderGroup?: string
) {
  const { data: directOrder, error: directOrderError } = await supabase
    .from("website_direct_orders")
    .select("id, auth_user_id, user_email, product_id, quantity, bonus_quantity, unit_price, amount, code, status, created_at")
    .eq("id", orderId)
    .maybeSingle();

  if (directOrderError || !directOrder) {
    throw buildFulfillmentError("website_direct_order_not_found", expireMinutes);
  }
  if (directOrder.status !== "pending") {
    throw buildFulfillmentError("website_direct_order_not_pending", expireMinutes);
  }

  const { data: mirrorOrder } = await supabase
    .from("direct_orders")
    .select("id, status")
    .eq("code", directOrder.code)
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!mirrorOrder) {
    throw buildFulfillmentError("mirror_direct_order_not_found", expireMinutes);
  }
  if (mirrorOrder.status !== "pending") {
    throw buildFulfillmentError("mirror_direct_order_not_pending", expireMinutes);
  }

  if (isDirectOrderExpired(directOrder.created_at, expireMinutes)) {
    await supabase
      .from("website_direct_orders")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", directOrder.id);
    await supabase.from("direct_orders").update({ status: "cancelled" }).eq("id", mirrorOrder.id);
    throw buildFulfillmentError("website_direct_order_expired", expireMinutes);
  }

  const { data: product } = await supabase
    .from("products")
    .select("id, name, website_name")
    .eq("id", directOrder.product_id)
    .maybeSingle();

  const bonusQuantity = Math.max(0, toNumber(directOrder.bonus_quantity, 0));
  const deliverQuantity = Math.max(1, toNumber(directOrder.quantity, 1) + bonusQuantity);

  const { data: stockRows, error: stockError } = await supabase
    .from("stock")
    .select("id, content")
    .eq("product_id", directOrder.product_id)
    .eq("sold", false)
    .order("id", { ascending: true })
    .limit(deliverQuantity);

  if (stockError || !stockRows || stockRows.length < deliverQuantity) {
    await supabase
      .from("website_direct_orders")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("id", directOrder.id);
    await supabase.from("direct_orders").update({ status: "failed" }).eq("id", mirrorOrder.id);
    throw buildFulfillmentError("not_enough_stock", expireMinutes);
  }

  const stockIds = stockRows.map((row) => row.id);
  const items = stockRows.map((row) => row.content);

  const { error: updateStockError } = await supabase
    .from("stock")
    .update({ sold: true })
    .in("id", stockIds);

  if (updateStockError) {
    throw new DirectOrderFulfillmentError("update_stock_failed", "Failed to update stock.", 500);
  }

  const nextOrderGroup =
    (orderGroup || "").trim() ||
    `WEB${new Date().toISOString().replace(/[-:.TZ]/g, "")}`;
  const totalPrice =
    toNumber(directOrder.amount, 0) ||
    toNumber(directOrder.unit_price, 0) * Math.max(1, toNumber(directOrder.quantity, 1));

  const websiteOrderPayload = {
    auth_user_id: directOrder.auth_user_id || null,
    user_email: directOrder.user_email || null,
    product_id: directOrder.product_id,
    content: JSON.stringify(items),
    price: totalPrice,
    quantity: items.length,
    order_group: nextOrderGroup,
    source_direct_code: directOrder.code,
    created_at: new Date().toISOString()
  };

  const { data: insertedOrderRows, error: createOrderError } = await supabase
    .from("website_orders")
    .insert(websiteOrderPayload)
    .select("id")
    .limit(1);

  if (createOrderError) {
    throw new DirectOrderFulfillmentError("create_website_order_failed", "Failed to create website order.", 500);
  }

  const fulfilledOrderId = insertedOrderRows?.[0]?.id ?? null;
  const confirmedAt = new Date().toISOString();

  const { error: updateWebsiteOrderError } = await supabase
    .from("website_direct_orders")
    .update({
      status: "confirmed",
      confirmed_at: confirmedAt,
      updated_at: confirmedAt,
      fulfilled_order_id: fulfilledOrderId
    })
    .eq("id", directOrder.id);

  if (updateWebsiteOrderError) {
    throw new DirectOrderFulfillmentError(
      "update_website_direct_order_failed",
      "Failed to update website direct order.",
      500
    );
  }

  const { error: updateMirrorError } = await supabase
    .from("direct_orders")
    .update({ status: "confirmed" })
    .eq("id", mirrorOrder.id);

  if (updateMirrorError) {
    throw new DirectOrderFulfillmentError(
      "update_direct_order_failed",
      "Failed to update direct order.",
      500
    );
  }

  return normalizeWebsiteResult({
    website_direct_order_id: directOrder.id,
    direct_order_id: mirrorOrder.id,
    website_order_id: fulfilledOrderId,
    auth_user_id: String(directOrder.auth_user_id || ""),
    user_email: String(directOrder.user_email || ""),
    product_id: directOrder.product_id,
    product_name: String(product?.website_name || product?.name || `#${directOrder.product_id}`).trim(),
    quantity: directOrder.quantity,
    bonus_quantity: bonusQuantity,
    delivered_quantity: items.length,
    unit_price: toNumber(directOrder.unit_price, 0),
    amount: totalPrice,
    code: String(directOrder.code || ""),
    order_group: nextOrderGroup,
    items
  });
}

export async function fulfillBotDirectOrder(
  supabase: SupabaseClient,
  orderId: number,
  expireMinutes: number,
  orderGroup?: string
) {
  const { data, error } = await supabase.rpc("fulfill_bot_direct_order", {
    p_direct_order_id: orderId,
    p_order_group: orderGroup?.trim() || null,
    p_expire_minutes: expireMinutes
  });

  if (error) {
    if (!isMissingRpcError(error.message || "")) {
      throw mapRpcError(error.message || "", expireMinutes);
    }
    if (!canUseUnsafeMutationFallback()) {
      throw buildMissingRequiredRpcError("fulfill_bot_direct_order");
    }
    return fulfillBotDirectOrderFallback(supabase, orderId, expireMinutes, orderGroup);
  }

  return normalizeBotResult(normalizeRpcData(data));
}

export async function fulfillWebsiteDirectOrder(
  supabase: SupabaseClient,
  orderId: number,
  expireMinutes: number,
  orderGroup?: string
) {
  const { data, error } = await supabase.rpc("fulfill_website_direct_order", {
    p_website_direct_order_id: orderId,
    p_order_group: orderGroup?.trim() || null,
    p_expire_minutes: expireMinutes
  });

  if (error) {
    if (!isMissingRpcError(error.message || "")) {
      throw mapRpcError(error.message || "", expireMinutes);
    }
    if (!canUseUnsafeMutationFallback()) {
      throw buildMissingRequiredRpcError("fulfill_website_direct_order");
    }
    return fulfillWebsiteDirectOrderFallback(supabase, orderId, expireMinutes, orderGroup);
  }

  return normalizeWebsiteResult(normalizeRpcData(data));
}
