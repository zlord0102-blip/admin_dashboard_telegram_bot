import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/app/api/_shared/adminAuth";
import { getReportsSnapshot } from "@/app/api/_shared/adminAnalytics";
import { getOrSetServerCache } from "@/app/api/_shared/serverCache";
import { buildServerTimingHeader, withAdminApiTiming } from "@/app/api/_shared/serverTiming";

const REPORTS_CACHE_TTL_MS = 30_000;

async function handleGET(request: NextRequest) {
  const routeStartedAt = performance.now();
  const adminSession = await requireAdminSession(request);
  const authDuration = performance.now() - routeStartedAt;
  if (adminSession.ok === false) {
    return adminSession.response;
  }

  const rawPeriod = request.nextUrl.searchParams.get("period") || "month";
  const period =
    rawPeriod === "today" ||
    rawPeriod === "quarter" ||
    rawPeriod === "custom_month" ||
    rawPeriod === "all_time"
      ? rawPeriod
      : "month";
  const month = request.nextUrl.searchParams.get("month");
  const compareMonth = request.nextUrl.searchParams.get("compareMonth");

  try {
    const analyticsStartedAt = performance.now();
    const cacheKey = `admin-analytics:reports:v3:${period}:${month || ""}:${compareMonth || ""}`;
    const { value: data, hit } = await getOrSetServerCache(cacheKey, REPORTS_CACHE_TTL_MS, () =>
      getReportsSnapshot(adminSession.supabase, {
        period,
        month,
        compareMonth
      })
    );
    const analyticsDuration = performance.now() - analyticsStartedAt;
    const response = NextResponse.json({ success: true, data });
    response.headers.set(
      "Server-Timing",
      buildServerTimingHeader([
        { name: "auth", duration: authDuration },
        { name: "analytics", duration: analyticsDuration, description: hit ? "cache-hit" : "cache-miss" },
        { name: "total", duration: performance.now() - routeStartedAt }
      ])
    );
    response.headers.set("X-Admin-Analytics-Cache", hit ? "hit" : "miss");
    return response;
  } catch (error) {
    const response = NextResponse.json(
      {
        error:
          error instanceof Error && error.message.trim()
            ? error.message
            : "Không thể tải reports analytics."
      },
      { status: 500 }
    );
    response.headers.set(
      "Server-Timing",
      buildServerTimingHeader([
        { name: "auth", duration: authDuration },
        { name: "total", duration: performance.now() - routeStartedAt, description: "error" }
      ])
    );
    return response;
  }
}

export const GET = withAdminApiTiming("GET /api/admin-analytics/reports", handleGET);
