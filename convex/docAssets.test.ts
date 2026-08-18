// @vitest-environment edge-runtime
/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import {
  DOC_CONTENT_ENCODING,
  DOC_CONTENT_SAVE_PROTOCOL_VERSION,
} from "../doc-content/types";

import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const sha = (value: string) => value.padEnd(64, "0");
const hashRefs = async (ids: string[]) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(ids.join("\n")),
      ),
    ),
  )
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

describe("private Doc assets", () => {
  it("uses single-use upload grants and atomically follows current/snapshot refs", async () => {
    const t = convexTest(schema, modules);
    const ownerId = await t.run((ctx) =>
      ctx.db.insert("users", { name: "Owner" }),
    );
    const intruderId = await t.run((ctx) =>
      ctx.db.insert("users", { name: "Other" }),
    );
    const owner = t.withIdentity({ subject: `${ownerId}|session` });
    const intruder = t.withIdentity({ subject: `${intruderId}|session` });
    const doc = await owner.mutation(api.docs.create, { folderId: null });
    const upload = await owner.mutation(api.docAssets.createUploadGrant, {
      docId: doc.docId,
      filename: "diagram.png",
      mimeType: "image/png",
      size: 4,
      sha256: sha("a"),
    });
    await expect(
      t.mutation(internal.docAssets.resolveUploadGrant, {
        token: upload.token,
      }),
    ).resolves.toMatchObject({ assetId: upload.assetId, size: 4 });
    await expect(
      t.mutation(internal.docAssets.resolveUploadGrant, {
        token: upload.token,
      }),
    ).resolves.toBeNull();
    await owner.mutation(api.docAssets.registerUpload, {
      token: upload.token,
      etag: "etag-asset",
    });
    await expect(
      intruder.mutation(api.docAssets.createReadGrant, {
        assetId: upload.assetId,
        boardId: null,
        shareToken: null,
      }),
    ).rejects.toThrow("Asset not found");

    const save = async (version: number, assetIds: string[], label: string) => {
      const grant = await owner.mutation(api.docContents.createUploadGrant, {
        docId: doc.docId,
        clientSaveProtocol: DOC_CONTENT_SAVE_PROTOCOL_VERSION,
        expectedVersion: version,
        encoding: DOC_CONTENT_ENCODING,
        rawSize: 10,
        compressedSize: 8,
        rawSha256: sha(label),
        compressedSha256: sha(`${label}c`),
        assetIds,
        assetRefsHash: await hashRefs(assetIds),
        assetCount: assetIds.length,
      });
      if (grant.status !== "upload") {
        throw new Error("Expected upload");
      }
      return await owner.mutation(api.docContents.commitUpload, {
        clientSaveProtocol: DOC_CONTENT_SAVE_PROTOCOL_VERSION,
        token: grant.token,
        etag: `etag-${label}`,
      });
    };
    await save(0, [upload.assetId], "b");
    const boardId = await t.run(async (ctx) => {
      const now = Date.now();
      const id = await ctx.db.insert("diagrams", {
        ownerId,
        slug: "asset-board",
        title: "Asset Board",
        visibility: "unlisted",
        shareEnabled: true,
        shareToken: "asset-share-token",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("docPlacements", {
        diagramId: id,
        docId: doc.docId,
        elementId: "asset-doc-card",
        createdAt: now,
        updatedAt: now,
      });
      return id;
    });
    await expect(
      owner.mutation(api.docAssets.createReadGrant, {
        assetId: upload.assetId,
        boardId,
        shareToken: null,
      }),
    ).resolves.toMatchObject({ filename: "diagram.png" });
    const sharedGrant = await t.mutation(api.docAssets.createReadGrant, {
      assetId: upload.assetId,
      boardId: null,
      shareToken: "asset-share-token",
    });
    await owner.mutation(api.docs.trash, { docId: doc.docId });
    await expect(
      t.mutation(internal.docAssets.resolveReadGrant, {
        token: sharedGrant.token,
      }),
    ).resolves.toBeNull();
    await owner.mutation(api.docs.restore, { docId: doc.docId });
    await save(1, [], "c");
    const asset = await t.run((ctx) =>
      ctx.db
        .query("docAssets")
        .withIndex("by_assetId", (q) => q.eq("assetId", upload.assetId))
        .unique(),
    );
    expect(asset).toMatchObject({ currentRefCount: 0, snapshotRefCount: 1 });
    await expect(
      owner.mutation(api.docAssets.createReadGrant, {
        assetId: upload.assetId,
        boardId: null,
        shareToken: null,
      }),
    ).resolves.toMatchObject({ filename: "diagram.png", size: 4 });
  });
});
