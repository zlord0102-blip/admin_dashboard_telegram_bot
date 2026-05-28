"use client";

import { useEffect, useState } from "react";
import { fetchAdminFinanceQueue, performAdminFinanceAction } from "@/lib/adminFinanceClient";
import { ConfirmDialog, RowActionMenu } from "@/components/AdminUi";

interface Deposit {
  id: number;
  user_id: number;
  amount: number;
  code: string;
  status: string;
  created_at: string;
}

type PendingDepositAction = { type: "confirm" | "cancel"; deposit: Deposit } | null;

export default function DepositsPage() {
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"success" | "error" | null>(null);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingDepositAction>(null);

  const load = async () => {
    const snapshot = await fetchAdminFinanceQueue<Deposit>("deposit");
    setDeposits(snapshot.rows || []);
  };

  useEffect(() => {
    load().catch(() => setDeposits([]));
  }, []);

  const confirmDeposit = async (deposit: Deposit) => {
    const nextActionKey = `confirm:${deposit.id}`;
    setActionKey(nextActionKey);
    setStatus(null);
    setStatusTone(null);
    try {
      await performAdminFinanceAction("deposit", "confirm", deposit.id);
      setStatus(`✅ Đã duyệt yêu cầu nạp #${deposit.id}.`);
      setStatusTone("success");
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Không thể duyệt yêu cầu nạp tiền.");
      setStatusTone("error");
    } finally {
      setActionKey(null);
    }
  };

  const cancelDeposit = async (deposit: Deposit) => {
    const nextActionKey = `cancel:${deposit.id}`;
    setActionKey(nextActionKey);
    setStatus(null);
    setStatusTone(null);
    try {
      await performAdminFinanceAction("deposit", "cancel", deposit.id);
      setStatus(`✅ Đã từ chối yêu cầu nạp #${deposit.id}.`);
      setStatusTone("success");
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Không thể từ chối yêu cầu nạp tiền.");
      setStatusTone("error");
    } finally {
      setActionKey(null);
    }
  };

  const confirmPendingAction = async () => {
    if (!pendingAction) return;
    const action = pendingAction;
    if (action.type === "confirm") {
      await confirmDeposit(action.deposit);
    } else {
      await cancelDeposit(action.deposit);
    }
    setPendingAction(null);
  };

  return (
    <div className="grid" style={{ gap: 24 }}>
      <div className="topbar">
        <div>
          <h1 className="page-title">Deposits</h1>
          <p className="muted">Duyệt các yêu cầu nạp tiền.</p>
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
              <th>Mã</th>
              <th>Thời gian</th>
              <th>Hành động</th>
            </tr>
          </thead>
          <tbody>
            {deposits.map((deposit) => (
              <tr key={deposit.id}>
                <td>#{deposit.id}</td>
                <td>{deposit.user_id}</td>
                <td>{deposit.amount.toLocaleString()}</td>
                <td>{deposit.code}</td>
                <td>{new Date(deposit.created_at).toLocaleString()}</td>
                <td className="row-actions-cell">
                  <RowActionMenu items={[
                    {
                      label: actionKey === `confirm:${deposit.id}` ? "Đang duyệt..." : "Duyệt",
                      disabled: actionKey === `confirm:${deposit.id}` || actionKey === `cancel:${deposit.id}`,
                      onSelect: () => setPendingAction({ type: "confirm", deposit })
                    },
                    {
                      label: actionKey === `cancel:${deposit.id}` ? "Đang từ chối..." : "Từ chối",
                      tone: "danger",
                      disabled: actionKey === `confirm:${deposit.id}` || actionKey === `cancel:${deposit.id}`,
                      onSelect: () => setPendingAction({ type: "cancel", deposit })
                    }
                  ]} />
                </td>
              </tr>
            ))}
            {!deposits.length && (
              <tr>
                <td colSpan={6} className="muted">Không có yêu cầu pending.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={Boolean(pendingAction)}
        title={pendingAction?.type === "confirm" ? "Duyệt yêu cầu nạp?" : "Từ chối yêu cầu nạp?"}
        description={
          pendingAction ? (
            <>
              Yêu cầu #{pendingAction.deposit.id} của user {pendingAction.deposit.user_id}, số tiền{" "}
              <strong>{pendingAction.deposit.amount.toLocaleString()}đ</strong>, mã{" "}
              <strong>{pendingAction.deposit.code}</strong>.
            </>
          ) : null
        }
        confirmLabel={pendingAction?.type === "confirm" ? "Duyệt nạp" : "Từ chối"}
        tone={pendingAction?.type === "confirm" ? "primary" : "danger"}
        busy={Boolean(pendingAction && actionKey === `${pendingAction.type}:${pendingAction.deposit.id}`)}
        onConfirm={confirmPendingAction}
        onCancel={() => setPendingAction(null)}
      />
    </div>
  );
}
