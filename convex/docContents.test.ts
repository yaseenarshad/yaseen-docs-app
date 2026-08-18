// @vitest-environment edge-runtime
/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";

import {
  DOC_CONTENT_ENCODING,
  DOC_CONTENT_KEY_PREFIX,
  DOC_CONTENT_SAVE_PROTOCOL_VERSION,
  DOC_CONTENT_TOKEN_PATTERN,
} from "../doc-content/types";

import { api, internal } from "./_generated/api";
import { SNAPSHOT_INTERVAL_MS } from "./snapshotPolicy";
import schema from "./schema";

import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");
const hex = (label: string) => label.padEnd(64, "0");
const EMPTY_ASSET_REFS_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const hashForLabel = (label: string, offset: number) =>
  (
    (Array.from(label).reduce((sum, char) => sum + char.charCodeAt(0), 0) +
      offset) %
    16
  )
    .toString(16)
    .repeat(64);

const contentObject = (overrides: Record<string, unknown> = {}) => ({
  encoding: DOC_CONTENT_ENCODING as typeof DOC_CONTENT_ENCODING,
  rawSize: 4096,
  compressedSize: 1024,
  rawSha256: hex("a1"),
  compressedSha256: hex("b2"),
  assetIds: [] as string[],
  assetRefsHash: EMPTY_ASSET_REFS_SHA256,
  assetCount: 0,
  ...overrides,
});

const setup = async () => {
  const t = convexTest(schema, modules);
  const ownerId = await t.run(async (ctx) =>
    ctx.db.insert("users", { name: "Doc owner" }),
  );
  const intruderId = await t.run(async (ctx) =>
    ctx.db.insert("users", { name: "Other user" }),
  );
  const owner = t.withIdentity({ subject: `${ownerId}|owner-session` });
  const intruder = t.withIdentity({ subject: `${intruderId}|other-session` });
  const doc = await owner.mutation(api.docs.create, { folderId: null });
  return { t, owner, intruder, doc, ownerId };
};

type TestClient = Awaited<ReturnType<typeof setup>>["owner"];

const requestGrant = async (
  client: TestClient,
  docId: Id<"docs">,
  expectedVersion: number,
  overrides: Record<string, unknown> = {},
) =>
  await client.mutation(api.docContents.createUploadGrant, {
    docId,
    clientSaveProtocol: DOC_CONTENT_SAVE_PROTOCOL_VERSION,
    expectedVersion,
    ...contentObject(),
    ...overrides,
  } as never);

const commit = async (client: TestClient, token: string, etag: string) =>
  await client.mutation(api.docContents.commitUpload, {
    clientSaveProtocol: DOC_CONTENT_SAVE_PROTOCOL_VERSION,
    token,
    etag,
  });

const save = async (
  client: TestClient,
  docId: Id<"docs">,
  expectedVersion: number,
  label: string,
) => {
  const grant = await requestGrant(client, docId, expectedVersion, {
    rawSha256: hashForLabel(label, 1),
    compressedSha256: hashForLabel(label, 2),
  });
  if (grant.status !== "upload") {
    throw new Error(`Expected upload grant, received ${grant.status}`);
  }
  return {
    grant,
    committed: await commit(client, grant.token, `etag-${label}`),
  };
};

