"use client";

import { useEffect, useState } from "react";
import { fetchAdminFinanceQueue, performAdminFinanceAction } from "@/lib/adminFinanceClient";
import { ConfirmDialog, RowActionMenu } from "@/components/AdminUi";

interface UsdtWithdrawal {
  id: number;
  user_id: number;
  usdt_amount: number;
  wallet_address: string;
  network: string;
  status: string;
  created_at: string;
}

type PendingUsdtAction = { type: "confirm" | "cancel"; withdrawal: UsdtWithdrawal } | null;

export default function UsdtPage() {
  const [usdtWithdrawals, setUsdtWithdrawals] = useState<UsdtWithdrawal[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"success" | "error" | null>(null);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingUsdtAction>(null);

  const load = async () => {
    const snapshot = await fetchAdminFinanceQueue<UsdtWithdrawal>("usdt_withdrawal");
    setUsdtWithdrawals(snapshot.rows || []);
  };

  useEffect(() => {
    load().catch(() => setUsdtWithdrawals([]));
  }, []);

  const confirmUsdtWithdrawal = async (withdrawal: UsdtWithdrawal) => {
    const nextActionKey = `withdraw_confirm:${withdrawal.id}`;
    setActionKey(nextActionKey);
    setStatus(null);
    setStatusTone(null);
    try {
      await performAdminFinanceAction("usdt_withdrawal", "confirm", withdrawal.id);
      setStatus(`✅ Đã duyệt yêu cầu rút USDT #${withdrawal.id}.`);
      setStatusTone("success");
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Không thể duyệt yêu cầu rút USDT.");
      setStatusTone("error");
    } finally {
      setActionKey(null);
    }
  };

  const cancelUsdtWithdrawal = async (withdrawal: UsdtWithdrawal) => {
    const nextActionKey = `withdraw_cancel:${withdrawal.id}`;
    setActionKey(nextActionKey);
    setStatus(null);
    setStatusTone(null);
    try {
      await performAdminFinanceAction("usdt_withdrawal", "cancel", withdrawal.id);
      setStatus(`✅ Đã từ chối yêu cầu rút USDT #${withdrawal.id}.`);
      setStatusTone("success");
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Không thể từ chối yêu cầu rút USDT.");
      setStatusTone("error");
    } finally {
      setActionKey(null);
    }
  };

  const confirmPendingAction = async () => {
    if (!pendingAction) return;
    const action = pendingAction;
    if (action.type === "confirm") {
      await confirmUsdtWithdrawal(action.withdrawal);
    } else {
      await cancelUsdtWithdrawal(action.withdrawal);
    }
    setPendingAction(null);
  };

  return (
    <div className="grid" style={{ gap: 24 }}>
      <div className="topbar">
        <div>
          <h1 className="page-title">USDT</h1>
          <p className="muted">Quản lý yêu cầu rút USDT. Nạp Binance on-chain mới được xác nhận tự động trong checker.</p>
        </div>
      </div>

      <div className="card">
        {status && (
          <p
            className="muted"
            style={{
              marginBottom: 12,
              color: statusTone === "error" ? "var(--danger)" : "#20705b"
            }}
          >
            {status}
          </p>
        )}
        <h3 className="section-title">Rút USDT</h3>
        <table className="table">
          <thead>
            <tr>
              <th>ID</th>
              <th>User</th>
              <th>USDT</th>
              <th>Wallet</th>
              <th>Network</th>
              <th>Time</th>
              <th>Hành động</th>
            </tr>
          </thead>
          <tbody>
            {usdtWithdrawals.map((withdrawal) => (
              <tr key={withdrawal.id}>
                <td>#{withdrawal.id}</td>
                <td>{withdrawal.user_id}</td>
                <td>{withdrawal.usdt_amount}</td>
                <td>{withdrawal.wallet_address}</td>
                <td>{withdrawal.network}</td>
                <td>{new Date(withdrawal.created_at).toLocaleString()}</td>
                <td className="row-actions-cell">
                  <RowActionMenu items={[
                    {
                      label: actionKey === `withdraw_confirm:${withdrawal.id}` ? "Đang duyệt..." : "Duyệt",
                      disabled: actionKey === `withdraw_confirm:${withdrawal.id}` || actionKey === `withdraw_cancel:${withdrawal.id}`,
                      onSelect: () => setPendingAction({ type: "confirm", withdrawal })
                    },
                    {
                      label: actionKey === `withdraw_cancel:${withdrawal.id}` ? "Đang từ chối..." : "Từ chối",
                      tone: "danger",
                      disabled: actionKey === `withdraw_confirm:${withdrawal.id}` || actionKey === `withdraw_cancel:${withdrawal.id}`,
                      onSelect: () => setPendingAction({ type: "cancel", withdrawal })
                    }
                  ]} />
                </td>
              </tr>
            ))}
            {!usdtWithdrawals.length && (
              <tr>
                <td colSpan={7} className="muted">Không có yêu cầu.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={Boolean(pendingAction)}
        title={pendingAction?.type === "confirm" ? "Duyệt rút USDT?" : "Từ chối rút USDT?"}
        description={
          pendingAction ? (
            <>
              Yêu cầu #{pendingAction.withdrawal.id} của user {pendingAction.withdrawal.user_id}, số tiền{" "}
              <strong>{pendingAction.withdrawal.usdt_amount} USDT</strong> qua mạng{" "}
              <strong>{pendingAction.withdrawal.network}</strong>.
            </>
          ) : null
        }
        confirmLabel={pendingAction?.type === "confirm" ? "Duyệt rút" : "Từ chối"}
        tone={pendingAction?.type === "confirm" ? "primary" : "danger"}
        busy={Boolean(
          pendingAction &&
            actionKey === `withdraw_${pendingAction.type}:${pendingAction.withdrawal.id}`
        )}
        onConfirm={confirmPendingAction}
        onCancel={() => setPendingAction(null)}
      />
    </div>
  );
}
