import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/app/api/_shared/adminAuth";
import { licenseCorsPreflight, listLicenseActivations, withLicenseCors } from "@/app/api/_shared/license";
import { getOrSetServerCache } from "@/app/api/_shared/serverCache";
import { withAdminApiTiming } from "@/app/api/_shared/serverTiming";

const LICENSE_ADMIN_CACHE_PREFIX = "admin-license:";
const LICENSE_ADMIN_CACHE_TTL_MS = 15_000;

const toPositiveInt = (value: unknown) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

async function handleGET(request: NextRequest) {
  const adminSession = await requireAdminSession(request);
  if (adminSession.ok === false) {
    return adminSession.response;
  }

  const extensionId = toPositiveInt(request.nextUrl.searchParams.get("extensionId"));
  const activeOnly = request.nextUrl.searchParams.get("activeOnly") === "true";

  try {
    const cacheKey = `${LICENSE_ADMIN_CACHE_PREFIX}activations:v1:${extensionId || "all"}:${activeOnly ? "active" : "all"}`;
    const { value: data, hit } = await getOrSetServerCache(cacheKey, LICENSE_ADMIN_CACHE_TTL_MS, () =>
      listLicenseActivations(adminSession.supabase, {
        extensionId,
        activeOnly
      })
    );
    const response = NextResponse.json({ success: true, data });
    response.headers.set("X-Admin-Api-Cache", hit ? "hit" : "miss");
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Không thể tải danh sách activation." },
      { status: 500 }
    );
  }
}

export const GET = withLicenseCors(withAdminApiTiming("GET /api/licenses/activations", handleGET));
export const OPTIONS = licenseCorsPreflight;
