// @vitest-environment edge-runtime
/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const authenticatedTestClient = async () => {
  const t = convexTest(schema, modules);
  const userId = await t.run(async (ctx) =>
    ctx.db.insert("users", { name: "SVG plate owner" }),
  );
  return {
    t,
    owner: t.withIdentity({ subject: `${userId}|svg-plate-session` }),
  };
};

describe("reusable SVG board assets", () => {
  it("uploads, shares, reuses, and cleans one SVG plate through the existing asset lifecycle", async () => {
    const { t, owner } = await authenticatedTestClient();
    const board = await owner.mutation(api.boards.create, {
      title: "Foundations presentation",
    });
    const grant = await owner.mutation(api.boardAssets.createUploadGrant, {
      boardId: board.boardId,
      fileId: "template-foundations-editorial-v1",
      mimeType: "image/svg+xml",
      size: 2480,
    });
    const pendingGrant = await t.run(async (ctx) =>
      ctx.db
        .query("assetUploadGrants")
        .withIndex("by_token", (q) => q.eq("token", grant.token))
        .unique(),
    );

    expect(pendingGrant).toMatchObject({
      diagramId: board.boardId,
      fileId: "template-foundations-editorial-v1",
      mimeType: "image/svg+xml",
      size: 2480,
      purpose: "sceneAsset",
    });
    expect(pendingGrant?.objectKey).toMatch(/\.svg$/);

    await owner.mutation(api.boardAssets.registerUpload, {
      token: grant.token,
      etag: "svg-plate-etag",
    });

    const mine = await owner.query(api.boardAssets.listMine, {
      boardId: board.boardId,
    });
    expect(mine).toEqual([
      expect.objectContaining({
        fileId: "template-foundations-editorial-v1",
        mimeType: "image/svg+xml",
        size: 2480,
        url: `/api/assets/${pendingGrant?.objectKey}`,
      }),
    ]);

    await expect(
      owner.mutation(api.boardAssets.createUploadGrant, {
        boardId: board.boardId,
        fileId: "template-foundations-editorial-v1",
        mimeType: "image/svg+xml",
        size: 2480,
      }),
    ).rejects.toThrow("already stored");

    const sharing = await owner.mutation(api.boards.setSharing, {
      boardId: board.boardId,
      enabled: true,
    });
    expect(sharing.shareToken).not.toBeNull();
    const shared = await t.query(api.boardAssets.listShared, {
      shareToken: sharing.shareToken!,
    });
    expect(shared).toEqual(mine);

    const removed = await owner.mutation(api.boards.remove, {
      boardId: board.boardId,
    });
    expect(removed.assetDeleteToken).not.toBeNull();
    const cleanup = await t.run(async (ctx) =>
      ctx.db
        .query("assetDeleteGrants")
        .withIndex("by_token", (q) => q.eq("token", removed.assetDeleteToken!))
        .unique(),
    );
    expect(cleanup?.objectKeys).toEqual([pendingGrant?.objectKey]);
    const remainingAssets = await t.run(async (ctx) =>
      ctx.db
        .query("diagramAssets")
        .withIndex("by_diagramId", (q) => q.eq("diagramId", board.boardId))
        .take(10),
    );
    expect(remainingAssets).toEqual([]);
  });
});
