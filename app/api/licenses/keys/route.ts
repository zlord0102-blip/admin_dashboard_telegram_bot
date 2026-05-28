import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAdminSession } from "@/app/api/_shared/adminAuth";
import {
  generateLicenseKey,
  getKeyPrefix,
  getKeySuffix,
  hashSecret,
  listLicenseKeys,
  maskLicenseKey,
  normalizeLicenseKeyDeviceLimitMode,
  normalizeOptionalText
} from "@/app/api/_shared/license";
import type { LicenseKeyAdminStatus, LicenseKeyDeviceLimitMode } from "@/lib/licenseTypes";
import { getOrSetServerCache, invalidateServerCacheByPrefix } from "@/app/api/_shared/serverCache";
import { withAdminApiTiming } from "@/app/api/_shared/serverTiming";

const LICENSE_ADMIN_CACHE_PREFIX = "admin-license:";
const LICENSE_ADMIN_CACHE_TTL_MS = 15_000;

const toPositiveInt = (value: unknown) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const parseExpiresAt = (value: unknown) => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const isDuplicateError = (message: string) => {
  const lowered = message.toLowerCase();
  return lowered.includes("duplicate key") || lowered.includes("already exists");
};

const invalidateLicenseAdminCache = () => invalidateServerCacheByPrefix(LICENSE_ADMIN_CACHE_PREFIX);

const collapseToSingleDeviceIfNeeded = async (supabase: SupabaseClient, licenseKeyId: number) => {
  const { data: activationRows, error: activationError } = await supabase
    .from("license_activations")
    .select("id")
    .eq("license_key_id", licenseKeyId)
    .is("deactivated_at", null)
    .order("last_checked_at", { ascending: false })
    .order("activated_at", { ascending: false });

  if (activationError) {
    throw activationError;
  }

  if (!activationRows || activationRows.length <= 1) {
    return 0;
  }

  const idsToDeactivate = activationRows.slice(1).map((row) => row.id);
  if (!idsToDeactivate.length) {
    return 0;
  }

  const { error } = await supabase
    .from("license_activations")
    .update({
      deactivated_at: new Date().toISOString(),
      deactivation_reason: "admin_single_device_enforced"
    })
    .in("id", idsToDeactivate);

  if (error) {
    throw error;
  }

  return idsToDeactivate.length;
};

async function handleGET(request: NextRequest) {
  const adminSession = await requireAdminSession(request);
  if (adminSession.ok === false) {
    return adminSession.response;
  }

  const extensionId = toPositiveInt(request.nextUrl.searchParams.get("extensionId"));
  const rawStatus = String(request.nextUrl.searchParams.get("status") || "").trim().toLowerCase();
  const status: LicenseKeyAdminStatus | "all" =
    rawStatus === "active" || rawStatus === "expired" || rawStatus === "revoked" ? rawStatus : "all";

  try {
    const cacheKey = `${LICENSE_ADMIN_CACHE_PREFIX}keys:v1:${extensionId || "all"}:${status}`;
    const { value: data, hit } = await getOrSetServerCache(cacheKey, LICENSE_ADMIN_CACHE_TTL_MS, () =>
      listLicenseKeys(adminSession.supabase, {
        extensionId,
        status
      })
    );
    const response = NextResponse.json({ success: true, data });
    response.headers.set("X-Admin-Api-Cache", hit ? "hit" : "miss");
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Không thể tải danh sách license key." },
      { status: 500 }
    );
  }
}

