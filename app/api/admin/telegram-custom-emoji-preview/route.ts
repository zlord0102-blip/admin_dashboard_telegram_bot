import { gunzipSync } from "node:zlib";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/app/api/_shared/adminAuth";
import { withAdminApiTiming } from "@/app/api/_shared/serverTiming";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TELEGRAM_API_BASE = "https://api.telegram.org";
const CUSTOM_EMOJI_ID_PATTERN = /^[0-9]{5,64}$/;
const MAX_TGS_BYTES = 2 * 1024 * 1024;

const getBotToken = () =>
  (process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || process.env.NEXT_TELEGRAM_BOT_TOKEN || "").trim();

const telegramJson = async <T>(token: string, method: string, body: Record<string, unknown>): Promise<T> => {
  const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store"
  });
  const json = await response.json().catch(() => null);
  if (!response.ok || !json?.ok) {
    throw new Error(typeof json?.description === "string" ? json.description : "telegram_api_error");
  }
  return json.result as T;
};

async function handleGET(request: NextRequest) {
  const adminSession = await requireAdminSession(request);
  if (adminSession.ok === false) {
    return adminSession.response;
  }

  const customEmojiId = (request.nextUrl.searchParams.get("customEmojiId") || "").trim();
  if (!CUSTOM_EMOJI_ID_PATTERN.test(customEmojiId)) {
    return NextResponse.json({ error: "Custom emoji ID không hợp lệ." }, { status: 400 });
  }

  const token = getBotToken();
  if (!token) {
    return NextResponse.json(
      { error: "Dashboard thiếu BOT_TOKEN để tải preview custom emoji." },
      { status: 500 }
    );
  }

  try {
    const stickers = await telegramJson<any[]>(token, "getCustomEmojiStickers", {
      custom_emoji_ids: [customEmojiId]
    });
    const sticker = Array.isArray(stickers) ? stickers[0] : null;
    const fileId = typeof sticker?.file_id === "string" ? sticker.file_id : "";
    if (!fileId) {
      return NextResponse.json({ error: "Không tìm thấy file custom emoji từ Telegram." }, { status: 404 });
    }

    const file = await telegramJson<{ file_path?: string; file_size?: number }>(token, "getFile", {
      file_id: fileId
    });
    const filePath = typeof file?.file_path === "string" ? file.file_path : "";
    if (!filePath || !filePath.toLowerCase().endsWith(".tgs")) {
      return NextResponse.json(
        { error: "Custom emoji này không có file .tgs để render animation." },
        { status: 422 }
      );
    }

    const fileResponse = await fetch(`${TELEGRAM_API_BASE}/file/bot${token}/${filePath}`, {
      cache: "no-store"
    });
    if (!fileResponse.ok) {
      return NextResponse.json({ error: "Không thể tải file .tgs từ Telegram." }, { status: 502 });
    }

    const compressed = Buffer.from(await fileResponse.arrayBuffer());
    if (compressed.byteLength > MAX_TGS_BYTES) {
      return NextResponse.json({ error: "File .tgs quá lớn để preview." }, { status: 413 });
    }

    const animationData = JSON.parse(gunzipSync(compressed).toString("utf8"));
    return NextResponse.json(
      {
        success: true,
        customEmojiId,
        fileUniqueId: sticker?.file_unique_id || null,
        animationData
      },
      {
        headers: {
          "Cache-Control": "private, max-age=3600"
        }
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "custom_emoji_preview_error";
    return NextResponse.json(
      { error: message === "telegram_api_error" ? "Telegram không trả về preview hợp lệ." : message },
      { status: 502 }
    );
  }
}

export const GET = withAdminApiTiming("GET /api/admin/telegram-custom-emoji-preview", handleGET);
