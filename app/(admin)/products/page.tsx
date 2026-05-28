"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabaseClient";
import { adminApiRequest } from "@/lib/adminOpsClient";
import { useAdminSession } from "@/components/AdminSessionContext";
import { PaginationControls, RowActionMenu } from "@/components/AdminUi";

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
  sort_position: number | null;
  bot_folder_id: number | null;
  telegram_icon: string | null;
  telegram_icon_custom_emoji_id: string | null;
  name: string;
  price: number;
  price_usdt: number;
  price_tiers: PriceTier[] | null;
  promo_buy_quantity: number | null;
  promo_bonus_quantity: number | null;
  description: string | null;
  format_data: string | null;
  is_hidden: boolean;
  is_deleted: boolean;
}

interface FormatTemplate {
  id: number;
  name: string;
  pattern: string;
}

interface BotFolder {
  id: number;
  name: string;
  sort_position: number | null;
}

type ProductListTab = "visible" | "hidden" | "deleted";
type ProductListCounts = Record<ProductListTab, number>;
type ProductFolderCountRow = { bot_folder_id: number | null; is_deleted: boolean };
type ProductListMetadataRow = ProductFolderCountRow & { is_hidden: boolean };

const PRODUCT_SELECT_COLUMNS =
  "id, sort_position, bot_folder_id, telegram_icon, telegram_icon_custom_emoji_id, name, price, price_usdt, price_tiers, promo_buy_quantity, promo_bonus_quantity, description, format_data, is_hidden, is_deleted";

const applyProductTabFilter = (query: any, tab: ProductListTab) => {
  if (tab === "deleted") return query.eq("is_deleted", true);
  if (tab === "hidden") return query.eq("is_deleted", false).eq("is_hidden", true);
  return query.eq("is_deleted", false).eq("is_hidden", false);
};

const parseSortPosition = (value: string): { valid: boolean; value: number | null } => {
  const normalized = value.trim();
  if (!normalized) return { valid: true, value: null };
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric)) return { valid: false, value: null };
  const parsed = Math.trunc(numeric);
  if (parsed < 0) return { valid: false, value: null };
  return { valid: true, value: parsed };
};

const sortProductsByPosition = (items: Product[]) =>
  items
    .slice()
    .sort((a, b) => {
      const aPos = a.sort_position;
      const bPos = b.sort_position;
      if (aPos === null && bPos === null) return a.id - b.id;
      if (aPos === null) return 1;
      if (bPos === null) return -1;
      if (aPos !== bPos) return aPos - bPos;
      return a.id - b.id;
    });

const sortFoldersByPosition = (items: BotFolder[]) =>
  items
    .slice()
    .sort((a, b) => {
      const aPos = a.sort_position;
      const bPos = b.sort_position;
      if (aPos === null && bPos === null) return a.id - b.id;
      if (aPos === null) return 1;
      if (bPos === null) return -1;
      if (aPos !== bPos) return aPos - bPos;
      return a.id - b.id;
    });

const parseOptionalFolderId = (value: string): number | null => {
  const normalized = value.trim();
  if (!normalized) return null;
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric)) return null;
  const parsed = Math.trunc(numeric);
  if (parsed < 1) return null;
  return parsed;
};

const normalizeTelegramIcon = (value: string): string | null => {
  const normalized = value.replace(/\s+/g, " ").trim().slice(0, 16);
  return normalized || null;
};

const normalizeTelegramCustomEmojiId = (value: string): string | null => {
  const normalized = value.replace(/\D/g, "").slice(0, 64);
  return normalized || null;
};

const shortenCustomEmojiId = (value: string | null): string => {
  if (!value) return "-";
  if (value.length <= 14) return value;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
};

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

