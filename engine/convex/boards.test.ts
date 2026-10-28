// @vitest-environment edge-runtime
/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import { CLOUD_SAVE_PROTOCOL_VERSION as CLIENT_SAVE_PROTOCOL } from "./cloudSaveProtocol";
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
      clientSaveProtocol: CLIENT_SAVE_PROTOCOL,
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

  it("splits the reactive open into scene-free metadata and a scene fetch", async () => {
    const { owner } = await authenticatedTestClient();
    const created = await owner.mutation(boardsApi.create, {
      title: "Split open Board",
    });
    const sceneJson = JSON.stringify({
      elements: [{ id: "shape", version: 1 }],
      appState: {},
      files: {},
    });
    const saved = await owner.mutation(boardsApi.save, {
      boardId: created.boardId,
      clientSaveProtocol: CLIENT_SAVE_PROTOCOL,
      expectedVersion: 0,
      sceneJson,
    });
    if (saved.status !== "saved") {
      throw new Error("Expected save");
    }

    const metadata = await owner.query(boardsApi.openMineMetadata, {
      slug: created.slug,
    });
    const scene = await owner.query(boardsApi.openMineScene, {
      slug: created.slug,
    });

    expect(metadata).toEqual({
      board: expect.objectContaining({ _id: created.boardId }),
      version: saved.version,
      access: "owner",
    });
    expect(metadata && "sceneJson" in metadata).toBe(false);
    expect(scene).toEqual({
      boardId: created.boardId,
      sceneJson,
      version: saved.version,
    });
  });

  it("reads the open metadata version from a legacy Board without one", async () => {
    const { t, owner } = await authenticatedTestClient();
    const created = await owner.mutation(boardsApi.create, {
      title: "Legacy open metadata Board",
    });
    const saved = await owner.mutation(boardsApi.save, {
      boardId: created.boardId,
      clientSaveProtocol: CLIENT_SAVE_PROTOCOL,
      expectedVersion: 0,
      sceneJson: JSON.stringify({
        elements: [{ id: "shape", version: 1 }],
        appState: {},
        files: {},
      }),
    });
    if (saved.status !== "saved") {
      throw new Error("Expected save");
    }
    await t.run(async (ctx) => {
      await ctx.db.patch("diagrams", created.boardId, {
        contentVersion: undefined,
      });
    });

    await expect(
      owner.query(boardsApi.openMineMetadata, { slug: created.slug }),
    ).resolves.toMatchObject({ version: saved.version });
  });

  it("splits the shared open the same way behind the share token", async () => {
    const { t, owner } = await authenticatedTestClient();
    const created = await owner.mutation(boardsApi.create, {
      title: "Shared split Board",
    });
    const sceneJson = JSON.stringify({
      elements: [{ id: "shape", version: 1 }],
      appState: {},
      files: {},
    });
    await owner.mutation(boardsApi.save, {
      boardId: created.boardId,
      clientSaveProtocol: CLIENT_SAVE_PROTOCOL,
      expectedVersion: 0,
      sceneJson,
    });
    const sharing = await owner.mutation(boardsApi.setSharing, {
      boardId: created.boardId,
      enabled: true,
    });
    if (!sharing.shareToken) {
      throw new Error("Expected a share token");
    }

    const metadata = await t.query(boardsApi.openSharedMetadata, {
      shareToken: sharing.shareToken,
    });
    const scene = await t.query(boardsApi.openSharedScene, {
      shareToken: sharing.shareToken,
    });
    expect(metadata).toMatchObject({ version: 1, access: "viewer" });
    expect(metadata && "sceneJson" in metadata).toBe(false);
    expect(scene).toEqual({
      boardId: created.boardId,
      sceneJson,
      version: 1,
    });

    await owner.mutation(boardsApi.setSharing, {
      boardId: created.boardId,
      enabled: false,
    });
    await expect(
      t.query(boardsApi.openSharedMetadata, {
        shareToken: sharing.shareToken,
      }),
    ).resolves.toBeNull();
    await expect(
      t.query(boardsApi.openSharedScene, {
        shareToken: sharing.shareToken,
      }),
    ).resolves.toBeNull();
  });

  it("keeps the split open behind the same owner boundary", async () => {
    const { t, owner } = await authenticatedTestClient();
    const created = await owner.mutation(boardsApi.create, {
      title: "Guarded split Board",
    });
    const otherUserId = await t.run(async (ctx) =>
      ctx.db.insert("users", { name: "Other user" }),
    );
    const otherUser = t.withIdentity({
      subject: `${otherUserId}|other-session`,
    });

    await expect(
      otherUser.query(boardsApi.openMineMetadata, { slug: created.slug }),
    ).resolves.toBeNull();
    await expect(
      otherUser.query(boardsApi.openMineScene, { slug: created.slug }),
    ).resolves.toBeNull();
    await expect(
      t.query(boardsApi.openMineScene, { slug: created.slug }),
    ).rejects.toThrow("Authentication required");
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
        clientSaveProtocol: CLIENT_SAVE_PROTOCOL,
        expectedVersion: 0,
        sceneJson: firstScene,
      }),
    ).resolves.toMatchObject({ status: "saved", version: 1 });
    await expect(
      owner.mutation(boardsApi.save, {
        boardId: created.boardId,
        clientSaveProtocol: CLIENT_SAVE_PROTOCOL,
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

  it("rejects a metadata-known stale save without reading Board content", async () => {
    const { t, owner } = await authenticatedTestClient();
    const created = await owner.mutation(boardsApi.create, {
      title: "Lightweight stale Board",
    });
    await t.run(async (ctx) => {
      const content = await ctx.db
        .query("diagramContents")
        .withIndex("by_diagramId", (q) => q.eq("diagramId", created.boardId))
        .unique();
      if (!content) {
        throw new Error("Missing test content");
      }
      await ctx.db.patch("diagrams", created.boardId, { contentVersion: 1 });
      await ctx.db.delete("diagramContents", content._id);
    });

    await expect(
      owner.mutation(boardsApi.save, {
        boardId: created.boardId,
        clientSaveProtocol: CLIENT_SAVE_PROTOCOL,
        expectedVersion: 0,
        sceneJson: JSON.stringify({
          elements: [{ id: "stale" }],
          appState: {},
          files: {},
        }),
      }),
    ).resolves.toEqual({ status: "conflict", version: 1 });
  });

  it("rejects a legacy save protocol before reading Board content", async () => {
    const { t, owner } = await authenticatedTestClient();
    const created = await owner.mutation(boardsApi.create, {
      title: "Legacy save client",
    });
    await t.run(async (ctx) => {
      const content = await ctx.db
        .query("diagramContents")
        .withIndex("by_diagramId", (q) => q.eq("diagramId", created.boardId))
        .unique();
      if (!content) {
        throw new Error("Missing test content");
      }
      await ctx.db.delete("diagramContents", content._id);
    });

    await expect(
      owner.mutation(boardsApi.save, {
        boardId: created.boardId,
        expectedVersion: 0,
        sceneJson: JSON.stringify({
          elements: [{ id: "legacy", version: 1 }],
          appState: {},
          files: {},
        }),
      }),
    ).resolves.toEqual({ status: "upgrade-required" });
  });

  it("does not increment the version for a binding-repair-only echo", async () => {
    const { owner } = await authenticatedTestClient();
    const created = await owner.mutation(boardsApi.create, {
      title: "Binding repair echo",
    });
    const firstScene = JSON.stringify({
      elements: [
        {
          id: "container",
          type: "rectangle",
          version: 4,
          versionNonce: 40,
          boundElements: [{ id: "label", type: "text" }],
        },
        {
          id: "label",
          type: "text",
          version: 2,
          versionNonce: 20,
          containerId: "container",
        },
      ],
      appState: { viewBackgroundColor: "#ffffff" },
      files: {},
    });
    const repairedEcho = JSON.stringify({
      ...JSON.parse(firstScene),
      elements: [
        {
          ...JSON.parse(firstScene).elements[0],
          boundElements: [],
        },
        JSON.parse(firstScene).elements[1],
      ],
    });

    const first = await owner.mutation(boardsApi.save, {
      boardId: created.boardId,
      clientSaveProtocol: CLIENT_SAVE_PROTOCOL,
      expectedVersion: 0,
      sceneJson: firstScene,
    });
    expect(first).toMatchObject({ status: "saved", version: 1 });
    const echo = await owner.mutation(boardsApi.save, {
      boardId: created.boardId,
      clientSaveProtocol: CLIENT_SAVE_PROTOCOL,
      expectedVersion: 1,
      sceneJson: repairedEcho,
    });

    expect(echo).toMatchObject({ status: "saved", version: 1 });
    const opened = await owner.query(boardsApi.openMine, {
      slug: created.slug,
    });
    expect(opened?.version).toBe(1);
    expect(opened?.sceneJson).toBe(firstScene);
  });

  it("falls back to the content version for a legacy Board without metadata", async () => {
    const { t, owner } = await authenticatedTestClient();
    const created = await owner.mutation(boardsApi.create, {
      title: "Legacy metadata Board",
    });
    await owner.mutation(boardsApi.save, {
      boardId: created.boardId,
      clientSaveProtocol: CLIENT_SAVE_PROTOCOL,
      expectedVersion: 0,
      sceneJson: JSON.stringify({
        elements: [{ id: "winner", version: 1 }],
        appState: {},
        files: {},
      }),
    });
    await t.run(async (ctx) => {
      await ctx.db.patch("diagrams", created.boardId, {
        contentVersion: undefined,
      });
    });

    await expect(
      owner.mutation(boardsApi.save, {
        boardId: created.boardId,
        clientSaveProtocol: CLIENT_SAVE_PROTOCOL,
        expectedVersion: 0,
        sceneJson: JSON.stringify({
          elements: [{ id: "stale", version: 1 }],
          appState: {},
          files: {},
        }),
      }),
    ).resolves.toEqual({ status: "conflict", version: 1 });
  });

  it("treats an identical scene save as a no-op without incrementing the version", async () => {
    const { t, owner } = await authenticatedTestClient();
    const created = await owner.mutation(boardsApi.create, {
      title: "No-op Board",
    });
    const sceneJson = JSON.stringify({
      elements: [{ id: "same", type: "rectangle", version: 1 }],
      appState: {},
      files: {},
    });
    const first = await owner.mutation(boardsApi.save, {
      boardId: created.boardId,
      clientSaveProtocol: CLIENT_SAVE_PROTOCOL,
      expectedVersion: 0,
      sceneJson,
    });
    if (first.status !== "saved") {
      throw new Error("Expected initial save to succeed");
    }
    await t.run(async (ctx) => {
      await ctx.db.patch("diagrams", created.boardId, {
        contentVersion: undefined,
      });
    });
    const beforeNoOp = await t.run(async (ctx) =>
      ctx.db.get("diagrams", created.boardId),
    );

    const duplicate = await owner.mutation(boardsApi.save, {
      boardId: created.boardId,
      clientSaveProtocol: CLIENT_SAVE_PROTOCOL,
      expectedVersion: first.version,
      sceneJson,
    });
    const afterNoOp = await t.run(async (ctx) =>
      ctx.db.get("diagrams", created.boardId),
    );

    expect(duplicate).toEqual({
      status: "saved",
      version: first.version,
      updatedAt: beforeNoOp?.updatedAt,
    });
    expect(afterNoOp?.updatedAt).toBe(beforeNoOp?.updatedAt);
    expect(afterNoOp?.contentVersion).toBe(first.version);
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
      owner.action(programmaticBoardEdits.updateTextElement, {
        boardId: created.boardId,
        elementId: "text-1",
        text: "After",
      }),
    ).resolves.toMatchObject({ version: 1 });
    const programmaticMetadata = await t.run(async (ctx) =>
      ctx.db.get("diagrams", created.boardId),
    );
    expect(programmaticMetadata?.contentVersion).toBe(1);
  });

  it("records snapshot timing metadata instead of re-reading the newest snapshot", async () => {
    const { t, owner } = await authenticatedTestClient();
    const created = await owner.mutation(boardsApi.create, {
      title: "Snapshot metadata Board",
    });
    const first = await owner.mutation(boardsApi.save, {
      boardId: created.boardId,
      clientSaveProtocol: CLIENT_SAVE_PROTOCOL,
      expectedVersion: 0,
      sceneJson: JSON.stringify({
        elements: [{ id: "shape", version: 1 }],
        appState: {},
        files: {},
      }),
    });
    if (first.status !== "saved") {
      throw new Error("Expected first save");
    }
    await owner.mutation(boardsApi.save, {
      boardId: created.boardId,
      clientSaveProtocol: CLIENT_SAVE_PROTOCOL,
      expectedVersion: first.version,
      sceneJson: JSON.stringify({
        elements: [{ id: "shape", version: 2 }],
        appState: {},
        files: {},
      }),
    });

    const { metadata, snapshots } = await t.run(async (ctx) => ({
      metadata: await ctx.db.get("diagrams", created.boardId),
      snapshots: await ctx.db
        .query("diagramSnapshots")
        .withIndex("by_diagramId_and_version", (q) =>
          q.eq("diagramId", created.boardId),
        )
        .order("desc")
        .take(10),
    }));

    expect(snapshots).toHaveLength(1);
    expect(metadata?.lastSnapshotVersion).toBe(snapshots[0].version);
    expect(metadata?.lastSnapshotAt).toBe(snapshots[0].createdAt);
  });

  it("keeps the snapshot interval closed while the metadata is fresh", async () => {
    const { t, owner } = await authenticatedTestClient();
    const created = await owner.mutation(boardsApi.create, {
      title: "Snapshot interval Board",
    });
    let version = 0;
    for (let edit = 1; edit <= 3; edit++) {
      const saved = await owner.mutation(boardsApi.save, {
        boardId: created.boardId,
        clientSaveProtocol: CLIENT_SAVE_PROTOCOL,
        expectedVersion: version,
        sceneJson: JSON.stringify({
          elements: [{ id: "shape", version: edit }],
          appState: {},
          files: {},
        }),
      });
      if (saved.status !== "saved") {
        throw new Error("Expected save");
      }
      version = saved.version;
    }

    const snapshots = await t.run(async (ctx) =>
      ctx.db
        .query("diagramSnapshots")
        .withIndex("by_diagramId_and_version", (q) =>
          q.eq("diagramId", created.boardId),
        )
        .take(10),
    );

    expect(snapshots.map((snapshot) => snapshot.version)).toEqual([1]);
  });

  it("backfills snapshot timing from the newest snapshot of a legacy Board", async () => {
    const { t, owner } = await authenticatedTestClient();
    const created = await owner.mutation(boardsApi.create, {
      title: "Legacy snapshot Board",
    });
    let version = 0;
    for (const edit of [1, 2]) {
      const saved = await owner.mutation(boardsApi.save, {
        boardId: created.boardId,
        clientSaveProtocol: CLIENT_SAVE_PROTOCOL,
        expectedVersion: version,
        sceneJson: JSON.stringify({
          elements: [{ id: "shape", version: edit }],
          appState: {},
          files: {},
        }),
      });
      if (saved.status !== "saved") {
        throw new Error("Expected save");
      }
      version = saved.version;
    }
    const legacySnapshot = await t.run(async (ctx) => {
      await ctx.db.patch("diagrams", created.boardId, {
        lastSnapshotAt: undefined,
        lastSnapshotVersion: undefined,
      });
      return await ctx.db
        .query("diagramSnapshots")
        .withIndex("by_diagramId_and_version", (q) =>
          q.eq("diagramId", created.boardId),
        )
        .order("desc")
        .first();
    });

    await owner.mutation(boardsApi.save, {
      boardId: created.boardId,
      clientSaveProtocol: CLIENT_SAVE_PROTOCOL,
      expectedVersion: version,
      sceneJson: JSON.stringify({
        elements: [{ id: "shape", version: 3 }],
        appState: {},
        files: {},
      }),
    });
    const { metadata, snapshots } = await t.run(async (ctx) => ({
      metadata: await ctx.db.get("diagrams", created.boardId),
      snapshots: await ctx.db
        .query("diagramSnapshots")
        .withIndex("by_diagramId_and_version", (q) =>
          q.eq("diagramId", created.boardId),
        )
        .take(10),
    }));

    expect(snapshots.map((snapshot) => snapshot.version)).toEqual([1]);
    expect(metadata?.lastSnapshotVersion).toBe(legacySnapshot?.version);
    expect(metadata?.lastSnapshotAt).toBe(legacySnapshot?.createdAt);
  });

  it("still forces a programmatic checkpoint and dedupes the same version", async () => {
    const { t, owner } = await authenticatedTestClient();
    const programmaticBoardEdits = (api as any).programmaticBoardEdits;
    const created = await owner.mutation(boardsApi.create, {
      title: "Forced checkpoint Board",
    });
    await owner.mutation(boardsApi.save, {
      boardId: created.boardId,
      clientSaveProtocol: CLIENT_SAVE_PROTOCOL,
      expectedVersion: 0,
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
    const afterSave = await t.run(async (ctx) =>
      ctx.db.get("diagrams", created.boardId),
    );

    await owner.action(programmaticBoardEdits.updateTextElement, {
      boardId: created.boardId,
      elementId: "text-1",
      text: "After",
    });
    const afterFirstEdit = await t.run(async (ctx) =>
      ctx.db.get("diagrams", created.boardId),
    );
    await owner.action(programmaticBoardEdits.updateTextElement, {
      boardId: created.boardId,
      elementId: "text-1",
      text: "Later",
    });
    const snapshots = await t.run(async (ctx) =>
      ctx.db
        .query("diagramSnapshots")
        .withIndex("by_diagramId_and_version", (q) =>
          q.eq("diagramId", created.boardId),
        )
        .take(10),
    );

    // The first save checkpoints nothing new, the forced programmatic edits
    // checkpoint versions 1 and 2, and neither repeats an already-saved version.
    expect(afterSave?.lastSnapshotVersion).toBeUndefined();
    expect(afterFirstEdit?.lastSnapshotVersion).toBe(1);
    expect(snapshots.map((snapshot) => snapshot.version)).toEqual([1, 2]);
  });

  it("keeps lightweight content metadata in sync when restoring history", async () => {
    const { t, owner } = await authenticatedTestClient();
    const boardHistory = (api as any).boardHistory;
    const created = await owner.mutation(boardsApi.create, {
      title: "History metadata",
    });
    const first = await owner.mutation(boardsApi.save, {
      boardId: created.boardId,
      clientSaveProtocol: CLIENT_SAVE_PROTOCOL,
      expectedVersion: 0,
      sceneJson: JSON.stringify({
        elements: [{ id: "shape", version: 1 }],
        appState: {},
        files: {},
      }),
    });
    if (first.status !== "saved") {
      throw new Error("Expected first save");
    }
    const second = await owner.mutation(boardsApi.save, {
      boardId: created.boardId,
      clientSaveProtocol: CLIENT_SAVE_PROTOCOL,
      expectedVersion: first.version,
      sceneJson: JSON.stringify({
        elements: [{ id: "shape", version: 2 }],
        appState: {},
        files: {},
      }),
    });
    if (second.status !== "saved") {
      throw new Error("Expected second save");
    }
    const snapshots = await owner.query(boardHistory.list, {
      boardId: created.boardId,
    });
    const restored = await owner.action(boardHistory.restore, {
      boardId: created.boardId,
      snapshotId: snapshots[0]._id,
    });
    const metadata = await t.run(async (ctx) =>
      ctx.db.get("diagrams", created.boardId),
    );

    expect(metadata?.contentVersion).toBe(restored.version);
  });
});
