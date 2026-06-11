"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { adminApiGet, adminApiRequest } from "@/lib/adminOpsClient";
import { ConfirmDialog, DataTable, EmptyState, PageHeader, RowActionMenu, SectionCard, StatCard, StatusPill } from "@/components/AdminUi";

type MailOtpGate = {
  id: number;
  displayOrder: number;
  email: string;
  normalizedEmail: string;
  active: boolean;
  note: string;
  otp: string;
  hasOtp: boolean;
  lastCheckedAt: string | null;
  lastVerifiedAt: string | null;
  checkCount: number;
  verifyCount: number;
  createdAt: string | null;
  updatedAt: string | null;
};

type GeneratedOtp = {
  id: number;
  displayOrder: number;
  email: string;
  normalizedEmail: string;
  otp: string;
};

type MailManagerSnapshot = {
  gates: MailOtpGate[];
  limit: number;
  missingOtpCount: number;
};

type BulkImportResult = {
  gates: MailOtpGate[];
  generatedOtps: GeneratedOtp[];
  importedCount: number;
  requestedCount: number;
  invalidCount: number;
  duplicateCount: number;
  providedOtpCount: number;
  generatedOtpCount: number;
  errors?: string[];
};

type RandomOtpResult = {
  gates: MailOtpGate[];
  generatedOtps: GeneratedOtp[];
  count: number;
  scope: "all" | "ids" | "filter";
  batch?: BatchPreview;
};

type FillMissingOtpResult = {
  gates: MailOtpGate[];
  generatedOtps: GeneratedOtp[];
  count: number;
  missingOtpCount: number;
  remainingMissingOtpCount: number;
};

type MailManagerFilterPayload = {
  query: string;
  status: "all" | "active" | "inactive";
};

type BatchTargetScope = "selected" | "filtered";

type BatchPreview = {
  operation: string;
  scope: "ids" | "filter" | "all";
  filter?: MailManagerFilterPayload;
  count: number;
  requestedCount: number;
  limit: number;
  idsPreview: number[];
  emailsPreview: string[];
};

type BatchPreviewResult = {
  preview: BatchPreview;
};

type PendingBatchAction = {
  targetScope: BatchTargetScope;
  preview: BatchPreview;
};

type BusyAction = "import" | "random" | "fill_missing" | "bulk_edit" | "bulk_delete" | "batch_preview";

type BulkEditResult = {
  gates: MailOtpGate[];
  count: number;
  requestedCount: number;
  activeChanged: boolean;
  noteChanged: boolean;
  otpChanged: boolean;
  batch?: BatchPreview;
};

type BulkDeleteResult = {
  deletedIds: number[];
  deletedGates: MailOtpGate[];
  count: number;
  requestedCount: number;
  batch?: BatchPreview;
};

type StatusState = {
  tone: "success" | "danger" | "warning";
  text: string;
} | null;

type DraftState = {
  id: number | null;
  email: string;
  otp: string;
  active: boolean;
  note: string;
};

type BulkEditDraft = {
  activeMode: "keep" | "active" | "inactive";
  noteMode: "keep" | "replace" | "clear";
  note: string;
  otp: string;
};

type CsvImportRow = {
  position?: string;
  email?: string;
  otp?: string;
  active?: string;
  note?: string;
};

type PendingRandom = {
  scope: "all" | "ids";
  ids: number[];
  title: string;
  description: string;
};

const createEmptyDraft = (): DraftState => ({
  id: null,
  email: "",
  otp: "",
  active: true,
  note: ""
});

const createEmptyBulkEditDraft = (): BulkEditDraft => ({
  activeMode: "keep",
  noteMode: "keep",
  note: "",
  otp: ""
});

const formatDateTime = (value: string | null) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
};

const getCheckRatio = (gate: MailOtpGate) => {
  if (!gate.checkCount) return "0%";
  return `${Math.round((gate.verifyCount / gate.checkCount) * 100)}%`;
};

const escapeCsv = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;

const toCsvText = (rows: unknown[][]) => rows.map((row) => row.map(escapeCsv).join(",")).join("\r\n");