export default function ProductsPage() {
  const adminSession = useAdminSession();
  const renderModal = (content: JSX.Element) =>
    typeof document === "undefined" ? null : createPortal(content, document.body);
  const [products, setProducts] = useState<Product[]>([]);
  const [productLoading, setProductLoading] = useState(false);
  const [productPage, setProductPage] = useState(1);
  const [productPageSize, setProductPageSize] = useState(20);
  const [productTotalCount, setProductTotalCount] = useState(0);
  const [productTotalPages, setProductTotalPages] = useState(1);
  const [productListCounts, setProductListCounts] = useState<ProductListCounts>({
    visible: 0,
    hidden: 0,
    deleted: 0
  });
  const [productFolderCountRows, setProductFolderCountRows] = useState<ProductFolderCountRow[]>([]);
  const [folders, setFolders] = useState<BotFolder[]>([]);
  const [productListTab, setProductListTab] = useState<ProductListTab>("visible");
  const [createProductOpen, setCreateProductOpen] = useState(false);
  const [folderCreateOpen, setFolderCreateOpen] = useState(false);
  const [templateCreateOpen, setTemplateCreateOpen] = useState(false);
  const [formatTemplates, setFormatTemplates] = useState<FormatTemplate[]>([]);
  const [productError, setProductError] = useState<string | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [folderName, setFolderName] = useState("");
  const [folderSortPosition, setFolderSortPosition] = useState("");
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [priceUsdt, setPriceUsdt] = useState("");
  const [sortPosition, setSortPosition] = useState("");
  const [botFolderId, setBotFolderId] = useState("");
  const [telegramIcon, setTelegramIcon] = useState("");
  const [telegramIconCustomEmojiId, setTelegramIconCustomEmojiId] = useState("");
  const [description, setDescription] = useState("");
  const [formatData, setFormatData] = useState("");
  const [priceTierRows, setPriceTierRows] = useState<PriceTierRow[]>([createTierRow()]);
  const [promoBuyQuantity, setPromoBuyQuantity] = useState("");
  const [promoBonusQuantity, setPromoBonusQuantity] = useState("");
  const [editingFolder, setEditingFolder] = useState<BotFolder | null>(null);
  const [editFolderName, setEditFolderName] = useState("");
  const [editFolderSortPosition, setEditFolderSortPosition] = useState("");
  const [deleteFolder, setDeleteFolder] = useState<BotFolder | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editName, setEditName] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editPriceUsdt, setEditPriceUsdt] = useState("");
  const [editSortPosition, setEditSortPosition] = useState("");
  const [editBotFolderId, setEditBotFolderId] = useState("");
  const [editTelegramIcon, setEditTelegramIcon] = useState("");
  const [editTelegramIconCustomEmojiId, setEditTelegramIconCustomEmojiId] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editFormatData, setEditFormatData] = useState("");
  const [editPriceTierRows, setEditPriceTierRows] = useState<PriceTierRow[]>([createTierRow()]);
  const [editPromoBuyQuantity, setEditPromoBuyQuantity] = useState("");
  const [editPromoBonusQuantity, setEditPromoBonusQuantity] = useState("");
  const [deleteProduct, setDeleteProduct] = useState<Product | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [templatePattern, setTemplatePattern] = useState("");
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [templateSaving, setTemplateSaving] = useState(false);
  const [productSaving, setProductSaving] = useState(false);
  const [folderSaving, setFolderSaving] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<FormatTemplate | null>(null);
  const [editTemplateName, setEditTemplateName] = useState("");
  const [editTemplatePattern, setEditTemplatePattern] = useState("");

  const load = async (
    pageIndex = productPage,
    nextPageSize = productPageSize,
    tab = productListTab
  ) => {
    setProductLoading(true);
    const from = (pageIndex - 1) * nextPageSize;
    const to = from + nextPageSize - 1;
    const baseQuery = supabase
      .from("products")
      .select(PRODUCT_SELECT_COLUMNS, { count: "exact" });
    const { data, error, count } = await applyProductTabFilter(baseQuery, tab)
      .order("sort_position", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true })
      .range(from, to);
    if (error) {
      const withoutCustomEmojiFallback = await supabase
        .from("products")
        .select("id, sort_position, bot_folder_id, telegram_icon, name, price, price_usdt, price_tiers, promo_buy_quantity, promo_bonus_quantity, description, format_data, is_hidden, is_deleted")
        .order("id");
      if (!withoutCustomEmojiFallback.error) {
        setProductError("Thiếu cột telegram_icon_custom_emoji_id trong products. Hãy chạy lại supabase_schema_all_in_one.sql để bật Telegram custom emoji icon.");
        setProducts(
          ((withoutCustomEmojiFallback.data as Product[]) || []).map((row) => ({
            ...row,
            sort_position: row.sort_position !== null && row.sort_position !== undefined ? Number(row.sort_position) : null,
            bot_folder_id: row.bot_folder_id !== null && row.bot_folder_id !== undefined ? Number(row.bot_folder_id) : null,
            telegram_icon: row.telegram_icon ?? null,
            telegram_icon_custom_emoji_id: null,
            is_hidden: Boolean((row as any).is_hidden),
            is_deleted: Boolean((row as any).is_deleted)
          }))
        );
        setProductTotalCount(withoutCustomEmojiFallback.data?.length ?? 0);
        setProductTotalPages(1);
        setProductLoading(false);
        return;
      }

      const withFolderFallback = await supabase
        .from("products")
        .select("id, sort_position, name, price, price_usdt, price_tiers, promo_buy_quantity, promo_bonus_quantity, description, format_data, is_hidden, is_deleted")
        .order("id");
      if (!withFolderFallback.error) {
        setProductError("Thiếu cột bot_folder_id trong products. Hãy chạy SQL migration folder sản phẩm mới.");
        setProducts(
          ((withFolderFallback.data as Product[]) || []).map((row) => ({
            ...row,
            sort_position: row.sort_position !== null && row.sort_position !== undefined ? Number(row.sort_position) : null,
            bot_folder_id: null,
            telegram_icon: null,
            telegram_icon_custom_emoji_id: null,
            is_hidden: Boolean((row as any).is_hidden),
            is_deleted: Boolean((row as any).is_deleted)
          }))
        );
        setProductTotalCount(withFolderFallback.data?.length ?? 0);
        setProductTotalPages(1);
        setProductLoading(false);
        return;
      }

      const withHiddenFallback = await supabase
        .from("products")
        .select("id, name, price, price_usdt, price_tiers, promo_buy_quantity, promo_bonus_quantity, description, format_data, is_hidden, is_deleted")
        .order("id");
      if (!withHiddenFallback.error) {
        setProductError("Thiếu cột sort_position trong products. Hãy chạy SQL migration position mới.");
        setProducts(
          ((withHiddenFallback.data as Product[]) || []).map((row) => ({
            ...row,
            sort_position: null,
            bot_folder_id: null,
            telegram_icon: null,
            telegram_icon_custom_emoji_id: null,
            is_hidden: Boolean((row as any).is_hidden),
            is_deleted: Boolean((row as any).is_deleted)
          }))
        );
        setProductTotalCount(withHiddenFallback.data?.length ?? 0);
        setProductTotalPages(1);
        setProductLoading(false);
        return;
      }

      const fallback = await supabase
        .from("products")
        .select("id, name, price, price_usdt, price_tiers, promo_buy_quantity, promo_bonus_quantity, description, format_data")
        .order("id");
      if (fallback.error) {
        setProductError(error.message);
        return;
      }
      setProductError("Thiếu cột is_hidden/is_deleted. Hãy chạy SQL migration soft-delete mới.");
      setProducts(
        ((fallback.data as Product[]) || []).map((row) => ({
          ...row,
          sort_position: null,
          bot_folder_id: null,
          telegram_icon: null,
          telegram_icon_custom_emoji_id: null,
          is_hidden: false,
          is_deleted: false
        }))
      );
      setProductTotalCount(fallback.data?.length ?? 0);
      setProductTotalPages(1);
      setProductLoading(false);
      return;
    }
    setProductError(null);
    const nextTotalCount = count ?? data?.length ?? 0;
    const nextTotalPages = Math.max(1, Math.ceil(nextTotalCount / nextPageSize));
    setProducts(
      ((data as Product[]) || []).map((row) => ({
        ...row,
        sort_position: row.sort_position !== null && row.sort_position !== undefined ? Number(row.sort_position) : null,
        bot_folder_id: row.bot_folder_id !== null && row.bot_folder_id !== undefined ? Number(row.bot_folder_id) : null,
        telegram_icon: row.telegram_icon ?? null,
        telegram_icon_custom_emoji_id: row.telegram_icon_custom_emoji_id ?? null,
        is_hidden: Boolean((row as any).is_hidden),
        is_deleted: Boolean((row as any).is_deleted)
      }))
    );
    setProductTotalCount(nextTotalCount);
    setProductTotalPages(nextTotalPages);
    if (pageIndex > nextTotalPages) {
      setProductPage(nextTotalPages);
    }
    setProductLoading(false);
  };

  const countProductsByTab = async (tab: ProductListTab) => {
    const query = supabase.from("products").select("id", { count: "exact", head: true });
    const { count, error } = await applyProductTabFilter(query, tab);
    if (error) throw error;
    return count ?? 0;
  };

  const loadProductCounts = async () => {
    const [visible, hidden, deleted] = await Promise.all([
      countProductsByTab("visible"),
      countProductsByTab("hidden"),
      countProductsByTab("deleted")
    ]);
    setProductListCounts({ visible, hidden, deleted });
  };

  const loadProductListMetadata = async () => {
    const { data, error } = await supabase
      .from("products")
      .select("bot_folder_id, is_hidden, is_deleted");
    if (error) {
      await loadProductCounts().catch(() => undefined);
      setProductFolderCountRows([]);
      return;
    }

    const rows: ProductListMetadataRow[] = ((data as Array<Record<string, unknown>>) || []).map((row) => ({
      bot_folder_id: row.bot_folder_id !== null && row.bot_folder_id !== undefined ? Number(row.bot_folder_id) : null,
      is_hidden: Boolean((row as any).is_hidden),
      is_deleted: Boolean((row as any).is_deleted)
    }));

    setProductListCounts({
      visible: rows.filter((row) => !row.is_hidden && !row.is_deleted).length,
      hidden: rows.filter((row) => row.is_hidden && !row.is_deleted).length,
      deleted: rows.filter((row) => row.is_deleted).length
    });
    setProductFolderCountRows(rows.filter((row) => !row.is_deleted));
  };

  const loadFolders = async () => {
    const { data, error } = await supabase
      .from("bot_product_folders")
      .select("id, name, sort_position")
      .order("id");
    if (error) {
      setFolderError(
        error.message.includes("bot_product_folders")
          ? "Thiếu bảng bot_product_folders. Hãy chạy SQL migration folder sản phẩm mới."
          : error.message
      );
      setFolders([]);
      return;
    }

    setFolderError(null);
    setFolders(
      sortFoldersByPosition(
        ((data as BotFolder[]) || []).map((row) => ({
          ...row,
          sort_position: row.sort_position !== null && row.sort_position !== undefined ? Number(row.sort_position) : null
        }))
      )
    );
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
    loadFolders();
    loadFormats();
  }, []);

  useEffect(() => {
    load(productPage, productPageSize, productListTab).catch((error) => {
      setProductError(error instanceof Error ? error.message : "Không thể tải danh sách sản phẩm.");
      setProducts([]);
      setProductTotalCount(0);
      setProductTotalPages(1);
      setProductLoading(false);
    });
  }, [productPage, productPageSize, productListTab]);

  useEffect(() => {
    loadProductListMetadata().catch(() => undefined);
  }, []);

  const listedProducts = useMemo(() => sortProductsByPosition(products), [products]);

  const folderOptions = useMemo(() => sortFoldersByPosition(folders), [folders]);
  const folderNameById = useMemo(() => {
    const entries = folderOptions.map((folder) => [folder.id, folder.name] as const);
    return new Map<number, string>(entries);
  }, [folderOptions]);
  const folderProductCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const product of productFolderCountRows) {
      if (product.is_deleted) continue;
      if (product.bot_folder_id === null || product.bot_folder_id === undefined) continue;
      counts.set(product.bot_folder_id, (counts.get(product.bot_folder_id) || 0) + 1);
    }
    return counts;
  }, [productFolderCountRows]);

  const refreshProducts = async (
    pageIndex = productPage,
    nextPageSize = productPageSize,
    tab = productListTab
  ) => {
    await Promise.all([
      load(pageIndex, nextPageSize, tab),
      loadProductListMetadata().catch(() => undefined)
    ]);
  };

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

  const handleAddFolder = async (event: React.FormEvent) => {
    event.preventDefault();
    const nameValue = folderName.trim();
    if (!nameValue) return;

    const parsedSortPosition = parseSortPosition(folderSortPosition);
    if (!parsedSortPosition.valid) {
      setFolderError("Vị trí folder phải là số nguyên lớn hơn hoặc bằng 0 (hoặc để trống).");
      return;
    }

    setFolderSaving(true);
    try {
      await adminApiRequest("/api/admin/products", {
        method: "POST",
        body: JSON.stringify({
          action: "create_folder",
          name: nameValue,
          sortPosition: parsedSortPosition.value
        })
      });
    } catch (error) {
      setFolderError(
        error instanceof Error && error.message.includes("bot_product_folders")
          ? "Thiếu bảng bot_product_folders. Hãy chạy SQL migration folder sản phẩm mới."
          : error instanceof Error
          ? error.message
          : "Không thể thêm folder."
      );
      return;
    } finally {
      setFolderSaving(false);
    }

    setFolderError(null);
    setFolderName("");
    setFolderSortPosition("");
    await loadFolders();
  };

  const handleAdd = async (event: React.FormEvent) => {
    event.preventDefault();
    const tiers = normalizeTierRows(priceTierRows);
    const buyQty = Number(promoBuyQuantity || "0");
    const bonusQty = Number(promoBonusQuantity || "0");
    const hasPromo = buyQty > 0 || bonusQty > 0;
    if (hasPromo && (!Number.isFinite(buyQty) || !Number.isFinite(bonusQty) || buyQty < 1 || bonusQty < 1)) {
      setProductError("Khuyến mãi cần đủ 2 giá trị hợp lệ: mua X và tặng Y đều phải lớn hơn 0.");
      return;
    }
    const parsedSortPosition = parseSortPosition(sortPosition);
    if (!parsedSortPosition.valid) {
      setProductError("Vị trí phải là số nguyên lớn hơn hoặc bằng 0 (hoặc để trống).");
      return;
    }

    setProductSaving(true);
    try {
      await adminApiRequest("/api/admin/products", {
        method: "POST",
        body: JSON.stringify({
          action: "create_product",
          name,
          price: parseInt(price || "0", 10),
          priceUsdt: parseFloat(priceUsdt || "0"),
          sortPosition: parsedSortPosition.value,
          botFolderId: parseOptionalFolderId(botFolderId),
          telegramIcon: normalizeTelegramIcon(telegramIcon),
          telegramIconCustomEmojiId: normalizeTelegramCustomEmojiId(telegramIconCustomEmojiId),
          description,
          formatData: formatData || null,
          priceTiers: tiers.length ? tiers : null,
          promoBuyQuantity: hasPromo ? Math.trunc(buyQty) : 0,
          promoBonusQuantity: hasPromo ? Math.trunc(bonusQty) : 0
        })
      });
    } catch (error) {
      setProductError(
        error instanceof Error && error.message.includes("sort_position")
          ? "Thiếu cột sort_position trong products. Hãy chạy SQL migration position mới."
          : error instanceof Error && error.message.includes("bot_folder_id")
          ? "Thiếu cột bot_folder_id trong products. Hãy chạy SQL migration folder sản phẩm mới."
          : error instanceof Error && error.message.includes("telegram_icon")
          ? "Thiếu cột Icon Telegram trong products. Hãy chạy lại supabase_schema_all_in_one.sql."
          : error instanceof Error
          ? error.message
          : "Không thể thêm sản phẩm."
      );
      return;
    } finally {
      setProductSaving(false);
    }
    setProductError(null);
    setName("");
    setPrice("");
    setPriceUsdt("");
    setSortPosition("");
    setBotFolderId("");
    setTelegramIcon("");
    setTelegramIconCustomEmojiId("");
    setDescription("");
    setFormatData("");
    setPriceTierRows([createTierRow()]);
    setPromoBuyQuantity("");
    setPromoBonusQuantity("");
    setCreateProductOpen(false);
    setProductListTab("visible");
    setProductPage(1);
    await refreshProducts(1, productPageSize, "visible");
  };

  const handleDeleteConfirm = async () => {
    if (!deleteProduct) return;
    try {
      await adminApiRequest("/api/admin/products", {
        method: "POST",
        body: JSON.stringify({
          action: "soft_delete",
          productId: deleteProduct.id
        })
      });
    } catch (error) {
      setProductError(
        error instanceof Error && (error.message.includes("is_deleted") || error.message.includes("deleted_at"))
          ? "Thiếu cột soft-delete trong products. Hãy chạy SQL migration mới."
          : error instanceof Error
          ? error.message
          : "Không thể xóa mềm sản phẩm."
      );
      return;
    }
    setDeleteProduct(null);
    await refreshProducts();
  };

  const handleToggleHidden = async (product: Product) => {
    if (product.is_deleted) return;
    try {
      await adminApiRequest("/api/admin/products", {
        method: "POST",
        body: JSON.stringify({
          action: "toggle_hidden",
          productId: product.id,
          hidden: !product.is_hidden
        })
      });
    } catch (error) {
      setProductError(
        error instanceof Error && error.message.includes("is_hidden")
          ? "Thiếu cột is_hidden trong products. Hãy chạy SQL migration soft-delete mới."
          : error instanceof Error
          ? error.message
          : "Không thể cập nhật trạng thái ẩn."
      );
      return;
    }
    await refreshProducts();
  };

  const handleRestore = async (product: Product) => {
    try {
      await adminApiRequest("/api/admin/products", {
        method: "POST",
        body: JSON.stringify({
          action: "restore",
          productId: product.id
        })
      });
    } catch (error) {
      setProductError(
        error instanceof Error && (error.message.includes("is_deleted") || error.message.includes("deleted_at"))
          ? "Thiếu cột soft-delete trong products. Hãy chạy SQL migration mới."
          : error instanceof Error
          ? error.message
          : "Không thể khôi phục sản phẩm."
      );
      return;
    }
    await refreshProducts();
  };

  const startEdit = (product: Product) => {
    setEditingProduct(product);
    setEditName(product.name);
    setEditPrice(product.price.toString());
    setEditPriceUsdt(product.price_usdt?.toString() ?? "");
    setEditSortPosition(product.sort_position !== null && product.sort_position !== undefined ? String(product.sort_position) : "");
    setEditBotFolderId(product.bot_folder_id !== null && product.bot_folder_id !== undefined ? String(product.bot_folder_id) : "");
    setEditTelegramIcon(product.telegram_icon ?? "");
    setEditTelegramIconCustomEmojiId(product.telegram_icon_custom_emoji_id ?? "");
    setEditDescription(product.description ?? "");
    setEditFormatData(product.format_data ?? "");
    setEditPriceTierRows(parseTierRows(product.price_tiers));
    setEditPromoBuyQuantity(product.promo_buy_quantity ? product.promo_buy_quantity.toString() : "");
    setEditPromoBonusQuantity(product.promo_bonus_quantity ? product.promo_bonus_quantity.toString() : "");
  };

  const cancelEdit = () => {
    setEditingProduct(null);
    setEditName("");
    setEditPrice("");
    setEditPriceUsdt("");
    setEditSortPosition("");
    setEditBotFolderId("");
    setEditTelegramIcon("");
    setEditTelegramIconCustomEmojiId("");
    setEditDescription("");
    setEditFormatData("");
    setEditPriceTierRows([createTierRow()]);
    setEditPromoBuyQuantity("");
    setEditPromoBonusQuantity("");
  };

  const startEditFolder = (folder: BotFolder) => {
    setEditingFolder(folder);
    setEditFolderName(folder.name);
    setEditFolderSortPosition(folder.sort_position !== null && folder.sort_position !== undefined ? String(folder.sort_position) : "");
  };

  const cancelEditFolder = () => {
    setEditingFolder(null);
    setEditFolderName("");
    setEditFolderSortPosition("");
  };

  const handleUpdateFolder = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingFolder) return;

    const nameValue = editFolderName.trim();
    if (!nameValue) return;

    const parsedSortPosition = parseSortPosition(editFolderSortPosition);
    if (!parsedSortPosition.valid) {
      setFolderError("Vị trí folder phải là số nguyên lớn hơn hoặc bằng 0 (hoặc để trống).");
      return;
    }

    setFolderSaving(true);
    try {
      await adminApiRequest("/api/admin/products", {
        method: "POST",
        body: JSON.stringify({
          action: "update_folder",
          folderId: editingFolder.id,
          name: nameValue,
          sortPosition: parsedSortPosition.value
        })
      });
    } catch (error) {
      setFolderError(
        error instanceof Error && error.message.includes("bot_product_folders")
          ? "Thiếu bảng bot_product_folders. Hãy chạy SQL migration folder sản phẩm mới."
          : error instanceof Error
          ? error.message
          : "Không thể cập nhật folder."
      );
      return;
    } finally {
      setFolderSaving(false);
    }

    setFolderError(null);
    cancelEditFolder();
    await loadFolders();
  };

  const handleDeleteFolderConfirm = async () => {
    if (!deleteFolder) return;

    try {
      await adminApiRequest("/api/admin/products", {
        method: "POST",
        body: JSON.stringify({
          action: "delete_folder",
          folderId: deleteFolder.id
        })
      });
    } catch (error) {
      setFolderError(
        error instanceof Error && error.message.includes("bot_product_folders")
          ? "Thiếu bảng bot_product_folders. Hãy chạy SQL migration folder sản phẩm mới."
          : error instanceof Error && error.message.includes("bot_folder_id")
          ? "Thiếu cột bot_folder_id trong products. Hãy chạy SQL migration folder sản phẩm mới."
          : error instanceof Error
          ? error.message
          : "Không thể xóa folder."
      );
      return;
    }

    setFolderError(null);
    setDeleteFolder(null);
    await Promise.all([loadFolders(), refreshProducts()]);
  };

  const handleUpdate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingProduct) return;
    const tiers = normalizeTierRows(editPriceTierRows);
    const buyQty = Number(editPromoBuyQuantity || "0");
    const bonusQty = Number(editPromoBonusQuantity || "0");
    const hasPromo = buyQty > 0 || bonusQty > 0;
    if (hasPromo && (!Number.isFinite(buyQty) || !Number.isFinite(bonusQty) || buyQty < 1 || bonusQty < 1)) {
      setProductError("Khuyến mãi cần đủ 2 giá trị hợp lệ: mua X và tặng Y đều phải lớn hơn 0.");
      return;
    }
    const parsedSortPosition = parseSortPosition(editSortPosition);
    if (!parsedSortPosition.valid) {
      setProductError("Vị trí phải là số nguyên lớn hơn hoặc bằng 0 (hoặc để trống).");
      return;
    }

    setProductSaving(true);
    try {
      await adminApiRequest("/api/admin/products", {
        method: "POST",
        body: JSON.stringify({
          action: "update_product",
          productId: editingProduct.id,
          name: editName,
          price: parseInt(editPrice || "0", 10),
          priceUsdt: parseFloat(editPriceUsdt || "0"),
          sortPosition: parsedSortPosition.value,
          botFolderId: parseOptionalFolderId(editBotFolderId),
          telegramIcon: normalizeTelegramIcon(editTelegramIcon),
          telegramIconCustomEmojiId: normalizeTelegramCustomEmojiId(editTelegramIconCustomEmojiId),
          description: editDescription,
          formatData: editFormatData || null,
          priceTiers: tiers.length ? tiers : null,
          promoBuyQuantity: hasPromo ? Math.trunc(buyQty) : 0,
          promoBonusQuantity: hasPromo ? Math.trunc(bonusQty) : 0
        })
      });
    } catch (error) {
      setProductError(
        error instanceof Error && error.message.includes("sort_position")
          ? "Thiếu cột sort_position trong products. Hãy chạy SQL migration position mới."
          : error instanceof Error && error.message.includes("bot_folder_id")
          ? "Thiếu cột bot_folder_id trong products. Hãy chạy SQL migration folder sản phẩm mới."
          : error instanceof Error && error.message.includes("telegram_icon")
          ? "Thiếu cột Icon Telegram trong products. Hãy chạy lại supabase_schema_all_in_one.sql."
          : error instanceof Error
          ? error.message
          : "Không thể cập nhật sản phẩm."
      );
      return;
    } finally {
      setProductSaving(false);
    }
    setProductError(null);
    cancelEdit();
    await refreshProducts();
  };

  const handleAddTemplate = async (event: React.FormEvent) => {
    event.preventDefault();
    const nameValue = templateName.trim();
    const patternValue = templatePattern.trim();
    if (!nameValue || !patternValue) return;
    setTemplateError(null);
    setTemplateSaving(true);
    try {
      await adminApiRequest("/api/admin/products", {
        method: "POST",
        body: JSON.stringify({
          action: "create_format_template",
          name: nameValue,
          pattern: patternValue
        })
      });
    } catch (error) {
      setTemplateError(error instanceof Error ? error.message : "Không thể thêm format template.");
      return;
    } finally {
      setTemplateSaving(false);
    }
    setTemplateName("");
    setTemplatePattern("");
    setTemplateCreateOpen(false);
    await loadFormats();
  };

  const handleDeleteTemplate = async (templateId: number) => {
    setTemplateError(null);
    setTemplateSaving(true);
    try {
      await adminApiRequest("/api/admin/products", {
        method: "POST",
        body: JSON.stringify({
          action: "delete_format_template",
          templateId
        })
      });
    } catch (error) {
      setTemplateError(error instanceof Error ? error.message : "Không thể xóa format template.");
      return;
    } finally {
      setTemplateSaving(false);
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
    try {
      await adminApiRequest("/api/admin/products", {
        method: "POST",
        body: JSON.stringify({
          action: "update_format_template",
          templateId: editingTemplate.id,
          name: nameValue,
          pattern: patternValue
        })
      });
    } catch (error) {
      setTemplateError(error instanceof Error ? error.message : "Không thể cập nhật format template.");
      return;
    } finally {
      setTemplateSaving(false);
    }
    cancelEditTemplate();
    await loadFormats();
  };

  return (
    <div className="grid" style={{ gap: 24 }}>
      <div className="topbar">
        <div>
          <h1 className="page-title">Products</h1>
          <p className="muted">Quản lý danh sách sản phẩm, giá bán và Banner Hàng hóa theo từng Product.</p>
        </div>
        <div className="page-actions">
          <button className="button" type="button" onClick={() => setCreateProductOpen(true)}>
            Thêm sản phẩm
          </button>
          <button className="button secondary" type="button" onClick={() => setFolderCreateOpen(true)}>
            Thêm folder
          </button>
          {adminSession?.role === "superadmin" && (
            <button className="button secondary" type="button" onClick={() => setTemplateCreateOpen(true)}>
              Thêm format
            </button>
          )}
        </div>
      </div>

      <div className="card">
        <div className="section-head">
          <div>
            <h3 className="section-title">Folder sản phẩm Bot</h3>
            <p className="muted">
              Folder chỉ áp dụng cho Telegram Bot. Xóa folder sẽ không xóa sản phẩm, chỉ đưa sản phẩm về danh sách top-level.
            </p>
          </div>
        </div>
        {folderCreateOpen && renderModal(
          <div className="modal-backdrop" onClick={() => !folderSaving && setFolderCreateOpen(false)}>
            <div className="modal" onClick={(event) => event.stopPropagation()}>
              <h3 className="section-title">Thêm folder Bot</h3>
              <p className="muted" style={{ marginTop: 8 }}>
                Folder chỉ dùng để nhóm sản phẩm trong Telegram Bot.
              </p>
            <form className="form-grid" onSubmit={handleAddFolder}>
              <input
                className="input"
                placeholder="Tên folder Bot"
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
                required
              />
              <input
                className="input"
                placeholder="Vị trí folder (VD: 1, 2, 3)"
                value={folderSortPosition}
                onChange={(e) => setFolderSortPosition(e.target.value)}
              />
              <div className="modal-actions">
                <button className="button" type="submit" disabled={folderSaving}>
                  {folderSaving ? "Đang thêm..." : "Thêm folder"}
                </button>
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => setFolderCreateOpen(false)}
                  disabled={folderSaving}
                >
                  Hủy
                </button>
              </div>
            </form>
            </div>
          </div>
        )}
        {folderError && (
          <p className="muted" style={{ marginTop: 8 }}>
            Lỗi: {folderError}
          </p>
        )}
        <table className="table" style={{ marginTop: 16 }}>
          <thead>
            <tr>
              <th>ID</th>
              <th>Vị trí</th>
              <th>Tên folder</th>
              <th>Số sản phẩm</th>
              <th>Hành động</th>
            </tr>
          </thead>
          <tbody>
            {folderOptions.map((folder) => (
              <tr key={folder.id}>
                <td>#{folder.id}</td>
                <td>{folder.sort_position ?? "-"}</td>
                <td>{folder.name}</td>
                <td>{folderProductCounts.get(folder.id) || 0}</td>
                <td className="row-actions-cell">
                  <RowActionMenu items={[
                    { label: "Chỉnh sửa", onSelect: () => startEditFolder(folder) },
                    { label: "Xóa folder", tone: "danger", onSelect: () => setDeleteFolder(folder) }
                  ]} />
                </td>
              </tr>
            ))}
            {!folderOptions.length && (
              <tr>
                <td colSpan={5} className="muted">Chưa có folder nào.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {createProductOpen && renderModal(
        <div className="modal-backdrop" onClick={() => !productSaving && setCreateProductOpen(false)}>
          <div className="modal modal-wide modal-scrollable" onClick={(event) => event.stopPropagation()}>
            <div className="modal-scroll-region">
              <div className="section-head">
                <div>
                  <h3 className="section-title">Thêm sản phẩm mới</h3>
                  <p className="muted">Tạo sản phẩm trong modal để danh sách chính luôn gọn và dễ quét.</p>
                </div>
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => setCreateProductOpen(false)}
                  disabled={productSaving}
                >
                  Đóng
                </button>
              </div>
          <form className="form-grid" onSubmit={handleAdd}>
            <input className="input" placeholder="Tên sản phẩm" value={name} onChange={(e) => setName(e.target.value)} required />
            <input
              className="input"
              placeholder="Emoji fallback (VD: 🤖, 📦, ✨)"
              value={telegramIcon}
              onChange={(e) => setTelegramIcon(e.target.value)}
              maxLength={16}
            />
            <input
              className="input"
              inputMode="numeric"
              placeholder="Custom emoji ID Telegram (VD: 5368324170671202286)"
              value={telegramIconCustomEmojiId}
              onChange={(e) => setTelegramIconCustomEmojiId(e.target.value.replace(/\D/g, "").slice(0, 64))}
              maxLength={64}
            />
            <input className="input" placeholder="Giá (VND)" value={price} onChange={(e) => setPrice(e.target.value)} required />
            <input className="input" placeholder="Giá (USDT)" value={priceUsdt} onChange={(e) => setPriceUsdt(e.target.value)} />
            <input className="input" placeholder="Vị trí trên Bot (VD: 1, 2, 3)" value={sortPosition} onChange={(e) => setSortPosition(e.target.value)} />
            <select
              className="select"
              value={botFolderId}
              onChange={(e) => setBotFolderId(e.target.value)}
            >
              <option value="">Không gán folder Bot</option>
              {folderOptions.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
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
            <textarea
              className="textarea form-section"
              placeholder="Mô tả (gửi trước Account sau thanh toán)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
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
            <div className="modal-actions">
              <button className="button" type="submit" disabled={productSaving}>
                {productSaving ? "Đang thêm..." : "Thêm sản phẩm"}
              </button>
              <button
                className="button secondary"
                type="button"
                onClick={() => setCreateProductOpen(false)}
                disabled={productSaving}
              >
                Hủy
              </button>
            </div>
          </form>
          {productError && (
            <p className="muted" style={{ marginTop: 8 }}>
              Lỗi: {productError}
            </p>
          )}
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <h3 className="section-title">Danh sách sản phẩm</h3>
        <p className="muted" style={{ marginBottom: 10 }}>
          Bot sẽ ưu tiên sắp xếp theo cột <strong>Vị trí</strong> tăng dần. Để trống sẽ xếp sau theo ID.
        </p>
        {productError && !createProductOpen && (
          <p className="muted" style={{ marginBottom: 10, color: "var(--danger)" }}>
            Lỗi: {productError}
          </p>
        )}
        <div className="segmented" style={{ marginBottom: 12 }}>
          <button
            className={`segmented-button ${productListTab === "visible" ? "active" : ""}`}
            type="button"
            onClick={() => {
              setProductListTab("visible");
              setProductPage(1);
            }}
          >
            Đang hiển thị ({productListCounts.visible})
          </button>
          <button
            className={`segmented-button ${productListTab === "hidden" ? "active" : ""}`}
            type="button"
            onClick={() => {
              setProductListTab("hidden");
              setProductPage(1);
            }}
          >
            Đang ẩn ({productListCounts.hidden})
          </button>
          <button
            className={`segmented-button danger ${productListTab === "deleted" ? "active" : ""}`}
            type="button"
            onClick={() => {
              setProductListTab("deleted");
              setProductPage(1);
            }}
          >
            Đã xóa mềm ({productListCounts.deleted})
          </button>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Vị trí</th>
              <th>Folder Bot</th>
              <th>Fallback</th>
              <th>Custom emoji ID</th>
              <th>Tên</th>
              <th>Giá (VND)</th>
              <th>Giá (USDT)</th>
              <th>Giá theo SL</th>
              <th>Khuyến mãi</th>
              <th>Mô tả</th>
              <th>Format data</th>
              <th>Hành động</th>
            </tr>
          </thead>
          <tbody>
            {listedProducts.map((product) => (
              <tr key={product.id}>
                <td>#{product.id}</td>
                <td>{product.sort_position ?? "-"}</td>
                <td>
                  {product.bot_folder_id !== null
                    ? folderNameById.get(product.bot_folder_id) ?? `#${product.bot_folder_id}`
                    : "-"}
                </td>
                <td>{product.telegram_icon || "📦"}</td>
                <td title={product.telegram_icon_custom_emoji_id || ""}>
                  {shortenCustomEmojiId(product.telegram_icon_custom_emoji_id)}
                </td>
                <td>{product.name}</td>
                <td>{product.price.toLocaleString()}</td>
                <td>{product.price_usdt?.toString() ?? "0"}</td>
                <td>{formatTierSummary(product.price_tiers)}</td>
                <td>
                  {(product.promo_buy_quantity || 0) > 0 && (product.promo_bonus_quantity || 0) > 0
                    ? `Mua ${product.promo_buy_quantity} tặng ${product.promo_bonus_quantity}`
                    : "Không"}
                </td>
                <td>{product.description ?? ""}</td>
                <td>{product.format_data ?? ""}</td>
                <td className="row-actions-cell">
                  <RowActionMenu
                    items={product.is_deleted
                      ? [
                          { label: "Chỉnh sửa", onSelect: () => startEdit(product) },
                          { label: "Khôi phục", tone: "warning", onSelect: () => handleRestore(product) }
                        ]
                      : [
                          { label: "Chỉnh sửa", onSelect: () => startEdit(product) },
                          { label: product.is_hidden ? "Bỏ ẩn" : "Ẩn", tone: "warning", onSelect: () => handleToggleHidden(product) },
                          { label: "Xóa mềm", tone: "danger", onSelect: () => setDeleteProduct(product) }
                        ]
                    }
                  />
                </td>
              </tr>
            ))}
            {!listedProducts.length && (
              <tr>
                <td colSpan={13} className="muted">
                  {productLoading
                    ? "Đang tải sản phẩm..."
                    : productListTab === "hidden"
                    ? "Chưa có sản phẩm đang ẩn."
                    : productListTab === "deleted"
                    ? "Chưa có sản phẩm đã xóa mềm."
                    : "Chưa có sản phẩm đang hiển thị."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <PaginationControls
          page={productPage}
          totalPages={productTotalPages}
          totalCount={productTotalCount}
          pageSize={productPageSize}
          disabled={productLoading}
          onPageChange={setProductPage}
          onPageSizeChange={(nextPageSize) => {
            setProductPageSize(nextPageSize);
            setProductPage(1);
          }}
        />
      </div>

      {adminSession?.role === "superadmin" && (
        <div className="card">
          <div className="section-head">
            <div>
              <h3 className="section-title">Format templates</h3>
              <p className="muted">Mẫu format dùng lại khi tạo hoặc chỉnh sửa sản phẩm.</p>
            </div>
          </div>
          {templateCreateOpen && renderModal(
            <div className="modal-backdrop" onClick={() => !templateSaving && setTemplateCreateOpen(false)}>
              <div className="modal" onClick={(event) => event.stopPropagation()}>
                <h3 className="section-title">Thêm format template</h3>
                <p className="muted" style={{ marginTop: 8 }}>
                  Lưu mẫu format để tái sử dụng khi tạo hoặc chỉnh sửa sản phẩm.
                </p>
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
                <div className="modal-actions">
                  <button className="button" type="submit" disabled={templateSaving}>
                    {templateSaving ? "Đang thêm..." : "Thêm format"}
                  </button>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => setTemplateCreateOpen(false)}
                    disabled={templateSaving}
                  >
                    Hủy
                  </button>
                </div>
              </form>
              </div>
            </div>
          )}
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
                  <td className="row-actions-cell">
                    <RowActionMenu items={[
                      { label: "Chỉnh sửa", onSelect: () => startEditTemplate(format) },
                      { label: "Xóa", tone: "danger", disabled: templateSaving, onSelect: () => handleDeleteTemplate(format.id) }
                    ]} />
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

      {editingProduct && renderModal(
        <div className="modal-backdrop" onClick={cancelEdit}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h3 className="section-title">Chỉnh sửa sản phẩm #{editingProduct.id}</h3>
            <form className="form-grid" onSubmit={handleUpdate}>
              <input className="input" placeholder="Tên sản phẩm" value={editName} onChange={(e) => setEditName(e.target.value)} required />
              <input
                className="input"
                placeholder="Emoji fallback (VD: 🤖, 📦, ✨)"
                value={editTelegramIcon}
                onChange={(e) => setEditTelegramIcon(e.target.value)}
                maxLength={16}
              />
              <input
                className="input"
                inputMode="numeric"
                placeholder="Custom emoji ID Telegram"
                value={editTelegramIconCustomEmojiId}
                onChange={(e) => setEditTelegramIconCustomEmojiId(e.target.value.replace(/\D/g, "").slice(0, 64))}
                maxLength={64}
              />
              <input className="input" placeholder="Giá (VND)" value={editPrice} onChange={(e) => setEditPrice(e.target.value)} required />
              <input className="input" placeholder="Giá (USDT)" value={editPriceUsdt} onChange={(e) => setEditPriceUsdt(e.target.value)} />
              <input className="input" placeholder="Vị trí trên Bot (để trống nếu không dùng)" value={editSortPosition} onChange={(e) => setEditSortPosition(e.target.value)} />
              <select
                className="select"
                value={editBotFolderId}
                onChange={(e) => setEditBotFolderId(e.target.value)}
              >
                <option value="">Không gán folder Bot</option>
                {folderOptions.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </select>
              <textarea className="textarea form-section" placeholder="Mô tả (gửi trước Account sau thanh toán)" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} />
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
                <button className="button" type="submit" disabled={productSaving}>
                  {productSaving ? "Đang lưu..." : "Lưu"}
                </button>
                <button className="button secondary" type="button" onClick={cancelEdit} disabled={productSaving}>
                  Hủy
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editingFolder && renderModal(
        <div className="modal-backdrop" onClick={cancelEditFolder}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h3 className="section-title">Chỉnh sửa folder #{editingFolder.id}</h3>
            <form className="form-grid" onSubmit={handleUpdateFolder}>
              <input
                className="input"
                placeholder="Tên folder Bot"
                value={editFolderName}
                onChange={(e) => setEditFolderName(e.target.value)}
                required
              />
              <input
                className="input"
                placeholder="Vị trí folder"
                value={editFolderSortPosition}
                onChange={(e) => setEditFolderSortPosition(e.target.value)}
              />
              {folderError && (
                <p className="muted form-section" style={{ marginTop: 0 }}>
                  Lỗi: {folderError}
                </p>
              )}
              <div className="modal-actions">
                <button className="button" type="submit" disabled={folderSaving}>
                  {folderSaving ? "Đang lưu..." : "Lưu"}
                </button>
                <button className="button secondary" type="button" onClick={cancelEditFolder} disabled={folderSaving}>
                  Hủy
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editingTemplate && renderModal(
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

      {deleteFolder && renderModal(
        <div className="modal-backdrop" onClick={() => setDeleteFolder(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h3 className="section-title">Xóa folder #{deleteFolder.id}</h3>
            <p className="muted" style={{ marginTop: 8 }}>
              Tất cả sản phẩm trong <strong>{deleteFolder.name}</strong> sẽ được bỏ gán folder và trở về top-level. Không có sản phẩm nào bị xóa. Bạn có chắc muốn tiếp tục?
            </p>
            <div className="modal-actions">
              <button className="button danger" type="button" onClick={handleDeleteFolderConfirm}>Xóa folder</button>
              <button className="button secondary" type="button" onClick={() => setDeleteFolder(null)}>Hủy</button>
            </div>
          </div>
        </div>
      )}

      {deleteProduct && renderModal(
        <div className="modal-backdrop" onClick={() => setDeleteProduct(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h3 className="section-title">Xóa mềm sản phẩm #{deleteProduct.id}</h3>
            <p className="muted" style={{ marginTop: 8 }}>
              Sản phẩm sẽ bị ẩn khỏi danh sách bán nhưng vẫn giữ toàn bộ Orders liên quan. Xác nhận xóa mềm <strong>{deleteProduct.name}</strong>?
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
