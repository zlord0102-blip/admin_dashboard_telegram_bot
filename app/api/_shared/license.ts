import { createHash, randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  LICENSE_RECHECK_INTERVAL_SECONDS,
  type LicenseActivationAdminStatus,
  type LicenseActivationRecord,
  type LicenseKeyActivationSummary,
  type LicenseKeyDeviceLimitMode,
  type LicenseExtensionRecord,
  type LicenseKeyAdminStatus,
  type LicenseKeyRecord,
  type LicensePublicResponse,
  type LicensePublicStatus
} from "@/lib/licenseTypes";

type LicenseExtensionRow = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type LicenseKeyRow = {
  id: number;
  extension_id: number;
  key_prefix: string;
  key_suffix: string;
  status: "active" | "expired" | "revoked";
  expires_at: string;
  note: string | null;
  device_limit_mode: string | null;
  created_at: string;
  updated_at: string;
};

type LicenseActivationRow = {
  id: number;
  license_key_id: number;
  fingerprint: string;
  activated_at: string;
  last_checked_at: string;
  deactivated_at: string | null;
  deactivation_reason: string | null;
  last_ip: string | null;
  last_user_agent: string | null;
  last_version: string | null;
  created_at: string;
  updated_at: string;
};

type RpcPublicResult = {
  valid?: boolean;
  status?: string;
  expires_at?: string | null;
};

type SanitizedErrorLog = {
  name?: string;
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

type LicenseRuntimeExtensionRow = Pick<LicenseExtensionRow, "id" | "is_active">;
type LicenseRuntimeKeyRow = Pick<LicenseKeyRow, "id" | "status" | "expires_at" | "device_limit_mode">;
type LicenseRuntimeActivationRow = Pick<LicenseActivationRow, "id" | "fingerprint">;

class LicenseRuntimeMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LicenseRuntimeMigrationError";
  }
}

const LICENSE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const toTrimmedString = (value: unknown) => String(value || "").trim();

export const normalizeExtensionCode = (value: unknown) =>
  toTrimmedString(value)
    .toUpperCase()
    .replace(/\s+/g, "-")
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 48);

export const normalizeLicenseKey = (value: unknown) =>
  toTrimmedString(value)
    .toUpperCase()
    .replace(/\s+/g, "");

export const normalizeFingerprint = (value: unknown) =>
  toTrimmedString(value)
    .replace(/\s+/g, " ")
    .slice(0, 255);

export const normalizeOptionalText = (value: unknown, maxLength = 2000) => {
  const text = toTrimmedString(value);
  return text ? text.slice(0, maxLength) : null;
};

export const normalizeOptionalVersion = (value: unknown) => normalizeOptionalText(value, 120);

export const normalizeLicenseKeyDeviceLimitMode = (value: unknown): LicenseKeyDeviceLimitMode =>
  String(value || "").trim().toLowerCase() === "unlimited_devices" ? "unlimited_devices" : "single_device";

export const hashSecret = (value: string) => createHash("sha256").update(value).digest("hex");

const randomGroup = (length: number) =>
  Array.from({ length }, () => LICENSE_ALPHABET[Math.floor(Math.random() * LICENSE_ALPHABET.length)]).join("");

export const generateLicenseKey = (extensionCode: string) => {
  const normalizedCode = normalizeExtensionCode(extensionCode).replace(/_/g, "-") || "EXT";
  return `LIC-${normalizedCode}-${randomGroup(5)}-${randomGroup(5)}-${randomGroup(5)}-${randomGroup(5)}`;
};

export const generateActivationToken = () => `act_${randomBytes(32).toString("hex")}`;

export const getKeyPrefix = (rawKey: string) => rawKey.slice(0, Math.min(12, rawKey.length));

export const getKeySuffix = (rawKey: string) => rawKey.slice(Math.max(0, rawKey.length - 6));

export const maskLicenseKey = (prefix: string, suffix: string) => `${prefix}...${suffix}`;

export const getEffectiveKeyStatus = (
  storedStatus: "active" | "expired" | "revoked",
  expiresAt: string
): LicenseKeyAdminStatus => {
  if (storedStatus === "revoked") return "revoked";
  if (storedStatus === "expired") return "expired";
  const expiresAtMs = new Date(expiresAt).getTime();
  if (Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now()) {
    return "expired";
  }
  return "active";
};

