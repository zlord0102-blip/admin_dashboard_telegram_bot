import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/app/api/_shared/adminAuth";
import { buildServerTimingHeader } from "@/app/api/_shared/serverTiming";

export async function GET(request: NextRequest) {
  const routeStartedAt = performance.now();
  const adminSession = await requireAdminSession(request);
  const authDuration = performance.now() - routeStartedAt;
  if (adminSession.ok === false) {
    const response = adminSession.response;
    response.headers.set(
      "Server-Timing",
      buildServerTimingHeader([
        { name: "auth", duration: authDuration, description: "error" },
        { name: "total", duration: performance.now() - routeStartedAt, description: "error" }
      ])
    );
    return response;
  }

  const payloadStartedAt = performance.now();
  const response = NextResponse.json({
    success: true,
    data: {
      userId: adminSession.userId,
      email: adminSession.email,
      role: adminSession.role
    }
  });
  response.headers.set(
    "Server-Timing",
    buildServerTimingHeader([
      { name: "auth", duration: authDuration },
      { name: "session", duration: performance.now() - payloadStartedAt },
      { name: "total", duration: performance.now() - routeStartedAt }
    ])
  );
  return response;
}
