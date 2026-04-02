import type { SupabaseClient } from "@supabase/supabase-js";

type RpcObject = Record<string, unknown> | null;

export type DashboardStats = {
  users: number;
  orders: number;
  revenue: number;
};

export type DashboardCheckerState = "healthy" | "warning" | "error" | "unknown";

export type DashboardCheckerHealth = {
  state: DashboardCheckerState;
  heartbeatAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  mode: string | null;
  intervalSeconds: number;
  sleepSeconds: number;
  lastDurationMs: number | null;
  runtime: string | null;
  outboxPending: number;
  outboxSending: number;
  outboxFailed: number;
  outboxAvailable: boolean;
};

export type DashboardOrderRow = {
  id: number;
  user_id: number;
  username: string | null;
  display_name: string | null;
  product_id: number;
  product_name: string;
  price: number;
  quantity: number;
  created_at: string;
};

export type DashboardSnapshot = {
  stats: DashboardStats;
  pendingDeposits: number;
  pendingWithdrawals: number;
  checkerHealth: DashboardCheckerHealth;
  orders: DashboardOrderRow[];
};

export type RevenueStats = {
  current: number;
  previous: number;
  deltaAmount: number;
  deltaPercent: number;
};

export type OrderOpsStats = {
  orderCount: number;
  averageOrderValue: number;
  averageQuantity: number;
};

export type DirectOrderStats = {
  total: number;
  confirmed: number;
  failed: number;
  cancelled: number;
  pending: number;
  pendingExpired: number;
  confirmedRate: number;
  failedRate: number;
};

export type DailyTrendRow = {
  dateKey: string;
  label: string;
  orders: number;
  revenue: number;
};

export type TopProductRow = {
  productId: string;
  productName: string;
  orders: number;
  quantity: number;
  revenue: number;
};

export type ReportsSnapshot = {
  period: ReportsPeriod;
  periodLabel: string;
  comparisonLabel: string;
  hasComparison: boolean;
  selectedMonth: string | null;
  comparisonMonth: string | null;
  revenue: RevenueStats;
  orderOps: OrderOpsStats;
  directOrderStats: DirectOrderStats;
  dailyTrend: DailyTrendRow[];
  topProducts: TopProductRow[];
};

export type UserSnapshotRow = {
  user_id: number;
  username: string | null;
  display_name: string | null;
  balance: number;
  balance_usdt: number;
  language: string | null;
  created_at: string | null;
  order_count: number;
  total_paid: number;
};

