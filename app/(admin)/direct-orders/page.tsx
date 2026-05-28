"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { adminApiRequest } from "@/lib/adminOpsClient";
import { ConfirmDialog, PaginationControls, RowActionMenu } from "@/components/AdminUi";

interface DirectOrderRow {
  id: number;
  user_id: number;
  product_id: number;
  quantity: number;
  bonus_quantity?: number;
  unit_price: number;
  amount: number;
  code: string;
  status: string;
  created_at: string;
  payment_channel?: string | null;
  payment_asset?: string | null;
  payment_network?: string | null;
  payment_amount_asset?: string | number | null;
  payment_address?: string | null;
  payment_address_tag?: string | null;
  external_payment_id?: string | null;
  external_tx_id?: string | null;
  external_paid_at?: string | null;
  binance_pay_prepay_id?: string | null;
  binance_pay_status?: string | null;
  products?: {
    name: string;
  }[] | null;
}

const STATUS_LABELS: Record<string, string> = {
  pending: "Chờ xử lý",
  confirmed: "Đã duyệt",
  failed: "Thất bại",
  cancelled: "Đã hủy"
};

type PendingDirectOrderAction =
  | { type: "approve"; order: DirectOrderRow }
  | { type: "failed"; order: DirectOrderRow }
  | null;

