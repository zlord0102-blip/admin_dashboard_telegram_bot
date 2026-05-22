export type BinancePayWebhookHealth = {
  received: number;
  signatureAccepted: number;
  signatureInvalid: number;
  signatureUnavailable: number;
  certRefresh: number;
  queryOrderCount: number;
  queryOrderSuccess: number;
  queryOrderError: number;
  queryOrderPaid: number;
  queryOrderNotPaid: number;
  queryOrderMismatch: number;
  fulfillmentCount: number;
  fulfillmentSuccess: number;
  fulfillmentSkipped: number;
  fulfillmentError: number;
  lastWebhookAt: string | null;
  lastSignatureAcceptedAt: string | null;
  lastSignatureInvalidAt: string | null;
  lastSignatureUnavailableAt: string | null;
  lastCertRefreshAt: string | null;
  lastQueryOrderAt: string | null;
  lastQueryOrderErrorAt: string | null;
  lastQueryOrderMismatchAt: string | null;
  lastFulfillmentAt: string | null;
  lastFulfillmentSkippedAt: string | null;
  lastFulfillmentErrorAt: string | null;
  lastErrorAt: string | null;
  lastUpdatedAt: string | null;
  lastEvent: string | null;
  lastError: string | null;
  lastMerchantTradeNo: string | null;
  lastPrepayId: string | null;
  lastSignatureVerifyMs: number | null;
  lastQueryOrderMs: number | null;
  avgQueryOrderMs: number | null;
  lastFulfillmentMs: number | null;
  avgFulfillmentMs: number | null;
  lastFulfillmentResult: string | null;
};

export type BinancePayWebhookAlert = {
  id: string;
  severity: "critical" | "warning";
  title: string;
  message: string;
  metric: string;
  count: number;
  lastAt: string | null;
  windowMinutes: number;
};

const DEFAULT_ALERT_WINDOW_MINUTES = 30;

const toNumber = (value: unknown) => {
  const next = Number(value);
  return Number.isFinite(next) ? next : 0;
};

const toOptionalString = (value: unknown) => {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
};

const isRecent = (value: unknown, nowMs: number, windowMinutes: number) => {
  const text = toOptionalString(value);
  if (!text) return false;
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp)) return false;
  return nowMs - timestamp <= Math.max(1, windowMinutes) * 60_000;
};

export function buildBinancePayWebhookAlerts(
  metrics: Partial<BinancePayWebhookHealth> | Record<string, unknown> | null | undefined,
  nowMs = Date.now(),
  windowMinutes = DEFAULT_ALERT_WINDOW_MINUTES
): BinancePayWebhookAlert[] {
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) {
    return [];
  }

  const alerts: BinancePayWebhookAlert[] = [];
  const pushRecentCounterAlert = (
    id: string,
    severity: BinancePayWebhookAlert["severity"],
    title: string,
    message: string,
    metric: keyof BinancePayWebhookHealth,
    timestampMetric: keyof BinancePayWebhookHealth
  ) => {
    const count = toNumber(metrics[metric]);
    const lastAt = toOptionalString(metrics[timestampMetric]);
    if (count <= 0 || !isRecent(lastAt, nowMs, windowMinutes)) {
      return;
    }
    alerts.push({
      id,
      severity,
      title,
      message,
      metric: String(metric),
      count,
      lastAt,
      windowMinutes
    });
  };

  pushRecentCounterAlert(
    "binance-pay-signature-invalid",
    "critical",
    "Webhook signature invalid",
    "Binance Pay webhook bị từ chối chữ ký. Kiểm tra certificate SN, public route và khả năng request giả mạo.",
    "signatureInvalid",
    "lastSignatureInvalidAt"
  );
  pushRecentCounterAlert(
    "binance-pay-signature-unavailable",
    "critical",
    "Signature verification unavailable",
    "Bot không verify được Binance Pay webhook. Kiểm tra Merchant credentials, Query Certificate API và network.",
    "signatureUnavailable",
    "lastSignatureUnavailableAt"
  );
  pushRecentCounterAlert(
    "binance-pay-query-order-error",
    "critical",
    "Query Order lỗi",
    "Webhook/polling không query được trạng thái Binance Pay order. Kiểm tra API permission, timeout và Binance Pay API health.",
    "queryOrderError",
    "lastQueryOrderErrorAt"
  );
  pushRecentCounterAlert(
    "binance-pay-query-order-mismatch",
    "warning",
    "Query Order mismatch",
    "Binance Pay order đã PAID nhưng không khớp local order. Kiểm tra merchantTradeNo, prepayId, currency và amount.",
    "queryOrderMismatch",
    "lastQueryOrderMismatchAt"
  );
  pushRecentCounterAlert(
    "binance-pay-fulfillment-error",
    "critical",
    "Fulfillment lỗi",
    "Thanh toán Binance Pay đã tới bước fulfill nhưng phát sinh lỗi bất ngờ. Kiểm tra stock, direct_orders và delivery outbox.",
    "fulfillmentError",
    "lastFulfillmentErrorAt"
  );
  pushRecentCounterAlert(
    "binance-pay-fulfillment-skipped",
    "warning",
    "Fulfillment bị skip",
    "Binance Pay fulfill bị bỏ qua do trạng thái đơn hoặc stock. Kiểm tra lý do trong structured logs.",
    "fulfillmentSkipped",
    "lastFulfillmentSkippedAt"
  );

  return alerts;
}
