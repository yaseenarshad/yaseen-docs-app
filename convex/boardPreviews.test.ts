// @vitest-environment edge-runtime
/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { api, internal } from "./_generated/api";
import { CLOUD_SAVE_PROTOCOL_VERSION as CLIENT_SAVE_PROTOCOL } from "./cloudSaveProtocol";
import schema from "./schema";

import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");
const boardPreviewsApi = (api as any).boardPreviews;

const authenticatedTestClient = async () => {
  const t = convexTest(schema, modules);
  const userId = await t.run(async (ctx) =>
    ctx.db.insert("users", { name: "Preview owner" }),
  );
  return {
    t,
    userId,
    owner: t.withIdentity({ subject: `${userId}|preview-session` }),
  };
};

const createSavedBoard = async (
  owner: Awaited<ReturnType<typeof authenticatedTestClient>>["owner"],
  title = "Preview board",
) => {
  const created = await owner.mutation(api.boards.create, { title });
  const saved = await owner.mutation(api.boards.save, {
    boardId: created.boardId,
    clientSaveProtocol: CLIENT_SAVE_PROTOCOL,
    expectedVersion: 0,
    sceneJson: JSON.stringify({
      elements: [{ id: "shape", type: "rectangle", version: 1 }],
      appState: { viewBackgroundColor: "#f5f5f5" },
      files: {},
    }),
  });
  if (saved.status !== "saved") {
    throw new Error("Expected test board save to succeed");
  }
  return { ...created, version: saved.version, updatedAt: saved.updatedAt };
};

const createPreviewGrant = async (
  owner: Awaited<ReturnType<typeof authenticatedTestClient>>["owner"],
  boardId: Id<"diagrams">,
  sourceVersion: number,
) =>
  await owner.mutation(boardPreviewsApi.createUploadGrant, {
    boardId,
    sourceVersion,
    mimeType: "image/webp",
    size: 4096,
    width: 1200,
    height: 675,
  });

