// @vitest-environment edge-runtime
/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DOC_CONTENT_ENCODING } from "../doc-content/types";

import { api, internal } from "./_generated/api";
import {
  MINIMUM_RETAINED_SNAPSHOTS,
  SNAPSHOT_RETENTION_MS,
} from "./snapshotPolicy";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const SHA256 = "a".repeat(64);

afterEach(() => vi.useRealTimers());

describe("Doc snapshot retention", () => {
  it("keeps the newest 100 and retires older R2 objects idempotently", async () => {
    const t = convexTest(schema, modules);
    const ownerId = await t.run(async (ctx) =>
      ctx.db.insert("users", { name: "Retention owner" }),
    );
    const owner = t.withIdentity({ subject: `${ownerId}|owner-session` });
    const doc = await owner.mutation(api.docs.create, { folderId: null });
    const expired = Date.now() - SNAPSHOT_RETENTION_MS - 60_000;
    await t.run(async (ctx) => {
      for (let index = 0; index < MINIMUM_RETAINED_SNAPSHOTS + 3; index++) {
        await ctx.db.insert("docContentSnapshots", {
          docId: doc.docId,
          version: index + 1,
          objectKey: `doc-content/${doc.docId}/old-${index}.bin`,
          encoding: DOC_CONTENT_ENCODING,
          rawSize: 10,
          compressedSize: 8,
          rawSha256: SHA256,
          compressedSha256: SHA256,
          etag: `etag-${index}`,
          assetRefsHash: SHA256,
          assetCount: 0,
          createdAt: expired + index,
        });
      }
    });

    vi.useFakeTimers();
    await t.mutation(internal.docSnapshotRetention.startDailyCleanup, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const result = await t.run(async (ctx) => ({
      snapshots: await ctx.db
        .query("docContentSnapshots")
        .withIndex("by_docId_and_createdAt", (q) => q.eq("docId", doc.docId))
        .take(200),
      grants: await ctx.db.query("docContentDeleteGrants").take(10),
    }));
    expect(result.snapshots).toHaveLength(MINIMUM_RETAINED_SNAPSHOTS);
    expect(result.snapshots[0].version).toBe(4);
    expect(result.grants.flatMap((grant) => grant.objectKeys).sort()).toEqual(
      [0, 1, 2].map((index) => `doc-content/${doc.docId}/old-${index}.bin`),
    );
  });
});
