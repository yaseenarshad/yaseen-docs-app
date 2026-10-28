// @vitest-environment edge-runtime

import { describe, expect, it, vi } from "vitest";

import { MAX_BOARD_SCENE_COMPRESSED_BYTES } from "../board-scenes/types";

import { compressBoardScene } from "./boardSceneTransport";

vi.mock("pako", async (importOriginal) => ({
  ...(await importOriginal<typeof import("pako")>()),
  deflate: () => new Uint8Array(MAX_BOARD_SCENE_COMPRESSED_BYTES + 1),
}));

describe("Board scene compressed-size defense", () => {
  it("rejects an unexpectedly oversized compressed representation", async () => {
    await expect(
      compressBoardScene('{"elements":[],"appState":{},"files":{}}'),
    ).rejects.toThrow("compressed representation is too large");
  });
});
