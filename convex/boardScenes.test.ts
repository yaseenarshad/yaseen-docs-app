// @vitest-environment edge-runtime
/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import {
  BOARD_SCENE_CONTENT_TYPE,
  BOARD_SCENE_DELETE_GRANT_PATH,
  BOARD_SCENE_ENCODING,
  BOARD_SCENE_KEY_PREFIX,
  BOARD_SCENE_READ_GRANT_PATH,
  BOARD_SCENE_TOKEN_PATTERN,
  BOARD_SCENE_UPLOAD_GRANT_PATH,
  MAX_BOARD_SCENE_COMPRESSED_BYTES,
  MAX_BOARD_SCENE_RAW_BYTES,
  parseBoardSceneDeleteGrant,
  parseBoardSceneReadGrant,
  parseBoardSceneUploadGrant,
} from "../board-scenes/types";
import { getBoardSceneSizeError } from "../board-scenes/sizePolicy";
import {
  DOC_PLACEMENT_REFS_PROTOCOL_VERSION,
  hashDocPlacementRefs,
} from "../doc-placement/types";

import { api, internal } from "./_generated/api";
import { CLOUD_SAVE_PROTOCOL_VERSION } from "./cloudSaveProtocol";
import { SNAPSHOT_INTERVAL_MS } from "./snapshotPolicy";
import schema from "./schema";

import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");

const hex = (label: string) => label.padEnd(64, "0");

const sceneObject = (overrides: Record<string, unknown> = {}) => ({
  encoding: BOARD_SCENE_ENCODING as typeof BOARD_SCENE_ENCODING,
  rawSize: 4096,
  compressedSize: 1024,
  rawSha256: hex("a1"),
  compressedSha256: hex("b2"),
  semanticSha256: hex("c3"),
  ...overrides,
});

const setup = async () => {
  const t = convexTest(schema, modules);
  const ownerId = await t.run(async (ctx) =>
    ctx.db.insert("users", { name: "Scene owner" }),
  );
  const intruderId = await t.run(async (ctx) =>
    ctx.db.insert("users", { name: "Other user" }),
  );
  const owner = t.withIdentity({ subject: `${ownerId}|owner-session` });
  const intruder = t.withIdentity({ subject: `${intruderId}|other-session` });
  const board = await owner.mutation(api.boards.create, {
    title: "Scene board",
  });
  return { t, owner, intruder, board, ownerId };
};

type TestClient = Awaited<ReturnType<typeof setup>>["owner"];

const requestUploadGrant = async (
  client: TestClient,
  boardId: Id<"diagrams">,
  args: Record<string, unknown> = {},
) =>
  await client.mutation(api.boardScenes.createUploadGrant, {
    boardId,
    clientSaveProtocol: CLOUD_SAVE_PROTOCOL_VERSION,
    purpose: "migration",
    expectedVersion: 0,
    ...sceneObject(),
    ...args,
  } as never);

const commit = async (client: TestClient, token: string, etag: string) =>
  await client.mutation(api.boardScenes.commitUpload, {
    clientSaveProtocol: CLOUD_SAVE_PROTOCOL_VERSION,
    token,
    etag,
  });

const migrate = async (
  client: TestClient,
  boardId: Id<"diagrams">,
  overrides: Record<string, unknown> = {},
) => {
  const grant = await requestUploadGrant(client, boardId, overrides);
  if (grant.status !== "upload") {
    throw new Error(`Expected an upload grant, received ${grant.status}`);
  }
  const committed = await commit(client, grant.token, "etag-migrated");
  return { grant, committed };
};

const saveNextVersion = async (
  client: TestClient,
  boardId: Id<"diagrams">,
  expectedVersion: number,
  overrides: Record<string, unknown> = {},
) => {
  const grant = await requestUploadGrant(client, boardId, {
    purpose: "save",
    expectedVersion,
    ...sceneObject({
      rawSha256: hex(`d${expectedVersion}`),
      compressedSha256: hex(`e${expectedVersion}`),
      semanticSha256: hex(`f${expectedVersion}`),
    }),
    ...overrides,
  });
  if (grant.status !== "upload") {
    throw new Error(`Expected an upload grant, received ${grant.status}`);
  }
  const committed = await commit(
    client,
    grant.token,
    `etag-v${expectedVersion + 1}`,
  );
  return { grant, committed };
};

const readManifest = async (
  t: Awaited<ReturnType<typeof setup>>["t"],
  boardId: Id<"diagrams">,
) =>
  await t.run(async (ctx) =>
    ctx.db
      .query("diagramSceneManifests")
      .withIndex("by_diagramId", (q) => q.eq("diagramId", boardId))
      .unique(),
  );

