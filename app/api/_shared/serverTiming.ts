import type { NextRequest } from "next/server";

export type TimingMetric = {
  name: string;
  duration: number;
  description?: string;
};

const sanitizeDescription = (value: string) => value.replace(/["\\]/g, "");

export const buildServerTimingHeader = (metrics: TimingMetric[]) =>
  metrics
    .filter((metric) => Number.isFinite(metric.duration) && metric.duration >= 0)
    .map((metric) => {
      const base = `${metric.name};dur=${metric.duration.toFixed(1)}`;
      return metric.description
        ? `${base};desc="${sanitizeDescription(metric.description)}"`
        : base;
    })
    .join(", ");

const hasMetric = (header: string | null, metricName: string) =>
  Boolean(header && new RegExp(`(^|,\\s*)${metricName}\\s*;`, "i").test(header));

const getStatus = (response: Response) =>
  Number.isFinite(Number(response.status)) ? Number(response.status) : 200;

const setResponseHeaders = (response: Response, headers: Record<string, string>) => {
  try {
    for (const [key, value] of Object.entries(headers)) {
      response.headers.set(key, value);
    }
    return response;
  } catch {
    const nextHeaders = new Headers(response.headers);
    for (const [key, value] of Object.entries(headers)) {
      nextHeaders.set(key, value);
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: nextHeaders
    });
  }
};

export type AdminApiTimingOptions = {
  route: string;
  startedAt: number;
  metrics?: TimingMetric[];
  slowThresholdMs?: number;
};

export function finalizeAdminApiTiming(
  request: NextRequest,
  response: Response,
  {
    route,
    startedAt,
    metrics = [],
    slowThresholdMs = 1_000
  }: AdminApiTimingOptions
) {
  const duration = Math.max(0, performance.now() - startedAt);
  const status = getStatus(response);
  const existingTiming = response.headers.get("Server-Timing");
  const routeMetric = { name: "route", duration, description: route };
  const nextMetrics = [
    ...metrics,
    routeMetric,
    ...(hasMetric(existingTiming, "total") ? [] : [{ name: "total", duration }])
  ];
  const nextTiming = buildServerTimingHeader(nextMetrics);
  const serverTiming = [existingTiming, nextTiming].filter(Boolean).join(", ");
  const cacheSignal =
    response.headers.get("X-Admin-Analytics-Cache") ||
    response.headers.get("X-Admin-Health-Cache") ||
    response.headers.get("X-Admin-Api-Cache") ||
    "";
  const isSlow = duration >= slowThresholdMs;

  const nextResponse = setResponseHeaders(response, {
    "Server-Timing": serverTiming,
    "X-Admin-Api-Route": route,
    "X-Admin-Api-Duration-Ms": duration.toFixed(1),
    "X-Admin-Api-Slow": isSlow ? "1" : "0"
  });

  const shouldLog =
    process.env.ADMIN_API_TIMING_LOG === "1" ||
    process.env.NODE_ENV !== "production" ||
    isSlow ||
    status >= 400;

  if (shouldLog) {
    const logPayload = {
      event: "admin_api_timing",
      route,
      method: request.method,
      path: request.nextUrl.pathname,
      status,
      durationMs: Number(duration.toFixed(1)),
      slow: isSlow,
      cache: cacheSignal || undefined
    };
    const logLine = JSON.stringify(logPayload);
    if (status >= 500 || duration >= slowThresholdMs * 2) {
      console.warn(logLine);
    } else {
      console.info(logLine);
    }
  }

  return nextResponse;
}

export function withAdminApiTiming<TArgs extends unknown[]>(
  route: string,
  handler: (request: NextRequest, ...args: TArgs) => Promise<Response> | Response,
  options: { slowThresholdMs?: number } = {}
) {
  return async (request: NextRequest, ...args: TArgs) => {
    const startedAt = performance.now();
    try {
      const response = await handler(request, ...args);
      return finalizeAdminApiTiming(request, response, {
        route,
        startedAt,
        slowThresholdMs: options.slowThresholdMs
      });
    } catch (error) {
      const duration = Math.max(0, performance.now() - startedAt);
      console.warn(
        JSON.stringify({
          event: "admin_api_timing",
          route,
          method: request.method,
          path: request.nextUrl.pathname,
          status: 500,
          durationMs: Number(duration.toFixed(1)),
          slow: true,
          thrown: error instanceof Error ? error.name : "unknown"
        })
      );
      throw error;
    }
  };
}
