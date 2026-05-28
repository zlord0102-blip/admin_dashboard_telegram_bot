"use client";

import { useEffect, useState } from "react";
import { fetchAdminFinanceQueue, performAdminFinanceAction } from "@/lib/adminFinanceClient";
import { ConfirmDialog, RowActionMenu } from "@/components/AdminUi";

interface Withdrawal {
  id: number;
  user_id: number;
  amount: number;
  momo_phone: string;
  status: string;
  created_at: string;
}

type PendingWithdrawalAction = { type: "confirm" | "cancel"; withdrawal: Withdrawal } | null;

export default function WithdrawalsPage() {
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"success" | "error" | null>(null);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingWithdrawalAction>(null);

  const load = async () => {
    const snapshot = await fetchAdminFinanceQueue<Withdrawal>("withdrawal");
    setWithdrawals(snapshot.rows || []);
  };

  useEffect(() => {
    load().catch(() => setWithdrawals([]));
  }, []);

  const confirmWithdrawal = async (withdrawal: Withdrawal) => {
    const nextActionKey = `confirm:${withdrawal.id}`;
    setActionKey(nextActionKey);
    setStatus(null);
    setStatusTone(null);
    try {
      await performAdminFinanceAction("withdrawal", "confirm", withdrawal.id);
      setStatus(`✅ Đã duyệt yêu cầu rút #${withdrawal.id}.`);
      setStatusTone("success");
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Không thể duyệt yêu cầu rút tiền.");
      setStatusTone("error");
    } finally {
      setActionKey(null);
    }
  };

  const cancelWithdrawal = async (withdrawal: Withdrawal) => {
    const nextActionKey = `cancel:${withdrawal.id}`;
    setActionKey(nextActionKey);
    setStatus(null);
    setStatusTone(null);
    try {
      await performAdminFinanceAction("withdrawal", "cancel", withdrawal.id);
      setStatus(`✅ Đã từ chối yêu cầu rút #${withdrawal.id}.`);
      setStatusTone("success");
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Không thể từ chối yêu cầu rút tiền.");
      setStatusTone("error");
    } finally {
      setActionKey(null);
    }
  };

  const confirmPendingAction = async () => {
    if (!pendingAction) return;
    const action = pendingAction;
    if (action.type === "confirm") {
      await confirmWithdrawal(action.withdrawal);
    } else {
      await cancelWithdrawal(action.withdrawal);
    }
    setPendingAction(null);
  };

  return (
    <div className="grid" style={{ gap: 24 }}>
      <div className="topbar">
        <div>
          <h1 className="page-title">Withdrawals</h1>
          <p className="muted">Duyệt các yêu cầu rút tiền.</p>
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
        <table className="table">
          <thead>
            <tr>
              <th>ID</th>
              <th>User</th>
              <th>Số tiền</th>
              <th>Momo</th>
              <th>Thời gian</th>
              <th>Hành động</th>
            </tr>
          </thead>
          <tbody>
            {withdrawals.map((withdrawal) => (
              <tr key={withdrawal.id}>
                <td>#{withdrawal.id}</td>
                <td>{withdrawal.user_id}</td>
                <td>{withdrawal.amount.toLocaleString()}</td>
                <td>{withdrawal.momo_phone}</td>
                <td>{new Date(withdrawal.created_at).toLocaleString()}</td>
                <td className="row-actions-cell">
                  <RowActionMenu items={[
                    {
                      label: actionKey === `confirm:${withdrawal.id}` ? "Đang duyệt..." : "Duyệt",
                      disabled: actionKey === `confirm:${withdrawal.id}` || actionKey === `cancel:${withdrawal.id}`,
                      onSelect: () => setPendingAction({ type: "confirm", withdrawal })
                    },
                    {
                      label: actionKey === `cancel:${withdrawal.id}` ? "Đang từ chối..." : "Từ chối",
                      tone: "danger",
                      disabled: actionKey === `confirm:${withdrawal.id}` || actionKey === `cancel:${withdrawal.id}`,
                      onSelect: () => setPendingAction({ type: "cancel", withdrawal })
                    }
                  ]} />
                </td>
              </tr>
            ))}
            {!withdrawals.length && (
              <tr>
                <td colSpan={6} className="muted">Không có yêu cầu pending.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={Boolean(pendingAction)}
        title={pendingAction?.type === "confirm" ? "Duyệt yêu cầu rút?" : "Từ chối yêu cầu rút?"}
        description={
          pendingAction ? (
            <>
              Yêu cầu #{pendingAction.withdrawal.id} của user {pendingAction.withdrawal.user_id}, số tiền{" "}
              <strong>{pendingAction.withdrawal.amount.toLocaleString()}đ</strong>, Momo{" "}
              <strong>{pendingAction.withdrawal.momo_phone}</strong>.
            </>
          ) : null
        }
        confirmLabel={pendingAction?.type === "confirm" ? "Duyệt rút" : "Từ chối"}
        tone={pendingAction?.type === "confirm" ? "primary" : "danger"}
        busy={Boolean(pendingAction && actionKey === `${pendingAction.type}:${pendingAction.withdrawal.id}`)}
        onConfirm={confirmPendingAction}
        onCancel={() => setPendingAction(null)}
      />
    </div>
  );
}