describe("Board scene upload grants", () => {
  it("rejects an outdated save protocol before authentication or any read", async () => {
    const { t, board } = await setup();

    await expect(
      t.mutation(api.boardScenes.createUploadGrant, {
        boardId: board.boardId,
        clientSaveProtocol: CLOUD_SAVE_PROTOCOL_VERSION - 1,
        purpose: "save",
        expectedVersion: 0,
        ...sceneObject(),
      }),
    ).resolves.toEqual({ status: "upgrade-required" });
    await expect(
      t.mutation(api.boardScenes.commitUpload, {
        clientSaveProtocol: undefined,
        token: hex("ff"),
        etag: "etag",
      }),
    ).resolves.toEqual({ status: "upgrade-required" });

    const grants = await t.run(async (ctx) =>
      ctx.db.query("boardSceneUploadGrants").collect(),
    );
    expect(grants).toHaveLength(0);
  });

  it("only lets the authenticated owner mint a grant for their own Board", async () => {
    const { t, owner, intruder, board } = await setup();

    await expect(
      t.mutation(api.boardScenes.createUploadGrant, {
        boardId: board.boardId,
        clientSaveProtocol: CLOUD_SAVE_PROTOCOL_VERSION,
        purpose: "migration",
        expectedVersion: 0,
        ...sceneObject(),
      }),
    ).rejects.toThrow("Authentication required");
    await expect(requestUploadGrant(intruder, board.boardId)).rejects.toThrow(
      "Board not found",
    );

    const granted = await requestUploadGrant(owner, board.boardId);
    expect(granted).toMatchObject({ status: "upload", version: 0 });
    if (granted.status !== "upload") {
      throw new Error("Expected an upload grant");
    }
    expect(granted.token).toMatch(BOARD_SCENE_TOKEN_PATTERN);

    const stored = await t.run(async (ctx) =>
      ctx.db
        .query("boardSceneUploadGrants")
        .withIndex("by_token", (q) => q.eq("token", granted.token))
        .unique(),
    );
    expect(stored?.objectKey.startsWith(`${BOARD_SCENE_KEY_PREFIX}`)).toBe(
      true,
    );
    expect(stored?.objectKey).toContain(`${board.boardId}/`);
  });

  it("refuses a grant whose expected version is not the current version", async () => {
    const { owner, board } = await setup();

    await expect(
      requestUploadGrant(owner, board.boardId, { expectedVersion: 3 }),
    ).resolves.toEqual({ status: "conflict", version: 0 });
  });

  it("reuses an unresolved grant and rejects malformed integrity metadata", async () => {
    const { owner, board } = await setup();

    const first = await requestUploadGrant(owner, board.boardId);
    const repeated = await requestUploadGrant(owner, board.boardId);
    expect(repeated).toEqual(first);

    await expect(
      requestUploadGrant(owner, board.boardId, { rawSha256: "not-a-hash" }),
    ).rejects.toThrow("Board scene checksum is invalid");
    await expect(
      requestUploadGrant(owner, board.boardId, {
        rawSize: MAX_BOARD_SCENE_RAW_BYTES + 1,
        compressedSize: 1.5,
      }),
    ).rejects.toThrow("Board scene size is invalid");
  });

  it("accepts the new integrity ceilings and returns structured size failures", async () => {
    const { owner, board } = await setup();

    await expect(
      requestUploadGrant(owner, board.boardId, {
        rawSize: MAX_BOARD_SCENE_RAW_BYTES,
        compressedSize: MAX_BOARD_SCENE_COMPRESSED_BYTES,
      }),
    ).resolves.toMatchObject({ status: "upload" });

    const rawSize = MAX_BOARD_SCENE_RAW_BYTES + 1;
    const error = await requestUploadGrant(owner, board.boardId, {
      rawSize,
    }).catch((caught: unknown) => caught);
    expect(getBoardSceneSizeError(error)).toEqual({
      code: "BOARD_SCENE_TOO_LARGE",
      rawSize,
      maxRawSize: MAX_BOARD_SCENE_RAW_BYTES,
    });
  });
});

