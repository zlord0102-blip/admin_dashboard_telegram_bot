import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdminClient } from "@/app/api/_shared/supabaseAdmin";

const botToken = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "";
const MAX_TELEGRAM_RETRIES = 2;
const BROADCAST_RATE_WINDOW_MS = 1000;
const WEBSITE_USER_ID_SENTINEL_BASE = 8_000_000_000_000;
const BROADCAST_INVALID_CHAT_IDS_KEY = "broadcast_invalid_chat_ids";
const BROADCAST_SLOT_SAFETY_MS = 15;
const BROADCAST_JOB_BATCH_SIZE = 500;
const BROADCAST_JOB_HEARTBEAT_EVERY = 25;
const BROADCAST_JOB_STALE_MS = 30_000;

const toPositiveInt = (rawValue: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(String(rawValue || "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const BROADCAST_MAX_SENDS_PER_WINDOW = toPositiveInt(
  process.env.TELEGRAM_BROADCAST_MAX_PER_SECOND,
  30
);
const BROADCAST_WORKER_COUNT = toPositiveInt(process.env.TELEGRAM_BROADCAST_WORKERS, 40);

type BroadcastUserRow = {
  user_id: number | string | null;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
};

type BroadcastTargetRow = {
  id: number;
  chat_id: number;
  attempt_count: number;
};

type BroadcastJobRow = {
  id: number;
  status: TelegramBroadcastJobStatus;
  message: string;
  total_candidates: number;
  total_targets: number;
  skipped_count: number;
  blacklisted_count: number;
  last_error: string | null;
  started_at: string | null;
  finished_at: string | null;
  last_heartbeat_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type TelegramBroadcastJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type TelegramBroadcastJobSnapshot = {
  id: number;
  status: TelegramBroadcastJobStatus;
  message: string;
  totalCandidates: number;
  totalTargets: number;
  skippedCount: number;
  blacklistedCount: number;
  sentCount: number;
  failedCount: number;
  pendingCount: number;
  sendingCount: number;
  startedAt: string | null;
  finishedAt: string | null;
  lastHeartbeatAt: string | null;
  lastError: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type TelegramBroadcastTargetSnapshot = {
  totalCandidates: number;
  skippedCount: number;
  targets: number[];
};

export type TelegramSendSuccess = {
  ok: true;
  message_id: number | null;
  date: number | null;
  text: string;
};

export type TelegramSendFailure = {
  ok: false;
  status: number | null;
  description: string | null;
  isPermanent: boolean;
};

type TelegramSendResult = TelegramSendSuccess | TelegramSendFailure;

const parseStoredChatIds = (rawValue: string | null | undefined) => {
  if (!rawValue) return [];
  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) return [];
    return Array.from(
      new Set(
        parsed
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value) && value > 0)
      )
    );
  } catch {
    return [];
  }
};

const toOptionalString = (rawValue: unknown) => {
  const text = typeof rawValue === "string" ? rawValue.trim() : "";
  return text || null;
};

const hasProfileSignal = (row: BroadcastUserRow) =>
  Boolean(toOptionalString(row.username) || toOptionalString(row.first_name) || toOptionalString(row.last_name));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getRetryAfterMs = (payload: unknown) => {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const retryAfter = (payload as { parameters?: { retry_after?: unknown } }).parameters?.retry_after;
  const seconds = Number(retryAfter);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
};

const isMissingBroadcastJobsTableError = (message: string) => {
  const lowered = message.toLowerCase();
  return (
    lowered.includes("telegram_broadcast_jobs") ||
    lowered.includes("telegram_broadcast_job_targets") ||
    lowered.includes("could not find the table") ||
    lowered.includes("schema cache") ||
    lowered.includes("pgrst205") ||
    lowered.includes("does not exist")
  );
};

const normalizeJobRow = (value: unknown): BroadcastJobRow | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Record<string, unknown>;
  return {
    id: Number(row.id || 0),
    status: String(row.status || "queued") as TelegramBroadcastJobStatus,
    message: String(row.message || ""),
    total_candidates: Number(row.total_candidates || 0),
    total_targets: Number(row.total_targets || 0),
    skipped_count: Number(row.skipped_count || 0),
    blacklisted_count: Number(row.blacklisted_count || 0),
    last_error: row.last_error == null ? null : String(row.last_error),
    started_at: row.started_at == null ? null : String(row.started_at),
    finished_at: row.finished_at == null ? null : String(row.finished_at),
    last_heartbeat_at: row.last_heartbeat_at == null ? null : String(row.last_heartbeat_at),
    created_at: row.created_at == null ? null : String(row.created_at),
    updated_at: row.updated_at == null ? null : String(row.updated_at)
  };
};

