// @vitest-environment edge-runtime
/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BOARD_SCENE_KEY_PREFIX,
  MAX_BOARD_SCENE_RAW_BYTES,
} from "../board-scenes/types";
import { getBoardSceneSizeError } from "../board-scenes/sizePolicy";
import {
  DOC_PLACEMENT_REFS_PROTOCOL_VERSION,
  describeDocPlacementRefs,
} from "../doc-placement/types";
import {
  BOARD_SCENE_TEST_WORKER_ORIGIN,
  createBoardSceneWorkerHarness,
} from "../board-scenes/testWorkerHarness";

import { api, internal } from "./_generated/api";
import {
  BOARD_SCENE_WORKER_ORIGIN_VARIABLE,
  compressBoardScene,
  deleteBoardSceneObjects,
  downloadBoardSceneObject,
  uploadBoardSceneObject,
} from "./boardSceneTransport";
import { CLOUD_SAVE_PROTOCOL_VERSION } from "./cloudSaveProtocol";
import { SNAPSHOT_INTERVAL_MS } from "./snapshotPolicy";
import schema from "./schema";

import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");

/** Element fields a programmatic edit deliberately randomises or timestamps. */
const stripDerived = (element: Record<string, unknown>) => {
  const { updated, versionNonce, ...rest } = element;
  return rest;
};

const textScene = (text: string, version = 1) =>
  JSON.stringify({
    elements: [
      {
        id: "text-1",
        type: "text",
        text,
        originalText: text,
        version,
        versionNonce: 11,
      },
      { id: "rect-1", type: "rectangle", version: 1, versionNonce: 12 },
    ],
    appState: { viewBackgroundColor: "#ffffff" },
    files: {},
  });

const largeTextScene = (rawSize: number, text = "Before") => {
  const marker = "__BOARD_SCENE_PADDING__";
  const template = JSON.stringify({
    elements: [
      {
        id: "text-1",
        type: "text",
        text,
        originalText: text,
        version: 1,
        versionNonce: 11,
      },
    ],
    appState: { padding: marker },
    files: {},
  });
  return template.replace(
    marker,
    "x".repeat(rawSize - template.length + marker.length),
  );
};

const docScene = (docId?: Id<"docs">) =>
  JSON.stringify({
    elements: docId
      ? [
          {
            id: "doc-card",
            type: "embeddable",
            link: `https://docs.yaseendraw.local/${docId}`,
            customData: {
              yaseenDoc: { docId, titleSnapshot: "Restored Doc" },
            },
          },
        ]
      : [],
    appState: {},
    files: {},
  });

const setup = async () => {
  const t = convexTest(schema, modules);
  const harness = createBoardSceneWorkerHarness(
    async (path, init) => await t.fetch(path, init),
  );
  vi.stubGlobal("fetch", harness.fetch);
  const ownerId = await t.run(async (ctx) =>
    ctx.db.insert("users", { name: "Scene owner" }),
  );
  const intruderId = await t.run(async (ctx) =>
    ctx.db.insert("users", { name: "Other user" }),
  );
  const owner = t.withIdentity({ subject: `${ownerId}|owner-session` });
  const intruder = t.withIdentity({ subject: `${intruderId}|other-session` });
  const board = await owner.mutation(api.boards.create, { title: "Scene" });
  return { t, harness, owner, intruder, board };
};

type Harness = Awaited<ReturnType<typeof setup>>;
type TestClient = Harness["owner"];

