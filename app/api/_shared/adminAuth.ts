import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/app/api/_shared/supabaseAdmin";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

export const buildSupabaseClient = (token?: string) =>
  createClient(supabaseUrl, supabasePublishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    },
    global: token
      ? {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      : undefined
  });

type AdminSessionSuccess = {
  ok: true;
  supabase: SupabaseClient;
  token: string;
  userId: string;
  email: string | null;
  role: string;
};

type AdminSessionFailure = {
  ok: false;
  response: NextResponse;
};

export type AdminSessionResult = AdminSessionSuccess | AdminSessionFailure;

const toOptionalString = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const decodeJwtClaims = (token: string) => {
  try {
    const [, payload] = token.split(".");
    if (!payload) return {} as Record<string, unknown>;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
    const json = Buffer.from(normalized + padding, "base64").toString("utf8");
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {} as Record<string, unknown>;
  }
};

export async function requireAdminSession(request: NextRequest): Promise<AdminSessionResult> {
  if (!supabaseUrl || !supabasePublishableKey) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Supabase env missing." }, { status: 500 })
    };
  }

  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized." }, { status: 401 })
    };
  }

  const authClient = buildSupabaseClient();
  const { data: userData, error: userError } = await authClient.auth.getUser(token);
  if (userError || !userData.user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized." }, { status: 401 })
    };
  }

  const userId = userData.user.id;
  const supabase = buildSupabaseClient(token);
  const adminSupabase = getSupabaseAdminClient();
  const { data: adminRow, error: adminError } = await adminSupabase
    .from("admin_users")
    .select("user_id, role")
    .eq("user_id", userId)
    .maybeSingle();

  if (adminError) {
    return {
      ok: false,
      response: NextResponse.json({ error: adminError.message || "Không thể kiểm tra quyền admin." }, { status: 500 })
    };
  }

  if (!adminRow) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Tài khoản này chưa được cấp quyền admin." }, { status: 403 })
    };
  }

  const claims = decodeJwtClaims(token);
  const role = toOptionalString(adminRow.role) ?? "admin";
  if (!userId) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized." }, { status: 401 })
    };
  }

  return {
    ok: true,
    supabase,
    token,
    userId,
    email: userData.user.email ?? toOptionalString(claims.email),
    role
  };
}
