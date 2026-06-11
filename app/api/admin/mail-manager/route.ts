import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/app/api/_shared/adminAuth";
import { recordAdminAuditEvent } from "@/app/api/_shared/adminAudit";
import { getSupabaseAdminClient } from "@/app/api/_shared/supabaseAdmin";
import { withAdminApiTiming } from "@/app/api/_shared/serverTiming";
import {
  createOtpSecret,
  createRandomOtp,
  getMailAddressFromPayload,
  isValidMailAddress,
  normalizeActiveFlag,
  normalizeMailAddress,
  normalizeNote,
  normalizeRandomOtpLength,
  parseOtpInput,
  toMailOtpGatePublic,
  type MailOtpGatePublic,
  type MailOtpGateRow
} from "@/app/api/_shared/mailOtpGate";

const GATE_SELECT =
  "id,email,normalized_email,display_order,otp_plaintext,otp_hash,otp_salt,active,note,last_checked_at,last_verified_at,check_count,verify_count,created_at,updated_at";
const MISSING_OTP_FILTER = "otp_plaintext.is.null,otp_plaintext.eq.";
const MAX_DISPLAY_ORDER = 2_147_483_647;
const MAX_BULK_IMPORT_ROWS = 2000;
const MAX_RANDOM_OTP_ROWS = 5000;
const MAX_FILL_MISSING_OTP_ROWS = 5000;
const MAX_BULK_EDIT_ROWS = 5000;
const MAX_BULK_DELETE_ROWS = 5000;
const MAX_IMPORT_ERRORS = 25;

type AdminSessionSuccess = Exclude<Awaited<ReturnType<typeof requireAdminSession>>, { ok: false }>;
type GeneratedOtp = {
  id: number;
  displayOrder: number;
  email: string;
  normalizedEmail: string;
  otp: string;
};

type PreparedImport = {
  inputIndex: number;
  displayOrder: number;
  normalizedEmail: string;
  otp: string;
  payload: Record<string, unknown>;
};

type MissingOtpCountResult = {
  count: number;
};

type MailManagerFilterStatus = "all" | "active" | "inactive";

type MailManagerFilter = {
  query: string;
  status: MailManagerFilterStatus;
};

type BatchTargetScope = "ids" | "filter" | "all";

type BatchGateTarget = {
  scope: BatchTargetScope;
  filter: MailManagerFilter;
  rows: MailOtpGateRow[];
  ids: number[];
  emails: string[];
  count: number;
  requestedCount: number;
  limit: number;
};

type BatchTargetResolution =
  | { ok: true; target: BatchGateTarget }
  | { ok: false; response: NextResponse };

const toPositiveId = (value: unknown) => {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const toRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const toPositiveIds = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(toPositiveId).filter((id): id is number => Boolean(id))));
};

const getOtpValueFromPayload = (body: Record<string, unknown>) => {
  const otp = String(body.otp ?? "").trim();
  if (otp) return otp;
  return body.code ?? "";
};

const getDisplayOrderValueFromPayload = (body: Record<string, unknown>) =>
  body.displayOrder ?? body.display_order ?? body.position ?? body.order ?? body.sort_order ?? body.index ?? body.stt ?? body.vi_tri;

const normalizeDisplayOrder = (value: unknown, fallback: number) => {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, MAX_DISPLAY_ORDER);
};

const getSafeDisplayOrder = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : MAX_DISPLAY_ORDER;
};

const sortMailOtpGateRows = (rows: MailOtpGateRow[]) =>
  [...rows].sort(
    (left, right) =>
      getSafeDisplayOrder(left.display_order) - getSafeDisplayOrder(right.display_order) ||
      Number(left.id || 0) - Number(right.id || 0)
  );

const sortMailOtpGatePublics = (gates: MailOtpGatePublic[]) =>
  [...gates].sort(
    (left, right) =>
      getSafeDisplayOrder(left.displayOrder) - getSafeDisplayOrder(right.displayOrder) ||
      Number(left.id || 0) - Number(right.id || 0)
  );

const toSortedMailOtpGatePublics = (rows: MailOtpGateRow[]) =>
  sortMailOtpGateRows(rows).map(toMailOtpGatePublic);

const pushImportError = (errors: string[], message: string) => {
  if (errors.length < MAX_IMPORT_ERRORS) errors.push(message);
};

