import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHash, timingSafeEqual } from "node:crypto";
import { executeCustomCheck } from "../shared";
import type { CustomCheckRequestBody } from "../shared";
import { checkRateLimit, getClientIp } from "@/app/api/_shared/rateLimit";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const cronSecret = process.env.CRON_SECRET || "";

const buildServiceClient = () =>
  createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

const extractProvidedSecret = (request: NextRequest) => {
  const headerSecret = request.headers.get("x-cron-secret") || request.headers.get("x-cron-token") || "";
  if (headerSecret.trim()) {
    return headerSecret.trim();
  }

  const authHeader = request.headers.get("authorization") || "";
  if (authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }
  return "";
};

const digestSecret = (value: string) => createHash("sha256").update(value).digest();

const safeSecretEquals = (provided: string, expected: string) =>
  timingSafeEqual(digestSecret(provided), digestSecret(expected));

export async function POST(request: NextRequest) {
  if (!supabaseUrl || !supabaseSecretKey) {
    return NextResponse.json(
      { error: "Supabase env missing. Require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 }
    );
  }
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET missing." }, { status: 500 });
  }

  const rateLimit = checkRateLimit(`stock-custom-check-cron:${getClientIp(request)}`, {
    windowMs: 60_000,
    max: 10
  });
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: "Too many cron attempts. Please retry later." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
    );
  }

  const providedSecret = extractProvidedSecret(request);
  if (!providedSecret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!safeSecretEquals(providedSecret, cronSecret)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  let body: CustomCheckRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const supabase = buildServiceClient();
  const result = await executeCustomCheck(supabase, body);
  if (!result.ok) {
    return NextResponse.json({ error: result.error || "Không thể custom check." }, { status: result.status });
  }

  return NextResponse.json(result.data);
}
