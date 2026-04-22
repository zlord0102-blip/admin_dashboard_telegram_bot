import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/app/api/_shared/adminAuth";
import { canUseUnsafeMutationFallback } from "@/app/api/_shared/mutationFallback";
import {
  computeTelegramBroadcastTargets,
  createTelegramBroadcastJob,
  isTelegramBotConfigured,
  isTelegramBroadcastJobsReady,
  launchTelegramBroadcastJob,
  sendTelegramTextMessage,
  type TelegramSendFailure
} from "@/app/api/_shared/telegramBroadcastJobs";

const MAX_MESSAGE_LENGTH = 4096;
const BROADCAST_INVALID_CHAT_IDS_KEY = "broadcast_invalid_chat_ids";

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

const sendBroadcastInline = async (
  client: any,
  targets: number[],
  text: string
) => {
  let success = 0;
  let failed = 0;
  const invalidChatIds = await loadBroadcastInvalidChatIds(client).catch(() => new Set<number>());
  const newlyInvalidChatIds = new Set<number>();

  for (const chatId of targets) {
    const result = await sendTelegramTextMessage(chatId, text);
    if (result.ok) {
      success += 1;
      continue;
    }

    failed += 1;
    const failure = result as TelegramSendFailure;
    if (failure.isPermanent) {
      invalidChatIds.add(chatId);
      newlyInvalidChatIds.add(chatId);
    }
  }

  if (newlyInvalidChatIds.size) {
    try {
      await saveBroadcastInvalidChatIds(client, invalidChatIds);
    } catch {
      // Best-effort cache only.
    }
  }

  return {
    success,
    failed,
    blacklisted: newlyInvalidChatIds.size
  };
};

export async function POST(request: NextRequest) {
  if (!isTelegramBotConfigured()) {
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

  if (broadcast) {
    let snapshot;
    try {
      snapshot = await computeTelegramBroadcastTargets(supabase);
    } catch {
      return NextResponse.json({ error: "Failed to load users." }, { status: 500 });
    }

    if (!snapshot.targets.length) {
      return NextResponse.json({
        success: 0,
        failed: 0,
        total: snapshot.totalCandidates,
        attempted: 0,
        skipped: snapshot.skippedCount,
        blacklisted: 0
      });
    }

    let jobsReady = false;
    try {
      jobsReady = await isTelegramBroadcastJobsReady(supabase);
    } catch {
      jobsReady = false;
    }

    const backgroundReady = jobsReady && Boolean(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);

    if (backgroundReady) {
      try {
        const job = await createTelegramBroadcastJob(supabase, trimmedMessage, snapshot);
        if (!job) {
          return NextResponse.json({ error: "Không thể tạo broadcast job." }, { status: 500 });
        }

        launchTelegramBroadcastJob(job.id);
        return NextResponse.json(
          {
            queued: true,
            job,
            total: snapshot.totalCandidates,
            attempted: snapshot.targets.length,
            skipped: snapshot.skippedCount,
            blacklisted: 0
          },
          { status: 202 }
        );
      } catch {
        if (!canUseUnsafeMutationFallback()) {
          return NextResponse.json(
            {
              error:
                "Broadcast job chưa sẵn sàng. Hãy apply SQL mới và cấu hình SUPABASE_SECRET_KEY trước khi gửi."
            },
            { status: 503 }
          );
        }
      }
    } else if (!canUseUnsafeMutationFallback()) {
      return NextResponse.json(
        {
          error:
            "Broadcast job chưa sẵn sàng. Hãy apply SQL mới và cấu hình SUPABASE_SECRET_KEY trước khi gửi."
        },
        { status: 503 }
      );
    }

    const inlineResult = await sendBroadcastInline(supabase, snapshot.targets, trimmedMessage);
    return NextResponse.json({
      ...inlineResult,
      total: snapshot.totalCandidates,
      attempted: snapshot.targets.length,
      skipped: snapshot.skippedCount
    });
  }

  const targets = Array.from(
    new Set([userId].map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0))
  );

  let success = 0;
  let failed = 0;
  for (const chatId of targets) {
    const result = await sendTelegramTextMessage(chatId, trimmedMessage);
    if (result.ok) {
      success += 1;

      if (result.message_id) {
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
