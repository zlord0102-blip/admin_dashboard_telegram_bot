"use client";

import { supabase } from "@/lib/supabaseClient";
import type {
  LicenseActivationRecord,
  LicenseExtensionRecord,
  LicenseKeyAdminStatus,
  LicenseKeyDeviceLimitMode,
  LicenseKeyRecord
} from "@/lib/licenseTypes";

type AdminResponse<T> = {
  success?: boolean;
  data?: T;
  error?: string;
};

const LICENSE_GET_CACHE_TTL_MS = 5_000;
const licenseGetCache = new Map<string, { expiresAt: number; data: unknown }>();
const licenseGetRequests = new Map<string, Promise<unknown>>();

const getAccessToken = async () => {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new Error("Chưa đăng nhập.");
  }
  return token;
};

async function requestAdminApi<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getAccessToken();
  const method = String(init?.method || "GET").toUpperCase();
  const cacheKey = `${token}:${method}:${path}`;
  const now = Date.now();

  if (method === "GET") {
    const cached = licenseGetCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.data as T;
    }

    const pending = licenseGetRequests.get(cacheKey);
    if (pending) {
      return pending as Promise<T>;
    }
  }

  const request = (async () => {
    const response = await fetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(init?.headers || {})
      },
      cache: "no-store"
    });

    const payload = (await response.json().catch(() => null)) as AdminResponse<T> | null;
    if (!response.ok) {
      throw new Error(payload?.error || "Không thể tải dữ liệu.");
    }

    const result = payload?.data as T;
    if (method === "GET") {
      licenseGetCache.set(cacheKey, {
        data: result,
        expiresAt: Date.now() + LICENSE_GET_CACHE_TTL_MS
      });
    } else {
      licenseGetCache.clear();
    }
    return result;
  })();

  if (method === "GET") {
    licenseGetRequests.set(cacheKey, request as Promise<unknown>);
  }

  try {
    return await request;
  } finally {
    licenseGetRequests.delete(cacheKey);
  }
}

export const fetchLicenseExtensions = () =>
  requestAdminApi<LicenseExtensionRecord[]>("/api/licenses/extensions");

export const saveLicenseExtension = (payload: {
  id?: number;
  code?: string;
  name?: string;
  description?: string;
  isActive?: boolean;
  action?: "save" | "delete";
}) =>
  requestAdminApi<{ ok: true; id?: number }>("/api/licenses/extensions", {
    method: "POST",
    body: JSON.stringify(payload)
  });

export const fetchLicenseKeys = (filters?: {
  extensionId?: number | null;
  status?: LicenseKeyAdminStatus | "all";
}) => {
  const params = new URLSearchParams();
  if (filters?.extensionId) {
    params.set("extensionId", String(filters.extensionId));
  }
  if (filters?.status && filters.status !== "all") {
    params.set("status", filters.status);
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return requestAdminApi<LicenseKeyRecord[]>(`/api/licenses/keys${suffix}`);
};

export const saveLicenseKey = (payload: {
  id?: number;
  extensionId?: number;
  expiresAt?: string;
  note?: string;
  deviceLimitMode?: LicenseKeyDeviceLimitMode;
}) =>
  requestAdminApi<{ ok: true; id: number; rawKey?: string; maskedKey?: string; prunedActivationCount?: number }>(
    "/api/licenses/keys",
    {
    method: "POST",
    body: JSON.stringify(payload)
    }
  );

export const revokeLicenseKey = (id: number) =>
  requestAdminApi<{ ok: true }>(`/api/licenses/keys/${id}/revoke`, {
    method: "POST"
  });

export const reactivateLicenseKey = (id: number) =>
  requestAdminApi<{ ok: true }>(`/api/licenses/keys/${id}/reactivate`, {
    method: "POST"
  });

export const resetLicenseKeyActivation = (id: number) =>
  requestAdminApi<{ ok: true }>(`/api/licenses/keys/${id}/reset-activation`, {
    method: "POST"
  });

export const fetchLicenseActivations = (filters?: {
  extensionId?: number | null;
  activeOnly?: boolean;
}) => {
  const params = new URLSearchParams();
  if (filters?.extensionId) {
    params.set("extensionId", String(filters.extensionId));
  }
  if (filters?.activeOnly) {
    params.set("activeOnly", "true");
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return requestAdminApi<LicenseActivationRecord[]>(`/api/licenses/activations${suffix}`);
};

export const resetLicenseActivation = (id: number) =>
  requestAdminApi<{ ok: true; alreadyReset?: boolean }>(`/api/licenses/activations/${id}/reset`, {
    method: "POST"
  });
