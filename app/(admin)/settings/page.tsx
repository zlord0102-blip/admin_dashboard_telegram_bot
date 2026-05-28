"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

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
];

const TOGGLE_FIELDS = [
  { key: "show_shop", label: 'Hiện "Danh mục"' },
  { key: "show_balance", label: 'Hiện "Số dư"' },
  { key: "show_deposit", label: 'Hiện "Nạp tiền"' },
  { key: "show_withdraw", label: 'Hiện "Rút tiền"' },
  { key: "show_history", label: 'Hiện "Lịch sử"' },
  { key: "show_language", label: 'Hiện "Ngôn ngữ"' },
  { key: "show_support", label: 'Hiện "Hỗ trợ"' },
];
const TOGGLE_KEYS = TOGGLE_FIELDS.map((field) => field.key);
const SECRET_SETTING_KEYS = new Set([
  "sepay_token",
  "binance_api_key",
  "binance_api_secret",
  "binance_pay_merchant_api_key",
  "binance_pay_merchant_api_secret",
  "payment_notify_bot_token"
]);
const MASKED_SECRET_VALUE = "********";

const getSecretPlaceholder = (key: string, secretPresent: Record<string, boolean>, fallback: string) =>
  secretPresent[key] ? "Đã lưu - nhập giá trị mới nếu muốn đổi" : fallback;

const secretInputClassName = (value: string | undefined) =>
  value === MASKED_SECRET_VALUE ? "input secret-input is-masked" : "input secret-input";