const mapGeneratedOtps = (gates: MailOtpGatePublic[], otpByEmail: Map<string, string>): GeneratedOtp[] =>
  sortMailOtpGatePublics(gates)
    .map((gate) => ({
      id: gate.id,
      displayOrder: gate.displayOrder,
      email: gate.email,
      normalizedEmail: gate.normalizedEmail,
      otp: otpByEmail.get(gate.normalizedEmail) || ""
    }))
    .filter((item) => item.otp);

const DEFAULT_MAIL_MANAGER_FILTER: MailManagerFilter = { query: "", status: "all" };

const normalizeFilterQuery = (value: unknown) =>
  String(value ?? "")
    .trim()
    .replace(/[,%*()]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 120);

const normalizeFilterStatus = (value: unknown): MailManagerFilterStatus => {
  const status = String(value ?? "").trim().toLowerCase();
  if (status === "active" || status === "inactive") return status;
  return "all";
};

const normalizeMailManagerFilter = (value: unknown): MailManagerFilter => {
  const record = toRecord(value);
  if (!record) return DEFAULT_MAIL_MANAGER_FILTER;
  return {
    query: normalizeFilterQuery(record.query ?? record.search ?? record.q),
    status: normalizeFilterStatus(record.status ?? record.statusFilter)
  };
};

const getBatchTargetRecord = (body: Record<string, unknown>) => toRecord(body.target) || {};

const getBatchTargetScope = (body: Record<string, unknown>): BatchTargetScope => {
  const target = getBatchTargetRecord(body);
  const scope = String(body.scope ?? target.scope ?? "ids").trim().toLowerCase();
  if (scope === "filter") return "filter";
  if (scope === "all") return "all";
  return "ids";
};

const getBatchTargetIds = (body: Record<string, unknown>) => {
  const target = getBatchTargetRecord(body);
  return toPositiveIds(body.ids ?? body.gateIds ?? target.ids ?? target.gateIds);
};

const getBatchTargetFilter = (body: Record<string, unknown>) => {
  const target = getBatchTargetRecord(body);
  return normalizeMailManagerFilter(body.filter ?? target.filter ?? body);
};

const applyMailManagerFilter = (query: any, filter: MailManagerFilter) => {
  let nextQuery = query;
  if (filter.status === "active") nextQuery = nextQuery.eq("active", true);
  if (filter.status === "inactive") nextQuery = nextQuery.eq("active", false);
  if (filter.query) {
    nextQuery = nextQuery.or(
      `email.ilike.%${filter.query}%,normalized_email.ilike.%${filter.query}%,note.ilike.%${filter.query}%`
    );
  }
  return nextQuery;
};

const buildBatchPreview = (target: BatchGateTarget) => ({
  scope: target.scope,
  filter: target.scope === "filter" ? target.filter : undefined,
  count: target.count,
  requestedCount: target.requestedCount,
  limit: target.limit,
  idsPreview: target.ids.slice(0, 100),
  emailsPreview: target.emails.slice(0, 20)
});

