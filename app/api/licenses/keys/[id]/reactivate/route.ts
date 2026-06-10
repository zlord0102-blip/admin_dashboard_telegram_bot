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

  const licenseKeyId = parseRouteId(context.params.id);
  if (!licenseKeyId) {
    return NextResponse.json({ error: "License key id không hợp lệ." }, { status: 400 });
  }

  const { data, error } = await adminSession.supabase
    .from("license_keys")
    .update({ status: "active" })
    .eq("id", licenseKeyId)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message || "Không thể kích hoạt lại key." }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "Không tìm thấy license key." }, { status: 404 });
  }

  invalidateServerCacheByPrefix(LICENSE_ADMIN_CACHE_PREFIX);
  return NextResponse.json({ success: true, data: { ok: true } });
}

export const POST = withLicenseCors(withAdminApiTiming("POST /api/licenses/keys/[id]/reactivate", handlePOST));
export const OPTIONS = licenseCorsPreflight;