export default function SettingsPage() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [secretPresent, setSecretPresent] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<string | null>(null);

  const load = async () => {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    if (!token) {
      setStatus("Chưa đăng nhập.");
      return;
    }

    const response = await fetch("/api/admin/settings", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`
      },
      cache: "no-store"
    });
    const json = await response.json().catch(() => null);
    if (!response.ok) {
      setStatus(typeof json?.error === "string" ? json.error : "Không thể tải settings.");
      return;
    }

    setValues((json?.data?.values ?? {}) as Record<string, string>);
    setSecretPresent((json?.data?.secretPresent ?? {}) as Record<string, boolean>);
  };

  useEffect(() => {
    load();
  }, []);

  const updateField = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const saveSettings = async (event: React.FormEvent) => {
    event.preventDefault();
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    if (!token) {
      setStatus("Chưa đăng nhập.");
      return;
    }

    const settings = SETTINGS_KEYS.reduce<Record<string, string>>((acc, key) => {
      if (TOGGLE_KEYS.includes(key)) {
        acc[key] = values[key] ?? "true";
        return acc;
      }
      if (key === "shop_page_size") {
        const parsed = Number.parseInt(values[key] || "10", 10);
        const normalized = Number.isFinite(parsed) ? Math.min(50, Math.max(1, parsed)) : 10;
        acc[key] = String(normalized);
        return acc;
      }
      if (SECRET_SETTING_KEYS.has(key) && (!(values[key] || "").trim() || values[key] === MASKED_SECRET_VALUE)) {
        return acc;
      }
      acc[key] = values[key] || "";
      return acc;
    }, {});

    const response = await fetch("/api/admin/settings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ settings })
    });
    const json = await response.json().catch(() => null);
    if (!response.ok) {
      setStatus(typeof json?.error === "string" ? json.error : "Không thể lưu settings.");
      return;
    }

    setStatus("Đã lưu cấu hình.");
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
        {status && <p className="muted" style={{ marginTop: 0 }}>{status}</p>}
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
            className={secretInputClassName(values.sepay_token)}
            type="password"
            placeholder={getSecretPlaceholder("sepay_token", secretPresent, "SePay token")}
            value={values.sepay_token || ""}
            onChange={(e) => updateField("sepay_token", e.target.value)}
          />
          <input
            className="input"
            placeholder="Admin contact"
            value={values.admin_contact || ""}
            onChange={(e) => updateField("admin_contact", e.target.value)}
          />
          <div className="form-section">
            <div className="section-title">Binance payment</div>
            <p className="muted" style={{ marginBottom: 10 }}>
              Dùng cho checkout tự động bằng Binance trong bot Telegram. Có thể nhập tên phổ biến của network như `TRC20`, `BEP20`, `ERC20`; hệ thống sẽ tự map sang mã Binance tương ứng.
            </p>
            <label className="toggle" style={{ marginBottom: 12 }}>
              <input
                type="checkbox"
                checked={(values.binance_direct_enabled ?? "false") === "true"}
                onChange={(e) => updateField("binance_direct_enabled", e.target.checked ? "true" : "false")}
              />
              <span>Bật Binance on-chain</span>
            </label>
            <div className="grid" style={{ gap: 10 }}>
              <label className="grid" style={{ gap: 6 }}>
                <span className="muted">Binance API Key</span>
                <input
                  className={secretInputClassName(values.binance_api_key)}
                  type="password"
                  placeholder={getSecretPlaceholder("binance_api_key", secretPresent, "Binance API Key")}
                  value={values.binance_api_key || ""}
                  onChange={(e) => updateField("binance_api_key", e.target.value)}
                />
              </label>
              <label className="grid" style={{ gap: 6 }}>
                <span className="muted">Binance API Secret</span>
                <input
                  className={secretInputClassName(values.binance_api_secret)}
                  type="password"
                  placeholder={getSecretPlaceholder("binance_api_secret", secretPresent, "Binance API Secret")}
                  value={values.binance_api_secret || ""}
                  onChange={(e) => updateField("binance_api_secret", e.target.value)}
                />
              </label>
              <label className="grid" style={{ gap: 6 }}>
                <span className="muted">Binance Pay ID</span>
                <input
                  className="input"
                  placeholder="Ví dụ: 1039622524"
                  value={values.binance_pay_id || ""}
                  onChange={(e) => updateField("binance_pay_id", e.target.value)}
                />
              </label>
              <label className="toggle" style={{ marginBottom: 2 }}>
                <input
                  type="checkbox"
                  checked={(values.binance_pay_merchant_enabled ?? "false") === "true"}
                  onChange={(e) => updateField("binance_pay_merchant_enabled", e.target.checked ? "true" : "false")}
                />
                <span>Bật Binance Pay Merchant auto-confirm</span>
              </label>
              <label className="grid" style={{ gap: 6 }}>
                <span className="muted">Binance Pay Merchant API Key</span>
                <input
                  className={secretInputClassName(values.binance_pay_merchant_api_key)}
                  type="password"
                  placeholder={getSecretPlaceholder("binance_pay_merchant_api_key", secretPresent, "Merchant API Key")}
                  value={values.binance_pay_merchant_api_key || ""}
                  onChange={(e) => updateField("binance_pay_merchant_api_key", e.target.value)}
                />
              </label>
              <label className="grid" style={{ gap: 6 }}>
                <span className="muted">Binance Pay Merchant API Secret</span>
                <input
                  className={secretInputClassName(values.binance_pay_merchant_api_secret)}
                  type="password"
                  placeholder={getSecretPlaceholder("binance_pay_merchant_api_secret", secretPresent, "Merchant API Secret")}
                  value={values.binance_pay_merchant_api_secret || ""}
                  onChange={(e) => updateField("binance_pay_merchant_api_secret", e.target.value)}
                />
              </label>
              <label className="grid" style={{ gap: 6 }}>
                <span className="muted">Binance Pay Merchant Base URL</span>
                <input
                  className="input"
                  placeholder="https://bpay.binanceapi.com"
                  value={values.binance_pay_merchant_base_url || ""}
                  onChange={(e) => updateField("binance_pay_merchant_base_url", e.target.value)}
                />
              </label>
              <label className="grid" style={{ gap: 6 }}>
                <span className="muted">Webhook URL public gửi cho Binance Pay</span>
                <input
                  className="input"
                  placeholder="https://your-domain.com/binance-pay/webhook"
                  value={values.binance_pay_webhook_url || ""}
                  onChange={(e) => updateField("binance_pay_webhook_url", e.target.value)}
                />
              </label>
              <label className="grid" style={{ gap: 6 }}>
                <span className="muted">Deposit address hiển thị/copy cho khách</span>
                <input
                  className="input"
                  placeholder="Ví dụ: 0x... / T... / địa chỉ nạp trên Binance"
                  value={values.binance_direct_address || ""}
                  onChange={(e) => updateField("binance_direct_address", e.target.value)}
                />
              </label>
              <label className="grid" style={{ gap: 6 }}>
                <span className="muted">Memo/Tag nếu network yêu cầu</span>
                <input
                  className="input"
                  placeholder="Để trống nếu không có memo/tag"
                  value={values.binance_direct_address_tag || ""}
                  onChange={(e) => updateField("binance_direct_address_tag", e.target.value)}
                />
              </label>
              <label className="grid" style={{ gap: 6 }}>
                <span className="muted">Coin</span>
                <input
                  className="input"
                  placeholder="Ví dụ: USDT"
                  value={values.binance_direct_coin || "USDT"}
                  onChange={(e) => updateField("binance_direct_coin", e.target.value)}
                />
              </label>
              <label className="grid" style={{ gap: 6 }}>
                <span className="muted">Network</span>
                <input
                  className="input"
                  placeholder="Ví dụ: TRX / TRC20, BSC / BEP20, ETH / ERC20"
                  value={values.binance_direct_network || ""}
                  onChange={(e) => updateField("binance_direct_network", e.target.value)}
                />
              </label>
              <label className="grid" style={{ gap: 6 }}>
                <span className="muted">Tỷ giá VND / 1 coin</span>
                <input
                  className="input"
                  placeholder="Ví dụ: 25000"
                  value={values.binance_direct_rate || ""}
                  onChange={(e) => updateField("binance_direct_rate", e.target.value)}
                />
              </label>
            </div>
          </div>
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
              className={secretInputClassName(values.payment_notify_bot_token)}
              type="password"
              placeholder={getSecretPlaceholder("payment_notify_bot_token", secretPresent, "Bot_Token nhận thông báo")}
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
            <option value="direct">Luôn thanh toán trực tiếp</option>
            <option value="hybrid">Thiếu balance thì thanh toán trực tiếp</option>
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
