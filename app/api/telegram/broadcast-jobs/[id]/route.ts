import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/app/api/_shared/adminAuth";
import {
  getTelegramBroadcastJobSnapshot,
  isTelegramBroadcastJobActive,
  isTelegramBroadcastJobStale,
  launchTelegramBroadcastJob
} from "@/app/api/_shared/telegramBroadcastJobs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const adminSession = await requireAdminSession(request);
  if (adminSession.ok === false) {
    return adminSession.response;
  }

  const params = await context.params;
  const jobId = Number(params.id);
  if (!Number.isInteger(jobId) || jobId <= 0) {
    return NextResponse.json({ error: "jobId không hợp lệ." }, { status: 400 });
  }

  const snapshot = await getTelegramBroadcastJobSnapshot(adminSession.supabase, jobId);
  if (!snapshot) {
    return NextResponse.json({ error: "Không tìm thấy broadcast job." }, { status: 404 });
  }

  if (isTelegramBroadcastJobActive(snapshot.status) && isTelegramBroadcastJobStale(snapshot)) {
    launchTelegramBroadcastJob(snapshot.id);
  }

  return NextResponse.json({ job: snapshot });
}
