"use node";

import { v } from "convex/values";

import { internal } from "./_generated/api";
import { action, env, internalAction } from "./_generated/server";
import { boardSceneCommitResultValidator } from "./boardSceneModel";
import {
  createBoardSceneDirectUpload,
  deleteBoardSceneR2Object,
  verifyAndPromoteBoardScene,
} from "./boardSceneR2";
import { CLOUD_SAVE_PROTOCOL_VERSION } from "./cloudSaveProtocol";

import type { Infer } from "convex/values";
import type { ActionCtx } from "./_generated/server";
import type { BoardSceneR2Config } from "./boardSceneR2";

const config = (): BoardSceneR2Config => {
  const endpoint = env.BOARD_SCENE_R2_ENDPOINT;
  const bucket = env.BOARD_SCENE_R2_BUCKET;
  const accessKeyId = env.BOARD_SCENE_R2_ACCESS_KEY_ID;
  const secretAccessKey = env.BOARD_SCENE_R2_SECRET_ACCESS_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("Board scene direct uploads are not configured");
  }
  return { endpoint, bucket, accessKeyId, secretAccessKey };
};

export const prepareUpload = action({
  args: { token: v.string() },
  returns: v.object({
    url: v.string(),
    headers: v.record(v.string(), v.string()),
    expiresAt: v.number(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    url: string;
    headers: Record<string, string>;
    expiresAt: number;
  }> => {
    const grant = await ctx.runMutation(
      internal.boardSceneFinalization.prepare,
      args,
    );
    return await createBoardSceneDirectUpload(config(), grant);
  },
});

const finalize = async (
  ctx: ActionCtx,
  token: string,
): Promise<Infer<typeof boardSceneCommitResultValidator>> => {
  const claimed = await ctx.runMutation(internal.boardSceneFinalization.claim, {
    token,
  });
  if (claimed.status === "finished") {
    return claimed.result;
  }
  // Exceptions preserve the coordination row. Durable cleanup runs after any
  // possibly in-flight copy, even if this action or its caller disappears.
  const verified = await verifyAndPromoteBoardScene(config(), claimed.grant);
  return await ctx.runMutation(internal.boardSceneFinalization.commit, {
    token,
    claimId: claimed.claimId,
    etag: verified.etag,
  });
};

export const finalizeUpload = action({
  args: { token: v.string(), clientSaveProtocol: v.optional(v.number()) },
  returns: boardSceneCommitResultValidator,
  handler: async (
    ctx,
    args,
  ): Promise<Infer<typeof boardSceneCommitResultValidator>> => {
    if (args.clientSaveProtocol !== CLOUD_SAVE_PROTOCOL_VERSION) {
      return { status: "upgrade-required" };
    }
    return await finalize(ctx, args.token);
  },
});

export const finalizeServerUpload = internalAction({
  args: { token: v.string() },
  returns: boardSceneCommitResultValidator,
  handler: async (
    ctx,
    { token },
  ): Promise<Infer<typeof boardSceneCommitResultValidator>> =>
    await finalize(ctx, token),
});

export const cleanup = internalAction({
  args: { grantId: v.id("boardSceneUploadGrants") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const pending = await ctx.runMutation(
      internal.boardSceneFinalization.beginCleanup,
      args,
    );
    if (!pending) {
      return null;
    }
    if (pending.waitUntil !== undefined) {
      await ctx.scheduler.runAt(
        pending.waitUntil,
        internal.boardSceneUploads.cleanup,
        args,
      );
      return null;
    }
    try {
      await deleteBoardSceneR2Object(config(), pending.objectKey);
      await ctx.runMutation(
        internal.boardSceneFinalization.finishCleanup,
        args,
      );
    } catch {
      // Never discard failed cleanup or retry in a hot loop. No provider error
      // text is logged: it can contain signed URLs or credentials.
      console.warn(
        "Board scene orphan cleanup retained for the next expiry pass",
      );
    }
    return null;
  },
});
