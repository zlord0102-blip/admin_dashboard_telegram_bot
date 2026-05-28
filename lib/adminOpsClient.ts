"use client";

import type {
  BinancePayWebhookAlert,
  BinancePayWebhookHealth
} from "@/lib/binancePayWebhookAlerts";
import { supabase } from "@/lib/supabaseClient";

const ADMIN_OPS_GET_CACHE_TTL_MS = 5_000;
const adminOpsGetCache = new Map<string, { expiresAt: number; data: unknown }>();
const adminOpsGetRequests = new Map<string, Promise<unknown>>();

export type { BinancePayWebhookAlert, BinancePayWebhookHealth };

export type AdminOpsHealth = {
  checkedAt: string;
  schema: {
    tables: Record<string, boolean>;
    productColumns: Record<string, boolean>;
    rpcs: Record<string, boolean>;
  };
  settings: Record<string, boolean>;
  queues: {
    pendingDeposits: number;
    pendingWithdrawals: number;
    pendingUsdtWithdrawals: number;
    pendingDirectOrders: number;
    pendingDirectOrdersExpired: number;
    deliveryOutbox: {
      available: boolean;
      pending: number;
      sending: number;
      sent: number;
      failed: number;
      retryDue: number;
    };
  };
  stock: {
    threshold: number;
    count: number;
    items: Array<{ id: number; name: string; availableStock: number }>;
  };
  checkerHealth?: Record<string, unknown>;
  binancePayWebhook?: BinancePayWebhookHealth | null;
  binancePayWebhookAlerts?: BinancePayWebhookAlert[];
};

export type AdminAuditLogRow = {
  id: number;
  admin_user_id: string | null;
  admin_email: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

type AdminOpsRequestOptions = RequestInit & {
  cacheGet?: boolean;
  force?: boolean;
};

async function fetchWithAdminAuth<T>(path: string, init: AdminOpsRequestOptions = {}): Promise<T> {
  const { cacheGet = false, force = false, ...requestInit } = init;
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Chưa đăng nhập.");
  const method = String(requestInit.method || "GET").toUpperCase();
  const cacheKey = `${token}:${method}:${path}`;
  const canDedupeGet = method === "GET" && force !== true;
  const canUseClientCache = canDedupeGet && cacheGet;
  const now = Date.now();

  if (canUseClientCache) {
    const cached = adminOpsGetCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.data as T;
    }

  }

  if (canDedupeGet) {
    const pending = adminOpsGetRequests.get(cacheKey);
    if (pending) return pending as Promise<T>;
  }

  const request = (async () => {
    const response = await fetch(path, {
      ...requestInit,
      headers: (() => {
        const headers = new Headers(requestInit.headers);
        headers.set("Authorization", `Bearer ${token}`);
        return headers;
      })(),
      cache: "no-store"
    });

    const json = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(
        typeof json?.error === "string" && json.error.trim()
          ? json.error
          : "Không thể tải dữ liệu."
      );
    }
    const result = (json?.data ?? null) as T;
    if (canUseClientCache) {
      adminOpsGetCache.set(cacheKey, {
        data: result,
        expiresAt: Date.now() + ADMIN_OPS_GET_CACHE_TTL_MS
      });
    }
    return result;
  })();

  if (canDedupeGet) {
    adminOpsGetRequests.set(cacheKey, request as Promise<unknown>);
  }
  try {
    return await request;
  } finally {
    adminOpsGetRequests.delete(cacheKey);
  }
}

export const fetchAdminOpsHealth = (lowStock = 5, options: { force?: boolean } = {}) => {
  const params = new URLSearchParams();
  params.set("lowStock", String(Math.max(0, Math.trunc(lowStock) || 0)));
  if (options.force) {
    params.set("_refresh", String(Date.now()));
  }
  return fetchWithAdminAuth<AdminOpsHealth>(`/api/admin/health?${params.toString()}`, {
    cacheGet: true,
    force: options.force
  });
};

export const fetchAdminAuditLogs = (limit = 40, options: { force?: boolean } = {}) =>
  fetchWithAdminAuth<{ logs: AdminAuditLogRow[] }>(
    `/api/admin/audit?limit=${Math.max(1, Math.min(Math.trunc(limit) || 40, 100))}`,
    { cacheGet: true, force: options.force }
  );

export async function adminApiGet<T>(
  path: string,
  options: { cacheGet?: boolean; force?: boolean } = {}
): Promise<T> {
  return fetchWithAdminAuth<T>(path, {
    method: "GET",
    cacheGet: options.cacheGet,
    force: options.force
  });
}

export async function adminApiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  return fetchWithAdminAuth<T>(path, {
    ...init,
    headers
  });
}
