"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ConfirmDialog,
  DataTable,
  EmptyState,
  PageHeader,
  RowActionMenu,
  SectionCard,
  StatusPill
} from "@/components/AdminUi";
import { adminApiRequest } from "@/lib/adminOpsClient";

const DEFAULT_SALE_CUSTOM_EMOJI_ID = "6055192572056309981";

type ProductRow = {
  id: number;
  name: string;
  price: number;
  price_usdt?: number | null;
  stock?: number;
};

type SaleCampaign = {
  id: number;
  name: string;
  status: string;
  starts_at: string;
  ends_at: string;
  total_quantity_limit: number | null;
  per_user_limit: number | null;
  notify_on_start: boolean;
  notify_ending_soon: boolean;
  notes: string | null;
};

type SaleItem = {
  id: number;
  campaign_id: number;
  product_id: number;
  sale_name: string | null;
  sale_description: string | null;
  sale_price_vnd: number;
  sale_price_usdt: number | null;
  original_price_vnd: number | null;
  discount_percent: number | null;
  promo_buy_quantity: number;
  promo_bonus_quantity: number;
  stock_mode: string;
  quantity_limit: number | null;
  per_user_limit: number | null;
  telegram_icon_custom_emoji_id: string | null;
  sort_position: number | null;
  is_enabled: boolean;
  products?: { id: number; name: string; price: number; price_usdt?: number | null } | null;
  reservation_stats: { available: number; held: number; sold: number; released: number };
};

type SalesPayload = {
  campaigns: SaleCampaign[];
  items: SaleItem[];
  products: ProductRow[];
};

const formatMoney = (value: number | null | undefined) =>
  `${Number(value || 0).toLocaleString("vi-VN")}đ`;

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));

const toDateTimeLocal = (date: Date) => {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
};

const defaultStartsAt = () => toDateTimeLocal(new Date());
const defaultEndsAt = () => toDateTimeLocal(new Date(Date.now() + 24 * 60 * 60 * 1000));

const createDefaultCampaignForm = () => ({
  name: "",
  status: "scheduled",
  startsAt: defaultStartsAt(),
  endsAt: defaultEndsAt(),
  totalQuantityLimit: "",
  perUserLimit: "",
  notifyOnStart: false,
  notifyEndingSoon: true,
  notes: ""
});

const createDefaultItemForm = () => ({
  campaignId: "",
  productId: "",
  saleName: "",
  saleDescription: "",
  salePriceVnd: "",
  salePriceUsdt: "",
  stockQuantity: "10",
  newStockText: "",
  quantityLimit: "",
  perUserLimit: "",
  promoBuyQuantity: "0",
  promoBonusQuantity: "0",
  telegramIconCustomEmojiId: DEFAULT_SALE_CUSTOM_EMOJI_ID,
  sortPosition: ""
});

const campaignStatusTone = (status: string): "neutral" | "success" | "warning" | "danger" => {
  if (status === "active") return "success";
  if (status === "scheduled" || status === "paused" || status === "draft") return "warning";
  if (status === "cancelled") return "danger";
  return "neutral";
};

const itemStockTotal = (item: SaleItem) =>
  item.reservation_stats.available +
  item.reservation_stats.held +
  item.reservation_stats.sold +
  item.reservation_stats.released;

const itemSoldPercent = (item: SaleItem) => {
  const total = itemStockTotal(item);
  return total > 0 ? Math.min(100, Math.round((item.reservation_stats.sold / total) * 100)) : 0;
};

const countStockLines = (value: string) =>
  value.split(/\r?\n/).filter((line) => line.trim()).length;

