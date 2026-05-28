import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/app/api/_shared/adminAuth";
import { getSupabaseAdminClient } from "@/app/api/_shared/supabaseAdmin";
import { recordAdminAuditEvent } from "@/app/api/_shared/adminAudit";
import { withAdminApiTiming } from "@/app/api/_shared/serverTiming";

const toPositiveId = (value: unknown) => {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const parseOptionalNonNegativeInt = (value: unknown, fieldName: string) => {
  const raw = String(value ?? "").trim();
  if (!raw) return { value: null as number | null };
  const numeric = Number(raw);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return { value: null as number | null, error: `${fieldName} phải là số nguyên lớn hơn hoặc bằng 0.` };
  }
  return { value: Math.trunc(numeric) };
};

const parseOptionalPositiveId = (value: unknown) => {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const parseNonNegativeInt = (value: unknown, fieldName: string) => {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return { value: 0, error: `${fieldName} phải lớn hơn hoặc bằng 0.` };
  }
  return { value: Math.trunc(numeric) };
};

const parseNonNegativeNumber = (value: unknown, fieldName: string) => {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return { value: 0, error: `${fieldName} phải lớn hơn hoặc bằng 0.` };
  }
  return { value: numeric };
};

const normalizeTelegramIcon = (value: unknown) => {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 16);
  return normalized || null;
};

const normalizeTelegramCustomEmojiId = (value: unknown) => {
  const normalized = String(value ?? "").replace(/\D/g, "").slice(0, 64);
  return normalized || null;
};

const normalizePriceTiers = (value: unknown) => {
  if (!Array.isArray(value)) return null;
  const byQuantity = new Map<number, number>();
  for (const item of value) {
    const row = item as { min_quantity?: unknown; unit_price?: unknown };
    const minQuantity = Number(row?.min_quantity);
    const unitPrice = Number(row?.unit_price);
    if (!Number.isFinite(minQuantity) || !Number.isFinite(unitPrice)) continue;
    if (minQuantity < 1 || unitPrice < 1) continue;
    byQuantity.set(Math.trunc(minQuantity), Math.trunc(unitPrice));
  }
  const tiers = Array.from(byQuantity.entries())
    .map(([min_quantity, unit_price]) => ({ min_quantity, unit_price }))
    .sort((a, b) => a.min_quantity - b.min_quantity);
  return tiers.length ? tiers : null;
};

const getProductMutationPayload = (body: any) => {
  const name = String(body?.name ?? "").trim();
  if (!name) return { error: "Tên sản phẩm không được trống." };

  const price = parseNonNegativeInt(body?.price, "Giá VNĐ");
  if (price.error) return { error: price.error };

  const priceUsdt = parseNonNegativeNumber(body?.priceUsdt, "Giá USDT");
  if (priceUsdt.error) return { error: priceUsdt.error };

  const sortPosition = parseOptionalNonNegativeInt(body?.sortPosition, "Vị trí");
  if (sortPosition.error) return { error: sortPosition.error };

  const buyQty = Number(body?.promoBuyQuantity ?? 0);
  const bonusQty = Number(body?.promoBonusQuantity ?? 0);
  const hasPromo = buyQty > 0 || bonusQty > 0;
  if (hasPromo && (!Number.isFinite(buyQty) || !Number.isFinite(bonusQty) || buyQty < 1 || bonusQty < 1)) {
    return { error: "Khuyến mãi cần đủ 2 giá trị hợp lệ: mua X và tặng Y đều phải lớn hơn 0." };
  }

  return {
    payload: {
      name,
      price: price.value,
      price_usdt: priceUsdt.value,
      sort_position: sortPosition.value,
      bot_folder_id: parseOptionalPositiveId(body?.botFolderId),
      telegram_icon: normalizeTelegramIcon(body?.telegramIcon),
      telegram_icon_custom_emoji_id: normalizeTelegramCustomEmojiId(body?.telegramIconCustomEmojiId),
      description: String(body?.description ?? "").trim(),
      format_data: String(body?.formatData ?? "").trim() || null,
      price_tiers: normalizePriceTiers(body?.priceTiers),
      promo_buy_quantity: hasPromo ? Math.trunc(buyQty) : 0,
      promo_bonus_quantity: hasPromo ? Math.trunc(bonusQty) : 0
    }
  };
};

