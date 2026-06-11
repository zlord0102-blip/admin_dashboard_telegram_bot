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
  "id,email,normalized_email,otp_plaintext,otp_hash,otp_salt,active,note,last_checked_at,last_verified_at,check_count,verify_count,created_at,updated_at";
const MISSING_OTP_FILTER = "otp_plaintext.is.null,otp_plaintext.eq.";
const MAX_BULK_IMPORT_ROWS = 2000;
const MAX_RANDOM_OTP_ROWS = 5000;
const MAX_FILL_MISSING_OTP_ROWS = 5000;
const MAX_IMPORT_ERRORS = 25;

type AdminSessionSuccess = Exclude<Awaited<ReturnType<typeof requireAdminSession>>, { ok: false }>;
type GeneratedOtp = {
  id: number;
  email: string;
  normalizedEmail: string;
  otp: string;
};

type PreparedImport = {
  inputIndex: number;
  normalizedEmail: string;
  otp: string;
  payload: Record<string, unknown>;
};

type MissingOtpCountResult = {
  count: number;
};

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

const pushImportError = (errors: string[], message: string) => {
  if (errors.length < MAX_IMPORT_ERRORS) errors.push(message);
};

const mapGeneratedOtps = (gates: MailOtpGatePublic[], otpByEmail: Map<string, string>): GeneratedOtp[] =>
  gates
    .map((gate) => ({
      id: gate.id,
      email: gate.email,
      normalizedEmail: gate.normalizedEmail,
      otp: otpByEmail.get(gate.normalizedEmail) || ""
    }))
    .filter((item) => item.otp);

async function countMissingOtpRows(supabase = getSupabaseAdminClient()): Promise<MissingOtpCountResult> {
  const { count, error } = await supabase
    .from("mail_otp_gates")
    .select("id", { count: "exact", head: true })
    .or(MISSING_OTP_FILTER);

  if (error) throw error;
  return { count: Number(count || 0) };
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
      .order("updated_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit);
    const [gatesResult, missingOtpResult] = await Promise.all([
      gatesQuery,
      countMissingOtpRows(supabase)
    ]);

    if (gatesResult.error) throw gatesResult.error;
    const gates = ((gatesResult.data as MailOtpGateRow[]) || []).map(toMailOtpGatePublic);
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

  const payload = {
    email,
    normalized_email: email,
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
    const secret = createOtpSecret(otp);
    if (preparedByEmail.has(normalizedEmail)) duplicateCount += 1;

    preparedByEmail.set(normalizedEmail, {
      inputIndex: index + 1,
      normalizedEmail,
      otp,
      payload: {
        email: normalizedEmail,
        normalized_email: normalizedEmail,
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

  const gates = ((data as MailOtpGateRow[]) || []).map(toMailOtpGatePublic);
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
      generatedOtpCount
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
  const scope = body.scope === "all" ? "all" : "ids";
  const ids = toPositiveIds(body.ids ?? body.gateIds);
  if (scope !== "all" && !ids.length) {
    return NextResponse.json({ error: "Chọn ít nhất 1 mail để random OTP." }, { status: 400 });
  }
  if (ids.length > MAX_RANDOM_OTP_ROWS) {
    return NextResponse.json(
      { error: `Random tối đa ${MAX_RANDOM_OTP_ROWS.toLocaleString("vi-VN")} mail mỗi lần.` },
      { status: 400 }
    );
  }

  const supabase = getSupabaseAdminClient();
  const baseQuery = supabase.from("mail_otp_gates").select(GATE_SELECT);
  const query = scope === "all"
    ? baseQuery.order("id", { ascending: true }).limit(MAX_RANDOM_OTP_ROWS + 1)
    : baseQuery.in("id", ids).order("id", { ascending: true });
  const { data: existingRows, error: selectError } = await query;
  if (selectError) throw selectError;

  const rows = ((existingRows as MailOtpGateRow[]) || []);
  if (rows.length > MAX_RANDOM_OTP_ROWS) {
    return NextResponse.json(
      { error: `Random tất cả đang giới hạn ${MAX_RANDOM_OTP_ROWS.toLocaleString("vi-VN")} mail mỗi lần.` },
      { status: 400 }
    );
  }
  if (!rows.length) {
    return NextResponse.json({ error: "Không tìm thấy mail để random OTP." }, { status: 404 });
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

  const gates = ((data as MailOtpGateRow[]) || []).map(toMailOtpGatePublic);
  const generatedOtps = mapGeneratedOtps(gates, otpByEmail);

  await recordAdminAuditEvent(supabase, {
    adminUserId: adminSession.userId,
    adminEmail: adminSession.email,
    action: scope === "all" ? "mail_otp_gate.random_otp_all" : "mail_otp_gate.random_otp_selected",
    entityType: "mail_otp_gate",
    metadata: {
      scope,
      count: gates.length,
      ids: scope === "all" ? undefined : ids.slice(0, 100)
    }
  });

  return NextResponse.json({ success: true, data: { gates, generatedOtps, count: gates.length, scope } });
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
    .order("id", { ascending: true })
    .limit(MAX_FILL_MISSING_OTP_ROWS + 1);
  if (selectError) throw selectError;

  const rows = ((existingRows as MailOtpGateRow[]) || []);
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

  const gates = ((data as MailOtpGateRow[]) || []).map(toMailOtpGatePublic);
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
    if (action === "random_otp") return await randomizeOtp(body, adminSession);
    if (action === "fill_missing_otp") return await fillMissingOtp(body, adminSession);
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