/** Exactly the pipeline a browser runs: compress, grant, upload, commit. */
const clientCommit = async (
  client: TestClient,
  boardId: Id<"diagrams">,
  purpose: "migration" | "save",
  expectedVersion: number,
  sceneJson: string,
) => {
  const compressed = await compressBoardScene(sceneJson);
  const docRefs = await describeDocPlacementRefs(sceneJson);
  const grant = await client.mutation(api.boardScenes.createUploadGrant, {
    boardId,
    clientSaveProtocol: CLOUD_SAVE_PROTOCOL_VERSION,
    purpose,
    expectedVersion,
    encoding: compressed.encoding,
    rawSize: compressed.rawSize,
    compressedSize: compressed.compressedSize,
    rawSha256: compressed.rawSha256,
    compressedSha256: compressed.compressedSha256,
    semanticSha256: compressed.semanticSha256,
    docRefsProtocolVersion: DOC_PLACEMENT_REFS_PROTOCOL_VERSION,
    docRefsHash: docRefs.hash,
    docRefs: docRefs.refs.map((ref) => ({
      ...ref,
      docId: ref.docId as Id<"docs">,
    })),
  });
  if (grant.status !== "upload") {
    return grant;
  }
  const etag = await uploadBoardSceneObject(grant.token, compressed);
  const committed = await client.mutation(api.boardScenes.commitUpload, {
    clientSaveProtocol: CLOUD_SAVE_PROTOCOL_VERSION,
    token: grant.token,
    etag,
  });
  if (committed.status !== "upgrade-required") {
    await deleteBoardSceneObjects(committed.cleanupToken);
  }
  return committed;
};

const readCurrentScene = async (
  client: TestClient,
  boardId: Id<"diagrams">,
) => {
  const grant = await client.mutation(api.boardScenes.createReadGrant, {
    boardId,
  });
  return await downloadBoardSceneObject(grant.path, grant);
};

const dueForSnapshot = async (t: Harness["t"], boardId: Id<"diagrams">) => {
  await t.run(async (ctx) => {
    const manifest = await ctx.db
      .query("diagramSceneManifests")
      .withIndex("by_diagramId", (q) => q.eq("diagramId", boardId))
      .unique();
    await ctx.db.patch("diagramSceneManifests", manifest!._id, {
      lastSnapshotAt: Date.now() - SNAPSHOT_INTERVAL_MS - 1,
    });
  });
};