describe("Board scene commits", () => {
  it("reconciles owned Doc placements only inside an accepted commit", async () => {
    const { t, owner, board } = await setup();
    const firstDoc = await owner.mutation(api.docs.create, { folderId: null });
    const secondDoc = await owner.mutation(api.docs.create, { folderId: null });
    const initialRefs = [
      { docId: firstDoc.docId, elementId: "element-a" },
      { docId: secondDoc.docId, elementId: "element-b" },
    ];
    const initialHash = await hashDocPlacementRefs(initialRefs);

    await migrate(owner, board.boardId, {
      docRefsProtocolVersion: DOC_PLACEMENT_REFS_PROTOCOL_VERSION,
      docRefsHash: initialHash,
      docRefs: initialRefs,
    });
    await expect(
      t.run(async (ctx) =>
        ctx.db
          .query("docPlacements")
          .withIndex("by_diagramId_and_elementId", (q) =>
            q.eq("diagramId", board.boardId),
          )
          .collect(),
      ),
    ).resolves.toMatchObject(initialRefs);

    const nextRefs = [
      { docId: secondDoc.docId, elementId: "element-b" },
      { docId: firstDoc.docId, elementId: "element-c" },
    ];
    await saveNextVersion(owner, board.boardId, 0, {
      docRefsProtocolVersion: DOC_PLACEMENT_REFS_PROTOCOL_VERSION,
      docRefsHash: await hashDocPlacementRefs(nextRefs),
      docRefs: nextRefs,
    });

    const placements = await t.run(async (ctx) =>
      ctx.db
        .query("docPlacements")
        .withIndex("by_diagramId_and_elementId", (q) =>
          q.eq("diagramId", board.boardId),
        )
        .collect(),
    );
    expect(
      placements.map(({ docId, elementId }) => ({ docId, elementId })),
    ).toEqual(nextRefs);
  });

  it("skips placement reconciliation when the accepted sorted hash is unchanged", async () => {
    const { t, owner, board } = await setup();
    const doc = await owner.mutation(api.docs.create, { folderId: null });
    const refs = [{ docId: doc.docId, elementId: "element-a" }];
    const hash = await hashDocPlacementRefs(refs);
    await migrate(owner, board.boardId, {
      docRefsProtocolVersion: DOC_PLACEMENT_REFS_PROTOCOL_VERSION,
      docRefsHash: hash,
      docRefs: refs,
    });
    const sentinelId = await t.run(async (ctx) =>
      ctx.db.insert("docPlacements", {
        diagramId: board.boardId,
        docId: doc.docId,
        elementId: "sentinel-proves-no-reconcile-query",
        createdAt: 1,
        updatedAt: 1,
      }),
    );

    await saveNextVersion(owner, board.boardId, 0, {
      docRefsProtocolVersion: DOC_PLACEMENT_REFS_PROTOCOL_VERSION,
      docRefsHash: hash,
    });

    await expect(
      t.run(async (ctx) => ctx.db.get("docPlacements", sentinelId)),
    ).resolves.toMatchObject({
      elementId: "sentinel-proves-no-reconcile-query",
    });
  });

  it("accepts foreign Doc cards as inert metadata without granting access", async () => {
    const { t, owner, intruder, board } = await setup();
    const foreignDoc = await intruder.mutation(api.docs.create, {
      folderId: null,
    });
    const foreignRefs = [{ docId: foreignDoc.docId, elementId: "foreign" }];
    const foreignHash = await hashDocPlacementRefs(foreignRefs);

    await migrate(owner, board.boardId, {
      docRefsProtocolVersion: DOC_PLACEMENT_REFS_PROTOCOL_VERSION,
      docRefsHash: foreignHash,
      docRefs: foreignRefs,
    });

    await expect(
      t.run(async (ctx) => ctx.db.query("docPlacements").collect()),
    ).resolves.toEqual([]);
    await expect(readManifest(t, board.boardId)).resolves.toMatchObject({
      docRefsHash: foreignHash,
    });
  });

  it("rejects missing and forged refs while isolating stale updates", async () => {
    const { t, owner, board } = await setup();
    const ownedDoc = await owner.mutation(api.docs.create, { folderId: null });
    const ownedRefs = [{ docId: ownedDoc.docId, elementId: "owned" }];
    const ownedHash = await hashDocPlacementRefs(ownedRefs);

    await expect(
      requestUploadGrant(owner, board.boardId, {
        docRefsProtocolVersion: DOC_PLACEMENT_REFS_PROTOCOL_VERSION,
        docRefsHash: ownedHash,
      }),
    ).rejects.toThrow("Full Doc placement refs are required");
    await expect(
      requestUploadGrant(owner, board.boardId, {
        docRefsProtocolVersion: DOC_PLACEMENT_REFS_PROTOCOL_VERSION,
        docRefsHash: hex("ab"),
        docRefs: ownedRefs,
      }),
    ).rejects.toThrow("Doc placement hash does not match");
    await migrate(owner, board.boardId, {
      docRefsProtocolVersion: DOC_PLACEMENT_REFS_PROTOCOL_VERSION,
      docRefsHash: ownedHash,
      docRefs: ownedRefs,
    });
    const stale = await requestUploadGrant(owner, board.boardId, {
      purpose: "save",
      expectedVersion: 0,
      ...sceneObject({ semanticSha256: hex("aa") }),
      docRefsProtocolVersion: DOC_PLACEMENT_REFS_PROTOCOL_VERSION,
      docRefsHash: await hashDocPlacementRefs([]),
      docRefs: [],
    });
    if (stale.status !== "upload") {
      throw new Error("Expected an upload grant");
    }
    await saveNextVersion(owner, board.boardId, 0, {
      docRefsProtocolVersion: DOC_PLACEMENT_REFS_PROTOCOL_VERSION,
      docRefsHash: ownedHash,
    });
    await commit(owner, stale.token, "etag-stale");

    const placements = await t.run(async (ctx) =>
      ctx.db.query("docPlacements").collect(),
    );
    expect(placements).toMatchObject(ownedRefs);
  });

  it("commits a lazy migration without changing the user-visible modified time", async () => {
    const { t, owner, board } = await setup();
    const before = await owner.query(api.boards.openMineMetadata, {
      slug: board.slug,
    });

    const { committed } = await migrate(owner, board.boardId);

    expect(committed).toMatchObject({
      status: "committed",
      version: 0,
      snapshotCreated: false,
      cleanupToken: null,
    });
    const after = await owner.query(api.boards.openMineMetadata, {
      slug: board.slug,
    });
    expect(after?.board.updatedAt).toBe(before?.board.updatedAt);
    expect(after?.version).toBe(0);
    expect(after?.sceneManifest).toMatchObject({
      version: 0,
      encoding: BOARD_SCENE_ENCODING,
      rawSize: 4096,
      compressedSize: 1024,
      etag: "etag-migrated",
    });
    expect(after?.sceneManifest).not.toHaveProperty("objectKey");

    const snapshots = await t.run(async (ctx) =>
      ctx.db.query("diagramSnapshots").collect(),
    );
    expect(snapshots).toHaveLength(0);
  });

  it("increments the version and returns cleanup work for the superseded object", async () => {
    const { t, owner, board } = await setup();
    await migrate(owner, board.boardId);
    const migrated = await readManifest(t, board.boardId);

    const { committed } = await saveNextVersion(owner, board.boardId, 0);

    expect(committed).toMatchObject({ status: "committed", version: 1 });
    if (committed.status !== "committed") {
      throw new Error("Expected a committed save");
    }
    const manifest = await readManifest(t, board.boardId);
    expect(manifest?.version).toBe(1);
    expect(manifest?.etag).toBe("etag-v1");
    expect(manifest?.objectKey).not.toBe(migrated?.objectKey);

    // Version 0 is never snapshot-worthy, so the displaced object is garbage.
    expect(committed.snapshotCreated).toBe(false);
    expect(committed.cleanupToken).toEqual(expect.any(String));
    const cleanup = await t.mutation(internal.boardScenes.consumeDeleteGrant, {
      token: committed.cleanupToken as string,
    });
    expect(cleanup).toEqual({ objectKeys: [migrated?.objectKey] });
  });

  it("turns the displaced object into a metadata-only snapshot when one is due", async () => {
    const { t, owner, board } = await setup();
    await migrate(owner, board.boardId);
    await saveNextVersion(owner, board.boardId, 0);
    const displaced = await readManifest(t, board.boardId);
    await t.run(async (ctx) => {
      const manifest = await ctx.db
        .query("diagramSceneManifests")
        .withIndex("by_diagramId", (q) => q.eq("diagramId", board.boardId))
        .unique();
      await ctx.db.patch("diagramSceneManifests", manifest!._id, {
        lastSnapshotAt: Date.now() - SNAPSHOT_INTERVAL_MS - 1,
      });
    });

    const { committed } = await saveNextVersion(owner, board.boardId, 1);

    expect(committed).toMatchObject({
      status: "committed",
      version: 2,
      snapshotCreated: true,
      cleanupToken: null,
    });
    const snapshots = await t.run(async (ctx) =>
      ctx.db.query("diagramSnapshots").collect(),
    );
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      diagramId: board.boardId,
      version: 1,
      objectKey: displaced?.objectKey,
      etag: "etag-v1",
      encoding: BOARD_SCENE_ENCODING,
    });
    expect(snapshots[0].sceneJson).toBeUndefined();

    const history = await owner.query(api.boardHistory.list, {
      boardId: board.boardId,
    });
    expect(history).toEqual([
      { _id: snapshots[0]._id, version: 1, createdAt: expect.any(Number) },
    ]);
  });

  it("keeps the legacy snapshot union readable alongside metadata-only rows", async () => {
    const { t, owner, board } = await setup();
    await owner.mutation(api.boards.save, {
      boardId: board.boardId,
      clientSaveProtocol: CLOUD_SAVE_PROTOCOL_VERSION,
      expectedVersion: 0,
      sceneJson: JSON.stringify({
        elements: [],
        appState: { viewBackgroundColor: "#eee" },
        files: {},
      }),
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("diagramSnapshots", {
        diagramId: board.boardId,
        createdBy: (await ctx.db.query("users").first())!._id,
        sceneJson: JSON.stringify({ elements: [], appState: {} }),
        version: 1,
        createdAt: Date.now(),
      });
    });

    await migrate(owner, board.boardId, { expectedVersion: 1 });

    const history = await owner.query(api.boardHistory.list, {
      boardId: board.boardId,
    });
    expect(history).toHaveLength(1);
    expect(history[0].version).toBe(1);
  });

  it("rejects a stale commit and hands back cleanup for the orphan object", async () => {
    const { t, owner, board } = await setup();
    await migrate(owner, board.boardId);
    const stale = await requestUploadGrant(owner, board.boardId, {
      purpose: "save",
      expectedVersion: 0,
      ...sceneObject({ semanticSha256: hex("11") }),
    });
    if (stale.status !== "upload") {
      throw new Error("Expected an upload grant");
    }
    const orphanKey = await t.run(async (ctx) => {
      const grant = await ctx.db
        .query("boardSceneUploadGrants")
        .withIndex("by_token", (q) => q.eq("token", stale.token))
        .unique();
      return grant!.objectKey;
    });
    await saveNextVersion(owner, board.boardId, 0);

    const conflicted = await commit(owner, stale.token, "etag-orphan");

    expect(conflicted).toMatchObject({ status: "conflict", version: 1 });
    if (conflicted.status !== "conflict") {
      throw new Error("Expected a conflict");
    }
    await expect(
      t.mutation(internal.boardScenes.consumeDeleteGrant, {
        token: conflicted.cleanupToken as string,
      }),
    ).resolves.toEqual({ objectKeys: [orphanKey] });
    const manifest = await readManifest(t, board.boardId);
    expect(manifest?.version).toBe(1);
    expect(manifest?.objectKey).not.toBe(orphanKey);
  });

  it("refuses a commit whose grant, owner, or etag no longer matches", async () => {
    const { owner, intruder, board } = await setup();
    const grant = await requestUploadGrant(owner, board.boardId);
    if (grant.status !== "upload") {
      throw new Error("Expected an upload grant");
    }

    await expect(commit(intruder, grant.token, "etag-x")).rejects.toThrow(
      "Board scene upload grant expired",
    );
    await expect(commit(owner, grant.token, " ")).rejects.toThrow(
      "Invalid Board scene etag",
    );
    await expect(commit(owner, hex("ab"), "etag-x")).rejects.toThrow(
      "Board scene upload grant expired",
    );

    await commit(owner, grant.token, "etag-migrated");
    await expect(commit(owner, grant.token, "etag-migrated")).rejects.toThrow(
      "Board scene upload grant expired",
    );
  });

  it("treats a matching semantic hash as a no-op before any upload or scene read", async () => {
    const { t, owner, board } = await setup();
    await migrate(owner, board.boardId);
    // Corrupting the legacy row proves the no-op never consults it.
    await t.run(async (ctx) => {
      const content = await ctx.db
        .query("diagramContents")
        .withIndex("by_diagramId", (q) => q.eq("diagramId", board.boardId))
        .unique();
      await ctx.db.patch("diagramContents", content!._id, {
        sceneJson: "corrupted-legacy-scene",
      });
    });

    const echoed = await requestUploadGrant(owner, board.boardId, {
      purpose: "save",
      expectedVersion: 0,
      ...sceneObject({
        rawSha256: hex("99"),
        compressedSha256: hex("88"),
        semanticSha256: hex("c3"),
      }),
    });

    expect(echoed).toMatchObject({ status: "unchanged", version: 0 });
    const grants = await t.run(async (ctx) =>
      ctx.db.query("boardSceneUploadGrants").collect(),
    );
    expect(grants.filter((grant) => grant.purpose === "save")).toHaveLength(0);
  });

  it("requires a manifest before a save and refuses a second migration", async () => {
    const { owner, board } = await setup();

    await expect(
      requestUploadGrant(owner, board.boardId, { purpose: "save" }),
    ).rejects.toThrow("Board scene manifest is missing");

    await migrate(owner, board.boardId);
    await expect(
      requestUploadGrant(owner, board.boardId, {
        ...sceneObject({ semanticSha256: hex("22") }),
      }),
    ).rejects.toThrow("Board scene is already stored");
  });
});

