import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/app/api/_shared/adminAuth";
import { executeCustomCheck } from "./shared";
import type { CustomCheckRequestBody } from "./shared";

export async function POST(request: NextRequest) {
  const adminSession = await requireAdminSession(request);
  if (adminSession.ok === false) {
    return adminSession.response;
  }

  let body: CustomCheckRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const result = await executeCustomCheck(adminSession.supabase, body);
  if (!result.ok) {
    return NextResponse.json({ error: result.error || "Không thể custom check." }, { status: result.status });
  }

  return NextResponse.json(result.data);
}
