"use client";

import { Fragment, useDeferredValue, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import {
  fetchUserOrdersSnapshot,
  fetchUsersSnapshot,
  type UsersFilterMode,
  type UsersSortMode,
  type UserOrdersSnapshot,
  type UserSnapshotRow,
  type UsersSnapshot
} from "@/lib/adminAnalyticsClient";

const BROADCAST_TITLE_PRESETS_KEY = "broadcast_title_presets";

const parseBroadcastTitlePresets = (rawValue: string | null | undefined) => {
  if (!rawValue) return [];
  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) return [];
    return Array.from(
      new Set(
        parsed
          .map((value) => String(value || "").trim())
          .filter(Boolean)
      )
    ).slice(0, 20);
  } catch {
    return [];
  }
};

export default function UsersPage() {
  const PAGE_SIZE = 50;
  const [users, setUsers] = useState<UserSnapshotRow[]>([]);
  const [search, setSearch] = useState("");
  const [filterMode, setFilterMode] = useState<UsersFilterMode>("all");
  const [sortMode, setSortMode] = useState<UsersSortMode>("newest");
  const [broadcastMessage, setBroadcastMessage] = useState("");
  const [broadcastTitlePresets, setBroadcastTitlePresets] = useState<string[]>([]);
  const [selectedBroadcastTitleIndex, setSelectedBroadcastTitleIndex] = useState(-1);
  const [broadcastTitleDraft, setBroadcastTitleDraft] = useState("");
  const [titleManagerOpen, setTitleManagerOpen] = useState(false);
  const [broadcastConfirmOpen, setBroadcastConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [presetStatus, setPresetStatus] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedOrdersUser, setSelectedOrdersUser] = useState<UserSnapshotRow | null>(null);
  const [userOrdersSnapshot, setUserOrdersSnapshot] = useState<UserOrdersSnapshot | null>(null);
  const [userOrdersOpen, setUserOrdersOpen] = useState(false);
  const [userOrdersLoading, setUserOrdersLoading] = useState(false);
  const [userOrdersError, setUserOrdersError] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search);

  const load = async (
    pageIndex: number,
    keyword: string,
    nextFilterMode: UsersFilterMode,
    nextSortMode: UsersSortMode
  ) => {
    const snapshot: UsersSnapshot = await fetchUsersSnapshot({
      page: pageIndex,
      pageSize: PAGE_SIZE,
      search: keyword,
      filterMode: nextFilterMode,
      sortMode: nextSortMode
    });
    setUsers(snapshot.users);
    setTotalCount(snapshot.totalCount);
    setTotalPages(snapshot.totalPages);
  };

  const loadBroadcastTitlePresets = async () => {
    const { data, error } = await supabase
      .from("settings")
      .select("value")
      .eq("key", BROADCAST_TITLE_PRESETS_KEY)
      .maybeSingle();

    if (error) {
      throw error;
    }

    setBroadcastTitlePresets(parseBroadcastTitlePresets(data?.value));
  };

  const saveBroadcastTitlePresets = async (nextPresets: string[]) => {
    const sanitized = Array.from(
      new Set(
        nextPresets.map((value) => String(value || "").trim()).filter(Boolean)
      )
    ).slice(0, 20);

    const { error } = await supabase
      .from("settings")
      .upsert(
        [{ key: BROADCAST_TITLE_PRESETS_KEY, value: JSON.stringify(sanitized) }],
        { onConflict: "key" }
      );

    if (error) {
      throw error;
    }

    setBroadcastTitlePresets(sanitized);
    return sanitized;
  };

  useEffect(() => {
    load(page, deferredSearch, filterMode, sortMode).catch(() => {
      setUsers([]);
      setTotalCount(0);
      setTotalPages(1);
    });
  }, [page, deferredSearch, filterMode, sortMode]);

  useEffect(() => {
    loadBroadcastTitlePresets().catch(() => {
      setBroadcastTitlePresets([]);
    });
  }, []);

  useEffect(() => {
    setPage(1);
  }, [search, filterMode, sortMode]);

  useEffect(() => {
    if (selectedBroadcastTitleIndex < 0 || selectedBroadcastTitleIndex >= broadcastTitlePresets.length) {
      if (selectedBroadcastTitleIndex !== -1) {
        setSelectedBroadcastTitleIndex(-1);
      }
      setBroadcastTitleDraft("");
      return;
    }
    setBroadcastTitleDraft(broadcastTitlePresets[selectedBroadcastTitleIndex] || "");
  }, [selectedBroadcastTitleIndex, broadcastTitlePresets]);

  const formatDateTime = (isoString: string | null | undefined) => {
    if (!isoString) return "-";
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return isoString;
    return new Intl.DateTimeFormat("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).format(date);
  };

  const sendMessageRequest = async (payload: { message: string; userId?: number; broadcast?: boolean }) => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setStatus("Chưa đăng nhập.");
      return;
    }
    setSending(true);
    setStatus(null);
    try {
      const res = await fetch("/api/telegram/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      const result = await res.json();
      if (!res.ok) {
        setStatus(result.error || "Gửi thất bại.");
        return;
      }
      if (payload.broadcast) {
        const parts = [`✅ Đã gửi ${result.success}/${result.attempted ?? result.total}.`];
        if (result.skipped) {
          parts.push(`Bỏ qua: ${result.skipped}.`);
        }
        if (result.blacklisted) {
          parts.push(`Đánh dấu chat lỗi vĩnh viễn: ${result.blacklisted}.`);
        }
        if (result.failed) {
          parts.push(`Lỗi còn lại: ${result.failed}.`);
        }
        setStatus(parts.join(" "));
      } else {
        setStatus(`✅ Đã gửi cho user ${payload.userId}.`);
      }
    } catch (error) {
      setStatus("Gửi thất bại.");
    } finally {
      setSending(false);
    }
  };

  const selectedBroadcastTitle =
    selectedBroadcastTitleIndex >= 0 ? broadcastTitlePresets[selectedBroadcastTitleIndex]?.trim() || "" : "";

  const finalBroadcastMessage = selectedBroadcastTitle
    ? `${selectedBroadcastTitle}\n${broadcastMessage.trim()}`.trim()
    : broadcastMessage.trim();

  const handleBroadcast = async () => {
    if (!finalBroadcastMessage) {
      setStatus("Nhập nội dung broadcast trước khi gửi.");
      return;
    }
    setBroadcastConfirmOpen(true);
  };

  const handleConfirmBroadcast = async () => {
    if (!finalBroadcastMessage) return;
    setBroadcastConfirmOpen(false);
    setPresetStatus(null);
    setStatus(null);
    const payloadMessage = finalBroadcastMessage;
    await sendMessageRequest({ message: payloadMessage, broadcast: true });
    setBroadcastMessage("");
  };

  const handleAddBroadcastTitle = async () => {
    const normalized = broadcastTitleDraft.trim();
    if (!normalized) {
      setPresetStatus("Nhập title trước khi lưu.");
      return;
    }

    try {
      const nextPresets = await saveBroadcastTitlePresets([...broadcastTitlePresets, normalized]);
      const nextIndex = nextPresets.findIndex((value) => value === normalized);
      setSelectedBroadcastTitleIndex(nextIndex);
      setPresetStatus("✅ Đã lưu title broadcast.");
    } catch {
      setPresetStatus("Không thể lưu title broadcast.");
    }
  };

  const handleUpdateBroadcastTitle = async () => {
    const normalized = broadcastTitleDraft.trim();
    if (selectedBroadcastTitleIndex < 0) {
      setPresetStatus("Chọn title cần cập nhật.");
      return;
    }
    if (!normalized) {
      setPresetStatus("Title không được để trống.");
      return;
    }

    try {
      const nextPresets = [...broadcastTitlePresets];
      nextPresets[selectedBroadcastTitleIndex] = normalized;
      const savedPresets = await saveBroadcastTitlePresets(nextPresets);
      const nextIndex = savedPresets.findIndex((value) => value === normalized);
      setSelectedBroadcastTitleIndex(nextIndex);
      setPresetStatus("✅ Đã cập nhật title broadcast.");
    } catch {
      setPresetStatus("Không thể cập nhật title broadcast.");
    }
  };

  const handleDeleteBroadcastTitle = async () => {
    if (selectedBroadcastTitleIndex < 0) {
      setPresetStatus("Chọn title cần xóa.");
      return;
    }

    try {
      const nextPresets = broadcastTitlePresets.filter((_, index) => index !== selectedBroadcastTitleIndex);
      await saveBroadcastTitlePresets(nextPresets);
      setSelectedBroadcastTitleIndex(-1);
      setBroadcastTitleDraft("");
      setPresetStatus("✅ Đã xóa title broadcast.");
    } catch {
      setPresetStatus("Không thể xóa title broadcast.");
    }
  };

  const openUserOrders = async (user: UserSnapshotRow) => {
    setSelectedOrdersUser(user);
    setUserOrdersOpen(true);
    setUserOrdersLoading(true);
    setUserOrdersError(null);
    setUserOrdersSnapshot(null);

    try {
      const snapshot = await fetchUserOrdersSnapshot(user.user_id);
      setUserOrdersSnapshot(snapshot);
    } catch {
      setUserOrdersError("Không thể tải lịch sử đơn hàng của user.");
    } finally {
      setUserOrdersLoading(false);
    }
  };

  const closeUserOrdersModal = () => {
    setUserOrdersOpen(false);
    setUserOrdersError(null);
    setUserOrdersLoading(false);
  };

  return (
    <div className="grid" style={{ gap: 24 }}>
      <div className="topbar">
        <div>
          <h1 className="page-title">Users</h1>
          <p className="muted">Quản lý người dùng và số dư.</p>
        </div>
      </div>

      <div className="card">
        <div className="form-grid">
          <input
            className="input"
            placeholder="Tìm theo user_id hoặc username"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select
            className="select"
            value={filterMode}
            onChange={(event) => setFilterMode(event.target.value as UsersFilterMode)}
          >
            <option value="all">Tất cả user</option>
            <option value="with_revenue">User có doanh thu</option>
            <option value="without_revenue">User chưa có doanh thu</option>
            <option value="with_orders">User có đơn hàng</option>
          </select>
          <select
            className="select"
            value={sortMode}
            onChange={(event) => setSortMode(event.target.value as UsersSortMode)}
          >
            <option value="newest">Mới tạo gần đây</option>
            <option value="oldest">Cũ nhất</option>
            <option value="username_asc">Username A-Z</option>
            <option value="username_desc">Username Z-A</option>
            <option value="revenue_desc">Doanh thu cao đến thấp</option>
            <option value="revenue_asc">Doanh thu thấp đến cao</option>
            <option value="order_count_desc">Số đơn cao đến thấp</option>
            <option value="order_count_asc">Số đơn thấp đến cao</option>
          </select>
        </div>
        <p className="muted" style={{ marginTop: 10 }}>
          Tổng phù hợp: {totalCount.toLocaleString("vi-VN")} user.
        </p>
      </div>

      <div className="card">
        <h3 className="section-title">Gửi tin nhắn cho tất cả user</h3>
        <div className="broadcast-compose">
          <div className="broadcast-toolbar">
            <select
              className="select"
              value={selectedBroadcastTitleIndex >= 0 ? String(selectedBroadcastTitleIndex) : ""}
              onChange={(event) => {
                const nextValue = event.target.value;
                setSelectedBroadcastTitleIndex(nextValue === "" ? -1 : Number(nextValue));
                setPresetStatus(null);
              }}
            >
              <option value="">Không dùng title</option>
              {broadcastTitlePresets.map((title, index) => (
                <option key={`${index}-${title}`} value={index}>
                  {`Option ${index + 1}: ${title}`}
                </option>
              ))}
            </select>
            <button
              className="button secondary"
              type="button"
              onClick={() => {
                setPresetStatus(null);
                setTitleManagerOpen(true);
              }}
            >
              Thêm title
            </button>
          </div>
          <div className="broadcast-title-meta">
            <span className="muted">Title sẽ được ghép lên đầu nội dung broadcast.</span>
          </div>
          {selectedBroadcastTitleIndex >= 0 && broadcastTitlePresets[selectedBroadcastTitleIndex] && (
            <div className="broadcast-title-preview">
              <span className="muted">Đang dùng:</span> {broadcastTitlePresets[selectedBroadcastTitleIndex]}
            </div>
          )}
          <div className="form-split">
            <textarea
              className="textarea"
              placeholder="Nhập nội dung gửi cho tất cả user đã nhắn bot"
              value={broadcastMessage}
              onChange={(event) => setBroadcastMessage(event.target.value)}
            />
            <button className="button" type="button" disabled={sending} onClick={handleBroadcast}>
              {sending ? "Đang gửi..." : "Gửi tất cả"}
            </button>
          </div>
        </div>
        {status && <p className="muted" style={{ marginTop: 8 }}>{status}</p>}
      </div>

      <div className="card">
        <table className="table">
          <thead>
            <tr>
              <th>User ID</th>
              <th>Username</th>
              <th>Tên người dùng</th>
              <th>Đơn đã mua</th>
              <th>Tổng đã mua (VND)</th>
              <th>Balance (VND)</th>
              <th>Balance (USDT)</th>
              <th>Lang</th>
              <th>Created</th>
              <th>Hành động</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.user_id}>
                <td>{user.user_id}</td>
                <td>{user.username ?? "-"}</td>
                <td>{user.display_name ?? "-"}</td>
                <td>
                  {user.order_count > 0 ? (
                    <button
                      className="button secondary order-count-button"
                      type="button"
                      onClick={() => openUserOrders(user)}
                    >
                      {user.order_count.toLocaleString("vi-VN")}
                    </button>
                  ) : (
                    "0"
                  )}
                </td>
                <td>{user.total_paid.toLocaleString("vi-VN")}</td>
                <td>{(user.balance || 0).toLocaleString()}</td>
                <td>{user.balance_usdt?.toString() ?? "0"}</td>
                <td>{user.language ?? "vi"}</td>
                <td>{formatDateTime(user.created_at)}</td>
                <td>
                  <Link className="button secondary" href={`/users/${user.user_id}`}>
                    Nhắn tin
                  </Link>
                </td>
              </tr>
            ))}
            {!users.length && (
              <tr>
                <td colSpan={10} className="muted">Chưa có dữ liệu.</td>
              </tr>
            )}
          </tbody>
        </table>
        {totalPages > 1 && (
          <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 12 }}>
            <button
              className="button secondary"
              disabled={page === 1}
              onClick={() => setPage(Math.max(1, page - 1))}
            >
              Trang trước
            </button>
            <span className="muted">
              Trang {page}/{totalPages} · Tổng {totalCount.toLocaleString("vi-VN")}
            </span>
            <button
              className="button secondary"
              disabled={page === totalPages}
              onClick={() => setPage(Math.min(totalPages, page + 1))}
            >
              Trang sau
            </button>
          </div>
        )}
      </div>

      {userOrdersOpen && (
        <div className="modal-backdrop" onClick={() => !userOrdersLoading && closeUserOrdersModal()}>
          <div className="modal modal-wide modal-scrollable" onClick={(event) => event.stopPropagation()}>
            <div className="modal-scroll-region">
              <div className="topbar" style={{ marginBottom: 12 }}>
                <div>
                  <h3 className="section-title" style={{ marginBottom: 6 }}>Chi tiết đơn hàng đã mua</h3>
                  <p className="muted">
                    User ID: {selectedOrdersUser?.user_id ?? "-"} · Username: {selectedOrdersUser?.username ?? "-"} ·
                    Tên người dùng: {selectedOrdersUser?.display_name ?? "-"}
                  </p>
                </div>
              </div>

              {!userOrdersLoading && !userOrdersError && userOrdersSnapshot && (
                <div className="grid stats order-history-stats">
                  <div className="card">
                    <p className="muted">Tổng đơn</p>
                    <h3>{userOrdersSnapshot.orderCount.toLocaleString("vi-VN")}</h3>
                  </div>
                  <div className="card">
                    <p className="muted">Tổng đã mua</p>
                    <h3>{userOrdersSnapshot.totalPaid.toLocaleString("vi-VN")}đ</h3>
                  </div>
                </div>
              )}

              {userOrdersLoading ? (
                <p className="muted">Đang tải lịch sử đơn hàng...</p>
              ) : userOrdersError ? (
                <p className="muted" style={{ color: "var(--danger)" }}>
                  {userOrdersError}
                </p>
              ) : userOrdersSnapshot?.orders.length ? (
                <div className="order-history-table-wrap">
                  <table className="table fixed order-history-table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Sản phẩm</th>
                        <th>SL</th>
                        <th>Giá</th>
                        <th>Thời gian</th>
                      </tr>
                    </thead>
                    <tbody>
                      {userOrdersSnapshot.orders.map((order) => (
                        <Fragment key={order.id}>
                          <tr>
                            <td>#{order.id}</td>
                            <td>{order.product_name}</td>
                            <td>{order.quantity}</td>
                            <td>{order.price.toLocaleString("vi-VN")}đ</td>
                            <td>{formatDateTime(order.created_at)}</td>
                          </tr>
                          <tr className="order-history-detail-row">
                            <td colSpan={5}>
                              <div className="order-history-content">
                                {order.content?.trim() || "Không có nội dung chi tiết lưu trong đơn hàng này."}
                              </div>
                            </td>
                          </tr>
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="muted">User này chưa có đơn hàng đã mua.</p>
              )}
            </div>

            <div className="modal-actions" style={{ marginTop: 16 }}>
              <button className="button secondary" type="button" onClick={closeUserOrdersModal}>
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {titleManagerOpen && (
        <div className="modal-backdrop" onClick={() => setTitleManagerOpen(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h3 className="section-title">Quản lý title broadcast</h3>
            <div className="form-grid">
              <select
                className="select form-section"
                value={selectedBroadcastTitleIndex >= 0 ? String(selectedBroadcastTitleIndex) : ""}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setSelectedBroadcastTitleIndex(nextValue === "" ? -1 : Number(nextValue));
                  setPresetStatus(null);
                }}
              >
                <option value="">Chọn title để sửa / không chọn để thêm mới</option>
                {broadcastTitlePresets.map((title, index) => (
                  <option key={`${index}-${title}`} value={index}>
                    {`Option ${index + 1}: ${title}`}
                  </option>
                ))}
              </select>
              <input
                className="input form-section"
                placeholder="Nhập title broadcast"
                value={broadcastTitleDraft}
                onChange={(event) => setBroadcastTitleDraft(event.target.value)}
              />
              {presetStatus && (
                <p className="muted form-section" style={{ marginTop: -4 }}>
                  {presetStatus}
                </p>
              )}
              <div className="modal-actions">
                <button className="button secondary" type="button" onClick={() => setTitleManagerOpen(false)}>
                  Đóng
                </button>
                <button
                  className="button secondary"
                  type="button"
                  onClick={handleDeleteBroadcastTitle}
                  disabled={selectedBroadcastTitleIndex < 0}
                >
                  Xóa title
                </button>
                <button
                  className="button secondary"
                  type="button"
                  onClick={handleUpdateBroadcastTitle}
                  disabled={selectedBroadcastTitleIndex < 0 || !broadcastTitleDraft.trim()}
                >
                  Cập nhật
                </button>
                <button
                  className="button"
                  type="button"
                  onClick={handleAddBroadcastTitle}
                  disabled={!broadcastTitleDraft.trim()}
                >
                  Thêm mới
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {broadcastConfirmOpen && (
        <div className="modal-backdrop" onClick={() => !sending && setBroadcastConfirmOpen(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h3 className="section-title">Xác nhận gửi broadcast</h3>
            <p className="muted" style={{ marginBottom: 12 }}>
              Tin nhắn này sẽ được gửi tới tất cả user đã nhắn bot.
            </p>
            <div className="broadcast-confirm-preview">
              {finalBroadcastMessage || "Chưa có nội dung."}
            </div>
            <div className="modal-actions" style={{ marginTop: 16 }}>
              <button
                className="button secondary"
                type="button"
                disabled={sending}
                onClick={() => setBroadcastConfirmOpen(false)}
              >
                Hủy
              </button>
              <button className="button" type="button" disabled={sending} onClick={handleConfirmBroadcast}>
                {sending ? "Đang gửi..." : "Xác nhận gửi"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
