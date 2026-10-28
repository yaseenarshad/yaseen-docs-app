import { describe, expect, it } from "vitest";

import {
  BOARD_SCENE_WARNING_RAW_BYTES,
  LEGACY_BOARD_SCENE_RAW_BYTES,
  MAX_BOARD_SCENE_COMPRESSED_BYTES,
  MAX_BOARD_SCENE_RAW_BYTES,
} from "./types";
import {
  BoardSceneSizeError,
  assertBoardSceneRawSize,
  getBoardSceneRawSize,
  getBoardSceneSizeError,
} from "./sizePolicy";

describe("Board scene size policy", () => {
  it("publishes the approved warning, raw and compressed byte boundaries", () => {
    expect(LEGACY_BOARD_SCENE_RAW_BYTES).toBe(900_000);
    expect(BOARD_SCENE_WARNING_RAW_BYTES).toBe(8_000_000);
    expect(MAX_BOARD_SCENE_RAW_BYTES).toBe(10_000_000);
    expect(MAX_BOARD_SCENE_COMPRESSED_BYTES).toBe(10_100_000);
  });

  it("measures UTF-8 bytes rather than JavaScript string length", () => {
    expect(getBoardSceneRawSize("a🦄")).toBe(5);
  });

  it("accepts the raw ceiling and rejects one byte over it", () => {
    expect(() =>
      assertBoardSceneRawSize(MAX_BOARD_SCENE_RAW_BYTES),
    ).not.toThrow();

    expect(() =>
      assertBoardSceneRawSize(MAX_BOARD_SCENE_RAW_BYTES + 1),
    ).toThrow(BoardSceneSizeError);
  });

  it("recognizes validated size data across local and Convex boundaries", () => {
    const data = {
      code: "BOARD_SCENE_TOO_LARGE" as const,
      rawSize: MAX_BOARD_SCENE_RAW_BYTES + 1,
      maxRawSize: MAX_BOARD_SCENE_RAW_BYTES,
    };

    expect(
      getBoardSceneSizeError(new BoardSceneSizeError(data.rawSize)),
    ).toEqual(data);
    expect(getBoardSceneSizeError({ data })).toEqual(data);
    expect(getBoardSceneSizeError({ data: JSON.stringify(data) })).toEqual(
      data,
    );
    expect(
      getBoardSceneSizeError({ data: { ...data, rawSize: "large" } }),
    ).toBe(null);
    expect(getBoardSceneSizeError({ data: { ...data, code: "OTHER" } })).toBe(
      null,
    );
  });
});
