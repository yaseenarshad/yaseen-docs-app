export const DOCS_MODES = ["off", "read-only", "on"] as const;
export type DocsMode = typeof DOCS_MODES[number];

export const parseDocsMode = (value: unknown): DocsMode => {
  if (value === "off" || value === "read-only" || value === "on") {
    return value;
  }
  return "off";
};
