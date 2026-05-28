"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SkeletonTable } from "@/components/AdminUi";
import {
  fetchReportsSnapshot,
  type RevenueStats,
  type OrderOpsStats,
  type DirectOrderStats,
  type DailyTrendRow,
  type TopProductRow,
  type ReportsPeriod,
  type ReportsSnapshotParams,
  type ReportsSnapshot
} from "@/lib/adminAnalyticsClient";

const MONTH_CELL_LABELS = ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10", "T11", "T12"];

const calcDeltaPercent = (current: number, previous: number) => {
  if (previous <= 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
};

const formatDeltaPercent = (value: number) => {
  if (!Number.isFinite(value)) return "0%";
  const rounded = Math.round(value * 10) / 10;
  if (rounded > 0) return `+${rounded}%`;
  return `${rounded}%`;
};

const formatCurrency = (value: number) => Math.round(value || 0).toLocaleString("vi-VN");

const formatMoneyDelta = (value: number) => {
  const rounded = Math.round(value || 0);
  if (rounded > 0) return `+${formatCurrency(rounded)}`;
  if (rounded < 0) return `-${formatCurrency(Math.abs(rounded))}`;
  return "0";
};

const getMonthInputValue = (value: Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit"
  }).formatToParts(value);

  const year = parts.find((part) => part.type === "year")?.value || "1970";
  const month = parts.find((part) => part.type === "month")?.value || "01";
  return `${year}-${month}`;
};

const parseMonthValue = (value: string) => {
  const match = /^(\d{4})-(\d{2})$/.exec(value || "");
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }

  return { year, month };
};

const shiftMonthInputValue = (value: string, delta: number) => {
  const parsed = parseMonthValue(value);
  if (!parsed) {
    return getMonthInputValue(new Date());
  }

  const shifted = new Date(Date.UTC(parsed.year, parsed.month - 1 + delta, 1));
  return getMonthInputValue(shifted);
};

const formatMonthDisplay = (value: string) => {
  const parsed = parseMonthValue(value);
  if (!parsed) return "Chọn tháng";
  return `tháng ${parsed.month} năm ${parsed.year}`;
};

type MonthOnlyPickerProps = {
  label: string;
  value: string;
  onChange: (nextValue: string) => void;
};

