import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, getClientIp } from "@/app/api/_shared/rateLimit";
import { getSupabaseAdminClient } from "@/app/api/_shared/supabaseAdmin";
import {
  getMailAddressFromPayload,
  isValidMailAddress,
  normalizeMailAddress,
  parseOtpInput,
  verifyOtpSecret,
  type MailOtpGateRow
} from "@/app/api/_shared/mailOtpGate";

const GATE_SELECT =
  "id,email,normalized_email,otp_hash,otp_salt,active,note,last_checked_at,last_verified_at,check_count,verify_count,created_at,updated_at";

const extractProvidedToken = (request: NextRequest) => {
  const headerToken =
    request.headers.get("x-mail-manager-token") ||
    request.headers.get("x-mail-manager-api-token") ||
    request.headers.get("x-api-key") ||
    "";
  if (headerToken.trim()) return headerToken.trim();

  const authHeader = request.headers.get("authorization") || "";
  if (authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }
  return "";
};

const digestToken = (value: string) => createHash("sha256").update(value).digest();

const safeTokenEquals = (provided: string, expected: string) =>
  timingSafeEqual(digestToken(provided), digestToken(expected));

const buildGateResponse = ({
  email,
  normalizedEmail,
  requiresOtp,
  verified,
  reason,
  gate
}: {
  email: string;
  normalizedEmail: string;
  requiresOtp: boolean;
  verified: boolean;
  reason: "not_protected" | "otp_required" | "otp_verified" | "otp_invalid";
  gate?: MailOtpGateRow | null;
}) => ({
  success: true,
  data: {
    email,
    normalizedEmail,
    requiresOtp,
    verified,
    reason,
    gateId: gate ? Number(gate.id) : null,
    updatedAt: gate?.updated_at || null,
    lastVerifiedAt: gate?.last_verified_at || null
  }
});

async function touchGateCheck(gate: MailOtpGateRow, verified: boolean) {
  const now = new Date().toISOString();
  const nextCheckCount = Number(gate.check_count || 0) + 1;
  const nextVerifyCount = verified ? Number(gate.verify_count || 0) + 1 : Number(gate.verify_count || 0);
  await getSupabaseAdminClient()
    .from("mail_otp_gates")
    .update({
      last_checked_at: now,
      check_count: nextCheckCount,
      ...(verified ? { last_verified_at: now, verify_count: nextVerifyCount } : {})
    })
    .eq("id", gate.id);
}

export async function POST(request: NextRequest) {
  const rateLimit = checkRateLimit(`mail-manager-check:${getClientIp(request)}`, {
    windowMs: 60_000,
    max: 300
  });
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: "Too many mail check attempts. Please retry later." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  const expectedToken = process.env.MAIL_MANAGER_API_TOKEN || "";
  if (!expectedToken) {
    return NextResponse.json({ error: "MAIL_MANAGER_API_TOKEN missing." }, { status: 500 });
  }

  const providedToken = extractProvidedToken(request);
  if (!providedToken) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!safeTokenEquals(providedToken, expectedToken)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const email = normalizeMailAddress(getMailAddressFromPayload(body));
  if (!email || !isValidMailAddress(email)) {
    return NextResponse.json({ error: "email không hợp lệ." }, { status: 400 });
  }

  const parsedOtp = parseOtpInput(body.otp ?? body.code);
  if (parsedOtp.error) {
    return NextResponse.json({ error: parsedOtp.error }, { status: 400 });
  }

  try {
    const { data, error } = await getSupabaseAdminClient()
      .from("mail_otp_gates")
      .select(GATE_SELECT)
      .eq("normalized_email", email)
      .eq("active", true)
      .maybeSingle();

    if (error) throw error;

    const gate = data as MailOtpGateRow | null;
    if (!gate) {
      return NextResponse.json(
        buildGateResponse({
          email,
          normalizedEmail: email,
          requiresOtp: false,
          verified: true,
          reason: "not_protected"
        })
      );
    }

    if (!parsedOtp.otp) {
      await touchGateCheck(gate, false);
      return NextResponse.json(
        buildGateResponse({
          email: String(gate.email || email),
          normalizedEmail: email,
          requiresOtp: true,
          verified: false,
          reason: "otp_required",
          gate
        })
      );
    }

    const verified = verifyOtpSecret(parsedOtp.otp, gate.otp_salt, gate.otp_hash);
    await touchGateCheck(gate, verified);

    return NextResponse.json(
      buildGateResponse({
        email: String(gate.email || email),
        normalizedEmail: email,
        requiresOtp: true,
        verified,
        reason: verified ? "otp_verified" : "otp_invalid",
        gate
      })
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Không thể kiểm tra mail OTP." },
      { status: 500 }
    );
  }
}
