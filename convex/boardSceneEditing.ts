import { api, internal } from "./_generated/api";
import {
  compressBoardScene,
  deleteBoardSceneObjects,
  downloadBoardSceneObject,
  uploadBoardSceneObject,
} from "./boardSceneTransport";

import type { BoardSceneEditPlan } from "./boardSceneModel";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";

/**
 * A server-side scene edit reads the current version, transforms it and commits
 * the replacement through the ordinary upload contract. Between the read and
 * the commit a browser save can land, which the commit refuses; a bounded retry
 * keeps a programmatic edit as reliable as the single-transaction path it
 * replaced without ever writing over somebody else's version.
 */
export const MAX_BOARD_SCENE_EDIT_ATTEMPTS = 3;

export const BOARD_SCENE_EDIT_CONFLICT_MESSAGE =
  "This board changed while the edit was being applied. Try again.";

export type BoardSceneEditResult = { version: number; updatedAt: number };

const commitBoardSceneEdit = async (
  ctx: ActionCtx,
  args: {
    boardId: Id<"diagrams">;
    expectedVersion: number;
    sceneJson: string;
  },
): Promise<
  ({ status: "committed" } & BoardSceneEditResult) | { status: "conflict" }
> => {
  const compressed = await compressBoardScene(args.sceneJson);
  const grant = await ctx.runMutation(
    internal.boardScenes.createServerUploadGrant,
    {
      boardId: args.boardId,
      expectedVersion: args.expectedVersion,
      encoding: compressed.encoding,
      rawSize: compressed.rawSize,
      compressedSize: compressed.compressedSize,
      rawSha256: compressed.rawSha256,
      compressedSha256: compressed.compressedSha256,
      semanticSha256: compressed.semanticSha256,
    },
  );
  if (grant.status === "conflict") {
    return { status: "conflict" };
  }

  let etag: string;
  try {
    etag = await uploadBoardSceneObject(grant.token, compressed);
  } catch (error) {
    // The grant is single-use, so a failed upload is handed back and its orphan
    // object swept before anything is retried.
    try {
      const abandoned = await ctx.runMutation(api.boardScenes.abandonUpload, {
        token: grant.token,
      });
      await deleteBoardSceneObjects(abandoned.cleanupToken);
    } catch (abandonError) {
      console.warn(
        "Could not abandon a failed Board scene upload",
        abandonError,
      );
    }
    throw error;
  }

  const commit = await ctx.runMutation(
    internal.boardScenes.commitServerUpload,
    {
      token: grant.token,
      etag,
    },
  );
  await deleteBoardSceneObjects(commit.cleanupToken);
  return commit.status === "conflict"
    ? { status: "conflict" }
    : {
        status: "committed",
        version: commit.version,
        updatedAt: commit.updatedAt,
      };
};

/**
 * Drives one authorized server-side scene edit. `begin` authorizes the caller
 * and reports what has to be read; a Board that has not migrated is handed
 * straight back to the legacy single-transaction path, which produces the same
 * result shape.
 */
export const runBoardSceneEdit = async (
  ctx: ActionCtx,
  args: {
    boardId: Id<"diagrams">;
    begin: () => Promise<BoardSceneEditPlan>;
    legacy: () => Promise<BoardSceneEditResult>;
    transform: (sceneJson: string) => string;
  },
): Promise<BoardSceneEditResult> => {
  for (let attempt = 0; attempt < MAX_BOARD_SCENE_EDIT_ATTEMPTS; attempt++) {
    const plan = await args.begin();
    if (plan.mode === "legacy") {
      return await args.legacy();
    }
    const sceneJson =
      plan.mode === "inline"
        ? plan.sceneJson
        : await downloadBoardSceneObject(plan.grant.path, plan.grant);
    const committed = await commitBoardSceneEdit(ctx, {
      boardId: args.boardId,
      expectedVersion: plan.currentVersion,
      sceneJson: args.transform(sceneJson),
    });
    if (committed.status === "committed") {
      return { version: committed.version, updatedAt: committed.updatedAt };
    }
  }
  throw new Error(BOARD_SCENE_EDIT_CONFLICT_MESSAGE);
};