export default function SalesPage() {
  const [data, setData] = useState<SalesPayload>({ campaigns: [], items: [], products: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [campaignModalOpen, setCampaignModalOpen] = useState(false);
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<SaleCampaign | null>(null);
  const [editingItem, setEditingItem] = useState<SaleItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<
    | { type: "campaign"; campaign: SaleCampaign }
    | { type: "item"; item: SaleItem }
    | null
  >(null);
  const [stockMode, setStockMode] = useState<"existing" | "new">("existing");

  const [campaignForm, setCampaignForm] = useState(createDefaultCampaignForm);
  const [itemForm, setItemForm] = useState(createDefaultItemForm);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const next = await adminApiRequest<SalesPayload>("/api/admin/sales");
      setData(next);
      setItemForm((prev) => ({
        ...prev,
        campaignId: prev.campaignId || String(next.campaigns[0]?.id ?? ""),
        productId: prev.productId || String(next.products[0]?.id ?? "")
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể tải Sale.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const campaignById = useMemo(
    () => new Map(data.campaigns.map((campaign) => [campaign.id, campaign])),
    [data.campaigns]
  );

  const activeCampaigns = useMemo(
    () => data.campaigns.filter((campaign) => ["draft", "scheduled", "active", "paused"].includes(campaign.status)),
    [data.campaigns]
  );

  const liveCampaigns = useMemo(
    () => data.campaigns.filter((campaign) => campaign.status === "active"),
    [data.campaigns]
  );

  const nextCampaign = useMemo(
    () =>
      [...data.campaigns]
        .filter((campaign) => campaign.status === "scheduled")
        .sort((left, right) => new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime())[0],
    [data.campaigns]
  );

  const enabledItemCount = useMemo(
    () => data.items.filter((item) => item.is_enabled).length,
    [data.items]
  );

  const newStockLineCount = useMemo(
    () => countStockLines(itemForm.newStockText),
    [itemForm.newStockText]
  );

  const canSubmitSaleItem =
    activeCampaigns.length > 0 &&
    (stockMode === "new" ? newStockLineCount > 0 : Number(itemForm.stockQuantity) > 0);

  const saleSummary = useMemo(() => {
    return data.items.reduce(
      (acc, item) => {
        acc.available += item.reservation_stats.available;
        acc.held += item.reservation_stats.held;
        acc.sold += item.reservation_stats.sold;
        return acc;
      },
      { available: 0, held: 0, sold: 0 }
    );
  }, [data.items]);

  const runAction = async (body: Record<string, unknown>, successMessage: string) => {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await adminApiRequest("/api/admin/sales", {
        method: "POST",
        body: JSON.stringify(body)
      });
      setNotice(successMessage);
      await load();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể cập nhật Sale.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const openCreateCampaign = () => {
    setEditingCampaign(null);
    setCampaignForm(createDefaultCampaignForm());
    setCampaignModalOpen(true);
  };

  const openCreateItem = () => {
    setEditingItem(null);
    setStockMode("existing");
    setItemForm((prev) => ({
      ...createDefaultItemForm(),
      campaignId: prev.campaignId || String(activeCampaigns[0]?.id ?? ""),
      productId: prev.productId || String(data.products[0]?.id ?? "")
    }));
    setItemModalOpen(true);
  };

  const submitCampaign = async () => {
    const ok = await runAction(
      {
        action: editingCampaign ? "update_campaign" : "create_campaign",
        campaignId: editingCampaign?.id,
        ...campaignForm
      },
      editingCampaign ? "Đã cập nhật campaign Sale." : "Đã tạo campaign Sale."
    );
    if (!ok) return;
    setCampaignForm(createDefaultCampaignForm());
    setEditingCampaign(null);
    setCampaignModalOpen(false);
  };

  const submitSaleItem = async () => {
    const ok = await runAction(
      {
        action: editingItem ? "update_item" : stockMode === "new" ? "add_item_new_stock" : "add_item_existing_stock",
        saleItemId: editingItem?.id,
        ...itemForm,
        stockQuantity: stockMode === "new" ? String(newStockLineCount) : itemForm.stockQuantity,
        telegramIconCustomEmojiId: itemForm.telegramIconCustomEmojiId || DEFAULT_SALE_CUSTOM_EMOJI_ID
      },
      editingItem ? "Đã cập nhật món Sale." : "Đã thêm món Sale và reserve stock."
    );
    if (!ok) return;
    setItemForm((prev) => ({
      ...prev,
      saleName: "",
      saleDescription: "",
      salePriceVnd: "",
      salePriceUsdt: "",
      newStockText: "",
      stockQuantity: stockMode === "new" ? "0" : prev.stockQuantity
    }));
    setEditingItem(null);
    setItemModalOpen(false);
  };

  const startEditCampaign = (campaign: SaleCampaign) => {
    setEditingCampaign(campaign);
    setCampaignForm({
      name: campaign.name,
      status: campaign.status,
      startsAt: toDateTimeLocal(new Date(campaign.starts_at)),
      endsAt: toDateTimeLocal(new Date(campaign.ends_at)),
      totalQuantityLimit: campaign.total_quantity_limit ? String(campaign.total_quantity_limit) : "",
      perUserLimit: campaign.per_user_limit ? String(campaign.per_user_limit) : "",
      notifyOnStart: Boolean(campaign.notify_on_start),
      notifyEndingSoon: Boolean(campaign.notify_ending_soon),
      notes: campaign.notes || ""
    });
    setCampaignModalOpen(true);
  };

  const startEditItem = (item: SaleItem) => {
    setEditingItem(item);
    setStockMode("existing");
    setItemForm({
      campaignId: String(item.campaign_id),
      productId: String(item.product_id),
      saleName: item.sale_name || "",
      saleDescription: item.sale_description || "",
      salePriceVnd: String(item.sale_price_vnd ?? ""),
      salePriceUsdt: item.sale_price_usdt !== null && item.sale_price_usdt !== undefined ? String(item.sale_price_usdt) : "",
      stockQuantity: String(itemStockTotal(item) || item.quantity_limit || 0),
      newStockText: "",
      quantityLimit: item.quantity_limit ? String(item.quantity_limit) : "",
      perUserLimit: item.per_user_limit ? String(item.per_user_limit) : "",
      promoBuyQuantity: String(item.promo_buy_quantity || 0),
      promoBonusQuantity: String(item.promo_bonus_quantity || 0),
      telegramIconCustomEmojiId: item.telegram_icon_custom_emoji_id || DEFAULT_SALE_CUSTOM_EMOJI_ID,
      sortPosition: item.sort_position ? String(item.sort_position) : ""
    });
    setItemModalOpen(true);
  };

  const closeCampaignModal = () => {
    if (saving) return;
    setCampaignModalOpen(false);
    setEditingCampaign(null);
  };

  const closeItemModal = () => {
    if (saving) return;
    setItemModalOpen(false);
    setEditingItem(null);
  };

  const confirmDeleteTarget = async () => {
    if (!deleteTarget) return;
    const ok =
      deleteTarget.type === "campaign"
        ? await runAction(
            { action: "delete_campaign", campaignId: deleteTarget.campaign.id },
            "Đã xóa campaign Sale."
          )
        : await runAction(
            { action: "delete_item", saleItemId: deleteTarget.item.id },
            "Đã xóa món Sale."
          );
    if (ok) {
      setDeleteTarget(null);
    }
  };

  if (loading) {
    return <div className="card">Đang tải Sale...</div>;
  }

  return (
    <div className="sales-page">
      <PageHeader
        title="Sales"
        description="Điều phối campaign, hàng Sale và stock reserve cho Telegram Bot."
        badge={<StatusPill tone={liveCampaigns.length ? "success" : "neutral"}>{liveCampaigns.length} đang chạy</StatusPill>}
        actions={
          <>
            <button className="button secondary" type="button" onClick={load} disabled={saving}>Tải lại</button>
            <button className="button secondary" type="button" onClick={openCreateCampaign}>
              Tạo campaign
            </button>
            <button className="button" type="button" onClick={openCreateItem}>
              Thêm món Sale
            </button>
          </>
        }
      />

      {error && <div className="alert danger">{error}</div>}
      {notice && <div className="alert success">{notice}</div>}

      <section className="sales-overview" aria-label="Tổng quan Sale">
        <div className="sales-overview-main">
          <div className="sales-kicker">Sale control</div>
          <h2>
            {liveCampaigns.length
              ? `${liveCampaigns.length} campaign đang chạy`
              : nextCampaign
                ? "Campaign kế tiếp đã lên lịch"
                : "Chưa có campaign đang chạy"}
          </h2>
          <p>
            {liveCampaigns[0]
              ? `${liveCampaigns[0].name} kết thúc ${formatDateTime(liveCampaigns[0].ends_at)}.`
              : nextCampaign
                ? `${nextCampaign.name} bắt đầu ${formatDateTime(nextCampaign.starts_at)}.`
                : "Tạo campaign, reserve stock, rồi bật món Sale khi sẵn sàng."}
          </p>
        </div>
        <div className="sales-kpi-strip">
          <div className="sales-kpi">
            <span>Campaign</span>
            <strong>{liveCampaigns.length}/{data.campaigns.length}</strong>
          </div>
          <div className="sales-kpi">
            <span>Món bật</span>
            <strong>{enabledItemCount}/{data.items.length}</strong>
          </div>
          <div className="sales-kpi">
            <span>Stock trống</span>
            <strong>{saleSummary.available}</strong>
          </div>
          <div className="sales-kpi">
            <span>Đã bán</span>
            <strong>{saleSummary.sold}</strong>
            <small>Giữ {saleSummary.held}</small>
          </div>
        </div>
      </section>

      <SectionCard title="Campaigns" actions={<span className="sales-section-meta">{activeCampaigns.length} khả dụng</span>} noPad>
        {data.campaigns.length ? (
          <DataTable>
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Trạng thái</th>
                <th>Lịch chạy</th>
                <th>Limit</th>
                <th>Notify</th>
                <th className="row-actions-cell">Hành động</th>
              </tr>
            </thead>
            <tbody>
              {data.campaigns.map((campaign) => (
                <tr key={campaign.id}>
                  <td>
                    <div className="sale-title">{campaign.name}</div>
                    <div className="sale-meta">ID #{campaign.id}</div>
                    {campaign.notes && <div className="muted cell-truncate">{campaign.notes}</div>}
                  </td>
                  <td><StatusPill tone={campaignStatusTone(campaign.status)}>{campaign.status}</StatusPill></td>
                  <td>
                    <div className="sale-date-line"><span>Bắt đầu</span><strong>{formatDateTime(campaign.starts_at)}</strong></div>
                    <div className="sale-date-line muted"><span>Kết thúc</span><strong>{formatDateTime(campaign.ends_at)}</strong></div>
                  </td>
                  <td>
                    <div className="sale-limit-pair">
                      <span>Tổng</span><strong>{campaign.total_quantity_limit ?? "-"}</strong>
                      <span>User</span><strong>{campaign.per_user_limit ?? "-"}</strong>
                    </div>
                  </td>
                  <td>
                    <div className="sale-chip-row">
                      <span className={`sale-chip ${campaign.notify_on_start ? "is-on" : ""}`}>Start</span>
                      <span className={`sale-chip ${campaign.notify_ending_soon ? "is-on" : ""}`}>Ending</span>
                    </div>
                  </td>
                  <td className="row-actions-cell">
                    <RowActionMenu items={[
                      {
                        label: "Chỉnh sửa",
                        disabled: saving,
                        onSelect: () => startEditCampaign(campaign)
                      },
                      {
                        label: "Active",
                        disabled: saving,
                        onSelect: () => runAction({ action: "set_campaign_status", campaignId: campaign.id, status: "active" }, "Đã active campaign.")
                      },
                      {
                        label: "Pause",
                        disabled: saving,
                        onSelect: () => runAction({ action: "set_campaign_status", campaignId: campaign.id, status: "paused" }, "Đã pause campaign.")
                      },
                      {
                        label: "End",
                        tone: "danger",
                        disabled: saving,
                        onSelect: () => runAction({ action: "set_campaign_status", campaignId: campaign.id, status: "ended" }, "Đã kết thúc campaign.")
                      },
                      {
                        label: "Xóa campaign",
                        tone: "danger",
                        disabled: saving,
                        onSelect: () => setDeleteTarget({ type: "campaign", campaign })
                      }
                    ]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        ) : (
          <EmptyState
            icon="SALE"
            title="Chưa có campaign Sale"
            description="Tạo campaign trước, sau đó thêm sản phẩm và reserve stock vào campaign."
          />
        )}
      </SectionCard>

      <SectionCard title="Món Sale" actions={<span className="sales-section-meta">{enabledItemCount} đang bật</span>} noPad>
        {data.items.length ? (
          <DataTable>
            <thead>
              <tr>
                <th>Món</th>
                <th>Campaign</th>
                <th>Giá</th>
                <th>Stock Sale</th>
                <th>Limit</th>
                <th>Trạng thái</th>
                <th className="row-actions-cell">Hành động</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className="sale-title">{item.sale_name || item.products?.name || `#${item.product_id}`}</div>
                    <div className="sale-meta">Gốc: {item.products?.name || `#${item.product_id}`}</div>
                    <div className="sale-meta">Emoji ID {item.telegram_icon_custom_emoji_id || DEFAULT_SALE_CUSTOM_EMOJI_ID}</div>
                  </td>
                  <td>
                    <div className="sale-title subtle">{campaignById.get(item.campaign_id)?.name || `#${item.campaign_id}`}</div>
                    <div className="sale-meta">Campaign #{item.campaign_id}</div>
                  </td>
                  <td>
                    <div className="sale-price">{formatMoney(item.sale_price_vnd)}</div>
                    <div className="sale-meta">Gốc {formatMoney(item.original_price_vnd)}</div>
                    {item.discount_percent !== null && (
                      <span className="sale-discount">-{Number(item.discount_percent).toLocaleString("vi-VN")}%</span>
                    )}
                  </td>
                  <td>
                    <div className="sale-stock-head">
                      <strong>{item.reservation_stats.available}</strong>
                      <span>trống</span>
                      <small>{itemSoldPercent(item)}% bán</small>
                    </div>
                    <div className="sale-stock-track" aria-hidden="true">
                      <span className="sale-stock-fill" style={{ width: `${itemSoldPercent(item)}%` }} />
                    </div>
                    <div className="sale-meta">Giữ {item.reservation_stats.held} / Bán {item.reservation_stats.sold}</div>
                  </td>
                  <td>
                    <div className="sale-limit-pair">
                      <span>Item</span><strong>{item.quantity_limit ?? "-"}</strong>
                      <span>User</span><strong>{item.per_user_limit ?? "-"}</strong>
                    </div>
                  </td>
                  <td>
                    <div className="sale-status-stack">
                      <StatusPill tone={item.is_enabled ? "success" : "neutral"}>{item.is_enabled ? "Đang bật" : "Đã tắt"}</StatusPill>
                      <StatusPill tone={item.stock_mode === "new_stock" ? "success" : "neutral"}>{item.stock_mode}</StatusPill>
                    </div>
                  </td>
                  <td className="row-actions-cell">
                    <RowActionMenu items={[
                      {
                        label: "Chỉnh sửa",
                        disabled: saving,
                        onSelect: () => startEditItem(item)
                      },
                      {
                        label: item.is_enabled ? "Tắt" : "Bật",
                        tone: item.is_enabled ? "warning" : undefined,
                        disabled: saving,
                        onSelect: () => runAction({ action: "set_item_enabled", saleItemId: item.id, enabled: !item.is_enabled }, item.is_enabled ? "Đã tắt món Sale." : "Đã bật món Sale.")
                      },
                      {
                        label: "Xóa món Sale",
                        tone: "danger",
                        disabled: saving,
                        onSelect: () => setDeleteTarget({ type: "item", item })
                      }
                    ]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        ) : (
          <EmptyState
            icon="SALE"
            title="Chưa có món Sale"
            description="Thêm món Sale từ sản phẩm có sẵn hoặc stock mới để Bot hiển thị trong mục Sale."
          />
        )}
      </SectionCard>

      {campaignModalOpen && (
        <div className="modal-backdrop" onClick={closeCampaignModal}>
          <div
            aria-labelledby="sale-campaign-modal-title"
            aria-modal="true"
            className="modal modal-wide sale-modal"
            role="dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sale-modal-head">
              <div>
                <div className="sales-kicker">Campaign</div>
                <h3 className="section-title" id="sale-campaign-modal-title">
                  {editingCampaign ? "Chỉnh sửa Campaign Sale" : "Tạo Campaign Sale"}
                </h3>
              </div>
              <StatusPill tone="warning">{campaignForm.status}</StatusPill>
            </div>
            <form
              className="form-grid sale-form-grid"
              onSubmit={(event) => {
                event.preventDefault();
                submitCampaign();
              }}
            >
              <label>
                Tên campaign
                <input value={campaignForm.name} onChange={(e) => setCampaignForm({ ...campaignForm, name: e.target.value })} />
              </label>
              <label>
                Trạng thái
                <select value={campaignForm.status} onChange={(e) => setCampaignForm({ ...campaignForm, status: e.target.value })}>
                  <option value="scheduled">Scheduled</option>
                  <option value="active">Active</option>
                  <option value="draft">Draft</option>
                  {editingCampaign && <option value="paused">Paused</option>}
                  {editingCampaign && <option value="ended">Ended</option>}
                  {editingCampaign && <option value="cancelled">Cancelled</option>}
                </select>
              </label>
              <label>
                Bắt đầu
                <input type="datetime-local" value={campaignForm.startsAt} onChange={(e) => setCampaignForm({ ...campaignForm, startsAt: e.target.value })} />
              </label>
              <label>
                Kết thúc
                <input type="datetime-local" value={campaignForm.endsAt} onChange={(e) => setCampaignForm({ ...campaignForm, endsAt: e.target.value })} />
              </label>
              <label>
                Giới hạn tổng
                <input value={campaignForm.totalQuantityLimit} onChange={(e) => setCampaignForm({ ...campaignForm, totalQuantityLimit: e.target.value })} placeholder="Tùy chọn" />
              </label>
              <label>
                Giới hạn mỗi user
                <input value={campaignForm.perUserLimit} onChange={(e) => setCampaignForm({ ...campaignForm, perUserLimit: e.target.value })} placeholder="Tùy chọn" />
              </label>
              <label className="sale-field-wide">
                Ghi chú nội bộ
                <textarea rows={3} value={campaignForm.notes} onChange={(e) => setCampaignForm({ ...campaignForm, notes: e.target.value })} />
              </label>
              <label className="sale-toggle">
                <input type="checkbox" checked={campaignForm.notifyOnStart} onChange={(e) => setCampaignForm({ ...campaignForm, notifyOnStart: e.target.checked })} />
                <span>Notify khi bắt đầu</span>
              </label>
              <label className="sale-toggle">
                <input type="checkbox" checked={campaignForm.notifyEndingSoon} onChange={(e) => setCampaignForm({ ...campaignForm, notifyEndingSoon: e.target.checked })} />
                <span>Notify sắp kết thúc</span>
              </label>
              <div className="modal-actions">
                <button className="button" type="submit" disabled={saving}>
                  {saving ? "Đang lưu..." : editingCampaign ? "Lưu campaign" : "Tạo campaign"}
                </button>
                <button className="button secondary" type="button" onClick={closeCampaignModal} disabled={saving}>Hủy</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {itemModalOpen && (
        <div className="modal-backdrop" onClick={closeItemModal}>
          <div
            aria-labelledby="sale-item-modal-title"
            aria-modal="true"
            className="modal modal-wide modal-scrollable sale-modal sale-item-modal"
            role="dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-scroll-region">
              <div className="section-head sale-item-head">
                <div>
                  <h3 className="section-title" id="sale-item-modal-title">
                    {editingItem ? "Chỉnh sửa món Sale" : "Thêm món Sale"}
                  </h3>
                  <p className="muted" style={{ marginTop: 8 }}>
                    {editingItem
                      ? "Chỉnh giá, giới hạn, mô tả và icon. Stock đã reserve không đổi trong chế độ sửa."
                      : "Reserve stock có sẵn hoặc thêm stock mới rồi đưa vào campaign ngay."}
                  </p>
                </div>
                <div className="segmented">
                  <button
                    className={`segmented-button ${stockMode === "existing" ? "active" : ""}`}
                    type="button"
                    disabled={Boolean(editingItem)}
                    onClick={() => setStockMode("existing")}
                  >
                    Stock có sẵn
                  </button>
                  <button
                    className={`segmented-button ${stockMode === "new" ? "active" : ""}`}
                    type="button"
                    disabled={Boolean(editingItem)}
                    onClick={() => {
                      setStockMode("new");
                      setItemForm((prev) => ({ ...prev, stockQuantity: String(countStockLines(prev.newStockText)) }));
                    }}
                  >
                    Stock mới
                  </button>
                </div>
              </div>
              <form
                className="form-grid sale-form-grid"
                onSubmit={(event) => {
                  event.preventDefault();
                  submitSaleItem();
                }}
              >
                <label>
                  Campaign
                  <select
                    value={itemForm.campaignId}
                    disabled={Boolean(editingItem)}
                    onChange={(e) => setItemForm({ ...itemForm, campaignId: e.target.value })}
                  >
                    {(editingItem ? data.campaigns : activeCampaigns).map((campaign) => (
                      <option key={campaign.id} value={campaign.id}>{campaign.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Sản phẩm gốc
                  <select
                    value={itemForm.productId}
                    disabled={Boolean(editingItem)}
                    onChange={(e) => setItemForm({ ...itemForm, productId: e.target.value })}
                  >
                    {data.products.map((product) => <option key={product.id} value={product.id}>{product.name} - {formatMoney(product.price)}</option>)}
                  </select>
                </label>
                <label>
                  Tên Sale
                  <input value={itemForm.saleName} onChange={(e) => setItemForm({ ...itemForm, saleName: e.target.value })} placeholder="Trống = dùng tên gốc" />
                </label>
                <label>
                  Giá Sale VNĐ
                  <input value={itemForm.salePriceVnd} onChange={(e) => setItemForm({ ...itemForm, salePriceVnd: e.target.value })} />
                </label>
                <label>
                  Giá Sale USDT
                  <input value={itemForm.salePriceUsdt} onChange={(e) => setItemForm({ ...itemForm, salePriceUsdt: e.target.value })} placeholder="Tùy chọn" />
                </label>
                <label>
                  Stock Sale
                  <input
                    value={stockMode === "new" ? String(newStockLineCount) : itemForm.stockQuantity}
                    onChange={(e) => setItemForm({ ...itemForm, stockQuantity: e.target.value })}
                    disabled={stockMode === "new" || Boolean(editingItem)}
                  />
                  <span className="sale-field-hint">
                    {editingItem
                      ? "Không đổi số stock đã reserve khi chỉnh sửa."
                      : stockMode === "new"
                      ? "Tự tính bằng số dòng stock mới bên dưới."
                      : "Số stock có sẵn sẽ được reserve vào Sale."}
                  </span>
                </label>
                <label>
                  Giới hạn item
                  <input value={itemForm.quantityLimit} onChange={(e) => setItemForm({ ...itemForm, quantityLimit: e.target.value })} placeholder="Mặc định = stock Sale" />
                </label>
                <label>
                  Giới hạn mỗi user
                  <input value={itemForm.perUserLimit} onChange={(e) => setItemForm({ ...itemForm, perUserLimit: e.target.value })} placeholder="Tùy chọn" />
                </label>
                <label>
                  Mua X
                  <input value={itemForm.promoBuyQuantity} onChange={(e) => setItemForm({ ...itemForm, promoBuyQuantity: e.target.value })} />
                </label>
                <label>
                  Tặng Y
                  <input value={itemForm.promoBonusQuantity} onChange={(e) => setItemForm({ ...itemForm, promoBonusQuantity: e.target.value })} />
                </label>
                <label>
                  Custom emoji ID
                  <input value={itemForm.telegramIconCustomEmojiId} onChange={(e) => setItemForm({ ...itemForm, telegramIconCustomEmojiId: e.target.value })} />
                </label>
                <label>
                  Vị trí
                  <input value={itemForm.sortPosition} onChange={(e) => setItemForm({ ...itemForm, sortPosition: e.target.value })} placeholder="Tùy chọn" />
                </label>
                <label className="sale-field-wide">
                  Mô tả Sale
                  <textarea rows={3} value={itemForm.saleDescription} onChange={(e) => setItemForm({ ...itemForm, saleDescription: e.target.value })} />
                </label>
                {stockMode === "new" && (
                  <label className="sale-field-wide">
                    Stock mới, mỗi dòng một item
                    <textarea rows={8} value={itemForm.newStockText} onChange={(e) => setItemForm({ ...itemForm, newStockText: e.target.value, stockQuantity: String(countStockLines(e.target.value)) })} />
                    <span className="sale-field-hint">{newStockLineCount} dòng hợp lệ sẽ được thêm và reserve.</span>
                  </label>
                )}
              </form>
            </div>
            <div className="modal-actions">
              <button className="button" type="button" disabled={saving || (!editingItem && !canSubmitSaleItem)} onClick={submitSaleItem}>
                {saving ? "Đang lưu..." : editingItem ? "Lưu món Sale" : "Thêm món Sale"}
              </button>
              <button className="button secondary" type="button" onClick={closeItemModal} disabled={saving}>Hủy</button>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={deleteTarget?.type === "campaign" ? "Xóa campaign Sale?" : "Xóa món Sale?"}
        description={
          deleteTarget?.type === "campaign"
            ? `Campaign "${deleteTarget.campaign.name}" và các món Sale trong campaign sẽ bị xóa khỏi Dashboard/Bot. Đơn cũ sẽ giữ lịch sử nhưng mất liên kết Sale.`
            : `Món "${deleteTarget?.item.sale_name || deleteTarget?.item.products?.name || "#" + String(deleteTarget?.item.product_id || "")}" sẽ bị xóa, các reservation liên quan được giải phóng theo cascade.`
        }
        confirmLabel="Xóa"
        busy={saving}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDeleteTarget}
      />
    </div>
  );
}
