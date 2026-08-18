// @vitest-environment edge-runtime
/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const SHA256 = "a".repeat(64);

describe("Docs control-plane schema", () => {
  it("exposes one exact index path for rejecting duplicate titles in a scope", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.run(async (ctx) => {
        const ownerId = await ctx.db.insert("users", { name: "Doc owner" });
        for (const createdAt of [1, 2]) {
          await ctx.db.insert("docs", {
            ownerId,
            folderScope: "unfiled",
            title: createdAt === 1 ? "Plan" : " PLAN ",
            normalizedTitle: "plan",
            lifecycle: "active",
            createdAt,
            updatedAt: createdAt,
          });
        }

        return await ctx.db
          .query("docs")
          .withIndex("by_ownerId_and_folderScope_and_normalizedTitle", (q) =>
            q
              .eq("ownerId", ownerId)
              .eq("folderScope", "unfiled")
              .eq("normalizedTitle", "plan"),
          )
          .unique();
      }),
    ).rejects.toThrow("unique");
  });

  it("supports folder-scoped title uniqueness and multiple placements per Board", async () => {
    const t = convexTest(schema, modules);
    const result = await t.run(async (ctx) => {
      const ownerId = await ctx.db.insert("users", { name: "Doc owner" });
      const folderId = await ctx.db.insert("docFolders", {
        ownerId,
        name: "Projects",
        normalizedName: "projects",
        createdAt: 1,
        updatedAt: 1,
      });
      const boardId = await ctx.db.insert("diagrams", {
        ownerId,
        slug: "doc-schema-board",
        title: "Board",
        visibility: "private",
        shareEnabled: false,
        createdAt: 1,
        updatedAt: 1,
      });
      const folderDocId = await ctx.db.insert("docs", {
        ownerId,
        folderId,
        folderScope: folderId,
        title: "Plan",
        normalizedTitle: "plan",
        lifecycle: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      const unfiledDocId = await ctx.db.insert("docs", {
        ownerId,
        folderScope: "unfiled",
        title: "Plan",
        normalizedTitle: "plan",
        lifecycle: "active",
        createdAt: 2,
        updatedAt: 2,
      });
      const firstPlacementId = await ctx.db.insert("docPlacements", {
        diagramId: boardId,
        docId: folderDocId,
        elementId: "element-1",
        createdAt: 3,
        updatedAt: 3,
      });
      const secondPlacementId = await ctx.db.insert("docPlacements", {
        diagramId: boardId,
        docId: folderDocId,
        elementId: "element-2",
        createdAt: 4,
        updatedAt: 4,
      });

      const folderTitle = await ctx.db
        .query("docs")
        .withIndex("by_ownerId_and_folderScope_and_normalizedTitle", (q) =>
          q
            .eq("ownerId", ownerId)
            .eq("folderScope", folderId)
            .eq("normalizedTitle", "plan"),
        )
        .unique();
      const unfiledTitle = await ctx.db
        .query("docs")
        .withIndex("by_ownerId_and_folderScope_and_normalizedTitle", (q) =>
          q
            .eq("ownerId", ownerId)
            .eq("folderScope", "unfiled")
            .eq("normalizedTitle", "plan"),
        )
        .unique();
      const placements = await ctx.db
        .query("docPlacements")
        .withIndex("by_diagramId_and_docId", (q) =>
          q.eq("diagramId", boardId).eq("docId", folderDocId),
        )
        .take(10);
      const exactPlacement = await ctx.db
        .query("docPlacements")
        .withIndex("by_diagramId_and_elementId", (q) =>
          q.eq("diagramId", boardId).eq("elementId", "element-2"),
        )
        .unique();

      return {
        exactPlacement,
        firstPlacementId,
        folderDocId,
        folderTitle,
        placements,
        secondPlacementId,
        unfiledDocId,
        unfiledTitle,
      };
    });

    expect(result.folderTitle?._id).toBe(result.folderDocId);
    expect(result.unfiledTitle?._id).toBe(result.unfiledDocId);
    expect(result.placements.map((placement) => placement._id)).toEqual([
      result.firstPlacementId,
      result.secondPlacementId,
    ]);
    expect(result.exactPlacement?._id).toBe(result.secondPlacementId);
  });

  it("stores only R2 object metadata and keeps legacy Board manifests valid", async () => {
    const t = convexTest(schema, modules);
    const rows = await t.run(async (ctx) => {
      const ownerId = await ctx.db.insert("users", { name: "Doc owner" });
      const docId = await ctx.db.insert("docs", {
        ownerId,
        folderScope: "unfiled",
        title: "Metadata only",
        normalizedTitle: "metadata only",
        lifecycle: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      const boardId = await ctx.db.insert("diagrams", {
        ownerId,
        slug: "legacy-board-manifest",
        title: "Legacy",
        visibility: "private",
        shareEnabled: false,
        createdAt: 1,
        updatedAt: 1,
      });
      const contentId = await ctx.db.insert("docContents", {
        docId,
        version: 1,
        objectKey: `doc-content/${docId}/one.bin`,
        encoding: "deflate-v1",
        rawSize: 12,
        compressedSize: 10,
        rawSha256: SHA256,
        compressedSha256: SHA256,
        etag: "etag-one",
        assetRefsHash: SHA256,
        assetCount: 0,
        createdAt: 2,
        updatedAt: 2,
      });
      const snapshotId = await ctx.db.insert("docContentSnapshots", {
        docId,
        version: 1,
        objectKey: `doc-content/${docId}/one.bin`,
        encoding: "deflate-v1",
        rawSize: 12,
        compressedSize: 10,
        rawSha256: SHA256,
        compressedSha256: SHA256,
        etag: "etag-one",
        assetRefsHash: SHA256,
        assetCount: 0,
        createdAt: 3,
      });
      const manifestId = await ctx.db.insert("diagramSceneManifests", {
        diagramId: boardId,
        version: 1,
        objectKey: `board-scenes/${boardId}/one.bin`,
        encoding: "deflate-v1",
        rawSize: 12,
        compressedSize: 10,
        rawSha256: SHA256,
        compressedSha256: SHA256,
        semanticSha256: SHA256,
        etag: "etag-board",
        createdAt: 2,
        updatedAt: 2,
      });

      return {
        content: await ctx.db.get("docContents", contentId),
        manifest: await ctx.db.get("diagramSceneManifests", manifestId),
        snapshot: await ctx.db.get("docContentSnapshots", snapshotId),
      };
    });

    expect(rows.content).not.toHaveProperty("markdown");
    expect(rows.snapshot).not.toHaveProperty("markdown");
    expect(rows.manifest).not.toHaveProperty("docRefsHash");
    expect(rows.manifest).not.toHaveProperty("docRefsProtocolVersion");
  });
});
