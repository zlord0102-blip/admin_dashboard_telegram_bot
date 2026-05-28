"use client";

import { useEffect, useMemo, useState } from "react";
import { EmptyState, PageHeader, SkeletonTable, StatusPill } from "@/components/AdminUi";
import {
  fetchAdminAuditLogs,
  fetchAdminOpsHealth,
  type AdminAuditLogRow,
  type AdminOpsHealth
} from "@/lib/adminOpsClient";
import {
  ADMIN_API_TIMING_EVENT,
  clearAdminApiTimingSamples,
  getAdminApiTimingRanking,
  type AdminApiTimingRankingRow
} from "@/lib/adminApiTimingClient";

const formatDateTime = (value: string | null | undefined) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
};

const flattenChecks = (records: Record<string, boolean>) =>
  Object.entries(records || {}).map(([key, ok]) => ({ key, ok }));

const metricNumber = (value: number | null | undefined) =>
  Number.isFinite(Number(value)) ? Number(value).toLocaleString("vi-VN") : "0";

const metricMs = (value: number | null | undefined) =>
  Number.isFinite(Number(value)) ? `${Number(value).toLocaleString("vi-VN")} ms` : "-";

const formatTimingMs = (value: number) =>
  `${Math.round(value * 10) / 10} ms`;

