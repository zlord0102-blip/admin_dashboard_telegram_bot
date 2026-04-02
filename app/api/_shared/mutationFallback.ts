const parseBooleanEnv = (value: string | undefined | null): boolean | null => {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return null;
};

const readUnsafeFallbackOverride = () => {
  const candidates = [
    process.env.ADMIN_ALLOW_UNSAFE_MUTATION_FALLBACK,
    process.env.ADMIN_ALLOW_MUTATION_FALLBACK,
    process.env.ALLOW_UNSAFE_MUTATION_FALLBACK
  ];
  for (const value of candidates) {
    const parsed = parseBooleanEnv(value);
    if (parsed != null) {
      return parsed;
    }
  }
  return null;
};

const isProductionLikeEnv = () => {
  const override = readUnsafeFallbackOverride();
  if (override != null) {
    return !override;
  }
  const nodeEnv = String(process.env.NODE_ENV || "").trim().toLowerCase();
  const vercelEnv = String(process.env.VERCEL_ENV || "").trim().toLowerCase();
  const appEnv = String(process.env.APP_ENV || "").trim().toLowerCase();
  return nodeEnv === "production" || vercelEnv === "production" || appEnv === "production";
};

export const canUseUnsafeMutationFallback = () => !isProductionLikeEnv();

export const buildMissingRequiredRpcMessage = (rpcName: string) =>
  `Thiếu RPC bắt buộc (${rpcName}). Hãy apply SQL/migration mới nhất trước khi tiếp tục.`;
