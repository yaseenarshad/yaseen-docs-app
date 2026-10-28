import { execFileSync } from "node:child_process";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const source = path.join(root, "public/favicon.svg");
const output = (name) => path.join(root, "public", name);

const render = async (name, size, opaque = false) => {
  let image = sharp(source, { density: 192 }).resize(size, size, {
    fit: "fill",
  });
  if (opaque) {
    image = image.flatten({ background: "#6965db" });
  }
  await image.png().toFile(output(name));
};

await Promise.all([
  render("favicon-16x16.png", 16),
  render("favicon-32x32.png", 32),
  render("apple-touch-icon.png", 180, true),
  render("android-chrome-192x192.png", 192, true),
  render("android-chrome-512x512.png", 512, true),
  render("maskable_icon_x192.png", 192, true),
  render("maskable_icon_x512.png", 512, true),
  render(".favicon-48x48.tmp.png", 48),
]);

execFileSync("magick", [
  output("favicon-16x16.png"),
  output("favicon-32x32.png"),
  output(".favicon-48x48.tmp.png"),
  output("favicon.ico"),
]);
await unlink(output(".favicon-48x48.tmp.png"));