export type UsersSnapshot = {
  users: UserSnapshotRow[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
};

export type UsersFilterMode = "all" | "with_revenue" | "without_revenue" | "with_orders";

export type UsersSortMode =
  | "newest"
  | "oldest"
  | "username_asc"
  | "username_desc"
  | "revenue_desc"
  | "revenue_asc"
  | "order_count_desc"
  | "order_count_asc";

export type UserOrderHistoryRow = {
  id: number;
  user_id: number;
  product_id: number;
  product_name: string;
  price: number;
  quantity: number;
  created_at: string;
  content: string | null;
};

export type UserOrdersSnapshot = {
  user_id: number;
  orderCount: number;
  totalPaid: number;
  orders: UserOrderHistoryRow[];
};

export type ReportsPeriod = "today" | "month" | "quarter" | "custom_month" | "all_time";

export type ReportsSnapshotParams = {
  period?: ReportsPeriod;
  month?: string | null;
  compareMonth?: string | null;
};

type OrderMetricRow = {
  product_id: number | string | null;
  price: number | null;
  quantity: number | null;
  created_at: string | null;
};

type DirectOrderMetricRow = {
  status: string | null;
  created_at: string | null;
};

type BaseUserRow = Record<string, unknown>;

type UserProfileSummary = {
  username: string | null;
  display_name: string | null;
};

const TZ = "Asia/Ho_Chi_Minh";
const HO_CHI_MINH_OFFSET_MS = 7 * 60 * 60 * 1000;
const MONTH_KEY_PATTERN = /^(\d{4})-(\d{2})$/;
const CHECKER_HEALTH_SETTING_KEY = "bot_checker_health";

const normalizeRpcData = (data: unknown): RpcObject => {
  if (Array.isArray(data)) {
    return (data[0] as RpcObject | undefined) ?? null;
  }
  return (data as RpcObject) ?? null;
};

const isMissingRpcError = (message: string) => {
  const lowered = message.toLowerCase();
  return (
    lowered.includes("could not find the function") ||
    lowered.includes("schema cache") ||
    lowered.includes("pgrst202")
  );
};

const isMissingRelationError = (message: string) => {
  const lowered = message.toLowerCase();
  return (
    (lowered.includes("relation") && lowered.includes("does not exist")) ||
    lowered.includes("could not find the table") ||
    lowered.includes("schema cache")
  );
};

const toNumber = (value: unknown, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const toOptionalString = (value: unknown) => {
  if (value == null) return null;
  const text = String(value);
  return text.trim() ? text : null;
};

const buildDisplayName = (firstName: unknown, lastName: unknown) => {
  const parts = [toOptionalString(firstName), toOptionalString(lastName)].filter(Boolean) as string[];
  if (!parts.length) return null;
  return parts.join(" ");
};

const normalizeUsersFilterMode = (value: unknown): UsersFilterMode => {
  switch (String(value || "").trim().toLowerCase()) {
    case "with_revenue":
      return "with_revenue";
    case "without_revenue":
      return "without_revenue";
    case "with_orders":
      return "with_orders";
    default:
      return "all";
  }
};

const normalizeUsersSortMode = (value: unknown): UsersSortMode => {
  switch (String(value || "").trim().toLowerCase()) {
    case "oldest":
      return "oldest";
    case "username_asc":
      return "username_asc";
    case "username_desc":
      return "username_desc";
    case "revenue_desc":
      return "revenue_desc";
    case "revenue_asc":
      return "revenue_asc";
    case "order_count_desc":
      return "order_count_desc";
    case "order_count_asc":
      return "order_count_asc";
    default:
      return "newest";
  }
};

const matchesUserSearch = (row: BaseUserRow, search: string) => {
  const keyword = search.trim().toLowerCase();
  if (!keyword) return true;

  const keywordNoAt = keyword.replace(/^@/, "");
  const userIdText = String(row.user_id ?? "");
  const username = (toOptionalString(row.username) || "").toLowerCase();
  const usernameNoAt = username.replace(/^@/, "");
  const displayName = (buildDisplayName(row.first_name, row.last_name) || "").toLowerCase();

  return (
    userIdText.includes(keywordNoAt) ||
    username.includes(keyword) ||
    usernameNoAt.includes(keywordNoAt) ||
    displayName.includes(keyword)
  );
};

const toDateSortValue = (value: string | null | undefined) => {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const compareOptionalText = (left: string | null | undefined, right: string | null | undefined, direction: 1 | -1) => {
  const leftText = (left || "").trim().toLocaleLowerCase("vi");
  const rightText = (right || "").trim().toLocaleLowerCase("vi");

  if (!leftText && !rightText) return 0;
  if (!leftText) return 1;
  if (!rightText) return -1;

  return leftText.localeCompare(rightText, "vi", { sensitivity: "base" }) * direction;
};

const compareUserRows = (left: UserSnapshotRow, right: UserSnapshotRow, sortMode: UsersSortMode) => {
  const newestFallback = () => {
    const createdDelta = toDateSortValue(right.created_at) - toDateSortValue(left.created_at);
    if (createdDelta !== 0) return createdDelta;
    return right.user_id - left.user_id;
  };

  switch (sortMode) {
    case "oldest": {
      const createdDelta = toDateSortValue(left.created_at) - toDateSortValue(right.created_at);
      if (createdDelta !== 0) return createdDelta;
      return left.user_id - right.user_id;
    }
    case "username_asc": {
      const nameDelta = compareOptionalText(left.username, right.username, 1);
      return nameDelta !== 0 ? nameDelta : newestFallback();
    }
    case "username_desc": {
      const nameDelta = compareOptionalText(left.username, right.username, -1);
      return nameDelta !== 0 ? nameDelta : newestFallback();
    }
    case "revenue_desc": {
      const revenueDelta = right.total_paid - left.total_paid;
      return revenueDelta !== 0 ? revenueDelta : newestFallback();
    }
    case "revenue_asc": {
      const revenueDelta = left.total_paid - right.total_paid;
      return revenueDelta !== 0 ? revenueDelta : newestFallback();
    }
    case "order_count_desc": {
      const orderDelta = right.order_count - left.order_count;
      return orderDelta !== 0 ? orderDelta : newestFallback();
    }
    case "order_count_asc": {
      const orderDelta = left.order_count - right.order_count;
      return orderDelta !== 0 ? orderDelta : newestFallback();
    }
    default:
      return newestFallback();
  }
};

const toObjectArray = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object") : [];

const createDefaultCheckerHealth = (): DashboardCheckerHealth => ({
  state: "unknown",
  heartbeatAt: null,
  lastSuccessAt: null,
  lastError: null,
  mode: null,
  intervalSeconds: 30,
  sleepSeconds: 30,
  lastDurationMs: null,
  runtime: null,
  outboxPending: 0,
  outboxSending: 0,
  outboxFailed: 0,
  outboxAvailable: false
});

const computeCheckerState = (
  heartbeatAt: string | null,
  intervalSeconds: number,
  lastError: string | null
): DashboardCheckerState => {
  if (!heartbeatAt) {
    return lastError ? "error" : "unknown";
  }
  const heartbeatTime = new Date(heartbeatAt).getTime();
  if (!Number.isFinite(heartbeatTime)) {
    return lastError ? "error" : "unknown";
  }
  const staleAfterMs = Math.max(30_000, Math.max(1, intervalSeconds) * 3 * 1000 + 20_000);
  if (Date.now() - heartbeatTime > staleAfterMs) {
    return "error";
  }
  if (lastError) {
    return "warning";
  }
  return "healthy";
};

const parseCheckerHealthSetting = (rawValue: unknown) => {
  const text = toOptionalString(rawValue);
  if (!text) {
    return {} as Record<string, unknown>;
  }
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};

async function loadDashboardCheckerHealth(supabase: SupabaseClient): Promise<DashboardCheckerHealth> {
  const base = createDefaultCheckerHealth();

  const [{ data: settingData, error: settingError }, pendingRes, sendingRes, failedRes] = await Promise.all([
    supabase.from("settings").select("value").eq("key", CHECKER_HEALTH_SETTING_KEY).maybeSingle(),
    supabase.from("bot_delivery_outbox").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("bot_delivery_outbox").select("id", { count: "exact", head: true }).eq("status", "sending"),
    supabase.from("bot_delivery_outbox").select("id", { count: "exact", head: true }).eq("status", "failed")
  ]);

  if (settingError) {
    throw new Error(settingError.message || "Không thể tải trạng thái checker.");
  }

  const outboxErrors = [pendingRes.error, sendingRes.error, failedRes.error].filter(Boolean);
  const outboxMissing = outboxErrors.every((error) => isMissingRelationError(error?.message || ""));
  if (outboxErrors.length && !outboxMissing) {
    throw new Error(outboxErrors[0]?.message || "Không thể tải trạng thái outbox.");
  }

  const rawHealth = parseCheckerHealthSetting(settingData?.value);
  const heartbeatAt = toOptionalString(rawHealth.heartbeatAt);
  const lastSuccessAt = toOptionalString(rawHealth.lastSuccessAt);
  const lastError = toOptionalString(rawHealth.lastError);
  const intervalSeconds = Math.max(1, toNumber(rawHealth.intervalSeconds, 30));
  const sleepSeconds = Math.max(1, toNumber(rawHealth.sleepSeconds, intervalSeconds));

  return {
    state: computeCheckerState(heartbeatAt, intervalSeconds, lastError),
    heartbeatAt,
    lastSuccessAt,
    lastError,
    mode: toOptionalString(rawHealth.mode),
    intervalSeconds,
    sleepSeconds,
    lastDurationMs: rawHealth.lastDurationMs == null ? null : toNumber(rawHealth.lastDurationMs),
    runtime: toOptionalString(rawHealth.runtime),
    outboxPending: outboxMissing ? 0 : pendingRes.count ?? 0,
    outboxSending: outboxMissing ? 0 : sendingRes.count ?? 0,
    outboxFailed: outboxMissing ? 0 : failedRes.count ?? 0,
    outboxAvailable: !outboxMissing
  };
};

const calcDeltaPercent = (current: number, previous: number) => {
  if (previous <= 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
};

const toHoChiMinhDate = (value: Date) => new Date(value.getTime() + HO_CHI_MINH_OFFSET_MS);

const getHoChiMinhParts = (value: Date) => {
  const zoned = toHoChiMinhDate(value);
  return {
    year: zoned.getUTCFullYear(),
    month: zoned.getUTCMonth() + 1,
    day: zoned.getUTCDate()
  };
};

const hoChiMinhDateToUtc = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month - 1, day) - HO_CHI_MINH_OFFSET_MS);

const addHoChiMinhDays = (value: Date, amount: number) => {
  const zoned = toHoChiMinhDate(value);
  zoned.setUTCDate(zoned.getUTCDate() + amount);
  return new Date(zoned.getTime() - HO_CHI_MINH_OFFSET_MS);
};

const startOfHoChiMinhDay = (value: Date) => {
  const { year, month, day } = getHoChiMinhParts(value);
  return hoChiMinhDateToUtc(year, month, day);
};

const startOfHoChiMinhMonth = (value: Date) => {
  const { year, month } = getHoChiMinhParts(value);
  return hoChiMinhDateToUtc(year, month, 1);
};

const startOfHoChiMinhQuarter = (value: Date) => {
  const { year, month } = getHoChiMinhParts(value);
  const quarterStartMonth = Math.floor((month - 1) / 3) * 3 + 1;
  return hoChiMinhDateToUtc(year, quarterStartMonth, 1);
};

const formatMonthLabel = (value: Date) => {
  const { year, month } = getHoChiMinhParts(value);
  return `Tháng ${month}/${year}`;
};

const formatQuarterLabel = (value: Date) => {
  const { year, month } = getHoChiMinhParts(value);
  const quarter = Math.floor((month - 1) / 3) + 1;
  return `Quý ${quarter}/${year}`;
};

const formatTodayLabel = () => "Hôm nay";
const formatAllTimeLabel = () => "Từ trước đến nay";

type MonthKeyParts = {
  year: number;
  month: number;
  key: string;
};

type PeriodWindow = {
  start: Date;
  end: Date;
  label: string;
  monthKey: string | null;
};

type PeriodRange = {
  period: ReportsPeriod;
  periodLabel: string;
  comparisonLabel: string;
  selectedMonth: string | null;
  comparisonMonth: string | null;
  current: PeriodWindow;
  comparison: PeriodWindow;
};

const formatMonthKey = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;

const parseMonthKey = (value: string | null | undefined): MonthKeyParts | null => {
  const match = MONTH_KEY_PATTERN.exec((value || "").trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }

  return {
    year,
    month,
    key: formatMonthKey(year, month)
  };
};

const getCurrentMonthKeyParts = (value: Date): MonthKeyParts => {
  const { year, month } = getHoChiMinhParts(value);
  return {
    year,
    month,
    key: formatMonthKey(year, month)
  };
};

const shiftMonthKey = (value: MonthKeyParts, delta: number): MonthKeyParts => {
  const shifted = new Date(Date.UTC(value.year, value.month - 1 + delta, 1));
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth() + 1;
  return {
    year,
    month,
    key: formatMonthKey(year, month)
  };
};

const createMonthWindow = (value: MonthKeyParts, now: Date): PeriodWindow => {
  const start = hoChiMinhDateToUtc(value.year, value.month, 1);
  const nextStart =
    value.month === 12
      ? hoChiMinhDateToUtc(value.year + 1, 1, 1)
      : hoChiMinhDateToUtc(value.year, value.month + 1, 1);
  const endCandidate = new Date(nextStart.getTime() - 1);
  const end =
    start.getTime() > now.getTime()
      ? new Date(start.getTime() - 1)
      : endCandidate.getTime() > now.getTime()
        ? now
        : endCandidate;

  return {
    start,
    end,
    label: `Tháng ${value.month}/${value.year}`,
    monthKey: value.key
  };
};

const createRange = (
  period: ReportsPeriod,
  current: PeriodWindow,
  comparison: PeriodWindow
): PeriodRange => ({
  period,
  periodLabel: current.label,
  comparisonLabel: comparison.label,
  selectedMonth: current.monthKey,
  comparisonMonth: comparison.monthKey,
  current,
  comparison
});

const getReportsPeriodRange = (
  period: ReportsPeriod,
  now: Date,
  requestedMonth?: string | null,
  requestedCompareMonth?: string | null
): PeriodRange => {
  if (period === "today") {
    const currentStart = startOfHoChiMinhDay(now);
    return createRange(
      period,
      {
        start: currentStart,
        end: now,
        label: formatTodayLabel(),
        monthKey: null
      },
      {
        start: addHoChiMinhDays(currentStart, -1),
        end: new Date(currentStart.getTime() - 1),
        label: "Hôm qua",
        monthKey: null
      }
    );
  }

  if (period === "quarter") {
    const currentStart = startOfHoChiMinhQuarter(now);
    const previousQuarterEnd = new Date(currentStart.getTime() - 1);
    return createRange(
      period,
      {
        start: currentStart,
        end: now,
        label: formatQuarterLabel(now),
        monthKey: null
      },
      {
        start: startOfHoChiMinhQuarter(previousQuarterEnd),
        end: previousQuarterEnd,
        label: formatQuarterLabel(previousQuarterEnd),
        monthKey: null
      }
    );
  }

  if (period === "custom_month") {
    const selectedMonth = parseMonthKey(requestedMonth) ?? getCurrentMonthKeyParts(now);
    const compareMonth = parseMonthKey(requestedCompareMonth) ?? shiftMonthKey(selectedMonth, -1);
    return createRange(
      period,
      createMonthWindow(selectedMonth, now),
      createMonthWindow(compareMonth, now)
    );
  }

  const currentMonth = getCurrentMonthKeyParts(now);
  return createRange(
    "month",
    createMonthWindow(currentMonth, now),
    createMonthWindow(shiftMonthKey(currentMonth, -1), now)
  );
};

const normalizeDashboardSnapshot = (data: RpcObject): DashboardSnapshot => {
  const stats = (data?.stats as Record<string, unknown> | undefined) ?? {};
  return {
    stats: {
      users: toNumber(stats.users),
      orders: toNumber(stats.orders),
      revenue: toNumber(stats.revenue)
    },
    pendingDeposits: toNumber(data?.pendingDeposits),
    pendingWithdrawals: toNumber(data?.pendingWithdrawals),
    checkerHealth: createDefaultCheckerHealth(),
    orders: toObjectArray(data?.orders).map((row) => ({
      id: toNumber(row.id),
      user_id: toNumber(row.user_id),
      username: toOptionalString(row.username),
      display_name: toOptionalString(row.display_name),
      product_id: toNumber(row.product_id),
      product_name: String(row.product_name || `#${toNumber(row.product_id)}`),
      price: toNumber(row.price),
      quantity: toNumber(row.quantity),
      created_at: String(row.created_at || "")
    }))
  };
};

const normalizeReportsSnapshot = (data: RpcObject): ReportsSnapshot => {
  const revenue = (data?.revenue as Record<string, unknown> | undefined) ?? {};
  const orderOps = (data?.orderOps as Record<string, unknown> | undefined) ?? {};
  const directOrderStats = (data?.directOrderStats as Record<string, unknown> | undefined) ?? {};

  return {
    period: (toOptionalString(data?.period) as ReportsPeriod | null) ?? "month",
    periodLabel: String(data?.periodLabel || ""),
    comparisonLabel: String(data?.comparisonLabel || ""),
    hasComparison: Boolean(data?.hasComparison),
    selectedMonth: toOptionalString(data?.selectedMonth),
    comparisonMonth: toOptionalString(data?.comparisonMonth),
    revenue: {
      current: toNumber(revenue.current),
      previous: toNumber(revenue.previous),
      deltaAmount: toNumber(revenue.deltaAmount),
      deltaPercent: toNumber(revenue.deltaPercent)
    },
    orderOps: {
      orderCount: toNumber(orderOps.orderCount),
      averageOrderValue: toNumber(orderOps.averageOrderValue),
      averageQuantity: toNumber(orderOps.averageQuantity)
    },
    directOrderStats: {
      total: toNumber(directOrderStats.total),
      confirmed: toNumber(directOrderStats.confirmed),
      failed: toNumber(directOrderStats.failed),
      cancelled: toNumber(directOrderStats.cancelled),
      pending: toNumber(directOrderStats.pending),
      pendingExpired: toNumber(directOrderStats.pendingExpired),
      confirmedRate: toNumber(directOrderStats.confirmedRate),
      failedRate: toNumber(directOrderStats.failedRate)
    },
    dailyTrend: toObjectArray(data?.dailyTrend).map((row) => ({
      dateKey: String(row.dateKey || ""),
      label: String(row.label || ""),
      orders: toNumber(row.orders),
      revenue: toNumber(row.revenue)
    })),
    topProducts: toObjectArray(data?.topProducts).map((row) => ({
      productId: String(row.productId || "-"),
      productName: String(row.productName || `#${String(row.productId || "-")}`),
      orders: toNumber(row.orders),
      quantity: toNumber(row.quantity),
      revenue: toNumber(row.revenue)
    }))
  };
};

const normalizeUsersSnapshot = (data: RpcObject): UsersSnapshot => ({
  users: toObjectArray(data?.users).map((row) => ({
    user_id: toNumber(row.user_id),
    username: toOptionalString(row.username),
    display_name: toOptionalString(row.display_name),
    balance: toNumber(row.balance),
    balance_usdt: toNumber(row.balance_usdt),
    language: toOptionalString(row.language),
    created_at: toOptionalString(row.created_at),
    order_count: toNumber(row.order_count),
    total_paid: toNumber(row.total_paid)
  })),
  page: toNumber(data?.page, 1),
  pageSize: toNumber(data?.pageSize, 50),
  totalCount: toNumber(data?.totalCount),
  totalPages: toNumber(data?.totalPages, 1)
});

const normalizeUserOrdersSnapshot = (data: RpcObject): UserOrdersSnapshot => ({
  user_id: toNumber(data?.user_id),
  orderCount: toNumber(data?.orderCount),
  totalPaid: toNumber(data?.totalPaid),
  orders: toObjectArray(data?.orders).map((row) => ({
    id: toNumber(row.id),
    user_id: toNumber(row.user_id),
    product_id: toNumber(row.product_id),
    product_name: String(row.product_name || `#${toNumber(row.product_id)}`),
    price: toNumber(row.price),
    quantity: toNumber(row.quantity),
    created_at: String(row.created_at || ""),
    content: toOptionalString(row.content)
  }))
});

const toDateKey = (value: Date | string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(typeof value === "string" ? new Date(value) : value);

const toShortDateLabel = (value: Date) =>
  new Intl.DateTimeFormat("vi-VN", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit"
  }).format(value);

const toMonthKey = (value: Date | string) => {
  const date = typeof value === "string" ? new Date(value) : value;
  const { year, month } = getHoChiMinhParts(date);
  return formatMonthKey(year, month);
};

const toMonthLabel = (value: Date | string) => {
  const date = typeof value === "string" ? new Date(value) : value;
  const { year, month } = getHoChiMinhParts(date);
  return `${String(month).padStart(2, "0")}/${year}`;
};

const buildUserProfileSummary = (row: Record<string, unknown>): UserProfileSummary => ({
  username: toOptionalString(row.username),
  display_name: buildDisplayName(row.first_name, row.last_name)
});

async function loadUserProfilesByIds(
  supabase: SupabaseClient,
  userIds: number[]
): Promise<Map<string, UserProfileSummary>> {
  const uniqueIds = Array.from(new Set(userIds.filter((userId) => Number.isFinite(userId))));
  if (!uniqueIds.length) {
    return new Map();
  }

  const { data, error } = await supabase.from("users").select("*").in("user_id", uniqueIds);
  if (error) {
    throw new Error(error.message || "Không thể tải hồ sơ user.");
  }

  const map = new Map<string, UserProfileSummary>();
  for (const row of (data as Array<Record<string, unknown>>) ?? []) {
    map.set(String(row.user_id), buildUserProfileSummary(row));
  }
  return map;
}

async function loadDashboardFallback(supabase: SupabaseClient): Promise<DashboardSnapshot> {
  const [{ data: statsData }, ordersRes, depositsRes, withdrawalsRes] = await Promise.all([
    supabase.rpc("get_stats"),
    supabase
      .from("orders")
      .select("id, user_id, product_id, price, quantity, created_at")
      .order("created_at", { ascending: false })
      .limit(6),
    supabase.from("deposits").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("withdrawals").select("id", { count: "exact", head: true }).eq("status", "pending")
  ]);

  if (ordersRes.error) {
    throw new Error(ordersRes.error.message || "Không thể tải đơn hàng gần nhất.");
  }

  const statsRow = Array.isArray(statsData) ? statsData[0] : statsData;
  const orderRows = (ordersRes.data as Array<Record<string, unknown>>) || [];
  const userIds = Array.from(
    new Set(orderRows.map((row) => toNumber(row.user_id)).filter((value) => value > 0))
  );
  const productIds = Array.from(new Set(orderRows.map((row) => row.product_id).filter(Boolean)));

  const [userProfilesById, productsRes] = await Promise.all([
    loadUserProfilesByIds(supabase, userIds),
    productIds.length
      ? supabase.from("products").select("id, name").in("id", productIds)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>>, error: null })
  ]);

  const productNamesById = new Map<string, string>();
  for (const product of productsRes.data ?? []) {
    productNamesById.set(String(product.id), String(product.name || `#${String(product.id)}`));
  }

  return {
    stats: {
      users: toNumber((statsRow as Record<string, unknown> | null)?.users),
      orders: toNumber((statsRow as Record<string, unknown> | null)?.orders),
      revenue: toNumber((statsRow as Record<string, unknown> | null)?.revenue)
    },
    pendingDeposits: depositsRes.count ?? 0,
    pendingWithdrawals: withdrawalsRes.count ?? 0,
    checkerHealth: createDefaultCheckerHealth(),
    orders: orderRows.map((row) => ({
      id: toNumber(row.id),
      user_id: toNumber(row.user_id),
      username: userProfilesById.get(String(row.user_id))?.username ?? null,
      display_name: userProfilesById.get(String(row.user_id))?.display_name ?? null,
      product_id: toNumber(row.product_id),
      product_name: productNamesById.get(String(row.product_id)) || `#${String(row.product_id || "-")}`,
      price: toNumber(row.price),
      quantity: toNumber(row.quantity),
      created_at: String(row.created_at || "")
    }))
  };
}