const fetchAllBroadcastUsers = async (client: SupabaseClient) => {
  const rows: BroadcastUserRow[] = [];
  const pageSize = 1000;
  let from = 0;

  while (true) {
    const { data, error } = await client
      .from("users")
      .select("user_id, username, first_name, last_name")
      .order("user_id", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) {
      throw error;
    }

    if (!data || data.length === 0) {
      break;
    }

    rows.push(...((data as BroadcastUserRow[]) || []));

    if (data.length < pageSize) {
      break;
    }
    from += pageSize;
  }

  return rows;
};

const fetchInboundChatIds = async (client: SupabaseClient) => {
  const chatIds = new Set<number>();
  const pageSize = 5000;
  let from = 0;

  while (true) {
    const { data, error } = await client
      .from("telegram_messages")
      .select("chat_id, message_id")
      .eq("direction", "in")
      .order("chat_id", { ascending: true })
      .order("message_id", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) {
      throw error;
    }

    const chunk = (data as Array<{ chat_id: number | string | null }>) || [];
    if (!chunk.length) {
      break;
    }

    for (const row of chunk) {
      const chatId = Number(row.chat_id);
      if (Number.isFinite(chatId) && chatId > 0) {
        chatIds.add(chatId);
      }
    }

    if (chunk.length < pageSize) {
      break;
    }

    from += pageSize;
  }

  return chatIds;
};

const loadBroadcastInvalidChatIds = async (client: SupabaseClient) => {
  const { data, error } = await client
    .from("settings")
    .select("value")
    .eq("key", BROADCAST_INVALID_CHAT_IDS_KEY)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return new Set<number>(parseStoredChatIds(data?.value));
};

const saveBroadcastInvalidChatIds = async (client: SupabaseClient, chatIds: Set<number>) => {
  const serialized = JSON.stringify(Array.from(chatIds).sort((a, b) => a - b));
  const { error } = await client
    .from("settings")
    .upsert([{ key: BROADCAST_INVALID_CHAT_IDS_KEY, value: serialized }], { onConflict: "key" });

  if (error) {
    throw error;
  }
};

const countTargetsByStatus = async (
  client: SupabaseClient,
  jobId: number,
  status: "pending" | "sending" | "sent" | "failed"
) => {
  const { count, error } = await client
    .from("telegram_broadcast_job_targets")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId)
    .eq("status", status);

  if (error) {
    throw error;
  }

  return Number(count || 0);
};

const getJobRow = async (client: SupabaseClient, jobId: number) => {
  const { data, error } = await client
    .from("telegram_broadcast_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();

  if (error) {
    if (isMissingBroadcastJobsTableError(error.message || "")) {
      return null;
    }
    throw error;
  }

  return normalizeJobRow(data);
};

const touchJob = async (client: SupabaseClient, jobId: number, payload: Record<string, unknown>) => {
  const { error } = await client
    .from("telegram_broadcast_jobs")
    .update(payload)
    .eq("id", jobId);

  if (error) {
    throw error;
  }
};

const fetchPendingTargets = async (client: SupabaseClient, jobId: number, limit: number) => {
  const { data, error } = await client
    .from("telegram_broadcast_job_targets")
    .select("id, chat_id, attempt_count")
    .eq("job_id", jobId)
    .eq("status", "pending")
    .order("id", { ascending: true })
    .limit(limit);

  if (error) {
    throw error;
  }

  return ((data as Array<Record<string, unknown>>) || [])
    .map((row) => ({
      id: Number(row.id || 0),
      chat_id: Number(row.chat_id || 0),
      attempt_count: Number(row.attempt_count || 0)
    }))
    .filter((row) => row.id > 0 && row.chat_id > 0) as BroadcastTargetRow[];
};

const resetSendingTargetsToPending = async (client: SupabaseClient, jobId: number) => {
  const { error } = await client
    .from("telegram_broadcast_job_targets")
    .update({ status: "pending" })
    .eq("job_id", jobId)
    .eq("status", "sending");

  if (error) {
    throw error;
  }
};

const markTargetSending = async (client: SupabaseClient, row: BroadcastTargetRow, attemptCount: number) => {
  const { error } = await client
    .from("telegram_broadcast_job_targets")
    .update({
      status: "sending",
      attempt_count: attemptCount,
      last_attempt_at: new Date().toISOString(),
      error_text: null
    })
    .eq("id", row.id);

  if (error) {
    throw error;
  }
};

const markTargetSent = async (
  client: SupabaseClient,
  row: BroadcastTargetRow,
  attemptCount: number,
  result: TelegramSendSuccess
) => {
  const sentAt =
    typeof result.date === "number"
      ? new Date(result.date * 1000).toISOString()
      : new Date().toISOString();

  const { error } = await client
    .from("telegram_broadcast_job_targets")
    .update({
      status: "sent",
      attempt_count: attemptCount,
      error_text: null,
      message_id: result.message_id,
      sent_at: sentAt,
      last_attempt_at: new Date().toISOString()
    })
    .eq("id", row.id);

  if (error) {
    throw error;
  }
};

const markTargetFailed = async (
  client: SupabaseClient,
  row: BroadcastTargetRow,
  attemptCount: number,
  result: TelegramSendFailure
) => {
  const { error } = await client
    .from("telegram_broadcast_job_targets")
    .update({
      status: "failed",
      attempt_count: attemptCount,
      error_text: String(result.description || `HTTP ${result.status || "unknown"}`).slice(0, 2000),
      last_attempt_at: new Date().toISOString()
    })
    .eq("id", row.id);

  if (error) {
    throw error;
  }
};

const chunkArray = <T,>(items: T[], chunkSize: number) => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
};

