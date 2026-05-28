import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/app/api/_shared/adminAuth";
import { getSupabaseAdminClient } from "@/app/api/_shared/supabaseAdmin";
import { recordAdminAuditEvent } from "@/app/api/_shared/adminAudit";
import { withAdminApiTiming } from "@/app/api/_shared/serverTiming";

const toPositiveId = (value: unknown) => {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

async function handlePOST(request: NextRequest) {
  const adminSession = await requireAdminSession(request);
  if (adminSession.ok === false) {
    return adminSession.response;
  }

  const body = await request.json().catch(() => null);
  const orderId = toPositiveId(body?.orderId);
  const status = typeof body?.status === "string" ? body.status : "";
  if (!orderId) {
    return NextResponse.json({ error: "orderId không hợp lệ." }, { status: 400 });
  }
  if (!["failed", "cancelled"].includes(status)) {
    return NextResponse.json({ error: "Trạng thái không được hỗ trợ." }, { status: 400 });
  }

  const supabase = getSupabaseAdminClient();
  const { error } = await supabase
    .from("direct_orders")
    .update({ status })
    .eq("id", orderId)
    .eq("status", "pending");

  if (error) {
    return NextResponse.json({ error: error.message || "Không thể cập nhật đơn." }, { status: 500 });
  }

  await recordAdminAuditEvent(supabase, {
    adminUserId: adminSession.userId,
    adminEmail: adminSession.email,
    action: `direct_order.${status}`,
    entityType: "direct_order",
    entityId: orderId
  });

  return NextResponse.json({ success: true, data: { orderId, status } });
}

export const POST = withAdminApiTiming("POST /api/direct-orders/status", handlePOST);
