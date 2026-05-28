"use client";

import { useEffect, useState } from "react";
import { PaginationControls } from "@/components/AdminUi";
import { adminApiGet } from "@/lib/adminOpsClient";

interface OrderRow {
  id: number | string;
  user_id: number | string;
  product_id: number | string;
  price: number;
  quantity: number;
  created_at: string;
}

type OrdersSnapshot = {
  orders: OrderRow[];
  totalCount: number;
  usernamesByUserId: Record<string, string | null>;
  displayNamesByUserId: Record<string, string | null>;
  productNamesById: Record<string, string>;
};

export default function OrdersPage() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [usernamesByUserId, setUsernamesByUserId] = useState<Record<string, string | null>>({});
  const [displayNamesByUserId, setDisplayNamesByUserId] = useState<Record<string, string | null>>({});
  const [productNamesById, setProductNamesById] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const load = async (pageIndex: number, nextPageSize = pageSize) => {
    setLoading(true);

    try {
      const params = new URLSearchParams({
        page: String(pageIndex),
        pageSize: String(nextPageSize)
      });
      const snapshot = await adminApiGet<OrdersSnapshot>(`/api/admin/orders?${params.toString()}`);
      setOrders(snapshot.orders || []);
      setTotalCount(snapshot.totalCount ?? 0);
      setUsernamesByUserId(snapshot.usernamesByUserId || {});
      setDisplayNamesByUserId(snapshot.displayNamesByUserId || {});
      setProductNamesById(snapshot.productNamesById || {});
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(page, pageSize).catch(() => {
      setOrders([]);
      setTotalCount(0);
      setUsernamesByUserId({});
      setDisplayNamesByUserId({});
      setProductNamesById({});
      setLoading(false);
    });
  }, [page, pageSize]);

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

  return (
    <div className="grid" style={{ gap: 24 }}>
      <div className="topbar">
        <div>
          <h1 className="page-title">Orders</h1>
          <p className="muted">Theo dõi đơn hàng gần nhất.</p>
        </div>
      </div>

      <div className="card">
        <h3 className="section-title">Danh sách đơn hàng</h3>
        <table className="table">
          <thead>
            <tr>
              <th>ID</th>
              <th>UserID</th>
              <th>Username</th>
              <th>Tên người dùng</th>
              <th>Sản phẩm</th>
              <th>SL</th>
              <th>Giá</th>
              <th>Thời gian</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id}>
                <td>#{order.id}</td>
                <td>{order.user_id}</td>
                <td>{usernamesByUserId[String(order.user_id)] || "-"}</td>
                <td>{displayNamesByUserId[String(order.user_id)] || "-"}</td>
                <td>{productNamesById[String(order.product_id)] || order.product_id}</td>
                <td>{order.quantity}</td>
                <td>{order.price.toLocaleString("vi-VN")}</td>
                <td>{formatDateTime(order.created_at)}</td>
              </tr>
            ))}
            {!orders.length && (
              <tr>
                <td colSpan={8} className="muted">{loading ? "Đang tải đơn hàng..." : "Chưa có đơn hàng."}</td>
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
    </div>
  );
}