const createRateLimiter = () => {
  let cooldownUntil = 0;
  const recentSendStarts: number[] = [];

  const setGlobalCooldown = (retryAfterMs: number) => {
    const safeDelay = Math.max(retryAfterMs, BROADCAST_RATE_WINDOW_MS);
    cooldownUntil = Math.max(cooldownUntil, Date.now() + safeDelay);
  };

  const acquireBroadcastSlot = async () => {
    while (true) {
      const now = Date.now();

      if (cooldownUntil > now) {
        await sleep(cooldownUntil - now);
        continue;
      }

      while (recentSendStarts.length && now - recentSendStarts[0] >= BROADCAST_RATE_WINDOW_MS) {
        recentSendStarts.shift();
      }

      if (recentSendStarts.length < BROADCAST_MAX_SENDS_PER_WINDOW) {
        recentSendStarts.push(now);
        return;
      }

      const waitMs = Math.max(
        BROADCAST_SLOT_SAFETY_MS,
        BROADCAST_RATE_WINDOW_MS - (now - recentSendStarts[0]) + BROADCAST_SLOT_SAFETY_MS
      );
      await sleep(waitMs);
    }
  };

  return {
    acquireBroadcastSlot,
    setGlobalCooldown
  };
};

const processTargetBatch = async (
  client: SupabaseClient,
  jobId: number,
  message: string,
  rows: BroadcastTargetRow[],
  invalidChatIds: Set<number>
) => {
  let nextIndex = 0;
  let processed = 0;
  let newlyBlacklisted = 0;
  const rateLimiter = createRateLimiter();

  const worker = async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= rows.length) {
        return;
      }

      const row = rows[currentIndex];
      const attemptCount = row.attempt_count + 1;
      await markTargetSending(client, row, attemptCount);
      await rateLimiter.acquireBroadcastSlot();
      const result = await sendTelegramTextMessage(row.chat_id, message, 0, {
        onRateLimit: rateLimiter.setGlobalCooldown
      });

      if (result.ok) {
        await markTargetSent(client, row, attemptCount, result);
      } else {
        const failure = result as TelegramSendFailure;
        await markTargetFailed(client, row, attemptCount, failure);
        if (failure.isPermanent && !invalidChatIds.has(row.chat_id)) {
          invalidChatIds.add(row.chat_id);
          newlyBlacklisted += 1;
        }
      }

      processed += 1;
      if (processed % BROADCAST_JOB_HEARTBEAT_EVERY === 0) {
        await touchJob(client, jobId, { last_heartbeat_at: new Date().toISOString() });
      }
    }
  };

  const workerCount = Math.min(Math.max(1, BROADCAST_WORKER_COUNT), Math.max(1, rows.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return { newlyBlacklisted };
};

export const isTelegramBotConfigured = () => Boolean(botToken);

export async function sendTelegramTextMessage(
  chatId: number,
  text: string,
  attempt = 0,
  options?: {
    onRateLimit?: (retryAfterMs: number) => void;
  }
): Promise<TelegramSendResult> {
  if (!botToken) {
    return {
      ok: false,
      status: null,
      description: "BOT_TOKEN missing.",
      isPermanent: false
    };
  }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text
    })
  });

  const payload = await response.json().catch(() => null);
  if (response.status === 429 && attempt < MAX_TELEGRAM_RETRIES) {
    const retryAfterMs = getRetryAfterMs(payload) ?? 1000;
    options?.onRateLimit?.(retryAfterMs);
    await sleep(retryAfterMs);
    return sendTelegramTextMessage(chatId, text, attempt + 1, options);
  }

  if (!response.ok || !payload || payload.ok !== true || !payload.result) {
    const description =
      payload && typeof payload === "object" && typeof (payload as { description?: unknown }).description === "string"
        ? (payload as { description: string }).description
        : null;
    const lowered = String(description || "").toLowerCase();
    const isPermanent =
      response.status === 403 ||
      lowered.includes("chat not found") ||
      lowered.includes("user is deactivated") ||
      lowered.includes("bot was blocked by the user");
    return {
      ok: false,
      status: Number.isFinite(response.status) ? response.status : null,
      description,
      isPermanent
    };
  }

  const result = payload.result as { message_id?: number; date?: number; text?: string };
  return {
    ok: true,
    message_id: typeof result.message_id === "number" ? result.message_id : null,
    date: typeof result.date === "number" ? result.date : null,
    text: typeof result.text === "string" ? result.text : text
  };
}