async function handlePOST(request: NextRequest) {
  const adminSession = await requireAdminSession(request);
  if (adminSession.ok === false) {
    return adminSession.response;
  }

  let body: {
    id?: number;
    extensionId?: number;
    expiresAt?: string;
    note?: string;
    deviceLimitMode?: LicenseKeyDeviceLimitMode;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const licenseKeyId = toPositiveInt(body.id);
  const expiresAt = parseExpiresAt(body.expiresAt);
  const note = normalizeOptionalText(body.note, 1000);
  const deviceLimitMode = normalizeLicenseKeyDeviceLimitMode(body.deviceLimitMode);

  if (!expiresAt) {
    return NextResponse.json({ error: "Ngày hết hạn không hợp lệ." }, { status: 400 });
  }

  if (licenseKeyId) {
    const { data: existingRow, error: existingError } = await adminSession.supabase
      .from("license_keys")
      .select("id")
      .eq("id", licenseKeyId)
      .maybeSingle();

    if (existingError) {
      return NextResponse.json({ error: existingError.message || "Không thể tải license key." }, { status: 500 });
    }

    if (!existingRow) {
      return NextResponse.json({ error: "Không tìm thấy license key." }, { status: 404 });
    }

    const { error } = await adminSession.supabase
      .from("license_keys")
      .update({
        expires_at: expiresAt,
        note,
        device_limit_mode: deviceLimitMode
      })
      .eq("id", licenseKeyId);

    if (error) {
      return NextResponse.json({ error: error.message || "Không thể cập nhật license key." }, { status: 500 });
    }

    let prunedActivationCount = 0;
    if (deviceLimitMode === "single_device") {
      try {
        prunedActivationCount = await collapseToSingleDeviceIfNeeded(adminSession.supabase, licenseKeyId);
      } catch (error) {
        return NextResponse.json(
          { error: error instanceof Error ? error.message : "Không thể đồng bộ activation sau khi cập nhật key." },
          { status: 500 }
        );
      }
    }

    invalidateLicenseAdminCache();
    return NextResponse.json({ success: true, data: { ok: true, id: licenseKeyId, prunedActivationCount } });
  }

  const extensionId = toPositiveInt(body.extensionId);
  if (!extensionId) {
    return NextResponse.json({ error: "Thiếu extension hợp lệ để tạo key." }, { status: 400 });
  }

  const { data: extensionRow, error: extensionError } = await adminSession.supabase
    .from("license_extensions")
    .select("id, code")
    .eq("id", extensionId)
    .maybeSingle();

  if (extensionError) {
    return NextResponse.json({ error: extensionError.message || "Không thể tải extension." }, { status: 500 });
  }

  if (!extensionRow) {
    return NextResponse.json({ error: "Không tìm thấy extension." }, { status: 404 });
  }

  let createdId: number | null = null;
  let rawKey = "";
  let maskedKey = "";

  for (let attempt = 0; attempt < 5; attempt += 1) {
    rawKey = generateLicenseKey(extensionRow.code);
    maskedKey = maskLicenseKey(getKeyPrefix(rawKey), getKeySuffix(rawKey));
    const { data, error } = await adminSession.supabase
      .from("license_keys")
      .insert({
        extension_id: extensionRow.id,
        key_hash: hashSecret(rawKey),
        key_prefix: getKeyPrefix(rawKey),
        key_suffix: getKeySuffix(rawKey),
        status: "active",
        expires_at: expiresAt,
        note,
        device_limit_mode: deviceLimitMode
      })
      .select("id")
      .maybeSingle();

    if (!error && data?.id) {
      createdId = data.id;
      break;
    }

    if (!error) {
      break;
    }

    if (!isDuplicateError(error.message || "")) {
      return NextResponse.json({ error: error.message || "Không thể tạo license key." }, { status: 500 });
    }
  }

  if (!createdId) {
    return NextResponse.json({ error: "Không thể tạo license key. Hãy thử lại." }, { status: 500 });
  }

  invalidateLicenseAdminCache();
  return NextResponse.json({
    success: true,
    data: {
      ok: true,
      id: createdId,
      rawKey,
      maskedKey
    }
  });
}

export const GET = withAdminApiTiming("GET /api/licenses/keys", handleGET);
export const POST = withAdminApiTiming("POST /api/licenses/keys", handlePOST);
