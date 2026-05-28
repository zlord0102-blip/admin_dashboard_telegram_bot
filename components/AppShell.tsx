"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { AdminSessionProvider, type AdminSessionSnapshot } from "@/components/AdminSessionContext";
import { AdminSessionClientError, fetchAdminSessionSnapshot } from "@/lib/adminSessionClient";
import { installAdminApiTimingInterceptor } from "@/lib/adminApiTimingClient";

/* ── SVG Icons ────────────────────────────────────────────── */
const Icons = {
  dashboard: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
      <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
    </svg>
  ),
  health: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  ),
  reports: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/>
      <line x1="6" y1="20" x2="6" y2="14"/>
    </svg>
  ),
  products: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
    </svg>
  ),
  sales: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
      <line x1="7" y1="7" x2="7.01" y2="7"/>
    </svg>
  ),
  stock: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
      <line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/>
      <line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
    </svg>
  ),
  orders: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
      <line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/>
    </svg>
  ),
  directOrders: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
      <line x1="1" y1="10" x2="23" y2="10"/>
    </svg>
  ),
  deposits: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>
    </svg>
  ),
  withdrawals: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>
    </svg>
  ),
  usdt: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
      <line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  ),
  users: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  ),
  botMessages: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  ),
  licenses: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>
  ),
  settings: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  ),
  signOut: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
      <polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
    </svg>
  ),
  switch: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>
      <polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
    </svg>
  ),
  menu: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
    </svg>
  ),
  close: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  ),
  chevronDown: (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  ),
  chevronRight: (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  ),
};

/* ── Nav config ───────────────────────────────────────────── */
const navGroups = [
  {
    label: "Monitor",
    items: [
      { href: "/",        label: "Dashboard",    icon: Icons.dashboard },
      { href: "/health",  label: "System Health", icon: Icons.health },
      { href: "/reports", label: "Reports",       icon: Icons.reports },
    ],
  },
  {
    label: "Catalog",
    items: [
      { href: "/products", label: "Products", icon: Icons.products },
      { href: "/sales",    label: "Sales",    icon: Icons.sales },
      { href: "/stock",    label: "Stock",    icon: Icons.stock },
    ],
  },
  {
    label: "Fulfillment",
    items: [
      { href: "/orders",        label: "Orders",        icon: Icons.orders },
      { href: "/direct-orders", label: "Direct Orders", icon: Icons.directOrders },
    ],
  },
  {
    label: "Finance",
    items: [
      { href: "/deposits",    label: "Deposits",    icon: Icons.deposits },
      { href: "/withdrawals", label: "Withdrawals", icon: Icons.withdrawals },
      { href: "/usdt",        label: "USDT",        icon: Icons.usdt },
    ],
  },
  {
    label: "Customers",
    items: [
      { href: "/users", label: "Users", icon: Icons.users },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/bot-messages", label: "Bot Messages", icon: Icons.botMessages },
      { href: "/licenses",     label: "Licenses",     icon: Icons.licenses },
      { href: "/settings",     label: "Settings",     icon: Icons.settings },
    ],
  },
];

const NAV_GROUP_STORAGE_KEY = "botDashboardOpenNavGroups";
const getDefaultNavGroupState = () =>
  Object.fromEntries(navGroups.map((g) => [g.label, true])) as Record<string, boolean>;

/* ── Helpers ──────────────────────────────────────────────── */
function isActive(href: string, pathname: string) {
  return pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
}

