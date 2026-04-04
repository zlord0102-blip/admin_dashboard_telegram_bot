"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAdminSession } from "@/components/AdminSessionContext";

interface PriceTier {
  min_quantity: number;
  unit_price: number;
}

interface PriceTierRow {
  id: string;
  minQuantity: string;
  unitPrice: string;
}

interface Product {
  id: number;
  name: string;
  website_name: string | null;
  website_price: number | null;
  website_sort_position: number | null;
  website_price_tiers: PriceTier[] | null;
  website_promo_buy_quantity: number | null;
  website_promo_bonus_quantity: number | null;
  website_banner_url: string | null;
  description: string | null;
  website_format_data: string | null;
  website_enabled: boolean;
  website_deleted: boolean;
  legacy_is_hidden: boolean;
  legacy_is_deleted: boolean;
}

interface FormatTemplate {
  id: number;
  name: string;
  pattern: string;
}

const createTierRow = (tier?: PriceTier): PriceTierRow => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  minQuantity: tier?.min_quantity ? String(tier.min_quantity) : "",
  unitPrice: tier?.unit_price ? String(tier.unit_price) : ""
});

const normalizeTierRows = (rows: PriceTierRow[]): PriceTier[] => {
  const byQuantity = new Map<number, number>();
  for (const row of rows) {
    const minQuantity = Number(row.minQuantity);
    const unitPrice = Number(row.unitPrice);
    if (!Number.isFinite(minQuantity) || !Number.isFinite(unitPrice)) continue;
    if (minQuantity < 1 || unitPrice < 1) continue;
    byQuantity.set(Math.trunc(minQuantity), Math.trunc(unitPrice));
  }
  return Array.from(byQuantity.entries())
    .map(([min_quantity, unit_price]) => ({ min_quantity, unit_price }))
    .sort((a, b) => a.min_quantity - b.min_quantity);
};

const parseTierRows = (tiers: PriceTier[] | null | undefined): PriceTierRow[] => {
  if (!tiers?.length) return [createTierRow()];
  return tiers
    .filter((tier) => Number(tier.min_quantity) > 0 && Number(tier.unit_price) > 0)
    .sort((a, b) => a.min_quantity - b.min_quantity)
    .map((tier) => createTierRow(tier));
};

const formatTierSummary = (tiers: PriceTier[] | null | undefined) => {
  if (!tiers?.length) return "Mặc định theo giá cơ bản.";
  return tiers
    .slice()
    .sort((a, b) => a.min_quantity - b.min_quantity)
    .map((tier) => `Từ ${tier.min_quantity}: ${tier.unit_price.toLocaleString("vi-VN")}đ`)
    .join(" | ");
};

const PRODUCT_BANNER_BUCKET = "admin-uploads";
const STORAGE_URI_PREFIX = "storage://";

const sanitizeFileSegment = (value: string) => {
  const normalized = String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "image";
};

const makeStorageUri = (bucket: string, objectPath: string) => `${STORAGE_URI_PREFIX}${bucket}/${objectPath}`;

const getWebsitePositionRank = (value: number | null | undefined) =>
  Number.isFinite(value) ? Number(value) : Number.POSITIVE_INFINITY;

const sortProductsByWebsitePosition = (rows: Product[]) =>
  rows
    .slice()
    .sort((a, b) => {
      const rankA = getWebsitePositionRank(a.website_sort_position);
      const rankB = getWebsitePositionRank(b.website_sort_position);
      if (rankA !== rankB) return rankA - rankB;
      return a.id - b.id;
    });

