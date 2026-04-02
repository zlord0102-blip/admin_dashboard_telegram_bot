import type { SupabaseClient } from "@supabase/supabase-js";
import type { BotDirectFulfillmentResult } from "@/app/api/_shared/directOrderFulfillment";

export type BotDeliveryOutboxPayload = {
  directOrderId: number;
  orderId: number | null;
  userId: number;
  productId: number;
  productName: string;
  description: string;
  formatData: string;
  quantity: number;
  bonusQuantity: number;
  deliveredQuantity: number;
  amount: number;
  code: string;
  orderGroup: string;
  items: string[];
};

export type BotDeliveryOutboxRow = {
  id: number;
  direct_order_id: number;
  user_id: number;
  channel: string;
  payload: BotDeliveryOutboxPayload;
  status: string;
  attempt_count: number;
  next_retry_at: string | null;
  last_error: string | null;
  sent_at: string | null;
  last_attempt_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

const nowIso = () => new Date().toISOString();

const toNumber = (value: unknown, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const isMissingOutboxRelationError = (message: string) => {
  const lowered = message.toLowerCase();
  return (
    (lowered.includes("relation") && lowered.includes("bot_delivery_outbox")) ||
    lowered.includes("could not find the table") ||
    lowered.includes("does not exist") ||
    lowered.includes("schema cache") ||
    lowered.includes("pgrst205")
  );
};

const normalizePayload = (value: unknown): BotDeliveryOutboxPayload => {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const items = Array.isArray(row.items) ? row.items.map((item) => String(item ?? "")) : [];
  return {
    directOrderId: toNumber(row.directOrderId),
    orderId: row.orderId == null ? null : toNumber(row.orderId),
    userId: toNumber(row.userId),
    productId: toNumber(row.productId),
    productName: String(row.productName || `#${toNumber(row.productId)}`),
    description: String(row.description || ""),
    formatData: String(row.formatData || ""),
    quantity: toNumber(row.quantity, Math.max(1, items.length || 1)),
    bonusQuantity: toNumber(row.bonusQuantity),
    deliveredQuantity: toNumber(row.deliveredQuantity, Math.max(1, items.length || 1)),
    amount: toNumber(row.amount),
    code: String(row.code || ""),
    orderGroup: String(row.orderGroup || ""),
    items
  };
};

const normalizeOutboxRow = (value: unknown): BotDeliveryOutboxRow | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Record<string, unknown>;
  return {
    id: toNumber(row.id),
    direct_order_id: toNumber(row.direct_order_id),
    user_id: toNumber(row.user_id),
    channel: String(row.channel || "telegram_bot"),
    payload: normalizePayload(row.payload),
    status: String(row.status || "pending"),
    attempt_count: toNumber(row.attempt_count),
    next_retry_at: row.next_retry_at == null ? null : String(row.next_retry_at),
    last_error: row.last_error == null ? null : String(row.last_error),
    sent_at: row.sent_at == null ? null : String(row.sent_at),
    last_attempt_at: row.last_attempt_at == null ? null : String(row.last_attempt_at),
    created_at: row.created_at == null ? null : String(row.created_at),
    updated_at: row.updated_at == null ? null : String(row.updated_at)
  };
};

export const buildBotDeliveryOutboxPayload = (
  fulfillment: BotDirectFulfillmentResult,
  fallbackAmount: number
): BotDeliveryOutboxPayload => {
  const items = (fulfillment.items || []).map((item) => String(item ?? ""));
  return {
    directOrderId: toNumber(fulfillment.direct_order_id),
    orderId: fulfillment.order_id == null ? null : toNumber(fulfillment.order_id),
    userId: toNumber(fulfillment.user_id),
    productId: toNumber(fulfillment.product_id),
    productName: String(fulfillment.product_name || `#${toNumber(fulfillment.product_id)}`),
    description: String(fulfillment.description || ""),
    formatData: String(fulfillment.format_data || ""),
    quantity: toNumber(fulfillment.quantity, Math.max(1, items.length || 1)),
    bonusQuantity: toNumber(fulfillment.bonus_quantity),
    deliveredQuantity: toNumber(fulfillment.delivered_quantity, Math.max(1, items.length || 1)),
    amount: toNumber(fulfillment.amount, fallbackAmount),
    code: String(fulfillment.code || ""),
    orderGroup: String(fulfillment.order_group || ""),
    items
  };
};

export const isBotDeliveryOutboxReady = async (supabase: SupabaseClient) => {
  const { error } = await supabase.from("bot_delivery_outbox").select("id").limit(1);
  if (!error) {
    return true;
  }
  if (isMissingOutboxRelationError(error.message || "")) {
    return false;
  }
  throw new Error(error.message || "Không thể kiểm tra bot_delivery_outbox.");
};

const getBotDeliveryOutbox = async (
  supabase: SupabaseClient,
  directOrderId: number
): Promise<BotDeliveryOutboxRow | null> => {
  const { data, error } = await supabase
    .from("bot_delivery_outbox")
    .select("*")
    .eq("direct_order_id", directOrderId)
    .maybeSingle();

  if (error) {
    if (isMissingOutboxRelationError(error.message || "")) {
      return null;
    }
    throw new Error(error.message || "Không thể tải bot_delivery_outbox.");
  }

  return normalizeOutboxRow(data);
};

export const ensureBotDeliveryOutbox = async (
  supabase: SupabaseClient,
  directOrderId: number,
  userId: number,
  payload: BotDeliveryOutboxPayload,
  resetStatus = false
): Promise<BotDeliveryOutboxRow | null> => {
  const existing = await getBotDeliveryOutbox(supabase, directOrderId);
  const timestamp = nowIso();

  if (existing) {
    const updatePayload: Record<string, unknown> = {
      user_id: userId,
      payload,
      channel: "telegram_bot"
    };
    if (resetStatus) {
      Object.assign(updatePayload, {
        status: "pending",
        attempt_count: 0,
        next_retry_at: timestamp,
        last_error: null,
        sent_at: null,
        last_attempt_at: null
      });
    }
    const { error } = await supabase
      .from("bot_delivery_outbox")
      .update(updatePayload)
      .eq("id", existing.id);
    if (error) {
      if (isMissingOutboxRelationError(error.message || "")) {
        return null;
      }
      throw new Error(error.message || "Không thể cập nhật bot_delivery_outbox.");
    }
    return getBotDeliveryOutbox(supabase, directOrderId);
  }

  const insertPayload = {
    direct_order_id: directOrderId,
    user_id: userId,
    channel: "telegram_bot",
    payload,
    status: "pending",
    attempt_count: 0,
    next_retry_at: timestamp
  };
  const { error } = await supabase.from("bot_delivery_outbox").insert(insertPayload);
  if (error) {
    if (isMissingOutboxRelationError(error.message || "")) {
      return null;
    }
    if ((error.message || "").toLowerCase().includes("duplicate key")) {
      return getBotDeliveryOutbox(supabase, directOrderId);
    }
    throw new Error(error.message || "Không thể tạo bot_delivery_outbox.");
  }
  return getBotDeliveryOutbox(supabase, directOrderId);
};