const downloadCsv = (filename: string, rows: unknown[][]) => {
  const csv = toCsvText(rows);
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

const createClientRandomOtp = (length = 6) => {
  const safeLength = Math.min(Math.max(Math.trunc(length) || 6, 4), 32);
  const values = new Uint32Array(safeLength);
  globalThis.crypto?.getRandomValues(values);
  return Array.from(values, (value) => String(value % 10)).join("");
};

const parseCsvMatrix = (text: string) => {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  row.push(field);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
};

const normalizeCsvHeader = (value: string) =>
  value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

const headerAliases: Record<string, keyof CsvImportRow> = {
  position: "position",
  display_order: "position",
  order: "position",
  sort_order: "position",
  index: "position",
  stt: "position",
  vi_tri: "position",
  email: "email",
  mail: "email",
  address: "email",
  email_address: "email",
  normalized_email: "email",
  otp: "otp",
  code: "otp",
  otp_code: "otp",
  active: "active",
  enabled: "active",
  status: "active",
  note: "note",
  notes: "note",
  memo: "note"
};

const parseCsvForImport = (text: string) => {
  const matrix = parseCsvMatrix(text);
  const errors: string[] = [];
  if (!matrix.length) return { rows: [] as CsvImportRow[], errors: ["CSV trống."] };

  const firstRowHeaders = matrix[0].map(normalizeCsvHeader);
  const hasHeader = firstRowHeaders.some((header) => headerAliases[header]);
  const headers = hasHeader ? firstRowHeaders : ["email", "otp", "note", "active"];
  const dataRows = hasHeader ? matrix.slice(1) : matrix;

  const rows = dataRows
    .map((cells, index) => {
      const row: CsvImportRow = {};
      headers.forEach((header, columnIndex) => {
        const key = headerAliases[header];
        if (!key) return;
        row[key] = String(cells[columnIndex] ?? "").trim();
      });
      if (!row.email && cells[0]?.trim()) row.email = cells[0].trim();
      if (!row.email) errors.push(`Dòng ${index + (hasHeader ? 2 : 1)}: thiếu email.`);
      return row;
    })
    .filter((row) => row.email || row.otp || row.note || row.active);

  if (!rows.length) errors.push("CSV không có dòng dữ liệu.");
  return { rows, errors };
};

const buildGateCsvRows = (gates: MailOtpGate[]) => [
  ["position", "email", "otp", "active", "note", "has_otp", "check_count", "verify_count", "last_checked_at", "last_verified_at", "updated_at"],
  ...gates.map((gate) => [
    gate.displayOrder || "",
    gate.email,
    gate.otp || "",
    gate.active ? "true" : "false",
    gate.note,
    gate.hasOtp ? "true" : "false",
    gate.checkCount,
    gate.verifyCount,
    gate.lastCheckedAt || "",
    gate.lastVerifiedAt || "",
    gate.updatedAt || ""
  ])
];

const buildGeneratedOtpCsvRows = (items: GeneratedOtp[]) => [
  ["position", "email", "otp"],
  ...items.map((item) => [item.displayOrder || "", item.email, item.otp])
];

const downloadGeneratedOtpsCsv = (items: GeneratedOtp[], prefix = "mail-manager-generated-otps") => {
  if (!items.length) return;
  const date = new Date().toISOString().slice(0, 10);
  downloadCsv(`${prefix}-${date}.csv`, buildGeneratedOtpCsvRows(items));
};

const downloadGateBatchCsv = (gates: MailOtpGate[], prefix: string) => {
  if (!gates.length) return;
  const date = new Date().toISOString().slice(0, 10);
  downloadCsv(`${prefix}-${date}.csv`, buildGateCsvRows(gates));
};

export default function MailManagerPage() {
  const [gates, setGates] = useState<MailOtpGate[]>([]);
  const [draft, setDraft] = useState<DraftState>(createEmptyDraft);
  const [status, setStatus] = useState<StatusState>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyAction, setBusyAction] = useState<BusyAction | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [pendingDelete, setPendingDelete] = useState<MailOtpGate | null>(null);
  const [pendingRandom, setPendingRandom] = useState<PendingRandom | null>(null);
  const [pendingFillMissing, setPendingFillMissing] = useState(false);
  const [pendingBulkEdit, setPendingBulkEdit] = useState<PendingBatchAction | null>(null);
  const [pendingBulkDelete, setPendingBulkDelete] = useState<PendingBatchAction | null>(null);
  const [bulkEditDraft, setBulkEditDraft] = useState<BulkEditDraft>(createEmptyBulkEditDraft);
  const [batchTargetScope, setBatchTargetScope] = useState<BatchTargetScope>("selected");
  const [selectedGateIds, setSelectedGateIds] = useState<Set<number>>(new Set());
  const [missingOtpCount, setMissingOtpCount] = useState(0);
  const [generatedOtps, setGeneratedOtps] = useState<GeneratedOtp[]>([]);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const selectAllRef = useRef<HTMLInputElement | null>(null);

  const stats = useMemo(() => {
    const active = gates.filter((gate) => gate.active).length;
    const checked = gates.filter((gate) => gate.lastCheckedAt).length;
    const verified = gates.filter((gate) => gate.lastVerifiedAt).length;
    return { active, inactive: gates.length - active, checked, verified };
  }, [gates]);

  const filteredGates = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return gates.filter((gate) => {
      if (statusFilter === "active" && !gate.active) return false;
      if (statusFilter === "inactive" && gate.active) return false;
      if (!needle) return true;
      return [gate.email, gate.normalizedEmail, gate.note].some((value) =>
        value.toLowerCase().includes(needle)
      );
    });
  }, [gates, query, statusFilter]);

  const selectedVisibleCount = useMemo(
    () => filteredGates.filter((gate) => selectedGateIds.has(gate.id)).length,
    [filteredGates, selectedGateIds]
  );

  const currentFilterPayload = useMemo<MailManagerFilterPayload>(
    () => ({ query: query.trim(), status: statusFilter }),
    [query, statusFilter]
  );
  const generatedOtpCsvRows = useMemo(() => buildGeneratedOtpCsvRows(generatedOtps), [generatedOtps]);
  const generatedOtpCsvText = useMemo(() => toCsvText(generatedOtpCsvRows), [generatedOtpCsvRows]);
  const hasBusyAction = Boolean(busyAction);
  const hasBatchCandidates = batchTargetScope === "selected" ? selectedGateIds.size > 0 : filteredGates.length > 0;
  const batchTargetLabel = batchTargetScope === "selected" ? "mail đã chọn" : "kết quả lọc";

  useEffect(() => {
    const element = selectAllRef.current;
    if (!element) return;
    element.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < filteredGates.length;
  }, [filteredGates.length, selectedVisibleCount]);

  const loadGates = async (force = false) => {
    setLoading(true);
    try {
      const data = await adminApiGet<MailManagerSnapshot>("/api/admin/mail-manager", { force });
      setGates(data.gates || []);
      setMissingOtpCount(Number(data.missingOtpCount || 0));
      setSelectedGateIds(new Set());
    } catch (error) {
      setStatus({
        tone: "danger",
        text: error instanceof Error ? error.message : "Không thể tải Mail Manager."
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadGates(true);
  }, []);

  const editGate = (gate: MailOtpGate) => {
    setDraft({
      id: gate.id,
      email: gate.email,
      otp: "",
      active: gate.active,
      note: gate.note || ""
    });
    setStatus(null);
  };

  const saveGate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    try {
      await adminApiRequest<{ gate: MailOtpGate }>("/api/admin/mail-manager", {
        method: "POST",
        body: JSON.stringify({
          action: "save_gate",
          gateId: draft.id,
          email: draft.email,
          otp: draft.otp,
          active: draft.active,
          note: draft.note
        })
      });
      setDraft((current) => ({
        ...createEmptyDraft(),
        active: current.active
      }));
      await loadGates(true);
      setStatus({ tone: "success", text: "Đã lưu Mail OTP gate." });
    } catch (error) {
      setStatus({
        tone: "danger",
        text: error instanceof Error ? error.message : "Không thể lưu mail OTP."
      });
    } finally {
      setSaving(false);
    }
  };

  const toggleGate = async (gate: MailOtpGate) => {
    try {
      await adminApiRequest("/api/admin/mail-manager", {
        method: "POST",
        body: JSON.stringify({ action: "toggle_gate", gateId: gate.id, active: !gate.active })
      });
      await loadGates(true);
      setStatus({ tone: "success", text: gate.active ? "Đã tắt OTP gate." : "Đã bật OTP gate." });
    } catch (error) {
      setStatus({
        tone: "danger",
        text: error instanceof Error ? error.message : "Không thể đổi trạng thái."
      });
    }
  };

  const deleteGate = async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    try {
      await adminApiRequest("/api/admin/mail-manager", {
        method: "POST",
        body: JSON.stringify({ action: "delete_gate", gateId: target.id })
      });
      if (draft.id === target.id) setDraft(createEmptyDraft());
      await loadGates(true);
      setStatus({ tone: "success", text: "Đã xóa mail khỏi Mail Manager." });
    } catch (error) {
      setStatus({
        tone: "danger",
        text: error instanceof Error ? error.message : "Không thể xóa mail."
      });
    }
  };

  const toggleSelectAllVisible = (checked: boolean) => {
    setSelectedGateIds((current) => {
      const next = new Set(current);
      filteredGates.forEach((gate) => {
        if (checked) next.add(gate.id);
        else next.delete(gate.id);
      });
      return next;
    });
  };

  const toggleSelectOne = (gateId: number, checked: boolean) => {
    setSelectedGateIds((current) => {
      const next = new Set(current);
      if (checked) next.add(gateId);
      else next.delete(gateId);
      return next;
    });
  };

  const openRandomConfirm = (ids: number[], label: string) => {
    setPendingRandom({
      scope: "ids",
      ids,
      title: ids.length === 1 ? "Random OTP cho mail này?" : "Random OTP cho mail đã chọn?",
      description: ids.length === 1
        ? `OTP hiện tại của ${label} sẽ bị thay bằng OTP mới.`
        : `${ids.length.toLocaleString("vi-VN")} mail đang chọn sẽ bị thay bằng OTP mới.`
    });
  };

  const openRandomAllConfirm = () => {
    setPendingRandom({
      scope: "all",
      ids: [],
      title: "Random OTP cho tất cả mail?",
      description: "Toàn bộ OTP đang lưu sẽ bị rotate. OTP cũ sẽ không dùng được nữa."
    });
  };

  const publishGeneratedOtps = (items: GeneratedOtp[], options: { autoDownloadPrefix?: string } = {}) => {
    setGeneratedOtps(items);
    if (items.length && options.autoDownloadPrefix) downloadGeneratedOtpsCsv(items, options.autoDownloadPrefix);
  };

  const runBatchAction = async <T,>(
    action: BusyAction,
    request: () => Promise<T>,
    onSuccess: (data: T) => Promise<void> | void,
    fallbackError: string
  ) => {
    setBusyAction(action);
    try {
      const data = await request();
      await onSuccess(data);
    } catch (error) {
      setStatus({
        tone: "danger",
        text: error instanceof Error ? error.message : fallbackError
      });
    } finally {
      setBusyAction(null);
    }
  };

  const buildBatchTargetPayload = (targetScope: BatchTargetScope, preview?: BatchPreview) => {
    if (targetScope === "selected") return { scope: "ids", ids: Array.from(selectedGateIds) };
    return { scope: "filter", filter: preview?.filter || currentFilterPayload };
  };

  const previewBatchAction = async (operation: "bulk_edit" | "bulk_delete", targetScope: BatchTargetScope) => {
    const data = await adminApiRequest<BatchPreviewResult>("/api/admin/mail-manager", {
      method: "POST",
      body: JSON.stringify({
        action: "preview_batch",
        operation,
        ...buildBatchTargetPayload(targetScope)
      })
    });
    return data.preview;
  };

  const openBulkEdit = async () => {
    if (!hasBatchCandidates) {
      setStatus({ tone: "warning", text: `Không có ${batchTargetLabel} để Bulk Edit.` });
      return;
    }

    setBusyAction("batch_preview");
    try {
      const preview = await previewBatchAction("bulk_edit", batchTargetScope);
      if (!preview.count) {
        setStatus({ tone: "warning", text: "Filter hiện tại không match mail nào để Bulk Edit." });
        return;
      }
      setBulkEditDraft(createEmptyBulkEditDraft());
      setPendingBulkEdit({ targetScope: batchTargetScope, preview });
      setStatus(null);
    } catch (error) {
      setStatus({
        tone: "danger",
        text: error instanceof Error ? error.message : "Không thể preview Bulk Edit."
      });
    } finally {
      setBusyAction(null);
    }
  };

  const openBulkDelete = async () => {
    if (!hasBatchCandidates) {
      setStatus({ tone: "warning", text: `Không có ${batchTargetLabel} để Bulk Delete.` });
      return;
    }

    setBusyAction("batch_preview");
    try {
      const preview = await previewBatchAction("bulk_delete", batchTargetScope);
      if (!preview.count) {
        setStatus({ tone: "warning", text: "Filter hiện tại không match mail nào để Bulk Delete." });
        return;
      }
      setPendingBulkDelete({ targetScope: batchTargetScope, preview });
      setStatus(null);
    } catch (error) {
      setStatus({
        tone: "danger",
        text: error instanceof Error ? error.message : "Không thể preview Bulk Delete."
      });
    } finally {
      setBusyAction(null);
    }
  };

  const confirmRandomOtp = async () => {
    if (!pendingRandom) return;
    await runBatchAction<RandomOtpResult>(
      "random",
      () => adminApiRequest<RandomOtpResult>("/api/admin/mail-manager", {
        method: "POST",
        body: JSON.stringify({
          action: "random_otp",
          scope: pendingRandom.scope,
          ids: pendingRandom.ids
        })
      }),
      async (data) => {
        publishGeneratedOtps(data.generatedOtps || []);
        await loadGates(true);
        setStatus({
          tone: "success",
          text: `Đã random OTP cho ${data.count.toLocaleString("vi-VN")} mail. Lưu lại danh sách OTP vừa tạo trước khi rời trang.`
        });
        setPendingRandom(null);
      },
      "Không thể random OTP."
    );
  };

  const confirmFillMissingOtp = async () => {
    await runBatchAction<FillMissingOtpResult>(
      "fill_missing",
      () => adminApiRequest<FillMissingOtpResult>("/api/admin/mail-manager", {
        method: "POST",
        body: JSON.stringify({ action: "fill_missing_otp" })
      }),
      async (data) => {
        const items = data.generatedOtps || [];
        publishGeneratedOtps(items, { autoDownloadPrefix: "mail-manager-fill-missing-otps" });
        setMissingOtpCount(Number(data.remainingMissingOtpCount || 0));
        await loadGates(true);
        setStatus({
          tone: "success",
          text: data.count
            ? `Đã fill OTP cho ${data.count.toLocaleString("vi-VN")} legacy mail và đã xuất CSV OTP vừa tạo.`
            : "Không còn legacy mail thiếu OTP để fill."
        });
        setPendingFillMissing(false);
      },
      "Không thể fill missing OTP."
    );
  };

  const confirmBulkEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!pendingBulkEdit) return;

    const otp = bulkEditDraft.otp.trim();
    const activeChanged = bulkEditDraft.activeMode !== "keep";
    const noteChanged = bulkEditDraft.noteMode !== "keep";
    if (!activeChanged && !noteChanged && !otp) {
      setStatus({ tone: "warning", text: "Chọn ít nhất 1 trường để Bulk Edit." });
      return;
    }

    await runBatchAction<BulkEditResult>(
      "bulk_edit",
      () => adminApiRequest<BulkEditResult>("/api/admin/mail-manager", {
        method: "POST",
        body: JSON.stringify({
          action: "bulk_edit",
          ...buildBatchTargetPayload(pendingBulkEdit.targetScope, pendingBulkEdit.preview),
          activeMode: bulkEditDraft.activeMode,
          noteMode: bulkEditDraft.noteMode,
          note: bulkEditDraft.note,
          otp
        })
      }),
      async (data) => {
        const fields = [
          data.activeChanged ? "trạng thái" : "",
          data.noteChanged ? "ghi chú" : "",
          data.otpChanged ? "OTP" : ""
        ].filter(Boolean).join(", ");
        setGeneratedOtps([]);
        downloadGateBatchCsv(data.gates || [], "mail-manager-bulk-edit-affected");
        await loadGates(true);
        setPendingBulkEdit(null);
        setBulkEditDraft(createEmptyBulkEditDraft());
        setStatus({
          tone: "success",
          text: `Đã Bulk Edit ${data.count.toLocaleString("vi-VN")} mail${fields ? ` (${fields})` : ""} và đã xuất CSV affected rows.`
        });
      },
      "Không thể Bulk Edit mail."
    );
  };

  const confirmBulkDelete = async () => {
    if (!pendingBulkDelete) return;

    await runBatchAction<BulkDeleteResult>(
      "bulk_delete",
      () => adminApiRequest<BulkDeleteResult>("/api/admin/mail-manager", {
        method: "POST",
        body: JSON.stringify({
          action: "bulk_delete",
          ...buildBatchTargetPayload(pendingBulkDelete.targetScope, pendingBulkDelete.preview)
        })
      }),
      async (data) => {
        if (draft.id && data.deletedIds.includes(draft.id)) setDraft(createEmptyDraft());
        setGeneratedOtps([]);
        downloadGateBatchCsv(data.deletedGates || [], "mail-manager-bulk-delete-affected");
        await loadGates(true);
        setPendingBulkDelete(null);
        setStatus({
          tone: "success",
          text: `Đã Bulk Delete ${data.count.toLocaleString("vi-VN")} mail khỏi Mail Manager và đã xuất CSV affected rows.`
        });
      },
      "Không thể Bulk Delete mail."
    );
  };
  const handleImportCsv = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setBusyAction("import");
    setImportErrors([]);
    try {
      const text = await file.text();
      const parsed = parseCsvForImport(text);
      if (!parsed.rows.length) {
        setImportErrors(parsed.errors);
        setStatus({ tone: "danger", text: "CSV không có mail hợp lệ để import." });
        return;
      }

      const data = await adminApiRequest<BulkImportResult>("/api/admin/mail-manager", {
        method: "POST",
        body: JSON.stringify({ action: "bulk_import", rows: parsed.rows })
      });
      const mergedErrors = [...parsed.errors, ...(data.errors || [])].slice(0, 25);
      setImportErrors(mergedErrors);
      publishGeneratedOtps(data.generatedOtps || []);
      await loadGates(true);
      setStatus({
        tone: mergedErrors.length ? "warning" : "success",
        text: `Đã import ${data.importedCount.toLocaleString("vi-VN")}/${data.requestedCount.toLocaleString("vi-VN")} dòng và giữ vị trí CSV. ${data.generatedOtpCount.toLocaleString("vi-VN")} OTP được random, ${data.providedOtpCount.toLocaleString("vi-VN")} OTP lấy từ CSV.`
      });
    } catch (error) {
      setStatus({
        tone: "danger",
        text: error instanceof Error ? error.message : "Không thể import CSV."
      });
    } finally {
      setBusyAction(null);
    }
  };

  const exportGatesCsv = async () => {
    const date = new Date().toISOString().slice(0, 10);
    try {
      const snapshot = await adminApiGet<MailManagerSnapshot>("/api/admin/mail-manager?limit=5000", { force: true });
      downloadCsv(`mail-manager-gates-${date}.csv`, buildGateCsvRows(snapshot.gates || []));
    } catch (error) {
      setStatus({
        tone: "danger",
        text: error instanceof Error ? error.message : "Không thể export CSV."
      });
    }
  };

  const exportGeneratedOtpsCsv = () => {
    downloadGeneratedOtpsCsv(generatedOtps);
  };

  const copyGeneratedOtps = async () => {
    if (!generatedOtps.length) return;
    try {
      await navigator.clipboard.writeText(generatedOtpCsvText);
      setStatus({ tone: "success", text: "Đã copy CSV OTP vừa tạo." });
    } catch {
      setStatus({ tone: "warning", text: "Không thể copy tự động, hãy export CSV OTP." });
    }
  };

  const draftMode = draft.id ? "Cập nhật" : "Thêm mới";
  const selectedIds = Array.from(selectedGateIds);

  return (
    <div className="grid mail-manager-page">
      <PageHeader
        title="Mail Manager"
        description="Quản lý danh sách mail phải xác minh OTP trước khi hệ thống đọc inbox."
        actions={
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleImportCsv}
              style={{ display: "none" }}
            />
            <button className="button secondary" type="button" onClick={() => loadGates(true)} disabled={loading || hasBusyAction}>
              {loading ? "Đang tải..." : "Tải lại"}
            </button>
            <button className="button secondary" type="button" onClick={() => fileInputRef.current?.click()} disabled={hasBusyAction}>
              {busyAction === "import" ? "Đang import..." : "Import CSV"}
            </button>
            <button className="button secondary" type="button" onClick={() => void exportGatesCsv()} disabled={loading || hasBusyAction}>
              Export CSV
            </button>
            <button className="button" type="button" onClick={() => setDraft(createEmptyDraft())}>
              Mail mới
            </button>
          </>
        }
      />

      <div className="grid stats">
        <StatCard label="Protected mails" value={gates.length} glow="green" sub={`${stats.active} active`} />
        <StatCard label="Missing OTP" value={missingOtpCount} glow="gold" sub="Legacy cần fill" />
        <StatCard label="Inactive" value={stats.inactive} glow="gold" sub="Tạm bỏ qua OTP" />
        <StatCard label="Checked" value={stats.checked} glow="blue" sub="Đã có external lookup" />
        <StatCard label="Verified" value={stats.verified} glow="purple" sub="Đã xác minh OTP" />
      </div>

      {status && <div className={`bot-message-alert ${status.tone}`}>{status.text}</div>}

      <div className="mail-manager-layout">
        <SectionCard title="OTP gates" actions={<span className="muted">{filteredGates.length} hiển thị</span>} noPad>
          <div className="mail-manager-toolbar">
            <input
              className="input"
              placeholder="Tìm email hoặc ghi chú..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <select
              className="select"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as "all" | "active" | "inactive")}
            >
              <option value="all">Tất cả trạng thái</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>

          <div className="mail-manager-bulk-actions">
            <div className="mail-manager-fill-preview">
              <span className="muted">Đã chọn: {selectedGateIds.size.toLocaleString("vi-VN")}</span>
              <span className="muted">Đang lọc: {filteredGates.length.toLocaleString("vi-VN")} hiển thị</span>
              <strong>{missingOtpCount.toLocaleString("vi-VN")} legacy mail thiếu OTP</strong>
              <label className="mail-manager-batch-scope">
                <span>Phạm vi batch</span>
                <select
                  className="select"
                  value={batchTargetScope}
                  disabled={hasBusyAction}
                  onChange={(event) => setBatchTargetScope(event.target.value as BatchTargetScope)}
                >
                  <option value="selected">Mail đã chọn</option>
                  <option value="filtered">Toàn bộ kết quả lọc</option>
                </select>
              </label>
            </div>
            <div className="table-actions">
              <button
                className="button secondary"
                type="button"
                disabled={!missingOtpCount || hasBusyAction}
                onClick={() => setPendingFillMissing(true)}
              >
                {busyAction === "fill_missing" ? "Đang fill..." : "Fill missing OTP"}
              </button>
              <button
                className="button secondary"
                type="button"
                disabled={!hasBatchCandidates || hasBusyAction}
                onClick={() => void openBulkEdit()}
              >
                {busyAction === "batch_preview" ? "Đang preview..." : busyAction === "bulk_edit" ? "Đang sửa..." : "Bulk Edit"}
              </button>
              <button
                className="button danger"
                type="button"
                disabled={!hasBatchCandidates || hasBusyAction}
                onClick={() => void openBulkDelete()}
              >
                {busyAction === "batch_preview" ? "Đang preview..." : busyAction === "bulk_delete" ? "Đang xóa..." : "Bulk Delete"}
              </button>
              <button
                className="button secondary"
                type="button"
                disabled={!selectedGateIds.size || hasBusyAction}
                onClick={() => openRandomConfirm(selectedIds, "mail đã chọn")}
              >
                Random đã chọn
              </button>
              <button
                className="button warning"
                type="button"
                disabled={!gates.length || hasBusyAction}
                onClick={openRandomAllConfirm}
              >
                Random tất cả
              </button>
            </div>
          </div>

          {importErrors.length > 0 && (
            <div className="mail-manager-import-errors">
              {importErrors.slice(0, 8).map((error) => <span key={error}>{error}</span>)}
            </div>
          )}

          {filteredGates.length ? (
            <DataTable>
              <thead>
                <tr>
                  <th className="checkbox-cell">
                    <input
                      ref={selectAllRef}
                      type="checkbox"
                      className="checkbox"
                      aria-label="Chọn tất cả mail đang hiển thị"
                      checked={filteredGates.length > 0 && selectedVisibleCount === filteredGates.length}
                      onChange={(event) => toggleSelectAllVisible(event.target.checked)}
                    />
                  </th>
                  <th>Vị trí</th>
                  <th>Email</th>
                  <th>OTP</th>
                  <th>Status</th>
                  <th>Checks</th>
                  <th>Last check</th>
                  <th>Last verify</th>
                  <th>Hành động</th>
                </tr>
              </thead>
              <tbody>
                {filteredGates.map((gate) => (
                  <tr key={gate.id}>
                    <td className="checkbox-cell">
                      <input
                        type="checkbox"
                        className="checkbox"
                        aria-label={`Chọn ${gate.email}`}
                        checked={selectedGateIds.has(gate.id)}
                        onChange={(event) => toggleSelectOne(gate.id, event.target.checked)}
                      />
                    </td>
                    <td>
                      <code className="mail-manager-position-cell">{gate.displayOrder || "-"}</code>
                    </td>
                    <td>
                      <div className="mail-manager-email-cell">
                        <strong>{gate.email}</strong>
                        {gate.note && <span>{gate.note}</span>}
                      </div>
                    </td>
                    <td>
                      <code className="mail-manager-otp-cell">{gate.otp || "-"}</code>
                    </td>
                    <td>
                      <StatusPill tone={gate.active ? "success" : "warning"}>
                        {gate.active ? "Active" : "Inactive"}
                      </StatusPill>
                    </td>
                    <td>
                      <div className="mail-manager-metric">
                        <strong>{gate.checkCount.toLocaleString("vi-VN")}</strong>
                        <span>{gate.verifyCount.toLocaleString("vi-VN")} verified · {getCheckRatio(gate)}</span>
                      </div>
                    </td>
                    <td>{formatDateTime(gate.lastCheckedAt)}</td>
                    <td>{formatDateTime(gate.lastVerifiedAt)}</td>
                    <td>
                      <RowActionMenu
                        items={[
                          { label: "Random OTP", onSelect: () => openRandomConfirm([gate.id], gate.email) },
                          { label: "Chỉnh sửa", onSelect: () => editGate(gate) },
                          { label: gate.active ? "Tắt gate" : "Bật gate", tone: gate.active ? "warning" : undefined, onSelect: () => toggleGate(gate) },
                          { label: "Xóa", tone: "danger", onSelect: () => setPendingDelete(gate) }
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          ) : (
            <EmptyState
              title="Chưa có mail OTP gate"
              description="Thêm email đầu tiên để endpoint external bắt đầu yêu cầu OTP."
            />
          )}
        </SectionCard>

        <div className="mail-manager-side-stack">
          <SectionCard
            title={`${draftMode} OTP gate`}
            actions={<StatusPill tone={draft.active ? "success" : "warning"}>{draft.active ? "Active" : "Inactive"}</StatusPill>}
          >
            <form className="mail-manager-form" onSubmit={saveGate}>
              <label className="form-group">
                <span className="form-label">Email</span>
                <input
                  className="input"
                  inputMode="email"
                  placeholder="name@example.com"
                  value={draft.email}
                  onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))}
                  required
                />
              </label>
              <label className="form-group">
                <span className="form-label">OTP mới</span>
                <div className="mail-manager-otp-row">
                  <input
                    className="input"
                    autoComplete="one-time-code"
                    placeholder={draft.id ? "Để trống nếu giữ OTP hiện tại" : "Nhập OTP bắt buộc"}
                    value={draft.otp}
                    onChange={(event) => setDraft((current) => ({ ...current, otp: event.target.value }))}
                    required={!draft.id}
                  />
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => setDraft((current) => ({ ...current, otp: createClientRandomOtp() }))}
                  >
                    Random
                  </button>
                </div>
              </label>
              <label className="form-group">
                <span className="form-label">Ghi chú</span>
                <textarea
                  className="textarea"
                  rows={4}
                  placeholder="Nguồn mail, khách hàng, lý do khóa..."
                  value={draft.note}
                  onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))}
                />
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={draft.active}
                  onChange={(event) => setDraft((current) => ({ ...current, active: event.target.checked }))}
                />
                <span>Bật OTP gate</span>
              </label>
              <div className="action-row">
                <button className="button" type="submit" disabled={saving}>
                  {saving ? "Đang lưu..." : "Lưu gate"}
                </button>
                <button className="button secondary" type="button" onClick={() => setDraft(createEmptyDraft())} disabled={saving}>
                  Xóa form
                </button>
              </div>
            </form>

            <div className="mail-manager-contract">
              <div className="form-label">External API</div>
              <code>POST /api/mail-manager/check</code>
              <span>Bearer MAIL_MANAGER_API_TOKEN</span>
            </div>
          </SectionCard>

          {generatedOtps.length > 0 && (
            <SectionCard title="OTP vừa tạo" actions={<StatusPill tone="warning">{generatedOtps.length}</StatusPill>}>
              <div className="mail-manager-generated-panel">
                <textarea
                  className="textarea mail-manager-generated-textarea"
                  readOnly
                  rows={Math.min(10, Math.max(4, generatedOtps.length + 1))}
                  value={generatedOtpCsvText}
                />
                <div className="mail-manager-generated-actions">
                  <button className="button secondary" type="button" onClick={copyGeneratedOtps}>
                    Copy CSV
                  </button>
                  <button className="button" type="button" onClick={exportGeneratedOtpsCsv}>
                    Export OTP CSV
                  </button>
                  <button className="button secondary" type="button" onClick={() => setGeneratedOtps([])}>
                    Ẩn
                  </button>
                </div>
              </div>
            </SectionCard>
          )}
        </div>
      </div>

      {pendingBulkEdit && (
        <div className="modal-backdrop" onClick={() => !hasBusyAction && setPendingBulkEdit(null)}>
          <form
            className="modal mail-manager-bulk-edit-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bulk-edit-dialog-title"
            onClick={(event) => event.stopPropagation()}
            onSubmit={confirmBulkEdit}
          >
            <h3 id="bulk-edit-dialog-title" className="section-title">
              Bulk Edit {pendingBulkEdit.targetScope === "selected" ? "mail đã chọn" : "kết quả lọc"}
            </h3>
            <div className="mail-manager-batch-preview">
              <strong>{pendingBulkEdit.preview.count.toLocaleString("vi-VN")} mail sẽ bị ảnh hưởng</strong>
              <span>
                {pendingBulkEdit.targetScope === "filtered"
                  ? `Filter: ${pendingBulkEdit.preview.filter?.status || "all"}${pendingBulkEdit.preview.filter?.query ? ` · ${pendingBulkEdit.preview.filter.query}` : ""}`
                  : `${pendingBulkEdit.preview.requestedCount.toLocaleString("vi-VN")} id đã chọn`}
              </span>
              {pendingBulkEdit.preview.emailsPreview.length > 0 && (
                <code>{pendingBulkEdit.preview.emailsPreview.slice(0, 6).join(", ")}{pendingBulkEdit.preview.emailsPreview.length > 6 ? ", ..." : ""}</code>
              )}
            </div>

            <div className="mail-manager-bulk-edit-grid">
              <label className="form-group">
                <span className="form-label">Trạng thái</span>
                <select
                  className="select"
                  value={bulkEditDraft.activeMode}
                  onChange={(event) => setBulkEditDraft((current) => ({
                    ...current,
                    activeMode: event.target.value as BulkEditDraft["activeMode"]
                  }))}
                >
                  <option value="keep">Giữ nguyên</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </label>

              <label className="form-group">
                <span className="form-label">Ghi chú</span>
                <select
                  className="select"
                  value={bulkEditDraft.noteMode}
                  onChange={(event) => setBulkEditDraft((current) => ({
                    ...current,
                    noteMode: event.target.value as BulkEditDraft["noteMode"]
                  }))}
                >
                  <option value="keep">Giữ nguyên</option>
                  <option value="replace">Thay ghi chú</option>
                  <option value="clear">Xóa ghi chú</option>
                </select>
              </label>

              <label className="form-group mail-manager-bulk-edit-wide">
                <span className="form-label">Nội dung ghi chú</span>
                <textarea
                  className="textarea"
                  rows={3}
                  value={bulkEditDraft.note}
                  disabled={bulkEditDraft.noteMode !== "replace"}
                  onChange={(event) => setBulkEditDraft((current) => ({ ...current, note: event.target.value }))}
                />
              </label>

              <label className="form-group mail-manager-bulk-edit-wide">
                <span className="form-label">OTP chung</span>
                <div className="mail-manager-otp-row">
                  <input
                    className="input"
                    autoComplete="one-time-code"
                    placeholder="Để trống nếu giữ OTP hiện tại"
                    value={bulkEditDraft.otp}
                    onChange={(event) => setBulkEditDraft((current) => ({ ...current, otp: event.target.value }))}
                  />
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => setBulkEditDraft((current) => ({ ...current, otp: createClientRandomOtp() }))}
                  >
                    Random
                  </button>
                </div>
              </label>
            </div>

            <div className="modal-actions">
              <button className="button" type="submit" disabled={busyAction === "bulk_edit" || !pendingBulkEdit.preview.count}>
                {busyAction === "bulk_edit" ? "Đang xử lý..." : "Lưu Bulk Edit"}
              </button>
              <button
                className="button secondary"
                type="button"
                disabled={busyAction === "bulk_edit"}
                onClick={() => setPendingBulkEdit(null)}
              >
                Hủy
              </button>
            </div>
          </form>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Xóa OTP gate?"
        description={pendingDelete ? `Mail ${pendingDelete.email} sẽ không còn bị chặn bởi Mail Manager.` : undefined}
        confirmLabel="Xóa"
        onConfirm={deleteGate}
        onCancel={() => setPendingDelete(null)}
      />

      <ConfirmDialog
        open={Boolean(pendingBulkDelete)}
        title={pendingBulkDelete?.targetScope === "filtered" ? "Bulk Delete toàn bộ kết quả lọc?" : "Bulk Delete mail đã chọn?"}
        description={pendingBulkDelete ? (
          <div className="mail-manager-batch-preview">
            <strong>{pendingBulkDelete.preview.count.toLocaleString("vi-VN")} mail sẽ bị xóa</strong>
            <span>
              {pendingBulkDelete.targetScope === "filtered"
                ? `Filter: ${pendingBulkDelete.preview.filter?.status || "all"}${pendingBulkDelete.preview.filter?.query ? ` · ${pendingBulkDelete.preview.filter.query}` : ""}`
                : `${pendingBulkDelete.preview.requestedCount.toLocaleString("vi-VN")} id đã chọn`}
            </span>
            {pendingBulkDelete.preview.emailsPreview.length > 0 && (
              <code>{pendingBulkDelete.preview.emailsPreview.slice(0, 6).join(", ")}{pendingBulkDelete.preview.emailsPreview.length > 6 ? ", ..." : ""}</code>
            )}
          </div>
        ) : undefined}
        confirmLabel="Bulk Delete"
        busy={busyAction === "bulk_delete"}
        onConfirm={confirmBulkDelete}
        onCancel={() => !hasBusyAction && setPendingBulkDelete(null)}
      />

      <ConfirmDialog
        open={pendingFillMissing}
        title="Fill missing OTP?"
        description={`${missingOtpCount.toLocaleString("vi-VN")} legacy mail thiếu OTP sẽ được random OTP mới. CSV OTP sẽ tự tải xuống sau khi chạy.`}
        confirmLabel="Fill OTP"
        tone="primary"
        busy={busyAction === "fill_missing"}
        onConfirm={confirmFillMissingOtp}
        onCancel={() => !hasBusyAction && setPendingFillMissing(false)}
      />

      <ConfirmDialog
        open={Boolean(pendingRandom)}
        title={pendingRandom?.title || "Random OTP?"}
        description={pendingRandom?.description}
        confirmLabel="Random OTP"
        tone="primary"
        busy={busyAction === "random"}
        onConfirm={confirmRandomOtp}
        onCancel={() => !hasBusyAction && setPendingRandom(null)}
      />
    </div>
  );
}