async function resolveBatchGateTarget({
  body,
  supabase,
  maxRows,
  emptyErrorMessage,
  allowAll = false,
  allowEmpty = false
}: {
  body: Record<string, unknown>;
  supabase: ReturnType<typeof getSupabaseAdminClient>;
  maxRows: number;
  emptyErrorMessage: string;
  allowAll?: boolean;
  allowEmpty?: boolean;
}): Promise<BatchTargetResolution> {
  const requestedScope = getBatchTargetScope(body);
  const scope = requestedScope === "all" && allowAll ? "all" : requestedScope === "filter" ? "filter" : "ids";

  if (scope === "ids") {
    const ids = getBatchTargetIds(body);
    if (!ids.length) {
      return { ok: false, response: NextResponse.json({ error: "Chọn ít nhất 1 mail để chạy batch action." }, { status: 400 }) };
    }
    if (ids.length > maxRows) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: `Batch action tối đa ${maxRows.toLocaleString("vi-VN")} mail mỗi lần.` },
          { status: 400 }
        )
      };
    }

    const { data, error } = await supabase
      .from("mail_otp_gates")
      .select(GATE_SELECT)
      .in("id", ids)
      .order("display_order", { ascending: true })
      .order("id", { ascending: true });
    if (error) throw error;

    const rows = ((data as MailOtpGateRow[]) || []);
    if (!rows.length && !allowEmpty) {
      return { ok: false, response: NextResponse.json({ error: emptyErrorMessage }, { status: 404 }) };
    }

    const targetRows = rows.slice(0, maxRows);
    return {
      ok: true,
      target: {
        scope,
        filter: DEFAULT_MAIL_MANAGER_FILTER,
        rows: targetRows,
        ids: targetRows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id)),
        emails: targetRows.map((row) => String(row.normalized_email || row.email || "")).filter(Boolean),
        count: targetRows.length,
        requestedCount: ids.length,
        limit: maxRows
      }
    };
  }

  const filter = scope === "filter" ? getBatchTargetFilter(body) : DEFAULT_MAIL_MANAGER_FILTER;
  let query = supabase
    .from("mail_otp_gates")
    .select(GATE_SELECT, { count: "exact" });
  if (scope === "filter") query = applyMailManagerFilter(query, filter);

  const { data, count, error } = await query
    .order("display_order", { ascending: true })
    .order("id", { ascending: true })
    .limit(maxRows + 1);
  if (error) throw error;

  const rows = ((data as MailOtpGateRow[]) || []);
  const exactCount = Number(count ?? rows.length);
  if (exactCount > maxRows || rows.length > maxRows) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: `Batch action đang giới hạn ${maxRows.toLocaleString("vi-VN")} mail mỗi lần. Filter hiện tại match ${exactCount.toLocaleString("vi-VN")} mail.`,
          data: { count: exactCount, limit: maxRows, filter: scope === "filter" ? filter : undefined }
        },
        { status: 400 }
      )
    };
  }
  if (!rows.length && !allowEmpty) {
    return { ok: false, response: NextResponse.json({ error: emptyErrorMessage }, { status: 404 }) };
  }

  const targetRows = rows.slice(0, maxRows);
  return {
    ok: true,
    target: {
      scope,
      filter,
      rows: targetRows,
      ids: targetRows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id)),
      emails: targetRows.map((row) => String(row.normalized_email || row.email || "")).filter(Boolean),
      count: exactCount,
      requestedCount: exactCount,
      limit: maxRows
    }
  };
}

async function recordMailOtpGateBatchAudit(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  adminSession: AdminSessionSuccess,
  action: string,
  target: BatchGateTarget,
  metadata: Record<string, unknown> = {}
) {
  await recordAdminAuditEvent(supabase, {
    adminUserId: adminSession.userId,
    adminEmail: adminSession.email,
    action,
    entityType: "mail_otp_gate",
    metadata: {
      ...buildBatchPreview(target),
      ...metadata
    }
  });
}

const getBatchPreviewLimit = (operation: string) => {
  if (operation === "bulk_delete") return MAX_BULK_DELETE_ROWS;
  if (operation === "random_otp") return MAX_RANDOM_OTP_ROWS;
  if (operation === "fill_missing_otp") return MAX_FILL_MISSING_OTP_ROWS;
  return MAX_BULK_EDIT_ROWS;
};

async function countMissingOtpRows(supabase = getSupabaseAdminClient()): Promise<MissingOtpCountResult> {
  const { count, error } = await supabase
    .from("mail_otp_gates")
    .select("id", { count: "exact", head: true })
    .or(MISSING_OTP_FILTER);

  if (error) throw error;
  return { count: Number(count || 0) };
}

