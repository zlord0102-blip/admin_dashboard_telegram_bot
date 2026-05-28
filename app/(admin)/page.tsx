"use client";

import { useEffect, useState, useCallback } from "react";
import {
  fetchDashboardSnapshot,
  type DashboardOrderRow,
  type DashboardSnapshot,
  type DashboardStats,
  fetchUsersSnapshot,
  type UserSnapshotRow
} from "@/lib/adminAnalyticsClient";
import { PageHeader, StatCard, SectionCard, DataTable, EmptyState, PaginationControls, SkeletonTable } from "@/components/AdminUi";
import { supabase } from "@/lib/supabaseClient";

/* ── Icons ──────────────────────────────────────────────────── */
const IcoUsers = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
    <circle cx="9" cy="7" r="4"/>
    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
  </svg>
);
const IcoOrders = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
    <line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/>
  </svg>
);
const IcoRevenue = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
  </svg>
);
const IcoPending = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
  </svg>
);
const IcoRefresh = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10"/>
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
  </svg>
);

/* ── Helpers ────────────────────────────────────────────────── */
const fmtVND = (n: number) => n.toLocaleString("vi-VN") + "₫";
const fmtNum = (n: number) => n.toLocaleString("vi-VN");
const DRILLDOWN_PAGE_SIZE = 20;

type DrilldownType = "users" | "orders" | "revenue" | "pending";

type DrilldownRow =
  | UserSnapshotRow
  | DashboardDrilldownOrder
  | DashboardPendingRow;

type DashboardDrilldownOrder = {
  id: number | string;
  user_id: number | string;
  username: string | null;
  display_name: string | null;
  product_id: number | string;
  product_name: string;
  price: number;
  quantity: number;
  created_at: string;
};

type DashboardPendingRow = {
  id: number | string;
  type: "deposit" | "withdrawal";
  user_id: number | string;
  amount: number;
  code: string | null;
  status: string;
  created_at: string;
};

type DrilldownState = {
  type: DrilldownType;
  title: string;
  page: number;
  totalCount: number;
  loading: boolean;
  error: string | null;
  rows: DrilldownRow[];
};

const drilldownTitles: Record<DrilldownType, string> = {
  users: "Người dùng",
  orders: "Đơn hàng",
  revenue: "Chi tiết doanh thu",
  pending: "Hàng chờ duyệt"
};

function formatDateTime(iso: string | null | undefined) {
  if (!iso) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false
  }).format(d);
}

function shortId(id: number | string) {
  const s = String(id);
  return s.length > 8 ? `…${s.slice(-6)}` : s;
}

