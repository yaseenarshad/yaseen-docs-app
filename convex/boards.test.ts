// @vitest-environment edge-runtime
/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const boardsApi = api.boards;

const authenticatedTestClient = async () => {
  const t = convexTest(schema, modules);
  const userId = await t.run(async (ctx) =>
    ctx.db.insert("users", { name: "Board owner" }),
  );
  return {
    t,
    userId,
    owner: t.withIdentity({ subject: `${userId}|test-session` }),
  };
};

describe("boards compatibility API", () => {
  it("creates the default Board through api.boards without breaking api.diagrams", async () => {
    const { owner } = await authenticatedTestClient();

    const created = await owner.mutation(boardsApi.ensureDefault, {});
    const legacyList = await owner.query(api.diagrams.listMine, {});

    expect(created).toEqual({
      boardId: legacyList[0]._id,
      slug: legacyList[0].slug,
    });
    expect(legacyList[0].title).toBe("Untitled board");
  });

  it("uses Board-shaped arguments and results over the unchanged storage record", async () => {
    const { owner } = await authenticatedTestClient();

    const created = await owner.mutation(boardsApi.create, {
      title: "Launch map",
    });
    const opened = await owner.query(boardsApi.openMine, {
      slug: created.slug,
    });

    expect(opened?.board._id).toBe(created.boardId);
    expect(opened?.board.title).toBe("Launch map");

    const saved = await owner.mutation(boardsApi.save, {
      boardId: created.boardId,
      expectedVersion: 0,
      sceneJson: JSON.stringify({
        elements: [],
        appState: { viewBackgroundColor: "#ffffff" },
        files: {},
      }),
    });
    expect(saved).toMatchObject({ status: "saved", version: 1 });

    await owner.mutation(boardsApi.rename, {
      boardId: created.boardId,
      title: "Renamed map",
    });
    const legacyOpened = await owner.query(api.diagrams.openMine, {
      slug: created.slug,
    });
    expect(legacyOpened?.diagram.title).toBe("Renamed map");
    expect(legacyOpened?.version).toBe(1);
  });

  it("offers finite cursor pagination for Board lists", async () => {
    const { owner } = await authenticatedTestClient();
    await owner.mutation(boardsApi.create, { title: "One" });
    await owner.mutation(boardsApi.create, { title: "Two" });
    await owner.mutation(boardsApi.create, { title: "Three" });

    const firstPage = await owner.query(boardsApi.listMinePaginated, {
      paginationOpts: { cursor: null, numItems: 2 },
    });
    expect(firstPage.page).toHaveLength(2);
    expect(firstPage.isDone).toBe(false);

    const secondPage = await owner.query(boardsApi.listMinePaginated, {
      paginationOpts: {
        cursor: firstPage.continueCursor,
        numItems: 2,
      },
    });
    expect(secondPage.page).toHaveLength(1);
    expect(secondPage.isDone).toBe(true);
  });

  it("traverses more than 100 Boards without duplicates in every global order", async () => {
    const { t, userId, owner } = await authenticatedTestClient();
    await t.run(async (ctx) => {
      for (let index = 0; index < 105; index++) {
        const title = `Board ${String(index).padStart(3, "0")}`;
        await ctx.db.insert("diagrams", {
          ownerId: userId,
          slug: `board-${index}`,
          title,
          normalizedTitle: title.toLocaleLowerCase(),
          visibility: "private",
          shareEnabled: false,
          createdAt: 1_000 + index,
          updatedAt: 2_000 + (index % 7),
        });
      }
    });

    for (const sort of [
      "name-asc",
      "name-desc",
      "created-desc",
      "created-asc",
      "modified-desc",
      "modified-asc",
    ] as const) {
      const ids: string[] = [];
      let cursor: string | null = null;
      let isDone = false;
      while (!isDone) {
        const result: {
          page: Array<{ _id: string }>;
          continueCursor: string;
          isDone: boolean;
        } = await owner.query(boardsApi.listMinePaginated, {
          paginationOpts: { cursor, numItems: 17 },
          sort,
          query: "",
        });
        ids.push(...result.page.map((board) => board._id));
        cursor = result.continueCursor;
        isDone = result.isDone;
      }
      expect(ids).toHaveLength(105);
      expect(new Set(ids).size).toBe(105);
    }
  });

  it("finds an account-wide search result beyond the first base page", async () => {
    const { t, userId, owner } = await authenticatedTestClient();
    await t.run(async (ctx) => {
      for (let index = 0; index < 110; index++) {
        const title = index === 109 ? "Needle launch plan" : `Archive ${index}`;
        await ctx.db.insert("diagrams", {
          ownerId: userId,
          slug: `archive-${index}`,
          title,
          normalizedTitle: title.toLocaleLowerCase(),
          visibility: "private",
          shareEnabled: false,
          createdAt: 1_000 + index,
          updatedAt: 2_000 + index,
        });
      }
    });

    const result = await owner.query(boardsApi.listMinePaginated, {
      paginationOpts: { cursor: null, numItems: 10 },
      sort: "modified-desc",
      query: "needle",
    });
    expect(result.page.map((board) => board.title)).toEqual([
      "Needle launch plan",
    ]);
  });

  it("rejects a stale same-Board save without overwriting the winning version", async () => {
    const { owner } = await authenticatedTestClient();
    const created = await owner.mutation(boardsApi.create, {
      title: "Two-tab Board",
    });
    const firstScene = JSON.stringify({
      elements: [{ id: "winner" }],
      appState: {},
      files: {},
    });

    await expect(
      owner.mutation(boardsApi.save, {
        boardId: created.boardId,
        expectedVersion: 0,
        sceneJson: firstScene,
      }),
    ).resolves.toMatchObject({ status: "saved", version: 1 });
    await expect(
      owner.mutation(boardsApi.save, {
        boardId: created.boardId,
        expectedVersion: 0,
        sceneJson: JSON.stringify({
          elements: [{ id: "stale" }],
          appState: {},
          files: {},
        }),
      }),
    ).resolves.toMatchObject({
      status: "conflict",
      version: 1,
    });

    const opened = await owner.query(boardsApi.openMine, {
      slug: created.slug,
    });
    expect(opened?.sceneJson).toBe(firstScene);
    expect(opened?.version).toBe(1);
  });

  it("enforces the same ownership boundary through the Board API", async () => {
    const { t, owner } = await authenticatedTestClient();
    const created = await owner.mutation(boardsApi.create, {
      title: "Private Board",
    });
    const otherUserId = await t.run(async (ctx) =>
      ctx.db.insert("users", { name: "Other user" }),
    );
    const otherUser = t.withIdentity({
      subject: `${otherUserId}|other-session`,
    });

    await expect(
      otherUser.mutation(boardsApi.rename, {
        boardId: created.boardId,
        title: "Not allowed",
      }),
    ).rejects.toThrow("Board not found");
  });

  it("exposes Board-named asset, history, and programmatic entry points", async () => {
    const { t, owner } = await authenticatedTestClient();
    const created = await owner.mutation(boardsApi.create, {
      title: "API coverage",
    });
    const boardAssets = (api as any).boardAssets;
    const boardHistory = (api as any).boardHistory;
    const programmaticBoardEdits = (api as any).programmaticBoardEdits;

    await expect(
      owner.query(boardAssets.listMine, { boardId: created.boardId }),
    ).resolves.toEqual([]);
    await expect(
      owner.query(boardHistory.list, { boardId: created.boardId }),
    ).resolves.toEqual([]);

    await t.run(async (ctx) => {
      const content = await ctx.db
        .query("diagramContents")
        .withIndex("by_diagramId", (q) => q.eq("diagramId", created.boardId))
        .unique();
      if (!content) {
        throw new Error("Missing test content");
      }
      await ctx.db.patch("diagramContents", content._id, {
        sceneJson: JSON.stringify({
          elements: [
            {
              id: "text-1",
              type: "text",
              text: "Before",
              originalText: "Before",
              version: 1,
              versionNonce: 1,
            },
          ],
          appState: {},
          files: {},
        }),
      });
    });

    await expect(
      owner.mutation(programmaticBoardEdits.updateTextElement, {
        boardId: created.boardId,
        elementId: "text-1",
        text: "After",
      }),
    ).resolves.toMatchObject({ version: 1 });
  });
});
