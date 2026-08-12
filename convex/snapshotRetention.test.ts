// @vitest-environment edge-runtime
/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BOARD_SCENE_ENCODING } from "../board-scenes/types";

import { api, internal } from "./_generated/api";
import {
  MINIMUM_RETAINED_SNAPSHOTS,
  SNAPSHOT_RETENTION_MS,
} from "./snapshotPolicy";
import schema from "./schema";

import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");

const hex = (label: string) => label.padEnd(64, "0");

const setup = async () => {
  const t = convexTest(schema, modules);
  const ownerId = await t.run(async (ctx) =>
    ctx.db.insert("users", { name: "Retention owner" }),
  );
  const owner = t.withIdentity({ subject: `${ownerId}|owner-session` });
  const board = await owner.mutation(api.boards.create, { title: "Retention" });
  return { t, owner, ownerId, board };
};

type Setup = Awaited<ReturnType<typeof setup>>;

const insertSnapshot = async (
  t: Setup["t"],
  args: {
    diagramId: Id<"diagrams">;
    ownerId: Id<"users">;
    version: number;
    createdAt: number;
    objectKey?: string;
  },
) =>
  await t.run(async (ctx) =>
    ctx.db.insert("diagramSnapshots", {
      diagramId: args.diagramId,
      createdBy: args.ownerId,
      version: args.version,
      createdAt: args.createdAt,
      ...(args.objectKey
        ? {
            objectKey: args.objectKey,
            encoding: BOARD_SCENE_ENCODING,
            rawSize: 2048,
            compressedSize: 512,
            rawSha256: hex("a1"),
            compressedSha256: hex("b2"),
            semanticSha256: hex(`c${args.version}`),
            etag: `etag-${args.version}`,
          }
        : { sceneJson: JSON.stringify({ elements: [], appState: {} }) }),
    }),
  );

const runDailyCleanup = async (t: Setup["t"]) => {
  vi.useFakeTimers();
  try {
    await t.mutation(internal.snapshotRetention.startDailyCleanup, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  } finally {
    vi.useRealTimers();
  }
};

const pendingCleanupKeys = async (t: Setup["t"]) => {
  const grants = await t.run(async (ctx) =>
    ctx.db.query("boardSceneDeleteGrants").collect(),
  );
  return grants.flatMap((grant) => grant.objectKeys).sort();
};

afterEach(() => {
  vi.useRealTimers();
});

describe("snapshot retention across legacy and R2 snapshots", () => {
  it("retires expired R2 objects through an idempotent delete capability", async () => {
    const { t, ownerId, board } = await setup();
    const expired = Date.now() - SNAPSHOT_RETENTION_MS - 60_000;
    const fresh = Date.now();
    // The retention floor is what normally protects these rows, so the floor
    // is filled with recent snapshots before the expired ones are added.
    for (let index = 0; index < MINIMUM_RETAINED_SNAPSHOTS; index++) {
      await insertSnapshot(t, {
        diagramId: board.boardId,
        ownerId,
        version: 1000 + index,
        createdAt: fresh + index,
        objectKey: `board-scenes/${board.boardId}/fresh-${index}.bin`,
      });
    }
    await insertSnapshot(t, {
      diagramId: board.boardId,
      ownerId,
      version: 1,
      createdAt: expired,
      objectKey: `board-scenes/${board.boardId}/retired.bin`,
    });
    await insertSnapshot(t, {
      diagramId: board.boardId,
      ownerId,
      version: 2,
      createdAt: expired + 1,
    });

    await runDailyCleanup(t);

    const remaining = await t.run(async (ctx) =>
      ctx.db.query("diagramSnapshots").collect(),
    );
    expect(remaining).toHaveLength(MINIMUM_RETAINED_SNAPSHOTS);
    expect(remaining.every((row) => row.createdAt >= fresh)).toBe(true);
    // Only the retired R2 snapshot needs an object deleted; the legacy row
    // carried its scene inline and leaves nothing behind.
    expect(await pendingCleanupKeys(t)).toEqual([
      `board-scenes/${board.boardId}/retired.bin`,
    ]);

    await runDailyCleanup(t);
    expect(
      await t.run(async (ctx) => ctx.db.query("diagramSnapshots").collect()),
    ).toHaveLength(MINIMUM_RETAINED_SNAPSHOTS);
  });

  it("keeps the 100-snapshot floor even when every snapshot is expired", async () => {
    const { t, ownerId, board } = await setup();
    const expired = Date.now() - SNAPSHOT_RETENTION_MS - 60_000;
    for (let index = 0; index < MINIMUM_RETAINED_SNAPSHOTS + 5; index++) {
      await insertSnapshot(t, {
        diagramId: board.boardId,
        ownerId,
        version: index + 1,
        createdAt: expired + index,
        objectKey: `board-scenes/${board.boardId}/old-${index}.bin`,
      });
    }

    await runDailyCleanup(t);

    const remaining = await t.run(async (ctx) =>
      ctx.db.query("diagramSnapshots").collect(),
    );
    expect(remaining).toHaveLength(MINIMUM_RETAINED_SNAPSHOTS);
    // The five oldest are the ones that went, and each handed back its object.
    expect(remaining.map((row) => row.version).sort((a, b) => a - b)[0]).toBe(
      6,
    );
    expect(await pendingCleanupKeys(t)).toEqual(
      [0, 1, 2, 3, 4].map(
        (index) => `board-scenes/${board.boardId}/old-${index}.bin`,
      ),
    );
  });

  it("keeps snapshots inside the 30-day window", async () => {
    const { t, ownerId, board } = await setup();
    for (let index = 0; index < MINIMUM_RETAINED_SNAPSHOTS + 5; index++) {
      await insertSnapshot(t, {
        diagramId: board.boardId,
        ownerId,
        version: index + 1,
        createdAt: Date.now() - SNAPSHOT_RETENTION_MS + 60_000 + index,
        objectKey: `board-scenes/${board.boardId}/recent-${index}.bin`,
      });
    }

    await runDailyCleanup(t);

    expect(
      await t.run(async (ctx) => ctx.db.query("diagramSnapshots").collect()),
    ).toHaveLength(MINIMUM_RETAINED_SNAPSHOTS + 5);
    expect(await pendingCleanupKeys(t)).toEqual([]);
  });
});
