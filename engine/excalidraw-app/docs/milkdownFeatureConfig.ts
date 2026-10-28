export const APPROVED_MILKDOWN_FEATURES = [
  "block-edit",
  "cursor",
  "link-tooltip",
  "list-item",
  "placeholder",
  "table",
  "toolbar",
] as const;

export const EXCLUDED_MILKDOWN_FEATURES = [
  "collaboration",
  "latex",
  "mermaid",
  "raw-html",
  "wikilinks",
  "comments",
  "source-mode",
] as const;

export const normalizeMarkdownInput = (markdown: string) =>
  markdown
    .replaceAll("\r\n", "\n")
    .replace(/^(\t+)(?=[-*+] |\d+[.)] )/gm, (tabs) => "  ".repeat(tabs.length));
