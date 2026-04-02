import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/app/api/_shared/adminAuth";
import {
  buildBotDeliveryOutboxPayload,
  ensureBotDeliveryOutbox,
  isBotDeliveryOutboxReady
} from "@/app/api/_shared/botDeliveryOutbox";
import {
  DirectOrderFulfillmentError,
  fulfillBotDirectOrder
} from "@/app/api/_shared/directOrderFulfillment";
import { sendPaymentRelayNotification } from "@/app/api/_shared/paymentRelay";

const rawExpireMinutes = Number(process.env.DIRECT_ORDER_PENDING_EXPIRE_MINUTES || "10");
const DIRECT_ORDER_PENDING_EXPIRE_MINUTES = Number.isFinite(rawExpireMinutes)
  ? Math.max(1, rawExpireMinutes)
  : 10;

const buildDisplayName = (user?: {
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
} | null) => {
  const firstName = String(user?.first_name || "").trim();
  const lastName = String(user?.last_name || "").trim();
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
  if (fullName) {
    return fullName;
  }
  const username = String(user?.username || "").trim().replace(/^@+/, "");
  return username ? `@${username}` : "-";
};

export async function POST(request: NextRequest) {
  let body: { orderId?: number | string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const orderId = body.orderId ? Number(body.orderId) : null;
  if (!orderId) {
    return NextResponse.json({ error: "orderId is required." }, { status: 400 });
  }

  const adminSession = await requireAdminSession(request);
  if (adminSession.ok === false) {
    return adminSession.response;
  }

  const outboxReady = await isBotDeliveryOutboxReady(adminSession.supabase);
  if (!outboxReady) {
    return NextResponse.json(
      {
        error:
          "Bot delivery outbox chưa sẵn sàng. Hãy apply file supabase_schema_bot_delivery_outbox.sql rồi thử duyệt lại để tránh lỗi giao hàng một phần."
      },
      { status: 503 }
    );
  }

  const orderGroup = `MANUAL${Date.now()}`;
  let fulfillment;
  try {
    fulfillment = await fulfillBotDirectOrder(
      adminSession.supabase,
      orderId,
      DIRECT_ORDER_PENDING_EXPIRE_MINUTES,
      orderGroup
    );
  } catch (error) {
    if (error instanceof DirectOrderFulfillmentError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Failed to fulfill order." }, { status: 500 });
  }

  const productName = fulfillment.product_name;
  const bonusQuantity = Number(fulfillment.bonus_quantity || 0);
  const items = fulfillment.items;
  const totalPrice = Number(fulfillment.amount || 0);
  const { data: userProfile } = await adminSession.supabase
    .from("users")
    .select("first_name, last_name, username")
    .eq("user_id", fulfillment.user_id)
    .maybeSingle();
  const displayName = buildDisplayName(userProfile);
  const relayLines = [
    "✅ Thanh toán thành công (Duyệt tay Bot)",
    `Mã đơn hệ thống: ${fulfillment.direct_order_id}`,
    `Mã người dùng: ${fulfillment.user_id}`,
    `Tên người dùng: ${displayName}`,
    `Mã thanh toán: ${fulfillment.code}`,
    "",
    `Số tiền nhận: ${totalPrice.toLocaleString("vi-VN")}đ`,
    `Số tiền kỳ vọng: ${totalPrice.toLocaleString("vi-VN")}đ`,
    "",
    `Sản phẩm: ${productName}`,
    `SL thanh toán: ${fulfillment.quantity}`,
    `SL giao: ${items.length}`,
    `SL khuyến mãi: ${bonusQuantity}`
  ];

  const outboxPayload = buildBotDeliveryOutboxPayload(fulfillment, totalPrice);
  const outbox = await ensureBotDeliveryOutbox(
    adminSession.supabase,
    fulfillment.direct_order_id,
    fulfillment.user_id,
    outboxPayload,
    true
  );
  if (!outbox) {
    return NextResponse.json(
      {
        error:
          "Không thể tạo delivery outbox cho đơn này. Hãy kiểm tra migration bot_delivery_outbox rồi thử lại."
      },
      { status: 503 }
    );
  }

  await sendPaymentRelayNotification(adminSession.supabase, relayLines);

  return NextResponse.json({
    success: true,
    delivery: {
      status: "queued",
      outboxId: outbox.id
    }
  });
}