export const isTelegramBroadcastJobsReady = async (client: SupabaseClient) => {
  const checks = await Promise.all([
    client.from("telegram_broadcast_jobs").select("id").limit(1),
    client.from("telegram_broadcast_job_targets").select("id").limit(1)
  ]);

  return checks.every(({ error }) => {
    if (!error) return true;
    if (isMissingBroadcastJobsTableError(error.message || "")) {
      return false;
    }
    throw error;
  });
};

export const computeTelegramBroadcastTargets = async (
  client: SupabaseClient
): Promise<TelegramBroadcastTargetSnapshot> => {
  const broadcastUsers = await fetchAllBroadcastUsers(client);
  let invalidChatIds = new Set<number>();
  let inboundChatIds = new Set<number>();

  try {
    invalidChatIds = await loadBroadcastInvalidChatIds(client);
  } catch {
    invalidChatIds = new Set<number>();
  }

  try {
    inboundChatIds = await fetchInboundChatIds(client);
  } catch {
    inboundChatIds = new Set<number>();
  }

  const allTargets = Array.from(
    new Set(
      broadcastUsers
        .map((row) => Number(row.user_id))
        .filter((value) => Number.isFinite(value) && value > 0)
    )
  );

  const eligibleTargets = broadcastUsers
    .map((row) => ({
      chatId: Number(row.user_id),
      hasProfile: hasProfileSignal(row)
    }))
    .filter(({ chatId }) => Number.isFinite(chatId) && chatId > 0)
    .filter(({ chatId }) => chatId < WEBSITE_USER_ID_SENTINEL_BASE)
    .filter(({ chatId }) => !invalidChatIds.has(chatId))
    .filter(({ chatId, hasProfile }) => inboundChatIds.has(chatId) || hasProfile);

  const targets = Array.from(new Set(eligibleTargets.map(({ chatId }) => chatId)));
  return {
    totalCandidates: allTargets.length,
    skippedCount: Math.max(0, allTargets.length - targets.length),
    targets
  };
};

export const createTelegramBroadcastJob = async (
  client: SupabaseClient,
  message: string,
  snapshot: TelegramBroadcastTargetSnapshot
) => {
  const { data, error } = await client
    .from("telegram_broadcast_jobs")
    .insert({
      status: "queued",
      message,
      total_candidates: snapshot.totalCandidates,
      total_targets: snapshot.targets.length,
      skipped_count: snapshot.skippedCount,
      blacklisted_count: 0,
      last_error: null
    })
    .select("*")
    .maybeSingle();

  if (error) {
    throw error;
  }

  const job = normalizeJobRow(data);
  if (!job) {
    throw new Error("Không thể tạo telegram broadcast job.");
  }

  const targetRows = snapshot.targets.map((chatId) => ({
    job_id: job.id,
    chat_id: chatId,
    status: "pending"
  }));

  for (const chunk of chunkArray(targetRows, 1000)) {
    if (!chunk.length) continue;
    const { error: insertError } = await client
      .from("telegram_broadcast_job_targets")
      .insert(chunk);

    if (insertError) {
      throw insertError;
    }
  }

  return getTelegramBroadcastJobSnapshot(client, job.id);
};

