import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/app/api/_shared/supabaseAdmin";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";

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

type CachedAdminSession = {
  userId: string;
  email: string | null;
  role: string;
  expiresAt: number;
};

type CachedAdminSessionResult =
  | {
      ok: true;
      session: CachedAdminSession;
    }
  | AdminSessionFailure;

const DEFAULT_ADMIN_SESSION_CACHE_TTL_MS = 15_000;
const MAX_ADMIN_SESSION_CACHE_TTL_MS = 60_000;
const ADMIN_SESSION_CACHE_SAFETY_MS = 5_000;
const ADMIN_SESSION_CACHE_MAX_ENTRIES = 200;

const adminSessionCache = new Map<string, CachedAdminSession>();
const adminSessionInflight = new Map<string, Promise<CachedAdminSessionResult>>();

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

const getAdminSessionCacheTtlMs = () => {
  const parsed = Number(process.env.ADMIN_SESSION_CACHE_TTL_MS);
  if (!Number.isFinite(parsed)) return DEFAULT_ADMIN_SESSION_CACHE_TTL_MS;
  return Math.max(0, Math.min(Math.trunc(parsed), MAX_ADMIN_SESSION_CACHE_TTL_MS));
};

const hashTokenForCache = (token: string) => createHash("sha256").update(token).digest("hex");

const getJwtExpiryMs = (claims: Record<string, unknown>) => {
  const exp = Number(claims.exp);
  if (!Number.isFinite(exp) || exp <= 0) return null;
  return exp * 1000;
};

const getCachedAdminSession = (cacheKey: string, now: number) => {
  const cached = adminSessionCache.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt > now) {
    return cached;
  }
  adminSessionCache.delete(cacheKey);
  return null;
};

const rememberAdminSession = (
  cacheKey: string,
  session: Omit<CachedAdminSession, "expiresAt">,
  claims: Record<string, unknown>,
  now: number
) => {
  const ttlMs = getAdminSessionCacheTtlMs();
  if (ttlMs <= 0) return;

  const jwtExpiresAt = getJwtExpiryMs(claims);
  const ttlExpiresAt = now + ttlMs;
  const expiresAt = jwtExpiresAt
    ? Math.min(ttlExpiresAt, jwtExpiresAt - ADMIN_SESSION_CACHE_SAFETY_MS)
    : ttlExpiresAt;

  if (expiresAt <= now) return;

  for (const [key, value] of adminSessionCache) {
    if (value.expiresAt <= now) {
      adminSessionCache.delete(key);
    }
  }

  adminSessionCache.set(cacheKey, {
    ...session,
    expiresAt
  });

  while (adminSessionCache.size > ADMIN_SESSION_CACHE_MAX_ENTRIES) {
    const oldestKey = adminSessionCache.keys().next().value;
    if (!oldestKey) break;
    adminSessionCache.delete(oldestKey);
  }
};

const buildAdminSessionSuccess = (token: string, session: CachedAdminSession): AdminSessionSuccess => ({
  ok: true,
  supabase: buildSupabaseClient(token),
  token,
  userId: session.userId,
  email: session.email,
  role: session.role
});

const loadVerifiedAdminSession = async (
  token: string,
  claims: Record<string, unknown>
): Promise<CachedAdminSessionResult> => {
  const authClient = buildSupabaseClient();
  const { data: userData, error: userError } = await authClient.auth.getUser(token);
  if (userError || !userData.user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized." }, { status: 401 })
    };
  }

  const userId = userData.user.id;
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

  const role = toOptionalString(adminRow.role) ?? "admin";
  if (!userId) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized." }, { status: 401 })
    };
  }

  return {
    ok: true,
    session: {
      userId,
      email: userData.user.email ?? toOptionalString(claims.email),
      role,
      expiresAt: 0
    }
  };
};

export async function requireAdminSession(request: NextRequest): Promise<AdminSessionResult> {
  if (!supabaseUrl || !supabasePublishableKey) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Supabase env missing. Require NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY." },
        { status: 500 }
      )
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

  const claims = decodeJwtClaims(token);
  const cacheKey = hashTokenForCache(token);
  const now = Date.now();
  const cachedSession = getCachedAdminSession(cacheKey, now);
  if (cachedSession) {
    return buildAdminSessionSuccess(token, cachedSession);
  }

  const pendingSession = adminSessionInflight.get(cacheKey);
  if (pendingSession) {
    const result = await pendingSession;
    if ("session" in result) {
      return buildAdminSessionSuccess(token, result.session);
    }
    return result;
  }

  const sessionRequest = loadVerifiedAdminSession(token, claims);
  adminSessionInflight.set(cacheKey, sessionRequest);

  try {
    const result = await sessionRequest;
    if (!("session" in result)) {
      return result;
    }

    rememberAdminSession(cacheKey, result.session, claims, now);
    return buildAdminSessionSuccess(token, {
      ...result.session,
      expiresAt: Date.now() + getAdminSessionCacheTtlMs()
    });
  } finally {
    adminSessionInflight.delete(cacheKey);
  }
}