async function loadReportsSnapshot(
  supabase: SupabaseClient,
  params: ReportsSnapshotParams
): Promise<ReportsSnapshot> {
  const now = new Date();
  const period = params.period ?? "month";

  if (period === "all_time") {
    const pendingExpiredBefore = new Date(now.getTime() - 10 * 60 * 1000);
    const [ordersRes, directOrdersRes] = await Promise.all([
      supabase
        .from("orders")
        .select("product_id, price, quantity, created_at")
        .lte("created_at", now.toISOString())
        .order("created_at", { ascending: true }),
      supabase.from("direct_orders").select("status, created_at").lte("created_at", now.toISOString())
    ]);

    if (ordersRes.error) {
      throw new Error(ordersRes.error.message || "Không thể tải dữ liệu báo cáo.");
    }
    if (directOrdersRes.error) {
      throw new Error(directOrdersRes.error.message || "Không thể tải dữ liệu direct order.");
    }

    const orderRows = (ordersRes.data as OrderMetricRow[]) || [];
    const directOrderRows = (directOrdersRes.data as DirectOrderMetricRow[]) || [];

    let currentRevenue = 0;
    let currentOrderCount = 0;
    let currentQuantity = 0;
    let confirmed = 0;
    let failed = 0;
    let cancelled = 0;
    let pending = 0;
    let pendingExpired = 0;

    const trendSeed = new Map<string, DailyTrendRow>();
    const topByProduct = new Map<
      string,
      { productId: string; orders: number; quantity: number; revenue: number }
    >();

    for (const row of orderRows) {
      if (!row.created_at) continue;
      const created = new Date(row.created_at);
      if (Number.isNaN(created.getTime())) continue;

      const price = toNumber(row.price);
      const quantity = toNumber(row.quantity);
      currentRevenue += price;
      currentOrderCount += 1;
      currentQuantity += quantity;

      const monthKey = toMonthKey(created);
      const monthRow = trendSeed.get(monthKey) || {
        dateKey: monthKey,
        label: toMonthLabel(created),
        orders: 0,
        revenue: 0
      };
      monthRow.orders += 1;
      monthRow.revenue += price;
      trendSeed.set(monthKey, monthRow);

      const productId = row.product_id != null ? String(row.product_id) : "-";
      const current = topByProduct.get(productId) || {
        productId,
        orders: 0,
        quantity: 0,
        revenue: 0
      };
      current.orders += 1;
      current.quantity += quantity;
      current.revenue += price;
      topByProduct.set(productId, current);
    }

    for (const row of directOrderRows) {
      const status = (row.status || "").toLowerCase();
      if (status === "confirmed") confirmed += 1;
      else if (status === "failed") failed += 1;
      else if (status === "cancelled") cancelled += 1;
      else if (status === "pending") {
        pending += 1;
        if (row.created_at) {
          const created = new Date(row.created_at);
          if (!Number.isNaN(created.getTime()) && created < pendingExpiredBefore) {
            pendingExpired += 1;
          }
        }
      }
    }

    const total = directOrderRows.length;
    const processed = confirmed + failed + cancelled;
    const failedOverall = failed + cancelled;
    const sortedTop = Array.from(topByProduct.values())
      .sort((a, b) => {
        if (b.revenue !== a.revenue) return b.revenue - a.revenue;
        if (b.quantity !== a.quantity) return b.quantity - a.quantity;
        return b.orders - a.orders;
      })
      .slice(0, 8);

    const topIds = sortedTop.map((row) => row.productId).filter((id) => id !== "-");
    const productNamesById: Record<string, string> = {};
    if (topIds.length) {
      const { data: productRows } = await supabase.from("products").select("id, name").in("id", topIds);
      for (const product of productRows ?? []) {
        const id = (product as { id: number | string }).id;
        const name = (product as { name: string }).name;
        if (id != null) {
          productNamesById[String(id)] = name;
        }
      }
    }

    return {
      period,
      periodLabel: formatAllTimeLabel(),
      comparisonLabel: "",
      hasComparison: false,
      selectedMonth: null,
      comparisonMonth: null,
      revenue: {
        current: currentRevenue,
        previous: 0,
        deltaAmount: 0,
        deltaPercent: 0
      },
      orderOps: {
        orderCount: currentOrderCount,
        averageOrderValue: currentOrderCount > 0 ? currentRevenue / currentOrderCount : 0,
        averageQuantity: currentOrderCount > 0 ? currentQuantity / currentOrderCount : 0
      },
      directOrderStats: {
        total,
        confirmed,
        failed,
        cancelled,
        pending,
        pendingExpired,
        confirmedRate: processed > 0 ? (confirmed / processed) * 100 : 0,
        failedRate: processed > 0 ? (failedOverall / processed) * 100 : 0
      },
      dailyTrend: Array.from(trendSeed.values()).sort((a, b) => a.dateKey.localeCompare(b.dateKey)),
      topProducts: sortedTop.map((row) => ({
        productId: row.productId,
        productName: productNamesById[row.productId] || `#${row.productId}`,
        orders: row.orders,
        quantity: row.quantity,
        revenue: row.revenue
      }))
    };
  }

  const range = getReportsPeriodRange(period, now, params.month, params.compareMonth);
  const pendingExpiredBefore = new Date(now.getTime() - 10 * 60 * 1000);
  const currentWindowValid = range.current.end.getTime() >= range.current.start.getTime();
  const comparisonWindowValid = range.comparison.end.getTime() >= range.comparison.start.getTime();

  let orderRows: OrderMetricRow[] = [];
  if (currentWindowValid || comparisonWindowValid) {
    const orderRangeStart =
      !comparisonWindowValid || range.current.start.getTime() <= range.comparison.start.getTime()
        ? range.current.start
        : range.comparison.start;
    const orderRangeEnd =
      !comparisonWindowValid || range.current.end.getTime() >= range.comparison.end.getTime()
        ? range.current.end
        : range.comparison.end;

    const { data, error } = await supabase
      .from("orders")
      .select("product_id, price, quantity, created_at")
      .gte("created_at", orderRangeStart.toISOString())
      .lte("created_at", orderRangeEnd.toISOString())
      .order("created_at", { ascending: true });

    if (error) {
      throw new Error(error.message || "Không thể tải dữ liệu báo cáo.");
    }

    orderRows = (data as OrderMetricRow[]) || [];
  }

  const { data: directOrdersData, error: directOrdersError } = await supabase
    .from("direct_orders")
    .select("status, created_at")
    .gte("created_at", range.current.start.toISOString())
    .lte("created_at", range.current.end.toISOString());

  if (directOrdersError) {
    throw new Error(directOrdersError.message || "Không thể tải dữ liệu direct order.");
  }

  const directOrderRows = (directOrdersData as DirectOrderMetricRow[]) || [];

  const isInCurrentWindow = (value: Date) =>
    currentWindowValid &&
    value.getTime() >= range.current.start.getTime() &&
    value.getTime() <= range.current.end.getTime();

  const isInComparisonWindow = (value: Date) =>
    comparisonWindowValid &&
    value.getTime() >= range.comparison.start.getTime() &&
    value.getTime() <= range.comparison.end.getTime();

  const trendSeed = new Map<string, DailyTrendRow>();
  if (currentWindowValid) {
    for (
      let cursor = new Date(range.current.start);
      cursor <= range.current.end;
      cursor = addHoChiMinhDays(cursor, 1)
    ) {
      const key = toDateKey(cursor);
      trendSeed.set(key, {
        dateKey: key,
        label: toShortDateLabel(cursor),
        orders: 0,
        revenue: 0
      });
    }
  }

  let currentRevenue = 0;
  let previousRevenue = 0;
  let currentOrderCount = 0;
  let currentQuantity = 0;

  const topByProduct = new Map<
    string,
    { productId: string; orders: number; quantity: number; revenue: number }
  >();

  for (const row of orderRows) {
    if (!row.created_at) continue;
    const created = new Date(row.created_at);
    if (Number.isNaN(created.getTime())) continue;

    const price = toNumber(row.price);
    const quantity = toNumber(row.quantity);

    if (isInCurrentWindow(created)) {
      currentRevenue += price;
      currentOrderCount += 1;
      currentQuantity += quantity;

      const trendKey = toDateKey(created);
      const trendRow = trendSeed.get(trendKey);
      if (trendRow) {
        trendRow.orders += 1;
        trendRow.revenue += price;
      }

      const productId = row.product_id != null ? String(row.product_id) : "-";
      const current = topByProduct.get(productId) || {
        productId,
        orders: 0,
        quantity: 0,
        revenue: 0
      };
      current.orders += 1;
      current.quantity += quantity;
      current.revenue += price;
      topByProduct.set(productId, current);
    }

    if (isInComparisonWindow(created)) {
      previousRevenue += price;
    }
  }

  let confirmed = 0;
  let failed = 0;
  let cancelled = 0;
  let pending = 0;
  let pendingExpired = 0;

  for (const row of directOrderRows) {
    const status = (row.status || "").toLowerCase();
    if (status === "confirmed") confirmed += 1;
    else if (status === "failed") failed += 1;
    else if (status === "cancelled") cancelled += 1;
    else if (status === "pending") {
      pending += 1;
      if (row.created_at) {
        const created = new Date(row.created_at);
        if (!Number.isNaN(created.getTime()) && created < pendingExpiredBefore) {
          pendingExpired += 1;
        }
      }
    }
  }

  const total = directOrderRows.length;
  const processed = confirmed + failed + cancelled;
  const failedOverall = failed + cancelled;

  const sortedTop = Array.from(topByProduct.values())
    .sort((a, b) => {
      if (b.revenue !== a.revenue) return b.revenue - a.revenue;
      if (b.quantity !== a.quantity) return b.quantity - a.quantity;
      return b.orders - a.orders;
    })
    .slice(0, 8);

  const topIds = sortedTop.map((row) => row.productId).filter((id) => id !== "-");
  const productNamesById: Record<string, string> = {};
  if (topIds.length) {
    const { data: productRows } = await supabase.from("products").select("id, name").in("id", topIds);
    for (const product of productRows ?? []) {
      const id = (product as { id: number | string }).id;
      const name = (product as { name: string }).name;
      if (id != null) {
        productNamesById[String(id)] = name;
      }
    }
  }

  return {
    period,
    periodLabel: range.periodLabel,
    comparisonLabel: range.comparisonLabel,
    hasComparison: true,
    selectedMonth: range.selectedMonth,
    comparisonMonth: range.comparisonMonth,
    revenue: {
      current: currentRevenue,
      previous: previousRevenue,
      deltaAmount: currentRevenue - previousRevenue,
      deltaPercent: calcDeltaPercent(currentRevenue, previousRevenue)
    },
    orderOps: {
      orderCount: currentOrderCount,
      averageOrderValue: currentOrderCount > 0 ? currentRevenue / currentOrderCount : 0,
      averageQuantity: currentOrderCount > 0 ? currentQuantity / currentOrderCount : 0
    },
    directOrderStats: {
      total,
      confirmed,
      failed,
      cancelled,
      pending,
      pendingExpired,
      confirmedRate: processed > 0 ? (confirmed / processed) * 100 : 0,
      failedRate: processed > 0 ? (failedOverall / processed) * 100 : 0
    },
    dailyTrend: Array.from(trendSeed.values()),
    topProducts: sortedTop.map((row) => ({
      productId: row.productId,
      productName: productNamesById[row.productId] || `#${row.productId}`,
      orders: row.orders,
      quantity: row.quantity,
      revenue: row.revenue
    }))
  };
}

