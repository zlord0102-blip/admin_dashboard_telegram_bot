"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { adminApiGet, adminApiRequest } from "@/lib/adminOpsClient";
import { ConfirmDialog, PaginationControls, RowActionMenu } from "@/components/AdminUi";
import {
  DEFAULT_STOCK_BROADCAST_TEMPLATE,
  STOCK_BROADCAST_TEMPLATES_KEY,
  createBroadcastTemplateId,
  createEmptyBroadcastTemplate,
  normalizeBroadcastTemplates,
  parseBroadcastTemplates,
  renderTemplateText,
  type BroadcastTemplate
} from "@/lib/broadcastTemplates";

interface Product {
  id: number;
  name: string;
  is_hidden?: boolean;
  is_deleted?: boolean;
  sort_position?: number | null;
}

interface StockItem {
  id: number;
  product_id: number;
  content: string;
  sold: boolean;
}

interface StockSummary {
  total: number;
  sold: number;
  remaining: number;
}

type CustomCheckSource = "tempmail" | "tinyhost" | "hotmail";
type CustomCheckScope = "product" | "selected";
type CustomCheckStatus = "true" | "false" | "error";

interface CustomCheckResult {
  stock_id: number;
  identifier: string;
  content: string;
  status: CustomCheckStatus;
  error?: string;
}

interface CustomCheckFormHistory {
  sourceHistory: CustomCheckSource[];
  mailColumnHistory: number[];
  senderHistory: string[];
  subjectHistory: string[];
  concurrencyHistory: number[];
}

interface CustomCheckHistoryOverrides {
  source?: CustomCheckSource;
  mailColumnIndex?: number;
  senderFilter?: string;
  subjectFilter?: string;
  concurrency?: number;
}

interface PendingCustomDelete {
  productId: string;
  status: CustomCheckStatus;
  targetIds: number[];
}

const CUSTOM_CHECK_HISTORY_KEY = "stock_custom_check_form_history_v1";
const MAX_CUSTOM_CHECK_HISTORY_ITEMS = 5;
const AVAILABLE_CUSTOM_SOURCES: CustomCheckSource[] = ["hotmail", "tempmail", "tinyhost"];
const AVAILABLE_CUSTOM_CONCURRENCY = [5, 10, 20, 50];
const parseStockLines = (text: string) =>
  Array.from(
    new Set(
      text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
    )
  );

