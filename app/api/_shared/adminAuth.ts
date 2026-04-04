import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

export const buildSupabaseClient = (token?: string) =>
  createClient(supabaseUrl, supabaseAnonKey, {
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

const isUnauthorizedAuthError = (message: string) => {
  const lowered = message.toLowerCase();
  return (
    lowered.includes("jwt") ||
    lowered.includes("token") ||
    lowered.includes("authorization") ||
    lowered.includes("auth session missing") ||
    lowered.includes("expired")
  );
};

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
  if (!supabaseUrl || !supabaseAnonKey) {
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

  const supabase = buildSupabaseClient(token);
  const { data: adminRow, error: adminError } = await supabase
    .from("admin_users")
    .select("user_id, role")
    .maybeSingle();

  if (adminError) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: isUnauthorizedAuthError(adminError.message || "") ? "Unauthorized." : "Forbidden." },
        { status: isUnauthorizedAuthError(adminError.message || "") ? 401 : 403 }
      )
    };
  }

  if (!adminRow) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden." }, { status: 403 })
    };
  }

  const claims = decodeJwtClaims(token);
  const userId = toOptionalString(adminRow.user_id) ?? toOptionalString(claims.sub);
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
    email: toOptionalString(claims.email),
    role
  };
}
