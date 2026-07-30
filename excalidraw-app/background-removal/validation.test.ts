import { describe, expect, it } from "vitest";

import { isAnimatedWebP, validateBackgroundRemovalSource } from "./validation";

const ascii = (value: string) =>
  Uint8Array.from([...value].map((character) => character.charCodeAt(0)));

describe("background-removal source validation", () => {
  it("accepts supported static formats at or below ten megapixels", () => {
    expect(() =>
      validateBackgroundRemovalSource({
        mimeType: "image/png",
        width: 4_000,
        height: 2_500,
      }),
    ).not.toThrow();
  });

  it("rejects unsupported and oversized images", () => {
    expect(() =>
      validateBackgroundRemovalSource({
        mimeType: "image/gif",
        width: 100,
        height: 100,
      }),
    ).toThrow(/JPG, PNG, or static WebP/);
    expect(() =>
      validateBackgroundRemovalSource({
        mimeType: "image/jpeg",
        width: 4_001,
        height: 2_500,
      }),
    ).toThrow(/10 megapixels/);
  });

  it("detects an animated WebP container without decoding it", () => {
    const bytes = new Uint8Array([
      ...ascii("RIFF"),
      12,
      0,
      0,
      0,
      ...ascii("WEBP"),
      ...ascii("ANIM"),
      0,
      0,
      0,
      0,
    ]);
    expect(isAnimatedWebP(bytes)).toBe(true);
    expect(() =>
      validateBackgroundRemovalSource({
        mimeType: "image/webp",
        bytes,
      }),
    ).toThrow(/Animated WebP/);
  });
});