export default function StockPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [productTab, setProductTab] = useState<"active" | "inactive">("active");
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [stockSummary, setStockSummary] = useState<StockSummary>({ total: 0, sold: 0, remaining: 0 });
  const [content, setContent] = useState("");
  const [broadcastAfterAdd, setBroadcastAfterAdd] = useState(false);
  const [stockBroadcastTemplates, setStockBroadcastTemplates] = useState<BroadcastTemplate[]>([
    DEFAULT_STOCK_BROADCAST_TEMPLATE
  ]);
  const [selectedStockBroadcastTemplateId, setSelectedStockBroadcastTemplateId] = useState(
    DEFAULT_STOCK_BROADCAST_TEMPLATE.id
  );
  const [stockBroadcastTemplateDraft, setStockBroadcastTemplateDraft] = useState<BroadcastTemplate>(
    createEmptyBroadcastTemplate
  );
  const [stockBroadcastManagerOpen, setStockBroadcastManagerOpen] = useState(false);
  const [stockBroadcastTemplateStatus, setStockBroadcastTemplateStatus] = useState<string | null>(null);
  const [stockBroadcastStatus, setStockBroadcastStatus] = useState<string | null>(null);
  const [stockFormTab, setStockFormTab] = useState<"add" | "delete">("add");
  const [stockActionPanelOpen, setStockActionPanelOpen] = useState(false);
  const [customCheckPanelOpen, setCustomCheckPanelOpen] = useState(false);
  const [deleteContent, setDeleteContent] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [totalCount, setTotalCount] = useState(0);
  const [stockLoading, setStockLoading] = useState(false);
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const [selectedStockIds, setSelectedStockIds] = useState<Set<number>>(new Set());
  const [editingStock, setEditingStock] = useState<StockItem | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editSold, setEditSold] = useState(false);
  const [deleteStock, setDeleteStock] = useState<StockItem | null>(null);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkSoldAction, setBulkSoldAction] = useState<"keep" | "available" | "sold">("keep");
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [stockMutationMessage, setStockMutationMessage] = useState<string | null>(null);
  const [deleteByTextPlan, setDeleteByTextPlan] = useState<{ ids: number[]; queries: string[] } | null>(
    null
  );
  const [deleteByTextOpen, setDeleteByTextOpen] = useState(false);
  const [deleteByTextBusy, setDeleteByTextBusy] = useState(false);
  const [deleteByTextError, setDeleteByTextError] = useState<string | null>(null);
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const [customCheckScope, setCustomCheckScope] = useState<CustomCheckScope>("product");
  const [customCheckSource, setCustomCheckSource] = useState<CustomCheckSource>("hotmail");
  const [customCheckSenderFilter, setCustomCheckSenderFilter] = useState("noreply@tm.openai.com");
  const [customCheckSubjectFilter, setCustomCheckSubjectFilter] = useState("Kế hoạch mới");
  const [customCheckMailColumnIndex, setCustomCheckMailColumnIndex] = useState(1);
  const [customCheckConcurrency, setCustomCheckConcurrency] = useState(20);
  const [customCheckBusy, setCustomCheckBusy] = useState(false);
  const [customCheckError, setCustomCheckError] = useState<string | null>(null);
  const [customCheckProgress, setCustomCheckProgress] = useState({ completed: 0, total: 0 });
  const [customCheckResults, setCustomCheckResults] = useState<CustomCheckResult[]>([]);
  const [customDeleteStatus, setCustomDeleteStatus] = useState<CustomCheckStatus>("error");
  const [customDeleteBusy, setCustomDeleteBusy] = useState(false);
  const [customDeleteMessage, setCustomDeleteMessage] = useState<string | null>(null);
  const [pendingCustomDelete, setPendingCustomDelete] = useState<PendingCustomDelete | null>(null);
  const [customSourceHistory, setCustomSourceHistory] = useState<CustomCheckSource[]>([]);
  const [customMailColumnHistory, setCustomMailColumnHistory] = useState<number[]>([]);
  const [customSenderHistory, setCustomSenderHistory] = useState<string[]>([]);
  const [customSubjectHistory, setCustomSubjectHistory] = useState<string[]>([]);
  const [customConcurrencyHistory, setCustomConcurrencyHistory] = useState<number[]>([]);

  const filteredProducts = useMemo(() => {
    const sorted = [...products].sort((a, b) => {
      const aPos = Number.isFinite(a.sort_position as number) ? Number(a.sort_position) : Number.MAX_SAFE_INTEGER;
      const bPos = Number.isFinite(b.sort_position as number) ? Number(b.sort_position) : Number.MAX_SAFE_INTEGER;
      if (aPos !== bPos) return aPos - bPos;
      return a.id - b.id;
    });

    return sorted.filter((product) =>
      productTab === "active"
        ? !product.is_hidden && !product.is_deleted
        : Boolean(product.is_hidden) || Boolean(product.is_deleted)
    );
  }, [productTab, products]);

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === Number(selectedProductId)) || null,
    [products, selectedProductId]
  );

  const selectedStockBroadcastTemplate = useMemo(
    () =>
      stockBroadcastTemplates.find((template) => template.id === selectedStockBroadcastTemplateId) ||
      stockBroadcastTemplates[0] ||
      DEFAULT_STOCK_BROADCAST_TEMPLATE,
    [stockBroadcastTemplates, selectedStockBroadcastTemplateId]
  );

  const stockAddLineCount = useMemo(() => parseStockLines(content).length, [content]);
  const stockBroadcastPreview = useMemo(
    () =>
      renderTemplateText(selectedStockBroadcastTemplate.message || DEFAULT_STOCK_BROADCAST_TEMPLATE.message, {
        product_name: selectedProduct?.name || "Sản phẩm",
        added_count: stockAddLineCount,
        current_stock: stockSummary.remaining + stockAddLineCount,
        total_stock: stockSummary.total + stockAddLineCount
      }),
    [selectedProduct?.name, selectedStockBroadcastTemplate.message, stockAddLineCount, stockSummary.remaining, stockSummary.total]
  );

  const loadProducts = async () => {
    const { data } = await supabase
      .from("products")
      .select("id, name, is_hidden, is_deleted, sort_position")
      .order("id");
    const rows = ((data as Array<Record<string, unknown>>) || []).map((row) => ({
      id: Number(row.id),
      name: String(row.name || `#${String(row.id || "")}`),
      is_hidden: Boolean(row.is_hidden),
      is_deleted: Boolean(row.is_deleted),
      sort_position:
        row.sort_position === null || row.sort_position === undefined
          ? null
          : Number(row.sort_position)
    }));
    setProducts(rows);
  };

  const loadStock = async (productId: string, pageIndex = page, nextPageSize = pageSize) => {
    if (!productId) return;
    setStockLoading(true);
    try {
      const from = (pageIndex - 1) * nextPageSize;
      const to = from + nextPageSize - 1;
      const { data, count } = await supabase
        .from("stock")
        .select("id, product_id, content, sold", { count: "exact" })
        .eq("product_id", Number(productId))
        .order("sold", { ascending: true })
        .order("id", { ascending: false })
        .range(from, to);
      setStockItems((data as StockItem[]) || []);
      setTotalCount(count ?? 0);
    } finally {
      setStockLoading(false);
    }
  };

  const loadStockSummary = async (productId: string) => {
    if (!productId) {
      const emptySummary = { total: 0, sold: 0, remaining: 0 };
      setStockSummary(emptySummary);
      return emptySummary;
    }

    try {
      const params = new URLSearchParams({ productId });
      const { summary } = await adminApiGet<{ summary: StockSummary }>(
        `/api/admin/stock?${params.toString()}`
      );
      setStockSummary(summary);
      return summary;
    } catch {
      const emptySummary = { total: 0, sold: 0, remaining: 0 };
      setStockSummary(emptySummary);
      return emptySummary;
    }
  };

  const loadStockBroadcastTemplates = async () => {
    const { data, error } = await supabase
      .from("settings")
      .select("value")
      .eq("key", STOCK_BROADCAST_TEMPLATES_KEY)
      .maybeSingle();

    if (error) throw error;
    const templates = parseBroadcastTemplates(data?.value);
    const nextTemplates = templates.length ? templates : [DEFAULT_STOCK_BROADCAST_TEMPLATE];
    setStockBroadcastTemplates(nextTemplates);
    setSelectedStockBroadcastTemplateId((current) =>
      nextTemplates.some((template) => template.id === current) ? current : nextTemplates[0]?.id || ""
    );
  };

  const saveStockBroadcastTemplates = async (nextTemplates: BroadcastTemplate[]) => {
    const sanitized = normalizeBroadcastTemplates(nextTemplates);
    const { error } = await supabase
      .from("settings")
      .upsert(
        [{ key: STOCK_BROADCAST_TEMPLATES_KEY, value: JSON.stringify(sanitized) }],
        { onConflict: "key" }
      );
    if (error) throw error;
    const templates = sanitized.length ? sanitized : [DEFAULT_STOCK_BROADCAST_TEMPLATE];
    setStockBroadcastTemplates(templates);
    return templates;
  };

  const updateRecentValues = <T,>(history: T[], value: T) =>
    [value, ...history.filter((item) => item !== value)].slice(0, MAX_CUSTOM_CHECK_HISTORY_ITEMS);

  const saveCustomCheckHistory = (payload: CustomCheckFormHistory) => {
    try {
      localStorage.setItem(CUSTOM_CHECK_HISTORY_KEY, JSON.stringify(payload));
    } catch {
      // Ignore storage errors on restricted browsers.
    }
  };

  const applyCustomCheckHistory = (history: CustomCheckFormHistory) => {
    setCustomSourceHistory(history.sourceHistory);
    setCustomMailColumnHistory(history.mailColumnHistory);
    setCustomSenderHistory(history.senderHistory);
    setCustomSubjectHistory(history.subjectHistory);
    setCustomConcurrencyHistory(history.concurrencyHistory);

    if (history.sourceHistory[0]) {
      setCustomCheckSource(history.sourceHistory[0]);
    }
    if (history.mailColumnHistory[0]) {
      setCustomCheckMailColumnIndex(history.mailColumnHistory[0]);
    }
    if (history.senderHistory[0]) {
      setCustomCheckSenderFilter(history.senderHistory[0]);
    }
    if (history.subjectHistory[0]) {
      setCustomCheckSubjectFilter(history.subjectHistory[0]);
    }
    if (history.concurrencyHistory[0]) {
      setCustomCheckConcurrency(history.concurrencyHistory[0]);
    }
  };

  const persistCustomCheckHistory = (overrides: CustomCheckHistoryOverrides = {}) => {
    const sourceCandidate = overrides.source ?? customCheckSource;
    const sourceValue: CustomCheckSource = AVAILABLE_CUSTOM_SOURCES.includes(sourceCandidate)
      ? sourceCandidate
      : customCheckSource;

    const mailColumnRaw = overrides.mailColumnIndex ?? customCheckMailColumnIndex;
    const mailColumnValue = Math.max(1, Math.min(30, Math.floor(mailColumnRaw)));

    const senderValue = (overrides.senderFilter ?? customCheckSenderFilter).trim();
    const subjectValue = (overrides.subjectFilter ?? customCheckSubjectFilter).trim();

    const concurrencyCandidate = overrides.concurrency ?? customCheckConcurrency;
    const concurrencyValue = AVAILABLE_CUSTOM_CONCURRENCY.includes(concurrencyCandidate)
      ? concurrencyCandidate
      : customCheckConcurrency;

    const nextHistory: CustomCheckFormHistory = {
      sourceHistory: updateRecentValues(customSourceHistory, sourceValue),
      mailColumnHistory: updateRecentValues(customMailColumnHistory, mailColumnValue),
      senderHistory: senderValue
        ? updateRecentValues(customSenderHistory, senderValue)
        : customSenderHistory.slice(0, MAX_CUSTOM_CHECK_HISTORY_ITEMS),
      subjectHistory: subjectValue
        ? updateRecentValues(customSubjectHistory, subjectValue)
        : customSubjectHistory.slice(0, MAX_CUSTOM_CHECK_HISTORY_ITEMS),
      concurrencyHistory: updateRecentValues(customConcurrencyHistory, concurrencyValue)
    };

    setCustomSourceHistory(nextHistory.sourceHistory);
    setCustomMailColumnHistory(nextHistory.mailColumnHistory);
    setCustomSenderHistory(nextHistory.senderHistory);
    setCustomSubjectHistory(nextHistory.subjectHistory);
    setCustomConcurrencyHistory(nextHistory.concurrencyHistory);
    saveCustomCheckHistory(nextHistory);
  };

  useEffect(() => {
    loadProducts();
  }, []);

  useEffect(() => {
    loadStockBroadcastTemplates().catch(() => {
      setStockBroadcastTemplates([DEFAULT_STOCK_BROADCAST_TEMPLATE]);
      setSelectedStockBroadcastTemplateId(DEFAULT_STOCK_BROADCAST_TEMPLATE.id);
    });
  }, []);

  useEffect(() => {
    const selected = stockBroadcastTemplates.find(
      (template) => template.id === selectedStockBroadcastTemplateId
    );
    setStockBroadcastTemplateDraft(selected || createEmptyBroadcastTemplate());
  }, [selectedStockBroadcastTemplateId, stockBroadcastTemplates]);

  useEffect(() => {
    if (!selectedProductId) return;
    const existsInTab = filteredProducts.some((product) => product.id === Number(selectedProductId));
    if (!existsInTab) {
      setSelectedProductId("");
    }
  }, [filteredProducts, selectedProductId]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CUSTOM_CHECK_HISTORY_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<CustomCheckFormHistory>;

      const sourceHistory = (Array.isArray(parsed.sourceHistory) ? parsed.sourceHistory : [])
        .map((item) => String(item))
        .filter((item): item is CustomCheckSource =>
          AVAILABLE_CUSTOM_SOURCES.includes(item as CustomCheckSource)
        )
        .slice(0, MAX_CUSTOM_CHECK_HISTORY_ITEMS);

      const mailColumnHistory = (Array.isArray(parsed.mailColumnHistory) ? parsed.mailColumnHistory : [])
        .map((item) => Number(item))
        .filter((item) => Number.isInteger(item) && item >= 1 && item <= 30)
        .slice(0, MAX_CUSTOM_CHECK_HISTORY_ITEMS);

      const senderHistory = (Array.isArray(parsed.senderHistory) ? parsed.senderHistory : [])
        .map((item) => String(item).trim())
        .filter(Boolean)
        .slice(0, MAX_CUSTOM_CHECK_HISTORY_ITEMS);

      const subjectHistory = (Array.isArray(parsed.subjectHistory) ? parsed.subjectHistory : [])
        .map((item) => String(item).trim())
        .filter(Boolean)
        .slice(0, MAX_CUSTOM_CHECK_HISTORY_ITEMS);

      const concurrencyHistory = (Array.isArray(parsed.concurrencyHistory) ? parsed.concurrencyHistory : [])
        .map((item) => Number(item))
        .filter((item) => AVAILABLE_CUSTOM_CONCURRENCY.includes(item))
        .slice(0, MAX_CUSTOM_CHECK_HISTORY_ITEMS);

      applyCustomCheckHistory({
        sourceHistory,
        mailColumnHistory,
        senderHistory,
        subjectHistory,
        concurrencyHistory
      });
    } catch {
      // Ignore malformed legacy history.
    }
  }, []);

  useEffect(() => {
    if (!selectedProductId) {
      setStockItems([]);
      setTotalCount(0);
      setStockSummary({ total: 0, sold: 0, remaining: 0 });
      setSelectedStockIds(new Set());
      setStockActionPanelOpen(false);
      setCustomCheckPanelOpen(false);
      setCustomCheckResults([]);
      setCustomCheckError(null);
      setCustomCheckProgress({ completed: 0, total: 0 });
      setCustomDeleteMessage(null);
      return;
    }
    setSelectedStockIds(new Set());
    setCustomCheckResults([]);
    setCustomCheckError(null);
    setCustomCheckProgress({ completed: 0, total: 0 });
    setCustomDeleteMessage(null);
  }, [selectedProductId]);

  useEffect(() => {
    if (selectedProductId) {
      loadStock(selectedProductId, page, pageSize);
    }
  }, [selectedProductId, page, pageSize]);

  useEffect(() => {
    if (!selectedProductId) return;
    loadStockSummary(selectedProductId);
  }, [selectedProductId]);

  useEffect(() => {
    // Selection is scoped to the current page and product filter for predictable bulk actions.
    setSelectedStockIds(new Set());
  }, [page, pageSize]);

  useEffect(() => {
    const el = selectAllRef.current;
    if (!el) return;
    if (!stockItems.length) {
      el.indeterminate = false;
      return;
    }
    const selectedOnPage = stockItems.reduce(
      (acc, item) => acc + (selectedStockIds.has(item.id) ? 1 : 0),
      0
    );
    el.indeterminate = selectedOnPage > 0 && selectedOnPage < stockItems.length;
  }, [stockItems, selectedStockIds]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const selectStockBroadcastTemplate = (templateId: string) => {
    setSelectedStockBroadcastTemplateId(templateId);
    setStockBroadcastTemplateStatus(null);
    const selected =
      stockBroadcastTemplates.find((template) => template.id === templateId) ||
      createEmptyBroadcastTemplate();
    setStockBroadcastTemplateDraft(selected);
  };

  const handleAddStockBroadcastTemplate = async () => {
    if (!stockBroadcastTemplateDraft.message.trim()) {
      setStockBroadcastTemplateStatus("Nhập message template trước khi lưu.");
      return;
    }
    const [normalized] = normalizeBroadcastTemplates([
      { ...stockBroadcastTemplateDraft, id: createBroadcastTemplateId(), title: "" }
    ]);
    if (!normalized) return;
    try {
      const templates = await saveStockBroadcastTemplates([...stockBroadcastTemplates, normalized]);
      setSelectedStockBroadcastTemplateId(normalized.id);
      setStockBroadcastTemplateDraft(templates.find((template) => template.id === normalized.id) || normalized);
      setStockBroadcastTemplateStatus("✅ Đã lưu template stock broadcast.");
    } catch {
      setStockBroadcastTemplateStatus("Không thể lưu template stock broadcast.");
    }
  };

  const handleUpdateStockBroadcastTemplate = async () => {
    if (!selectedStockBroadcastTemplateId) {
      setStockBroadcastTemplateStatus("Chọn template cần cập nhật.");
      return;
    }
    if (!stockBroadcastTemplateDraft.message.trim()) {
      setStockBroadcastTemplateStatus("Message template không được để trống.");
      return;
    }
    const [normalized] = normalizeBroadcastTemplates([
      { ...stockBroadcastTemplateDraft, id: selectedStockBroadcastTemplateId, title: "" }
    ]);
    if (!normalized) return;
    try {
      const templates = await saveStockBroadcastTemplates(
        stockBroadcastTemplates.map((template) =>
          template.id === selectedStockBroadcastTemplateId ? normalized : template
        )
      );
      setStockBroadcastTemplateDraft(
        templates.find((template) => template.id === selectedStockBroadcastTemplateId) || normalized
      );
      setStockBroadcastTemplateStatus("✅ Đã cập nhật template stock broadcast.");
    } catch {
      setStockBroadcastTemplateStatus("Không thể cập nhật template stock broadcast.");
    }
  };

  const handleDeleteStockBroadcastTemplate = async () => {
    if (!selectedStockBroadcastTemplateId) {
      setStockBroadcastTemplateStatus("Chọn template cần xóa.");
      return;
    }
    try {
      const templates = await saveStockBroadcastTemplates(
        stockBroadcastTemplates.filter((template) => template.id !== selectedStockBroadcastTemplateId)
      );
      setSelectedStockBroadcastTemplateId(templates[0]?.id || DEFAULT_STOCK_BROADCAST_TEMPLATE.id);
      setStockBroadcastTemplateStatus("✅ Đã xóa template stock broadcast.");
    } catch {
      setStockBroadcastTemplateStatus("Không thể xóa template stock broadcast.");
    }
  };

  const handleAddStock = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedProductId) return;
    const lines = parseStockLines(content);
    if (!lines.length) return;
    setStockBroadcastStatus(null);

    try {
      await adminApiRequest("/api/admin/stock", {
        method: "POST",
        body: JSON.stringify({
          action: "add_bulk",
          productId: Number(selectedProductId),
          contents: lines
        })
      });
      setStockMutationMessage(`Đã thêm ${lines.length.toLocaleString("vi-VN")} stock.`);
    } catch (error) {
      setStockMutationMessage(error instanceof Error ? error.message : "Không thể thêm stock.");
      return;
    }
    setContent("");
    const nextSummary = await loadStockSummary(selectedProductId);
    if (page === 1) {
      await loadStock(selectedProductId, 1, pageSize);
    } else {
      setPage(1);
    }

    if (broadcastAfterAdd) {
      const message = renderTemplateText(
        selectedStockBroadcastTemplate.message || DEFAULT_STOCK_BROADCAST_TEMPLATE.message,
        {
          product_name: selectedProduct?.name || "Sản phẩm",
          added_count: lines.length,
          current_stock: nextSummary.remaining,
          total_stock: nextSummary.total
        }
      ).trim();
      if (!message) {
        setStockBroadcastStatus("Template broadcast đang trống nên không gửi.");
        return;
      }
      try {
        await adminApiRequest("/api/telegram/send", {
          method: "POST",
          body: JSON.stringify({ message, broadcast: true })
        });
        setStockBroadcastStatus("✅ Đã tạo broadcast sau khi thêm stock.");
      } catch (error) {
        setStockBroadcastStatus(error instanceof Error ? error.message : "Không thể broadcast sau khi thêm stock.");
      }
    }
  };

  const toggleSelectAllOnPage = (checked: boolean) => {
    setSelectedStockIds((prev) => {
      const next = new Set(prev);
      for (const item of stockItems) {
        if (checked) next.add(item.id);
        else next.delete(item.id);
      }
      return next;
    });
  };

  const toggleSelectOne = (id: number, checked: boolean) => {
    setSelectedStockIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const handleBulkEditSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (bulkBusy) return;
    const ids = Array.from(selectedStockIds);
    if (!ids.length) return;
    if (bulkSoldAction === "keep") {
      setBulkEditOpen(false);
      return;
    }
    setBulkBusy(true);
    const soldValue = bulkSoldAction === "sold";
    try {
      await adminApiRequest("/api/admin/stock", {
        method: "POST",
        body: JSON.stringify({
          action: "bulk_update_sold",
          ids,
          sold: soldValue
        })
      });
      setStockMutationMessage(`Đã cập nhật ${ids.length.toLocaleString("vi-VN")} stock.`);
    } catch (error) {
      setStockMutationMessage(error instanceof Error ? error.message : "Không thể cập nhật stock.");
      setBulkBusy(false);
      return;
    }
    setBulkBusy(false);
    setBulkEditOpen(false);
    setBulkSoldAction("keep");
    setSelectedStockIds(new Set());
    await loadStockSummary(selectedProductId);
    await loadStock(selectedProductId, page, pageSize);
  };

  const handleBulkDeleteConfirm = async () => {
    if (bulkBusy) return;
    const ids = Array.from(selectedStockIds);
    if (!ids.length) return;
    setBulkBusy(true);
    try {
      await adminApiRequest("/api/admin/stock", {
        method: "POST",
        body: JSON.stringify({
          action: "bulk_delete",
          ids
        })
      });
      setStockMutationMessage(`Đã xóa ${ids.length.toLocaleString("vi-VN")} stock.`);
    } catch (error) {
      setStockMutationMessage(error instanceof Error ? error.message : "Không thể xóa stock.");
      setBulkBusy(false);
      return;
    }
    setBulkBusy(false);
    setBulkDeleteOpen(false);
    setSelectedStockIds(new Set());
    await loadStockSummary(selectedProductId);
    const removedOnPage = stockItems.filter((item) => ids.includes(item.id)).length;
    const shouldGoPrev = removedOnPage === stockItems.length && page > 1;
    if (shouldGoPrev) setPage(page - 1);
    else await loadStock(selectedProductId, page, pageSize);
  };

  const prepareDeleteByText = async (event: React.FormEvent) => {
    event.preventDefault();
    if (deleteByTextBusy) return;
    if (!selectedProductId) return;
    const queries = parseStockLines(deleteContent);
    if (!queries.length) return;

    setDeleteByTextBusy(true);
    setDeleteByTextError(null);
    try {
      const matchedIds = new Set<number>();
      for (const query of queries) {
        const { data, error } = await supabase
          .from("stock")
          .select("id")
          .eq("product_id", Number(selectedProductId))
          .ilike("content", `%${query}%`)
          .range(0, 9999);
        if (error) throw error;
        for (const row of (data as Array<{ id: number }>) ?? []) {
          matchedIds.add(row.id);
        }
      }
      const ids = Array.from(matchedIds);
      setDeleteByTextPlan({ ids, queries });
      setDeleteByTextOpen(true);
    } catch (err) {
      setDeleteByTextError(err instanceof Error ? err.message : "Không thể kiểm tra stock cần xóa.");
    } finally {
      setDeleteByTextBusy(false);
    }
  };

  const handleDeleteByTextConfirm = async () => {
    if (!deleteByTextPlan) return;
    if (deleteByTextBusy) return;

    setDeleteByTextBusy(true);
    try {
      if (deleteByTextPlan.ids.length) {
        await adminApiRequest("/api/admin/stock", {
          method: "POST",
          body: JSON.stringify({
            action: "bulk_delete",
            ids: deleteByTextPlan.ids
          })
        });
      }
      setStockMutationMessage(`Đã xóa ${deleteByTextPlan.ids.length.toLocaleString("vi-VN")} stock theo nội dung.`);
      setDeleteByTextOpen(false);
      setDeleteByTextPlan(null);
      setDeleteContent("");
      setSelectedStockIds(new Set());
      await loadStockSummary(selectedProductId);
      if (page === 1) await loadStock(selectedProductId, 1, pageSize);
      else setPage(1);
    } finally {
      setDeleteByTextBusy(false);
    }
  };

  const startEdit = (item: StockItem) => {
    setEditingStock(item);
    setEditContent(item.content);
    setEditSold(item.sold);
  };

  const cancelEdit = () => {
    setEditingStock(null);
    setEditContent("");
    setEditSold(false);
  };

  const handleEditSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingStock) return;
    const cleaned = editContent.trim();
    if (!cleaned) return;
    try {
      await adminApiRequest("/api/admin/stock", {
        method: "POST",
        body: JSON.stringify({
          action: "update_one",
          stockId: editingStock.id,
          content: cleaned,
          sold: editSold
        })
      });
      setStockMutationMessage(`Đã cập nhật stock #${editingStock.id}.`);
    } catch (error) {
      setStockMutationMessage(error instanceof Error ? error.message : "Không thể cập nhật stock.");
      return;
    }
    cancelEdit();
    await loadStockSummary(selectedProductId);
    await loadStock(selectedProductId, page, pageSize);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteStock) return;
    try {
      await adminApiRequest("/api/admin/stock", {
        method: "POST",
        body: JSON.stringify({
          action: "delete_one",
          stockId: deleteStock.id
        })
      });
      setStockMutationMessage(`Đã xóa stock #${deleteStock.id}.`);
    } catch (error) {
      setStockMutationMessage(error instanceof Error ? error.message : "Không thể xóa stock.");
      return;
    }
    await loadStockSummary(selectedProductId);
    const shouldGoPrev = stockItems.length === 1 && page > 1;
    setDeleteStock(null);
    if (shouldGoPrev) {
      setPage(page - 1);
    } else {
      await loadStock(selectedProductId, page, pageSize);
    }
  };

  const customCheckTrueResults = customCheckResults.filter((item) => item.status === "true");
  const customCheckFalseResults = customCheckResults.filter((item) => item.status === "false");
  const customCheckErrorResults = customCheckResults.filter((item) => item.status === "error");

  const customCheckTrueLines = customCheckTrueResults.map((item) => item.content);
  const customCheckFalseLines = customCheckFalseResults.map((item) => item.content);
  const customCheckErrorLines = customCheckErrorResults.map((item) =>
    item.error
      ? `${item.content} | ${item.error}`
      : item.content
  );

  const customDeleteStatusLabels: Record<CustomCheckStatus, string> = {
    true: "True",
    false: "False",
    error: "Error"
  };

  const customSourceOptions = Array.from(
    new Set<CustomCheckSource>([...customSourceHistory, ...AVAILABLE_CUSTOM_SOURCES])
  );
  const customConcurrencyOptions = Array.from(
    new Set<number>([...customConcurrencyHistory, ...AVAILABLE_CUSTOM_CONCURRENCY])
  );

  const getCustomDeleteTargetIds = (status: CustomCheckStatus) =>
    customCheckResults.filter((item) => item.status === status).map((item) => item.stock_id);

  const handleRunCustomCheck = async () => {
    if (customCheckBusy) return;
    if (!selectedProductId) {
      setCustomCheckError("Vui lòng chọn sản phẩm trước khi custom check.");
      return;
    }
    if (customCheckScope === "selected" && selectedStockIds.size === 0) {
      setCustomCheckError("Vui lòng chọn ít nhất 1 stock trong bảng.");
      return;
    }

    const estimatedTotal =
      customCheckScope === "product" ? stockSummary.total : selectedStockIds.size;

    setCustomCheckBusy(true);
    setCustomCheckError(null);
    setCustomDeleteMessage(null);
    setCustomCheckResults([]);
    setCustomCheckProgress({ completed: 0, total: estimatedTotal });

    const trimmedSender = customCheckSenderFilter.trim();
    const trimmedSubject = customCheckSubjectFilter.trim();
    if (trimmedSender !== customCheckSenderFilter) {
      setCustomCheckSenderFilter(trimmedSender);
    }
    if (trimmedSubject !== customCheckSubjectFilter) {
      setCustomCheckSubjectFilter(trimmedSubject);
    }
    persistCustomCheckHistory({
      source: customCheckSource,
      mailColumnIndex: customCheckMailColumnIndex,
      senderFilter: trimmedSender,
      subjectFilter: trimmedSubject,
      concurrency: customCheckConcurrency
    });

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        setCustomCheckError("Chưa đăng nhập hoặc phiên làm việc đã hết hạn.");
        return;
      }

      const payload: {
        scope: CustomCheckScope;
        source: CustomCheckSource;
        senderFilter: string;
        subjectFilter: string;
        mailColumnIndex: number;
        concurrency: number;
        productId?: number;
        selectedStockIds?: number[];
      } = {
        scope: customCheckScope,
        source: customCheckSource,
        senderFilter: trimmedSender,
        subjectFilter: trimmedSubject,
        mailColumnIndex: customCheckMailColumnIndex,
        concurrency: customCheckConcurrency
      };

      if (customCheckScope === "product") {
        payload.productId = Number(selectedProductId);
      } else {
        payload.selectedStockIds = Array.from(selectedStockIds);
      }

      const response = await fetch("/api/stock/custom-check", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      const json = await response.json().catch(() => null);
      if (!response.ok) {
        const errorMessage =
          typeof json?.error === "string" ? json.error : "Không thể thực hiện custom check.";
        throw new Error(errorMessage);
      }

      const results = Array.isArray(json?.results) ? (json.results as CustomCheckResult[]) : [];
      const total = typeof json?.total === "number" ? json.total : results.length;
      setCustomCheckResults(results);
      if (results.some((item) => item.status === "error")) setCustomDeleteStatus("error");
      else if (results.some((item) => item.status === "false")) setCustomDeleteStatus("false");
      else setCustomDeleteStatus("true");
      setCustomCheckProgress({ completed: total, total });
    } catch (error) {
      setCustomCheckError(error instanceof Error ? error.message : "Không thể custom check.");
      setCustomCheckProgress({ completed: 0, total: 0 });
    } finally {
      setCustomCheckBusy(false);
    }
  };

  const handleDeleteByCustomStatus = async () => {
    if (customDeleteBusy || customCheckBusy) return;
    if (!selectedProductId) return;

    const targetIds = Array.from(new Set(getCustomDeleteTargetIds(customDeleteStatus)));
    if (!targetIds.length) {
      setCustomDeleteMessage(`Không có stock thuộc nhóm ${customDeleteStatusLabels[customDeleteStatus]} để xóa.`);
      return;
    }

    setPendingCustomDelete({
      productId: selectedProductId,
      status: customDeleteStatus,
      targetIds
    });
  };

  const executePendingCustomDelete = async () => {
    if (!pendingCustomDelete) return;
    const { productId, status, targetIds } = pendingCustomDelete;
    setCustomDeleteBusy(true);
    setCustomDeleteMessage(null);
    try {
      for (let i = 0; i < targetIds.length; i += 500) {
        const chunk = targetIds.slice(i, i + 500);
        await adminApiRequest("/api/admin/stock", {
          method: "POST",
          body: JSON.stringify({
            action: "bulk_delete",
            ids: chunk
          })
        });
      }

      setSelectedStockIds((prev) => {
        const next = new Set(prev);
        for (const id of targetIds) next.delete(id);
        return next;
      });

      setCustomCheckResults((prev) => prev.filter((item) => !targetIds.includes(item.stock_id)));
      setCustomDeleteMessage(
        `Đã xóa ${targetIds.length.toLocaleString("vi-VN")} stock nhóm ${customDeleteStatusLabels[status]}.`
      );

      await loadStockSummary(productId);
      await loadStock(productId, page, pageSize);
    } catch (error) {
      setCustomDeleteMessage(
        error instanceof Error ? error.message : "Không thể xóa stock theo nhóm kết quả."
      );
    } finally {
      setCustomDeleteBusy(false);
      setPendingCustomDelete(null);
    }
  };

  return (
    <div className="grid" style={{ gap: 24 }}>
      <div className="topbar">
        <div>
          <h1 className="page-title">Stock</h1>
          <p className="muted">Quản lý kho sản phẩm.</p>
        </div>
        <div className="page-actions">
          <button
            className="button"
            type="button"
            disabled={!selectedProductId}
            onClick={() => setStockActionPanelOpen((value) => !value)}
          >
            {stockActionPanelOpen ? "Đóng nhập/xóa" : "Nhập/Xóa stock"}
          </button>
          <button
            className="button secondary"
            type="button"
            disabled={!selectedProductId}
            onClick={() => setCustomCheckPanelOpen((value) => !value)}
          >
            {customCheckPanelOpen ? "Đóng custom check" : "Custom check"}
          </button>
        </div>
      </div>

      {stockMutationMessage && (
        <div className="card compact-card">
          <p className="muted">{stockMutationMessage}</p>
        </div>
      )}

      <div className="card">
        <h3 className="section-title">Chọn sản phẩm</h3>
        <div className="segmented" role="tablist" aria-label="Product filter tab" style={{ marginBottom: 12 }}>
          <button
            type="button"
            role="tab"
            aria-selected={productTab === "active"}
            className={`segmented-button ${productTab === "active" ? "active" : ""}`}
            onClick={() => setProductTab("active")}
          >
            Đang hoạt động
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={productTab === "inactive"}
            className={`segmented-button danger ${productTab === "inactive" ? "active" : ""}`}
            onClick={() => setProductTab("inactive")}
          >
            Đã hủy, Ẩn
          </button>
        </div>
        <div className="form-grid">
          <select
            className="select"
            value={selectedProductId}
            onChange={(event) => {
              setPage(1);
              setSelectedProductId(event.target.value);
            }}
          >
            <option value="">-- Chọn sản phẩm --</option>
            {filteredProducts.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
        </div>
        {!filteredProducts.length && (
          <p className="muted" style={{ marginTop: 8 }}>
            Không có sản phẩm trong nhóm {productTab === "active" ? "đang hoạt động" : "đã hủy, ẩn"}.
          </p>
        )}
        {selectedProductId && (
          <div className="grid stats" style={{ marginTop: 12 }}>
            <div className="card" style={{ boxShadow: "none", padding: 14 }}>
              <p className="muted">Tổng</p>
              <h2>{stockSummary.total.toLocaleString("vi-VN")}</h2>
            </div>
            <div className="card" style={{ boxShadow: "none", padding: 14 }}>
              <p className="muted">Đã bán</p>
              <h2>{stockSummary.sold.toLocaleString("vi-VN")}</h2>
            </div>
            <div className="card" style={{ boxShadow: "none", padding: 14 }}>
              <p className="muted">Còn lại</p>
              <h2>{stockSummary.remaining.toLocaleString("vi-VN")}</h2>
            </div>
          </div>
        )}
      </div>

      {stockActionPanelOpen && (
        <div className="card action-panel">
          <div className="section-head">
            <div>
              <h3 className="section-title">Nhập/Xóa stock</h3>
              <p className="muted">Các thao tác nhập hàng và xóa theo nội dung chỉ mở khi cần xử lý.</p>
            </div>
            <button className="button secondary" type="button" onClick={() => setStockActionPanelOpen(false)}>
              Đóng
            </button>
          </div>
        <div className="segmented" role="tablist" aria-label="Stock form" style={{ marginBottom: 12 }}>
          <button
            type="button"
            role="tab"
            aria-selected={stockFormTab === "add"}
            className={`segmented-button ${stockFormTab === "add" ? "active" : ""}`}
            onClick={() => setStockFormTab("add")}
          >
            Thêm
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={stockFormTab === "delete"}
            className={`segmented-button danger ${stockFormTab === "delete" ? "active" : ""}`}
            onClick={() => setStockFormTab("delete")}
          >
            Xóa
          </button>
        </div>

        {stockFormTab === "add" && (
          <form onSubmit={handleAddStock} className="form-split">
            <textarea
              className="textarea"
              placeholder="Mỗi dòng là 1 stock"
              value={content}
              onChange={(event) => setContent(event.target.value)}
            />
            <div className="form-section broadcast-compose">
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={broadcastAfterAdd}
                  onChange={(event) => setBroadcastAfterAdd(event.target.checked)}
                />
                <span>Broadcast cho tất cả user sau khi thêm stock</span>
              </label>
              {broadcastAfterAdd && (
                <>
                  <div className="broadcast-toolbar">
                    <select
                      className="select"
                      value={selectedStockBroadcastTemplateId}
                      onChange={(event) => selectStockBroadcastTemplate(event.target.value)}
                    >
                      {stockBroadcastTemplates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name}
                        </option>
                      ))}
                    </select>
                    <button
                      className="button secondary"
                      type="button"
                      onClick={() => {
                        setStockBroadcastTemplateStatus(null);
                        setStockBroadcastManagerOpen(true);
                      }}
                    >
                      Quản lý template
                    </button>
                  </div>
                  <div className="broadcast-confirm-preview">{stockBroadcastPreview}</div>
                </>
              )}
              {stockBroadcastStatus && <p className="muted">{stockBroadcastStatus}</p>}
            </div>
            <button className="button" type="submit" disabled={!selectedProductId}>
              Thêm stock
            </button>
          </form>
        )}

        {stockFormTab === "delete" && (
          <form onSubmit={prepareDeleteByText} className="form-split">
            <textarea
              className="textarea"
              placeholder="Mỗi dòng là 1 nội dung cần xóa (email / text / full content)"
              value={deleteContent}
              onChange={(event) => setDeleteContent(event.target.value)}
            />
            <button
              className="button danger"
              type="submit"
              disabled={!selectedProductId || deleteByTextBusy}
            >
              {deleteByTextBusy ? "Đang kiểm tra..." : "Xóa"}
            </button>
            {deleteByTextError && (
              <p className="muted" style={{ gridColumn: "1 / -1", color: "var(--danger)" }}>
                {deleteByTextError}
              </p>
            )}
            {!selectedProductId && (
              <p className="muted" style={{ gridColumn: "1 / -1" }}>
                Vui lòng chọn sản phẩm trước khi xóa.
              </p>
            )}
          </form>
        )}
        </div>
      )}

      {customCheckPanelOpen && (
        <div className="card action-panel">
          <div className="section-head">
            <div>
              <h3 className="section-title">Custom check</h3>
              <p className="muted">
                Logic giống <code>@email_inbox_extension</code>: lọc theo <code>Sender</code> và <code>Subject</code>.
              </p>
            </div>
            <button className="button secondary" type="button" onClick={() => setCustomCheckPanelOpen(false)}>
              Đóng
            </button>
          </div>
        <div className="form-grid">
          <div>
            <label className="muted" style={{ display: "block", marginBottom: 6 }}>
              Loại check
            </label>
            <select
              className="select"
              value={customCheckScope}
              onChange={(event) => setCustomCheckScope(event.target.value as CustomCheckScope)}
            >
              <option value="product">Product đã chọn (tất cả stock)</option>
              <option value="selected">Stock đã chọn trong bảng</option>
            </select>
          </div>
          <div>
            <label className="muted" style={{ display: "block", marginBottom: 6 }}>
              Nguồn check
            </label>
            <select
              className="select"
              value={customCheckSource}
              onChange={(event) => {
                const value = event.target.value as CustomCheckSource;
                setCustomCheckSource(value);
                persistCustomCheckHistory({ source: value });
              }}
            >
              {customSourceOptions.map((source) => (
                <option key={source} value={source}>
                  {source === "hotmail" ? "Hotmail" : source === "tempmail" ? "TempMail" : "TinyHost"}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="muted" style={{ display: "block", marginBottom: 6 }}>
              Cột Mail (phân tách dấu phẩy ,)
            </label>
            <input
              type="number"
              min={1}
              max={30}
              className="input"
              list="customCheckMailColumnHistoryList"
              value={customCheckMailColumnIndex}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (!Number.isFinite(value)) return;
                setCustomCheckMailColumnIndex(Math.max(1, Math.min(30, Math.floor(value))));
              }}
              onBlur={() =>
                persistCustomCheckHistory({
                  mailColumnIndex: customCheckMailColumnIndex
                })
              }
            />
            <datalist id="customCheckMailColumnHistoryList">
              {customMailColumnHistory.map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="muted" style={{ display: "block", marginBottom: 6 }}>
              Filter Sender
            </label>
            <input
              className="input"
              list="customCheckSenderHistoryList"
              placeholder="noreply@tm.openai.com"
              value={customCheckSenderFilter}
              onChange={(event) => setCustomCheckSenderFilter(event.target.value)}
              onBlur={(event) => {
                const trimmedValue = event.target.value.trim();
                if (trimmedValue !== customCheckSenderFilter) {
                  setCustomCheckSenderFilter(trimmedValue);
                }
                persistCustomCheckHistory({ senderFilter: trimmedValue });
              }}
            />
            <datalist id="customCheckSenderHistoryList">
              {customSenderHistory.map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="muted" style={{ display: "block", marginBottom: 6 }}>
              Filter Subject
            </label>
            <input
              className="input"
              list="customCheckSubjectHistoryList"
              placeholder="Kế hoạch mới"
              value={customCheckSubjectFilter}
              onChange={(event) => setCustomCheckSubjectFilter(event.target.value)}
              onBlur={(event) => {
                const trimmedValue = event.target.value.trim();
                if (trimmedValue !== customCheckSubjectFilter) {
                  setCustomCheckSubjectFilter(trimmedValue);
                }
                persistCustomCheckHistory({ subjectFilter: trimmedValue });
              }}
            />
            <datalist id="customCheckSubjectHistoryList">
              {customSubjectHistory.map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="muted" style={{ display: "block", marginBottom: 6 }}>
              Tốc độ check
            </label>
            <select
              className="select"
              value={customCheckConcurrency}
              onChange={(event) => {
                const value = Number(event.target.value);
                setCustomCheckConcurrency(value);
                persistCustomCheckHistory({ concurrency: value });
              }}
            >
              {customConcurrencyOptions.map((value) => (
                <option key={value} value={value}>
                  {value}x
                </option>
              ))}
            </select>
          </div>
        </div>

        <p className="muted" style={{ marginTop: 8 }}>
          Ví dụ stock dạng <code>uid,email,password,...</code> thì cột mail là <code>2</code>.
        </p>
        <p className="muted" style={{ marginTop: 4 }}>
          Hệ thống lưu 5 giá trị dùng gần nhất cho từng form và tự chọn giá trị mới dùng gần đây nhất khi mở lại.
        </p>

        <div className="table-actions" style={{ justifyContent: "space-between", marginTop: 12 }}>
          <div className="muted">
            {customCheckScope === "product"
              ? `Sẽ check toàn bộ ${stockSummary.total.toLocaleString("vi-VN")} stock của Product đang chọn.`
              : `Sẽ check ${selectedStockIds.size.toLocaleString("vi-VN")} stock đã chọn ở bảng.`}
          </div>
          <button
            type="button"
            className="button warning"
            onClick={handleRunCustomCheck}
            disabled={!selectedProductId || customCheckBusy}
          >
            {customCheckBusy ? "Đang check..." : "Chạy custom check"}
          </button>
        </div>

        {customCheckProgress.total > 0 && (
          <p className="muted" style={{ marginTop: 10 }}>
            Tiến độ: {customCheckProgress.completed}/{customCheckProgress.total}
          </p>
        )}

        {customCheckError && (
          <p className="muted" style={{ marginTop: 10, color: "var(--danger)" }}>
            {customCheckError}
          </p>
        )}

        {customCheckResults.length > 0 && (
          <div className="grid" style={{ gap: 12, marginTop: 12 }}>
            <div className="grid stats">
              <div className="card" style={{ boxShadow: "none", padding: 14 }}>
                <p className="muted">True</p>
                <h2>{customCheckTrueLines.length.toLocaleString("vi-VN")}</h2>
              </div>
              <div className="card" style={{ boxShadow: "none", padding: 14 }}>
                <p className="muted">False</p>
                <h2>{customCheckFalseLines.length.toLocaleString("vi-VN")}</h2>
              </div>
              <div className="card" style={{ boxShadow: "none", padding: 14 }}>
                <p className="muted">Error</p>
                <h2>{customCheckErrorLines.length.toLocaleString("vi-VN")}</h2>
              </div>
            </div>
            <div className="form-grid">
              <textarea
                className="textarea"
                rows={6}
                readOnly
                value={customCheckTrueLines.join("\n")}
                placeholder="Danh sách True"
              />
              <textarea
                className="textarea"
                rows={6}
                readOnly
                value={customCheckFalseLines.join("\n")}
                placeholder="Danh sách False"
              />
              <textarea
                className="textarea"
                rows={6}
                readOnly
                value={customCheckErrorLines.join("\n")}
                placeholder="Danh sách Error"
              />
            </div>
            <div className="table-actions" style={{ justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="muted">Xóa theo kết quả:</span>
                <select
                  className="select"
                  value={customDeleteStatus}
                  onChange={(event) => setCustomDeleteStatus(event.target.value as CustomCheckStatus)}
                  style={{ minWidth: 180 }}
                >
                  <option value="true">True ({customCheckTrueResults.length})</option>
                  <option value="false">False ({customCheckFalseResults.length})</option>
                  <option value="error">Error ({customCheckErrorResults.length})</option>
                </select>
              </div>
              <button
                type="button"
                className="button danger"
                onClick={handleDeleteByCustomStatus}
                disabled={customDeleteBusy || customCheckBusy}
              >
                {customDeleteBusy ? "Đang xóa..." : "Xóa nhóm đã chọn"}
              </button>
            </div>
            {customDeleteMessage && (
              <p
                className="muted"
                style={{
                  color: customDeleteMessage.startsWith("Đã xóa")
                    ? "#20705b"
                    : "var(--danger)"
                }}
              >
                {customDeleteMessage}
              </p>
            )}
          </div>
        )}
        </div>
      )}

      <div className="card">
        <h3 className="section-title">Danh sách stock</h3>
        <div className="table-actions" style={{ justifyContent: "space-between", marginBottom: 12 }}>
          <div className="muted">Đã chọn: {selectedStockIds.size}</div>
          <div className="table-actions">
            <button
              type="button"
              className="button secondary"
              disabled={!selectedStockIds.size}
              onClick={() => {
                setBulkSoldAction("keep");
                setBulkEditOpen(true);
              }}
            >
              Chỉnh sửa đã chọn
            </button>
            <button
              type="button"
              className="button danger"
              disabled={!selectedStockIds.size}
              onClick={() => setBulkDeleteOpen(true)}
            >
              Xóa đã chọn
            </button>
          </div>
        </div>
        <table className="table fixed">
          <colgroup>
            <col style={{ width: 44 }} />
            <col style={{ width: 80 }} />
            <col />
            <col style={{ width: 110 }} />
            <col style={{ width: 220 }} />
          </colgroup>
          <thead>
            <tr>
              <th className="checkbox-cell">
                <input
                  type="checkbox"
                  className="checkbox"
                  ref={selectAllRef}
                  aria-label="Chọn tất cả stock trong trang"
                  checked={
                    stockItems.length > 0 && stockItems.every((item) => selectedStockIds.has(item.id))
                  }
                  onChange={(event) => toggleSelectAllOnPage(event.target.checked)}
                />
              </th>
              <th>ID</th>
              <th>Nội dung</th>
              <th>Trạng thái</th>
              <th>Hành động</th>
            </tr>
          </thead>
          <tbody>
            {stockItems.map((item) => (
              <tr key={item.id}>
                <td className="checkbox-cell">
                  <input
                    type="checkbox"
                    className="checkbox"
                    aria-label={`Chọn stock #${item.id}`}
                    checked={selectedStockIds.has(item.id)}
                    onChange={(event) => toggleSelectOne(item.id, event.target.checked)}
                  />
                </td>
                <td>#{item.id}</td>
                <td>
                  <div className="cell-truncate" title={item.content}>
                    {item.content}
                  </div>
                </td>
                <td>{item.sold ? "Đã bán" : "Còn"}</td>
                <td className="row-actions-cell">
                  <RowActionMenu items={[
                    { label: "Chỉnh sửa", onSelect: () => startEdit(item) },
                    { label: "Xóa", tone: "danger", onSelect: () => setDeleteStock(item) }
                  ]} />
                </td>
              </tr>
            ))}
            {!stockItems.length && (
              <tr>
                <td colSpan={5} className="muted">{stockLoading ? "Đang tải stock..." : "Chưa có stock."}</td>
              </tr>
            )}
          </tbody>
        </table>
        <PaginationControls
          page={page}
          totalPages={totalPages}
          totalCount={totalCount}
          pageSize={pageSize}
          disabled={stockLoading}
          onPageChange={setPage}
          onPageSizeChange={(nextPageSize) => {
            setPageSize(nextPageSize);
            setPage(1);
          }}
        />
      </div>

      {editingStock && (
        <div className="modal-backdrop" onClick={cancelEdit}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h3 className="section-title">Chỉnh sửa stock #{editingStock.id}</h3>
            <form className="form-grid" onSubmit={handleEditSave}>
              <textarea
                className="textarea form-section"
                placeholder="Nội dung stock"
                value={editContent}
                onChange={(event) => setEditContent(event.target.value)}
              />
              <div className="toggle">
                <input
                  type="checkbox"
                  checked={editSold}
                  onChange={(event) => setEditSold(event.target.checked)}
                />
                Đã bán
              </div>
              <div className="modal-actions">
                <button className="button" type="submit">Lưu</button>
                <button className="button secondary" type="button" onClick={cancelEdit}>Hủy</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteStock && (
        <div className="modal-backdrop" onClick={() => setDeleteStock(null)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h3 className="section-title">Xóa stock #{deleteStock.id}</h3>
            <p className="muted" style={{ marginTop: 8 }}>
              Bạn có chắc muốn xóa stock này?
            </p>
            <div className="modal-actions">
              <button className="button danger" type="button" onClick={handleDeleteConfirm}>Xóa</button>
              <button className="button secondary" type="button" onClick={() => setDeleteStock(null)}>Hủy</button>
            </div>
          </div>
        </div>
      )}

      {bulkEditOpen && (
        <div className="modal-backdrop" onClick={() => setBulkEditOpen(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h3 className="section-title">Chỉnh sửa {selectedStockIds.size} stock</h3>
            <form className="form-grid" onSubmit={handleBulkEditSave}>
              <select
                className="select form-section"
                value={bulkSoldAction}
                onChange={(event) =>
                  setBulkSoldAction(event.target.value as "keep" | "available" | "sold")
                }
              >
                <option value="keep">Giữ nguyên trạng thái</option>
                <option value="available">Đánh dấu còn</option>
                <option value="sold">Đánh dấu đã bán</option>
              </select>
              <div className="modal-actions">
                <button className="button" type="submit" disabled={bulkBusy}>
                  {bulkBusy ? "Đang lưu..." : "Lưu"}
                </button>
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => setBulkEditOpen(false)}
                  disabled={bulkBusy}
                >
                  Hủy
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {bulkDeleteOpen && (
        <div className="modal-backdrop" onClick={() => setBulkDeleteOpen(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h3 className="section-title">Xóa {selectedStockIds.size} stock</h3>
            <p className="muted" style={{ marginTop: 8 }}>
              Bạn có chắc muốn xóa {selectedStockIds.size} stock đã chọn?
            </p>
            <div className="modal-actions">
              <button
                className="button danger"
                type="button"
                onClick={handleBulkDeleteConfirm}
                disabled={bulkBusy}
              >
                {bulkBusy ? "Đang xóa..." : "Xóa"}
              </button>
              <button
                className="button secondary"
                type="button"
                onClick={() => setBulkDeleteOpen(false)}
                disabled={bulkBusy}
              >
                Hủy
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteByTextOpen && deleteByTextPlan && (
        <div className="modal-backdrop" onClick={() => setDeleteByTextOpen(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h3 className="section-title">Xác nhận xóa stock</h3>
            <p className="muted" style={{ marginTop: 8 }}>
              Tìm thấy {deleteByTextPlan.ids.length} stock khớp với {deleteByTextPlan.queries.length} dòng nhập vào.
              Bạn có chắc muốn xóa?
            </p>
            <div className="modal-actions">
              <button
                className="button danger"
                type="button"
                onClick={handleDeleteByTextConfirm}
                disabled={deleteByTextBusy || deleteByTextPlan.ids.length === 0}
              >
                {deleteByTextBusy ? "Đang xóa..." : "Xóa"}
              </button>
              <button
                className="button secondary"
                type="button"
                onClick={() => setDeleteByTextOpen(false)}
                disabled={deleteByTextBusy}
              >
                Hủy
              </button>
            </div>
          </div>
        </div>
      )}

      {stockBroadcastManagerOpen && (
        <div className="modal-backdrop" onClick={() => setStockBroadcastManagerOpen(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h3 className="section-title">Quản lý template stock broadcast</h3>
            <div className="form-grid">
              <select
                className="select form-section"
                value={selectedStockBroadcastTemplateId}
                onChange={(event) => selectStockBroadcastTemplate(event.target.value)}
              >
                {stockBroadcastTemplates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
              <input
                className="input form-section"
                placeholder="Tên template"
                value={stockBroadcastTemplateDraft.name}
                onChange={(event) =>
                  setStockBroadcastTemplateDraft({ ...stockBroadcastTemplateDraft, name: event.target.value })
                }
              />
              <textarea
                className="textarea form-section"
                placeholder="Message template. Biến: {product_name}, {added_count}, {current_stock}, {total_stock}. Emoji: {emoji:12345}"
                rows={8}
                value={stockBroadcastTemplateDraft.message}
                onChange={(event) =>
                  setStockBroadcastTemplateDraft({ ...stockBroadcastTemplateDraft, message: event.target.value })
                }
              />
              {stockBroadcastTemplateStatus && (
                <p className="muted form-section" style={{ marginTop: -4 }}>
                  {stockBroadcastTemplateStatus}
                </p>
              )}
              <div className="broadcast-confirm-preview form-section">
                {renderTemplateText(
                  stockBroadcastTemplateDraft.message || DEFAULT_STOCK_BROADCAST_TEMPLATE.message,
                  {
                    product_name: selectedProduct?.name || "Sản phẩm",
                    added_count: stockAddLineCount || 3,
                    current_stock: stockSummary.remaining + (stockAddLineCount || 3),
                    total_stock: stockSummary.total + (stockAddLineCount || 3)
                  }
                )}
              </div>
              <div className="modal-actions">
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => setStockBroadcastManagerOpen(false)}
                >
                  Đóng
                </button>
                <button
                  className="button secondary"
                  type="button"
                  onClick={handleDeleteStockBroadcastTemplate}
                  disabled={!selectedStockBroadcastTemplateId}
                >
                  Xóa
                </button>
                <button
                  className="button secondary"
                  type="button"
                  onClick={handleUpdateStockBroadcastTemplate}
                  disabled={!selectedStockBroadcastTemplateId || !stockBroadcastTemplateDraft.message.trim()}
                >
                  Cập nhật
                </button>
                <button
                  className="button"
                  type="button"
                  onClick={handleAddStockBroadcastTemplate}
                  disabled={!stockBroadcastTemplateDraft.message.trim()}
                >
                  Thêm mới
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingCustomDelete)}
        title="Xóa stock theo kết quả custom check?"
        description={
          pendingCustomDelete ? (
            <>
              Xóa {pendingCustomDelete.targetIds.length.toLocaleString("vi-VN")} stock thuộc nhóm{" "}
              <strong>{customDeleteStatusLabels[pendingCustomDelete.status]}</strong>. Thao tác này không thể hoàn tác.
            </>
          ) : null
        }
        confirmLabel="Xóa stock"
        busy={customDeleteBusy}
        onConfirm={executePendingCustomDelete}
        onCancel={() => setPendingCustomDelete(null)}
      />
    </div>
  );
}
