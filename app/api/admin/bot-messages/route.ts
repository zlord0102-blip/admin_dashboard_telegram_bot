import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/app/api/_shared/adminAuth";
import { recordAdminAuditEvent } from "@/app/api/_shared/adminAudit";
import { getSupabaseAdminClient } from "@/app/api/_shared/supabaseAdmin";
import { withAdminApiTiming } from "@/app/api/_shared/serverTiming";

const LANGUAGE_SET = new Set(["vi", "en"]);
const TEMPLATE_KEY_PATTERN = /^[a-z0-9_.:-]{2,80}$/;

const DEFAULT_BUTTON_LABEL_TEMPLATES = [
  ["reply.shop", "Nút reply Shop", "Reply keyboard button mở danh mục Shop.", "🛒 Mua hàng", "🛒 Shop"],
  ["reply.balance", "Nút reply Số dư", "Reply keyboard button xem số dư.", "💰 Số dư", "💰 Balance"],
  ["reply.deposit", "Nút reply Nạp tiền", "Reply keyboard button tạo lệnh nạp tiền.", "➕ Nạp tiền", "➕ Deposit"],
  ["reply.withdraw", "Nút reply Rút tiền", "Reply keyboard button tạo yêu cầu rút tiền.", "💸 Rút tiền", "💸 Withdraw"],
  ["reply.history", "Nút reply Lịch sử", "Reply keyboard button mở lịch sử mua.", "📜 Lịch sử mua", "📜 History"],
  ["reply.support", "Nút reply Hỗ trợ", "Reply keyboard button mở hỗ trợ.", "💬 Hỗ trợ", "💬 Support"],
  ["reply.language", "Nút reply Ngôn ngữ", "Reply keyboard button đổi ngôn ngữ.", "🌐 Ngôn ngữ", "🌐 Language"],
  ["reply.cancel", "Nút reply Hủy", "Reply keyboard button hủy thao tác.", "❌ Hủy", "❌ Cancel"],
  ["button.delete", "Nút Xóa", "Inline button xóa/ẩn tin nhắn bot.", "🗑 Xóa", "🗑 Delete"],
  ["button.back", "Nút Quay lại", "Inline button quay lại màn trước.", "🔙 Quay lại", "🔙 Back"],
  ["button.back_shop", "Nút quay lại Shop", "Inline button quay lại danh mục Shop.", "🔙 Shop", "🔙 Shop"],
  ["button.back_product", "Nút quay lại sản phẩm", "Inline button quay lại chi tiết sản phẩm.", "🔙 Quay lại sản phẩm", "🔙 Back to product"],
  ["button.refresh", "Nút Cập nhật", "Inline button refresh danh sách.", "🔄 Cập nhật", "🔄 Refresh"],
  ["button.prev", "Nút trang trước", "Inline pagination previous button.", "⬅️ Trước", "⬅️ Prev"],
  ["button.next", "Nút trang sau", "Inline pagination next button.", "Sau ➡️", "Next ➡️"],
  ["button.check_status", "Nút kiểm tra trạng thái", "Inline button kiểm tra trạng thái đơn thanh toán.", "🔄 Kiểm tra trạng thái", "🔄 Check status"],
  ["button.history", "Nút Lịch sử", "Inline button mở lịch sử mua.", "📜 Lịch sử", "📜 History"],
  ["button.support", "Nút Hỗ trợ", "Inline button mở hỗ trợ.", "💬 Hỗ trợ", "💬 Support"],
  ["button.account", "Nút Tài khoản", "Inline button mở thông tin tài khoản.", "👤 Tài khoản", "👤 Account"],
  ["button.pending_orders", "Nút đơn chờ", "Inline button mở danh sách đơn thanh toán đang chờ.", "⏳ Đơn chờ", "⏳ Pending orders"],
  ["button.paid_check", "Nút tôi đã thanh toán", "Inline button kiểm tra lại đơn sau khi user báo đã thanh toán.", "✅ Tôi đã thanh toán", "✅ I paid"],
  ["button.review_payment", "Nút xem lại thanh toán", "Inline button mở lại thông tin thanh toán của đơn đang chờ.", "👁 Xem lại thanh toán", "👁 Review payment"],
  ["button.cancel_order", "Nút hủy đơn", "Inline button hủy đơn thanh toán đang chờ.", "❌ Hủy đơn", "❌ Cancel order"],
  ["button.open_shop", "Nút mở danh mục", "Inline button mở danh mục Shop.", "🛒 Mở danh mục", "🛒 Open shop"],
  ["button.suggestions", "Nút gợi ý thêm", "Inline button mở lại Shop để xem gợi ý sản phẩm.", "✨ Gợi ý thêm", "✨ More picks"],
  ["button.main_shop", "Nút menu Shop", "Inline main menu Shop button.", "🛒 Mua hàng", "🛒 Shop"],
  ["button.main_deposit", "Nút menu Nạp tiền", "Inline main menu deposit button.", "💰 Nạp tiền", "💰 Deposit"],
  ["button.rebuy", "Nút mua lại", "Inline button mua lại từ lịch sử đơn.", "🛒 Mua lại", "🛒 Buy again"],
  ["button.quick_quantity", "Nút chọn nhanh số lượng", "Inline button quay lại chọn số lượng nhanh.", "⚡ Chọn nhanh", "⚡ Quick pick"],
  ["button.manual_quantity", "Nút nhập tay số lượng", "Inline button nhập số lượng thủ công.", "✍️ Nhập tay", "✍️ Enter manually"],
  ["button.pay_vnd", "Nút ví VNĐ", "Inline button thanh toán bằng ví VNĐ.", "💰 Ví VNĐ", "💰 VND wallet"],
  ["button.pay_usdt", "Nút ví USDT", "Inline button thanh toán bằng ví USDT.", "💵 Ví USDT", "💵 USDT wallet"],
  ["button.vietqr", "Nút VietQR", "Inline button thanh toán VietQR.", "💳 VietQR", "💳 VietQR"],
  ["button.binance", "Nút Binance", "Inline button thanh toán Binance.", "🟡 Binance", "🟡 Binance"]
] as const;