async function loadAllUsersLegacy(supabase: SupabaseClient): Promise<BaseUserRow[]> {
  const pageSize = 1000;
  const rows: BaseUserRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("users")
      .select("*")
      .order("created_at", { ascending: false })
      .order("user_id", { ascending: false })
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(error.message || "Không thể tải danh sách user.");
    }

    const chunk = (data as BaseUserRow[]) || [];
    if (!chunk.length) break;
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

async function hydrateUsersWithStats(
  supabase: SupabaseClient,
  users: BaseUserRow[]
): Promise<UserSnapshotRow[]> {
  if (!users.length) {
    return [];
  }

  const userIds = Array.from(
    new Set(users.map((user) => toNumber(user.user_id)).filter((value) => value > 0))
  );
  const statsByUser = new Map<number, { orderCount: number; totalPaid: number }>();
  const chunkSize = 500;

  for (let index = 0; index < userIds.length; index += chunkSize) {
    const idChunk = userIds.slice(index, index + chunkSize);
    const { data: orderData, error: orderError } = await supabase
      .from("orders")
      .select("user_id, price")
      .in("user_id", idChunk);

    if (orderError) {
      throw new Error(orderError.message || "Không thể tải thống kê đơn hàng của user.");
    }

    ((orderData as Array<{ user_id: number; price: number | null }>) || []).forEach((order) => {
      const current = statsByUser.get(order.user_id) || { orderCount: 0, totalPaid: 0 };
      current.orderCount += 1;
      current.totalPaid += Number(order.price || 0);
      statsByUser.set(order.user_id, current);
    });
  }

  return users.map((user) => {
    const userId = toNumber(user.user_id);
    const stats = statsByUser.get(userId);
    return {
      user_id: userId,
      username: toOptionalString(user.username),
      display_name: buildDisplayName(user.first_name, user.last_name),
      balance: toNumber(user.balance),
      balance_usdt: toNumber(user.balance_usdt),
      language: toOptionalString(user.language),
      created_at: toOptionalString(user.created_at),
      order_count: stats?.orderCount ?? 0,
      total_paid: stats?.totalPaid ?? 0
    };
  });
}