const isPublicStatus = (value: string): value is LicensePublicStatus =>
  value === "active" ||
  value === "expired" ||
  value === "revoked" ||
  value === "extension_disabled" ||
  value === "fingerprint_mismatch" ||
  value === "not_found";

const normalizeRpcPayload = (payload: unknown): LicensePublicResponse => {
  const source = Array.isArray(payload) ? payload[0] : payload;
  const rawStatus =
    typeof (source as RpcPublicResult | null)?.status === "string"
      ? String((source as RpcPublicResult).status)
      : "not_found";
  const status = isPublicStatus(rawStatus) ? rawStatus : "not_found";
  const valid = Boolean((source as RpcPublicResult | null)?.valid) && status === "active";
  const expiresAt =
    typeof (source as RpcPublicResult | null)?.expires_at === "string"
      ? String((source as RpcPublicResult).expires_at)
      : null;

  return {
    valid,
    status,
    expiresAt,
    nextCheckAfterSeconds: LICENSE_RECHECK_INTERVAL_SECONDS
  };
};

const mapActivationSummary = (
  row: Pick<LicenseActivationRow, "id" | "fingerprint" | "activated_at" | "last_checked_at" | "last_version">
): LicenseKeyActivationSummary => ({
  id: row.id,
  fingerprint: row.fingerprint,
  activatedAt: row.activated_at,
  lastCheckedAt: row.last_checked_at,
  lastVersion: row.last_version
});

export const getRequestIp = (request: NextRequest) => {
  const forwardedFor = request.headers.get("x-forwarded-for") || "";
  const firstForwarded = forwardedFor
    .split(",")
    .map((value) => value.trim())
    .find(Boolean);
  return firstForwarded || request.headers.get("x-real-ip") || null;
};

const getErrorField = (error: unknown, field: keyof SanitizedErrorLog) => {
  if (!error || typeof error !== "object") return undefined;
  const value = (error as Record<string, unknown>)[field];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

export const sanitizeErrorForLog = (error: unknown): SanitizedErrorLog => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message
    };
  }

  return {
    name: getErrorField(error, "name"),
    code: getErrorField(error, "code"),
    message: getErrorField(error, "message"),
    details: getErrorField(error, "details"),
    hint: getErrorField(error, "hint")
  };
};

const buildPublicResponse = (status: LicensePublicStatus, expiresAt: string | null): LicensePublicResponse => ({
  valid: status === "active",
  status,
  expiresAt,
  nextCheckAfterSeconds: LICENSE_RECHECK_INTERVAL_SECONDS
});

export const logLicenseServiceError = (scope: string, error: unknown) => {
  console.error(`[${scope}] License service error`, sanitizeErrorForLog(error));
};

export const getLicenseServiceUnavailableBody = () => ({
  success: false,
  code: "license_service_unavailable",
  error: "Dịch vụ license tạm thời không khả dụng. Vui lòng thử lại sau."
});

const isUniqueViolationError = (error: unknown) => {
  const code = getErrorField(error, "code");
  const message = getErrorField(error, "message") || "";
  return code === "23505" || message.toLowerCase().includes("duplicate key");
};

