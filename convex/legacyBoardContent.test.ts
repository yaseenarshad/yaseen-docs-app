// @vitest-environment edge-runtime
/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BOARD_SCENE_TEST_WORKER_ORIGIN,
  BOARD_SCENE_TEST_R2_ENV,
  createBoardSceneWorkerHarness,
} from "../board-scenes/testWorkerHarness";
import { BOARD_SCENE_KEY_PREFIX } from "../board-scenes/types";

import { api, internal } from "./_generated/api";
import {
  BOARD_SCENE_WORKER_ORIGIN_VARIABLE,
  compressBoardScene,
  uploadBoardSceneObject,
} from "./boardSceneTransport";
import { CLOUD_SAVE_PROTOCOL_VERSION } from "./cloudSaveProtocol";
import schema from "./schema";

import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");

const sceneJson = JSON.stringify({
  elements: [{ id: "rect-1", type: "rectangle", version: 1 }],
  appState: { viewBackgroundColor: "#ffffff" },
  files: {},
});

const setup = async () => {
  const t = convexTest(schema, modules);
  const harness = createBoardSceneWorkerHarness(
    async (path, init) => await t.fetch(path, init),
  );
  vi.stubGlobal("fetch", harness.fetch);
  const ownerId = await t.run(async (ctx) =>
    ctx.db.insert("users", { name: "Legacy owner" }),
  );
  const owner = t.withIdentity({ subject: `${ownerId}|owner-session` });
  return { t, harness, owner };
};

type Setup = Awaited<ReturnType<typeof setup>>;

const migratedBoard = async (setupResult: Setup, title: string) => {
  const { owner } = setupResult;
  const board = await owner.mutation(api.boards.create, { title });
  const compressed = await compressBoardScene(sceneJson);
  const grant = await owner.mutation(api.boardScenes.createUploadGrant, {
    boardId: board.boardId,
    clientSaveProtocol: CLOUD_SAVE_PROTOCOL_VERSION,
    purpose: "migration",
    expectedVersion: 0,
    encoding: compressed.encoding,
    rawSize: compressed.rawSize,
    compressedSize: compressed.compressedSize,
    rawSha256: compressed.rawSha256,
    compressedSha256: compressed.compressedSha256,
    semanticSha256: compressed.semanticSha256,
  });
  if (grant.status !== "upload") {
    throw new Error(`Expected an upload grant, received ${grant.status}`);
  }
  const permission = await owner.action(api.boardSceneUploads.prepareUpload, {
    token: grant.token,
  });
  await uploadBoardSceneObject(permission, compressed);
  const result = await owner.action(api.boardSceneUploads.finalizeUpload, {
    clientSaveProtocol: CLOUD_SAVE_PROTOCOL_VERSION,
    token: grant.token,
  });
  expect(result).toMatchObject({ status: "committed", version: 0 });
  return board;
};

const legacyRows = async (t: Setup["t"]) =>
  await t.run(async (ctx) => ctx.db.query("diagramContents").collect());

const removeLegacyContents = async (
  t: Setup["t"],
  args: { cursor?: string | null; batchSize?: number } = {},
) =>
  await t.action(
    internal.legacyBoardContent.removeVerifiedLegacyContents,
    args,
  );

