import { parseDocsMode } from "../../docs-mode/types";

export const DOCS_MODE = parseDocsMode(import.meta.env.VITE_DOCS_MODE);
export const DOCS_ENABLED = DOCS_MODE !== "off";
export const DOCS_WRITABLE = DOCS_MODE === "on";
