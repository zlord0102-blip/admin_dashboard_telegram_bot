"use client";

import { supabase } from "@/lib/supabaseClient";
import type { AdminSessionSnapshot } from "@/components/AdminSessionContext";

const SESSION_CACHE_TTL_MS = 10_000;
const sessionCache = new Map<string, { expiresAt: number; data: AdminSessionSnapshot }>();
const sessionRequests = new Map<string, Promise<AdminSessionSnapshot>>();

export class AdminSessionClientError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AdminSessionClientError";
    this.status = status;
  }
}

export async function fetchAdminSessionSnapshot(token?: string): Promise<AdminSessionSnapshot> {
  const accessToken =
    token ||
    (await supabase.auth.getSession()).data.session?.access_token ||
    "";

  if (!accessToken) {
    throw new AdminSessionClientError("Unauthorized.", 401);
  }

  const now = Date.now();
  const cached = sessionCache.get(accessToken);
  if (cached && cached.expiresAt > now) {
    return cached.data;
  }

  const pending = sessionRequests.get(accessToken);
  if (pending) {
    return pending;
  }

  const request = (async () => {
    const response = await fetch("/api/admin/session", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`
      },
      cache: "no-store"
    });

    const json = await response.json().catch(() => null);
    if (!response.ok) {
      throw new AdminSessionClientError(
        typeof json?.error === "string" && json.error.trim()
          ? json.error
          : "Không thể tải phiên admin.",
        response.status
      );
    }

    const result = (json?.data ?? null) as AdminSessionSnapshot | null;
    if (!result?.userId || !result?.role) {
      throw new AdminSessionClientError("Phiên admin không hợp lệ.", 500);
    }

    sessionCache.set(accessToken, {
      data: result,
      expiresAt: Date.now() + SESSION_CACHE_TTL_MS
    });

    return result;
  })();

  sessionRequests.set(accessToken, request);
  try {
    return await request;
  } finally {
    sessionRequests.delete(accessToken);
  }
}
