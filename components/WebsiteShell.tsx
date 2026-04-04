"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { AdminSessionProvider, type AdminSessionSnapshot } from "@/components/AdminSessionContext";
import { AdminSessionClientError, fetchAdminSessionSnapshot } from "@/lib/adminSessionClient";

const navItems = [
  { href: "/website", label: "Dashboard" },
  { href: "/website/products", label: "Products" },
  { href: "/website/stock", label: "Stock" },
  { href: "/website/orders", label: "Orders" },
  { href: "/website/direct-orders", label: "Direct Orders" },
  { href: "/website/users", label: "Users" },
  { href: "/website/reports", label: "Reports" },
  { href: "/website/settings", label: "Settings" }
];

export default function WebsiteShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [adminSession, setAdminSession] = useState<AdminSessionSnapshot | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);

  useEffect(() => {
    const loadSession = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const session = data.session;
        if (!session) {
          router.replace("/login");
          return;
        }
        setEmail(session.user.email ?? null);
        setUserId(session.user.id);

        const nextAdminSession = await fetchAdminSessionSnapshot(session.access_token);
        setAdminSession(nextAdminSession);
        setEmail(nextAdminSession.email ?? session.user.email ?? null);
        setUserId(nextAdminSession.userId || session.user.id);
        setAccessDenied(false);
        setAccessError(null);
      } catch (error) {
        if (error instanceof AdminSessionClientError && error.status === 401) {
          router.replace("/login");
          return;
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
    setMobileNavOpen(false);
  }, [pathname]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  };

  if (loading) {
    return (
      <div className="main">
        <div className="card">Đang tải phiên đăng nhập...</div>
      </div>
    );
  }

  if (accessDenied) {
    return (
      <div className="main">
        <div className="card">
          <h2 className="section-title">Không có quyền truy cập</h2>
          <p className="muted">Tài khoản này chưa được cấp quyền admin.</p>
          {userId && (
            <p className="muted" style={{ marginTop: 8 }}>
              User ID: {userId}
            </p>
          )}
          {accessError && (
            <p className="muted" style={{ marginTop: 8, color: "var(--danger)" }}>
              Lỗi RLS: {accessError}
            </p>
          )}
          <button className="button secondary" style={{ marginTop: 12 }} onClick={handleSignOut}>
            Đăng xuất
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNavOpen ? "open" : ""}`}>
        <div className="sidebar-header">
          <div className="brand">Website Dashboard</div>
          <button
            className="sidebar-toggle"
            type="button"
            aria-expanded={mobileNavOpen}
            aria-label={mobileNavOpen ? "Đóng menu" : "Mở menu"}
            onClick={() => setMobileNavOpen((value) => !value)}
          >
            {mobileNavOpen ? "Đóng" : "Menu"}
          </button>
        </div>
        <div className="sidebar-body">
          <div className="nav">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-link ${
                  item.href === "/website"
                    ? pathname === "/website"
                    : pathname === item.href || pathname.startsWith(`${item.href}/`)
                    ? "active"
                    : ""
                }`}
              >
                {item.label}
              </Link>
            ))}
          </div>

          <div className="card dashboard-switch-card">
            <div className="muted">Chuyển dashboard</div>
            <Link className="button secondary dashboard-switch-link" href="/">
              Bot Dashboard
            </Link>
          </div>

          <div className="card sidebar-account-card" style={{ boxShadow: "none" }}>
            <div className="muted">Đăng nhập</div>
            <div style={{ fontFamily: "var(--font-sans)", fontSize: 13 }}>
              {email ?? "admin"}
            </div>
            <div style={{ marginTop: 6 }} className="badge">
              {adminSession?.role ?? "admin"}
            </div>
            <button className="button secondary" style={{ marginTop: 12 }} onClick={handleSignOut}>
              Đăng xuất
            </button>
          </div>
        </div>
      </aside>
      <main className="main">
        {adminSession ? <AdminSessionProvider value={adminSession}>{children}</AdminSessionProvider> : children}
      </main>
    </div>
  );
}
