import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadConfigFromFile } from "vite";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

test("rejects a production build pointed at a non-production Convex deployment", async () => {
  const previousConvexUrl = process.env.VITE_CONVEX_URL;
  process.env.VITE_CONVEX_URL = "https://honorable-possum-626.convex.cloud";

  try {
    await assert.rejects(
      loadConfigFromFile(
        { command: "build", mode: "production" },
        path.join(repositoryRoot, "excalidraw-app/vite.config.mts"),
      ),
      /production Convex deployment/,
    );
  } finally {
    if (previousConvexUrl === undefined) {
      delete process.env.VITE_CONVEX_URL;
    } else {
      process.env.VITE_CONVEX_URL = previousConvexUrl;
    }
  }
});

test("rejects a production build that enables Docs before rollout", async () => {
  const previousConvexUrl = process.env.VITE_CONVEX_URL;
  const previousDocsMode = process.env.VITE_DOCS_MODE;
  process.env.VITE_CONVEX_URL = "https://moonlit-boar-611.convex.cloud";
  process.env.VITE_DOCS_MODE = "on";
  try {
    await assert.rejects(
      loadConfigFromFile(
        { command: "build", mode: "production" },
        path.join(repositoryRoot, "excalidraw-app/vite.config.mts"),
      ),
      /Production Docs must remain off/,
    );
  } finally {
    previousConvexUrl === undefined
      ? delete process.env.VITE_CONVEX_URL
      : (process.env.VITE_CONVEX_URL = previousConvexUrl);
    previousDocsMode === undefined
      ? delete process.env.VITE_DOCS_MODE
      : (process.env.VITE_DOCS_MODE = previousDocsMode);
  }
});