async function getNextDisplayOrder(supabase: ReturnType<typeof getSupabaseAdminClient>) {
  const { data, error } = await supabase
    .from("mail_otp_gates")
    .select("display_order")
    .order("display_order", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  const current = Number((data as { display_order?: number | null } | null)?.display_order ?? 0);
  if (!Number.isFinite(current) || current < 1) return 1;
  return Math.min(current + 1, MAX_DISPLAY_ORDER);
}

async function getDisplayOrderForManualUpsert(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  normalizedEmail: string
) {
  const { data, error } = await supabase
    .from("mail_otp_gates")
    .select("display_order")
    .eq("normalized_email", normalizedEmail)
    .maybeSingle();

  if (error) throw error;
  const existingDisplayOrder = Number((data as { display_order?: number | null } | null)?.display_order ?? 0);
  if (Number.isFinite(existingDisplayOrder) && existingDisplayOrder > 0) return existingDisplayOrder;
  return getNextDisplayOrder(supabase);
}

async function handleGET(request: NextRequest) {
  const adminSession = await requireAdminSession(request);
  if (adminSession.ok === false) {
    return adminSession.response;
  }

  try {
    const supabase = getSupabaseAdminClient();
    const requestedLimit = Number.parseInt(request.nextUrl.searchParams.get("limit") || "500", 10);
    const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 500, 1), 5000);
    const gatesQuery = supabase
      .from("mail_otp_gates")
      .select(GATE_SELECT)
      .order("display_order", { ascending: true })
      .order("id", { ascending: true })
      .limit(limit);
    const [gatesResult, missingOtpResult] = await Promise.all([
      gatesQuery,
      countMissingOtpRows(supabase)
    ]);

    if (gatesResult.error) throw gatesResult.error;
    const gates = toSortedMailOtpGatePublics((gatesResult.data as MailOtpGateRow[]) || []);
    return NextResponse.json({ success: true, data: { gates, limit, missingOtpCount: missingOtpResult.count } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Không thể tải Mail Manager." },
      { status: 500 }
    );
  }
}

async function saveGate(body: Record<string, unknown>, adminSession: AdminSessionSuccess) {
  const gateId = toPositiveId(body.gateId ?? body.id);
  const email = normalizeMailAddress(body.email);
  if (!email || !isValidMailAddress(email)) {
    return NextResponse.json({ error: "Email không hợp lệ." }, { status: 400 });
  }

  const parsedOtp = parseOtpInput(body.otp);
  if (parsedOtp.error) {
    return NextResponse.json({ error: parsedOtp.error }, { status: 400 });
  }
  if (!gateId && !parsedOtp.otp) {
    return NextResponse.json({ error: "OTP bắt buộc khi tạo mail mới." }, { status: 400 });
  }

  const now = new Date().toISOString();
  const active = normalizeActiveFlag(body.active, true);
  const note = normalizeNote(body.note);
  const otpPayload = parsedOtp.otp ? { otp_plaintext: parsedOtp.otp, ...createOtpSecret(parsedOtp.otp) } : {};
  const supabase = getSupabaseAdminClient();
  const displayOrderPayload = gateId
    ? {}
    : { display_order: await getDisplayOrderForManualUpsert(supabase, email) };

  const payload = {
    email,
    normalized_email: email,
    ...displayOrderPayload,
    active,
    note,
    updated_by: adminSession.userId,
    updated_at: now,
    ...otpPayload
  };

  const query = gateId
    ? supabase.from("mail_otp_gates").update(payload).eq("id", gateId).select(GATE_SELECT).single()
    : supabase
        .from("mail_otp_gates")
        .upsert(
          {
            ...payload,
            created_by: adminSession.userId,
            created_at: now
          },
          { onConflict: "normalized_email" }
        )
        .select(GATE_SELECT)
        .single();

  const { data, error } = await query;
  if (error) throw error;

  const saved = toMailOtpGatePublic(data as MailOtpGateRow);
  await recordAdminAuditEvent(supabase, {
    adminUserId: adminSession.userId,
    adminEmail: adminSession.email,
    action: gateId ? "mail_otp_gate.update" : "mail_otp_gate.upsert",
    entityType: "mail_otp_gate",
    entityId: saved.id,
    metadata: {
      email: saved.normalizedEmail,
      active: saved.active,
      otpChanged: Boolean(parsedOtp.otp)
    }
  });

  return NextResponse.json({ success: true, data: { gate: saved } });
}