beforeEach(() => {
  vi.stubEnv(
    BOARD_SCENE_WORKER_ORIGIN_VARIABLE,
    BOARD_SCENE_TEST_WORKER_ORIGIN,
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Board scenes through the private Worker", () => {
  it("stores a migrated scene and serves it back to its owner", async () => {
    const { owner, board, harness } = await setup();

    const committed = await clientCommit(
      owner,
      board.boardId,
      "migration",
      0,
      textScene("Before"),
    );

    expect(committed).toMatchObject({ status: "committed", version: 0 });
    expect(harness.objects.size).toBe(1);
    expect([...harness.objects.keys()][0]).toContain(BOARD_SCENE_KEY_PREFIX);
    await expect(readCurrentScene(owner, board.boardId)).resolves.toBe(
      textScene("Before"),
    );
  });

  it("stops serving a shared reader the moment sharing is revoked", async () => {
    const { t, owner, board } = await setup();
    await clientCommit(owner, board.boardId, "migration", 0, textScene("Live"));
    const { shareToken } = await owner.mutation(api.boards.setSharing, {
      boardId: board.boardId,
      enabled: true,
    });
    const shared = await t.mutation(api.boardScenes.createReadGrant, {
      shareToken: shareToken as string,
    });

    await expect(downloadBoardSceneObject(shared.path, shared)).resolves.toBe(
      textScene("Live"),
    );

    await owner.mutation(api.boards.setSharing, {
      boardId: board.boardId,
      enabled: false,
    });

    // The object is still there; the capability is what stopped resolving.
    await expect(downloadBoardSceneObject(shared.path, shared)).rejects.toThrow(
      "Board scene could not be downloaded",
    );
    await expect(readCurrentScene(owner, board.boardId)).resolves.toBe(
      textScene("Live"),
    );
  });

  it("never discloses an object key through a client-visible payload", async () => {
    const { owner, board, harness } = await setup();
    await clientCommit(owner, board.boardId, "migration", 0, textScene("Keys"));
    const objectKey = [...harness.objects.keys()][0];
    expect(objectKey.startsWith(BOARD_SCENE_KEY_PREFIX)).toBe(true);

    const [metadata, summaries, grant, snapshots] = await Promise.all([
      owner.query(api.boards.openMineMetadata, { slug: board.slug }),
      owner.query(api.boards.listMine, {}),
      owner.mutation(api.boardScenes.createReadGrant, {
        boardId: board.boardId,
      }),
      owner.query(api.boardHistory.list, { boardId: board.boardId }),
    ]);

    for (const payload of [metadata, summaries, grant, snapshots]) {
      expect(JSON.stringify(payload)).not.toContain(objectKey);
    }
    // Nor does the refusal a stale client receives on the legacy full-record
    // queries, which is the only Board-scene error those callers can see.
    await expect(
      owner.query(api.boards.openMine, { slug: board.slug }),
    ).rejects.toThrow(/^(?!.*board-scenes\/).*moved to object storage/s);
  });

  it("refuses both legacy full-record queries once a Board has migrated", async () => {
    const { t, owner, board } = await setup();
    await clientCommit(owner, board.boardId, "migration", 0, textScene("v0"));
    const { shareToken } = await owner.mutation(api.boards.setSharing, {
      boardId: board.boardId,
      enabled: true,
    });

    // A client old enough to ask for a whole scene document is told to reload
    // rather than served, and never reaches the large legacy row.
    await expect(
      owner.query(api.boards.openMine, { slug: board.slug }),
    ).rejects.toThrow("moved to object storage");
    await expect(
      t.query(api.boards.openShared, { shareToken: shareToken as string }),
    ).rejects.toThrow("moved to object storage");
    await expect(
      owner.query(api.boards.openMineScene, { slug: board.slug }),
    ).rejects.toThrow("moved to object storage");
    await expect(
      t.query(api.boards.openSharedScene, {
        shareToken: shareToken as string,
      }),
    ).rejects.toThrow("moved to object storage");
    await expect(
      owner.mutation(api.boards.save, {
        boardId: board.boardId,
        clientSaveProtocol: CLOUD_SAVE_PROTOCOL_VERSION,
        expectedVersion: 0,
        sceneJson: textScene("stale"),
      }),
    ).resolves.toEqual({ status: "upgrade-required" });

    // The metadata subscriptions both sides actually use keep working.
    await expect(
      owner.query(api.boards.openMineMetadata, { slug: board.slug }),
    ).resolves.toMatchObject({ version: 0 });
    await expect(
      t.query(api.boards.openSharedMetadata, {
        shareToken: shareToken as string,
      }),
    ).resolves.toMatchObject({ version: 0 });
  });

  it("keeps preview generation tied to the committed R2 version", async () => {
    const { t, owner, board } = await setup();
    await clientCommit(owner, board.boardId, "migration", 0, textScene("v0"));
    await clientCommit(owner, board.boardId, "save", 0, textScene("v1"));
    // The observation-window tool has already taken the legacy row away.
    await t.action(
      internal.legacyBoardContent.removeVerifiedLegacyContents,
      {},
    );

    const grant = await owner.mutation(api.boardPreviews.createUploadGrant, {
      boardId: board.boardId,
      sourceVersion: 1,
      mimeType: "image/webp",
      size: 1024,
      width: 600,
      height: 400,
    });

    expect(grant.token).toEqual(expect.any(String));
    await expect(
      owner.mutation(api.boardPreviews.createUploadGrant, {
        boardId: board.boardId,
        sourceVersion: 0,
        mimeType: "image/webp",
        size: 1024,
        width: 600,
        height: 400,
      }),
    ).rejects.toThrow("changed before preview upload");
  });
});

describe("programmatic edits on a migrated Board", () => {
  it("serializes an oversized server edit as structured Convex error data", async () => {
    const { owner, board } = await setup();
    await clientCommit(
      owner,
      board.boardId,
      "migration",
      0,
      largeTextScene(MAX_BOARD_SCENE_RAW_BYTES, "A"),
    );

    const error = await owner
      .action(api.programmaticBoardEdits.updateTextElement, {
        boardId: board.boardId,
        elementId: "text-1",
        text: "After",
      })
      .catch((caught: unknown) => caught);

    expect(
      typeof error === "object" &&
        error !== null &&
        Symbol.for("ConvexError") in error,
    ).toBe(true);
    expect(getBoardSceneSizeError(error)).toMatchObject({
      code: "BOARD_SCENE_TOO_LARGE",
      rawSize: expect.any(Number),
      maxRawSize: MAX_BOARD_SCENE_RAW_BYTES,
    });
  });

  it("edits and restores an R2 scene above the legacy 900 KB ceiling", async () => {
    const { owner, board } = await setup();
    const largeScene = largeTextScene(910_000);
    await clientCommit(owner, board.boardId, "migration", 0, largeScene);
    const savedLargeScene = largeTextScene(910_000, "Saved");
    await clientCommit(owner, board.boardId, "save", 0, savedLargeScene);

    await owner.action(api.programmaticBoardEdits.updateTextElement, {
      boardId: board.boardId,
      elementId: "text-1",
      text: "After",
    });
    const [snapshot] = await owner.query(api.boardHistory.list, {
      boardId: board.boardId,
    });

    await owner.action(api.boardHistory.restore, {
      boardId: board.boardId,
      snapshotId: snapshot._id,
    });

    await expect(readCurrentScene(owner, board.boardId)).resolves.toBe(
      savedLargeScene,
    );
  });

  it("keeps the 900 KB ceiling on legacy programmatic persistence", async () => {
    const { t, owner, board } = await setup();
    await t.run(async (ctx) => {
      const content = await ctx.db
        .query("diagramContents")
        .withIndex("by_diagramId", (q) => q.eq("diagramId", board.boardId))
        .unique();
      await ctx.db.patch(content!._id, { sceneJson: largeTextScene(910_000) });
    });

    await expect(
      owner.action(api.programmaticBoardEdits.updateTextElement, {
        boardId: board.boardId,
        elementId: "text-1",
        text: "After",
      }),
    ).rejects.toThrow("too large");
  });

  it("applies a text edit and force-preserves the version it replaces", async () => {
    const { t, owner, board, harness } = await setup();
    await clientCommit(
      owner,
      board.boardId,
      "migration",
      0,
      textScene("Before"),
    );
    await clientCommit(owner, board.boardId, "save", 0, textScene("Saved", 2));
    const replaced = [...harness.objects.keys()];

    const result = await owner.action(
      api.programmaticBoardEdits.updateTextElement,
      { boardId: board.boardId, elementId: "text-1", text: "After" },
    );

    expect(result).toEqual({
      version: 2,
      updatedAt: expect.any(Number),
    });
    const scene = JSON.parse(await readCurrentScene(owner, board.boardId));
    expect(scene.elements[0]).toMatchObject({
      id: "text-1",
      text: "After",
      originalText: "After",
      version: 3,
    });
    expect(scene.elements[1]).toMatchObject({ id: "rect-1", version: 1 });
    expect(scene.appState).toEqual({ viewBackgroundColor: "#ffffff" });

    // The displaced version is preserved as a metadata-only snapshot, and its
    // object survives so the snapshot can actually be read back.
    const snapshots = await t.run(async (ctx) =>
      ctx.db.query("diagramSnapshots").collect(),
    );
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({ version: 1 });
    expect(snapshots[0].sceneJson).toBeUndefined();
    expect(snapshots[0].objectKey).toBe(replaced[replaced.length - 1]);
    expect(harness.objects.has(snapshots[0].objectKey!)).toBe(true);
  });

  it("produces the same result on a migrated and an unmigrated Board", async () => {
    const { owner, board } = await setup();
    const legacyBoard = await owner.mutation(api.boards.create, {
      title: "Legacy",
    });
    await owner.mutation(api.boards.save, {
      boardId: legacyBoard.boardId,
      clientSaveProtocol: CLOUD_SAVE_PROTOCOL_VERSION,
      expectedVersion: 0,
      sceneJson: textScene("Before"),
    });
    await clientCommit(
      owner,
      board.boardId,
      "migration",
      0,
      textScene("Before"),
    );

    const updates = JSON.stringify([
      { elementId: "rect-1", patch: { x: 42, id: "ignored", version: 99 } },
    ]);
    const [migrated, legacy] = await Promise.all([
      owner.action(api.programmaticBoardEdits.patchElements, {
        boardId: board.boardId,
        updatesJson: updates,
      }),
      owner.action(api.programmaticBoardEdits.patchElements, {
        boardId: legacyBoard.boardId,
        updatesJson: updates,
      }),
    ]);

    // Each Board advances by exactly one version from where it was, and the
    // resulting elements are identical apart from the deliberately random
    // nonce and the edit timestamp.
    expect(migrated.version).toBe(1);
    expect(legacy.version).toBe(2);
    const migratedScene = JSON.parse(
      await readCurrentScene(owner, board.boardId),
    );
    const legacyScene = JSON.parse(
      (await owner.query(api.boards.openMineScene, { slug: legacyBoard.slug }))!
        .sceneJson,
    );
    expect(migratedScene.elements.map(stripDerived)).toEqual(
      legacyScene.elements.map(stripDerived),
    );
    expect(migratedScene.elements[1]).toMatchObject({
      id: "rect-1",
      type: "rectangle",
      x: 42,
      version: 2,
    });
  });

  it("rejects the same inputs the single-transaction path rejected", async () => {
    const { owner, intruder, board } = await setup();
    await clientCommit(owner, board.boardId, "migration", 0, textScene("Hi"));

    await expect(
      owner.action(api.programmaticBoardEdits.updateTextElement, {
        boardId: board.boardId,
        elementId: "missing",
        text: "After",
      }),
    ).rejects.toThrow("Text element not found");
    await expect(
      owner.action(api.programmaticBoardEdits.updateTextElement, {
        boardId: board.boardId,
        elementId: "text-1",
        text: "x".repeat(10_001),
      }),
    ).rejects.toThrow("Text is too long");
    await expect(
      intruder.action(api.programmaticBoardEdits.updateTextElement, {
        boardId: board.boardId,
        elementId: "text-1",
        text: "After",
      }),
    ).rejects.toThrow("Board not found");
    await expect(
      owner.action(api.programmaticBoardEdits.patchElements, {
        boardId: board.boardId,
        updatesJson: "[]",
      }),
    ).rejects.toThrow("Element updates are invalid");
  });

  it("retries over a browser save that lands mid-edit instead of overwriting it", async () => {
    const { owner, board, harness } = await setup();
    await clientCommit(owner, board.boardId, "migration", 0, textScene("Base"));
    let concurrentSaves = 0;
    const workerFetch = harness.fetch;
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init: RequestInit = {}) => {
        if (init.method === "POST" && concurrentSaves === 0) {
          concurrentSaves += 1;
          await clientCommit(
            owner,
            board.boardId,
            "save",
            0,
            JSON.stringify({
              elements: [
                {
                  id: "text-1",
                  type: "text",
                  text: "Base",
                  originalText: "Base",
                  version: 5,
                  versionNonce: 11,
                },
                { id: "rect-1", type: "rectangle", version: 9, y: 7 },
              ],
              appState: { viewBackgroundColor: "#ffffff" },
              files: {},
            }),
          );
        }
        return await workerFetch(input, init);
      },
    );

    const result = await owner.action(
      api.programmaticBoardEdits.updateTextElement,
      { boardId: board.boardId, elementId: "text-1", text: "Programmatic" },
    );

    expect(concurrentSaves).toBe(1);
    expect(result.version).toBe(2);
    const scene = JSON.parse(await readCurrentScene(owner, board.boardId));
    expect(scene.elements[0]).toMatchObject({
      text: "Programmatic",
      version: 6,
    });
    // The concurrent save was not overwritten: its rectangle survived.
    expect(scene.elements[1]).toMatchObject({ version: 9, y: 7 });
  });
});