beforeEach(() => {
  for (const [name, value] of Object.entries(BOARD_SCENE_TEST_R2_ENV)) {
    vi.stubEnv(name, value);
  }
  vi.stubEnv(
    BOARD_SCENE_WORKER_ORIGIN_VARIABLE,
    BOARD_SCENE_TEST_WORKER_ORIGIN,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("verified legacy scene removal", () => {
  it("removes a legacy row only after its R2 object reads back", async () => {
    const context = await setup();
    const migrated = await migratedBoard(context, "Migrated");
    const untouched = await context.owner.mutation(api.boards.create, {
      title: "Never migrated",
    });

    const result = await removeLegacyContents(context.t);

    expect(result).toMatchObject({
      examined: 1,
      removed: 1,
      alreadyRemoved: 0,
      kept: 0,
      isDone: true,
    });
    const remaining = await legacyRows(context.t);
    expect(remaining.map((row) => row.diagramId)).toEqual([untouched.boardId]);
    // The migrated Board still opens: its manifest and object are untouched.
    const metadata = await context.owner.query(api.boards.openMineMetadata, {
      slug: migrated.slug,
    });
    expect(metadata?.sceneManifest?.version).toBe(0);
    expect(
      [...context.harness.objects.keys()].filter((key) =>
        key.startsWith(BOARD_SCENE_KEY_PREFIX),
      ),
    ).toHaveLength(1);
  });

  it("keeps the legacy row when the object cannot be verified", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const context = await setup();
    const board = await migratedBoard(context, "Corrupted");
    // Same length, same etag, different bytes: only the checksum catches it.
    const key = [...context.harness.objects.keys()].find((key) =>
      key.startsWith(BOARD_SCENE_KEY_PREFIX),
    )!;
    const stored = context.harness.objects.get(key)!;
    const corrupted = stored.bytes.slice();
    corrupted[corrupted.length - 1] ^= 0xff;
    context.harness.objects.set(key, { ...stored, bytes: corrupted });

    const result = await removeLegacyContents(context.t);

    expect(result).toMatchObject({ examined: 1, removed: 0, kept: 1 });
    expect(warn).toHaveBeenCalledTimes(1);
    const remaining = await legacyRows(context.t);
    expect(remaining.map((row) => row.diagramId)).toEqual([board.boardId]);
  });

  it("keeps the legacy row when the object is gone entirely", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const context = await setup();
    await migratedBoard(context, "Missing object");
    context.harness.objects.clear();

    const result = await removeLegacyContents(context.t);

    expect(result).toMatchObject({ removed: 0, kept: 1 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(await legacyRows(context.t)).toHaveLength(1);
  });

  it("is bounded per call and idempotent across runs", async () => {
    const context = await setup();
    await migratedBoard(context, "First");
    await migratedBoard(context, "Second");
    await migratedBoard(context, "Third");

    const first = await removeLegacyContents(context.t, { batchSize: 2 });
    expect(first).toMatchObject({ examined: 2, removed: 2, isDone: false });

    const second = await removeLegacyContents(context.t, {
      batchSize: 2,
      cursor: first.continueCursor,
    });
    expect(second).toMatchObject({ examined: 1, removed: 1, isDone: true });
    expect(await legacyRows(context.t)).toHaveLength(0);

    const repeated = await removeLegacyContents(context.t, { batchSize: 50 });
    expect(repeated).toMatchObject({
      examined: 3,
      removed: 0,
      alreadyRemoved: 3,
      kept: 0,
    });
  });

  it("leaves the row alone when a save lands between verification and removal", async () => {
    const context = await setup();
    const board = await migratedBoard(context, "Racing");

    const prepared = await context.t.mutation(
      internal.legacyBoardContent.beginLegacyContentRemoval,
      { boardId: board.boardId },
    );
    await context.t.run(async (ctx) => {
      const manifest = await ctx.db
        .query("diagramSceneManifests")
        .withIndex("by_diagramId", (q) => q.eq("diagramId", board.boardId))
        .unique();
      await ctx.db.patch("diagramSceneManifests", manifest!._id, {
        version: manifest!.version + 1,
      });
    });

    const outcome = await context.t.mutation(
      internal.legacyBoardContent.finishLegacyContentRemoval,
      {
        boardId: board.boardId,
        verifiedVersion: prepared!.version,
      },
    );

    expect(outcome).toBe("superseded");
    expect(await legacyRows(context.t)).toHaveLength(1);
  });

  it("never reaches a Board that has not migrated", async () => {
    const context = await setup();
    const board = await context.owner.mutation(api.boards.create, {
      title: "Legacy only",
    });

    const result = await removeLegacyContents(context.t);

    expect(result).toMatchObject({ examined: 0, removed: 0, isDone: true });
    await expect(
      context.owner.query(api.boards.openMineScene, { slug: board.slug }),
    ).resolves.toMatchObject({ version: 0 });
    expect(
      await context.t.mutation(
        internal.legacyBoardContent.beginLegacyContentRemoval,
        { boardId: board.boardId as Id<"diagrams"> },
      ),
    ).toBeNull();
  });
});