describe("durable Board previews", () => {
  it("validates preview versions from lightweight Board metadata", async () => {
    const { t, owner } = await authenticatedTestClient();
    const board = await createSavedBoard(owner);
    await t.run(async (ctx) => {
      const content = await ctx.db
        .query("diagramContents")
        .withIndex("by_diagramId", (q) => q.eq("diagramId", board.boardId))
        .unique();
      if (!content) {
        throw new Error("Expected Board content");
      }
      await ctx.db.delete("diagramContents", content._id);
    });

    await expect(
      createPreviewGrant(owner, board.boardId, board.version),
    ).resolves.toEqual({ token: expect.any(String) });
  });

  it("registers an owner WebP without changing Modified sorting metadata", async () => {
    const { t, owner } = await authenticatedTestClient();
    const board = await createSavedBoard(owner);
    const { token } = await createPreviewGrant(
      owner,
      board.boardId,
      board.version,
    );

    const grant = await t.run(async (ctx) =>
      ctx.db
        .query("assetUploadGrants")
        .withIndex("by_token", (q) => q.eq("token", token))
        .unique(),
    );
    expect(grant).toMatchObject({
      purpose: "boardPreview",
      sourceVersion: board.version,
      mimeType: "image/webp",
      previewWidth: 1200,
      previewHeight: 675,
    });

    const registered = await owner.mutation(boardPreviewsApi.registerUpload, {
      token,
      etag: "preview-etag",
    });
    expect(registered).toEqual({
      status: "registered",
      assetDeleteToken: null,
    });

    const stored = await t.run(async (ctx) =>
      ctx.db.get("diagrams", board.boardId),
    );
    expect(stored).toMatchObject({
      previewObjectKey: grant?.objectKey,
      previewVersion: board.version,
      previewMimeType: "image/webp",
      previewWidth: 1200,
      previewHeight: 675,
      updatedAt: board.updatedAt,
    });
    expect(stored?.previewUpdatedAt).toEqual(expect.any(Number));

    const listed = await owner.query(api.boards.listMinePaginated, {
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(listed.page[0].preview).toEqual({
      status: "available",
      version: board.version,
      mimeType: "image/webp",
      width: 1200,
      height: 675,
      updatedAt: stored?.previewUpdatedAt,
      url: `/api/assets/${grant?.objectKey}`,
    });
    expect(listed.page[0]).not.toHaveProperty("previewObjectKey");
    expect(listed.page[0]).not.toHaveProperty("sceneJson");
  });

  it("keeps normal scene-asset grants isolated from preview grants", async () => {
    const { owner } = await authenticatedTestClient();
    const board = await createSavedBoard(owner);
    const previewGrant = await createPreviewGrant(
      owner,
      board.boardId,
      board.version,
    );

    await expect(
      owner.mutation(api.boardAssets.registerUpload, {
        token: previewGrant.token,
        etag: "wrong-path",
      }),
    ).rejects.toThrow("Preview grants cannot register scene assets");

    const sceneGrant = await owner.mutation(api.boardAssets.createUploadGrant, {
      boardId: board.boardId,
      fileId: "embedded-image",
      mimeType: "image/png",
      size: 1024,
    });
    await expect(
      owner.mutation(boardPreviewsApi.registerUpload, {
        token: sceneGrant.token,
        etag: "wrong-path",
      }),
    ).rejects.toThrow("A Board preview grant is required");

    await expect(
      owner.mutation(api.boardAssets.registerUpload, {
        token: sceneGrant.token,
        etag: "scene-etag",
      }),
    ).resolves.toBeNull();
  });

  it("preserves legacy grants while preventing cross-owner and double preview registration", async () => {
    const { t, userId, owner } = await authenticatedTestClient();
    const board = await createSavedBoard(owner);
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("assetUploadGrants", {
        token: "legacy-scene-grant",
        diagramId: board.boardId,
        ownerId: userId,
        fileId: "legacy-image",
        objectKey: `${board.boardId}/legacy-image.png`,
        mimeType: "image/png",
        size: 128,
        createdAt: now,
        expiresAt: now + 60_000,
      });
    });
    await expect(
      owner.mutation(api.boardAssets.registerUpload, {
        token: "legacy-scene-grant",
        etag: "legacy-etag",
      }),
    ).resolves.toBeNull();

    const previewGrant = await createPreviewGrant(
      owner,
      board.boardId,
      board.version,
    );
    const otherUserId = await t.run(async (ctx) =>
      ctx.db.insert("users", { name: "Other preview user" }),
    );
    const otherUser = t.withIdentity({
      subject: `${otherUserId}|other-preview-session`,
    });
    await expect(
      otherUser.mutation(boardPreviewsApi.registerUpload, {
        token: previewGrant.token,
        etag: "not-owned",
      }),
    ).rejects.toThrow("Upload grant expired");

    await owner.mutation(boardPreviewsApi.registerUpload, {
      token: previewGrant.token,
      etag: "owned",
    });
    await expect(
      owner.mutation(boardPreviewsApi.registerUpload, {
        token: previewGrant.token,
        etag: "duplicate",
      }),
    ).rejects.toThrow("Upload grant expired");
  });

  it("never lets an older upload replace newer metadata and cleans stale/replaced objects", async () => {
    const { t, owner } = await authenticatedTestClient();
    const board = await createSavedBoard(owner);
    const olderGrant = await createPreviewGrant(
      owner,
      board.boardId,
      board.version,
    );
    const nextSave = await owner.mutation(api.boards.save, {
      boardId: board.boardId,
      clientSaveProtocol: CLIENT_SAVE_PROTOCOL,
      expectedVersion: board.version,
      sceneJson: JSON.stringify({
        elements: [{ id: "shape", type: "rectangle", version: 2 }],
        appState: {},
        files: {},
      }),
    });
    if (nextSave.status !== "saved") {
      throw new Error("Expected newer save");
    }
    const newerGrant = await createPreviewGrant(
      owner,
      board.boardId,
      nextSave.version,
    );
    const olderObjectKey = await t.run(async (ctx) => {
      const grant = await ctx.db
        .query("assetUploadGrants")
        .withIndex("by_token", (q) => q.eq("token", olderGrant.token))
        .unique();
      return grant?.objectKey;
    });

    await owner.mutation(boardPreviewsApi.registerUpload, {
      token: newerGrant.token,
      etag: "newer",
    });
    const stale = await owner.mutation(boardPreviewsApi.registerUpload, {
      token: olderGrant.token,
      etag: "older",
    });
    expect(stale.status).toBe("stale");
    expect(stale.assetDeleteToken).toEqual(expect.any(String));
    await expect(
      t.mutation(internal.assets.consumeDeleteGrant, {
        token: stale.assetDeleteToken,
      }),
    ).resolves.toEqual({
      objectKeys: [olderObjectKey],
    });

    const thirdSave = await owner.mutation(api.boards.save, {
      boardId: board.boardId,
      clientSaveProtocol: CLIENT_SAVE_PROTOCOL,
      expectedVersion: nextSave.version,
      sceneJson: JSON.stringify({
        elements: [{ id: "shape", type: "rectangle", version: 3 }],
        appState: {},
        files: {},
      }),
    });
    if (thirdSave.status !== "saved") {
      throw new Error("Expected latest save");
    }
    const latestGrant = await createPreviewGrant(
      owner,
      board.boardId,
      thirdSave.version,
    );
    const beforeReplace = await t.run(async (ctx) =>
      ctx.db.get("diagrams", board.boardId),
    );
    const replaced = await owner.mutation(boardPreviewsApi.registerUpload, {
      token: latestGrant.token,
      etag: "latest",
    });
    expect(replaced.status).toBe("registered");
    expect(replaced.assetDeleteToken).toEqual(expect.any(String));
    await expect(
      t.mutation(internal.assets.consumeDeleteGrant, {
        token: replaced.assetDeleteToken,
      }),
    ).resolves.toEqual({
      objectKeys: [beforeReplace?.previewObjectKey],
    });
  });

  it("rejects a source older than current saved content even before a newer preview exists", async () => {
    const { t, owner } = await authenticatedTestClient();
    const board = await createSavedBoard(owner);
    const olderGrant = await createPreviewGrant(
      owner,
      board.boardId,
      board.version,
    );
    const olderObjectKey = await t.run(async (ctx) => {
      const grant = await ctx.db
        .query("assetUploadGrants")
        .withIndex("by_token", (q) => q.eq("token", olderGrant.token))
        .unique();
      return grant?.objectKey;
    });
    await owner.mutation(api.boards.save, {
      boardId: board.boardId,
      clientSaveProtocol: CLIENT_SAVE_PROTOCOL,
      expectedVersion: board.version,
      sceneJson: JSON.stringify({
        elements: [{ id: "shape", type: "rectangle", version: 2 }],
        appState: {},
        files: {},
      }),
    });

    const stale = await owner.mutation(boardPreviewsApi.registerUpload, {
      token: olderGrant.token,
      etag: "older",
    });

    expect(stale.status).toBe("stale");
    expect(stale.assetDeleteToken).toEqual(expect.any(String));
    const stored = await t.run(async (ctx) =>
      ctx.db.get("diagrams", board.boardId),
    );
    expect(stored?.previewVersion).toBeUndefined();
    await expect(
      t.mutation(internal.assets.consumeDeleteGrant, {
        token: stale.assetDeleteToken,
      }),
    ).resolves.toEqual({ objectKeys: [olderObjectKey] });
  });

  it("records empty and legacy states without uploading blank objects", async () => {
    const { owner } = await authenticatedTestClient();
    const legacy = await owner.mutation(api.boards.create, {
      title: "Legacy board",
    });
    let listed = await owner.query(api.boards.listMinePaginated, {
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(listed.page[0].preview).toEqual({ status: "legacy" });

    const saved = await owner.mutation(api.boards.save, {
      boardId: legacy.boardId,
      clientSaveProtocol: CLIENT_SAVE_PROTOCOL,
      expectedVersion: 0,
      sceneJson: JSON.stringify({
        elements: [],
        appState: { viewBackgroundColor: "#ffffff" },
        files: {},
      }),
    });
    if (saved.status !== "saved") {
      throw new Error("Expected empty save");
    }
    await expect(
      owner.mutation(boardPreviewsApi.recordEmpty, {
        boardId: legacy.boardId,
        sourceVersion: saved.version,
      }),
    ).resolves.toEqual({ assetDeleteToken: null });

    listed = await owner.query(api.boards.listMinePaginated, {
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(listed.page[0].preview).toMatchObject({
      status: "empty",
      version: saved.version,
      updatedAt: expect.any(Number),
    });
    expect(listed.page[0].preview).not.toHaveProperty("url");
  });

  it("includes the current preview in Board deletion cleanup", async () => {
    const { t, owner } = await authenticatedTestClient();
    const board = await createSavedBoard(owner);
    const { token } = await createPreviewGrant(
      owner,
      board.boardId,
      board.version,
    );
    await owner.mutation(boardPreviewsApi.registerUpload, {
      token,
      etag: "preview",
    });
    const stored = await t.run(async (ctx) =>
      ctx.db.get("diagrams", board.boardId),
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("diagramAssets", {
        diagramId: board.boardId,
        fileId: "embedded",
        objectKey: `${board.boardId}/embedded.png`,
        mimeType: "image/png",
        size: 256,
        etag: "embedded-etag",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const removed = await owner.mutation(api.boards.remove, {
      boardId: board.boardId,
    });
    expect(removed.assetDeleteToken).toEqual(expect.any(String));
    if (!removed.assetDeleteToken) {
      throw new Error("Expected Board deletion cleanup grant");
    }
    await expect(
      t.mutation(internal.assets.consumeDeleteGrant, {
        token: removed.assetDeleteToken,
      }),
    ).resolves.toEqual({
      objectKeys: [`${board.boardId}/embedded.png`, stored?.previewObjectKey],
    });
  });
});
