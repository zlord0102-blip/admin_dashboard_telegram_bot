"use client";

import { adminApiGet, adminApiRequest } from "@/lib/adminOpsClient";

export type FinanceResource = "deposit" | "withdrawal" | "usdt_withdrawal";
export type FinanceAction = "confirm" | "cancel";

export type AdminFinanceQueueSnapshot<T> = {
  resource: FinanceResource;
  status: string;
  rows: T[];
};

export async function fetchAdminFinanceQueue<T>(
  resource: FinanceResource,
  status = "pending"
): Promise<AdminFinanceQueueSnapshot<T>> {
  const params = new URLSearchParams({
    resource,
    status
  });
  return adminApiGet<AdminFinanceQueueSnapshot<T>>(`/api/admin-finance?${params.toString()}`);
}

export async function performAdminFinanceAction(
  resource: FinanceResource,
  action: FinanceAction,
  recordId: number
) {
  return adminApiRequest("/api/admin-finance", {
    method: "POST",
    body: JSON.stringify({
      resource,
      action,
      recordId
    })
  });
}
