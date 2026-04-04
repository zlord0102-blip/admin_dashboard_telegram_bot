"use client";

import { createContext, useContext } from "react";

export type AdminSessionSnapshot = {
  userId: string;
  email: string | null;
  role: string;
};

const AdminSessionContext = createContext<AdminSessionSnapshot | null>(null);

export function AdminSessionProvider({
  value,
  children
}: {
  value: AdminSessionSnapshot;
  children: React.ReactNode;
}) {
  return <AdminSessionContext.Provider value={value}>{children}</AdminSessionContext.Provider>;
}

export const useAdminSession = () => useContext(AdminSessionContext);