function ApiTimingRankingCard() {
  const [rows, setRows] = useState<AdminApiTimingRankingRow[]>([]);

  const refreshRows = () => setRows(getAdminApiTimingRanking(12));

  useEffect(() => {
    refreshRows();
    window.addEventListener(ADMIN_API_TIMING_EVENT, refreshRows);
    return () => window.removeEventListener(ADMIN_API_TIMING_EVENT, refreshRows);
  }, []);

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 12 }}>
        <div>
          <h3 className="section-title" style={{ marginBottom: 4 }}>Slow Admin API endpoints</h3>
          <p className="muted">
            Xếp hạng từ các request thật trong browser hiện tại, ưu tiên `Server-Timing` nếu response có header.
          </p>
        </div>
        <button
          type="button"
          className="button secondary"
          onClick={() => {
            clearAdminApiTimingSamples();
            refreshRows();
          }}
          disabled={!rows.length}
        >
          Xóa mẫu
        </button>
      </div>

      {!rows.length ? (
        <EmptyState
          title="Chưa có mẫu API"
          description="Mở vài tab hoặc bấm làm mới để thu thập timing từ response Admin API."
        />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Endpoint</th>
              <th>Count</th>
              <th>Avg</th>
              <th>Max</th>
              <th>Last</th>
              <th>Status</th>
              <th>Source</th>
              <th>Cache</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.method}:${row.route}`}>
                <td>
                  <code>{row.route}</code>
                  <div className="muted" style={{ fontSize: 11 }}>{formatDateTime(row.lastAt)}</div>
                </td>
                <td>{row.count.toLocaleString("vi-VN")}</td>
                <td>{formatTimingMs(row.avgMs)}</td>
                <td>
                  <StatusPill tone={row.maxMs >= 1_000 ? "danger" : row.maxMs >= 500 ? "warning" : "success"}>
                    {formatTimingMs(row.maxMs)}
                  </StatusPill>
                </td>
                <td>{formatTimingMs(row.lastMs)}</td>
                <td>
                  <StatusPill tone={row.errorCount > 0 || row.lastStatus >= 400 ? "danger" : "success"}>
                    {row.lastStatus || "ERR"}
                  </StatusPill>
                </td>
                <td>{row.serverSampleCount > 0 ? "server" : "client"}</td>
                <td>{row.cache || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function HealthPage() {
  const [health, setHealth] = useState<AdminOpsHealth | null>(null);
  const [logs, setLogs] = useState<AdminAuditLogRow[]>([]);
  const [healthLoading, setHealthLoading] = useState(true);
  const [auditLoading, setAuditLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async ({ force = false }: { force?: boolean } = {}) => {
    setHealthLoading(true);
    setAuditLoading(true);
    setError(null);
    const healthRequest = fetchAdminOpsHealth(5, { force })
      .then((nextHealth) => {
      setHealth(nextHealth);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Không thể tải health snapshot.");
        setHealth(null);
      })
      .finally(() => setHealthLoading(false));

    const auditRequest = fetchAdminAuditLogs(30, { force })
      .then((audit) => setLogs(audit.logs))
      .catch(() => setLogs([]))
      .finally(() => setAuditLoading(false));

    await Promise.all([healthRequest, auditRequest]);
  };

  useEffect(() => {
    load();
  }, []);

  const schemaChecks = useMemo(() => {
    if (!health) return [];
    return [
      ...flattenChecks(health.schema.tables).map((item) => ({ ...item, group: "Table" })),
      ...flattenChecks(health.schema.productColumns).map((item) => ({ ...item, group: "Product column" })),
      ...flattenChecks(health.schema.rpcs).map((item) => ({ ...item, group: "RPC" }))
    ];
  }, [health]);

  const queueRisk =
    health &&
    (health.queues.pendingDirectOrdersExpired > 0 ||
      health.queues.deliveryOutbox.failed > 0 ||
      health.queues.deliveryOutbox.retryDue > 0);
  const binanceWebhook = health?.binancePayWebhook ?? null;
  const binanceWebhookAlerts = health?.binancePayWebhookAlerts ?? [];
  const binanceWebhookRisk = binanceWebhookAlerts.some((alert) => alert.severity === "critical");

  return (
    <div className="grid" style={{ gap: 20 }}>
      <PageHeader
        title="System Health"
        description="Kiểm tra schema, hàng chờ giao hàng, pending payment và audit log."
        actions={
          <button
            className="button secondary"
            type="button"
            onClick={() => load({ force: true })}
            disabled={healthLoading || auditLoading}
          >
            {healthLoading || auditLoading ? "Đang tải..." : "Làm mới"}
          </button>
        }
      />

      {error && (
        <div className="card compact-card" style={{ borderColor: "rgba(194, 65, 58, 0.32)" }}>
          <p style={{ color: "var(--danger)" }}>{error}</p>
        </div>
      )}

      <ApiTimingRankingCard />

      {healthLoading && !health && (
        <>
          <div className="grid stats">
            <div className="card"><SkeletonTable rows={2} cols={1} /></div>
            <div className="card"><SkeletonTable rows={2} cols={1} /></div>
            <div className="card"><SkeletonTable rows={2} cols={1} /></div>
            <div className="card"><SkeletonTable rows={2} cols={1} /></div>
          </div>
          <div className="card">
            <h3 className="section-title">Schema checklist</h3>
            <SkeletonTable rows={5} cols={3} />
          </div>
        </>
      )}

      {health && (
        <>
          <div className="grid stats">
            <div className="card">
              <p className="muted">Direct pending</p>
              <h2>{health.queues.pendingDirectOrders.toLocaleString("vi-VN")}</h2>
              <StatusPill tone={health.queues.pendingDirectOrdersExpired > 0 ? "danger" : "success"}>
                {health.queues.pendingDirectOrdersExpired} quá hạn
              </StatusPill>
            </div>
            <div className="card">
              <p className="muted">Delivery outbox</p>
              <h2>{health.queues.deliveryOutbox.pending.toLocaleString("vi-VN")}</h2>
              <StatusPill tone={queueRisk ? "warning" : "success"}>
                {health.queues.deliveryOutbox.failed} failed / {health.queues.deliveryOutbox.retryDue} retry
              </StatusPill>
            </div>
            <div className="card">
              <p className="muted">Low stock</p>
              <h2>{health.stock.count.toLocaleString("vi-VN")}</h2>
              <StatusPill tone={health.stock.count > 0 ? "warning" : "success"}>
                {"ngưỡng <= "} {health.stock.threshold}
              </StatusPill>
            </div>
            <div className="card">
              <p className="muted">Finance pending</p>
              <h2>
                {(
                  health.queues.pendingDeposits +
                  health.queues.pendingWithdrawals +
                  health.queues.pendingUsdtWithdrawals
                ).toLocaleString("vi-VN")}
              </h2>
              <StatusPill tone="neutral">nạp/rút/USDT</StatusPill>
            </div>
          </div>

          <div className="card">
            <h3 className="section-title">Schema checklist</h3>
            <table className="table">
              <thead>
                <tr>
                  <th>Nhóm</th>
                  <th>Hạng mục</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {schemaChecks.map((item) => (
                  <tr key={`${item.group}:${item.key}`}>
                    <td>{item.group}</td>
                    <td>{item.key}</td>
                    <td>
                      <StatusPill tone={item.ok ? "success" : "danger"}>{item.ok ? "OK" : "Thiếu"}</StatusPill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 12 }}>
              <h3 className="section-title" style={{ marginBottom: 0 }}>Binance Pay webhook</h3>
              <StatusPill tone={!binanceWebhook ? "neutral" : binanceWebhookRisk ? "danger" : "success"}>
                {!binanceWebhook ? "Chưa có dữ liệu" : binanceWebhookRisk ? "Cần kiểm tra" : "OK"}
              </StatusPill>
            </div>
            {!binanceWebhook ? (
              <EmptyState title="Chưa có metric webhook" description="Metric sẽ xuất hiện sau khi checker ghi `bot_checker_health` mới." />
            ) : (
              <div className="grid" style={{ gap: 16 }}>
                {binanceWebhookAlerts.length > 0 && (
                  <div className="grid" style={{ gap: 8 }}>
                    {binanceWebhookAlerts.map((alert) => (
                      <div
                        key={alert.id}
                        style={{
                          border: "1px solid rgba(194, 65, 58, 0.28)",
                          borderRadius: 8,
                          padding: 12,
                          display: "grid",
                          gap: 6
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                          <strong>{alert.title}</strong>
                          <StatusPill tone={alert.severity === "critical" ? "danger" : "warning"}>
                            {alert.severity}
                          </StatusPill>
                        </div>
                        <p className="muted">{alert.message}</p>
                        <p className="muted">
                          {alert.metric}: {metricNumber(alert.count)} / {alert.windowMinutes} phút gần nhất /{" "}
                          {formatDateTime(alert.lastAt)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
                <div className="grid stats">
                  <div>
                    <p className="muted">Webhook nhận</p>
                    <h2>{metricNumber(binanceWebhook.received)}</h2>
                    <StatusPill tone={(binanceWebhook.signatureInvalid || 0) > 0 ? "danger" : "success"}>
                      {metricNumber(binanceWebhook.signatureInvalid)} signature invalid
                    </StatusPill>
                  </div>
                  <div>
                    <p className="muted">Cert refresh</p>
                    <h2>{metricNumber(binanceWebhook.certRefresh)}</h2>
                    <StatusPill tone="neutral">{formatDateTime(binanceWebhook.lastCertRefreshAt)}</StatusPill>
                  </div>
                  <div>
                    <p className="muted">Query Order</p>
                    <h2>{metricMs(binanceWebhook.lastQueryOrderMs)}</h2>
                    <StatusPill tone={(binanceWebhook.queryOrderError || 0) > 0 ? "danger" : "success"}>
                      avg {metricMs(binanceWebhook.avgQueryOrderMs)}
                    </StatusPill>
                  </div>
                  <div>
                    <p className="muted">Fulfillment</p>
                    <h2>{metricNumber(binanceWebhook.fulfillmentSuccess)}</h2>
                    <StatusPill tone={(binanceWebhook.fulfillmentError || 0) > 0 ? "danger" : "success"}>
                      {binanceWebhook.lastFulfillmentResult || "none"}
                    </StatusPill>
                  </div>
                </div>
                <table className="table">
                  <tbody>
                    <tr>
                      <td>Signature accepted / unavailable</td>
                      <td>{metricNumber(binanceWebhook.signatureAccepted)} / {metricNumber(binanceWebhook.signatureUnavailable)}</td>
                    </tr>
                    <tr>
                      <td>Query paid / not paid / mismatch / error</td>
                      <td>
                        {metricNumber(binanceWebhook.queryOrderPaid)} / {metricNumber(binanceWebhook.queryOrderNotPaid)} /{" "}
                        {metricNumber(binanceWebhook.queryOrderMismatch)} / {metricNumber(binanceWebhook.queryOrderError)}
                      </td>
                    </tr>
                    <tr>
                      <td>Fulfillment success / skipped / error</td>
                      <td>
                        {metricNumber(binanceWebhook.fulfillmentSuccess)} / {metricNumber(binanceWebhook.fulfillmentSkipped)} /{" "}
                        {metricNumber(binanceWebhook.fulfillmentError)}
                      </td>
                    </tr>
                    <tr>
                      <td>Last event</td>
                      <td>{binanceWebhook.lastEvent || "-"}</td>
                    </tr>
                    <tr>
                      <td>Last webhook / query / fulfillment</td>
                      <td>
                        {formatDateTime(binanceWebhook.lastWebhookAt)} / {formatDateTime(binanceWebhook.lastQueryOrderAt)} /{" "}
                        {formatDateTime(binanceWebhook.lastFulfillmentAt)}
                      </td>
                    </tr>
                    <tr>
                      <td>Last trade / prepay</td>
                      <td>{binanceWebhook.lastMerchantTradeNo || "-"} / {binanceWebhook.lastPrepayId || "-"}</td>
                    </tr>
                    <tr>
                      <td>Last error</td>
                      <td>{binanceWebhook.lastError || "-"}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="grid stats">
            <div className="card">
              <h3 className="section-title">Payment settings</h3>
              <div className="grid" style={{ gap: 8 }}>
                {flattenChecks(health.settings).map((item) => (
                  <div key={item.key} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span>{item.key}</span>
                    <StatusPill tone={item.ok ? "success" : "warning"}>{item.ok ? "Có" : "Thiếu"}</StatusPill>
                  </div>
                ))}
              </div>
            </div>
            <div className="card">
              <h3 className="section-title">Low-stock preview</h3>
              {!health.stock.items.length ? (
                <EmptyState title="Stock ổn" description="Không có sản phẩm nào dưới ngưỡng." />
              ) : (
                <table className="table">
                  <tbody>
                    {health.stock.items.map((item) => (
                      <tr key={item.id}>
                        <td>#{item.id}</td>
                        <td>{item.name}</td>
                        <td>{item.availableStock}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}

      <div className="card">
        <h3 className="section-title">Audit log gần đây</h3>
        {!logs.length ? (
          auditLoading ? (
            <SkeletonTable rows={5} cols={4} />
          ) : (
            <EmptyState title="Chưa có audit log" description="Audit log sẽ xuất hiện sau khi apply SQL mới và có thao tác admin." />
          )
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Thời gian</th>
                <th>Admin</th>
                <th>Action</th>
                <th>Entity</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td>{formatDateTime(log.created_at)}</td>
                  <td>{log.admin_email || log.admin_user_id || "-"}</td>
                  <td>{log.action}</td>
                  <td>
                    {log.entity_type || "-"} {log.entity_id ? `#${log.entity_id}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
