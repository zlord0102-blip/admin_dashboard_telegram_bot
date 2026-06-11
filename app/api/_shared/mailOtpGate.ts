import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export type MailOtpGateRow = {
  id: number;
  email: string | null;
  normalized_email: string | null;
  display_order?: number | null;
  otp_plaintext?: string | null;
  otp_hash?: string | null;
  otp_salt?: string | null;
  active: boolean | null;
  note: string | null;
  last_checked_at: string | null;
  last_verified_at: string | null;
  check_count: number | null;
  verify_count: number | null;
  created_at: string | null;
  updated_at: string | null;
};

export type MailOtpGatePublic = {
  id: number;
  displayOrder: number;
  email: string;
  normalizedEmail: string;
  active: boolean;
  note: string;
  otp: string;
  hasOtp: boolean;
  lastCheckedAt: string | null;
  lastVerifiedAt: string | null;
  checkCount: number;
  verifyCount: number;
  createdAt: string | null;
  updatedAt: string | null;
};

const MAX_EMAIL_LENGTH = 254;
const MAX_NOTE_LENGTH = 500;
const MAX_OTP_LENGTH = 128;
const DEFAULT_RANDOM_OTP_LENGTH = 6;
const MIN_RANDOM_OTP_LENGTH = 4;
const MAX_RANDOM_OTP_LENGTH = 32;
const RANDOM_OTP_CHARS = "0123456789";

export const normalizeMailAddress = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .slice(0, MAX_EMAIL_LENGTH);

export const getMailAddressFromPayload = (body: Record<string, unknown> | null | undefined) =>
  body?.email ?? body?.mail ?? body?.address ?? "";

export const isValidMailAddress = (value: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= MAX_EMAIL_LENGTH;

export const normalizeNote = (value: unknown) =>
  String(value ?? "")
    .trim()
    .slice(0, MAX_NOTE_LENGTH);

export const normalizeActiveFlag = (value: unknown, fallback = true) => {
  if (value === true) return true;
  if (value === false) return false;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["true", "1", "yes", "y", "active", "on", "enabled"].includes(normalized)) return true;
  if (["false", "0", "no", "n", "inactive", "off", "disabled"].includes(normalized)) return false;
  return fallback;
};

export const parseOtpInput = (value: unknown) => {
  const otp = String(value ?? "").trim();
  if (!otp) return { otp: "" };
  if (otp.length > MAX_OTP_LENGTH) {
    return { otp: "", error: `OTP tối đa ${MAX_OTP_LENGTH} ký tự.` };
  }
  return { otp };
};

export const normalizeRandomOtpLength = (value: unknown, fallback = DEFAULT_RANDOM_OTP_LENGTH) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, MIN_RANDOM_OTP_LENGTH), MAX_RANDOM_OTP_LENGTH);
};

export const createRandomOtp = (length = DEFAULT_RANDOM_OTP_LENGTH) => {
  const safeLength = normalizeRandomOtpLength(length);
  let otp = "";
  for (let index = 0; index < safeLength; index += 1) {
    otp += RANDOM_OTP_CHARS[randomInt(RANDOM_OTP_CHARS.length)];
  }
  return otp;
};

const hashOtp = (otp: string, salt: string) =>
  createHash("sha256").update(`${salt}:${otp}`, "utf8").digest("hex");

export const createOtpSecret = (otp: string) => {
  const otp_salt = randomBytes(16).toString("hex");
  return {
    otp_salt,
    otp_hash: hashOtp(otp, otp_salt)
  };
};

export const verifyOtpSecret = (otp: string, salt: string | null | undefined, expectedHash: string | null | undefined) => {
  if (!otp || !salt || !expectedHash) return false;
  const actualHash = hashOtp(otp, salt);
  const expected = Buffer.from(expectedHash, "hex");
  const actual = Buffer.from(actualHash, "hex");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
};

export const toMailOtpGatePublic = (row: MailOtpGateRow): MailOtpGatePublic => ({
  id: Number(row.id),
  displayOrder: Number(row.display_order ?? 0),
  email: String(row.email || row.normalized_email || ""),
  normalizedEmail: String(row.normalized_email || ""),
  active: row.active !== false,
  note: String(row.note || ""),
  otp: String(row.otp_plaintext || ""),
  hasOtp: Boolean(row.otp_hash && row.otp_salt),
  lastCheckedAt: row.last_checked_at || null,
  lastVerifiedAt: row.last_verified_at || null,
  checkCount: Number(row.check_count || 0),
  verifyCount: Number(row.verify_count || 0),
  createdAt: row.created_at || null,
  updatedAt: row.updated_at || null
});
