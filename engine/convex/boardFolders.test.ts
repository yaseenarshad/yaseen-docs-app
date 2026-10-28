// @vitest-environment edge-runtime
/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const boardFolders = (api as any).boardFolders;
const boards = api.boards;

const authenticatedTestClient = async (name = "Board owner") => {
  const t = convexTest(schema, modules);
  const userId = await t.run(async (ctx) => ctx.db.insert("users", { name }));
  return {
    t,
    userId,
    owner: t.withIdentity({ subject: `${userId}|test-session` }),
  };
};

describe("Board folders", () => {
  it("trims, sorts, and enforces case-insensitive names per owner", async () => {
    const { t, owner } = await authenticatedTestClient();
    await owner.mutation(boardFolders.create, { name: "  Zebra  " });
    await owner.mutation(boardFolders.create, { name: "alpha" });

    await expect(
      owner.mutation(boardFolders.create, { name: " ALPHA " }),
    ).rejects.toThrow("already exists");
    await expect(owner.query(boardFolders.listMine, {})).resolves.toMatchObject(
      [{ name: "alpha" }, { name: "Zebra" }],
    );

    const otherUserId = await t.run(async (ctx) =>
      ctx.db.insert("users", { name: "Other owner" }),
    );
    const otherOwner = t.withIdentity({
      subject: `${otherUserId}|other-session`,
    });
    await expect(
      otherOwner.mutation(boardFolders.create, { name: "Alpha" }),
    ).resolves.toBeTruthy();
  });

  it("deletes a non-empty folder by moving every Board to Unfiled without changing Board data", async () => {
    const { t, owner } = await authenticatedTestClient();
    const firstBoard = await owner.mutation(boards.create, {
      title: "Preserve everything",
    });
    const secondBoard = await owner.mutation(boards.create, {
      title: "Move me too",
    });
    await owner.mutation(boards.setSharing, {
      boardId: firstBoard.boardId,
      enabled: true,
    });
    const folder = await owner.mutation(boardFolders.create, {
      name: "Projects",
    });
    await owner.mutation(boards.moveToFolder, {
      boardId: firstBoard.boardId,
      folderId: folder.folderId,
    });
    await owner.mutation(boards.moveToFolder, {
      boardId: secondBoard.boardId,
      folderId: folder.folderId,
    });
    await t.run(async (ctx) => {
      await ctx.db.patch("diagrams", firstBoard.boardId, {
        previewObjectKey: "owner/board/previews/preview.webp",
        previewVersion: 3,
        previewMimeType: "image/webp",
        previewWidth: 640,
        previewHeight: 480,
        previewUpdatedAt: 1_725_000_000_000,
      });
      await ctx.db.insert("diagramAssets", {
        diagramId: firstBoard.boardId,
        fileId: "embedded-image",
        objectKey: "owner/board/assets/image.png",
        mimeType: "image/png",
        createdAt: 1_724_000_000_000,
        updatedAt: 1_724_000_000_000,
      });
      await ctx.db.insert("diagramSnapshots", {
        diagramId: firstBoard.boardId,
        createdBy: (await ctx.db.get("diagrams", firstBoard.boardId))!.ownerId,
        sceneJson: '{"elements":[{"id":"kept"}]}',
        version: 1,
        createdAt: 1_724_000_000_000,
      });
    });
    const before = await t.run(async (ctx) => {
      const diagrams = await Promise.all([
        ctx.db.get("diagrams", firstBoard.boardId),
        ctx.db.get("diagrams", secondBoard.boardId),
      ]);
      const content = await ctx.db
        .query("diagramContents")
        .withIndex("by_diagramId", (q) => q.eq("diagramId", firstBoard.boardId))
        .unique();
      const assets = await ctx.db
        .query("diagramAssets")
        .withIndex("by_diagramId", (q) => q.eq("diagramId", firstBoard.boardId))
        .collect();
      const snapshots = await ctx.db
        .query("diagramSnapshots")
        .withIndex("by_diagramId_and_createdAt", (q) =>
          q.eq("diagramId", firstBoard.boardId),
        )
        .collect();
      return { diagrams, content, assets, snapshots };
    });

    await expect(
      owner.mutation(boardFolders.remove, {
        folderId: folder.folderId,
      }),
    ).resolves.toBeNull();

    const after = await t.run(async (ctx) => {
      const diagrams = await Promise.all([
        ctx.db.get("diagrams", firstBoard.boardId),
        ctx.db.get("diagrams", secondBoard.boardId),
      ]);
      const content = await ctx.db
        .query("diagramContents")
        .withIndex("by_diagramId", (q) => q.eq("diagramId", firstBoard.boardId))
        .unique();
      const assets = await ctx.db
        .query("diagramAssets")
        .withIndex("by_diagramId", (q) => q.eq("diagramId", firstBoard.boardId))
        .collect();
      const snapshots = await ctx.db
        .query("diagramSnapshots")
        .withIndex("by_diagramId_and_createdAt", (q) =>
          q.eq("diagramId", firstBoard.boardId),
        )
        .collect();
      const deletedFolder = await ctx.db.get("boardFolders", folder.folderId);
      return { diagrams, content, assets, snapshots, deletedFolder };
    });

    expect(after.deletedFolder).toBeNull();
    expect(after.diagrams).toEqual(
      before.diagrams.map((diagram) => {
        const { folderId: _folderId, ...unchanged } = diagram!;
        return unchanged;
      }),
    );
    expect(after.content).toEqual(before.content);
    expect(after.assets).toEqual(before.assets);
    expect(after.snapshots).toEqual(before.snapshots);
  });

  it("deletes an empty folder", async () => {
    const { t, owner } = await authenticatedTestClient();
    const folder = await owner.mutation(boardFolders.create, {
      name: "Empty",
    });

    await expect(
      owner.mutation(boardFolders.remove, {
        folderId: folder.folderId,
      }),
    ).resolves.toBeNull();
    await expect(
      t.run(async (ctx) => ctx.db.get("boardFolders", folder.folderId)),
    ).resolves.toBeNull();
  });

  it("does not leak foreign Boards or folders through moves and mutations", async () => {
    const { t, owner } = await authenticatedTestClient();
    const board = await owner.mutation(boards.create, {
      title: "Private",
    });
    const folder = await owner.mutation(boardFolders.create, {
      name: "Private folder",
    });
    const otherUserId = await t.run(async (ctx) =>
      ctx.db.insert("users", { name: "Other owner" }),
    );
    const otherOwner = t.withIdentity({
      subject: `${otherUserId}|other-session`,
    });
    const otherBoard = await otherOwner.mutation(boards.create, {
      title: "Other",
    });

    await expect(
      otherOwner.mutation(boards.moveToFolder, {
        boardId: otherBoard.boardId,
        folderId: folder.folderId,
      }),
    ).rejects.toThrow("Folder not found");
    await expect(
      otherOwner.mutation(boardFolders.rename, {
        folderId: folder.folderId,
        name: "Leaked",
      }),
    ).rejects.toThrow("Folder not found");
    await expect(
      otherOwner.mutation(boardFolders.remove, {
        folderId: folder.folderId,
      }),
    ).rejects.toThrow("Folder not found");
    await expect(
      otherOwner.mutation(boards.moveToFolder, {
        boardId: board.boardId,
        folderId: null,
      }),
    ).rejects.toThrow("Board not found");
  });
});
