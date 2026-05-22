"use client";

import type {
  BinancePayWebhookAlert,
  BinancePayWebhookHealth
} from "@/lib/binancePayWebhookAlerts";
import { supabase } from "@/lib/supabaseClient";

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

async function fetchWithAdminAuth<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Chưa đăng nhập.");

  const response = await fetch(path, {
    ...init,
    headers: (() => {
      const headers = new Headers(init.headers);
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
  return (json?.data ?? null) as T;
}

export const fetchAdminOpsHealth = (lowStock = 5) =>
  fetchWithAdminAuth<AdminOpsHealth>(`/api/admin/health?lowStock=${Math.max(0, Math.trunc(lowStock) || 0)}`);

export const fetchAdminAuditLogs = (limit = 40) =>
  fetchWithAdminAuth<{ logs: AdminAuditLogRow[] }>(`/api/admin/audit?limit=${Math.max(1, Math.min(Math.trunc(limit) || 40, 100))}`);

export async function adminApiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  return fetchWithAdminAuth<T>(path, {
    ...init,
    headers
  });
}
