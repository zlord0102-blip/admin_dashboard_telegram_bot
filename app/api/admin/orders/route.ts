import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/app/api/_shared/adminAuth";
import { getSupabaseAdminClient } from "@/app/api/_shared/supabaseAdmin";
import { withAdminApiTiming } from "@/app/api/_shared/serverTiming";

type OrderRow = {
  id: number | string;
  user_id: number | string;
  product_id: number | string;
  price: number;
  quantity: number;
  created_at: string;
};

type OrderUserLookupRow = {
  user_id: number | string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
};

const clampPositiveInt = (value: string | null, fallback: number, max: number) => {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
};

const buildDisplayName = (user: OrderUserLookupRow) =>
  [user.first_name, user.last_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ")
    .trim() || null;

async function handleGET(request: NextRequest) {
  const adminSession = await requireAdminSession(request);
  if (adminSession.ok === false) {
    return adminSession.response;
  }

  const url = new URL(request.url);
  const page = clampPositiveInt(url.searchParams.get("page"), 1, 100_000);
  const pageSize = clampPositiveInt(url.searchParams.get("pageSize"), 20, 1_000);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const supabase = getSupabaseAdminClient();

  try {
    const { data, count, error } = await supabase
      .from("orders")
      .select("id, user_id, product_id, price, quantity, created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);
    if (error) throw error;

    const orders = ((data as OrderRow[] | null) || []).map((order) => ({
      ...order,
      price: Number(order.price || 0),
      quantity: Number(order.quantity || 0)
    }));
    const userIds = Array.from(
      new Set(
        orders
          .map((order) => order.user_id)
          .filter((value): value is number | string => value !== null && value !== undefined)
          .map(String)
      )
    );
    const productIds = Array.from(
      new Set(
        orders
          .map((order) => order.product_id)
          .filter((value): value is number | string => value !== null && value !== undefined)
          .map(String)
      )
    );

    const [usersRes, productsRes] = await Promise.all([
      userIds.length
        ? supabase.from("users").select("user_id, username, first_name, last_name").in("user_id", userIds)
        : Promise.resolve({ data: [] as OrderUserLookupRow[] }),
      productIds.length
        ? supabase.from("products").select("id, name").in("id", productIds)
        : Promise.resolve({ data: [] as Array<{ id: number | string; name: string }> })
    ]);

    const usernamesByUserId: Record<string, string | null> = {};
    const displayNamesByUserId: Record<string, string | null> = {};
    for (const user of (usersRes.data as OrderUserLookupRow[] | null) || []) {
      if (user?.user_id === null || user?.user_id === undefined) continue;
      usernamesByUserId[String(user.user_id)] = user.username ?? null;
      displayNamesByUserId[String(user.user_id)] = buildDisplayName(user);
    }

    const productNamesById: Record<string, string> = {};
    for (const product of productsRes.data || []) {
      if (product?.id === null || product?.id === undefined) continue;
      productNamesById[String(product.id)] = String(product.name || `#${String(product.id)}`);
    }

    return NextResponse.json({
      success: true,
      data: {
        orders,
        totalCount: count ?? 0,
        page,
        pageSize,
        usernamesByUserId,
        displayNamesByUserId,
        productNamesById
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Không thể tải orders snapshot." },
      { status: 500 }
    );
  }
}

export const GET = withAdminApiTiming("GET /api/admin/orders", handleGET);