const DEFAULT_SCREEN_MESSAGE_TEMPLATES = [
  ["welcome", "Chào mừng", "Welcome", "Tin nhắn đầu tiên sau /start.", "First message after /start.", "Chào {name}!", "Welcome {name}!", null, "👋", ["name"]],
  ["shop_intro", "Danh mục sản phẩm", "Product catalog", "Tin nhắn mở danh mục sản phẩm.", "Product catalog opening message.", "Danh sách sản phẩm\nChọn một mục bên dưới để xem giá, tồn kho và thanh toán.", "Product catalog\nChoose an item below to view price, stock, and checkout options.", null, "🛍", []],
  ["sale_intro", "Sale đang mở", "Sale is open", "Tin nhắn mở danh mục Sale.", "Sale catalog opening message.", "SALE đang mở.\nCác deal có thời hạn và số lượng stock riêng, hết là dừng.", "SALE is open.\nThese deals have limited time and limited reserved stock.", "6055192572056309981", "🔥", []],
  ["sale_empty", "Sale trống", "No active Sale", "Tin nhắn khi chưa có món Sale.", "Message when no Sale item is active.", "Hiện chưa có món Sale đang hoạt động. Bạn quay lại Shop sau nhé.", "No active Sale item right now. Please check the Shop again later.", "6055192572056309981", "🔥", []],
  ["support_panel", "Hỗ trợ", "Support", "Tin nhắn khi user bấm Hỗ trợ.", "Message when user opens support.", "HỖ TRỢ\n\nNhấn nút bên dưới để liên hệ hỗ trợ:", "SUPPORT\n\nTap a button below to contact support:", null, "💬", []],
  ["history_empty", "Lịch sử trống", "Empty history", "Tin nhắn khi user chưa có đơn hàng.", "Message when user has no orders.", "Bạn chưa có đơn hàng nào!", "You have no orders yet!", null, "📜", []],
  ["feature_disabled", "Tính năng tạm tắt", "Feature disabled", "Tin nhắn chung khi một tính năng bị tắt từ Dashboard.", "Generic message when a feature is disabled from Dashboard.", "Tính năng này đang tạm tắt.", "This feature is temporarily disabled.", null, "⚠️", []],
  ["product_payment_options", "Chi tiết sản phẩm", "Product details", "Tin nhắn khi user mở sản phẩm và chọn phương thức thanh toán.", "Message when user opens a product and chooses a payment method.", "{product_summary}{balance_summary}\n\n{payment_prompt}", "{product_summary}{balance_summary}\n\n{payment_prompt}", null, null, ["product_summary", "balance_summary", "payment_prompt", "product_name", "price_vnd", "price_usdt", "stock", "balance_vnd", "balance_usdt", "max_vnd", "max_usdt", "payment_mode"]],
  ["sale_payment_options", "Chi tiết Sale", "Sale details", "Tin nhắn khi user mở sản phẩm Sale và chọn phương thức thanh toán.", "Message when user opens a Sale item and chooses a payment method.", "{product_summary}{balance_summary}\n\n{payment_prompt}", "{product_summary}{balance_summary}\n\n{payment_prompt}", null, null, ["product_summary", "balance_summary", "payment_prompt", "product_name", "price_vnd", "price_usdt", "stock", "balance_vnd", "balance_usdt", "max_vnd", "max_usdt", "payment_mode"]],
  ["quantity_quick_prompt", "Chọn số lượng nhanh", "Quick quantity", "Tin nhắn chọn nhanh số lượng mua.", "Quick quantity picker message.", "{error_block}💳 Cách thanh toán: {payment_label}\n📦 Sản phẩm: {product_name}\n💰 Số dư hiện tại: {balance_text}\n🧮 Mua tối đa: {max_can_buy}\n\nChọn nhanh số lượng bên dưới hoặc bấm \"Nhập tay\".", "{error_block}💳 Payment method: {payment_label}\n📦 Product: {product_name}\n💰 Current balance: {balance_text}\n🧮 Max quantity: {max_can_buy}\n\nChoose a quick quantity below or tap \"Enter manually\".", null, null, ["error_block", "payment_label", "product_name", "balance_text", "max_can_buy"]],
  ["quantity_manual_prompt", "Nhập số lượng", "Manual quantity", "Tin nhắn hướng dẫn user nhập số lượng thủ công.", "Message that asks the user to type a quantity manually.", "{error_block}💳 Cách thanh toán: {payment_label}\n📦 Sản phẩm: {product_name}\n💰 Số dư hiện tại: {balance_text}\n🧮 Mua tối đa: {max_can_buy}\n\n✍️ Gửi số lượng bạn muốn mua vào chat.\nVui lòng nhập số nguyên từ 1 đến {max_can_buy}.", "{error_block}💳 Payment method: {payment_label}\n📦 Product: {product_name}\n💰 Current balance: {balance_text}\n🧮 Max quantity: {max_can_buy}\n\n✍️ Send the quantity you want to buy in chat.\nPlease enter a whole number from 1 to {max_can_buy}.", null, null, ["error_block", "payment_label", "product_name", "balance_text", "max_can_buy"]],
  ["quantity_force_reply_prompt", "ForceReply số lượng", "Quantity ForceReply", "Tin nhắn ForceReply ngắn khi user nhập số lượng.", "Short ForceReply message for manual quantity input.", "✍️ Nhập số lượng từ 1 đến {max_can_buy}.", "✍️ Reply with a quantity from 1 to {max_can_buy}.", null, null, ["max_can_buy"]],
  ["direct_payment_options", "Chọn thanh toán trực tiếp", "Direct payment options", "Tin nhắn chọn VietQR/Binance khi tạo đơn thanh toán trực tiếp.", "Message for choosing VietQR/Binance when creating a direct order.", "🏦 Chọn cách thanh toán\n\n📦 Sản phẩm: {product_name}\n🔢 Số lượng mua: {quantity}\n📥 Số lượng nhận: {delivered_quantity}{bonus_line}\n💰 Tổng thanh toán: {total_price}\n\nChọn một phương thức bên dưới để tạo đơn.", "🏦 Choose a payment method\n\n📦 Product: {product_name}\n🔢 Paid quantity: {quantity}\n📥 Delivered quantity: {delivered_quantity}{bonus_line}\n💰 Total: {total_price}\n\nChoose a method below to create the order.", null, null, ["product_name", "quantity", "delivered_quantity", "bonus_quantity", "bonus_line", "total_price"]]
] as const;