async function bulkImportGates(body: Record<string, unknown>, adminSession: AdminSessionSuccess) {
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) {
    return NextResponse.json({ error: "CSV không có dòng hợp lệ để import." }, { status: 400 });
  }
  if (rows.length > MAX_BULK_IMPORT_ROWS) {
    return NextResponse.json(
      { error: `Import tối đa ${MAX_BULK_IMPORT_ROWS.toLocaleString("vi-VN")} mail mỗi lần.` },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();
  const otpLength = normalizeRandomOtpLength(body.otpLength);
  const errors: string[] = [];
  let duplicateCount = 0;
  let invalidCount = 0;
  let providedOtpCount = 0;
  let generatedOtpCount = 0;
  const preparedByEmail = new Map<string, PreparedImport>();

  rows.forEach((row, index) => {
    const record = toRecord(row);
    if (!record) {
      invalidCount += 1;
      pushImportError(errors, `Dòng ${index + 1}: dữ liệu không hợp lệ.`);
      return;
    }

    const normalizedEmail = normalizeMailAddress(getMailAddressFromPayload(record));
    if (!normalizedEmail || !isValidMailAddress(normalizedEmail)) {
      invalidCount += 1;
      pushImportError(errors, `Dòng ${index + 1}: email không hợp lệ.`);
      return;
    }

    const parsedOtp = parseOtpInput(getOtpValueFromPayload(record));
    if (parsedOtp.error) {
      invalidCount += 1;
      pushImportError(errors, `Dòng ${index + 1}: ${parsedOtp.error}`);
      return;
    }

    const otp = parsedOtp.otp || createRandomOtp(otpLength);
    if (parsedOtp.otp) providedOtpCount += 1;
    else generatedOtpCount += 1;

    const active = normalizeActiveFlag(record.active ?? record.enabled ?? record.status, true);
    const note = normalizeNote(record.note ?? record.notes ?? record.memo ?? "");
    const displayOrder = normalizeDisplayOrder(getDisplayOrderValueFromPayload(record), index + 1);
    const secret = createOtpSecret(otp);
    if (preparedByEmail.has(normalizedEmail)) duplicateCount += 1;

    preparedByEmail.set(normalizedEmail, {
      inputIndex: index + 1,
      displayOrder,
      normalizedEmail,
      otp,
      payload: {
        email: normalizedEmail,
        normalized_email: normalizedEmail,
        display_order: displayOrder,
        active,
        note,
        updated_by: adminSession.userId,
        updated_at: now,
        otp_plaintext: otp,
        ...secret
      }
    });
  });

  const prepared = Array.from(preparedByEmail.values());
  if (!prepared.length) {
    return NextResponse.json({ error: "Không có mail hợp lệ để import.", data: { errors } }, { status: 400 });
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("mail_otp_gates")
    .upsert(
      prepared.map((item) => item.payload),
      { onConflict: "normalized_email" }
    )
    .select(GATE_SELECT);

  if (error) throw error;

  const gates = toSortedMailOtpGatePublics((data as MailOtpGateRow[]) || []);
  const otpByEmail = new Map(prepared.map((item) => [item.normalizedEmail, item.otp]));
  const generatedOtps = mapGeneratedOtps(gates, otpByEmail);

  await recordAdminAuditEvent(supabase, {
    adminUserId: adminSession.userId,
    adminEmail: adminSession.email,
    action: "mail_otp_gate.bulk_import",
    entityType: "mail_otp_gate",
    metadata: {
      importedCount: gates.length,
      requestedCount: rows.length,
      invalidCount,
      duplicateCount,
      providedOtpCount,
      generatedOtpCount,
      positionMode: "csv_position_or_row_order"
    }
  });

  return NextResponse.json({
    success: true,
    data: {
      gates,
      generatedOtps,
      importedCount: gates.length,
      requestedCount: rows.length,
      invalidCount,
      duplicateCount,
      providedOtpCount,
      generatedOtpCount,
      errors
    }
  });
}

async function randomizeOtp(body: Record<string, unknown>, adminSession: AdminSessionSuccess) {
  const supabase = getSupabaseAdminClient();
  const targetResult = await resolveBatchGateTarget({
    body,
    supabase,
    maxRows: MAX_RANDOM_OTP_ROWS,
    emptyErrorMessage: "Không tìm thấy mail để random OTP.",
    allowAll: true
  });
  if (targetResult.ok === false) return targetResult.response;

  const target = targetResult.target;
  const rows = target.rows;
  const now = new Date().toISOString();
  const otpLength = normalizeRandomOtpLength(body.otpLength);
  const otpByEmail = new Map<string, string>();
  const payloads = rows.map((row) => {
    const normalizedEmail = normalizeMailAddress(row.normalized_email || row.email || "");
    const otp = createRandomOtp(otpLength);
    otpByEmail.set(normalizedEmail, otp);
    return {
      id: row.id,
      email: row.email || normalizedEmail,
      normalized_email: normalizedEmail,
      active: row.active !== false,
      note: row.note || "",
      updated_by: adminSession.userId,
      updated_at: now,
      otp_plaintext: otp,
      ...createOtpSecret(otp)
    };
  });

  const { data, error } = await supabase
    .from("mail_otp_gates")
    .upsert(payloads, { onConflict: "id" })
    .select(GATE_SELECT);

  if (error) throw error;

  const gates = toSortedMailOtpGatePublics((data as MailOtpGateRow[]) || []);
  const generatedOtps = mapGeneratedOtps(gates, otpByEmail);
  const auditAction = target.scope === "all"
    ? "mail_otp_gate.random_otp_all"
    : target.scope === "filter"
      ? "mail_otp_gate.random_otp_filtered"
      : "mail_otp_gate.random_otp_selected";

  await recordMailOtpGateBatchAudit(supabase, adminSession, auditAction, target, {
    otpLength,
    generatedCount: generatedOtps.length
  });

  return NextResponse.json({
    success: true,
    data: { gates, generatedOtps, count: gates.length, scope: target.scope, batch: buildBatchPreview(target) }
  });
}
async function fillMissingOtp(body: Record<string, unknown>, adminSession: AdminSessionSuccess) {
  const supabase = getSupabaseAdminClient();
  const missingOtpCount = await countMissingOtpRows(supabase);
  if (!missingOtpCount.count) {
    return NextResponse.json({
      success: true,
      data: { gates: [], generatedOtps: [], count: 0, missingOtpCount: 0, remainingMissingOtpCount: 0 }
    });
  }
  if (missingOtpCount.count > MAX_FILL_MISSING_OTP_ROWS) {
    return NextResponse.json(
      {
        error: `Có ${missingOtpCount.count.toLocaleString("vi-VN")} mail thiếu OTP, vượt giới hạn ${MAX_FILL_MISSING_OTP_ROWS.toLocaleString("vi-VN")} mỗi lần.`,
        data: { missingOtpCount: missingOtpCount.count, limit: MAX_FILL_MISSING_OTP_ROWS }
      },
      { status: 400 }
    );
  }

  const { data: existingRows, error: selectError } = await supabase
    .from("mail_otp_gates")
    .select(GATE_SELECT)
    .or(MISSING_OTP_FILTER)
    .order("display_order", { ascending: true })
    .order("id", { ascending: true })
    .limit(MAX_FILL_MISSING_OTP_ROWS + 1);
  if (selectError) throw selectError;

  const rows = sortMailOtpGateRows((existingRows as MailOtpGateRow[]) || []);
  if (rows.length > MAX_FILL_MISSING_OTP_ROWS) {
    return NextResponse.json(
      { error: `Fill missing OTP đang giới hạn ${MAX_FILL_MISSING_OTP_ROWS.toLocaleString("vi-VN")} mail mỗi lần.` },
      { status: 400 }
    );
  }
  if (!rows.length) {
    return NextResponse.json({
      success: true,
      data: { gates: [], generatedOtps: [], count: 0, missingOtpCount: 0, remainingMissingOtpCount: 0 }
    });
  }

  const now = new Date().toISOString();
  const otpLength = normalizeRandomOtpLength(body.otpLength);
  const otpByEmail = new Map<string, string>();
  const payloads = rows.map((row) => {
    const normalizedEmail = normalizeMailAddress(row.normalized_email || row.email || "");
    const otp = createRandomOtp(otpLength);
    otpByEmail.set(normalizedEmail, otp);
    return {
      id: row.id,
      email: row.email || normalizedEmail,
      normalized_email: normalizedEmail,
      active: row.active !== false,
      note: row.note || "",
      updated_by: adminSession.userId,
      updated_at: now,
      otp_plaintext: otp,
      ...createOtpSecret(otp)
    };
  });

  const { data, error } = await supabase
    .from("mail_otp_gates")
    .upsert(payloads, { onConflict: "id" })
    .select(GATE_SELECT);

  if (error) throw error;

  const gates = toSortedMailOtpGatePublics((data as MailOtpGateRow[]) || []);
  const generatedOtps = mapGeneratedOtps(gates, otpByEmail);
  const remainingMissingOtpCount = await countMissingOtpRows(supabase);

  await recordAdminAuditEvent(supabase, {
    adminUserId: adminSession.userId,
    adminEmail: adminSession.email,
    action: "mail_otp_gate.fill_missing_otp",
    entityType: "mail_otp_gate",
    metadata: {
      count: gates.length,
      previousMissingOtpCount: missingOtpCount.count,
      remainingMissingOtpCount: remainingMissingOtpCount.count
    }
  });

  return NextResponse.json({
    success: true,
    data: {
      gates,
      generatedOtps,
      count: gates.length,
      missingOtpCount: missingOtpCount.count,
      remainingMissingOtpCount: remainingMissingOtpCount.count
    }
  });
}

async function previewBatchTarget(body: Record<string, unknown>) {
  const operation = String(body.operation ?? "bulk_edit").trim().toLowerCase();
  if (operation === "fill_missing_otp") {
    const missingOtpCount = await countMissingOtpRows();
    return NextResponse.json({
      success: true,
      data: {
        preview: {
          operation,
          scope: "filter",
          count: missingOtpCount.count,
          requestedCount: missingOtpCount.count,
          limit: MAX_FILL_MISSING_OTP_ROWS,
          idsPreview: [],
          emailsPreview: []
        }
      }
    });
  }

  const supabase = getSupabaseAdminClient();
  const targetResult = await resolveBatchGateTarget({
    body,
    supabase,
    maxRows: getBatchPreviewLimit(operation),
    emptyErrorMessage: "Không tìm thấy mail cho preview batch action.",
    allowAll: true,
    allowEmpty: true
  });
  if (targetResult.ok === false) return targetResult.response;

  return NextResponse.json({
    success: true,
    data: { preview: { operation, ...buildBatchPreview(targetResult.target) } }
  });
}

async function bulkEditGates(body: Record<string, unknown>, adminSession: AdminSessionSuccess) {
  const activeMode = ["active", "inactive", "keep"].includes(String(body.activeMode || ""))
    ? String(body.activeMode)
    : typeof body.active === "boolean"
      ? (body.active ? "active" : "inactive")
      : "keep";
  const noteMode = ["replace", "clear", "keep"].includes(String(body.noteMode || ""))
    ? String(body.noteMode)
    : Object.prototype.hasOwnProperty.call(body, "note")
      ? "replace"
      : "keep";
  const parsedOtp = parseOtpInput(body.otp);
  if (parsedOtp.error) {
    return NextResponse.json({ error: parsedOtp.error }, { status: 400 });
  }

  const activeChanged = activeMode === "active" || activeMode === "inactive";
  const noteChanged = noteMode === "replace" || noteMode === "clear";
  const otpChanged = Boolean(parsedOtp.otp);
  if (!activeChanged && !noteChanged && !otpChanged) {
    return NextResponse.json({ error: "Chọn ít nhất 1 trường cần bulk edit." }, { status: 400 });
  }

  const supabase = getSupabaseAdminClient();
  const targetResult = await resolveBatchGateTarget({
    body,
    supabase,
    maxRows: MAX_BULK_EDIT_ROWS,
    emptyErrorMessage: "Không tìm thấy mail để bulk edit."
  });
  if (targetResult.ok === false) return targetResult.response;
  const target = targetResult.target;

  const now = new Date().toISOString();
  const payload: Record<string, unknown> = {
    updated_by: adminSession.userId,
    updated_at: now
  };
  if (activeChanged) payload.active = activeMode === "active";
  if (noteChanged) payload.note = noteMode === "clear" ? "" : normalizeNote(body.note);
  if (otpChanged) {
    payload.otp_plaintext = parsedOtp.otp;
    Object.assign(payload, createOtpSecret(parsedOtp.otp));
  }

  const { data, error } = await supabase
    .from("mail_otp_gates")
    .update(payload)
    .in("id", target.ids)
    .select(GATE_SELECT);

  if (error) throw error;

  const gates = toSortedMailOtpGatePublics((data as MailOtpGateRow[]) || []);
  await recordMailOtpGateBatchAudit(supabase, adminSession, "mail_otp_gate.bulk_edit", target, {
    updatedCount: gates.length,
    activeChanged,
    noteChanged,
    noteMode,
    otpChanged
  });

  return NextResponse.json({
    success: true,
    data: {
      gates,
      count: gates.length,
      requestedCount: target.requestedCount,
      activeChanged,
      noteChanged,
      otpChanged,
      batch: buildBatchPreview(target)
    }
  });
}

async function bulkDeleteGates(body: Record<string, unknown>, adminSession: AdminSessionSuccess) {
  const supabase = getSupabaseAdminClient();
  const targetResult = await resolveBatchGateTarget({
    body,
    supabase,
    maxRows: MAX_BULK_DELETE_ROWS,
    emptyErrorMessage: "Không tìm thấy mail để bulk delete."
  });
  if (targetResult.ok === false) return targetResult.response;
  const target = targetResult.target;
  const deletedGates = target.rows.map(toMailOtpGatePublic);

  const { error } = await supabase.from("mail_otp_gates").delete().in("id", target.ids);
  if (error) throw error;

  await recordMailOtpGateBatchAudit(supabase, adminSession, "mail_otp_gate.bulk_delete", target, {
    deletedCount: deletedGates.length
  });

  return NextResponse.json({
    success: true,
    data: {
      deletedIds: target.ids,
      deletedGates,
      count: deletedGates.length,
      requestedCount: target.requestedCount,
      batch: buildBatchPreview(target)
    }
  });
}
async function toggleGate(body: Record<string, unknown>, adminSession: AdminSessionSuccess) {
  const gateId = toPositiveId(body.gateId ?? body.id);
  if (!gateId) return NextResponse.json({ error: "gateId không hợp lệ." }, { status: 400 });

  const active = normalizeActiveFlag(body.active, true);
  const now = new Date().toISOString();
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("mail_otp_gates")
    .update({ active, updated_by: adminSession.userId, updated_at: now })
    .eq("id", gateId)
    .select(GATE_SELECT)
    .single();

  if (error) throw error;
  const gate = toMailOtpGatePublic(data as MailOtpGateRow);
  await recordAdminAuditEvent(supabase, {
    adminUserId: adminSession.userId,
    adminEmail: adminSession.email,
    action: active ? "mail_otp_gate.activate" : "mail_otp_gate.deactivate",
    entityType: "mail_otp_gate",
    entityId: gate.id,
    metadata: { email: gate.normalizedEmail }
  });

  return NextResponse.json({ success: true, data: { gate } });
}

async function deleteGate(body: Record<string, unknown>, adminSession: AdminSessionSuccess) {
  const gateId = toPositiveId(body.gateId ?? body.id);
  if (!gateId) return NextResponse.json({ error: "gateId không hợp lệ." }, { status: 400 });

  const supabase = getSupabaseAdminClient();
  const { data: existing } = await supabase
    .from("mail_otp_gates")
    .select("id, normalized_email")
    .eq("id", gateId)
    .maybeSingle();
  const { error } = await supabase.from("mail_otp_gates").delete().eq("id", gateId);
  if (error) throw error;

  await recordAdminAuditEvent(supabase, {
    adminUserId: adminSession.userId,
    adminEmail: adminSession.email,
    action: "mail_otp_gate.delete",
    entityType: "mail_otp_gate",
    entityId: gateId,
    metadata: { email: String(existing?.normalized_email || "") }
  });

  return NextResponse.json({ success: true, data: { gateId } });
}

async function handlePOST(request: NextRequest) {
  const adminSession = await requireAdminSession(request);
  if (adminSession.ok === false) {
    return adminSession.response;
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Payload không hợp lệ." }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : "";
  try {
    if (action === "save_gate") return await saveGate(body, adminSession);
    if (action === "bulk_import") return await bulkImportGates(body, adminSession);
    if (action === "preview_batch") return await previewBatchTarget(body);
    if (action === "random_otp") return await randomizeOtp(body, adminSession);
    if (action === "fill_missing_otp") return await fillMissingOtp(body, adminSession);
    if (action === "bulk_edit") return await bulkEditGates(body, adminSession);
    if (action === "bulk_delete") return await bulkDeleteGates(body, adminSession);
    if (action === "toggle_gate") return await toggleGate(body, adminSession);
    if (action === "delete_gate") return await deleteGate(body, adminSession);
    return NextResponse.json({ error: "Action không được hỗ trợ." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Không thể cập nhật Mail Manager." },
      { status: 500 }
    );
  }
}

export const GET = withAdminApiTiming("GET /api/admin/mail-manager", handleGET);
export const POST = withAdminApiTiming("POST /api/admin/mail-manager", handlePOST);
