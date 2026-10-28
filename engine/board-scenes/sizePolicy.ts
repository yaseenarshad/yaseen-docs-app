import { MAX_BOARD_SCENE_RAW_BYTES } from "./types";

export type BoardSceneSizeErrorData = {
  code: "BOARD_SCENE_TOO_LARGE";
  rawSize: number;
  maxRawSize: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseData = (value: unknown): BoardSceneSizeErrorData | null => {
  if (typeof value === "string") {
    try {
      return parseData(JSON.parse(value) as unknown);
    } catch {
      return null;
    }
  }
  if (
    !isRecord(value) ||
    value.code !== "BOARD_SCENE_TOO_LARGE" ||
    !Number.isSafeInteger(value.rawSize) ||
    (value.rawSize as number) < 0 ||
    !Number.isSafeInteger(value.maxRawSize) ||
    (value.maxRawSize as number) < 1
  ) {
    return null;
  }
  return value as BoardSceneSizeErrorData;
};

export class BoardSceneSizeError extends Error {
  readonly data: BoardSceneSizeErrorData;

  constructor(rawSize: number) {
    super(
      "This board is too large to save as one scene. Remove embedded data or split the board.",
    );
    this.name = "BoardSceneSizeError";
    this.data = {
      code: "BOARD_SCENE_TOO_LARGE",
      rawSize,
      maxRawSize: MAX_BOARD_SCENE_RAW_BYTES,
    };
  }
}

export const getBoardSceneRawSize = (sceneJson: string) =>
  new TextEncoder().encode(sceneJson).byteLength;

export const assertBoardSceneRawSize = (rawSize: number) => {
  if (rawSize > MAX_BOARD_SCENE_RAW_BYTES) {
    throw new BoardSceneSizeError(rawSize);
  }
};

export const getBoardSceneSizeError = (
  error: unknown,
): BoardSceneSizeErrorData | null => {
  if (error instanceof BoardSceneSizeError) {
    return error.data;
  }
  return isRecord(error) ? parseData(error.data) : null;
};
