import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAdminSession } from "@/app/api/_shared/adminAuth";
import {
  buildMissingRequiredRpcMessage,
  canUseUnsafeMutationFallback
} from "@/app/api/_shared/mutationFallback";

type FinanceResource = "deposit" | "withdrawal" | "usdt_withdrawal";
type FinanceAction = "confirm" | "cancel";

type FinanceRequestBody = {
  resource?: FinanceResource;
  action?: FinanceAction;
  recordId?: number | string;
};

type FinanceActionResult =
  | { ok: true; data: Record<string, unknown> | null }
  | { ok: false; status: number; error: string };

const RPC_BY_ACTION: Record<
  FinanceResource,
  Record<FinanceAction, string>
> = {
  deposit: {
    confirm: "admin_confirm_deposit",
    cancel: "admin_cancel_deposit"
  },
  withdrawal: {
    confirm: "admin_confirm_withdrawal",
    cancel: "admin_cancel_withdrawal"
  },
  usdt_withdrawal: {
    confirm: "admin_confirm_usdt_withdrawal",
    cancel: "admin_cancel_usdt_withdrawal"
  }
};

const normalizeRpcData = (data: unknown) => {
  if (Array.isArray(data)) {
    return (data[0] as Record<string, unknown> | undefined) ?? null;
  }
  return (data as Record<string, unknown> | null) ?? null;
};

const isMissingRpcError = (message: string) => {
  const lowered = message.toLowerCase();
  return (
    lowered.includes("could not find the function") ||
    lowered.includes("schema cache") ||
    lowered.includes("pgrst202")
  );
};

const mapBusinessError = (message: string) => {
  const lowered = message.toLowerCase();
  if (lowered.includes("forbidden")) {
    return { status: 403, error: "Forbidden." };
  }
  if (
    lowered.includes("deposit_not_found") ||
    lowered.includes("withdrawal_not_found") ||
    lowered.includes("usdt_withdrawal_not_found") ||
    lowered.includes("user_not_found")
  ) {
    return { status: 404, error: "Không tìm thấy dữ liệu cần xử lý." };
  }
  if (
    lowered.includes("deposit_not_pending") ||
    lowered.includes("withdrawal_not_pending") ||
    lowered.includes("usdt_withdrawal_not_pending")
  ) {
    return { status: 409, error: "Yêu cầu không còn ở trạng thái chờ xử lý." };
  }
  if (lowered.includes("insufficient_balance")) {
    return { status: 409, error: "Không đủ số dư." };
  }
  if (lowered.includes("insufficient_usdt_balance")) {
    return { status: 409, error: "Không đủ số dư USDT." };
  }
  return null;
};

const runRpcAction = async (
  supabase: SupabaseClient,
  resource: FinanceResource,
  action: FinanceAction,
  recordId: number
): Promise<FinanceActionResult | null> => {
  const rpcName = RPC_BY_ACTION[resource][action];
  const { data, error } = await supabase.rpc(rpcName, { p_id: recordId });

  if (error) {
    if (isMissingRpcError(error.message || "")) {
      if (!canUseUnsafeMutationFallback()) {
        return {
          ok: false,
          status: 503,
          error: buildMissingRequiredRpcMessage(rpcName)
        };
      }
      return null;
    }
    const mapped = mapBusinessError(error.message || "");
    return {
      ok: false,
      status: mapped?.status ?? 500,
      error: mapped?.error ?? (error.message || "Không thể xử lý yêu cầu.")
    };
  }

  return {
    ok: true,
    data: normalizeRpcData(data)
  };
};

const notPending = (): FinanceActionResult => ({
  ok: false,
  status: 409,
  error: "Yêu cầu không còn ở trạng thái chờ xử lý."
});

