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

  it("moves only folder membership and refuses to delete a non-empty folder", async () => {
    const { t, owner } = await authenticatedTestClient();
    const board = await owner.mutation(boards.create, {
      title: "Preserve me",
    });
    await owner.mutation(boards.setSharing, {
      boardId: board.boardId,
      enabled: true,
    });
    const folder = await owner.mutation(boardFolders.create, {
      name: "Projects",
    });
    const before = await t.run(async (ctx) => {
      const diagram = await ctx.db.get("diagrams", board.boardId);
      const content = await ctx.db
        .query("diagramContents")
        .withIndex("by_diagramId", (q) => q.eq("diagramId", board.boardId))
        .unique();
      return { diagram, content };
    });

    await owner.mutation(boards.moveToFolder, {
      boardId: board.boardId,
      folderId: folder.folderId,
    });
    await owner.mutation(boards.moveToFolder, {
      boardId: board.boardId,
      folderId: folder.folderId,
    });
    const after = await t.run(async (ctx) => {
      const diagram = await ctx.db.get("diagrams", board.boardId);
      const content = await ctx.db
        .query("diagramContents")
        .withIndex("by_diagramId", (q) => q.eq("diagramId", board.boardId))
        .unique();
      return { diagram, content };
    });

    expect(after.content).toEqual(before.content);
    expect(after.diagram).toEqual({
      ...before.diagram,
      folderId: folder.folderId,
    });
    await expect(
      owner.mutation(boardFolders.remove, {
        folderId: folder.folderId,
      }),
    ).rejects.toThrow("Move its boards");

    await owner.mutation(boards.moveToFolder, {
      boardId: board.boardId,
      folderId: null,
    });
    await expect(
      owner.mutation(boardFolders.remove, {
        folderId: folder.folderId,
      }),
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
      otherOwner.mutation(boards.moveToFolder, {
        boardId: board.boardId,
        folderId: null,
      }),
    ).rejects.toThrow("Board not found");
  });
});