async function buildUsersSnapshotFromRows(
  supabase: SupabaseClient,
  pageUsers: BaseUserRow[],
  page: number,
  pageSize: number,
  totalCount: number
): Promise<UsersSnapshot> {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  if (!pageUsers.length) {
    return {
      users: [],
      page,
      pageSize,
      totalCount,
      totalPages
    };
  }

  const hydratedUsers = await hydrateUsersWithStats(supabase, pageUsers);

  return {
    users: hydratedUsers,
    page,
    pageSize,
    totalCount,
    totalPages
  };
}

async function loadUsersPageFallback(
  supabase: SupabaseClient,
  page: number,
  pageSize: number
): Promise<UsersSnapshot> {
  const loadPage = (pageIndex: number) =>
    supabase
      .from("users")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .order("user_id", { ascending: false })
      .range((pageIndex - 1) * pageSize, pageIndex * pageSize - 1);

  const { data, error, count } = await loadPage(page);

  if (error) {
    throw new Error(error.message || "Không thể tải danh sách user.");
  }

  const totalCount = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const safePage = Math.min(page, totalPages);
  let pageData = ((data as BaseUserRow[]) || []).slice(0, pageSize);
  if (safePage !== page && totalCount > 0) {
    const { data: safePageData, error: safePageError } = await loadPage(safePage);
    if (safePageError) {
      throw new Error(safePageError.message || "Không thể tải danh sách user.");
    }
    pageData = ((safePageData as BaseUserRow[]) || []).slice(0, pageSize);
  }

  return buildUsersSnapshotFromRows(supabase, pageData, safePage, pageSize, totalCount);
}