describe("Board scene read grants", () => {
  it("authorizes the owner and a live share token, and revokes outstanding grants", async () => {
    const { t, owner, intruder, board } = await setup();
    await migrate(owner, board.boardId);
    const { shareToken } = await owner.mutation(api.boards.setSharing, {
      boardId: board.boardId,
      enabled: true,
    });

    const ownerGrant = await owner.mutation(api.boardScenes.createReadGrant, {
      boardId: board.boardId,
    });
    const sharedGrant = await t.mutation(api.boardScenes.createReadGrant, {
      shareToken: shareToken as string,
    });

    expect(ownerGrant).toMatchObject({
      version: 0,
      etag: "etag-migrated",
      path: `/api/board-scenes/${ownerGrant.token}`,
    });
    await expect(
      t.query(internal.boardScenes.resolveReadGrant, {
        token: sharedGrant.token,
      }),
    ).resolves.toMatchObject({ diagramId: board.boardId, version: 0 });

    await expect(
      intruder.mutation(api.boardScenes.createReadGrant, {
        boardId: board.boardId,
      }),
    ).rejects.toThrow("Board not found");
    await expect(
      t.mutation(api.boardScenes.createReadGrant, {
        shareToken: "not-a-share-token",
      }),
    ).rejects.toThrow("Shared board not found");

    await owner.mutation(api.boards.setSharing, {
      boardId: board.boardId,
      enabled: false,
    });
    await expect(
      t.query(internal.boardScenes.resolveReadGrant, {
        token: sharedGrant.token,
      }),
    ).resolves.toBeNull();
    await expect(
      t.query(internal.boardScenes.resolveReadGrant, {
        token: ownerGrant.token,
      }),
    ).resolves.not.toBeNull();
  });

  it("stops resolving a read grant once the object it named is superseded", async () => {
    const { t, owner, board } = await setup();
    await migrate(owner, board.boardId);
    const grant = await owner.mutation(api.boardScenes.createReadGrant, {
      boardId: board.boardId,
    });

    await saveNextVersion(owner, board.boardId, 0);

    await expect(
      t.query(internal.boardScenes.resolveReadGrant, { token: grant.token }),
    ).resolves.toBeNull();
  });

  it("issues an owner-only read grant for a metadata-only snapshot", async () => {
    const { t, owner, intruder, board } = await setup();
    await migrate(owner, board.boardId);
    await saveNextVersion(owner, board.boardId, 0);
    await t.run(async (ctx) => {
      const manifest = await ctx.db
        .query("diagramSceneManifests")
        .withIndex("by_diagramId", (q) => q.eq("diagramId", board.boardId))
        .unique();
      await ctx.db.patch("diagramSceneManifests", manifest!._id, {
        lastSnapshotAt: Date.now() - SNAPSHOT_INTERVAL_MS - 1,
      });
    });
    await saveNextVersion(owner, board.boardId, 1);
    const [snapshot] = await owner.query(api.boardHistory.list, {
      boardId: board.boardId,
    });

    const grant = await owner.mutation(api.boardScenes.createReadGrant, {
      boardId: board.boardId,
      snapshotId: snapshot._id,
    });

    expect(grant).toMatchObject({ version: 1, etag: "etag-v1" });
    await expect(
      intruder.mutation(api.boardScenes.createReadGrant, {
        boardId: board.boardId,
        snapshotId: snapshot._id,
      }),
    ).rejects.toThrow("Board not found");
  });
});