function getInitials(email: string | null): string {
  if (!email) return "A";
  const parts = email.split("@")[0].split(/[._-]/);
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function needsVerifiedAdminSession(pathname: string) {
  return pathname === "/products" || pathname.startsWith("/products/");
}

/* ── Component ────────────────────────────────────────────── */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [adminSession, setAdminSession] = useState<AdminSessionSnapshot | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState("");
  const [adminSessionVerified, setAdminSessionVerified] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [openNavGroups, setOpenNavGroups] = useState<Record<string, boolean>>(getDefaultNavGroupState);

  useEffect(() => {
    installAdminApiTimingInterceptor();
  }, []);

  useEffect(() => {
    const loadSession = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const session = data.session;
        if (!session) { router.replace("/login"); return; }

        setEmail(session.user.email ?? null);
        setUserId(session.user.id);
        setAccessToken(session.access_token);
        setAdminSession({
          userId: session.user.id,
          email: session.user.email ?? null,
          role: "admin"
        });
        setAdminSessionVerified(false);
        setAccessDenied(false);
        setAccessError(null);
      } catch (error) {
        if (error instanceof AdminSessionClientError && error.status === 401) {
          router.replace("/login"); return;
        }
        setAdminSession(null);
        setAccessDenied(true);
        setAccessError(error instanceof Error ? error.message : "Không thể tải phiên admin.");
      } finally {
        setLoading(false);
      }
    };
    loadSession();
  }, [router]);

  useEffect(() => {
    if (!accessToken || adminSessionVerified || !needsVerifiedAdminSession(pathname)) {
      return;
    }

    let cancelled = false;
    const verifyAdminSession = async () => {
      try {
        const nextAdminSession = await fetchAdminSessionSnapshot(accessToken);
        if (cancelled) return;
        setAdminSession(nextAdminSession);
        setEmail(nextAdminSession.email ?? email);
        setUserId(nextAdminSession.userId || userId);
        setAdminSessionVerified(true);
        setAccessDenied(false);
        setAccessError(null);
      } catch (error) {
        if (cancelled) return;
        if (error instanceof AdminSessionClientError && error.status === 401) {
          router.replace("/login");
          return;
        }
        setAdminSession(null);
        setAccessDenied(true);
        setAccessError(error instanceof Error ? error.message : "Không thể tải phiên admin.");
      }
    };

    verifyAdminSession();
    return () => {
      cancelled = true;
    };
  }, [accessToken, adminSessionVerified, email, pathname, router, userId]);

  useEffect(() => { setMobileNavOpen(false); }, [pathname]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(NAV_GROUP_STORAGE_KEY);
      if (!raw) return;
      setOpenNavGroups({ ...getDefaultNavGroupState(), ...JSON.parse(raw) });
    } catch { setOpenNavGroups(getDefaultNavGroupState()); }
  }, []);

  useEffect(() => {
    const activeGroup = navGroups.find((g) => g.items.some((item) => isActive(item.href, pathname)));
    if (!activeGroup) return;
    setOpenNavGroups((prev) => prev[activeGroup.label] ? prev : { ...prev, [activeGroup.label]: true });
  }, [pathname]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  };

  const toggleNavGroup = (label: string) => {
    setOpenNavGroups((prev) => {
      const next = { ...prev, [label]: !(prev[label] ?? true) };
      try { localStorage.setItem(NAV_GROUP_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  /* ── Loading ── */
  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 12,
            background: "linear-gradient(135deg, #238636, #3fb950)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 20, boxShadow: "0 0 20px rgba(46,160,67,0.3)"
          }}>🤖</div>
          <div style={{ color: "var(--muted)", fontSize: 13 }}>Đang tải phiên đăng nhập…</div>
          <div style={{
            width: 160, height: 3, borderRadius: 2,
            background: "rgba(240,246,252,0.08)", overflow: "hidden"
          }}>
            <div className="skeleton" style={{ width: "100%", height: "100%" }} />
          </div>
        </div>
      </div>
    );
  }

  /* ── Access denied ── */
  if (accessDenied) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)", padding: 24 }}>
        <div className="card" style={{ maxWidth: 400, width: "100%", textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🔒</div>
          <h2 className="section-title" style={{ marginBottom: 8 }}>Không có quyền truy cập</h2>
          <p className="muted" style={{ marginBottom: 16 }}>Tài khoản này chưa được cấp quyền admin.</p>
          {userId && <p className="muted" style={{ marginBottom: 8, fontFamily: "var(--font-mono)", fontSize: 11 }}>User ID: {userId}</p>}
          {accessError && <p style={{ color: "var(--danger)", fontSize: 12, marginBottom: 16 }}>{accessError}</p>}
          <button className="button secondary" onClick={handleSignOut} style={{ gap: 6 }}>
            {Icons.signOut} Đăng xuất
          </button>
        </div>
      </div>
    );
  }

  /* ── Shell ── */
  return (
    <div className="app-shell">
      {/* SIDEBAR */}
      <aside className={`sidebar ${mobileNavOpen ? "open" : ""}`}>
        {/* Header */}
        <div className="sidebar-header">
          <div className="brand">
            <div className="brand-icon">🤖</div>
            Bot Admin
          </div>
          <button
            className="sidebar-toggle"
            type="button"
            aria-expanded={mobileNavOpen}
            aria-label={mobileNavOpen ? "Đóng menu" : "Mở menu"}
            onClick={() => setMobileNavOpen((v) => !v)}
          >
            {mobileNavOpen ? Icons.close : Icons.menu}
          </button>
        </div>

        {/* Nav */}
        <div className="sidebar-body">
          <nav className="nav" aria-label="Main navigation">
            {navGroups.map((group) => {
              const isGroupActive = group.items.some((item) => isActive(item.href, pathname));
              const isGroupOpen = openNavGroups[group.label] ?? true;

              return (
                <div className="nav-group" key={group.label}>
                  <button
                    type="button"
                    className={`nav-group-toggle ${isGroupActive ? "active" : ""}`}
                    aria-expanded={isGroupOpen}
                    onClick={() => toggleNavGroup(group.label)}
                  >
                    <span>{group.label}</span>
                    <span className="nav-group-caret" aria-hidden="true">
                      {isGroupOpen ? Icons.chevronDown : Icons.chevronRight}
                    </span>
                  </button>

                  {isGroupOpen && (
                    <div className="nav-group-items">
                      {group.items.map((item) => (
                        <Link
                          key={item.href}
                          href={item.href}
                          className={`nav-link ${isActive(item.href, pathname) ? "active" : ""}`}
                        >
                          <span className="nav-icon">{item.icon}</span>
                          {item.label}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
        </div>

        {/* Footer */}
        <div className="sidebar-footer">
          {/* Health + Switch */}
          <div className="dashboard-switch-card">
            <div className="sidebar-health-row">
              <div className="ops-health-dot unknown">
                Ops check
              </div>
              <Link href="/health" className="sidebar-metric">System Health</Link>
            </div>
            <Link className="button secondary dashboard-switch-link" href="/website">
              {Icons.switch}&nbsp;Website Dashboard
            </Link>
          </div>

          {/* Account */}
          <div className="sidebar-account-card">
            <div className="sidebar-user-row">
              <div className="sidebar-avatar">{getInitials(email)}</div>
              <div className="sidebar-user-info">
                <div className="sidebar-user-email">{email ?? "admin"}</div>
                <div className="sidebar-user-role">{adminSession?.role ?? "admin"}</div>
              </div>
            </div>
            <button className="button secondary" style={{ width: "100%", gap: 6, fontSize: 12 }} onClick={handleSignOut}>
              {Icons.signOut} Đăng xuất
            </button>
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <main className="main">
        {adminSession
          ? <AdminSessionProvider value={adminSession}>{children}</AdminSessionProvider>
          : children
        }
      </main>
    </div>
  );
}
