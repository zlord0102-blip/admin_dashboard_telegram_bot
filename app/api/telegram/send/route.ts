import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/app/api/_shared/adminAuth";

const botToken = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "";
const MAX_MESSAGE_LENGTH = 4096;
const MAX_TELEGRAM_RETRIES = 2;
const BROADCAST_RATE_WINDOW_MS = 1000;
const WEBSITE_USER_ID_SENTINEL_BASE = 8_000_000_000_000;
const BROADCAST_INVALID_CHAT_IDS_KEY = "broadcast_invalid_chat_ids";

const toPositiveInt = (rawValue: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(String(rawValue || "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const BROADCAST_MAX_SENDS_PER_WINDOW = toPositiveInt(
  process.env.TELEGRAM_BROADCAST_MAX_PER_SECOND,
  30
);
const BROADCAST_WORKER_COUNT = toPositiveInt(process.env.TELEGRAM_BROADCAST_WORKERS, 40);
const BROADCAST_SLOT_SAFETY_MS = 15;

type BroadcastUserRow = {
  user_id: number | string | null;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
};

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

const fetchAllBroadcastUsers = async (client: any) => {
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

const fetchInboundChatIds = async (client: any) => {
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

const loadBroadcastInvalidChatIds = async (client: any) => {
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

const saveBroadcastInvalidChatIds = async (client: any, chatIds: Set<number>) => {
  const serialized = JSON.stringify(Array.from(chatIds).sort((a, b) => a - b));
  const { error } = await client
    .from("settings")
    .upsert([{ key: BROADCAST_INVALID_CHAT_IDS_KEY, value: serialized }], { onConflict: "key" });

  if (error) {
    throw error;
  }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getRetryAfterMs = (payload: unknown) => {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const retryAfter = (payload as { parameters?: { retry_after?: unknown } }).parameters?.retry_after;
  const seconds = Number(retryAfter);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
};

const sendTelegramMessage = async (
  chatId: number,
  text: string,
  attempt = 0,
  options?: {
    onRateLimit?: (retryAfterMs: number) => void;
  }
): Promise<
  | { ok: true; message_id: number | null; date: number | null; text: string }
  | { ok: false; status: number | null; description: string | null; isPermanent: boolean }
> => {
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
    return sendTelegramMessage(chatId, text, attempt + 1, options);
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
      ok: false as const,
      status: Number.isFinite(response.status) ? response.status : null,
      description,
      isPermanent
    };
  }
  const result = payload.result as { message_id?: number; date?: number; text?: string };
  return {
    ok: true as const,
    message_id: typeof result.message_id === "number" ? result.message_id : null,
    date: typeof result.date === "number" ? result.date : null,
    text: typeof result.text === "string" ? result.text : text
  };
};

const sendBroadcastMessages = async (
  targets: number[],
  text: string,
  options?: {
    onPermanentFailure?: (chatId: number) => void;
  }
) => {
  let success = 0;
  let failed = 0;
  let nextIndex = 0;
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

  const worker = async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= targets.length) {
        return;
      }

      const chatId = targets[currentIndex];
      await acquireBroadcastSlot();
      const result = await sendTelegramMessage(chatId, text, 0, {
        onRateLimit: setGlobalCooldown
      });

      if (result.ok) {
        success += 1;
      } else {
        failed += 1;
        if ("isPermanent" in result && result.isPermanent) {
          options?.onPermanentFailure?.(chatId);
        }
      }
    }
  };

  const workerCount = Math.min(
    Math.max(1, BROADCAST_WORKER_COUNT),
    Math.max(1, targets.length)
  );
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return { success, failed };
};

export async function POST(request: NextRequest) {
  if (!botToken) {
    return NextResponse.json({ error: "BOT_TOKEN missing." }, { status: 500 });
  }

  const adminSession = await requireAdminSession(request);
  if (adminSession.ok === false) {
    return adminSession.response;
  }

  let body: { message?: string; userId?: number | string; broadcast?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const message = (body.message ?? "").toString().trim();
  if (!message) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }

  const trimmedMessage = message.slice(0, MAX_MESSAGE_LENGTH);
  const supabase = adminSession.supabase;

  const broadcast = body.broadcast === true;
  const userId = body.userId ? Number(body.userId) : null;
  if (!broadcast && !userId) {
    return NextResponse.json({ error: "userId is required." }, { status: 400 });
  }

  let targets: number[] = [];
  let broadcastUsers: BroadcastUserRow[] = [];
  if (broadcast) {
    try {
      broadcastUsers = await fetchAllBroadcastUsers(supabase);
    } catch (error) {
      return NextResponse.json({ error: "Failed to load users." }, { status: 500 });
    }
  } else if (userId) {
    targets = [userId];
  }

  targets = broadcast
    ? Array.from(
        new Set(
          broadcastUsers
            .map((row) => Number(row.user_id))
            .filter((value) => Number.isFinite(value) && value > 0)
        )
      )
    : Array.from(
        new Set(targets.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0))
      );
  const totalCandidates = targets.length;

  if (!totalCandidates) {
    return NextResponse.json({ success: 0, failed: 0, total: 0, attempted: 0, skipped: 0, blacklisted: 0 });
  }

  if (broadcast) {
    let invalidChatIds = new Set<number>();
    let inboundChatIds = new Set<number>();
    try {
      invalidChatIds = await loadBroadcastInvalidChatIds(supabase);
    } catch {
      invalidChatIds = new Set<number>();
    }
    try {
      inboundChatIds = await fetchInboundChatIds(supabase);
    } catch {
      inboundChatIds = new Set<number>();
    }

    const eligibleTargets = broadcastUsers
      .map((row) => ({
        chatId: Number(row.user_id),
        hasProfile: hasProfileSignal(row)
      }))
      .filter(({ chatId }) => Number.isFinite(chatId) && chatId > 0)
      .filter(({ chatId }) => chatId < WEBSITE_USER_ID_SENTINEL_BASE)
      .filter(({ chatId }) => !invalidChatIds.has(chatId))
      .filter(({ chatId, hasProfile }) => inboundChatIds.has(chatId) || hasProfile);

    const filteredTargets = Array.from(new Set(eligibleTargets.map(({ chatId }) => chatId)));
    const skipped = totalCandidates - filteredTargets.length;
    const newlyInvalidChatIds = new Set<number>();

    const result = await sendBroadcastMessages(filteredTargets, trimmedMessage, {
      onPermanentFailure: (chatId) => {
        newlyInvalidChatIds.add(chatId);
      }
    });

    if (newlyInvalidChatIds.size) {
      for (const chatId of newlyInvalidChatIds) {
        invalidChatIds.add(chatId);
      }
      try {
        await saveBroadcastInvalidChatIds(supabase, invalidChatIds);
      } catch {
        // Best-effort cache only; do not fail broadcast response.
      }
    }

    return NextResponse.json({
      ...result,
      total: totalCandidates,
      attempted: filteredTargets.length,
      skipped,
      blacklisted: newlyInvalidChatIds.size
    });
  }

  let success = 0;
  let failed = 0;
  for (const chatId of targets) {
    const result = await sendTelegramMessage(chatId, trimmedMessage);
    if (result.ok) {
      success += 1;

      // Best-effort logging to support admin 1-1 chat history UI.
      // Avoid logging broadcasts here to prevent huge inserts + extra latency.
      if (!broadcast && result.message_id) {
        const sentAt = result.date ? new Date(result.date * 1000).toISOString() : new Date().toISOString();
        await supabase.from("telegram_messages").upsert(
          {
            chat_id: chatId,
            message_id: result.message_id,
            direction: "out",
            message_type: "text",
            text: result.text ?? trimmedMessage,
            payload: null,
            sent_at: sentAt
          },
          { onConflict: "chat_id,message_id" }
        );
      }
    } else {
      failed += 1;
    }
  }

  return NextResponse.json({ success, failed, total: targets.length });
}