describe("Board scene Worker routes", () => {
  const resolve = async (
    t: Awaited<ReturnType<typeof setup>>["t"],
    path: string,
    token: string,
  ) =>
    await t.fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });

  it("returns exactly the grant shapes the Worker parsers accept", async () => {
    const { t, owner, board } = await setup();
    const grant = await requestUploadGrant(owner, board.boardId);
    if (grant.status !== "upload") {
      throw new Error("Expected an upload grant");
    }

    const uploadResponse = await resolve(
      t,
      BOARD_SCENE_UPLOAD_GRANT_PATH,
      grant.token,
    );
    expect(uploadResponse.status).toBe(200);
    const uploadGrant = parseBoardSceneUploadGrant(await uploadResponse.json());
    expect(uploadGrant).toMatchObject({
      diagramId: board.boardId,
      version: 0,
      encoding: BOARD_SCENE_ENCODING,
      contentType: BOARD_SCENE_CONTENT_TYPE,
      compressedSize: 1024,
      compressedSha256: hex("b2"),
      rawSize: 4096,
      rawSha256: hex("a1"),
    });

    await commit(owner, grant.token, "etag-migrated");
    const read = await owner.mutation(api.boardScenes.createReadGrant, {
      boardId: board.boardId,
    });
    const readResponse = await resolve(
      t,
      BOARD_SCENE_READ_GRANT_PATH,
      read.token,
    );
    const readGrant = parseBoardSceneReadGrant(await readResponse.json());
    expect(readGrant).toMatchObject({
      diagramId: board.boardId,
      version: 0,
      etag: "etag-migrated",
      contentType: BOARD_SCENE_CONTENT_TYPE,
    });

    const removed = await owner.mutation(api.boards.remove, {
      boardId: board.boardId,
    });
    const deleteResponse = await resolve(
      t,
      BOARD_SCENE_DELETE_GRANT_PATH,
      removed.sceneDeleteToken as string,
    );
    const deleteGrant = parseBoardSceneDeleteGrant(await deleteResponse.json());
    expect(deleteGrant).toEqual({
      objectKeys: [],
      objectKeyPrefix: `${BOARD_SCENE_KEY_PREFIX}${board.boardId}/`,
    });
  });

  it("resolves an upload grant once and refuses every other token", async () => {
    const { t, owner, board } = await setup();
    const grant = await requestUploadGrant(owner, board.boardId);
    if (grant.status !== "upload") {
      throw new Error("Expected an upload grant");
    }

    expect(
      (await resolve(t, BOARD_SCENE_UPLOAD_GRANT_PATH, grant.token)).status,
    ).toBe(200);
    expect(
      (await resolve(t, BOARD_SCENE_UPLOAD_GRANT_PATH, grant.token)).status,
    ).toBe(403);
    expect(
      (await resolve(t, BOARD_SCENE_READ_GRANT_PATH, hex("ab"))).status,
    ).toBe(403);
    expect(
      (await resolve(t, BOARD_SCENE_DELETE_GRANT_PATH, hex("ab"))).status,
    ).toBe(403);

    const malformed = await t.fetch(BOARD_SCENE_UPLOAD_GRANT_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(malformed.status).toBe(400);
  });
});