describe("Doc content persistence", () => {
  it("enforces protocol, ownership, integrity, and unchanged-content no-ops", async () => {
    const { t, owner, intruder, doc } = await setup();
    await expect(
      t.mutation(api.docContents.createUploadGrant, {
        docId: doc.docId,
        clientSaveProtocol: DOC_CONTENT_SAVE_PROTOCOL_VERSION - 1,
        expectedVersion: 0,
        ...contentObject(),
      }),
    ).resolves.toEqual({ status: "upgrade-required" });
    await expect(requestGrant(intruder, doc.docId, 0)).rejects.toThrow(
      "Doc not found",
    );
    await expect(
      requestGrant(owner, doc.docId, 0, { rawSha256: "invalid" }),
    ).rejects.toThrow("checksum");

    const first = await requestGrant(owner, doc.docId, 0);
    expect(first).toMatchObject({ status: "upload", version: 1 });
    if (first.status !== "upload") {
      throw new Error("Expected upload grant");
    }
    expect(first.token).toMatch(DOC_CONTENT_TOKEN_PATTERN);
    const storedGrant = await t.run(async (ctx) =>
      ctx.db
        .query("docContentUploadGrants")
        .withIndex("by_token", (q) => q.eq("token", first.token))
        .unique(),
    );
    expect(storedGrant?.objectKey).toContain(
      `${DOC_CONTENT_KEY_PREFIX}${doc.docId}/`,
    );
    await commit(owner, first.token, "etag-v1");

    await expect(requestGrant(owner, doc.docId, 1)).resolves.toMatchObject({
      status: "unchanged",
      version: 1,
    });
  });

  it("commits atomically and preserves the winner when a stale upload loses", async () => {
    const { t, owner, doc } = await setup();
    await save(owner, doc.docId, 0, "v1");
    const stale = await requestGrant(owner, doc.docId, 1, {
      rawSha256: hashForLabel("stale", 1),
      compressedSha256: hashForLabel("stale", 2),
    });
    if (stale.status !== "upload") {
      throw new Error("Expected stale upload grant");
    }
    await save(owner, doc.docId, 1, "winner");

    await expect(
      commit(owner, stale.token, "etag-stale"),
    ).resolves.toMatchObject({
      status: "conflict",
      version: 2,
      cleanupToken: expect.any(String),
    });
    const manifest = await t.run(async (ctx) =>
      ctx.db
        .query("docContents")
        .withIndex("by_docId", (q) => q.eq("docId", doc.docId))
        .unique(),
    );
    expect(manifest).toMatchObject({
      version: 2,
      rawSha256: hashForLabel("winner", 1),
      etag: "etag-winner",
    });
  });

  it("uses the Board snapshot cadence and issues owner-only read grants", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T12:00:00Z"));
    try {
      const { t, owner, intruder, doc } = await setup();
      await save(owner, doc.docId, 0, "v1");
      const second = await save(owner, doc.docId, 1, "v2");
      expect(second.committed).toMatchObject({
        status: "committed",
        snapshotCreated: true,
      });
      vi.setSystemTime(Date.now() + SNAPSHOT_INTERVAL_MS - 1);
      const third = await save(owner, doc.docId, 2, "v3");
      expect(third.committed).toMatchObject({
        status: "committed",
        snapshotCreated: false,
        cleanupToken: expect.any(String),
      });
      vi.setSystemTime(Date.now() + 2);
      const fourth = await save(owner, doc.docId, 3, "v4");
      expect(fourth.committed).toMatchObject({
        status: "committed",
        snapshotCreated: true,
      });
      const snapshots = await t.run(async (ctx) =>
        ctx.db
          .query("docContentSnapshots")
          .withIndex("by_docId_and_createdAt", (q) => q.eq("docId", doc.docId))
          .take(10),
      );
      expect(snapshots.map((snapshot) => snapshot.version)).toEqual([1, 3]);

      await expect(
        intruder.mutation(api.docContents.createReadGrant, {
          docId: doc.docId,
        }),
      ).rejects.toThrow("Doc not found");
      const read = await owner.mutation(api.docContents.createReadGrant, {
        docId: doc.docId,
      });
      expect(read).toMatchObject({
        path: expect.stringContaining("/api/doc-content/"),
        version: 4,
      });
      await expect(
        t.mutation(internal.docContents.resolveReadGrant, {
          token: read.token,
        }),
      ).resolves.toMatchObject({ docId: doc.docId, version: 4 });
    } finally {
      vi.useRealTimers();
    }
  });
});