async function loadUsersSearchFallback(
  supabase: SupabaseClient,
  page: number,
  pageSize: number,
  search: string
): Promise<UsersSnapshot> {
  const allUsers = await loadAllUsersLegacy(supabase);
  const filteredUsers = allUsers.filter((row) => matchesUserSearch(row, search));

  const totalCount = filteredUsers.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const safePage = Math.min(page, totalPages);
  const from = (safePage - 1) * pageSize;
  const pageUsers = filteredUsers.slice(from, from + pageSize);

  return buildUsersSnapshotFromRows(supabase, pageUsers, safePage, pageSize, totalCount);
}

async function loadUsersFilteredSortedFallback(
  supabase: SupabaseClient,
  page: number,
  pageSize: number,
  search: string,
  filterMode: UsersFilterMode,
  sortMode: UsersSortMode
): Promise<UsersSnapshot> {
  const allUsers = await loadAllUsersLegacy(supabase);
  const searchedUsers = allUsers.filter((row) => matchesUserSearch(row, search));
  const hydratedUsers = await hydrateUsersWithStats(supabase, searchedUsers);

  const filteredUsers = hydratedUsers.filter((user) => {
    if (filterMode === "with_revenue") {
      return user.total_paid > 0;
    }
    if (filterMode === "without_revenue") {
      return user.total_paid <= 0;
    }
    if (filterMode === "with_orders") {
      return user.order_count > 0;
    }
    return true;
  });

  const sortedUsers = [...filteredUsers].sort((left, right) => compareUserRows(left, right, sortMode));
  const totalCount = sortedUsers.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const safePage = Math.min(page, totalPages);
  const from = (safePage - 1) * pageSize;

  return {
    users: sortedUsers.slice(from, from + pageSize),
    page: safePage,
    pageSize,
    totalCount,
    totalPages
  };
}