describe("Board scene cleanup and deletion", () => {
  it("purges manifests, grants and snapshot metadata when a Board is deleted", async () => {
    const { t, owner, board } = await setup();
    const doc = await owner.mutation(api.docs.create, { folderId: null });
    const refs = [{ docId: doc.docId, elementId: "doc-card" }];
    await migrate(owner, board.boardId, {
      docRefsProtocolVersion: DOC_PLACEMENT_REFS_PROTOCOL_VERSION,
      docRefsHash: await hashDocPlacementRefs(refs),
      docRefs: refs,
    });
    await owner.mutation(api.boardScenes.createReadGrant, {
      boardId: board.boardId,
    });
    await requestUploadGrant(owner, board.boardId, {
      purpose: "save",
      expectedVersion: 0,
      ...sceneObject({ semanticSha256: hex("44") }),
    });

    const removed = await owner.mutation(api.boards.remove, {
      boardId: board.boardId,
    });

    expect(removed.sceneDeleteToken).toEqual(expect.any(String));
    const remaining = await t.run(async (ctx) => ({
      manifests: await ctx.db.query("diagramSceneManifests").collect(),
      uploadGrants: await ctx.db.query("boardSceneUploadGrants").collect(),
      readGrants: await ctx.db.query("boardSceneReadGrants").collect(),
      snapshots: await ctx.db.query("diagramSnapshots").collect(),
      placements: await ctx.db.query("docPlacements").collect(),
    }));
    expect(remaining.manifests).toHaveLength(0);
    expect(remaining.uploadGrants).toHaveLength(0);
    expect(remaining.readGrants).toHaveLength(0);
    expect(remaining.snapshots).toHaveLength(0);
    expect(remaining.placements).toHaveLength(0);
  });

  it("prunes expired grants idempotently and offers the orphans for deletion", async () => {
    const { t, owner, board } = await setup();
    await migrate(owner, board.boardId);
    const abandoned = await requestUploadGrant(owner, board.boardId, {
      purpose: "save",
      expectedVersion: 0,
      ...sceneObject({ semanticSha256: hex("55") }),
    });
    if (abandoned.status !== "upload") {
      throw new Error("Expected an upload grant");
    }
    const orphanKey = await t.run(async (ctx) => {
      const grant = await ctx.db
        .query("boardSceneUploadGrants")
        .withIndex("by_token", (q) => q.eq("token", abandoned.token))
        .unique();
      await ctx.db.patch("boardSceneUploadGrants", grant!._id, {
        expiresAt: Date.now() - 1,
      });
      const read = await ctx.db.query("boardSceneReadGrants").collect();
      for (const stale of read) {
        await ctx.db.patch("boardSceneReadGrants", stale._id, {
          expiresAt: Date.now() - 1,
        });
      }
      return grant!.objectKey;
    });

    const first = await t.mutation(
      internal.boardSceneCleanup.pruneExpiredGrants,
      {},
    );
    const second = await t.mutation(
      internal.boardSceneCleanup.pruneExpiredGrants,
      {},
    );

    expect(first.uploadGrants).toBe(1);
    expect(second).toEqual({
      uploadGrants: 0,
      readGrants: 0,
      deleteGrants: 0,
      continuationScheduled: false,
    });
    const pending = await owner.query(api.boardScenes.pendingCleanup, {});
    expect(pending).toHaveLength(1);
    await expect(
      t.mutation(internal.boardScenes.consumeDeleteGrant, {
        token: pending[0],
      }),
    ).resolves.toEqual({ objectKeys: [orphanKey] });
    await expect(
      t.mutation(internal.boardScenes.consumeDeleteGrant, {
        token: pending[0],
      }),
    ).resolves.toBeNull();
  });

  it("lets the owner abandon an upload and reclaim its object", async () => {
    const { t, owner, intruder, board } = await setup();
    const grant = await requestUploadGrant(owner, board.boardId);
    if (grant.status !== "upload") {
      throw new Error("Expected an upload grant");
    }

    await expect(
      intruder.mutation(api.boardScenes.abandonUpload, { token: grant.token }),
    ).rejects.toThrow("Board scene upload grant not found");
    const abandoned = await owner.mutation(api.boardScenes.abandonUpload, {
      token: grant.token,
    });

    expect(abandoned.cleanupToken).toEqual(expect.any(String));
    await expect(
      t.mutation(internal.boardScenes.consumeDeleteGrant, {
        token: abandoned.cleanupToken as string,
      }),
    ).resolves.toMatchObject({ objectKeys: [expect.any(String)] });
    await expect(
      owner.mutation(api.boardScenes.abandonUpload, { token: grant.token }),
    ).rejects.toThrow("Board scene upload grant not found");
  });
});

