import { parseDocsMode } from "../docs-mode/types";

export const getDocsMode = () =>
  process.env.YASEENDRAW_DOCS_MODE !== undefined
    ? parseDocsMode(process.env.YASEENDRAW_DOCS_MODE)
    : process.env.NODE_ENV === "test"
    ? "on"
    : "off";

export const requireDocsReadable = () => {
  if (getDocsMode() === "off") {
    throw new Error("Docs are disabled");
  }
};

export const requireDocsWritable = () => {
  if (getDocsMode() !== "on") {
    throw new Error("Docs are read-only");
  }
};