const DEFAULT_BOT_MESSAGE_TEMPLATES = [
  ...DEFAULT_BUTTON_LABEL_TEMPLATES.flatMap(([templateKey, title, description, viText, enText]) => [
    {
      template_key: templateKey,
      language: "vi",
      title,
      description,
      body_text: viText,
      custom_emoji_id: null,
      fallback_emoji: null,
      enabled: true,
      variables: [],
      updated_at: null
    },
    {
      template_key: templateKey,
      language: "en",
      title: `${title} EN`,
      description,
      body_text: enText,
      custom_emoji_id: null,
      fallback_emoji: null,
      enabled: true,
      variables: [],
      updated_at: null
    }
  ]),
  ...DEFAULT_SCREEN_MESSAGE_TEMPLATES.flatMap(
    ([templateKey, viTitle, enTitle, viDescription, enDescription, viText, enText, customEmojiId, fallbackEmoji, variables]) => [
      {
        template_key: templateKey,
        language: "vi",
        title: viTitle,
        description: viDescription,
        body_text: viText,
        custom_emoji_id: customEmojiId,
        fallback_emoji: fallbackEmoji,
        enabled: true,
        variables,
        updated_at: null
      },
      {
        template_key: templateKey,
        language: "en",
        title: enTitle,
        description: enDescription,
        body_text: enText,
        custom_emoji_id: customEmojiId,
        fallback_emoji: fallbackEmoji,
        enabled: true,
        variables,
        updated_at: null
      }
    ]
  ),
  {
    template_key: "sale_entry_button",
    language: "vi",
    title: "Nút vào Sale",
    description: "Nút inline ở đầu danh mục Shop khi có Sale đang mở.",
    body_text: "SALE đang mở",
    custom_emoji_id: "6055192572056309981",
    fallback_emoji: "🔥",
    enabled: true,
    variables: [],
    updated_at: null
  },
  {
    template_key: "sale_entry_button",
    language: "en",
    title: "Sale entry button",
    description: "Inline button at the top of the Shop catalog when Sale is open.",
    body_text: "SALE is open",
    custom_emoji_id: "6055192572056309981",
    fallback_emoji: "🔥",
    enabled: true,
    variables: [],
    updated_at: null
  }
] as const;