const fallbackDepositAction = async (
  supabase: SupabaseClient,
  action: FinanceAction,
  recordId: number
): Promise<FinanceActionResult> => {
  const { data: deposit, error: depositError } = await supabase
    .from("deposits")
    .select("id, user_id, amount, status")
    .eq("id", recordId)
    .maybeSingle();

  if (depositError || !deposit) {
    return { ok: false, status: 404, error: "Không tìm thấy yêu cầu nạp tiền." };
  }
  if (deposit.status !== "pending") {
    return notPending();
  }

  if (action === "cancel") {
    const { error } = await supabase
      .from("deposits")
      .update({ status: "cancelled" })
      .eq("id", deposit.id);
    if (error) {
      return { ok: false, status: 500, error: error.message || "Không thể hủy yêu cầu nạp tiền." };
    }
    return {
      ok: true,
      data: {
        record_id: deposit.id,
        status: "cancelled"
      }
    };
  }

  const { data: userRow, error: userError } = await supabase
    .from("users")
    .select("balance")
    .eq("user_id", deposit.user_id)
    .maybeSingle();
  if (userError || !userRow) {
    return { ok: false, status: 404, error: "Không tìm thấy user." };
  }

  const nextBalance = Number(userRow.balance || 0) + Number(deposit.amount || 0);
  const { error: balanceError } = await supabase
    .from("users")
    .update({ balance: nextBalance })
    .eq("user_id", deposit.user_id);
  if (balanceError) {
    return { ok: false, status: 500, error: balanceError.message || "Không thể cộng số dư." };
  }

  const { error: updateError } = await supabase
    .from("deposits")
    .update({ status: "confirmed" })
    .eq("id", deposit.id);
  if (updateError) {
    return { ok: false, status: 500, error: updateError.message || "Không thể duyệt yêu cầu nạp tiền." };
  }

  return {
    ok: true,
    data: {
      record_id: deposit.id,
      user_id: deposit.user_id,
      status: "confirmed",
      new_balance: nextBalance
    }
  };
};

const fallbackWithdrawalAction = async (
  supabase: SupabaseClient,
  action: FinanceAction,
  recordId: number
): Promise<FinanceActionResult> => {
  const { data: withdrawal, error: withdrawalError } = await supabase
    .from("withdrawals")
    .select("id, user_id, amount, status")
    .eq("id", recordId)
    .maybeSingle();

  if (withdrawalError || !withdrawal) {
    return { ok: false, status: 404, error: "Không tìm thấy yêu cầu rút tiền." };
  }
  if (withdrawal.status !== "pending") {
    return notPending();
  }

  if (action === "cancel") {
    const { error } = await supabase
      .from("withdrawals")
      .update({ status: "cancelled" })
      .eq("id", withdrawal.id);
    if (error) {
      return { ok: false, status: 500, error: error.message || "Không thể hủy yêu cầu rút tiền." };
    }
    return {
      ok: true,
      data: {
        record_id: withdrawal.id,
        status: "cancelled"
      }
    };
  }

  const { data: userRow, error: userError } = await supabase
    .from("users")
    .select("balance")
    .eq("user_id", withdrawal.user_id)
    .maybeSingle();
  if (userError || !userRow) {
    return { ok: false, status: 404, error: "Không tìm thấy user." };
  }

  const currentBalance = Number(userRow.balance || 0);
  const amount = Number(withdrawal.amount || 0);
  if (currentBalance < amount) {
    return { ok: false, status: 409, error: "Không đủ số dư." };
  }

  const nextBalance = currentBalance - amount;
  const { error: balanceError } = await supabase
    .from("users")
    .update({ balance: nextBalance })
    .eq("user_id", withdrawal.user_id);
  if (balanceError) {
    return { ok: false, status: 500, error: balanceError.message || "Không thể trừ số dư." };
  }

  const { error: updateError } = await supabase
    .from("withdrawals")
    .update({ status: "confirmed" })
    .eq("id", withdrawal.id);
  if (updateError) {
    return { ok: false, status: 500, error: updateError.message || "Không thể duyệt yêu cầu rút tiền." };
  }

  return {
    ok: true,
    data: {
      record_id: withdrawal.id,
      user_id: withdrawal.user_id,
      status: "confirmed",
      new_balance: nextBalance
    }
  };
};