describe("history restore on a migrated Board", () => {
  it("reconciles Doc placements from the exact restored snapshot", async () => {
    const { t, owner, board } = await setup();
    const doc = await owner.mutation(api.docs.create, { folderId: null });
    await clientCommit(owner, board.boardId, "migration", 0, docScene());
    await clientCommit(owner, board.boardId, "save", 0, docScene(doc.docId));
    await dueForSnapshot(t, board.boardId);
    await clientCommit(owner, board.boardId, "save", 1, docScene());
    const [snapshot] = await owner.query(api.boardHistory.list, {
      boardId: board.boardId,
    });
    await expect(
      t.run(async (ctx) => ctx.db.query("docPlacements").collect()),
    ).resolves.toEqual([]);

    await owner.action(api.boardHistory.restore, {
      boardId: board.boardId,
      snapshotId: snapshot._id,
    });

    await expect(
      t.run(async (ctx) => ctx.db.query("docPlacements").collect()),
    ).resolves.toMatchObject([
      { diagramId: board.boardId, docId: doc.docId, elementId: "doc-card" },
    ]);
  });

  it("lists legacy and R2 snapshots together in the existing order", async () => {
    const { t, owner, board } = await setup();
    await t.run(async (ctx) => {
      const createdBy = (await ctx.db.query("users").first())!._id;
      for (const version of [1, 3]) {
        await ctx.db.insert("diagramSnapshots", {
          diagramId: board.boardId,
          createdBy,
          sceneJson: textScene(`legacy-${version}`),
          version,
          createdAt: 1_000 + version,
        });
      }
      for (const version of [2, 4]) {
        await ctx.db.insert("diagramSnapshots", {
          diagramId: board.boardId,
          createdBy,
          objectKey: `board-scenes/${board.boardId}/v${version}.bin`,
          encoding: "deflate-v1",
          rawSize: 10,
          compressedSize: 5,
          rawSha256: "a".repeat(64),
          compressedSha256: "b".repeat(64),
          semanticSha256: "c".repeat(64),
          etag: `etag-${version}`,
          version,
          createdAt: 1_000 + version,
        });
      }
    });

    const history = await owner.query(api.boardHistory.list, {
      boardId: board.boardId,
    });

    expect(history.map((entry) => entry.version)).toEqual([4, 3, 2, 1]);
    for (const entry of history) {
      expect(Object.keys(entry).sort()).toEqual([
        "_id",
        "createdAt",
        "version",
      ]);
    }
  });

  it("commits an R2 snapshot as a new version and preserves the displaced one", async () => {
    const { t, owner, board, harness } = await setup();
    await clientCommit(owner, board.boardId, "migration", 0, textScene("v0"));
    await clientCommit(owner, board.boardId, "save", 0, textScene("v1"));
    await dueForSnapshot(t, board.boardId);
    await clientCommit(owner, board.boardId, "save", 1, textScene("v2"));
    const [snapshot] = await owner.query(api.boardHistory.list, {
      boardId: board.boardId,
    });
    expect(snapshot.version).toBe(1);

    const restored = await owner.action(api.boardHistory.restore, {
      boardId: board.boardId,
      snapshotId: snapshot._id,
    });

    expect(restored).toEqual({ version: 3, updatedAt: expect.any(Number) });
    await expect(readCurrentScene(owner, board.boardId)).resolves.toBe(
      textScene("v1"),
    );
    const snapshots = await owner.query(api.boardHistory.list, {
      boardId: board.boardId,
    });
    expect(snapshots.map((entry) => entry.version)).toEqual([2, 1]);
    // Every snapshot object is still readable, and nothing was orphaned.
    const rows = await t.run(async (ctx) =>
      ctx.db.query("diagramSnapshots").collect(),
    );
    for (const row of rows) {
      expect(harness.objects.has(row.objectKey!)).toBe(true);
    }
    expect(harness.objects.size).toBe(3);
  });

  it("restores a legacy snapshot the Board wrote before it migrated", async () => {
    const { t, owner, board } = await setup();
    await owner.mutation(api.boards.save, {
      boardId: board.boardId,
      clientSaveProtocol: CLOUD_SAVE_PROTOCOL_VERSION,
      expectedVersion: 0,
      sceneJson: textScene("legacy"),
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("diagramSnapshots", {
        diagramId: board.boardId,
        createdBy: (await ctx.db.query("users").first())!._id,
        sceneJson: textScene("legacy"),
        version: 1,
        createdAt: Date.now(),
      });
    });
    await clientCommit(owner, board.boardId, "migration", 1, textScene("live"));
    const [snapshot] = await owner.query(api.boardHistory.list, {
      boardId: board.boardId,
    });

    const restored = await owner.action(api.boardHistory.restore, {
      boardId: board.boardId,
      snapshotId: snapshot._id,
    });

    expect(restored.version).toBe(2);
    await expect(readCurrentScene(owner, board.boardId)).resolves.toBe(
      textScene("legacy"),
    );
    const snapshots = await t.run(async (ctx) =>
      ctx.db.query("diagramSnapshots").collect(),
    );
    expect(snapshots).toHaveLength(2);
    expect(snapshots.map((row) => row.version).sort()).toEqual([1, 1]);
  });

  it("refuses a snapshot that belongs to another Board or another owner", async () => {
    const { owner, intruder, board } = await setup();
    await clientCommit(owner, board.boardId, "migration", 0, textScene("v0"));
    await clientCommit(owner, board.boardId, "save", 0, textScene("v1"));
    const other = await owner.mutation(api.boards.create, { title: "Other" });
    const [snapshot] = await owner.query(api.boardHistory.list, {
      boardId: board.boardId,
    });

    await expect(
      intruder.action(api.boardHistory.restore, {
        boardId: board.boardId,
        snapshotId: snapshot?._id ?? ("x" as Id<"diagramSnapshots">),
      }),
    ).rejects.toThrow();
    await expect(
      owner.action(api.boardHistory.restore, {
        boardId: other.boardId,
        snapshotId: snapshot?._id ?? ("x" as Id<"diagramSnapshots">),
      }),
    ).rejects.toThrow();
  });
});