/* ── Component ──────────────────────────────────────────────── */
export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats>({ users: 0, orders: 0, revenue: 0 });
  const [orders, setOrders] = useState<DashboardOrderRow[]>([]);
  const [pendingDeposits, setPendingDeposits] = useState(0);
  const [pendingWithdrawals, setPendingWithdrawals] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [drilldown, setDrilldown] = useState<DrilldownState | null>(null);

  const loadDashboard = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const snapshot: DashboardSnapshot = await fetchDashboardSnapshot();
      setStats(snapshot.stats);
      setOrders(snapshot.orders);
      setPendingDeposits(snapshot.pendingDeposits);
      setPendingWithdrawals(snapshot.pendingWithdrawals);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Không thể tải Dashboard.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  const totalPending = pendingDeposits + pendingWithdrawals;

  const openDrilldown = (type: DrilldownType) => {
    setDrilldown({
      type,
      title: drilldownTitles[type],
      page: 1,
      totalCount: 0,
      loading: true,
      error: null,
      rows: []
    });
  };

  const closeDrilldown = () => setDrilldown(null);

  const setDrilldownPage = (page: number) => {
    setDrilldown((current) => current ? { ...current, page, loading: true, error: null } : current);
  };

  const loadOrderLikeDrilldown = useCallback(async (page: number) => {
    const from = (page - 1) * DRILLDOWN_PAGE_SIZE;
    const to = from + DRILLDOWN_PAGE_SIZE - 1;
    const { data, count, error } = await supabase
      .from("orders")
      .select("id, user_id, product_id, price, quantity, created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);
    if (error) throw error;

    const rows = (data || []) as Array<Record<string, unknown>>;
    const userIds = Array.from(new Set(rows.map((row) => row.user_id).filter(Boolean).map(String)));
    const productIds = Array.from(new Set(rows.map((row) => row.product_id).filter(Boolean).map(String)));
    const [usersRes, productsRes] = await Promise.all([
      userIds.length
        ? supabase.from("users").select("user_id, username, first_name, last_name").in("user_id", userIds)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
      productIds.length
        ? supabase.from("products").select("id, name").in("id", productIds)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>> })
    ]);

    const usersById = new Map<string, { username: string | null; display_name: string | null }>();
    for (const user of usersRes.data || []) {
      const userId = String(user.user_id || "");
      if (!userId) continue;
      const displayName = [user.first_name, user.last_name]
        .map((part) => String(part || "").trim())
        .filter(Boolean)
        .join(" ") || null;
      usersById.set(userId, {
        username: user.username ? String(user.username) : null,
        display_name: displayName
      });
    }

    const productNamesById = new Map<string, string>();
    for (const product of productsRes.data || []) {
      productNamesById.set(String(product.id), String(product.name || `#${String(product.id || "-")}`));
    }

    return {
      totalCount: count ?? 0,
      rows: rows.map((row) => {
        const userProfile = usersById.get(String(row.user_id));
        return {
          id: row.id as number | string,
          user_id: row.user_id as number | string,
          username: userProfile?.username ?? null,
          display_name: userProfile?.display_name ?? null,
          product_id: row.product_id as number | string,
          product_name: productNamesById.get(String(row.product_id)) || `#${String(row.product_id || "-")}`,
          price: Number(row.price || 0),
          quantity: Number(row.quantity || 0),
          created_at: String(row.created_at || "")
        };
      })
    };
  }, []);

  const loadPendingDrilldown = useCallback(async (page: number) => {
    const fetchLimit = page * DRILLDOWN_PAGE_SIZE;
    const [depositsRes, withdrawalsRes] = await Promise.all([
      supabase
        .from("deposits")
        .select("id, user_id, amount, code, status, created_at", { count: "exact" })
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .range(0, fetchLimit - 1),
      supabase
        .from("withdrawals")
        .select("id, user_id, amount, momo_phone, status, created_at", { count: "exact" })
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .range(0, fetchLimit - 1)
    ]);
    if (depositsRes.error) throw depositsRes.error;
    if (withdrawalsRes.error) throw withdrawalsRes.error;

    const depositRows: DashboardPendingRow[] = ((depositsRes.data || []) as Array<Record<string, unknown>>).map((row) => ({
      id: row.id as number | string,
      type: "deposit",
      user_id: row.user_id as number | string,
      amount: Number(row.amount || 0),
      code: row.code ? String(row.code) : null,
      status: String(row.status || "pending"),
      created_at: String(row.created_at || "")
    }));
    const withdrawalRows: DashboardPendingRow[] = ((withdrawalsRes.data || []) as Array<Record<string, unknown>>).map((row) => ({
      id: row.id as number | string,
      type: "withdrawal",
      user_id: row.user_id as number | string,
      amount: Number(row.amount || 0),
      code: row.momo_phone ? String(row.momo_phone) : null,
      status: String(row.status || "pending"),
      created_at: String(row.created_at || "")
    }));
    const mergedRows = [...depositRows, ...withdrawalRows]
      .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
      .slice((page - 1) * DRILLDOWN_PAGE_SIZE, page * DRILLDOWN_PAGE_SIZE);

    return {
      totalCount: (depositsRes.count ?? 0) + (withdrawalsRes.count ?? 0),
      rows: mergedRows
    };
  }, []);

  useEffect(() => {
    if (!drilldown) return;
    let cancelled = false;

    const loadDrilldown = async () => {
      try {
        if (drilldown.type === "users") {
          const snapshot = await fetchUsersSnapshot({
            page: drilldown.page,
            pageSize: DRILLDOWN_PAGE_SIZE,
            search: "",
            filterMode: "all",
            sortMode: "newest"
          });
          if (cancelled) return;
          setDrilldown((current) => current ? {
            ...current,
            rows: snapshot.users,
            totalCount: snapshot.totalCount,
            loading: false,
            error: null
          } : current);
          return;
        }

        const result = drilldown.type === "pending"
          ? await loadPendingDrilldown(drilldown.page)
          : await loadOrderLikeDrilldown(drilldown.page);
        if (cancelled) return;
        setDrilldown((current) => current ? {
          ...current,
          rows: result.rows,
          totalCount: result.totalCount,
          loading: false,
          error: null
        } : current);
      } catch (error) {
        if (cancelled) return;
        setDrilldown((current) => current ? {
          ...current,
          rows: [],
          totalCount: 0,
          loading: false,
          error: error instanceof Error ? error.message : "Không thể tải chi tiết."
        } : current);
      }
    };

    loadDrilldown();
    return () => {
      cancelled = true;
    };
  }, [drilldown?.type, drilldown?.page, loadOrderLikeDrilldown, loadPendingDrilldown]);

  const drilldownTotalPages = drilldown
    ? Math.max(1, Math.ceil(drilldown.totalCount / DRILLDOWN_PAGE_SIZE))
    : 1;

  return (
    <div className="grid" style={{ gap: 28 }}>
      {/* ── Header ── */}
      <PageHeader
        title="Tổng quan"
        description="Snapshot vận hành Bot và hiệu suất shop theo thời gian thực."
        badge={
          <span className="badge" style={{ fontSize: 10 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#3fb950", display: "inline-block" }} />
            Live
          </span>
        }
        actions={
          <button
            className="button secondary"
            style={{ gap: 6, fontSize: 12 }}
            onClick={() => loadDashboard(true)}
            disabled={refreshing}
            title="Làm mới dữ liệu"
          >
            <span className={refreshing ? "spin" : ""}><IcoRefresh /></span>
            {refreshing ? "Đang tải…" : "Làm mới"}
          </button>
        }
      />

      {/* ── Error ── */}
      {loadError && (
        <div className="card" style={{ border: "1px solid rgba(248,81,73,0.3)", background: "rgba(248,81,73,0.06)" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <span style={{ color: "var(--danger)", fontSize: 20 }}>⚠️</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--danger)", marginBottom: 6 }}>Lỗi tải dữ liệu</div>
              <p className="muted">{loadError}</p>
            </div>
            <button className="button secondary" style={{ fontSize: 12 }} onClick={() => loadDashboard()}>Thử lại</button>
          </div>
        </div>
      )}

      {/* ── Primary Stats ── */}
      {loading ? (
        <div className="grid stats"><div className="skeleton skeleton-stat" /><div className="skeleton skeleton-stat" /><div className="skeleton skeleton-stat" /><div className="skeleton skeleton-stat" /></div>
      ) : (
        <div className="grid stats">
          <StatCard
            label="Người dùng"
            value={fmtNum(stats.users)}
            icon={<IcoUsers />}
            glow="blue"
            iconButtonLabel="Xem danh sách người dùng"
            onIconClick={() => openDrilldown("users")}
          />
          <StatCard
            label="Đơn hàng"
            value={fmtNum(stats.orders)}
            icon={<IcoOrders />}
            glow="green"
            iconButtonLabel="Xem danh sách đơn hàng"
            onIconClick={() => openDrilldown("orders")}
          />
          <StatCard
            label="Doanh thu"
            value={fmtVND(stats.revenue)}
            icon={<IcoRevenue />}
            glow="gold"
            iconButtonLabel="Xem chi tiết doanh thu"
            onIconClick={() => openDrilldown("revenue")}
          />
          <StatCard
            label="Chờ duyệt"
            value={totalPending}
            icon={<IcoPending />}
            glow={totalPending > 0 ? "red" : "green"}
            sub={totalPending > 0 ? `${pendingDeposits} nạp · ${pendingWithdrawals} rút` : "Không có gì pending"}
            iconButtonLabel="Xem hàng chờ duyệt"
            onIconClick={() => openDrilldown("pending")}
          />
        </div>
      )}

      {/* ── Recent Orders ── */}
      <SectionCard
        title="Đơn hàng gần nhất"
        noPad
        actions={
          orders.length > 0 ? (
            <span className="chip">{orders.length} đơn</span>
          ) : undefined
        }
      >
        {loading ? (
          <div style={{ padding: "16px 20px" }}><SkeletonTable rows={5} cols={6} /></div>
        ) : orders.length === 0 ? (
          <div style={{ padding: 24 }}>
            <EmptyState icon="📭" title="Chưa có đơn hàng" description="Đơn hàng sẽ xuất hiện ở đây khi có giao dịch mới." />
          </div>
        ) : (
          <DataTable>
            <thead>
              <tr>
                <th>ID</th>
                <th>Người dùng</th>
                <th>Sản phẩm</th>
                <th style={{ textAlign: "right" }}>SL</th>
                <th style={{ textAlign: "right" }}>Giá</th>
                <th style={{ textAlign: "right" }}>Thời gian</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td>
                    <span className="data-tag">#{shortId(order.id)}</span>
                  </td>
                  <td>
                    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
                        {order.display_name || order.username || "–"}
                      </span>
                      {order.username && (
                        <span className="muted" style={{ fontSize: 11 }}>@{order.username}</span>
                      )}
                    </div>
                  </td>
                  <td>
                    <span style={{ fontSize: 13 }} className="cell-truncate">
                      {order.product_name || order.product_id}
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <span className="chip">{order.quantity}</span>
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 700, color: "var(--success)", fontSize: 13 }}>
                    {order.price.toLocaleString("vi-VN")}₫
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <span className="muted" style={{ fontSize: 11, whiteSpace: "nowrap" }}>
                      {formatDateTime(order.created_at)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </SectionCard>

      {drilldown && (
        <div className="modal-backdrop" onClick={() => !drilldown.loading && closeDrilldown()}>
          <div className="modal modal-wide modal-scrollable" onClick={(event) => event.stopPropagation()}>
            <div className="modal-scroll-region">
              <div className="topbar" style={{ marginBottom: 12 }}>
                <div>
                  <h3 className="section-title" style={{ marginBottom: 6 }}>{drilldown.title}</h3>
                  <p className="muted">
                    Tải theo trang khi mở modal, mỗi trang {DRILLDOWN_PAGE_SIZE} dòng.
                  </p>
                </div>
              </div>

              {drilldown.error && (
                <p className="muted" style={{ color: "var(--danger)", marginBottom: 12 }}>
                  {drilldown.error}
                </p>
              )}

              {drilldown.loading ? (
                <SkeletonTable rows={6} cols={drilldown.type === "users" ? 6 : 7} />
              ) : drilldown.rows.length === 0 ? (
                <EmptyState title="Chưa có dữ liệu" description="Không có dòng nào phù hợp với snapshot hiện tại." />
              ) : drilldown.type === "users" ? (
                <DataTable>
                  <thead>
                    <tr>
                      <th>User ID</th>
                      <th>Username</th>
                      <th>Tên</th>
                      <th>Đơn</th>
                      <th>Tổng mua</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(drilldown.rows as UserSnapshotRow[]).map((user) => (
                      <tr key={user.user_id}>
                        <td>{user.user_id}</td>
                        <td>{user.username || "-"}</td>
                        <td>{user.display_name || "-"}</td>
                        <td>{user.order_count.toLocaleString("vi-VN")}</td>
                        <td>{fmtVND(user.total_paid)}</td>
                        <td>{formatDateTime(user.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
              ) : drilldown.type === "pending" ? (
                <DataTable>
                  <thead>
                    <tr>
                      <th>Loại</th>
                      <th>ID</th>
                      <th>User</th>
                      <th>Số tiền</th>
                      <th>Code/Phone</th>
                      <th>Status</th>
                      <th>Thời gian</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(drilldown.rows as DashboardPendingRow[]).map((row) => (
                      <tr key={`${row.type}:${row.id}`}>
                        <td>{row.type === "deposit" ? "Nạp tiền" : "Rút tiền"}</td>
                        <td>#{row.id}</td>
                        <td>{row.user_id}</td>
                        <td>{fmtVND(row.amount)}</td>
                        <td>{row.code || "-"}</td>
                        <td>{row.status}</td>
                        <td>{formatDateTime(row.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
              ) : (
                <DataTable>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>User</th>
                      <th>Sản phẩm</th>
                      <th>SL</th>
                      <th>Giá</th>
                      <th>Username</th>
                      <th>Thời gian</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(drilldown.rows as DashboardDrilldownOrder[]).map((order) => (
                      <tr key={order.id}>
                        <td>#{shortId(order.id)}</td>
                        <td>{order.display_name || order.user_id}</td>
                        <td>{order.product_name}</td>
                        <td>{order.quantity.toLocaleString("vi-VN")}</td>
                        <td>{fmtVND(order.price)}</td>
                        <td>{order.username ? `@${order.username}` : "-"}</td>
                        <td>{formatDateTime(order.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
              )}
            </div>
            <div className="modal-actions">
              <PaginationControls
                page={drilldown.page}
                totalPages={drilldownTotalPages}
                totalCount={drilldown.totalCount}
                pageSize={DRILLDOWN_PAGE_SIZE}
                onPageChange={setDrilldownPage}
                onPageSizeChange={() => undefined}
                disabled={drilldown.loading}
                showPageSize={false}
              />
              <button className="button secondary" type="button" onClick={closeDrilldown} disabled={drilldown.loading}>
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
