import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/app/api/_shared/adminAuth";
import { licenseCorsPreflight, withLicenseCors } from "@/app/api/_shared/license";
import { invalidateServerCacheByPrefix } from "@/app/api/_shared/serverCache";
import { withAdminApiTiming } from "@/app/api/_shared/serverTiming";

const LICENSE_ADMIN_CACHE_PREFIX = "admin-license:";

const parseRouteId = (value: string) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

async function handlePOST(
  request: NextRequest,
  context: { params: { id: string } }
) {
  const adminSession = await requireAdminSession(request);
  if (adminSession.ok === false) {
    return adminSession.response;
  }

  const activationId = parseRouteId(context.params.id);
  if (!activationId) {
    return NextResponse.json({ error: "Activation id không hợp lệ." }, { status: 400 });
  }

  const { data: existingRow, error: existingError } = await adminSession.supabase
    .from("license_activations")
    .select("id, deactivated_at")
    .eq("id", activationId)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ error: existingError.message || "Không thể tải activation." }, { status: 500 });
  }

  if (!existingRow) {
    return NextResponse.json({ error: "Không tìm thấy activation." }, { status: 404 });
  }

  if (existingRow.deactivated_at) {
    return NextResponse.json({ success: true, data: { ok: true, alreadyReset: true } });
  }

  const { error } = await adminSession.supabase
    .from("license_activations")
    .update({
      deactivated_at: new Date().toISOString(),
      deactivation_reason: "admin_reset_single_activation"
    })
    .eq("id", activationId)
    .is("deactivated_at", null);

  if (error) {
    return NextResponse.json({ error: error.message || "Không thể reset activation." }, { status: 500 });
  }

  invalidateServerCacheByPrefix(LICENSE_ADMIN_CACHE_PREFIX);
  return NextResponse.json({ success: true, data: { ok: true } });
}

export const POST = withLicenseCors(withAdminApiTiming("POST /api/licenses/activations/[id]/reset", handlePOST));
export const OPTIONS = licenseCorsPreflight;
