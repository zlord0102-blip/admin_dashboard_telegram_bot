import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/app/api/_shared/supabaseAdmin";
import { checkRateLimit, getClientIp } from "@/app/api/_shared/rateLimit";
import {
  generateActivationToken,
  getLicenseServiceUnavailableBody,
  getRequestIp,
  logLicenseServiceError,
  normalizeExtensionCode,
  normalizeFingerprint,
  normalizeLicenseKey,
  normalizeOptionalVersion,
  runActivateLicenseRpc
} from "@/app/api/_shared/license";

export async function POST(request: NextRequest) {
  let body: {
    extensionCode?: string;
    licenseKey?: string;
    fingerprint?: string;
    version?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const extensionCode = normalizeExtensionCode(body.extensionCode);
  const licenseKey = normalizeLicenseKey(body.licenseKey);
  const fingerprint = normalizeFingerprint(body.fingerprint);
  const version = normalizeOptionalVersion(body.version);

  if (!extensionCode || !licenseKey || !fingerprint) {
    return NextResponse.json(
      { error: "Thiếu extensionCode, licenseKey hoặc fingerprint hợp lệ." },
      { status: 400 }
    );
  }

  const rateLimit = checkRateLimit(`licenses:activate:${getClientIp(request)}:${extensionCode}`, {
    windowMs: 60_000,
    max: 30
  });
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: "Too many activation attempts. Please retry later." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  try {
    const activationToken = generateActivationToken();
    const data = await runActivateLicenseRpc(getSupabaseAdminClient(), {
      extensionCode,
      licenseKey,
      fingerprint,
      activationToken,
      ip: getRequestIp(request),
      userAgent: request.headers.get("user-agent"),
      version
    });

    return NextResponse.json({
      success: true,
      data: data.valid
        ? {
            ...data,
            activationToken
          }
        : data
    });
  } catch (error) {
    logLicenseServiceError("licenses.activate", error);
    return NextResponse.json(getLicenseServiceUnavailableBody(), { status: 503 });
  }
}
