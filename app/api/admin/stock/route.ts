import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/app/api/_shared/adminAuth";
import { getSupabaseAdminClient } from "@/app/api/_shared/supabaseAdmin";
import { recordAdminAuditEvent } from "@/app/api/_shared/adminAudit";
import { withAdminApiTiming } from "@/app/api/_shared/serverTiming";

const normalizeIds = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => Number.parseInt(String(item), 10))
        .filter((item) => Number.isFinite(item) && item > 0)
    )
  );
};

const toPositiveId = (value: unknown) => {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const loadStockSummary = async (productId: number) => {
  const supabase = getSupabaseAdminClient();
  const [totalRes, soldRes] = await Promise.all([
    supabase
      .from("stock")
      .select("id", { count: "exact", head: true })
      .eq("product_id", productId),
    supabase
      .from("stock")
      .select("id", { count: "exact", head: true })
      .eq("product_id", productId)
      .eq("sold", true)
  ]);

  if (totalRes.error) throw totalRes.error;
  if (soldRes.error) throw soldRes.error;

  const total = totalRes.count ?? 0;
  const sold = soldRes.count ?? 0;
  return {
    total,
    sold,
    remaining: Math.max(total - sold, 0)
  };
};

async function handleGET(request: NextRequest) {
  const adminSession = await requireAdminSession(request);
  if (adminSession.ok === false) {
    return adminSession.response;
  }

  const url = new URL(request.url);
  const productId = toPositiveId(url.searchParams.get("productId"));
  if (!productId) {
    return NextResponse.json({ error: "productId không hợp lệ." }, { status: 400 });
  }

  try {
    const summary = await loadStockSummary(productId);
    return NextResponse.json({
      success: true,
      data: {
        productId,
        summary
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Không thể tải stock summary." },
      { status: 500 }
    );
  }
}

async function handlePOST(request: NextRequest) {
  const adminSession = await requireAdminSession(request);
  if (adminSession.ok === false) {
    return adminSession.response;
  }

  const body = await request.json().catch(() => null);
  const action = typeof body?.action === "string" ? body.action : "";
  const supabase = getSupabaseAdminClient();

  try {
    if (action === "add_bulk") {
      const productId = toPositiveId(body?.productId);
      const contents = Array.isArray(body?.contents)
        ? Array.from(new Set(body.contents.map((item: unknown) => String(item || "").trim()).filter(Boolean)))
        : [];
      if (!productId) return NextResponse.json({ error: "productId không hợp lệ." }, { status: 400 });
      if (!contents.length) return NextResponse.json({ error: "Không có stock hợp lệ." }, { status: 400 });
      if (contents.length > 5000) return NextResponse.json({ error: "Tối đa 5.000 stock mỗi lần." }, { status: 400 });

      const { error } = await supabase.from("stock").insert(
        contents.map((content) => ({
          product_id: productId,
          content
        }))
      );
      if (error) throw error;
      await recordAdminAuditEvent(supabase, {
        adminUserId: adminSession.userId,
        adminEmail: adminSession.email,
        action: "stock.add_bulk",
        entityType: "product",
        entityId: productId,
        metadata: { count: contents.length }
      });
      return NextResponse.json({ success: true, data: { count: contents.length } });
    }

    if (action === "bulk_update_sold") {
      const ids = normalizeIds(body?.ids);
      if (!ids.length) return NextResponse.json({ error: "Không có stock được chọn." }, { status: 400 });
      const sold = Boolean(body?.sold);
      const { error } = await supabase.from("stock").update({ sold }).in("id", ids);
      if (error) throw error;
      await recordAdminAuditEvent(supabase, {
        adminUserId: adminSession.userId,
        adminEmail: adminSession.email,
        action: sold ? "stock.bulk_mark_sold" : "stock.bulk_mark_available",
        entityType: "stock",
        metadata: { count: ids.length }
      });
      return NextResponse.json({ success: true, data: { count: ids.length } });
    }

    if (action === "bulk_delete") {
      const ids = normalizeIds(body?.ids);
      if (!ids.length) return NextResponse.json({ error: "Không có stock được chọn." }, { status: 400 });
      const { error } = await supabase.from("stock").delete().in("id", ids);
      if (error) throw error;
      await recordAdminAuditEvent(supabase, {
        adminUserId: adminSession.userId,
        adminEmail: adminSession.email,
        action: "stock.bulk_delete",
        entityType: "stock",
        metadata: { count: ids.length }
      });
      return NextResponse.json({ success: true, data: { count: ids.length } });
    }

    if (action === "update_one") {
      const stockId = toPositiveId(body?.stockId);
      const content = String(body?.content || "").trim();
      const sold = Boolean(body?.sold);
      if (!stockId) return NextResponse.json({ error: "stockId không hợp lệ." }, { status: 400 });
      if (!content) return NextResponse.json({ error: "Nội dung stock không được trống." }, { status: 400 });
      const { error } = await supabase.from("stock").update({ content, sold }).eq("id", stockId);
      if (error) throw error;
      await recordAdminAuditEvent(supabase, {
        adminUserId: adminSession.userId,
        adminEmail: adminSession.email,
        action: "stock.update",
        entityType: "stock",
        entityId: stockId
      });
      return NextResponse.json({ success: true, data: { stockId } });
    }

    if (action === "delete_one") {
      const stockId = toPositiveId(body?.stockId);
      if (!stockId) return NextResponse.json({ error: "stockId không hợp lệ." }, { status: 400 });
      const { error } = await supabase.from("stock").delete().eq("id", stockId);
      if (error) throw error;
      await recordAdminAuditEvent(supabase, {
        adminUserId: adminSession.userId,
        adminEmail: adminSession.email,
        action: "stock.delete",
        entityType: "stock",
        entityId: stockId
      });
      return NextResponse.json({ success: true, data: { stockId } });
    }

    return NextResponse.json({ error: "Action không được hỗ trợ." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Không thể cập nhật stock." },
      { status: 500 }
    );
  }
}

export const GET = withAdminApiTiming("GET /api/admin/stock", handleGET);
export const POST = withAdminApiTiming("POST /api/admin/stock", handlePOST);
