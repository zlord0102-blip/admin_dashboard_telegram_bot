import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/app/api/_shared/adminAuth";
import { getUserOrdersSnapshot } from "@/app/api/_shared/adminAnalytics";
import { getOrSetServerCache } from "@/app/api/_shared/serverCache";
import { buildServerTimingHeader } from "@/app/api/_shared/serverTiming";

const USER_ORDERS_CACHE_TTL_MS = 10_000;

export async function GET(
  request: NextRequest,
  context: { params: { userId: string } }
) {
  const routeStartedAt = performance.now();
  const adminSession = await requireAdminSession(request);
  const authDuration = performance.now() - routeStartedAt;
  if (adminSession.ok === false) {
    return adminSession.response;
  }

  const userId = Number(context.params.userId);

  try {
    const cacheKey = `admin-analytics:user-orders:v1:${Math.trunc(userId)}`;
    const analyticsStartedAt = performance.now();
    const { value: data, hit } = await getOrSetServerCache(cacheKey, USER_ORDERS_CACHE_TTL_MS, () =>
      getUserOrdersSnapshot(adminSession.supabase, userId)
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
            : "Không thể tải lịch sử đơn hàng của user."
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