const isOldSingleDeviceIndexError = (error: unknown) => {
  const haystack = [
    getErrorField(error, "message"),
    getErrorField(error, "details"),
    getErrorField(error, "hint")
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes("idx_license_activations_active_key");
};

const recordLicenseCheck = async (
  supabase: SupabaseClient,
  params: {
    licenseKeyId: number | null;
    extensionCode: string;
    fingerprint: string;
    requestType: "activate" | "validate";
    resultStatus: LicensePublicStatus;
    ip: string | null;
    userAgent: string | null;
  }
) => {
  const { error } = await supabase.from("license_check_logs").insert({
    license_key_id: params.licenseKeyId,
    extension_code: params.extensionCode || "UNKNOWN",
    fingerprint: normalizeFingerprint(params.fingerprint) || null,
    request_type: params.requestType,
    result_status: params.resultStatus,
    ip: normalizeOptionalText(params.ip, 200),
    user_agent: normalizeOptionalText(params.userAgent, 512)
  });

  if (error) {
    logLicenseServiceError("licenses.log", error);
  }
};

const buildActivationMutation = (params: {
  activationTokenHash: string;
  ip: string | null;
  userAgent: string | null;
  version: string | null;
}) => ({
  activation_token_hash: params.activationTokenHash,
  last_checked_at: new Date().toISOString(),
  last_ip: normalizeOptionalText(params.ip, 200),
  last_user_agent: normalizeOptionalText(params.userAgent, 512),
  last_version: normalizeOptionalVersion(params.version)
});

async function activateUnlimitedLicenseFallback(
  supabase: SupabaseClient,
  params: {
    extensionCode: string;
    keyHash: string;
    fingerprint: string;
    activationTokenHash: string;
    ip: string | null;
    userAgent: string | null;
    version: string | null;
  },
  previousResponse: LicensePublicResponse
): Promise<LicensePublicResponse> {
  const { data: extensionRow, error: extensionError } = await supabase
    .from("license_extensions")
    .select("id, is_active")
    .eq("code", params.extensionCode)
    .maybeSingle();

  if (extensionError) {
    throw extensionError;
  }

  const extension = extensionRow as LicenseRuntimeExtensionRow | null;
  if (!extension || !extension.is_active) {
    return previousResponse;
  }

  const { data: keyRow, error: keyError } = await supabase
    .from("license_keys")
    .select("id, status, expires_at, device_limit_mode")
    .eq("extension_id", extension.id)
    .eq("key_hash", params.keyHash)
    .maybeSingle();

  if (keyError) {
    throw keyError;
  }

  const licenseKey = keyRow as LicenseRuntimeKeyRow | null;
  if (!licenseKey || normalizeLicenseKeyDeviceLimitMode(licenseKey.device_limit_mode) !== "unlimited_devices") {
    return previousResponse;
  }

  const effectiveStatus = getEffectiveKeyStatus(licenseKey.status, licenseKey.expires_at);
  if (effectiveStatus !== "active") {
    await recordLicenseCheck(supabase, {
      licenseKeyId: licenseKey.id,
      extensionCode: params.extensionCode,
      fingerprint: params.fingerprint,
      requestType: "activate",
      resultStatus: effectiveStatus,
      ip: params.ip,
      userAgent: params.userAgent
    });
    return buildPublicResponse(effectiveStatus, licenseKey.expires_at);
  }

  const activationPatch = buildActivationMutation(params);
  const { data: existingActivation, error: existingError } = await supabase
    .from("license_activations")
    .select("id, fingerprint")
    .eq("license_key_id", licenseKey.id)
    .eq("fingerprint", params.fingerprint)
    .is("deactivated_at", null)
    .order("activated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  const activeActivation = existingActivation as LicenseRuntimeActivationRow | null;
  if (activeActivation?.id) {
    const { error: updateError } = await supabase
      .from("license_activations")
      .update(activationPatch)
      .eq("id", activeActivation.id);

    if (updateError) {
      throw updateError;
    }

    await recordLicenseCheck(supabase, {
      licenseKeyId: licenseKey.id,
      extensionCode: params.extensionCode,
      fingerprint: params.fingerprint,
      requestType: "activate",
      resultStatus: "active",
      ip: params.ip,
      userAgent: params.userAgent
    });
    return buildPublicResponse("active", licenseKey.expires_at);
  }

  const { error: insertError } = await supabase.from("license_activations").insert({
    license_key_id: licenseKey.id,
    fingerprint: params.fingerprint,
    ...activationPatch
  });

  if (insertError) {
    if (isUniqueViolationError(insertError)) {
      if (isOldSingleDeviceIndexError(insertError)) {
        throw new LicenseRuntimeMigrationError(
          "License unlimited-device mode is blocked by the old single-device database index. Apply supabase_schema_license_multi_device_keys.sql."
        );
      }

      const { data: racedActivation, error: racedError } = await supabase
        .from("license_activations")
        .select("id, fingerprint")
        .eq("license_key_id", licenseKey.id)
        .eq("fingerprint", params.fingerprint)
        .is("deactivated_at", null)
        .order("activated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (racedError) {
        throw racedError;
      }

      const racedActiveActivation = racedActivation as LicenseRuntimeActivationRow | null;
      if (racedActiveActivation?.id) {
        const { error: updateRacedError } = await supabase
          .from("license_activations")
          .update(activationPatch)
          .eq("id", racedActiveActivation.id);

        if (updateRacedError) {
          throw updateRacedError;
        }
        return buildPublicResponse("active", licenseKey.expires_at);
      }
    }

    throw insertError;
  }

  await recordLicenseCheck(supabase, {
    licenseKeyId: licenseKey.id,
    extensionCode: params.extensionCode,
    fingerprint: params.fingerprint,
    requestType: "activate",
    resultStatus: "active",
    ip: params.ip,
    userAgent: params.userAgent
  });
  return buildPublicResponse("active", licenseKey.expires_at);
}

const mapExtensionsById = (rows: LicenseExtensionRow[]) =>
  new Map(rows.map((row) => [row.id, row]));

const mapKeysById = (rows: LicenseKeyRow[]) =>
  new Map(rows.map((row) => [row.id, row]));

export async function listLicenseExtensions(supabase: SupabaseClient): Promise<LicenseExtensionRecord[]> {
  const { data, error } = await supabase
    .from("license_extensions")
    .select("id, code, name, description, is_active, created_at, updated_at")
    .order("code", { ascending: true });

  if (error) {
    throw error;
  }

  const extensionRows = (data as LicenseExtensionRow[]) || [];
  if (!extensionRows.length) {
    return [];
  }

  const extensionIds = extensionRows.map((row) => row.id);
  const { data: keyData, error: keyError } = await supabase
    .from("license_keys")
    .select("id, extension_id, status, expires_at")
    .in("extension_id", extensionIds);

  if (keyError) {
    throw keyError;
  }

  const keyRows = (keyData as Array<Pick<LicenseKeyRow, "id" | "extension_id" | "status" | "expires_at">>) || [];
  const keyIds = keyRows.map((row) => row.id);

  let activeActivationRows: Array<Pick<LicenseActivationRow, "license_key_id">> = [];
  if (keyIds.length) {
    const { data: activationData, error: activationError } = await supabase
      .from("license_activations")
      .select("license_key_id")
      .in("license_key_id", keyIds)
      .is("deactivated_at", null);

    if (activationError) {
      throw activationError;
    }

    activeActivationRows = (activationData as Array<Pick<LicenseActivationRow, "license_key_id">>) || [];
  }

  const keyCountByExtension = new Map<number, number>();
  const activeKeyCountByExtension = new Map<number, number>();
  const activeActivationCountByExtension = new Map<number, number>();
  const extensionIdByKeyId = new Map<number, number>();

  for (const row of keyRows) {
    extensionIdByKeyId.set(row.id, row.extension_id);
    keyCountByExtension.set(row.extension_id, (keyCountByExtension.get(row.extension_id) || 0) + 1);
    if (getEffectiveKeyStatus(row.status, row.expires_at) === "active") {
      activeKeyCountByExtension.set(row.extension_id, (activeKeyCountByExtension.get(row.extension_id) || 0) + 1);
    }
  }

  for (const row of activeActivationRows) {
    const extensionId = extensionIdByKeyId.get(row.license_key_id);
    if (!extensionId) continue;
    activeActivationCountByExtension.set(extensionId, (activeActivationCountByExtension.get(extensionId) || 0) + 1);
  }

  return extensionRows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    keyCount: keyCountByExtension.get(row.id) || 0,
    activeKeyCount: activeKeyCountByExtension.get(row.id) || 0,
    activeActivationCount: activeActivationCountByExtension.get(row.id) || 0
  }));
}

