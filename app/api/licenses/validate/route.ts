import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/app/api/_shared/supabaseAdmin";
import { checkRateLimit, getClientIp } from "@/app/api/_shared/rateLimit";
import {
  getLicenseServiceUnavailableBody,
  getRequestIp,
  logLicenseServiceError,
  normalizeExtensionCode,
  normalizeFingerprint,
  normalizeOptionalVersion,
  normalizeOptionalText,
  runValidateLicenseRpc
} from "@/app/api/_shared/license";

export async function POST(request: NextRequest) {
  let body: {
    extensionCode?: string;
    activationToken?: string;
    fingerprint?: string;
    version?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const extensionCode = normalizeExtensionCode(body.extensionCode);
  const activationToken = normalizeOptionalText(body.activationToken, 512);
  const fingerprint = normalizeFingerprint(body.fingerprint);
  const version = normalizeOptionalVersion(body.version);

  if (!extensionCode || !activationToken || !fingerprint) {
    return NextResponse.json(
      { error: "Thiếu extensionCode, activationToken hoặc fingerprint hợp lệ." },
      { status: 400 }
    );
  }

  const rateLimit = checkRateLimit(`licenses:validate:${getClientIp(request)}:${extensionCode}`, {
    windowMs: 60_000,
    max: 120
  });
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: "Too many validation attempts. Please retry later." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  try {
    const data = await runValidateLicenseRpc(getSupabaseAdminClient(), {
      extensionCode,
      activationToken,
      fingerprint,
      ip: getRequestIp(request),
      userAgent: request.headers.get("user-agent"),
      version
    });

    return NextResponse.json({ success: true, data });
  } catch (error) {
    logLicenseServiceError("licenses.validate", error);
    return NextResponse.json(getLicenseServiceUnavailableBody(), { status: 503 });
  }
}
