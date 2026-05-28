"use client";

import { Fragment, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { PaginationControls, RowActionMenu } from "@/components/AdminUi";
import {
  BROADCAST_TITLE_PRESETS_KEY,
  USER_BROADCAST_TEMPLATES_KEY,
  createBroadcastTemplateId,
  createEmptyBroadcastTemplate,
  legacyTitlesToTemplates,
  normalizeBroadcastTemplates,
  parseBroadcastTemplates,
  parseLegacyBroadcastTitles,
  type BroadcastTemplate
} from "@/lib/broadcastTemplates";
import {
  fetchUserOrdersSnapshot,
  fetchUsersSnapshot,
  type UsersFilterMode,
  type UsersSortMode,
  type UserOrdersSnapshot,
  type UserSnapshotRow,
  type UsersSnapshot
} from "@/lib/adminAnalyticsClient";

type TelegramBroadcastJobSnapshot = {
  id: number;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  totalCandidates: number;
  totalTargets: number;
  skippedCount: number;
  blacklistedCount: number;
  sentCount: number;
  failedCount: number;
  pendingCount: number;
  sendingCount: number;
  startedAt: string | null;
  finishedAt: string | null;
  lastHeartbeatAt: string | null;
  lastError: string | null;
};

export default function UsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<UserSnapshotRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [filterMode, setFilterMode] = useState<UsersFilterMode>("all");
  const [sortMode, setSortMode] = useState<UsersSortMode>("newest");
  const [broadcastMessage, setBroadcastMessage] = useState("");
  const [broadcastTemplates, setBroadcastTemplates] = useState<BroadcastTemplate[]>([]);
  const [selectedBroadcastTemplateId, setSelectedBroadcastTemplateId] = useState("");
  const [broadcastTemplateDraft, setBroadcastTemplateDraft] = useState<BroadcastTemplate>(
    createEmptyBroadcastTemplate
  );
  const [templateManagerOpen, setTemplateManagerOpen] = useState(false);
  const [broadcastConfirmOpen, setBroadcastConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [presetStatus, setPresetStatus] = useState<string | null>(null);
  const [broadcastJob, setBroadcastJob] = useState<TelegramBroadcastJobSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedOrdersUser, setSelectedOrdersUser] = useState<UserSnapshotRow | null>(null);
  const [userOrdersSnapshot, setUserOrdersSnapshot] = useState<UserOrdersSnapshot | null>(null);
  const [userOrdersOpen, setUserOrdersOpen] = useState(false);
  const [userOrdersLoading, setUserOrdersLoading] = useState(false);
  const [userOrdersError, setUserOrdersError] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search);
  const broadcastJobActive =
    broadcastJob?.status === "queued" || broadcastJob?.status === "running";

  const load = async (
    pageIndex: number,
    keyword: string,
    nextFilterMode: UsersFilterMode,
    nextSortMode: UsersSortMode,
    nextPageSize = pageSize
  ) => {
    setLoading(true);
    try {
      const snapshot: UsersSnapshot = await fetchUsersSnapshot({
        page: pageIndex,
        pageSize: nextPageSize,
        search: keyword,
        filterMode: nextFilterMode,
        sortMode: nextSortMode
      });
      setUsers(snapshot.users);
      setTotalCount(snapshot.totalCount);
      setTotalPages(snapshot.totalPages);
      setLoadError(null);
    } finally {
      setLoading(false);
    }
  };

  const loadBroadcastTemplates = async () => {
    const { data, error } = await supabase
      .from("settings")
      .select("key,value")
      .in("key", [USER_BROADCAST_TEMPLATES_KEY, BROADCAST_TITLE_PRESETS_KEY]);

    if (error) {
      throw error;
    }

    const rows = ((data as Array<{ key?: string; value?: string | null }>) || []);
    const templatesRaw = rows.find((row) => row.key === USER_BROADCAST_TEMPLATES_KEY)?.value;
    const legacyTitlesRaw = rows.find((row) => row.key === BROADCAST_TITLE_PRESETS_KEY)?.value;
    const templates = parseBroadcastTemplates(templatesRaw);
    const legacyTemplates = legacyTitlesToTemplates(parseLegacyBroadcastTitles(legacyTitlesRaw));
    setBroadcastTemplates(templates.length ? templates : legacyTemplates);
  };

  const saveBroadcastTemplates = async (nextTemplates: BroadcastTemplate[]) => {
    const sanitized = normalizeBroadcastTemplates(nextTemplates);

    const { error } = await supabase
      .from("settings")
      .upsert(
        [{ key: USER_BROADCAST_TEMPLATES_KEY, value: JSON.stringify(sanitized) }],
        { onConflict: "key" }
      );

    if (error) {
      throw error;
    }

    setBroadcastTemplates(sanitized);
    return sanitized;
  };

  useEffect(() => {
    if (search !== deferredSearch) {
      return;
    }
    load(page, deferredSearch, filterMode, sortMode, pageSize).catch(() => {
      setUsers([]);
      setTotalCount(0);
      setTotalPages(1);
      setLoadError("Không thể tải danh sách user.");
    });
  }, [page, pageSize, search, deferredSearch, filterMode, sortMode]);

  useEffect(() => {
    loadBroadcastTemplates().catch(() => {
      setBroadcastTemplates([]);
    });
  }, []);

  useEffect(() => {
    if (!selectedBroadcastTemplateId) {
      setBroadcastTemplateDraft(createEmptyBroadcastTemplate());
      return;
    }
    const selected = broadcastTemplates.find((template) => template.id === selectedBroadcastTemplateId);
    if (!selected) {
      setSelectedBroadcastTemplateId("");
      setBroadcastTemplateDraft(createEmptyBroadcastTemplate());
      return;
    }
    setBroadcastTemplateDraft(selected);
  }, [selectedBroadcastTemplateId, broadcastTemplates]);

  useEffect(() => {
    if (!broadcastJobActive || !broadcastJob?.id) {
      return;
    }

    let active = true;
    const loadJob = async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        return;
      }

      const res = await fetch(`/api/telegram/broadcast-jobs/${broadcastJob.id}`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      const result = await res.json();
      if (!active || !res.ok || !result?.job) {
        return;
      }

      const nextJob = result.job as TelegramBroadcastJobSnapshot;
      setBroadcastJob(nextJob);

      const total = nextJob.totalTargets || 0;
      if (nextJob.status === "completed") {
        const parts = [`✅ Job #${nextJob.id} hoàn tất ${nextJob.sentCount}/${total}.`];
        if (nextJob.skippedCount) {
          parts.push(`Bỏ qua: ${nextJob.skippedCount}.`);
        }
        if (nextJob.blacklistedCount) {
          parts.push(`Đánh dấu chat lỗi vĩnh viễn: ${nextJob.blacklistedCount}.`);
        }
        if (nextJob.failedCount) {
          parts.push(`Lỗi còn lại: ${nextJob.failedCount}.`);
        }
        setStatus(parts.join(" "));
        return;
      }

      if (nextJob.status === "failed") {
        setStatus(
          `⚠️ Job #${nextJob.id} thất bại sau ${nextJob.sentCount}/${total}. ${nextJob.lastError || ""}`.trim()
        );
        return;
      }

      setStatus(
        `⏳ Job #${nextJob.id}: ${nextJob.sentCount}/${total} đã gửi, ${nextJob.failedCount} lỗi, ${nextJob.pendingCount + nextJob.sendingCount} còn lại.`
      );
    };

    loadJob().catch(() => undefined);
    const timer = window.setInterval(() => {
      loadJob().catch(() => undefined);
    }, 1500);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [broadcastJob?.id, broadcastJobActive]);

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
        if (result?.queued && result?.job) {
          setBroadcastJob(result.job as TelegramBroadcastJobSnapshot);
          setStatus(
            `⏳ Đã tạo job broadcast #${result.job.id}. Snapshot: ${result.attempted}/${result.total} user đủ điều kiện.`
          );
          return;
        }
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

  const selectedBroadcastTemplate = useMemo(
    () => broadcastTemplates.find((template) => template.id === selectedBroadcastTemplateId) || null,
    [broadcastTemplates, selectedBroadcastTemplateId]
  );

  const selectedBroadcastTitle = selectedBroadcastTemplate?.title.trim() || "";

  const finalBroadcastMessage = selectedBroadcastTitle
    ? `${selectedBroadcastTitle}\n${broadcastMessage.trim()}`.trim()
    : broadcastMessage.trim();

  const selectBroadcastTemplate = (templateId: string) => {
    setSelectedBroadcastTemplateId(templateId);
    setPresetStatus(null);
    const selected = broadcastTemplates.find((template) => template.id === templateId) || null;
    if (selected) {
      setBroadcastMessage(selected.message);
      setBroadcastTemplateDraft(selected);
    } else {
      setBroadcastTemplateDraft(createEmptyBroadcastTemplate());
    }
  };

  const handleBroadcast = async () => {
    if (broadcastJobActive) {
      setStatus(`Broadcast job #${broadcastJob?.id} vẫn đang chạy.`);
      return;
    }
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

  const handleAddBroadcastTemplate = async () => {
    const draft = {
      ...broadcastTemplateDraft,
      id: createBroadcastTemplateId()
    };
    const [normalized] = normalizeBroadcastTemplates([draft]);
    if (!normalized) {
      setPresetStatus("Nhập title hoặc message trước khi lưu.");
      return;
    }

    try {
      const nextTemplates = await saveBroadcastTemplates([...broadcastTemplates, normalized]);
      setSelectedBroadcastTemplateId(normalized.id);
      setBroadcastTemplateDraft(nextTemplates.find((template) => template.id === normalized.id) || normalized);
      setPresetStatus("✅ Đã lưu template broadcast.");
    } catch {
      setPresetStatus("Không thể lưu template broadcast.");
    }
  };

  const handleUpdateBroadcastTemplate = async () => {
    if (!selectedBroadcastTemplateId) {
      setPresetStatus("Chọn template cần cập nhật.");
      return;
    }
    const [normalized] = normalizeBroadcastTemplates([
      { ...broadcastTemplateDraft, id: selectedBroadcastTemplateId }
    ]);
    if (!normalized) {
      setPresetStatus("Template cần có title hoặc message.");
      return;
    }

    try {
      const nextTemplates = broadcastTemplates.map((template) =>
        template.id === selectedBroadcastTemplateId ? normalized : template
      );
      const savedTemplates = await saveBroadcastTemplates(nextTemplates);
      setBroadcastTemplateDraft(
        savedTemplates.find((template) => template.id === selectedBroadcastTemplateId) || normalized
      );
      setPresetStatus("✅ Đã cập nhật template broadcast.");
    } catch {
      setPresetStatus("Không thể cập nhật template broadcast.");
    }
  };

  const handleDeleteBroadcastTemplate = async () => {
    if (!selectedBroadcastTemplateId) {
      setPresetStatus("Chọn template cần xóa.");
      return;
    }

    try {
      await saveBroadcastTemplates(
        broadcastTemplates.filter((template) => template.id !== selectedBroadcastTemplateId)
      );
      setSelectedBroadcastTemplateId("");
      setBroadcastTemplateDraft(createEmptyBroadcastTemplate());
      setPresetStatus("✅ Đã xóa template broadcast.");
    } catch {
      setPresetStatus("Không thể xóa template broadcast.");
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
            onChange={(event) => {
              setPage(1);
              setSearch(event.target.value);
            }}
          />
          <select
            className="select"
            value={filterMode}
            onChange={(event) => {
              setPage(1);
              setFilterMode(event.target.value as UsersFilterMode);
            }}
          >
            <option value="all">Tất cả user</option>
            <option value="with_revenue">User có doanh thu</option>
            <option value="without_revenue">User chưa có doanh thu</option>
            <option value="with_orders">User có đơn hàng</option>
          </select>
          <select
            className="select"
            value={sortMode}
            onChange={(event) => {
              setPage(1);
              setSortMode(event.target.value as UsersSortMode);
            }}
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
              value={selectedBroadcastTemplateId}
              onChange={(event) => selectBroadcastTemplate(event.target.value)}
            >
              <option value="">Không dùng template</option>
              {broadcastTemplates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
            <button
              className="button secondary"
              type="button"
              onClick={() => {
                setPresetStatus(null);
                setTemplateManagerOpen(true);
              }}
            >
              Quản lý template
            </button>
          </div>
          <div className="broadcast-title-meta">
            <span className="muted">Template gồm title và message; message hỗ trợ Telegram custom emoji dạng {"{emoji:12345}"}.</span>
          </div>
          {selectedBroadcastTemplate && (
            <div className="broadcast-title-preview">
              <span className="muted">Đang dùng:</span> {selectedBroadcastTemplate.name}
              {selectedBroadcastTemplate.title && <> · {selectedBroadcastTemplate.title}</>}
            </div>
          )}
          <div className="form-split">
            <textarea
              className="textarea"
              placeholder="Nhập nội dung gửi cho tất cả user đã nhắn bot. Có thể dùng {emoji:12345}."
              value={broadcastMessage}
              onChange={(event) => setBroadcastMessage(event.target.value)}
            />
            <button
              className="button"
              type="button"
              disabled={sending || broadcastJobActive}
              onClick={handleBroadcast}
            >
              {sending ? "Đang tạo job..." : broadcastJobActive ? "Job đang chạy..." : "Gửi tất cả"}
            </button>
          </div>
        </div>
        {status && <p className="muted" style={{ marginTop: 8 }}>{status}</p>}
      </div>

      <div className="card">
        {loadError && (
          <div style={{ marginBottom: 12 }}>
            <p style={{ color: "#b91c1c", marginBottom: 8 }}>{loadError}</p>
            <button
              className="button secondary"
              type="button"
              onClick={() => {
                load(page, deferredSearch, filterMode, sortMode, pageSize).catch(() => {
                  setLoadError("Không thể tải danh sách user.");
                });
              }}
            >
              Thử lại
            </button>
          </div>
        )}
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
                <td className="row-actions-cell">
                  <RowActionMenu items={[
                    { label: "Nhắn tin", onSelect: () => router.push(`/users/${user.user_id}`) }
                  ]} />
                </td>
              </tr>
            ))}
            {!users.length && (
              <tr>
                <td colSpan={10} className="muted">{loading ? "Đang tải user..." : "Chưa có dữ liệu."}</td>
              </tr>
            )}
          </tbody>
        </table>
        <PaginationControls
          page={page}
          totalPages={totalPages}
          totalCount={totalCount}
          pageSize={pageSize}
          disabled={loading}
          onPageChange={setPage}
          onPageSizeChange={(nextPageSize) => {
            setPageSize(nextPageSize);
            setPage(1);
          }}
        />
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

      {templateManagerOpen && (
        <div className="modal-backdrop" onClick={() => setTemplateManagerOpen(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <h3 className="section-title">Quản lý template broadcast</h3>
            <div className="form-grid">
              <select
                className="select form-section"
                value={selectedBroadcastTemplateId}
                onChange={(event) => {
                  selectBroadcastTemplate(event.target.value);
                }}
              >
                <option value="">Chọn template để sửa / không chọn để thêm mới</option>
                {broadcastTemplates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
              <input
                className="input form-section"
                placeholder="Tên template"
                value={broadcastTemplateDraft.name}
                onChange={(event) =>
                  setBroadcastTemplateDraft({ ...broadcastTemplateDraft, name: event.target.value })
                }
              />
              <input
                className="input form-section"
                placeholder="Template title"
                value={broadcastTemplateDraft.title}
                onChange={(event) =>
                  setBroadcastTemplateDraft({ ...broadcastTemplateDraft, title: event.target.value })
                }
              />
              <textarea
                className="textarea form-section"
                placeholder="Template message, hỗ trợ {emoji:12345}"
                rows={7}
                value={broadcastTemplateDraft.message}
                onChange={(event) =>
                  setBroadcastTemplateDraft({ ...broadcastTemplateDraft, message: event.target.value })
                }
              />
              {presetStatus && (
                <p className="muted form-section" style={{ marginTop: -4 }}>
                  {presetStatus}
                </p>
              )}
              <div className="modal-actions">
                <button className="button secondary" type="button" onClick={() => setTemplateManagerOpen(false)}>
                  Đóng
                </button>
                <button
                  className="button secondary"
                  type="button"
                  onClick={handleDeleteBroadcastTemplate}
                  disabled={!selectedBroadcastTemplateId}
                >
                  Xóa
                </button>
                <button
                  className="button secondary"
                  type="button"
                  onClick={handleUpdateBroadcastTemplate}
                  disabled={!selectedBroadcastTemplateId}
                >
                  Cập nhật
                </button>
                <button
                  className="button"
                  type="button"
                  onClick={handleAddBroadcastTemplate}
                  disabled={!broadcastTemplateDraft.title.trim() && !broadcastTemplateDraft.message.trim()}
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
                disabled={sending || broadcastJobActive}
                onClick={() => setBroadcastConfirmOpen(false)}
              >
                Hủy
              </button>
              <button
                className="button"
                type="button"
                disabled={sending || broadcastJobActive}
                onClick={handleConfirmBroadcast}
              >
                {sending ? "Đang tạo job..." : broadcastJobActive ? "Job đang chạy..." : "Xác nhận gửi"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