const fallbackUsdtWithdrawalAction = async (
  supabase: SupabaseClient,
  action: FinanceAction,
  recordId: number
): Promise<FinanceActionResult> => {
  const { data: withdrawal, error: withdrawalError } = await supabase
    .from("usdt_withdrawals")
    .select("id, user_id, usdt_amount, status")
    .eq("id", recordId)
    .maybeSingle();

  if (withdrawalError || !withdrawal) {
    return { ok: false, status: 404, error: "Không tìm thấy yêu cầu rút USDT." };
  }
  if (withdrawal.status !== "pending") {
    return notPending();
  }

  if (action === "cancel") {
    const { error } = await supabase
      .from("usdt_withdrawals")
      .update({ status: "cancelled" })
      .eq("id", withdrawal.id);
    if (error) {
      return { ok: false, status: 500, error: error.message || "Không thể hủy yêu cầu rút USDT." };
    }
    return {
      ok: true,
      data: {
        record_id: withdrawal.id,
        status: "cancelled"
      }
    };
  }

  const { data: userRow, error: userError } = await supabase
    .from("users")
    .select("balance_usdt")
    .eq("user_id", withdrawal.user_id)
    .maybeSingle();
  if (userError || !userRow) {
    return { ok: false, status: 404, error: "Không tìm thấy user." };
  }

  const currentBalance = Number(userRow.balance_usdt || 0);
  const amount = Number(withdrawal.usdt_amount || 0);
  if (currentBalance < amount) {
    return { ok: false, status: 409, error: "Không đủ số dư USDT." };
  }

  const nextBalance = currentBalance - amount;
  const { error: balanceError } = await supabase
    .from("users")
    .update({ balance_usdt: nextBalance })
    .eq("user_id", withdrawal.user_id);
  if (balanceError) {
    return { ok: false, status: 500, error: balanceError.message || "Không thể trừ số dư USDT." };
  }

  const { error: updateError } = await supabase
    .from("usdt_withdrawals")
    .update({ status: "confirmed" })
    .eq("id", withdrawal.id);
  if (updateError) {
    return { ok: false, status: 500, error: updateError.message || "Không thể duyệt yêu cầu rút USDT." };
  }

  return {
    ok: true,
    data: {
      record_id: withdrawal.id,
      user_id: withdrawal.user_id,
      status: "confirmed",
      new_balance: nextBalance
    }
  };
};

const runFallbackAction = (
  supabase: SupabaseClient,
  resource: FinanceResource,
  action: FinanceAction,
  recordId: number
) => {
  switch (resource) {
    case "deposit":
      return fallbackDepositAction(supabase, action, recordId);
    case "withdrawal":
      return fallbackWithdrawalAction(supabase, action, recordId);
    case "usdt_withdrawal":
      return fallbackUsdtWithdrawalAction(supabase, action, recordId);
    default:
      return Promise.resolve({
        ok: false,
        status: 400,
        error: "resource không hợp lệ."
      } satisfies FinanceActionResult);
  }
};

export async function POST(request: NextRequest) {
  const adminSession = await requireAdminSession(request);
  if (adminSession.ok === false) {
    return adminSession.response;
  }

  let body: FinanceRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const resource = body.resource;
  const action = body.action;
  const recordId = body.recordId ? Number(body.recordId) : NaN;

  if (
    !resource ||
    !(resource in RPC_BY_ACTION) ||
    !action ||
    !(action in RPC_BY_ACTION[resource as FinanceResource]) ||
    !Number.isInteger(recordId) ||
    recordId <= 0
  ) {
    return NextResponse.json({ error: "Payload không hợp lệ." }, { status: 400 });
  }

  const rpcResult = await runRpcAction(adminSession.supabase, resource, action, recordId);
  const result =
    rpcResult ??
    (await runFallbackAction(adminSession.supabase, resource, action, recordId));

  if (result.ok === false) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    success: true,
    data: result.data
  });
}
