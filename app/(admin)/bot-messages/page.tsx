"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { DataTable, EmptyState, PageHeader, SectionCard, StatCard, StatusPill } from "@/components/AdminUi";
import { supabase } from "@/lib/supabaseClient";

type BotMessageTemplate = {
  template_key: string;
  language: "vi" | "en";
  title: string;
  description: string | null;
  body_text: string;
  custom_emoji_id: string | null;
  fallback_emoji: string | null;
  enabled: boolean;
  variables: string[] | null;
  updated_at: string | null;
};

type StatusState = {
  tone: "success" | "danger" | "warning";
  text: string;
} | null;

const createEmptyTemplate = (): BotMessageTemplate => ({
  template_key: "",
  language: "vi",
  title: "",
  description: "",
  body_text: "",
  custom_emoji_id: "",
  fallback_emoji: "",
  enabled: true,
  variables: [],
  updated_at: null
});

const normalizeCustomEmojiId = (value: string) => value.replace(/\D/g, "").slice(0, 64);
const normalizeTemplateKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9_.:-]/g, "_").slice(0, 80);
const telegramEmojiPreviewCache = new Map<string, unknown>();
const telegramEmojiPreviewRequests = new Map<string, Promise<unknown>>();

const fetchTelegramEmojiPreview = async (customEmojiId: string) => {
  const cached = telegramEmojiPreviewCache.get(customEmojiId);
  if (cached) return cached;
  const pending = telegramEmojiPreviewRequests.get(customEmojiId);
  if (pending) return pending;

  const request = (async () => {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    if (!token) {
      throw new Error("Chưa đăng nhập");
    }

    const response = await fetch(
      `/api/admin/telegram-custom-emoji-preview?customEmojiId=${encodeURIComponent(customEmojiId)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store"
      }
    );
    const json = await response.json().catch(() => null);
    if (!response.ok || !json?.animationData) {
      throw new Error(typeof json?.error === "string" ? json.error : "Không thể tải .tgs");
    }
    telegramEmojiPreviewCache.set(customEmojiId, json.animationData);
    return json.animationData;
  })();

  telegramEmojiPreviewRequests.set(customEmojiId, request);
  try {
    return await request;
  } finally {
    telegramEmojiPreviewRequests.delete(customEmojiId);
  }
};

const formatDateTime = (value: string | null) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
};

const getTemplateScope = (templateKey: string) => {
  if (templateKey.startsWith("reply.")) return "Reply";
  if (templateKey.startsWith("button.") || templateKey.includes("button")) return "Button";
  if (templateKey.includes("payment") || templateKey.includes("quantity")) return "Checkout";
  if (templateKey.includes("sale")) return "Sale";
  if (templateKey.includes("support")) return "Support";
  if (templateKey.includes("history")) return "History";
  return "General";
};

function TelegramCustomEmojiPreview({
  customEmojiId,
  compact = false
}: {
  customEmojiId: string | null;
  compact?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    const cleanId = normalizeCustomEmojiId(customEmojiId || "");
    if (!cleanId) {
      setState("idle");
      setError("");
      if (containerRef.current) containerRef.current.innerHTML = "";
      return;
    }

    let cancelled = false;
    let animation: { destroy: () => void } | null = null;

    const loadAnimation = async () => {
      setState("loading");
      setError("");
      const animationData = await fetchTelegramEmojiPreview(cleanId);

      const lottie = await import("lottie-web");
      if (cancelled || !containerRef.current) return;
      containerRef.current.innerHTML = "";
      animation = lottie.default.loadAnimation({
        container: containerRef.current,
        renderer: "svg",
        loop: true,
        autoplay: true,
        animationData
      });
      setState("ready");
    };

    loadAnimation().catch((loadError) => {
      if (cancelled) return;
      setState("error");
      setError(loadError instanceof Error ? loadError.message : "Không thể render .tgs");
    });

    return () => {
      cancelled = true;
      animation?.destroy();
    };
  }, [customEmojiId]);

  if (!normalizeCustomEmojiId(customEmojiId || "")) return null;

  return (
    <span className={`bot-custom-emoji-preview${compact ? " is-compact" : ""}`} title={error || "Telegram .tgs custom emoji"}>
      <span ref={containerRef} className="bot-custom-emoji-canvas" aria-hidden="true" />
      {state === "loading" && <span className="bot-custom-emoji-state">...</span>}
      {state === "error" && <span className="bot-custom-emoji-state is-error">!</span>}
    </span>
  );
}

export default function BotMessagesPage() {
  const [templates, setTemplates] = useState<BotMessageTemplate[]>([]);
  const [selected, setSelected] = useState<BotMessageTemplate>(createEmptyTemplate);
  const [status, setStatus] = useState<StatusState>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("");
  const [languageFilter, setLanguageFilter] = useState<"all" | "vi" | "en">("all");
  const [scopeFilter, setScopeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "enabled" | "disabled">("all");
  const [emojiFilter, setEmojiFilter] = useState<"all" | "custom" | "fallback" | "plain">("all");
  const [templateKeyFilter, setTemplateKeyFilter] = useState("all");

  const selectedId = `${selected.template_key}:${selected.language}`;

  const stats = useMemo(() => {
    const enabled = templates.filter((template) => template.enabled).length;
    const customEmoji = templates.filter((template) => template.custom_emoji_id).length;
    const vi = templates.filter((template) => template.language === "vi").length;
    const en = templates.filter((template) => template.language === "en").length;
    return { enabled, customEmoji, vi, en };
  }, [templates]);

  const filteredTemplates = useMemo(() => {
    const query = filter.trim().toLowerCase();
    return templates.filter((template) => {
      if (languageFilter !== "all" && template.language !== languageFilter) return false;
      const scope = getTemplateScope(template.template_key);
      if (scopeFilter !== "all" && scope !== scopeFilter) return false;
      if (templateKeyFilter !== "all" && template.template_key !== templateKeyFilter) return false;
      if (statusFilter === "enabled" && !template.enabled) return false;
      if (statusFilter === "disabled" && template.enabled) return false;
      if (emojiFilter === "custom" && !template.custom_emoji_id) return false;
      if (emojiFilter === "fallback" && (template.custom_emoji_id || !template.fallback_emoji)) return false;
      if (emojiFilter === "plain" && (template.custom_emoji_id || template.fallback_emoji)) return false;
      if (!query) return true;
      return [
        template.template_key,
        template.language,
        template.title,
        template.description || "",
        template.body_text,
        scope
      ].some((value) => value.toLowerCase().includes(query));
    });
  }, [emojiFilter, filter, languageFilter, scopeFilter, statusFilter, templateKeyFilter, templates]);

  const scopeOptions = useMemo(
    () => Array.from(new Set(templates.map((template) => getTemplateScope(template.template_key)))).sort(),
    [templates]
  );

  const templateKeyOptions = useMemo(
    () => Array.from(new Set(templates.map((template) => template.template_key))).sort(),
    [templates]
  );

  const selectedVariables = selected.variables || [];
  const hasCustomEmojiPreview = Boolean(normalizeCustomEmojiId(selected.custom_emoji_id || ""));
  const previewPrefix = hasCustomEmojiPreview
    ? ""
    : selected.fallback_emoji
      ? `${selected.fallback_emoji} `
      : "";
  const previewBody = selected.body_text || "Nội dung Bot message";
  const previewButtonLabel = `${previewPrefix}${previewBody}`.replace(/\s+/g, " ").trim();

  const loadTemplates = async () => {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    if (!token) {
      setStatus({ tone: "danger", text: "Chưa đăng nhập." });
      return;
    }

    setLoading(true);
    const response = await fetch("/api/admin/bot-messages", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store"
    });
    const json = await response.json().catch(() => null);
    setLoading(false);

    if (!response.ok) {
      setStatus({
        tone: "danger",
        text: typeof json?.error === "string" ? json.error : "Không thể tải Bot messages."
      });
      return;
    }

    const rows = (json?.data || []) as BotMessageTemplate[];
    setTemplates(rows);
    setSelected((current) => {
      const stillExists = rows.find(
        (item) => item.template_key === current.template_key && item.language === current.language
      );
      if (stillExists) return stillExists;
      return rows[0] || createEmptyTemplate();
    });
  };

  useEffect(() => {
    loadTemplates();
  }, []);

  const updateSelected = (patch: Partial<BotMessageTemplate>) => {
    setSelected((current) => ({ ...current, ...patch }));
  };

  const saveTemplate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    if (!token) {
      setStatus({ tone: "danger", text: "Chưa đăng nhập." });
      return;
    }

    setSaving(true);
    const response = await fetch("/api/admin/bot-messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        templateKey: selected.template_key,
        language: selected.language,
        title: selected.title,
        description: selected.description || "",
        bodyText: selected.body_text,
        customEmojiId: selected.custom_emoji_id || "",
        fallbackEmoji: selected.fallback_emoji || "",
        enabled: selected.enabled,
        variables: selected.variables || []
      })
    });
    const json = await response.json().catch(() => null);
    setSaving(false);

    if (!response.ok) {
      setStatus({
        tone: "danger",
        text: typeof json?.error === "string" ? json.error : "Không thể lưu Bot message."
      });
      return;
    }

    const saved = json?.data as BotMessageTemplate | undefined;
    if (saved) setSelected(saved);
    setStatus({ tone: "success", text: "Đã lưu Bot message. Bot sẽ đọc bản mới sau tối đa khoảng 60 giây." });
    await loadTemplates();
  };

  return (
    <div className="grid bot-messages-page">
      <PageHeader
        title="Bot Messages"
        description="Quản lý text, emoji thường và Telegram custom emoji cho các màn hình Bot."
        actions={
          <>
            <button className="button secondary" type="button" onClick={loadTemplates} disabled={loading}>
              {loading ? "Đang tải..." : "Tải lại"}
            </button>
            <button className="button" type="button" onClick={() => setSelected(createEmptyTemplate())}>
              Template mới
            </button>
          </>
        }
      />

      <div className="grid stats">
        <StatCard label="Templates" value={templates.length} glow="green" sub={`${stats.enabled} đang bật`} />
        <StatCard label="Custom emoji" value={stats.customEmoji} glow="blue" sub="Telegram emoji ID" />
        <StatCard label="Vietnamese" value={stats.vi} glow="gold" sub="Ngôn ngữ VI" />
        <StatCard label="English" value={stats.en} glow="purple" sub="Ngôn ngữ EN" />
      </div>

      {status && (
        <div className={`bot-message-alert ${status.tone}`}>
          {status.text}
        </div>
      )}

      <div className="bot-messages-layout">
        <SectionCard
          title="Templates"
          actions={<span className="muted">{filteredTemplates.length} hiển thị</span>}
          noPad
        >
          <div className="bot-template-toolbar">
            <input
              className="input"
              placeholder="Tìm key, title, nội dung..."
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
            <select
              className="select"
              value={templateKeyFilter}
              onChange={(event) => setTemplateKeyFilter(event.target.value)}
            >
              <option value="all">Tất cả template key</option>
              {templateKeyOptions.map((templateKey) => (
                <option key={templateKey} value={templateKey}>
                  {templateKey}
                </option>
              ))}
            </select>
            <select
              className="select"
              value={scopeFilter}
              onChange={(event) => setScopeFilter(event.target.value)}
            >
              <option value="all">Tất cả scope</option>
              {scopeOptions.map((scope) => (
                <option key={scope} value={scope}>
                  {scope}
                </option>
              ))}
            </select>
            <select
              className="select"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as "all" | "enabled" | "disabled")}
            >
              <option value="all">Tất cả trạng thái</option>
              <option value="enabled">Enabled</option>
              <option value="disabled">Disabled</option>
            </select>
            <select
              className="select"
              value={emojiFilter}
              onChange={(event) => setEmojiFilter(event.target.value as "all" | "custom" | "fallback" | "plain")}
            >
              <option value="all">Tất cả emoji</option>
              <option value="custom">Custom emoji</option>
              <option value="fallback">Fallback emoji</option>
              <option value="plain">Không emoji</option>
            </select>
            <div className="segmented-control" aria-label="Lọc ngôn ngữ">
              {(["all", "vi", "en"] as const).map((language) => (
                <button
                  className={languageFilter === language ? "active" : ""}
                  key={language}
                  type="button"
                  onClick={() => setLanguageFilter(language)}
                >
                  {language === "all" ? "All" : language.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {filteredTemplates.length ? (
            <DataTable>
              <thead>
                <tr>
                  <th>Template</th>
                  <th>Scope</th>
                  <th>Lang</th>
                  <th>Emoji</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredTemplates.map((template) => {
                  const isSelected = selectedId === `${template.template_key}:${template.language}`;
                  return (
                    <tr className={isSelected ? "is-selected" : ""} key={`${template.template_key}:${template.language}`}>
                      <td>
                        <button
                          className="bot-template-select"
                          type="button"
                          onClick={() => setSelected(template)}
                        >
                          <strong>{template.template_key}</strong>
                          <span>{template.title}</span>
                        </button>
                      </td>
                      <td><span className="bot-message-chip">{getTemplateScope(template.template_key)}</span></td>
                      <td><span className="bot-message-lang">{template.language.toUpperCase()}</span></td>
                      <td title={template.custom_emoji_id || ""}>
                        {template.custom_emoji_id ? (
                          <span className="bot-message-emoji-id">{template.custom_emoji_id.slice(0, 10)}...</span>
                        ) : (
                          template.fallback_emoji || "-"
                        )}
                      </td>
                      <td>
                        <StatusPill tone={template.enabled ? "success" : "warning"}>
                          {template.enabled ? "On" : "Off"}
                        </StatusPill>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </DataTable>
          ) : (
            <EmptyState
              title="Không có template phù hợp"
              description="Đổi bộ lọc hoặc tạo template mới."
            />
          )}
        </SectionCard>

        <SectionCard
          title={selected.template_key ? "Editor" : "Template mới"}
          actions={<StatusPill tone={selected.enabled ? "success" : "warning"}>{selected.enabled ? "Enabled" : "Disabled"}</StatusPill>}
        >
          <form className="bot-message-editor" onSubmit={saveTemplate}>
            <div className="form-grid bot-message-form-grid">
              <label className="form-group">
                <span className="form-label">Template key</span>
                <input
                  className="input"
                  placeholder="vd: sale_entry_button"
                  value={selected.template_key}
                  onChange={(event) => updateSelected({ template_key: normalizeTemplateKey(event.target.value) })}
                />
              </label>
              <label className="form-group">
                <span className="form-label">Language</span>
                <select
                  className="select"
                  value={selected.language}
                  onChange={(event) => updateSelected({ language: event.target.value as "vi" | "en" })}
                >
                  <option value="vi">Vietnamese</option>
                  <option value="en">English</option>
                </select>
              </label>
              <label className="form-group bot-message-field-wide">
                <span className="form-label">Title</span>
                <input
                  className="input"
                  placeholder="Tên dễ đọc trong Dashboard"
                  value={selected.title}
                  onChange={(event) => updateSelected({ title: event.target.value })}
                />
              </label>
              <label className="form-group">
                <span className="form-label">Custom emoji ID</span>
                <input
                  className="input"
                  inputMode="numeric"
                  placeholder="6055192572056309981"
                  value={selected.custom_emoji_id || ""}
                  onChange={(event) => updateSelected({ custom_emoji_id: normalizeCustomEmojiId(event.target.value) })}
                />
              </label>
              <label className="form-group">
                <span className="form-label">Fallback emoji</span>
                <input
                  className="input"
                  placeholder="🔥"
                  value={selected.fallback_emoji || ""}
                  onChange={(event) => updateSelected({ fallback_emoji: event.target.value })}
                />
              </label>
              <label className="form-group bot-message-field-wide">
                <span className="form-label">Variables</span>
                <input
                  className="input"
                  placeholder="name,amount,product_name"
                  value={selectedVariables.join(",")}
                  onChange={(event) =>
                    updateSelected({
                      variables: event.target.value
                        .split(",")
                        .map((item) => item.trim())
                        .filter(Boolean)
                    })
                  }
                />
              </label>
              <label className="form-group bot-message-field-wide">
                <span className="form-label">Description</span>
                <textarea
                  className="textarea"
                  rows={3}
                  placeholder="Ghi chú nội bộ"
                  value={selected.description || ""}
                  onChange={(event) => updateSelected({ description: event.target.value })}
                />
              </label>
              <label className="form-group bot-message-field-wide">
                <span className="form-label">Body text</span>
                <textarea
                  className="textarea bot-message-body-input"
                  placeholder="{product_name}, {amount}, {emoji:6055192572056309981}"
                  value={selected.body_text}
                  onChange={(event) => updateSelected({ body_text: event.target.value })}
                />
              </label>
            </div>

            <div className="bot-message-editor-footer">
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={selected.enabled}
                  onChange={(event) => updateSelected({ enabled: event.target.checked })}
                />
                <span>Bật template</span>
              </label>
              <div className="action-row">
                <button className="button" type="submit" disabled={saving}>
                  {saving ? "Đang lưu..." : "Lưu message"}
                </button>
                <button className="button secondary" type="button" onClick={() => setSelected(createEmptyTemplate())} disabled={saving}>
                  Xóa form
                </button>
              </div>
            </div>
          </form>

          <div className="bot-message-preview-panel">
            <div className="bot-message-preview-head">
              <span>Preview</span>
              <small>{formatDateTime(selected.updated_at)}</small>
            </div>
            <div className="bot-message-preview">
              {selected.template_key.startsWith("button.") || selected.template_key.startsWith("reply.") || selected.template_key.includes("button") ? (
                <button className="bot-message-preview-button" type="button">
                  <TelegramCustomEmojiPreview customEmojiId={selected.custom_emoji_id} compact />
                  <span>{previewButtonLabel || "Button"}</span>
                </button>
              ) : (
                <div className="bot-message-preview-message">
                  <TelegramCustomEmojiPreview customEmojiId={selected.custom_emoji_id} />
                  <pre>{`${previewPrefix}${previewBody}`}</pre>
                </div>
              )}
            </div>
            {selectedVariables.length > 0 && (
              <div className="bot-message-variable-list">
                {selectedVariables.map((variable) => (
                  <span key={variable}>{"{"}{variable}{"}"}</span>
                ))}
              </div>
            )}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
