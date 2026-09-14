import { deflate } from "pako";
import { describe, expect, it } from "vitest";

import { inflateBoardScene } from "./compression";

describe("bounded Board scene inflation", () => {
  it("returns valid deflate bytes up to the inclusive raw limit", () => {
    const raw = new TextEncoder().encode("x".repeat(100_000));

    expect(
      new TextDecoder().decode(inflateBoardScene(deflate(raw), raw.byteLength)),
    ).toBe("x".repeat(100_000));
  });

  it("rejects output as soon as it expands beyond the raw limit", () => {
    const raw = new TextEncoder().encode("x".repeat(100_001));

    expect(() => inflateBoardScene(deflate(raw), raw.byteLength - 1)).toThrow(
      "Board scene is too large",
    );
  });

  it("rejects malformed deflate bytes", () => {
    expect(() =>
      inflateBoardScene(new Uint8Array([1, 2, 3, 4]), 100_000),
    ).toThrow("Board scene could not be decompressed");
  });

  it("rejects a truncated stream even after pako emitted all raw bytes", () => {
    const raw = new Uint8Array(65_536).fill(120);
    const compressed = deflate(raw);

    expect(() =>
      inflateBoardScene(
        compressed.subarray(0, compressed.byteLength - 1),
        raw.byteLength,
      ),
    ).toThrow("Board scene could not be decompressed");
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5])(
    "rejects the invalid raw limit %s",
    (maxRawBytes) => {
      expect(() =>
        inflateBoardScene(deflate(new Uint8Array([1])), maxRawBytes),
      ).toThrow("Board scene raw limit is invalid");
    },
  );
});