describe("legacy Board paths after migration", () => {
  it("stops serving and accepting the legacy scene once a manifest exists", async () => {
    const { owner, board } = await setup();
    await migrate(owner, board.boardId);

    await expect(
      owner.query(api.boards.openMineScene, { slug: board.slug }),
    ).rejects.toThrow("moved to object storage");
    await expect(
      owner.query(api.boards.openMine, { slug: board.slug }),
    ).rejects.toThrow("moved to object storage");
    await expect(
      owner.mutation(api.boards.save, {
        boardId: board.boardId,
        clientSaveProtocol: CLOUD_SAVE_PROTOCOL_VERSION,
        expectedVersion: 0,
        sceneJson: JSON.stringify({ elements: [], appState: {}, files: {} }),
      }),
    ).resolves.toEqual({ status: "upgrade-required" });
    // The single-transaction programmatic path is still refused outright; a
    // migrated Board is only edited through the action that can fetch R2.
    await expect(
      owner.mutation(internal.boardSceneEdits.updateLegacyTextElement, {
        boardId: board.boardId,
        elementId: "element-1",
        text: "hello",
        entityName: "Board",
      }),
    ).rejects.toThrow("moved to object storage");
    await expect(
      owner.mutation(internal.boardSceneEdits.restoreLegacySnapshot, {
        boardId: board.boardId,
        snapshotId:
          "kd700000000000000000000000000000" as Id<"diagramSnapshots">,
        entityName: "Board",
      }),
    ).rejects.toThrow();
  });

  it("keeps unmigrated Boards on the legacy path", async () => {
    const { owner, board } = await setup();

    const opened = await owner.query(api.boards.openMineMetadata, {
      slug: board.slug,
    });
    expect(opened?.sceneManifest).toBeUndefined();
    await expect(
      owner.query(api.boards.openMineScene, { slug: board.slug }),
    ).resolves.toMatchObject({ version: 0 });
    await expect(
      owner.mutation(api.boards.save, {
        boardId: board.boardId,
        clientSaveProtocol: CLOUD_SAVE_PROTOCOL_VERSION,
        expectedVersion: 0,
        sceneJson: JSON.stringify({
          elements: [],
          appState: { viewBackgroundColor: "#fff" },
          files: {},
        }),
      }),
    ).resolves.toMatchObject({ status: "saved", version: 1 });
  });
});