function MonthOnlyPicker({ label, value, onChange }: MonthOnlyPickerProps) {
  const [open, setOpen] = useState(false);
  const [visibleYear, setVisibleYear] = useState(parseMonthValue(value)?.year ?? new Date().getFullYear());
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const parsed = parseMonthValue(value);
    if (parsed) {
      setVisibleYear(parsed.year);
    }
  }, [value]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  const selected = parseMonthValue(value);

  return (
    <div className="month-picker" ref={rootRef}>
      <p className="muted" style={{ marginBottom: 6 }}>{label}</p>
      <button
        type="button"
        className={`month-picker-trigger ${open ? "is-open" : ""}`}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{formatMonthDisplay(value)}</span>
        <span className="month-picker-caret" aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className="month-picker-popover">
          <div className="month-picker-panel">
            <div className="month-picker-header">
              <button
                type="button"
                className="month-picker-nav"
                aria-label="Năm trước"
                onClick={() => setVisibleYear((year) => year - 1)}
              >
                ‹
              </button>
              <div className="month-picker-title">năm {visibleYear}</div>
              <button
                type="button"
                className="month-picker-nav"
                aria-label="Năm sau"
                onClick={() => setVisibleYear((year) => year + 1)}
              >
                ›
              </button>
            </div>

            <div className="month-picker-grid">
              {MONTH_CELL_LABELS.map((monthLabel, index) => {
                const month = index + 1;
                const optionValue = `${visibleYear}-${String(month).padStart(2, "0")}`;
                const active = selected?.year === visibleYear && selected.month === month;

                return (
                  <button
                    key={optionValue}
                    type="button"
                    className={`month-picker-cell ${active ? "active" : ""}`}
                    onClick={() => {
                      onChange(optionValue);
                      setOpen(false);
                    }}
                  >
                    {monthLabel}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ReportsPage() {
  const initialMonth = getMonthInputValue(new Date());
  const [loading, setLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<ReportsPeriod>("month");
  const [resolvedPeriod, setResolvedPeriod] = useState<ReportsPeriod>("month");
  const [selectedMonth, setSelectedMonth] = useState(initialMonth);
  const [compareMonth, setCompareMonth] = useState(shiftMonthInputValue(initialMonth, -1));
  const [periodLabel, setPeriodLabel] = useState("Tháng này");
  const [comparisonLabel, setComparisonLabel] = useState("Tháng trước");
  const [hasComparison, setHasComparison] = useState(true);

  const [revenue, setRevenue] = useState<RevenueStats>({
    current: 0,
    previous: 0,
    deltaAmount: 0,
    deltaPercent: 0
  });
  const [orderOps, setOrderOps] = useState<OrderOpsStats>({
    orderCount: 0,
    averageOrderValue: 0,
    averageQuantity: 0
  });
  const [directOrderStats, setDirectOrderStats] = useState<DirectOrderStats>({
    total: 0,
    confirmed: 0,
    failed: 0,
    cancelled: 0,
    pending: 0,
    pendingExpired: 0,
    confirmedRate: 0,
    failedRate: 0
  });
  const [dailyTrend, setDailyTrend] = useState<DailyTrendRow[]>([]);
  const [topProducts, setTopProducts] = useState<TopProductRow[]>([]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const params: ReportsSnapshotParams =
          selectedPeriod === "custom_month"
            ? {
                period: selectedPeriod,
                month: selectedMonth,
                compareMonth: compareMonth || undefined
              }
            : { period: selectedPeriod };
        const snapshot: ReportsSnapshot = await fetchReportsSnapshot(params);
        setResolvedPeriod(snapshot.period);
        setPeriodLabel(snapshot.periodLabel);
        setComparisonLabel(snapshot.comparisonLabel);
        setHasComparison(snapshot.hasComparison);
        if (snapshot.period === "custom_month") {
          if (snapshot.selectedMonth && snapshot.selectedMonth !== selectedMonth) {
            setSelectedMonth(snapshot.selectedMonth);
          }
          if (snapshot.comparisonMonth && snapshot.comparisonMonth !== compareMonth) {
            setCompareMonth(snapshot.comparisonMonth);
          }
        }
        setRevenue(snapshot.revenue);
        setOrderOps(snapshot.orderOps);
        setDirectOrderStats(snapshot.directOrderStats);
        setDailyTrend(snapshot.dailyTrend);
        setTopProducts(snapshot.topProducts);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Không thể tải báo cáo.");
      } finally {
        setHasLoadedOnce(true);
        setLoading(false);
      }
    };

    load();
  }, [selectedPeriod, selectedMonth, compareMonth]);

  const revenueDeltaPercent = useMemo(
    () => revenue.deltaPercent || calcDeltaPercent(revenue.current, revenue.previous),
    [revenue.current, revenue.deltaPercent, revenue.previous]
  );

  const revenueDeltaAmount = useMemo(
    () => revenue.deltaAmount || revenue.current - revenue.previous,
    [revenue.current, revenue.deltaAmount, revenue.previous]
  );

  const trendTitle =
    resolvedPeriod === "all_time"
      ? "Xu hướng theo tháng trong toàn thời gian"
      : `Xu hướng trong ${periodLabel.toLowerCase()}`;

  const topProductsTitle =
    resolvedPeriod === "all_time"
      ? "Top sản phẩm toàn thời gian (theo doanh thu)"
      : `Top sản phẩm trong ${periodLabel.toLowerCase()} (theo doanh thu)`;

  const comparisonSummary = hasComparison
    ? `So với ${comparisonLabel.toLowerCase()}: ${formatMoneyDelta(revenueDeltaAmount)} VND (${formatDeltaPercent(
        revenueDeltaPercent
      )})`
    : "Không áp dụng so sánh kỳ trước.";
  const initialLoading = loading && !hasLoadedOnce;

  const downloadCsv = () => {
    const escapeCsv = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const rows = [
      ["Section", "Metric", "Value"],
      ["Revenue", "Period", periodLabel],
      ["Revenue", "Current", revenue.current],
      ["Revenue", "Previous", revenue.previous],
      ["Revenue", "Delta", revenueDeltaAmount],
      ["Orders", "Count", orderOps.orderCount],
      ["Orders", "AOV", orderOps.averageOrderValue],
      ["DirectOrders", "Total", directOrderStats.total],
      ["DirectOrders", "Confirmed", directOrderStats.confirmed],
      ["DirectOrders", "Failed/Cancelled", directOrderStats.failed + directOrderStats.cancelled],
      [],
      ["Trend", "Label", "Orders", "Revenue"],
      ...dailyTrend.map((row) => ["Trend", row.label, row.orders, row.revenue]),
      [],
      ["TopProducts", "Product", "Orders", "Quantity", "Revenue"],
      ...topProducts.map((row) => ["TopProducts", row.productName, row.orders, row.quantity, row.revenue])
    ];
    const csv = rows.map((row) => row.map(escapeCsv).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `bot-report-${resolvedPeriod}-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="grid" style={{ gap: 24 }}>
      <div className="topbar">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="muted">Báo cáo vận hành và hiệu suất bán hàng.</p>
        </div>
        <button className="button secondary" type="button" onClick={downloadCsv} disabled={initialLoading}>
          Export CSV
        </button>
      </div>

      <div className="card report-filter-card">
        <div className="report-filter-stack">
          <div className="segmented" role="tablist" aria-label="Report period">
            <button
              type="button"
              role="tab"
              aria-selected={selectedPeriod === "today"}
              className={`segmented-button ${selectedPeriod === "today" ? "active" : ""}`}
              onClick={() => setSelectedPeriod("today")}
            >
              Hôm nay
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={selectedPeriod === "month"}
              className={`segmented-button ${selectedPeriod === "month" ? "active" : ""}`}
              onClick={() => setSelectedPeriod("month")}
            >
              Tháng này
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={selectedPeriod === "quarter"}
              className={`segmented-button ${selectedPeriod === "quarter" ? "active" : ""}`}
              onClick={() => setSelectedPeriod("quarter")}
            >
              Quý này
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={selectedPeriod === "custom_month"}
              className={`segmented-button ${selectedPeriod === "custom_month" ? "active" : ""}`}
              onClick={() => setSelectedPeriod("custom_month")}
            >
              Theo tháng
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={selectedPeriod === "all_time"}
              className={`segmented-button ${selectedPeriod === "all_time" ? "active" : ""}`}
              onClick={() => setSelectedPeriod("all_time")}
            >
              Từ trước đến nay
            </button>
          </div>

          {selectedPeriod === "custom_month" && (
            <div className="report-picker-row">
              <MonthOnlyPicker label="Tháng báo cáo" value={selectedMonth} onChange={setSelectedMonth} />
              <MonthOnlyPicker label="So sánh với tháng" value={compareMonth} onChange={setCompareMonth} />
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="card">
          <p className="muted">Lỗi tải báo cáo: {error}</p>
        </div>
      )}

      <div className="grid stats">
        <div className="card">
          <p className="muted">Doanh thu {periodLabel.toLowerCase()}</p>
          {initialLoading ? (
            <SkeletonTable rows={2} cols={1} />
          ) : (
            <>
              <h2>{formatCurrency(revenue.current)}</h2>
              <p className="muted" style={{ marginTop: 4 }}>
                {comparisonSummary}
              </p>
            </>
          )}
        </div>
        <div className="card">
          <p className="muted">Số đơn {periodLabel.toLowerCase()}</p>
          {initialLoading ? (
            <SkeletonTable rows={2} cols={1} />
          ) : (
            <>
              <h2>{orderOps.orderCount.toLocaleString("vi-VN")}</h2>
              <p className="muted" style={{ marginTop: 4 }}>
                {hasComparison
                  ? `Doanh thu ${comparisonLabel.toLowerCase()}: ${formatCurrency(revenue.previous)}`
                  : "Thống kê lũy kế toàn bộ đơn hàng đã hoàn tất."}
              </p>
            </>
          )}
        </div>
        <div className="card">
          <p className="muted">AOV {periodLabel.toLowerCase()}</p>
          {initialLoading ? (
            <SkeletonTable rows={2} cols={1} />
          ) : (
            <>
              <h2>{formatCurrency(orderOps.averageOrderValue)}</h2>
              <p className="muted" style={{ marginTop: 4 }}>
                SL trung bình / đơn: {orderOps.averageQuantity.toFixed(2)}
              </p>
            </>
          )}
        </div>
      </div>

      <div className="grid stats">
        <div className="card">
          <p className="muted">Direct order đã duyệt</p>
          {initialLoading ? (
            <SkeletonTable rows={2} cols={1} />
          ) : (
            <>
              <h2>{directOrderStats.confirmed.toLocaleString("vi-VN")}</h2>
              <p className="muted" style={{ marginTop: 4 }}>
                Tỉ lệ duyệt: {directOrderStats.confirmedRate.toFixed(1)}%
              </p>
            </>
          )}
        </div>
        <div className="card">
          <p className="muted">Direct order thất bại + hủy</p>
          {initialLoading ? (
            <SkeletonTable rows={2} cols={1} />
          ) : (
            <>
              <h2>{(directOrderStats.failed + directOrderStats.cancelled).toLocaleString("vi-VN")}</h2>
              <p className="muted" style={{ marginTop: 4 }}>
                Tỉ lệ thất bại: {directOrderStats.failedRate.toFixed(1)}%
              </p>
            </>
          )}
        </div>
        <div className="card">
          <p className="muted">Direct order đang chờ</p>
          {initialLoading ? (
            <SkeletonTable rows={2} cols={1} />
          ) : (
            <>
              <h2>{directOrderStats.pending.toLocaleString("vi-VN")}</h2>
              <p className="muted" style={{ marginTop: 4 }}>
                Quá hạn 10 phút: {directOrderStats.pendingExpired.toLocaleString("vi-VN")}
              </p>
            </>
          )}
        </div>
        <div className="card">
          <p className="muted">Tổng direct order</p>
          {initialLoading ? <SkeletonTable rows={2} cols={1} /> : <h2>{directOrderStats.total.toLocaleString("vi-VN")}</h2>}
        </div>
      </div>

      <div className="card">
        <h3 className="section-title">{trendTitle}</h3>
        <table className="table">
          <thead>
            <tr>
              <th>{resolvedPeriod === "all_time" ? "Tháng" : "Ngày"}</th>
              <th>Số đơn</th>
              <th>Doanh thu (VND)</th>
            </tr>
          </thead>
          <tbody>
            {dailyTrend.map((row) => (
              <tr key={row.dateKey}>
                <td>{row.label}</td>
                <td>{row.orders.toLocaleString("vi-VN")}</td>
                <td>{row.revenue.toLocaleString("vi-VN")}</td>
              </tr>
            ))}
            {!dailyTrend.length && (
              <tr>
                <td colSpan={3} className="muted">
                  {loading ? "Đang tải..." : "Chưa có dữ liệu."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3 className="section-title">{topProductsTitle}</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Sản phẩm</th>
              <th>Số đơn</th>
              <th>Tổng SL</th>
              <th>Doanh thu (VND)</th>
            </tr>
          </thead>
          <tbody>
            {topProducts.map((row) => (
              <tr key={row.productId}>
                <td>{row.productName}</td>
                <td>{row.orders.toLocaleString("vi-VN")}</td>
                <td>{row.quantity.toLocaleString("vi-VN")}</td>
                <td>{row.revenue.toLocaleString("vi-VN")}</td>
              </tr>
            ))}
            {!topProducts.length && (
              <tr>
                <td colSpan={4} className="muted">
                  {loading ? "Đang tải..." : "Chưa có dữ liệu sản phẩm."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
