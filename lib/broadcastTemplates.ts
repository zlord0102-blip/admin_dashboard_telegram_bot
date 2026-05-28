"use client";

export const BROADCAST_TITLE_PRESETS_KEY = "broadcast_title_presets";
export const USER_BROADCAST_TEMPLATES_KEY = "broadcast_templates_v1";
export const STOCK_BROADCAST_TEMPLATES_KEY = "stock_broadcast_templates_v1";
const DEFAULT_BROADCAST_CUSTOM_EMOJI_ID = "6055192572056309981";

export type BroadcastTemplate = {
  id: string;
  name: string;
  title: string;
  message: string;
};

export const createEmptyBroadcastTemplate = (): BroadcastTemplate => ({
  id: "",
  name: "",
  title: "",
  message: ""
});

export const createBroadcastTemplateId = () =>
  `tpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const cleanSingleLine = (value: unknown) =>
  String(value ?? "").replace(/\s+/g, " ").trim();

const cleanMultiline = (value: unknown) =>
  String(value ?? "").replace(/\r\n/g, "\n").trim();

export const normalizeBroadcastTemplates = (templates: BroadcastTemplate[]) =>
  templates
    .map((template) => {
      const title = cleanSingleLine(template.title);
      const message = cleanMultiline(template.message);
      const name = cleanSingleLine(template.name) || title || message.split("\n")[0] || "Broadcast template";
      return {
        id: cleanSingleLine(template.id) || createBroadcastTemplateId(),
        name: name.slice(0, 80),
        title: title.slice(0, 160),
        message: message.slice(0, 4096)
      };
    })
    .filter((template) => template.title || template.message)
    .slice(0, 50);

export const parseLegacyBroadcastTitles = (rawValue: string | null | undefined) => {
  if (!rawValue) return [];
  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) return [];
    return Array.from(
      new Set(parsed.map((value) => cleanSingleLine(value)).filter(Boolean))
    ).slice(0, 20);
  } catch {
    return [];
  }
};

export const legacyTitlesToTemplates = (titles: string[]): BroadcastTemplate[] =>
  titles.map((title, index) => ({
    id: `legacy_title_${index + 1}`,
    name: title,
    title,
    message: ""
  }));

export const parseBroadcastTemplates = (rawValue: string | null | undefined) => {
  if (!rawValue) return [];
  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) return [];
    return normalizeBroadcastTemplates(
      parsed.map((value, index) => {
        if (typeof value === "string") {
          return {
            id: `legacy_string_${index + 1}`,
            name: cleanSingleLine(value),
            title: cleanSingleLine(value),
            message: ""
          };
        }
        const row = (value || {}) as Record<string, unknown>;
        return {
          id: cleanSingleLine(row.id) || `template_${index + 1}`,
          name: cleanSingleLine(row.name),
          title: cleanSingleLine(row.title),
          message: cleanMultiline(row.message)
        };
      })
    );
  } catch {
    return [];
  }
};

export const DEFAULT_STOCK_BROADCAST_TEMPLATE: BroadcastTemplate = {
  id: "default_stock_broadcast",
  name: "Stock vừa nhập",
  title: "",
  message: `{emoji:${DEFAULT_BROADCAST_CUSTOM_EMOJI_ID}} {product_name}\n{emoji:${DEFAULT_BROADCAST_CUSTOM_EMOJI_ID}} Thêm: {added_count}\n{emoji:${DEFAULT_BROADCAST_CUSTOM_EMOJI_ID}} Tồn kho hiện tại: {current_stock}`
};

export const renderTemplateText = (
  templateText: string,
  variables: Record<string, string | number>
) =>
  templateText.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(variables, key) ? String(variables[key]) : match
  );