type UsersSnapshotParams = {
  page?: number;
  pageSize?: number;
  search?: string;
  filterMode?: UsersFilterMode | string;
  sortMode?: UsersSortMode | string;
};

export async function getUserOrdersSnapshot(
  supabase: SupabaseClient,
  userId: number
): Promise<UserOrdersSnapshot> {
  const safeUserId = Math.trunc(userId);
  if (!Number.isFinite(safeUserId) || safeUserId <= 0) {
    return {
      user_id: safeUserId,
      orderCount: 0,
      totalPaid: 0,
      orders: []
    };
  }

  const { data, error } = await supabase
    .from("orders")
    .select("id, user_id, product_id, price, quantity, created_at, content")
    .eq("user_id", safeUserId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  if (error) {
    throw new Error(error.message || "Không thể tải lịch sử đơn hàng của user.");
  }

  const orders = (data as Array<Record<string, unknown>>) || [];
  if (!orders.length) {
    return {
      user_id: safeUserId,
      orderCount: 0,
      totalPaid: 0,
      orders: []
    };
  }

  const productIds = Array.from(
    new Set(
      orders
        .map((order) => order.product_id)
        .filter((value): value is number | string => value !== null && value !== undefined)
        .map(String)
    )
  );

  const { data: productRows, error: productError } = productIds.length
    ? await supabase.from("products").select("id, name").in("id", productIds)
    : { data: [], error: null };

  if (productError) {
    throw new Error(productError.message || "Không thể tải tên sản phẩm.");
  }

  const productNamesById = new Map<string, string>();
  for (const product of (productRows as Array<Record<string, unknown>>) || []) {
    productNamesById.set(String(product.id), String(product.name || `#${String(product.id || "-")}`));
  }

  return normalizeUserOrdersSnapshot({
    user_id: safeUserId,
    orderCount: orders.length,
    totalPaid: orders.reduce((sum, order) => sum + toNumber(order.price), 0),
    orders: orders.map((order) => ({
      id: toNumber(order.id),
      user_id: safeUserId,
      product_id: toNumber(order.product_id),
      product_name: productNamesById.get(String(order.product_id)) || `#${String(order.product_id || "-")}`,
      price: toNumber(order.price),
      quantity: toNumber(order.quantity),
      created_at: String(order.created_at || ""),
      content: toOptionalString(order.content)
    }))
  });
}

export async function getDashboardSnapshot(supabase: SupabaseClient): Promise<DashboardSnapshot> {
  let snapshot: DashboardSnapshot;
  const { data, error } = await supabase.rpc("admin_bot_dashboard_snapshot", { p_recent_limit: 6 });
  if (error) {
    if (!isMissingRpcError(error.message || "")) {
      throw new Error(error.message || "Không thể tải dashboard snapshot.");
    }
    snapshot = await loadDashboardFallback(supabase);
  } else {
    snapshot = normalizeDashboardSnapshot(normalizeRpcData(data));
  }

  const checkerHealthPromise = loadDashboardCheckerHealth(supabase);

  const missingProfileIds = Array.from(
    new Set(
      snapshot.orders
        .filter((order) => !order.username || !order.display_name)
        .map((order) => order.user_id)
        .filter((userId) => userId > 0)
    )
  );
  if (!missingProfileIds.length) {
    return {
      ...snapshot,
      checkerHealth: await checkerHealthPromise
    };
  }

  const [userProfilesById, checkerHealth] = await Promise.all([
    loadUserProfilesByIds(supabase, missingProfileIds),
    checkerHealthPromise
  ]);

  return {
    ...snapshot,
    checkerHealth,
    orders: snapshot.orders.map((order) => ({
      ...order,
      username: userProfilesById.get(String(order.user_id))?.username ?? order.username ?? null,
      display_name: userProfilesById.get(String(order.user_id))?.display_name ?? order.display_name ?? null
    }))
  };
}

export async function getReportsSnapshot(
  supabase: SupabaseClient,
  params: ReportsSnapshotParams = {}
): Promise<ReportsSnapshot> {
  return loadReportsSnapshot(supabase, params);
}

export async function getUsersSnapshot(
  supabase: SupabaseClient,
  params: UsersSnapshotParams = {}
): Promise<UsersSnapshot> {
  const safePageSize = Math.max(1, Math.min(Math.trunc(params.pageSize || 50) || 50, 200));
  const safePage = Math.max(1, Math.trunc(params.page || 1) || 1);
  const keyword = (params.search || "").trim().toLowerCase();
  const filterMode = normalizeUsersFilterMode(params.filterMode);
  const sortMode = normalizeUsersSortMode(params.sortMode);

  if (filterMode !== "all" || sortMode !== "newest") {
    return loadUsersFilteredSortedFallback(
      supabase,
      safePage,
      safePageSize,
      keyword,
      filterMode,
      sortMode
    );
  }

  const { data, error } = await supabase.rpc("admin_bot_users_snapshot_page", {
    p_page: safePage,
    p_page_size: safePageSize,
    p_search: keyword || null
  });

  if (error) {
    if (!isMissingRpcError(error.message || "")) {
      throw new Error(error.message || "Không thể tải users snapshot.");
    }

    if (!keyword) {
      return loadUsersPageFallback(supabase, safePage, safePageSize);
    }

    return loadUsersSearchFallback(supabase, safePage, safePageSize, keyword);
  }

  return normalizeUsersSnapshot(normalizeRpcData(data));
}
