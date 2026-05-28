"use client";

const STORAGE_KEY = "botAdminApiTimingSamples";
export const ADMIN_API_TIMING_EVENT = "bot-admin-api-timing";

const MAX_SAMPLES = 200;
const ADMIN_API_PREFIXES = [
  "/api/admin",
  "/api/admin-analytics",
  "/api/admin-finance",
  "/api/direct-orders",
  "/api/telegram",
  "/api/licenses",
  "/api/stock/custom-check"
];

export type AdminApiTimingSample = {
  id: string;
  method: string;
  route: string;
  path: string;
  status: number;
  ok: boolean;
  startedAt: string;
  clientDurationMs: number;
  serverTotalMs: number | null;
  routeDurationMs: number | null;
  cache: string | null;
  slow: boolean;
  source: "server" | "client";
};

export type AdminApiTimingRankingRow = {
  route: string;
  method: string;
  count: number;
  errorCount: number;
  slowCount: number;
  avgMs: number;
  maxMs: number;
  lastMs: number;
  serverSampleCount: number;
  lastStatus: number;
  lastAt: string;
  cache: string | null;
};

type ServerTimingMetric = {
  duration: number | null;
  description: string | null;
};

declare global {
  interface Window {
    __botAdminApiTimingInstalled?: boolean;
    __botAdminApiOriginalFetch?: typeof fetch;
  }
}

const roundDuration = (value: number) =>
  Number.isFinite(value) ? Math.max(0, Math.round(value * 10) / 10) : 0;

const parseServerTimingHeader = (header: string | null) => {
  const metrics = new Map<string, ServerTimingMetric>();
  if (!header) return metrics;

  for (const segment of header.split(",")) {
    const parts = segment.split(";").map((part) => part.trim()).filter(Boolean);
    const name = parts.shift();
    if (!name) continue;

    let duration: number | null = null;
    let description: string | null = null;
    for (const part of parts) {
      const [rawKey, ...rawValueParts] = part.split("=");
      const key = rawKey.trim().toLowerCase();
      const value = rawValueParts.join("=").trim().replace(/^"|"$/g, "");
      if (key === "dur") {
        const parsed = Number(value);
        duration = Number.isFinite(parsed) ? parsed : null;
      }
      if (key === "desc") {
        description = value || null;
      }
    }

    metrics.set(name, { duration, description });
  }

  return metrics;
};

const normalizePathForRanking = (path: string) =>
  path
    .replace(/\/\d+(?=\/|$)/g, "/[id]")
    .replace(/\/[0-9a-f]{8,}(?=\/|$)/gi, "/[id]");

const getRequestUrl = (input: RequestInfo | URL) => {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
};

const getRequestMethod = (input: RequestInfo | URL, init?: RequestInit) => {
  if (init?.method) return init.method.toUpperCase();
  if (typeof input === "object" && "method" in input && input.method) {
    return input.method.toUpperCase();
  }
  return "GET";
};

const getTrackableApiUrl = (rawUrl: string) => {
  if (typeof window === "undefined") return null;
  const url = new URL(rawUrl, window.location.href);
  if (url.origin !== window.location.origin) return null;
  if (!ADMIN_API_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    return null;
  }
  return url;
};

const loadSamples = (): AdminApiTimingSample[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as AdminApiTimingSample[] : [];
  } catch {
    return [];
  }
};

const saveSamples = (samples: AdminApiTimingSample[]) => {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(samples.slice(-MAX_SAMPLES)));
  } catch {
    return;
  }
  window.dispatchEvent(new CustomEvent(ADMIN_API_TIMING_EVENT));
};

const recordSample = (sample: AdminApiTimingSample) => {
  const samples = loadSamples();
  samples.push(sample);
  saveSamples(samples);
};