type PositionShiftRow = { id: number; sort_position: number };

type OrderedProductPositionRow = {
  id: number;
  sort_position: number | null;
};

async function normalizeActiveProductPositions(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  pinnedProductId?: number,
  requestedPosition?: number | null
) {
  const { data, error } = await supabase
    .from("products")
    .select("id, sort_position")
    .eq("is_deleted", false)
    .eq("is_hidden", false)
    .order("sort_position", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true });

  if (error) throw error;

  const rows = ((data as OrderedProductPositionRow[]) || []).map((row) => ({
    id: Number(row.id),
    sort_position: row.sort_position !== null && row.sort_position !== undefined ? Number(row.sort_position) : null
  }));

  let orderedRows = rows;
  if (pinnedProductId && rows.some((row) => row.id === pinnedProductId)) {
    const pinned = rows.find((row) => row.id === pinnedProductId)!;
    orderedRows = rows.filter((row) => row.id !== pinnedProductId);
    const targetPosition =
      requestedPosition !== null && requestedPosition !== undefined
        ? Math.min(Math.max(Math.trunc(requestedPosition), 1), orderedRows.length + 1)
        : orderedRows.length + 1;
    orderedRows.splice(targetPosition - 1, 0, pinned);
  }

  for (let index = 0; index < orderedRows.length; index += 1) {
    const nextPosition = index + 1;
    const row = orderedRows[index];
    if (row.sort_position === nextPosition) continue;
    const { error: updateError } = await supabase
      .from("products")
      .update({ sort_position: nextPosition })
      .eq("id", row.id);
    if (updateError) throw updateError;
  }
}

async function shiftRowsForInsert(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  tableName: "products" | "bot_product_folders",
  position: number
): Promise<PositionShiftRow[]> {
  const { data, error } = await supabase
    .from(tableName)
    .select("id, sort_position")
    .gte("sort_position", position)
    .order("sort_position", { ascending: false })
    .order("id", { ascending: false });

  if (error) throw error;

  const rows = ((data as Array<{ id: number; sort_position: number | null }>) || [])
    .filter((row) => row.sort_position !== null && row.sort_position !== undefined)
    .map((row) => ({
      id: Number(row.id),
      sort_position: Number(row.sort_position)
    }));

  for (const row of rows) {
    const { error: updateError } = await supabase
      .from(tableName)
      .update({ sort_position: row.sort_position + 1 })
      .eq("id", row.id);
    if (updateError) throw updateError;
  }

  return rows;
}