export default function ProductsPage() {
  const adminSession = useAdminSession();
  const [products, setProducts] = useState<Product[]>([]);
  const [formatTemplates, setFormatTemplates] = useState<FormatTemplate[]>([]);
  const [productError, setProductError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [position, setPosition] = useState("");
  const [description, setDescription] = useState("");
  const [bannerUrl, setBannerUrl] = useState("");
  const [bannerUploading, setBannerUploading] = useState(false);
  const [formatData, setFormatData] = useState("");
  const [priceTierRows, setPriceTierRows] = useState<PriceTierRow[]>([createTierRow()]);
  const [promoBuyQuantity, setPromoBuyQuantity] = useState("");
  const [promoBonusQuantity, setPromoBonusQuantity] = useState("");
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editName, setEditName] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editPosition, setEditPosition] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editBannerUrl, setEditBannerUrl] = useState("");
  const [editBannerUploading, setEditBannerUploading] = useState(false);
  const [editFormatData, setEditFormatData] = useState("");
  const [editPriceTierRows, setEditPriceTierRows] = useState<PriceTierRow[]>([createTierRow()]);
  const [editPromoBuyQuantity, setEditPromoBuyQuantity] = useState("");
  const [editPromoBonusQuantity, setEditPromoBonusQuantity] = useState("");
  const [deleteProduct, setDeleteProduct] = useState<Product | null>(null);
  const [productChannelMode, setProductChannelMode] = useState<"website" | "legacy">("website");
  const [templateName, setTemplateName] = useState("");
  const [templatePattern, setTemplatePattern] = useState("");
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [templateSaving, setTemplateSaving] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<FormatTemplate | null>(null);
  const [editTemplateName, setEditTemplateName] = useState("");
  const [editTemplatePattern, setEditTemplatePattern] = useState("");

  const load = async () => {
    const { data, error } = await supabase
      .from("products")
      .select(
        "id, name, website_name, website_price, website_sort_position, website_price_tiers, website_promo_buy_quantity, website_promo_bonus_quantity, website_banner_url, website_description, website_format_data, website_enabled, website_deleted"
      )
      .order("id");
    if (error) {
      const { data: fallbackData, error: fallbackError } = await supabase
        .from("products")
        .select("id, name, price, price_usdt, price_tiers, promo_buy_quantity, promo_bonus_quantity, description, format_data, is_hidden, is_deleted")
        .order("id");
      if (fallbackError) {
        setProductError(fallbackError.message);
        return;
      }
      setProductError("Thiếu cột website_* trong products. Hệ thống đang dùng chế độ tương thích bot (`is_hidden/is_deleted`). Hãy chạy SQL migration mới.");
      setProductChannelMode("legacy");
      const fallbackRows = ((fallbackData as any[]) || []).map((row) => ({
        id: Number(row.id),
        name: String(row.name || ""),
        website_name: String(row.name || ""),
        website_price: Number(row.price || 0),
        website_sort_position: null,
        website_price_tiers: (row.price_tiers as PriceTier[] | null) ?? null,
        website_promo_buy_quantity: Number(row.promo_buy_quantity || 0),
        website_promo_bonus_quantity: Number(row.promo_bonus_quantity || 0),
        website_banner_url: null,
        description: row.description ?? null,
        website_format_data: row.format_data ?? null,
        website_enabled: !Boolean(row.is_hidden),
        website_deleted: Boolean(row.is_deleted),
        legacy_is_hidden: Boolean(row.is_hidden),
        legacy_is_deleted: Boolean(row.is_deleted)
      }));
      setProducts(sortProductsByWebsitePosition(fallbackRows));
      return;
    }
    setProductError(null);
    setProductChannelMode("website");
    const mappedRows = ((data as any[]) || []).map((row) => ({
      id: Number(row.id),
      name: String(row.name || ""),
      website_name: row.website_name ?? null,
      website_price: Number(row.website_price || 0),
      website_sort_position: Number.isFinite(Number(row.website_sort_position))
        ? Number(row.website_sort_position)
        : null,
      website_price_tiers: (row.website_price_tiers as PriceTier[] | null) ?? null,
      website_promo_buy_quantity: Number(row.website_promo_buy_quantity || 0),
      website_promo_bonus_quantity: Number(row.website_promo_bonus_quantity || 0),
      website_banner_url: row.website_banner_url ?? null,
      description: row.website_description ?? null,
      website_format_data: row.website_format_data ?? null,
      website_enabled: row.website_enabled !== false,
      website_deleted: row.website_deleted === true,
      legacy_is_hidden: false,
      legacy_is_deleted: false
    }));
    setProducts(sortProductsByWebsitePosition(mappedRows));
  };

  const loadFormats = async () => {
    const { data, error } = await supabase
      .from("format_templates")
      .select("id, name, pattern")
      .order("id");
    if (error) {
      setTemplateError(error.message);
      return;
    }
    setFormatTemplates((data as FormatTemplate[]) || []);
  };

  useEffect(() => {
    load();
    loadFormats();
  }, []);

  const addTierRow = () => {
    setPriceTierRows((prev) => [...prev, createTierRow()]);
  };

  const removeTierRow = (id: string) => {
    setPriceTierRows((prev) => {
      const next = prev.filter((row) => row.id !== id);
      return next.length ? next : [createTierRow()];
    });
  };

  const updateTierRow = (id: string, field: "minQuantity" | "unitPrice", value: string) => {
    setPriceTierRows((prev) => prev.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
  };

  const addEditTierRow = () => {
    setEditPriceTierRows((prev) => [...prev, createTierRow()]);
  };

  const removeEditTierRow = (id: string) => {
    setEditPriceTierRows((prev) => {
      const next = prev.filter((row) => row.id !== id);
      return next.length ? next : [createTierRow()];
    });
  };

  const updateEditTierRow = (id: string, field: "minQuantity" | "unitPrice", value: string) => {
    setEditPriceTierRows((prev) => prev.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
  };

  const uploadProductBanner = async (file: File, productId?: number) => {
    const mimeType = String(file.type || "").toLowerCase();
    if (!mimeType.startsWith("image/")) {
      throw new Error("Chỉ hỗ trợ upload file ảnh (jpg/png/webp...).");
    }

    const fileExtension = sanitizeFileSegment(file.name.split(".").pop() || "png");
    const fileBase = sanitizeFileSegment(file.name.replace(/\.[^.]+$/, ""));
    const objectPath = [
      "website-products",
      String(productId || "new"),
      `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${fileBase}.${fileExtension}`
    ].join("/");

    const { error } = await supabase.storage.from(PRODUCT_BANNER_BUCKET).upload(objectPath, file, {
      upsert: false,
      contentType: file.type || "image/png",
      cacheControl: "3600"
    });
    if (error) {
      throw new Error(error.message);
    }
    return makeStorageUri(PRODUCT_BANNER_BUCKET, objectPath);
  };

  const handleBannerUpload = async (event: ChangeEvent<HTMLInputElement>, mode: "add" | "edit") => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      if (mode === "add") setBannerUploading(true);
      if (mode === "edit") setEditBannerUploading(true);

      const uploadedUri = await uploadProductBanner(file, mode === "edit" ? editingProduct?.id : undefined);
      if (mode === "add") setBannerUrl(uploadedUri);
      if (mode === "edit") setEditBannerUrl(uploadedUri);
      setProductError(null);
    } catch (error: any) {
      setProductError(error?.message || "Upload ảnh thất bại.");
    } finally {
      if (mode === "add") setBannerUploading(false);
      if (mode === "edit") setEditBannerUploading(false);
    }
  };

  const handleAdd = async (event: React.FormEvent) => {
    event.preventDefault();
    const tiers = normalizeTierRows(priceTierRows);
    const buyQty = Number(promoBuyQuantity || "0");
    const bonusQty = Number(promoBonusQuantity || "0");
    const parsedPrice = Number.parseInt(price || "0", 10);
    const parsedPosition = Number.parseInt(position || "", 10);
    const websitePrice = Number.isFinite(parsedPrice) ? Math.max(0, parsedPrice) : 0;
    const websiteSortPosition = Number.isFinite(parsedPosition) ? Math.trunc(parsedPosition) : null;
    const hasPromo = buyQty > 0 || bonusQty > 0;
    if (hasPromo && (!Number.isFinite(buyQty) || !Number.isFinite(bonusQty) || buyQty < 1 || bonusQty < 1)) {
      setProductError("Khuyến mãi cần đủ 2 giá trị hợp lệ: mua X và tặng Y đều phải lớn hơn 0.");
      return;
    }

    const websitePayload = {
      name,
      price: 0,
      price_usdt: 0,
      website_name: name || null,
      website_price: websitePrice,
      website_sort_position: websiteSortPosition,
      website_price_tiers: tiers.length ? tiers : null,
      website_promo_buy_quantity: hasPromo ? Math.trunc(buyQty) : 0,
      website_promo_bonus_quantity: hasPromo ? Math.trunc(bonusQty) : 0,
      website_banner_url: bannerUrl.trim() || null,
      website_description: description || null,
      website_format_data: formatData || null,
      website_enabled: true,
      website_deleted: false
    };
    const { error } = await supabase.from("products").insert(websitePayload);
    if (error) {
      setProductError(
        error.message.includes("website_")
          ? "Thiếu cột website_* trong products. Hãy chạy SQL migration mới cho Website Dashboard."
          : error.message
      );
      return;
    }
    setProductError(null);
    setName("");
    setPrice("");
    setPosition("");
    setDescription("");
    setBannerUrl("");
    setFormatData("");
    setPriceTierRows([createTierRow()]);
    setPromoBuyQuantity("");
    setPromoBonusQuantity("");
    await load();
  };

  const handleDeleteConfirm = async () => {
    if (!deleteProduct) return;
    const updatePayload =
      productChannelMode === "website"
        ? {
            website_deleted: true,
            website_enabled: false
          }
        : {
            is_deleted: true,
            is_hidden: true,
            deleted_at: new Date().toISOString()
          };
    const { error } = await supabase.from("products").update(updatePayload).eq("id", deleteProduct.id);
    if (error) {
      setProductError(
        error.message.includes("website_") || error.message.includes("is_deleted")
          ? "Thiếu cột website_deleted/website_enabled trong products. Hãy chạy SQL migration mới."
          : error.message
      );
      return;
    }
    setDeleteProduct(null);
    await load();
  };

  const handleToggleHidden = async (product: Product) => {
    if (product.website_deleted) return;
    const nextHidden =
      productChannelMode === "website" ? !product.website_enabled : !product.legacy_is_hidden;
    const updatePayload =
      productChannelMode === "website"
        ? { website_enabled: !product.website_enabled }
        : { is_hidden: nextHidden };
    const { error } = await supabase.from("products").update(updatePayload).eq("id", product.id);
    if (error) {
      setProductError(
        error.message.includes("website_enabled") || error.message.includes("is_hidden")
          ? "Thiếu cột website_enabled trong products. Hãy chạy SQL migration mới."
          : error.message
      );
      return;
    }
    await load();
  };

  const handleRestore = async (product: Product) => {
    const updatePayload =
      productChannelMode === "website"
        ? {
            website_deleted: false,
            website_enabled: true
          }
        : {
            is_deleted: false,
            is_hidden: false,
            deleted_at: null
          };
    const { error } = await supabase.from("products").update(updatePayload).eq("id", product.id);
    if (error) {
      setProductError(
        error.message.includes("website_") || error.message.includes("is_deleted")
          ? "Thiếu cột website_deleted/website_enabled trong products. Hãy chạy SQL migration mới."
          : error.message
      );
      return;
    }
    await load();
  };

  const startEdit = (product: Product) => {
    setEditingProduct(product);
    setEditName(product.website_name || product.name);
    setEditPrice((product.website_price ?? 0).toString());
    setEditPosition(
      Number.isFinite(product.website_sort_position) ? String(product.website_sort_position) : ""
    );
    setEditDescription(product.description ?? "");
    setEditBannerUrl(product.website_banner_url ?? "");
    setEditFormatData(product.website_format_data ?? "");
    setEditPriceTierRows(parseTierRows(product.website_price_tiers));
    setEditPromoBuyQuantity(product.website_promo_buy_quantity ? product.website_promo_buy_quantity.toString() : "");
    setEditPromoBonusQuantity(product.website_promo_bonus_quantity ? product.website_promo_bonus_quantity.toString() : "");
  };

  const cancelEdit = () => {
    setEditingProduct(null);
    setEditName("");
    setEditPrice("");
    setEditPosition("");
    setEditDescription("");
    setEditBannerUrl("");
    setEditBannerUploading(false);
    setEditFormatData("");
    setEditPriceTierRows([createTierRow()]);
    setEditPromoBuyQuantity("");
    setEditPromoBonusQuantity("");
  };

  const handleUpdate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingProduct) return;
    const tiers = normalizeTierRows(editPriceTierRows);
    const buyQty = Number(editPromoBuyQuantity || "0");
    const bonusQty = Number(editPromoBonusQuantity || "0");
    const parsedPrice = Number.parseInt(editPrice || "0", 10);
    const parsedPosition = Number.parseInt(editPosition || "", 10);
    const websitePrice = Number.isFinite(parsedPrice) ? Math.max(0, parsedPrice) : 0;
    const websiteSortPosition = Number.isFinite(parsedPosition) ? Math.trunc(parsedPosition) : null;
    const hasPromo = buyQty > 0 || bonusQty > 0;
    if (hasPromo && (!Number.isFinite(buyQty) || !Number.isFinite(bonusQty) || buyQty < 1 || bonusQty < 1)) {
      setProductError("Khuyến mãi cần đủ 2 giá trị hợp lệ: mua X và tặng Y đều phải lớn hơn 0.");
      return;
    }

    const websiteUpdatePayload = {
      website_name: editName || null,
      website_price: websitePrice,
      website_sort_position: websiteSortPosition,
      website_price_tiers: tiers.length ? tiers : null,
      website_promo_buy_quantity: hasPromo ? Math.trunc(buyQty) : 0,
      website_promo_bonus_quantity: hasPromo ? Math.trunc(bonusQty) : 0,
      website_banner_url: editBannerUrl.trim() || null,
      website_description: editDescription || null,
      website_format_data: editFormatData || null
    };
    const { error } = await supabase
      .from("products")
      .update(websiteUpdatePayload)
      .eq("id", editingProduct.id);
    if (error) {
      setProductError(
        error.message.includes("website_")
          ? "Thiếu cột website_* trong products. Hãy chạy SQL migration mới cho Website Dashboard."
          : error.message
      );
      return;
    }
    setProductError(null);
    cancelEdit();
    await load();
  };

  const handleAddTemplate = async (event: React.FormEvent) => {
    event.preventDefault();
    const nameValue = templateName.trim();
    const patternValue = templatePattern.trim();
    if (!nameValue || !patternValue) return;
    setTemplateError(null);
    setTemplateSaving(true);
    const { error } = await supabase.from("format_templates").insert({
      name: nameValue,
      pattern: patternValue
    });
    setTemplateSaving(false);
    if (error) {
      setTemplateError(error.message);
      return;
    }
    setTemplateName("");
    setTemplatePattern("");
    await loadFormats();
  };

  const handleDeleteTemplate = async (templateId: number) => {
    setTemplateError(null);
    const { error } = await supabase.from("format_templates").delete().eq("id", templateId);
    if (error) {
      setTemplateError(error.message);
      return;
    }
    await loadFormats();
  };

  const startEditTemplate = (template: FormatTemplate) => {
    setEditingTemplate(template);
    setEditTemplateName(template.name);
    setEditTemplatePattern(template.pattern);
  };

  const cancelEditTemplate = () => {
    setEditingTemplate(null);
    setEditTemplateName("");
    setEditTemplatePattern("");
  };

  const handleUpdateTemplate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingTemplate) return;
    const nameValue = editTemplateName.trim();
    const patternValue = editTemplatePattern.trim();
    if (!nameValue || !patternValue) return;
    setTemplateError(null);
    setTemplateSaving(true);
    const { error } = await supabase
      .from("format_templates")
      .update({ name: nameValue, pattern: patternValue })
      .eq("id", editingTemplate.id);
    setTemplateSaving(false);
    if (error) {
      setTemplateError(error.message);
      return;
    }
    cancelEditTemplate();
    await loadFormats();
  };

  return (
    <div className="grid" style={{ gap: 24 }}>
      <div className="topbar">
        <div>
          <h1 className="page-title">Website Products</h1>
          <p className="muted">Website dùng bộ dữ liệu Product riêng (tên, vị trí, giá, tier, khuyến mãi, format, hiển thị). Chỉ Stock được đồng bộ với Bot Telegram.</p>
          {productChannelMode === "legacy" && (
            <p className="muted" style={{ marginTop: 6 }}>
              Đang chạy chế độ tương thích tạm (`is_hidden/is_deleted`). Để tách Website/Bot hoàn toàn, chạy SQL: <code>supabase_schema_website_product_channel_split.sql</code>
            </p>
          )}
        </div>
      </div>

      <div className="card">
        <h3 className="section-title">Thêm sản phẩm mới</h3>
        <form className="form-grid" onSubmit={handleAdd}>
          <input className="input" placeholder="Tên Website" value={name} onChange={(e) => setName(e.target.value)} required />
          <input className="input" placeholder="Giá Website (VND)" value={price} onChange={(e) => setPrice(e.target.value)} required />
          <input className="input" placeholder="Vị trí Website (số, nhỏ hơn lên trước)" value={position} onChange={(e) => setPosition(e.target.value)} />
          <div className="form-section">
            <p className="muted" style={{ marginBottom: 6 }}>
              Banner Hàng hóa (Website)
            </p>
            <input
              className="input"
              placeholder="URL ảnh hoặc storage://admin-uploads/..."
              value={bannerUrl}
              onChange={(e) => setBannerUrl(e.target.value)}
            />
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
              <input
                className="input"
                style={{ maxWidth: 360 }}
                type="file"
                accept="image/*"
                onChange={(event) => handleBannerUpload(event, "add")}
                disabled={bannerUploading}
              />
              <span className="muted">{bannerUploading ? "Đang upload ảnh..." : "Upload ảnh để tự điền URL banner"}</span>
            </div>
          </div>
          <input
            className="input"
            placeholder="Mô tả Website (hiển thị riêng cho Website)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <select
            className="select"
            value=""
            onChange={(e) => setFormatData(e.target.value)}
          >
            <option value="">Chọn format mẫu (tự điền vào Format data)</option>
            {formatTemplates.map((format) => (
              <option key={format.id} value={format.pattern}>
                {format.name} | {format.pattern}
              </option>
            ))}
          </select>
          <input
            className="input"
            placeholder="Format data (VD: Mail,Pass,Token)"
            value={formatData}
            onChange={(e) => setFormatData(e.target.value)}
          />
          <div className="form-section pricing-box">
            <div className="pricing-head">
              <h4>Giá theo số lượng (VND)</h4>
              <button className="button secondary" type="button" onClick={addTierRow}>+ Thêm mức</button>
            </div>
            <p className="muted">Nhập mốc số lượng và đơn giá mỗi account. Hệ thống tự lấy mốc cao nhất phù hợp.</p>
            <div className="tier-list">
              {priceTierRows.map((row) => (
                <div className="tier-row" key={row.id}>
                  <input
                    className="input"
                    placeholder="Từ số lượng (VD: 10)"
                    value={row.minQuantity}
                    onChange={(event) => updateTierRow(row.id, "minQuantity", event.target.value)}
                  />
                  <input
                    className="input"
                    placeholder="Đơn giá VND (VD: 15000)"
                    value={row.unitPrice}
                    onChange={(event) => updateTierRow(row.id, "unitPrice", event.target.value)}
                  />
                  <button className="button secondary" type="button" onClick={() => removeTierRow(row.id)}>Xóa</button>
                </div>
              ))}
            </div>
          </div>
          <div className="form-section promo-row">
            <input
              className="input"
              placeholder="Khuyến mãi: mua X (VD: 10)"
              value={promoBuyQuantity}
              onChange={(event) => setPromoBuyQuantity(event.target.value)}
            />
            <input
              className="input"
              placeholder="Khuyến mãi: tặng Y (VD: 1)"
              value={promoBonusQuantity}
              onChange={(event) => setPromoBonusQuantity(event.target.value)}
            />
          </div>
          <button className="button" type="submit">Thêm</button>
        </form>
        {productError && (
          <p className="muted" style={{ marginTop: 8 }}>
            Lỗi: {productError}
          </p>
        )}
      </div>

      <div className="card">
        <h3 className="section-title">Danh sách sản phẩm</h3>
        <table className="table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Tên Website</th>
              <th>Vị trí Website</th>
              <th>Giá Website (VND)</th>
              <th>Giá theo SL Website</th>
              <th>Khuyến mãi Website</th>
              <th>Trạng thái</th>
              <th>Banner Website</th>
              <th>Mô tả Website</th>
              <th>Format data</th>
              <th>Hành động</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id}>
                <td>#{product.id}</td>
                <td>{product.website_name || product.name}</td>
                <td>{Number.isFinite(product.website_sort_position) ? product.website_sort_position : "-"}</td>
                <td>{(product.website_price || 0).toLocaleString()}</td>
                <td>{formatTierSummary(product.website_price_tiers)}</td>
                <td>
                  {(product.website_promo_buy_quantity || 0) > 0 && (product.website_promo_bonus_quantity || 0) > 0
                    ? `Mua ${product.website_promo_buy_quantity} tặng ${product.website_promo_bonus_quantity}`
                    : "Không"}
                </td>
                <td>
                  {product.website_deleted
                    ? "Đã xóa mềm"
                    : product.website_enabled
                    ? "Đang hiển thị"
                    : "Đang ẩn"}
                </td>
                <td>
                  {product.website_banner_url ? (
                    <span className="muted" style={{ fontSize: 12, wordBreak: "break-all" }}>
                      {product.website_banner_url}
                    </span>
                  ) : (
                    <span className="muted">Chưa có</span>
                  )}
                </td>
                <td>{product.description ?? ""}</td>
                <td>{product.website_format_data ?? ""}</td>
                <td className="product-actions-cell">
                  <div className="product-row-actions">
                    <button className="button secondary action-pill" onClick={() => startEdit(product)}>
                      Chỉnh sửa
                    </button>
                    {product.website_deleted ? (
                      <button
                        className="button warning action-pill"
                        onClick={() => handleRestore(product)}
                      >
                        Khôi phục
                      </button>
                    ) : (
                      <>
                        <button
                          className="button warning action-pill"
                          onClick={() => handleToggleHidden(product)}
                        >
                          {product.website_enabled ? "Ẩn" : "Bỏ ẩn"}
                        </button>
                        <button
                          className="button danger action-pill"
                          onClick={() => setDeleteProduct(product)}
                        >
                          Xóa mềm
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!products.length && (
              <tr>
                <td colSpan={11} className="muted">Chưa có sản phẩm.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

              {adminSession?.role === "superadmin" && (
        <div className="card">
          <h3 className="section-title">Format templates</h3>
          <form className="form-grid" onSubmit={handleAddTemplate}>
            <input
              className="input"
              placeholder="Tên format (VD: Adobe)"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              required
            />
            <input
              className="input"
              placeholder="Format data (VD: Mail,Pass,Token)"
              value={templatePattern}
              onChange={(e) => setTemplatePattern(e.target.value)}
              required
            />
            <button className="button" type="submit" disabled={templateSaving}>
              {templateSaving ? "Đang thêm..." : "Thêm format"}
            </button>
          </form>
          {templateError && (
            <p className="muted" style={{ marginTop: 8 }}>
              Lỗi: {templateError}
            </p>
          )}
          <table className="table" style={{ marginTop: 16 }}>
            <thead>
              <tr>
                <th>ID</th>
                <th>Tên</th>
                <th>Pattern</th>
                <th>Hành động</th>
              </tr>
            </thead>
            <tbody>
              {formatTemplates.map((format) => (
                <tr key={format.id}>
                  <td>#{format.id}</td>
                  <td>{format.name}</td>
                  <td>{format.pattern}</td>
                  <td>
                    <button className="button secondary" onClick={() => startEditTemplate(format)}>Chỉnh sửa</button>
                    <button className="button danger" onClick={() => handleDeleteTemplate(format.id)}>Xóa</button>
                  </td>
                </tr>
              ))}
              {!formatTemplates.length && (
                <tr>
                  <td colSpan={4} className="muted">Chưa có format nào.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {editingProduct && (
        <div className="modal-backdrop" onClick={cancelEdit}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h3 className="section-title">Chỉnh sửa sản phẩm #{editingProduct.id}</h3>
            <form className="form-grid" onSubmit={handleUpdate}>
              <input className="input" placeholder="Tên Website" value={editName} onChange={(e) => setEditName(e.target.value)} required />
              <input className="input" placeholder="Giá Website (VND)" value={editPrice} onChange={(e) => setEditPrice(e.target.value)} required />
              <input className="input" placeholder="Vị trí Website (số, nhỏ hơn lên trước)" value={editPosition} onChange={(e) => setEditPosition(e.target.value)} />
              <div className="form-section">
                <p className="muted" style={{ marginBottom: 6 }}>
                  Banner Hàng hóa (Website)
                </p>
                <input
                  className="input"
                  placeholder="URL ảnh hoặc storage://admin-uploads/..."
                  value={editBannerUrl}
                  onChange={(e) => setEditBannerUrl(e.target.value)}
                />
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
                  <input
                    className="input"
                    style={{ maxWidth: 360 }}
                    type="file"
                    accept="image/*"
                    onChange={(event) => handleBannerUpload(event, "edit")}
                    disabled={editBannerUploading}
                  />
                  <span className="muted">{editBannerUploading ? "Đang upload ảnh..." : "Upload ảnh để tự điền URL banner"}</span>
                </div>
              </div>
              <textarea
                className="textarea form-section"
                placeholder="Mô tả Website (hiển thị riêng cho Website)"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
              />
              <select
                className="select"
                value=""
                onChange={(e) => setEditFormatData(e.target.value)}
              >
                <option value="">Chọn format mẫu (tự điền vào Format data)</option>
                {formatTemplates.map((format) => (
                  <option key={format.id} value={format.pattern}>
                    {format.name} | {format.pattern}
                  </option>
                ))}
              </select>
              <input
                className="input"
                placeholder="Format data (VD: Mail,Pass,Token)"
                value={editFormatData}
                onChange={(e) => setEditFormatData(e.target.value)}
              />
              <div className="form-section pricing-box">
                <div className="pricing-head">
                  <h4>Giá theo số lượng (VND)</h4>
                  <button className="button secondary" type="button" onClick={addEditTierRow}>+ Thêm mức</button>
                </div>
                <p className="muted">Giá mốc này sẽ ghi đè giá mặc định khi khách mua đạt ngưỡng số lượng.</p>
                <div className="tier-list">
                  {editPriceTierRows.map((row) => (
                    <div className="tier-row" key={row.id}>
                      <input
                        className="input"
                        placeholder="Từ số lượng"
                        value={row.minQuantity}
                        onChange={(event) => updateEditTierRow(row.id, "minQuantity", event.target.value)}
                      />
                      <input
                        className="input"
                        placeholder="Đơn giá VND"
                        value={row.unitPrice}
                        onChange={(event) => updateEditTierRow(row.id, "unitPrice", event.target.value)}
                      />
                      <button className="button secondary" type="button" onClick={() => removeEditTierRow(row.id)}>Xóa</button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="form-section promo-row">
                <input
                  className="input"
                  placeholder="Khuyến mãi: mua X"
                  value={editPromoBuyQuantity}
                  onChange={(event) => setEditPromoBuyQuantity(event.target.value)}
                />
                <input
                  className="input"
                  placeholder="Khuyến mãi: tặng Y"
                  value={editPromoBonusQuantity}
                  onChange={(event) => setEditPromoBonusQuantity(event.target.value)}
                />
              </div>
              {productError && (
                <p className="muted form-section" style={{ marginTop: 0 }}>
                  Lỗi: {productError}
                </p>
              )}
              <div className="modal-actions">
                <button className="button" type="submit">Lưu</button>
                <button className="button secondary" type="button" onClick={cancelEdit}>Hủy</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editingTemplate && (
        <div className="modal-backdrop" onClick={cancelEditTemplate}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h3 className="section-title">Chỉnh sửa format #{editingTemplate.id}</h3>
            <form className="form-grid" onSubmit={handleUpdateTemplate}>
              <input
                className="input"
                placeholder="Tên format (VD: Adobe)"
                value={editTemplateName}
                onChange={(e) => setEditTemplateName(e.target.value)}
                required
              />
              <input
                className="input"
                placeholder="Format data (VD: Mail,Pass,Token)"
                value={editTemplatePattern}
                onChange={(e) => setEditTemplatePattern(e.target.value)}
                required
              />
              <div className="modal-actions">
                <button className="button" type="submit" disabled={templateSaving}>
                  {templateSaving ? "Đang lưu..." : "Lưu"}
                </button>
                <button className="button secondary" type="button" onClick={cancelEditTemplate}>
                  Hủy
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteProduct && (
        <div className="modal-backdrop" onClick={() => setDeleteProduct(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h3 className="section-title">Xóa mềm sản phẩm #{deleteProduct.id}</h3>
            <p className="muted" style={{ marginTop: 8 }}>
              Sản phẩm sẽ bị ẩn khỏi danh sách bán nhưng vẫn giữ toàn bộ Orders liên quan. Xác nhận xóa mềm <strong>{deleteProduct.website_name || deleteProduct.name}</strong>?
            </p>
            <div className="modal-actions">
              <button className="button danger" type="button" onClick={handleDeleteConfirm}>Xóa mềm</button>
              <button className="button secondary" type="button" onClick={() => setDeleteProduct(null)}>Hủy</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