export async function listLicenseKeys(
  supabase: SupabaseClient,
  filters?: {
    extensionId?: number | null;
    status?: LicenseKeyAdminStatus | "all" | null;
  }
): Promise<LicenseKeyRecord[]> {
  let query = supabase
    .from("license_keys")
    .select("id, extension_id, key_prefix, key_suffix, status, expires_at, note, device_limit_mode, created_at, updated_at")
    .order("created_at", { ascending: false })
    .range(0, 499);

  if (filters?.extensionId) {
    query = query.eq("extension_id", filters.extensionId);
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  const keyRows = (data as LicenseKeyRow[]) || [];
  if (!keyRows.length) {
    return [];
  }

  const extensionIds = Array.from(new Set(keyRows.map((row) => row.extension_id)));
  const keyIds = keyRows.map((row) => row.id);
  const [extensionResult, activationResult] = await Promise.all([
    supabase
      .from("license_extensions")
      .select("id, code, name, description, is_active, created_at, updated_at")
      .in("id", extensionIds),
    supabase
      .from("license_activations")
      .select("id, license_key_id, fingerprint, activated_at, last_checked_at, last_version")
      .in("license_key_id", keyIds)
      .order("last_checked_at", { ascending: false })
      .order("activated_at", { ascending: false })
      .is("deactivated_at", null)
  ]);

  if (extensionResult.error) {
    throw extensionResult.error;
  }

  if (activationResult.error) {
    throw activationResult.error;
  }

  const extensionById = mapExtensionsById((extensionResult.data as LicenseExtensionRow[]) || []);
  const activationRows =
    (activationResult.data as Array<
      Pick<LicenseActivationRow, "id" | "license_key_id" | "fingerprint" | "activated_at" | "last_checked_at" | "last_version">
    >) || [];
  const activeActivationsByKeyId = new Map<number, LicenseKeyActivationSummary[]>();

  for (const activationRow of activationRows) {
    const list = activeActivationsByKeyId.get(activationRow.license_key_id) || [];
    list.push(mapActivationSummary(activationRow));
    activeActivationsByKeyId.set(activationRow.license_key_id, list);
  }

  const mapped = keyRows.map((row) => {
    const extension = extensionById.get(row.extension_id);
    const activeActivations = activeActivationsByKeyId.get(row.id) || [];
    const activeActivation = activeActivations[0] || null;

    return {
      id: row.id,
      extensionId: row.extension_id,
      extensionCode: extension?.code || `EXT-${row.extension_id}`,
      extensionName: extension?.name || `Extension #${row.extension_id}`,
      maskedKey: maskLicenseKey(row.key_prefix, row.key_suffix),
      keyPrefix: row.key_prefix,
      keySuffix: row.key_suffix,
      status: getEffectiveKeyStatus(row.status, row.expires_at),
      storedStatus: row.status,
      expiresAt: row.expires_at,
      note: row.note,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      deviceLimitMode: normalizeLicenseKeyDeviceLimitMode(row.device_limit_mode),
      activeActivationCount: activeActivations.length,
      activeActivations,
      activeActivation
    } satisfies LicenseKeyRecord;
  });

  if (!filters?.status || filters.status === "all") {
    return mapped;
  }

  return mapped.filter((row) => row.status === filters.status);
}

export async function listLicenseActivations(
  supabase: SupabaseClient,
  filters?: {
    extensionId?: number | null;
    activeOnly?: boolean;
  }
): Promise<LicenseActivationRecord[]> {
  let scopedKeyRows: LicenseKeyRow[] | null = null;
  if (filters?.extensionId) {
    const { data: scopedKeyData, error: scopedKeyError } = await supabase
      .from("license_keys")
      .select("id, extension_id, key_prefix, key_suffix, status, expires_at, note, created_at, updated_at")
      .eq("extension_id", filters.extensionId);

    if (scopedKeyError) {
      throw scopedKeyError;
    }

    scopedKeyRows = (scopedKeyData as LicenseKeyRow[]) || [];
    if (!scopedKeyRows.length) {
      return [];
    }
  }

  let query = supabase
    .from("license_activations")
    .select(
      "id, license_key_id, fingerprint, activated_at, last_checked_at, deactivated_at, deactivation_reason, last_ip, last_user_agent, last_version, created_at, updated_at"
    )
    .order("last_checked_at", { ascending: false })
    .range(0, 499);

  if (scopedKeyRows) {
    query = query.in("license_key_id", scopedKeyRows.map((row) => row.id));
  }

  if (filters?.activeOnly) {
    query = query.is("deactivated_at", null);
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  const activationRows = (data as LicenseActivationRow[]) || [];
  if (!activationRows.length) {
    return [];
  }

  const keyRows =
    scopedKeyRows ??
    (await (async () => {
      const keyIds = Array.from(new Set(activationRows.map((row) => row.license_key_id)));
      const { data: keyData, error: keyError } = await supabase
        .from("license_keys")
        .select("id, extension_id, key_prefix, key_suffix, status, expires_at, note, created_at, updated_at")
        .in("id", keyIds);

      if (keyError) {
        throw keyError;
      }

      return (keyData as LicenseKeyRow[]) || [];
    })());
  const keyById = mapKeysById(keyRows);
  const extensionIds = Array.from(new Set(keyRows.map((row) => row.extension_id)));

  const { data: extensionData, error: extensionError } = await supabase
    .from("license_extensions")
    .select("id, code, name, description, is_active, created_at, updated_at")
    .in("id", extensionIds);

  if (extensionError) {
    throw extensionError;
  }

  const extensionById = mapExtensionsById((extensionData as LicenseExtensionRow[]) || []);
  const mapped = activationRows
    .map((row) => {
      const keyRow = keyById.get(row.license_key_id);
      if (!keyRow) return null;
      const extension = extensionById.get(keyRow.extension_id);
      if (!extension) return null;
      if (filters?.extensionId && extension.id !== filters.extensionId) {
        return null;
      }

      const keyStatus = getEffectiveKeyStatus(keyRow.status, keyRow.expires_at);
      let status: LicenseActivationAdminStatus = "active";
      if (row.deactivated_at) {
        status = "reset";
      } else if (!extension.is_active) {
        status = "extension_disabled";
      } else if (keyStatus === "revoked") {
        status = "revoked";
      } else if (keyStatus === "expired") {
        status = "expired";
      }

      return {
        id: row.id,
        licenseKeyId: row.license_key_id,
        extensionId: extension.id,
        extensionCode: extension.code,
        extensionName: extension.name,
        maskedKey: maskLicenseKey(keyRow.key_prefix, keyRow.key_suffix),
        fingerprint: row.fingerprint,
        status,
        keyStatus,
        activatedAt: row.activated_at,
        lastCheckedAt: row.last_checked_at,
        deactivatedAt: row.deactivated_at,
        deactivationReason: row.deactivation_reason,
        lastIp: row.last_ip,
        lastUserAgent: row.last_user_agent,
        lastVersion: row.last_version,
        expiresAt: keyRow.expires_at
      } satisfies LicenseActivationRecord;
    })
    .filter(Boolean) as LicenseActivationRecord[];

  return mapped;
}

export async function runActivateLicenseRpc(
  supabase: SupabaseClient,
  params: {
    extensionCode: string;
    licenseKey: string;
    fingerprint: string;
    activationToken: string;
    ip: string | null;
    userAgent: string | null;
    version: string | null;
  }
): Promise<LicensePublicResponse> {
  const keyHash = hashSecret(params.licenseKey);
  const activationTokenHash = hashSecret(params.activationToken);
  const { data, error } = await supabase.rpc("activate_license_key", {
    p_extension_code: params.extensionCode,
    p_key_hash: keyHash,
    p_activation_token_hash: activationTokenHash,
    p_fingerprint: params.fingerprint,
    p_ip: params.ip,
    p_user_agent: params.userAgent,
    p_version: params.version
  });

  if (error) {
    throw error;
  }

  const response = normalizeRpcPayload(data);
  if (response.status !== "fingerprint_mismatch") {
    return response;
  }

  return activateUnlimitedLicenseFallback(
    supabase,
    {
      extensionCode: params.extensionCode,
      keyHash,
      fingerprint: params.fingerprint,
      activationTokenHash,
      ip: params.ip,
      userAgent: params.userAgent,
      version: params.version
    },
    response
  );
}

export async function runValidateLicenseRpc(
  supabase: SupabaseClient,
  params: {
    extensionCode: string;
    activationToken: string;
    fingerprint: string;
    ip: string | null;
    userAgent: string | null;
    version: string | null;
  }
): Promise<LicensePublicResponse> {
  const { data, error } = await supabase.rpc("validate_license_activation", {
    p_extension_code: params.extensionCode,
    p_activation_token_hash: hashSecret(params.activationToken),
    p_fingerprint: params.fingerprint,
    p_ip: params.ip,
    p_user_agent: params.userAgent,
    p_version: params.version
  });

  if (error) {
    throw error;
  }

  return normalizeRpcPayload(data);
}
