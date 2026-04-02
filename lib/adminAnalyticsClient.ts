"use client";

import { supabase } from "@/lib/supabaseClient";

const SNAPSHOT_CACHE_TTL_MS = 8_000;
const snapshotCache = new Map<string, { expiresAt: number; data: unknown }>();
const snapshotRequests = new Map<string, Promise<unknown>>();

export type DashboardStats = {
  users: number;
  orders: number;
  revenue: number;
};

export type DashboardCheckerState = "healthy" | "warning" | "error" | "unknown";

export type DashboardCheckerHealth = {
  state: DashboardCheckerState;
  heartbeatAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  mode: string | null;
  intervalSeconds: number;
  sleepSeconds: number;
  lastDurationMs: number | null;
  runtime: string | null;
  outboxPending: number;
  outboxSending: number;
  outboxFailed: number;
  outboxAvailable: boolean;
};

export type DashboardOrderRow = {
  id: number;
  user_id: number;
  username: string | null;
  display_name: string | null;
  product_id: number;
  product_name: string;
  price: number;
  quantity: number;
  created_at: string;
};

export type DashboardSnapshot = {
  stats: DashboardStats;
  pendingDeposits: number;
  pendingWithdrawals: number;
  checkerHealth: DashboardCheckerHealth;
  orders: DashboardOrderRow[];
};

export type RevenueStats = {
  current: number;
  previous: number;
  deltaAmount: number;
  deltaPercent: number;
};

export type OrderOpsStats = {
  orderCount: number;
  averageOrderValue: number;
  averageQuantity: number;
};

export type DirectOrderStats = {
  total: number;
  confirmed: number;
  failed: number;
  cancelled: number;
  pending: number;
  pendingExpired: number;
  confirmedRate: number;
  failedRate: number;
};

export type DailyTrendRow = {
  dateKey: string;
  label: string;
  orders: number;
  revenue: number;
};

export type TopProductRow = {
  productId: string;
  productName: string;
  orders: number;
  quantity: number;
  revenue: number;
};

export type ReportsSnapshot = {
  period: ReportsPeriod;
  periodLabel: string;
  comparisonLabel: string;
  hasComparison: boolean;
  selectedMonth: string | null;
  comparisonMonth: string | null;
  revenue: RevenueStats;
  orderOps: OrderOpsStats;
  directOrderStats: DirectOrderStats;
  dailyTrend: DailyTrendRow[];
  topProducts: TopProductRow[];
};

export type ReportsPeriod = "today" | "month" | "quarter" | "custom_month" | "all_time";

export type ReportsSnapshotParams = {
  period?: ReportsPeriod;
  month?: string | null;
  compareMonth?: string | null;
};

export type UserSnapshotRow = {
  user_id: number;
  username: string | null;
  display_name: string | null;
  balance: number;
  balance_usdt: number;
  language: string | null;
  created_at: string | null;
  order_count: number;
  total_paid: number;
};

export type UsersSnapshot = {
  users: UserSnapshotRow[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
};

export type UsersFilterMode = "all" | "with_revenue" | "without_revenue" | "with_orders";

export type UsersSortMode =
  | "newest"
  | "oldest"
  | "username_asc"
  | "username_desc"
  | "revenue_desc"
  | "revenue_asc"
  | "order_count_desc"
  | "order_count_asc";

export type UserOrderHistoryRow = {
  id: number;
  user_id: number;
  product_id: number;
  product_name: string;
  price: number;
  quantity: number;
  created_at: string;
  content: string | null;
};

export type UserOrdersSnapshot = {
  user_id: number;
  orderCount: number;
  totalPaid: number;
  orders: UserOrderHistoryRow[];
};

async function fetchAdminSnapshot<T>(path: string): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new Error("Chưa đăng nhập.");
  }
  const cacheKey = `${token}:${path}`;
  const now = Date.now();
  const cached = snapshotCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.data as T;
  }

  const pending = snapshotRequests.get(cacheKey);
  if (pending) {
    return pending as Promise<T>;
  }

  const request = (async () => {
    const response = await fetch(path, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`
      },
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
    snapshotCache.set(cacheKey, {
      data: result,
      expiresAt: Date.now() + SNAPSHOT_CACHE_TTL_MS
    });
    return result;
  })();

  snapshotRequests.set(cacheKey, request as Promise<unknown>);
  try {
    return await request;
  } finally {
    snapshotRequests.delete(cacheKey);
  }
}

export const fetchDashboardSnapshot = () =>
  fetchAdminSnapshot<DashboardSnapshot>("/api/admin-analytics/dashboard");

export const fetchReportsSnapshot = ({
  period = "month",
  month,
  compareMonth
}: ReportsSnapshotParams = {}) => {
  const params = new URLSearchParams();
  params.set("period", period);
  if (month) {
    params.set("month", month);
  }
  if (compareMonth) {
    params.set("compareMonth", compareMonth);
  }

  return fetchAdminSnapshot<ReportsSnapshot>(`/api/admin-analytics/reports?${params.toString()}`);
};

export const fetchUsersSnapshot = ({
  page = 1,
  pageSize = 50,
  search = "",
  filterMode = "all",
  sortMode = "newest"
}: {
  page?: number;
  pageSize?: number;
  search?: string;
  filterMode?: UsersFilterMode;
  sortMode?: UsersSortMode;
}) =>
  fetchAdminSnapshot<UsersSnapshot>(
    `/api/admin-analytics/users?page=${Math.max(1, Math.trunc(page) || 1)}&pageSize=${Math.max(
      1,
      Math.min(Math.trunc(pageSize) || 50, 200)
    )}&q=${encodeURIComponent(search)}&filter=${encodeURIComponent(filterMode)}&sort=${encodeURIComponent(sortMode)}`
  );

export const fetchUserOrdersSnapshot = (userId: number) =>
  fetchAdminSnapshot<UserOrdersSnapshot>(
    `/api/admin-analytics/users/${Math.max(1, Math.trunc(userId) || 0)}/orders`
  );
