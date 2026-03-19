"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

const SETTINGS_KEYS = [
  "bank_name",
  "account_number",
  "account_name",
  "sepay_token",
  "binance_pay_id",
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
  "show_usdt",
  "show_history",
  "show_language",
  "show_support"
];

const TOGGLE_FIELDS = [
  { key: "show_shop", label: 'Hiện "Danh mục"' },
  { key: "show_balance", label: 'Hiện "Số dư"' },
  { key: "show_deposit", label: 'Hiện "Nạp tiền"' },
  { key: "show_withdraw", label: 'Hiện "Rút tiền"' },
  { key: "show_usdt", label: 'Hiện "Nạp USDT"' },
  { key: "show_history", label: 'Hiện "Lịch sử"' },
  { key: "show_language", label: 'Hiện "Ngôn ngữ"' },
  { key: "show_support", label: 'Hiện "Hỗ trợ"' },
];
const TOGGLE_KEYS = TOGGLE_FIELDS.map((field) => field.key);

export default function SettingsPage() {
  const [values, setValues] = useState<Record<string, string>>({});

  const load = async () => {
    const { data } = await supabase
      .from("settings")
      .select("key, value")
      .in("key", SETTINGS_KEYS);
    const map: Record<string, string> = {};
    (data || []).forEach((row: any) => {
      map[row.key] = row.value;
    });
    setValues(map);
  };

  useEffect(() => {
    load();
  }, []);

  const updateField = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const saveSettings = async (event: React.FormEvent) => {
    event.preventDefault();
    const payload = SETTINGS_KEYS.map((key) => {
      if (TOGGLE_KEYS.includes(key)) {
        return { key, value: values[key] ?? "true" };
      }
      if (key === "shop_page_size") {
        const parsed = Number.parseInt(values[key] || "10", 10);
        const normalized = Number.isFinite(parsed) ? Math.min(50, Math.max(1, parsed)) : 10;
        return { key, value: String(normalized) };
      }
      const value = values[key] || "";
      return { key, value };
    });
    await supabase.from("settings").upsert(payload);
    await load();
  };

  return (
    <div className="grid" style={{ gap: 24 }}>
      <div className="topbar">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="muted">Cập nhật cấu hình Bot Telegram.</p>
        </div>
      </div>

      <div className="card">
        <form className="form-grid" onSubmit={saveSettings}>
          <input
            className="input"
            placeholder="Bank name"
            value={values.bank_name || ""}
            onChange={(e) => updateField("bank_name", e.target.value)}
          />
          <input
            className="input"
            placeholder="Account number"
            value={values.account_number || ""}
            onChange={(e) => updateField("account_number", e.target.value)}
          />
          <input
            className="input"
            placeholder="Account name"
            value={values.account_name || ""}
            onChange={(e) => updateField("account_name", e.target.value)}
          />
          <input
            className="input"
            placeholder="SePay token"
            value={values.sepay_token || ""}
            onChange={(e) => updateField("sepay_token", e.target.value)}
          />
          <input
            className="input"
            placeholder="Binance Pay ID"
            value={values.binance_pay_id || ""}
            onChange={(e) => updateField("binance_pay_id", e.target.value)}
          />
          <input
            className="input"
            placeholder="Admin contact"
            value={values.admin_contact || ""}
            onChange={(e) => updateField("admin_contact", e.target.value)}
          />
          <div className="form-section">
            <div className="section-title">Text menu Danh mục</div>
            <p className="muted" style={{ marginBottom: 10 }}>
              Nội dung hiển thị cùng danh sách sản phẩm trong bot. Để trống nếu muốn dùng text mặc định.
            </p>
            <textarea
              className="textarea"
              placeholder={"🤖 TUNVN PREHUB BOT — AUTO ORDER 🤖\n\n👨‍💼 Hỗ trợ: @tunvn2002 | Zalo: 0923159688\n🎁 Khuyến mãi: Mua 10 tặng 2\n\n🛍️ Chọn sản phẩm để mua:"}
              value={values.shop_intro_text || ""}
              onChange={(e) => updateField("shop_intro_text", e.target.value)}
            />
          </div>
          <div className="form-section">
            <div className="section-title">Relay thông báo thanh toán</div>
            <p className="muted" style={{ marginBottom: 10 }}>
              Khi đơn thanh toán thành công, hệ thống sẽ gửi thông báo sang bot Telegram khác.
            </p>
            <input
              className="input"
              placeholder="Bot_Token nhận thông báo"
              value={values.payment_notify_bot_token || ""}
              onChange={(e) => updateField("payment_notify_bot_token", e.target.value)}
            />
            <input
              className="input"
              placeholder="UserID nhận thông báo (có thể âm nếu là group)"
              value={values.payment_notify_user_id || ""}
              onChange={(e) => updateField("payment_notify_user_id", e.target.value)}
            />
          </div>
          <div className="form-section">
            <div className="section-title">Liên hệ hỗ trợ</div>
            <p className="muted" style={{ marginBottom: 10 }}>
              Mỗi dòng 1 liên hệ theo format: Tên|Link. Ví dụ: Telegram|https://t.me/your_admin
            </p>
            <textarea
              className="textarea"
              placeholder={"Telegram|https://t.me/your_admin\nFacebook|https://facebook.com/your_page\nZalo|https://zalo.me/0900000000"}
              value={values.support_contacts || ""}
              onChange={(e) => updateField("support_contacts", e.target.value)}
            />
          </div>
          <div className="form-section">
            <div className="section-title">Text màn hình Hỗ trợ</div>
            <p className="muted" style={{ marginBottom: 10 }}>
              Nội dung hiển thị khi user bấm `Hỗ trợ`. Có thể dùng nhiều dòng; nếu có cấu hình liên hệ, nút link vẫn hiển thị bên dưới.
            </p>
            <textarea
              className="textarea"
              placeholder={"💬 HỖ TRỢ KHÁCH HÀNG\n────────────────\n\n📋 Liên hệ Admin: @your_admin\n📱 Zalo: 0900000000\n\n⏰ Thời gian hỗ trợ:\n8:00 - 23:00 hàng ngày\n\n📝 Lưu ý:\n├ Gửi mã giao dịch khi cần hỗ trợ\n├ Mô tả rõ vấn đề gặp phải\n└ Chờ phản hồi trong 5-10 phút"}
              value={values.support_panel_text || ""}
              onChange={(e) => updateField("support_panel_text", e.target.value)}
            />
          </div>
          <div className="form-section">
            <div className="section-title">Phân trang sản phẩm</div>
            <p className="muted" style={{ marginBottom: 10 }}>
              Số lượng sản phẩm hiển thị trên mỗi trang trong menu Danh mục của bot (mặc định 10).
            </p>
            <input
              className="input"
              type="number"
              min={1}
              max={50}
              placeholder="Ví dụ: 10"
              value={values.shop_page_size || "10"}
              onChange={(e) => updateField("shop_page_size", e.target.value)}
            />
          </div>
          <div className="form-section">
            <div className="section-title">Website Storefront</div>
            <p className="muted" style={{ marginBottom: 10 }}>
              Website có dashboard riêng, sidebar riêng và settings riêng.
            </p>
            <a className="button secondary" href="/website/settings">Mở Website Dashboard</a>
          </div>
          <select
            className="select"
            value={values.payment_mode || "hybrid"}
            onChange={(e) => updateField("payment_mode", e.target.value)}
          >
            <option value="direct">Thanh toán VietQR luôn</option>
            <option value="hybrid">Thiếu balance thì VietQR</option>
            <option value="balance">Chỉ mua bằng balance</option>
          </select>
          <div className="form-section">
            <div className="section-title">Hiển thị menu</div>
            <div className="toggle-grid">
              {TOGGLE_FIELDS.map((field) => {
                const isOn = (values[field.key] ?? "true") !== "false";
                return (
                  <label className="toggle" key={field.key}>
                    <input
                      type="checkbox"
                      checked={isOn}
                      onChange={(e) => updateField(field.key, e.target.checked ? "true" : "false")}
                    />
                    <span>{field.label}</span>
                  </label>
                );
              })}
            </div>
          </div>
          <button className="button" type="submit">Lưu cấu hình</button>
        </form>
      </div>
    </div>
  );
}