export const getTelegramBroadcastJobSnapshot = async (
  client: SupabaseClient,
  jobId: number
): Promise<TelegramBroadcastJobSnapshot | null> => {
  const job = await getJobRow(client, jobId);
  if (!job) {
    return null;
  }

  const [pendingCount, sendingCount, sentCount, failedCount] = await Promise.all([
    countTargetsByStatus(client, jobId, "pending"),
    countTargetsByStatus(client, jobId, "sending"),
    countTargetsByStatus(client, jobId, "sent"),
    countTargetsByStatus(client, jobId, "failed")
  ]);

  return {
    id: job.id,
    status: job.status,
    message: job.message,
    totalCandidates: job.total_candidates,
    totalTargets: job.total_targets,
    skippedCount: job.skipped_count,
    blacklistedCount: job.blacklisted_count,
    sentCount,
    failedCount,
    pendingCount,
    sendingCount,
    startedAt: job.started_at,
    finishedAt: job.finished_at,
    lastHeartbeatAt: job.last_heartbeat_at,
    lastError: job.last_error,
    createdAt: job.created_at,
    updatedAt: job.updated_at
  };
};

export const isTelegramBroadcastJobActive = (status: TelegramBroadcastJobStatus) =>
  status === "queued" || status === "running";

export const isTelegramBroadcastJobStale = (job: TelegramBroadcastJobSnapshot) => {
  if (!isTelegramBroadcastJobActive(job.status)) {
    return false;
  }
  if (!job.lastHeartbeatAt) {
    return true;
  }
  const heartbeat = new Date(job.lastHeartbeatAt);
  if (Number.isNaN(heartbeat.getTime())) {
    return true;
  }
  return Date.now() - heartbeat.getTime() >= BROADCAST_JOB_STALE_MS;
};

const getGlobalJobWorkerState = () => {
  const globalState = globalThis as typeof globalThis & {
    __telegramBroadcastWorkers?: Map<number, Promise<void>>;
  };
  if (!globalState.__telegramBroadcastWorkers) {
    globalState.__telegramBroadcastWorkers = new Map<number, Promise<void>>();
  }
  return globalState.__telegramBroadcastWorkers;
};

const processTelegramBroadcastJob = async (jobId: number) => {
  const admin = getSupabaseAdminClient();
  const job = await getJobRow(admin, jobId);
  if (!job || job.status === "completed" || job.status === "cancelled") {
    return;
  }

  try {
    await resetSendingTargetsToPending(admin, jobId);
    await touchJob(admin, jobId, {
      status: "running",
      started_at: job.started_at || new Date().toISOString(),
      finished_at: null,
      last_error: null,
      last_heartbeat_at: new Date().toISOString()
    });

    const invalidChatIds = await loadBroadcastInvalidChatIds(admin).catch(() => new Set<number>());
    let newlyBlacklisted = 0;

    while (true) {
      const pendingRows = await fetchPendingTargets(admin, jobId, BROADCAST_JOB_BATCH_SIZE);
      if (!pendingRows.length) {
        break;
      }

      const batchResult = await processTargetBatch(admin, jobId, job.message, pendingRows, invalidChatIds);
      newlyBlacklisted += batchResult.newlyBlacklisted;
      await touchJob(admin, jobId, {
        last_heartbeat_at: new Date().toISOString()
      });
    }

    if (newlyBlacklisted > 0) {
      try {
        await saveBroadcastInvalidChatIds(admin, invalidChatIds);
      } catch {
        // Best-effort cache only.
      }
    }

    await touchJob(admin, jobId, {
      status: "completed",
      blacklisted_count: newlyBlacklisted,
      finished_at: new Date().toISOString(),
      last_heartbeat_at: new Date().toISOString(),
      last_error: null
    });
  } catch (error) {
    await touchJob(admin, jobId, {
      status: "failed",
      finished_at: new Date().toISOString(),
      last_heartbeat_at: new Date().toISOString(),
      last_error: String((error as Error)?.message || error || "telegram_broadcast_job_failed").slice(0, 2000)
    }).catch(() => undefined);
  }
};

export const launchTelegramBroadcastJob = (jobId: number) => {
  if (!Number.isInteger(jobId) || jobId <= 0) {
    return false;
  }

  const workers = getGlobalJobWorkerState();
  if (workers.has(jobId)) {
    return true;
  }

  const promise = processTelegramBroadcastJob(jobId)
    .catch(() => undefined)
    .finally(() => {
      workers.delete(jobId);
    });

  workers.set(jobId, promise);
  return true;
};