describe("deletion with mixed legacy and R2 snapshots", () => {
  it("purges every snapshot row and authorizes the whole Board scene folder", async () => {
    const { t, owner, board, harness } = await setup();
    await owner.mutation(api.boards.save, {
      boardId: board.boardId,
      clientSaveProtocol: CLOUD_SAVE_PROTOCOL_VERSION,
      expectedVersion: 0,
      sceneJson: textScene("legacy"),
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("diagramSnapshots", {
        diagramId: board.boardId,
        createdBy: (await ctx.db.query("users").first())!._id,
        sceneJson: textScene("legacy"),
        version: 1,
        createdAt: Date.now(),
      });
    });
    await clientCommit(owner, board.boardId, "migration", 1, textScene("v1"));
    await dueForSnapshot(t, board.boardId);
    await clientCommit(owner, board.boardId, "save", 1, textScene("v2"));
    expect(harness.objects.size).toBe(2);

    vi.useFakeTimers();
    const removed = await owner.mutation(api.boards.remove, {
      boardId: board.boardId,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    vi.useRealTimers();
    const cleanup = await fetch(
      `${BOARD_SCENE_TEST_WORKER_ORIGIN}/api/board-scenes`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${removed.sceneDeleteToken}` },
      },
    );

    expect(cleanup.status).toBe(200);
    expect(harness.objects.size).toBe(0);
    const remaining = await t.run(async (ctx) => ({
      snapshots: await ctx.db.query("diagramSnapshots").collect(),
      manifests: await ctx.db.query("diagramSceneManifests").collect(),
      contents: await ctx.db.query("diagramContents").collect(),
    }));
    expect(remaining.snapshots).toHaveLength(0);
    expect(remaining.manifests).toHaveLength(0);
    expect(remaining.contents).toHaveLength(0);
  });
});