export default function DirectOrdersPage() {
  const [orders, setOrders] = useState<DirectOrderRow[]>([]);
  const [statusFilter, setStatusFilter] = useState("pending");
  const [sendingId, setSendingId] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingDirectOrderAction>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const load = async (pageIndex = page, nextPageSize = pageSize) => {
    setLoading(true);
    const from = (pageIndex - 1) * nextPageSize;
    const to = from + nextPageSize - 1;
    let query = supabase
      .from("direct_orders")
      .select("id, user_id, product_id, quantity, bonus_quantity, unit_price, amount, code, status, created_at, payment_channel, payment_asset, payment_network, payment_amount_asset, payment_address, payment_address_tag, external_payment_id, external_tx_id, external_paid_at, binance_pay_prepay_id, binance_pay_status, products(name)", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);
    if (statusFilter !== "all") {
      query = query.eq("status", statusFilter);
    }
    try {
      const { data, error, count } = await query;
      if (error) {
        let fallback = supabase
          .from("direct_orders")
          .select("id, user_id, product_id, quantity, unit_price, amount, code, status, created_at, products(name)", { count: "exact" })
          .order("created_at", { ascending: false })
          .range(from, to);
        if (statusFilter !== "all") {
          fallback = fallback.eq("status", statusFilter);
        }
        const fallbackResult = await fallback;
        setOrders(((fallbackResult.data as unknown) as DirectOrderRow[]) || []);
        setTotalCount(fallbackResult.count ?? 0);
        return;
      }
      setOrders(((data as unknown) as DirectOrderRow[]) || []);
      setTotalCount(count ?? 0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(page, pageSize).catch(() => {
      setOrders([]);
      setTotalCount(0);
      setLoading(false);
    });
  }, [statusFilter, page, pageSize]);

  const filtered = useMemo(() => orders, [orders]);
  const paymentChannelLabel = (channel: string | null | undefined) => {
    if (channel === "binance_pay") return "Binance Pay";
    if (channel === "binance_onchain") return "Binance";
    return "VietQR";
  };
  const isAutoConfirmChannel = (channel: string | null | undefined) =>
    channel === "binance_onchain" || channel === "binance_pay";

  const handleApprove = async (order: DirectOrderRow) => {
    if (isAutoConfirmChannel(order.payment_channel)) {
      setStatus("Đơn Binance được xác nhận tự động qua checker/webhook. Không duyệt tay tại đây.");
      return;
    }
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      setStatus("Chưa đăng nhập.");
      return;
    }
    setSendingId(order.id);
    setStatus(null);
    try {
      const res = await fetch("/api/direct-orders/fulfill", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ orderId: order.id })
      });
      const result = await res.json();
      if (!res.ok) {
        if (res.status === 409) {
          await load();
          setStatus(result.error || `Đơn #${order.id} đã được xử lý trước đó.`);
          return;
        }
        setStatus(result.error || "Duyệt thất bại.");
        return;
      }
      const deliveryStatus = result?.delivery?.status;
      if (deliveryStatus === "queued") {
        setStatus("✅ Đơn đã được duyệt và thêm vào hàng chờ giao tự động.");
      } else {
        setStatus(`✅ Đã duyệt đơn #${order.id}.`);
      }
      await load();
    } catch (error) {
      setStatus("Duyệt thất bại.");
    } finally {
      setSendingId(null);
    }
  };

  const handleMarkFailed = async (order: DirectOrderRow) => {
    setSendingId(order.id);
    try {
      await adminApiRequest("/api/direct-orders/status", {
        method: "POST",
        body: JSON.stringify({
          orderId: order.id,
          status: "failed"
        })
      });
      setStatus(`Đã đánh dấu thất bại đơn #${order.id}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Không thể cập nhật đơn.");
      return;
    } finally {
      setSendingId(null);
    }
    await load();
  };

  const confirmPendingAction = async () => {
    if (!pendingAction) return;
    const action = pendingAction;
    if (action.type === "approve") {
      await handleApprove(action.order);
    } else {
      await handleMarkFailed(action.order);
    }
    setPendingAction(null);
  };

  return (
    <div className="grid" style={{ gap: 24 }}>
      <div className="topbar">
        <div>
          <h1 className="page-title">Direct Orders</h1>
          <p className="muted">Theo dõi đơn thanh toán trực tiếp. VietQR có thể duyệt tay; Binance on-chain và Binance Pay Merchant được xác nhận tự động.</p>
        </div>
      </div>

      <div className="card">
        <div className="form-grid">
          <select
            className="select"
            value={statusFilter}
            onChange={(event) => {
              setPage(1);
              setStatusFilter(event.target.value);
            }}
          >
            <option value="pending">Chờ xử lý</option>
            <option value="confirmed">Đã duyệt</option>
            <option value="failed">Thất bại</option>
            <option value="cancelled">Đã hủy</option>
            <option value="all">Tất cả</option>
          </select>
        </div>
        {status && <p className="muted" style={{ marginTop: 8 }}>{status}</p>}
      </div>

      <div className="card">
        <h3 className="section-title">Danh sách đơn chuyển khoản</h3>
        <table className="table">
          <thead>
            <tr>
              <th>ID</th>
              <th>User</th>
              <th>Product</th>
              <th>Qty</th>
              <th>Unit</th>
              <th>Amount</th>
              <th>Kênh</th>
              <th>Meta thanh toán</th>
              <th>Code</th>
              <th>Status</th>
              <th>Time</th>
              <th>Hành động</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((order) => (
              <tr key={order.id}>
                <td>#{order.id}</td>
                <td>{order.user_id}</td>
                <td>{order.products?.[0]?.name ?? order.product_id}</td>
                <td>{order.quantity}</td>
                <td>{order.unit_price?.toLocaleString?.() ?? order.unit_price}</td>
                <td>{order.amount?.toLocaleString?.() ?? order.amount}</td>
                <td>{paymentChannelLabel(order.payment_channel)}</td>
                <td style={{ maxWidth: 280 }}>
                  {isAutoConfirmChannel(order.payment_channel) ? (
                    <div className="muted">
                      <div>{order.payment_amount_asset || "-"} {order.payment_asset || ""}</div>
                      <div>{order.payment_channel === "binance_pay" ? "Merchant" : (order.payment_network || "-")}</div>
                      <div>{order.binance_pay_status || order.external_tx_id || order.external_payment_id || order.binance_pay_prepay_id || "Chưa có tx"}</div>
                    </div>
                  ) : (
                    <span className="muted">-</span>
                  )}
                </td>
                <td>{order.code}</td>
                <td>{STATUS_LABELS[order.status] ?? order.status}</td>
                <td>{order.created_at ? new Date(order.created_at).toLocaleString() : "-"}</td>
                <td className="row-actions-cell">
                  <RowActionMenu
                    items={
                      order.status === "pending"
                        ? [
                            {
                              label: isAutoConfirmChannel(order.payment_channel) ? "Tự động" : "Duyệt",
                              disabled: sendingId === order.id || isAutoConfirmChannel(order.payment_channel),
                              onSelect: () => setPendingAction({ type: "approve", order })
                            },
                            {
                              label: "Thất bại",
                              tone: "danger",
                              disabled: sendingId === order.id,
                              onSelect: () => setPendingAction({ type: "failed", order })
                            }
                          ]
                        : []
                    }
                  />
                </td>
              </tr>
            ))}
            {!filtered.length && (
              <tr>
                <td colSpan={12} className="muted">{loading ? "Đang tải direct orders..." : "Chưa có đơn."}</td>
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

      <ConfirmDialog
        open={Boolean(pendingAction)}
        title={pendingAction?.type === "approve" ? "Duyệt direct order?" : "Đánh dấu đơn thất bại?"}
        description={
          pendingAction ? (
            <>
              Đơn #{pendingAction.order.id} của user {pendingAction.order.user_id}, mã{" "}
              <strong>{pendingAction.order.code}</strong>.
              {pendingAction.type === "approve"
                ? " Hệ thống sẽ tạo đơn giao tự động sau khi duyệt."
                : " Trạng thái đơn sẽ chuyển sang thất bại."}
            </>
          ) : null
        }
        confirmLabel={pendingAction?.type === "approve" ? "Duyệt đơn" : "Đánh dấu thất bại"}
        tone={pendingAction?.type === "approve" ? "primary" : "danger"}
        busy={Boolean(pendingAction && sendingId === pendingAction.order.id)}
        onConfirm={confirmPendingAction}
        onCancel={() => setPendingAction(null)}
      />
    </div>
  );
}
