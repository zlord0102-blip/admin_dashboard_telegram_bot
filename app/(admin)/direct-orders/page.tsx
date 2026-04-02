"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

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

export default function DirectOrdersPage() {
  const [orders, setOrders] = useState<DirectOrderRow[]>([]);
  const [statusFilter, setStatusFilter] = useState("pending");
  const [sendingId, setSendingId] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const load = async () => {
    let query = supabase
      .from("direct_orders")
      .select("id, user_id, product_id, quantity, bonus_quantity, unit_price, amount, code, status, created_at, payment_channel, payment_asset, payment_network, payment_amount_asset, payment_address, payment_address_tag, external_payment_id, external_tx_id, external_paid_at, products(name)")
      .order("created_at", { ascending: false })
      .limit(200);
    if (statusFilter !== "all") {
      query = query.eq("status", statusFilter);
    }
    const { data, error } = await query;
    if (error) {
      const fallback = await supabase
        .from("direct_orders")
        .select("id, user_id, product_id, quantity, unit_price, amount, code, status, created_at, products(name)")
        .order("created_at", { ascending: false })
        .limit(200);
      setOrders(((fallback.data as unknown) as DirectOrderRow[]) || []);
      return;
    }
    setOrders(((data as unknown) as DirectOrderRow[]) || []);
  };

  useEffect(() => {
    load();
  }, [statusFilter]);

  const filtered = useMemo(() => orders, [orders]);
  const paymentChannelLabel = (channel: string | null | undefined) => {
    if (channel === "binance_onchain") return "Binance";
    return "VietQR";
  };

  const handleApprove = async (order: DirectOrderRow) => {
    if (order.payment_channel === "binance_onchain") {
      setStatus("Đơn Binance on-chain được xác nhận tự động. Không duyệt tay tại đây.");
      return;
    }
    if (!confirm(`Duyệt đơn #${order.id} và đưa vào hàng chờ giao tự động cho user ${order.user_id}?`)) return;
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
    if (!confirm(`Đánh dấu thất bại đơn #${order.id}?`)) return;
    await supabase.from("direct_orders").update({ status: "failed" }).eq("id", order.id);
    await load();
  };

  return (
    <div className="grid" style={{ gap: 24 }}>
      <div className="topbar">
        <div>
          <h1 className="page-title">Direct Orders</h1>
          <p className="muted">Theo dõi đơn thanh toán trực tiếp. VietQR có thể duyệt tay; Binance on-chain được xác nhận tự động.</p>
        </div>
      </div>

      <div className="card">
        <div className="form-grid">
          <select
            className="select"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
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
                  {order.payment_channel === "binance_onchain" ? (
                    <div className="muted">
                      <div>{order.payment_amount_asset || "-"} {order.payment_asset || ""}</div>
                      <div>{order.payment_network || "-"}</div>
                      <div>{order.external_tx_id || order.external_payment_id || "Chưa có tx"}</div>
                    </div>
                  ) : (
                    <span className="muted">-</span>
                  )}
                </td>
                <td>{order.code}</td>
                <td>{STATUS_LABELS[order.status] ?? order.status}</td>
                <td>{order.created_at ? new Date(order.created_at).toLocaleString() : "-"}</td>
                <td>
                  {order.status === "pending" ? (
                    <>
                      <button
                        className="button secondary"
                        disabled={sendingId === order.id || order.payment_channel === "binance_onchain"}
                        onClick={() => handleApprove(order)}
                      >
                        {order.payment_channel === "binance_onchain" ? "Tự động" : "Duyệt"}
                      </button>
                      <button
                        className="button danger"
                        style={{ marginLeft: 8 }}
                        disabled={sendingId === order.id}
                        onClick={() => handleMarkFailed(order)}
                      >
                        Thất bại
                      </button>
                    </>
                  ) : (
                    <span className="muted">-</span>
                  )}
                </td>
              </tr>
            ))}
            {!filtered.length && (
              <tr>
                <td colSpan={12} className="muted">Chưa có đơn.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
