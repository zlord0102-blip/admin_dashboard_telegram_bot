import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/app/api/_shared/adminAuth";
import { getUsersSnapshot } from "@/app/api/_shared/adminAnalytics";
import { getOrSetServerCache } from "@/app/api/_shared/serverCache";
import { buildServerTimingHeader } from "@/app/api/_shared/serverTiming";

const USERS_CACHE_TTL_MS = 10_000;

export async function GET(request: NextRequest) {
  const routeStartedAt = performance.now();
  const adminSession = await requireAdminSession(request);
  const authDuration = performance.now() - routeStartedAt;
  if (adminSession.ok === false) {
    return adminSession.response;
  }

  const pageParam = Number(request.nextUrl.searchParams.get("page"));
  const pageSizeParam = Number(request.nextUrl.searchParams.get("pageSize"));
  const search = request.nextUrl.searchParams.get("q") || "";
  const filter = request.nextUrl.searchParams.get("filter") || "";
  const sort = request.nextUrl.searchParams.get("sort") || "";
  const page = Number.isFinite(pageParam) ? pageParam : 1;
  const pageSize = Number.isFinite(pageSizeParam) ? pageSizeParam : 50;

  try {
    const cacheKey = `admin-analytics:users:v4:${page}:${pageSize}:${search.trim().toLowerCase()}:${filter.trim().toLowerCase()}:${sort.trim().toLowerCase()}`;
    const analyticsStartedAt = performance.now();
    const { value: data, hit } = await getOrSetServerCache(cacheKey, USERS_CACHE_TTL_MS, () =>
      getUsersSnapshot(adminSession.supabase, {
        page,
        pageSize,
        search,
        filterMode: filter,
        sortMode: sort
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
            : "Không thể tải users analytics."
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