async function restoreShiftedRows(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  tableName: "products" | "bot_product_folders",
  rows: PositionShiftRow[]
) {
  for (const row of rows) {
    await supabase
      .from(tableName)
      .update({ sort_position: row.sort_position })
      .eq("id", row.id);
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
    if (action === "create_product") {
      const parsed = getProductMutationPayload(body);
      if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });

      const sortPosition = parsed.payload!.sort_position;

      const { data, error } = await supabase
        .from("products")
        .insert(parsed.payload!)
        .select("id")
        .single();
      if (error) throw error;

      const productId = Number(data?.id);
      await normalizeActiveProductPositions(supabase, productId, sortPosition);
      await recordAdminAuditEvent(supabase, {
        adminUserId: adminSession.userId,
        adminEmail: adminSession.email,
        action: "product.create",
        entityType: "product",
        entityId: productId || null,
        metadata: { name: parsed.payload!.name, sortPosition }
      });
      return NextResponse.json({ success: true, data: { productId } });
    }

    if (action === "update_product") {
      const productId = toPositiveId(body?.productId);
      if (!productId) return NextResponse.json({ error: "productId không hợp lệ." }, { status: 400 });
      const parsed = getProductMutationPayload(body);
      if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 });

      const { error } = await supabase.from("products").update(parsed.payload!).eq("id", productId);
      if (error) throw error;
      await normalizeActiveProductPositions(supabase, productId, parsed.payload!.sort_position);

      await recordAdminAuditEvent(supabase, {
        adminUserId: adminSession.userId,
        adminEmail: adminSession.email,
        action: "product.update",
        entityType: "product",
        entityId: productId,
        metadata: { name: parsed.payload!.name, sortPosition: parsed.payload!.sort_position }
      });
      return NextResponse.json({ success: true, data: { productId } });
    }

    if (action === "create_folder") {
      const name = String(body?.name ?? "").trim();
      if (!name) return NextResponse.json({ error: "Tên folder không được trống." }, { status: 400 });
      const sortPosition = parseOptionalNonNegativeInt(body?.sortPosition, "Vị trí folder");
      if (sortPosition.error) return NextResponse.json({ error: sortPosition.error }, { status: 400 });

      let shiftedRows: PositionShiftRow[] = [];
      if (sortPosition.value !== null) {
        shiftedRows = await shiftRowsForInsert(supabase, "bot_product_folders", sortPosition.value);
      }

      const { data, error } = await supabase
        .from("bot_product_folders")
        .insert({ name, sort_position: sortPosition.value })
        .select("id")
        .single();
      if (error) {
        if (shiftedRows.length) await restoreShiftedRows(supabase, "bot_product_folders", shiftedRows);
        throw error;
      }

      const folderId = Number(data?.id);
      await recordAdminAuditEvent(supabase, {
        adminUserId: adminSession.userId,
        adminEmail: adminSession.email,
        action: "product_folder.create",
        entityType: "bot_product_folder",
        entityId: folderId || null,
        metadata: { name, sortPosition: sortPosition.value }
      });
      return NextResponse.json({ success: true, data: { folderId } });
    }

    if (action === "update_folder") {
      const folderId = toPositiveId(body?.folderId);
      if (!folderId) return NextResponse.json({ error: "folderId không hợp lệ." }, { status: 400 });
      const name = String(body?.name ?? "").trim();
      if (!name) return NextResponse.json({ error: "Tên folder không được trống." }, { status: 400 });
      const sortPosition = parseOptionalNonNegativeInt(body?.sortPosition, "Vị trí folder");
      if (sortPosition.error) return NextResponse.json({ error: sortPosition.error }, { status: 400 });

      const { error } = await supabase
        .from("bot_product_folders")
        .update({ name, sort_position: sortPosition.value })
        .eq("id", folderId);
      if (error) throw error;

      await recordAdminAuditEvent(supabase, {
        adminUserId: adminSession.userId,
        adminEmail: adminSession.email,
        action: "product_folder.update",
        entityType: "bot_product_folder",
        entityId: folderId,
        metadata: { name, sortPosition: sortPosition.value }
      });
      return NextResponse.json({ success: true, data: { folderId } });
    }

    if (action === "create_format_template") {
      const name = String(body?.name ?? "").trim();
      const pattern = String(body?.pattern ?? "").trim();
      if (!name || !pattern) return NextResponse.json({ error: "Tên và pattern format không được trống." }, { status: 400 });

      const { data, error } = await supabase
        .from("format_templates")
        .insert({ name, pattern })
        .select("id")
        .single();
      if (error) throw error;

      const templateId = Number(data?.id);
      await recordAdminAuditEvent(supabase, {
        adminUserId: adminSession.userId,
        adminEmail: adminSession.email,
        action: "format_template.create",
        entityType: "format_template",
        entityId: templateId || null,
        metadata: { name }
      });
      return NextResponse.json({ success: true, data: { templateId } });
    }

    if (action === "update_format_template") {
      const templateId = toPositiveId(body?.templateId);
      if (!templateId) return NextResponse.json({ error: "templateId không hợp lệ." }, { status: 400 });
      const name = String(body?.name ?? "").trim();
      const pattern = String(body?.pattern ?? "").trim();
      if (!name || !pattern) return NextResponse.json({ error: "Tên và pattern format không được trống." }, { status: 400 });

      const { error } = await supabase.from("format_templates").update({ name, pattern }).eq("id", templateId);
      if (error) throw error;

      await recordAdminAuditEvent(supabase, {
        adminUserId: adminSession.userId,
        adminEmail: adminSession.email,
        action: "format_template.update",
        entityType: "format_template",
        entityId: templateId,
        metadata: { name }
      });
      return NextResponse.json({ success: true, data: { templateId } });
    }

    if (action === "delete_format_template") {
      const templateId = toPositiveId(body?.templateId);
      if (!templateId) return NextResponse.json({ error: "templateId không hợp lệ." }, { status: 400 });
      const { error } = await supabase.from("format_templates").delete().eq("id", templateId);
      if (error) throw error;

      await recordAdminAuditEvent(supabase, {
        adminUserId: adminSession.userId,
        adminEmail: adminSession.email,
        action: "format_template.delete",
        entityType: "format_template",
        entityId: templateId
      });
      return NextResponse.json({ success: true, data: { templateId } });
    }

    if (action === "soft_delete") {
      const productId = toPositiveId(body?.productId);
      if (!productId) return NextResponse.json({ error: "productId không hợp lệ." }, { status: 400 });
      const { error } = await supabase
        .from("products")
        .update({ is_deleted: true, is_hidden: true, deleted_at: new Date().toISOString() })
        .eq("id", productId);
      if (error) throw error;
      await normalizeActiveProductPositions(supabase);
      await recordAdminAuditEvent(supabase, {
        adminUserId: adminSession.userId,
        adminEmail: adminSession.email,
        action: "product.soft_delete",
        entityType: "product",
        entityId: productId
      });
      return NextResponse.json({ success: true, data: { productId } });
    }

    if (action === "restore") {
      const productId = toPositiveId(body?.productId);
      if (!productId) return NextResponse.json({ error: "productId không hợp lệ." }, { status: 400 });
      const { error } = await supabase
        .from("products")
        .update({ is_deleted: false, is_hidden: false, deleted_at: null })
        .eq("id", productId);
      if (error) throw error;
      await normalizeActiveProductPositions(supabase, productId, null);
      await recordAdminAuditEvent(supabase, {
        adminUserId: adminSession.userId,
        adminEmail: adminSession.email,
        action: "product.restore",
        entityType: "product",
        entityId: productId
      });
      return NextResponse.json({ success: true, data: { productId } });
    }

    if (action === "toggle_hidden") {
      const productId = toPositiveId(body?.productId);
      if (!productId) return NextResponse.json({ error: "productId không hợp lệ." }, { status: 400 });
      const hidden = Boolean(body?.hidden);
      const { error } = await supabase.from("products").update({ is_hidden: hidden }).eq("id", productId);
      if (error) throw error;
      await normalizeActiveProductPositions(supabase, hidden ? undefined : productId, null);
      await recordAdminAuditEvent(supabase, {
        adminUserId: adminSession.userId,
        adminEmail: adminSession.email,
        action: hidden ? "product.hide" : "product.unhide",
        entityType: "product",
        entityId: productId
      });
      return NextResponse.json({ success: true, data: { productId, hidden } });
    }

    if (action === "delete_folder") {
      const folderId = toPositiveId(body?.folderId);
      if (!folderId) return NextResponse.json({ error: "folderId không hợp lệ." }, { status: 400 });
      const { error: unassignError } = await supabase
        .from("products")
        .update({ bot_folder_id: null })
        .eq("bot_folder_id", folderId);
      if (unassignError) throw unassignError;
      const { error } = await supabase.from("bot_product_folders").delete().eq("id", folderId);
      if (error) throw error;
      await recordAdminAuditEvent(supabase, {
        adminUserId: adminSession.userId,
        adminEmail: adminSession.email,
        action: "product_folder.delete",
        entityType: "bot_product_folder",
        entityId: folderId
      });
      return NextResponse.json({ success: true, data: { folderId } });
    }

    return NextResponse.json({ error: "Action không được hỗ trợ." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Không thể cập nhật sản phẩm." },
      { status: 500 }
    );
  }
}

export const POST = withAdminApiTiming("POST /api/admin/products", handlePOST);