const cleanText = (value: unknown, fallback = "") =>
  typeof value === "string" ? value.trim() : fallback;

const cleanCustomEmojiId = (value: unknown) =>
  cleanText(value).replace(/\D/g, "").slice(0, 64);

const cleanVariables = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => cleanText(item))
    .filter(Boolean)
    .slice(0, 20);
};

async function handleGET(request: NextRequest) {
  const adminSession = await requireAdminSession(request);
  if (adminSession.ok === false) {
    return adminSession.response;
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("bot_message_templates")
    .select("template_key, language, title, description, body_text, custom_emoji_id, fallback_emoji, enabled, variables, updated_at")
    .order("template_key", { ascending: true })
    .order("language", { ascending: true });

  if (error) {
    return NextResponse.json(
      {
        error:
          error.message ||
          "Không thể tải Bot messages. Hãy chạy supabase_schema_all_in_one.sql để tạo bot_message_templates."
      },
      { status: 500 }
    );
  }

  const rows = data || [];
  const existing = new Set(rows.map((item) => `${item.template_key}:${item.language}`));
  const mergedRows = [
    ...rows,
    ...DEFAULT_BOT_MESSAGE_TEMPLATES.filter((item) => !existing.has(`${item.template_key}:${item.language}`))
  ].sort((left, right) =>
    `${left.template_key}:${left.language}`.localeCompare(`${right.template_key}:${right.language}`)
  );

  return NextResponse.json({ success: true, data: mergedRows });
}

async function handlePOST(request: NextRequest) {
  const adminSession = await requireAdminSession(request);
  if (adminSession.ok === false) {
    return adminSession.response;
  }

  const body = await request.json().catch(() => null);
  const templateKey = cleanText(body?.templateKey || body?.template_key).toLowerCase();
  const language = cleanText(body?.language, "vi").toLowerCase();
  const title = cleanText(body?.title);
  const bodyText = typeof body?.bodyText === "string" ? body.bodyText.trim() : cleanText(body?.body_text);

  if (!TEMPLATE_KEY_PATTERN.test(templateKey)) {
    return NextResponse.json({ error: "Template key không hợp lệ." }, { status: 400 });
  }
  if (!LANGUAGE_SET.has(language)) {
    return NextResponse.json({ error: "Language không hợp lệ." }, { status: 400 });
  }
  if (!title || !bodyText) {
    return NextResponse.json({ error: "Title và body text là bắt buộc." }, { status: 400 });
  }

  const payload = {
    template_key: templateKey,
    language,
    title,
    description: cleanText(body?.description),
    body_text: bodyText,
    custom_emoji_id: cleanCustomEmojiId(body?.customEmojiId || body?.custom_emoji_id) || null,
    fallback_emoji: cleanText(body?.fallbackEmoji || body?.fallback_emoji) || null,
    enabled: body?.enabled === false ? false : true,
    variables: cleanVariables(body?.variables)
  };

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("bot_message_templates")
    .upsert(payload, { onConflict: "template_key,language" })
    .select("template_key, language, title, description, body_text, custom_emoji_id, fallback_emoji, enabled, variables, updated_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message || "Không thể lưu Bot message." }, { status: 500 });
  }

  await recordAdminAuditEvent(supabase, {
    adminUserId: adminSession.userId,
    adminEmail: adminSession.email,
    action: "bot_message_template.upsert",
    entityType: "bot_message_template",
    entityId: `${templateKey}:${language}`,
    metadata: {
      templateKey,
      language,
      hasCustomEmoji: Boolean(payload.custom_emoji_id)
    }
  });

  return NextResponse.json({ success: true, data });
}

export const GET = withAdminApiTiming("GET /api/admin/bot-messages", handleGET);
export const POST = withAdminApiTiming("POST /api/admin/bot-messages", handlePOST);
