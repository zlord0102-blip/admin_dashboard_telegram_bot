import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/app/api/_shared/adminAuth";
import { getSupabaseAdminClient } from "@/app/api/_shared/supabaseAdmin";
import { withAdminApiTiming } from "@/app/api/_shared/serverTiming";

async function handleGET(request: NextRequest) {
  const adminSession = await requireAdminSession(request);
  if (adminSession.ok === false) {
    return adminSession.response;
  }

  const url = new URL(request.url);
  const limit = Math.max(1, Math.min(Number.parseInt(url.searchParams.get("limit") || "40", 10) || 40, 100));
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("admin_audit_logs")
    .select("id, admin_user_id, admin_email, action, entity_type, entity_id, metadata, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json(
      {
        error:
          error.message.includes("admin_audit_logs")
            ? "Thiếu bảng admin_audit_logs. Hãy apply supabase_schema_all_in_one.sql mới nhất."
            : error.message
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, data: { logs: data || [] } });
}

export const GET = withAdminApiTiming("GET /api/admin/audit", handleGET);