const buildSample = ({
  method,
  url,
  response,
  startedAt,
  endedAt
}: {
  method: string;
  url: URL;
  response: Response | null;
  startedAt: number;
  endedAt: number;
}): AdminApiTimingSample => {
  const serverTiming = parseServerTimingHeader(response?.headers.get("Server-Timing") ?? null);
  const totalMetric = serverTiming.get("total");
  const routeMetric = serverTiming.get("route");
  const serverTotalMs = totalMetric?.duration ?? routeMetric?.duration ?? null;
  const routeDurationMs = routeMetric?.duration ?? null;
  const clientDurationMs = roundDuration(endedAt - startedAt);
  const routeHeader = response?.headers.get("X-Admin-Api-Route");
  const cache =
    response?.headers.get("X-Admin-Analytics-Cache") ||
    response?.headers.get("X-Admin-Health-Cache") ||
    response?.headers.get("X-Admin-Api-Cache") ||
    null;
  const slowHeader = response?.headers.get("X-Admin-Api-Slow");
  const effectiveMs = roundDuration(serverTotalMs ?? clientDurationMs);

  return {
    id: `${Date.now()}:${Math.random().toString(36).slice(2)}`,
    method,
    route: routeHeader || `${method} ${normalizePathForRanking(url.pathname)}`,
    path: `${url.pathname}${url.search}`,
    status: response?.status ?? 0,
    ok: response?.ok ?? false,
    startedAt: new Date().toISOString(),
    clientDurationMs,
    serverTotalMs: serverTotalMs == null ? null : roundDuration(serverTotalMs),
    routeDurationMs: routeDurationMs == null ? null : roundDuration(routeDurationMs),
    cache,
    slow: slowHeader === "1" || effectiveMs >= 1_000 || Boolean(response && response.status >= 400),
    source: serverTotalMs == null ? "client" : "server"
  };
};

export function installAdminApiTimingInterceptor() {
  if (typeof window === "undefined" || window.__botAdminApiTimingInstalled) {
    return;
  }

  const originalFetch = window.fetch.bind(window);
  window.__botAdminApiOriginalFetch = originalFetch;
  window.__botAdminApiTimingInstalled = true;

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = getRequestUrl(input);
    const apiUrl = getTrackableApiUrl(rawUrl);
    if (!apiUrl) {
      return originalFetch(input, init);
    }

    const method = getRequestMethod(input, init);
    const startedAt = performance.now();
    try {
      const response = await originalFetch(input, init);
      recordSample(
        buildSample({
          method,
          url: apiUrl,
          response,
          startedAt,
          endedAt: performance.now()
        })
      );
      return response;
    } catch (error) {
      recordSample(
        buildSample({
          method,
          url: apiUrl,
          response: null,
          startedAt,
          endedAt: performance.now()
        })
      );
      throw error;
    }
  };
}

export function getAdminApiTimingRanking(limit = 12): AdminApiTimingRankingRow[] {
  const groups = new Map<string, { samples: AdminApiTimingSample[] }>();
  for (const sample of loadSamples()) {
    const key = `${sample.method}:${sample.route}`;
    const group = groups.get(key) ?? { samples: [] };
    group.samples.push(sample);
    groups.set(key, group);
  }

  return Array.from(groups.values())
    .map(({ samples }) => {
      const durations = samples.map((sample) => sample.serverTotalMs ?? sample.clientDurationMs);
      const total = durations.reduce((sum, value) => sum + value, 0);
      const last = samples[samples.length - 1];
      return {
        route: last.route,
        method: last.method,
        count: samples.length,
        errorCount: samples.filter((sample) => !sample.ok).length,
        slowCount: samples.filter((sample) => sample.slow).length,
        avgMs: roundDuration(total / Math.max(1, samples.length)),
        maxMs: roundDuration(Math.max(...durations)),
        lastMs: roundDuration(last.serverTotalMs ?? last.clientDurationMs),
        serverSampleCount: samples.filter((sample) => sample.source === "server").length,
        lastStatus: last.status,
        lastAt: last.startedAt,
        cache: last.cache
      };
    })
    .sort((left, right) => {
      if (right.maxMs !== left.maxMs) return right.maxMs - left.maxMs;
      return right.avgMs - left.avgMs;
    })
    .slice(0, limit);
}

export function clearAdminApiTimingSamples() {
  saveSamples([]);
}
