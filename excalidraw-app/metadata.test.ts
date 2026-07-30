import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const appHtml = readFileSync(
  path.join(process.cwd(), "excalidraw-app/index.html"),
  "utf8",
);
const viteConfig = readFileSync(
  path.join(process.cwd(), "excalidraw-app/vite.config.mts"),
  "utf8",
);

describe("Yaseen Whiteboard static metadata", () => {
  it("ships the product title and versioned icon family before hydration", () => {
    expect(appHtml).toContain("<title>Yaseen Whiteboard</title>");
    expect(appHtml).toContain('href="/favicon.svg?v=2"');
    expect(appHtml).toContain('href="/favicon.ico?v=2"');
    expect(appHtml).toContain('href="/apple-touch-icon.png?v=2"');
  });

  it("brands the install manifest and includes regular plus maskable sizes", () => {
    expect(viteConfig).toContain('short_name: "Yaseen"');
    expect(viteConfig).toContain('name: "Yaseen Whiteboard"');
    expect(viteConfig).toContain('src: "android-chrome-512x512.png"');
    expect(viteConfig).toContain('src: "maskable_icon_x192.png"');
    expect(viteConfig).toContain('src: "maskable_icon_x512.png"');
    expect(viteConfig.match(/purpose: "maskable"/g)).toHaveLength(2);
  });

  it("does not warm up a third-party font origin", () => {
    expect(appHtml).not.toContain("fonts.googleapis.com");
    expect(appHtml).not.toContain("fonts.gstatic.com");
  });
});
