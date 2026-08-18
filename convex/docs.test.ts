// @vitest-environment edge-runtime
/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const docs = api.docs;
const docFolders = api.docFolders;
const SHA256 = "a".repeat(64);

const authenticatedTestClient = async (name = "Doc owner") => {
  const t = convexTest(schema, modules);
  const userId = await t.run(async (ctx) => ctx.db.insert("users", { name }));
  return {
    t,
    userId,
    owner: t.withIdentity({ subject: `${userId}|test-session` }),
  };
};

describe("Doc library", () => {
  it("numbers Untitled Docs independently in every folder scope", async () => {
    const { owner } = await authenticatedTestClient();
    const folder = await owner.mutation(docFolders.create, {
      name: " Projects ",
    });

    const first = await owner.mutation(docs.create, { folderId: null });
    const second = await owner.mutation(docs.create, { folderId: null });
    const folderFirst = await owner.mutation(docs.create, {
      folderId: folder.folderId,
    });

    expect(first.title).toBe("Untitled");
    expect(second.title).toBe("Untitled 2");
    expect(folderFirst.title).toBe("Untitled");
    await expect(owner.query(docFolders.listMine, {})).resolves.toMatchObject([
      { _id: folder.folderId, name: "Projects" },
    ]);
  });

  it("enforces scoped titles for rename and move without touching content", async () => {
    const { owner, t } = await authenticatedTestClient();
    const folder = await owner.mutation(docFolders.create, { name: "Work" });
    const unfiled = await owner.mutation(docs.create, { folderId: null });
    const inFolder = await owner.mutation(docs.create, {
      folderId: folder.folderId,
    });
    await owner.mutation(docs.rename, {
      docId: unfiled.docId,
      title: " Plan ",
    });
    await owner.mutation(docs.rename, {
      docId: inFolder.docId,
      title: "PLAN",
    });
    const contentId = await t.run(async (ctx) =>
      ctx.db.insert("docContents", {
        docId: unfiled.docId,
        version: 4,
        objectKey: `doc-content/${unfiled.docId}/four.bin`,
        encoding: "deflate-v1",
        rawSize: 12,
        compressedSize: 10,
        rawSha256: SHA256,
        compressedSha256: SHA256,
        etag: "etag-four",
        assetRefsHash: SHA256,
        assetCount: 0,
        createdAt: 1,
        updatedAt: 2,
      }),
    );
    const contentBefore = await t.run(async (ctx) =>
      ctx.db.get("docContents", contentId),
    );

    await expect(
      owner.mutation(docs.moveToFolder, {
        docId: unfiled.docId,
        folderId: folder.folderId,
      }),
    ).resolves.toMatchObject({ status: "conflict", title: "Plan" });
    await expect(
      owner.mutation(docs.rename, {
        docId: unfiled.docId,
        title: " Plan ",
      }),
    ).resolves.toEqual({ status: "unchanged" });

    const contentAfter = await t.run(async (ctx) =>
      ctx.db.get("docContents", contentId),
    );
    expect(contentAfter).toEqual(contentBefore);
  });

  it("deletes a folder atomically only when every Doc can move to Unfiled", async () => {
    const { owner, t } = await authenticatedTestClient();
    const folder = await owner.mutation(docFolders.create, { name: "Archive" });
    const unfiled = await owner.mutation(docs.create, { folderId: null });
    const inFolder = await owner.mutation(docs.create, {
      folderId: folder.folderId,
    });
    await owner.mutation(docs.rename, {
      docId: unfiled.docId,
      title: "Collision",
    });
    await owner.mutation(docs.rename, {
      docId: inFolder.docId,
      title: "collision",
    });

    await expect(
      owner.mutation(docFolders.remove, { folderId: folder.folderId }),
    ).resolves.toMatchObject({
      status: "conflict",
      conflicts: [{ docId: inFolder.docId, title: "collision" }],
    });
    await expect(
      t.run(async (ctx) => ctx.db.get("docFolders", folder.folderId)),
    ).resolves.not.toBeNull();

    await owner.mutation(docs.rename, {
      docId: inFolder.docId,
      title: "No collision",
    });
    await expect(
      owner.mutation(docFolders.remove, { folderId: folder.folderId }),
    ).resolves.toEqual({ status: "removed", movedDocCount: 1 });
    const movedDoc = await t.run(async (ctx) =>
      ctx.db.get("docs", inFolder.docId),
    );
    expect(movedDoc?.folderId).toBeUndefined();
    expect(movedDoc?.folderScope).toBe("unfiled");
  });

  it("keeps named placements through Trash, restore, and confirmed R2 purge", async () => {
    const { owner, t, userId } = await authenticatedTestClient();
    const otherId = await t.run((ctx) =>
      ctx.db.insert("users", { name: "Other" }),
    );
    const other = t.withIdentity({ subject: `${otherId}|session` });
    const created = await owner.mutation(docs.create, { folderId: null });
    const placementId = await t.run(async (ctx) => {
      const now = Date.now();
      const boardId = await ctx.db.insert("diagrams", {
        ownerId: userId,
        slug: "trash-board",
        title: "Trash Board",
        visibility: "unlisted",
        shareEnabled: true,
        shareToken: "trash-share",
        createdAt: now,
        updatedAt: now,
      });
      const placementId = await ctx.db.insert("docPlacements", {
        diagramId: boardId,
        docId: created.docId,
        elementId: "doc-card",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("docContents", {
        docId: created.docId,
        version: 3,
        objectKey: `doc-content/${created.docId}/current.bin`,
        encoding: "deflate-v1",
        rawSize: 12,
        compressedSize: 10,
        rawSha256: SHA256,
        compressedSha256: SHA256,
        etag: "etag",
        assetRefsHash: SHA256,
        assetCount: 0,
        createdAt: now,
        updatedAt: now,
      });
      return placementId;
    });
    await expect(
      other.mutation(api.docs.trash, { docId: created.docId }),
    ).rejects.toThrow("Doc not found");
    await owner.mutation(api.docs.trash, { docId: created.docId });
    const sharedTombstone = await t.query(api.boardDocs.listManifestPage, {
      boardId: null,
      shareToken: "trash-share",
      cursor: null,
    });
    expect(sharedTombstone.page).toEqual([
      expect.objectContaining({
        title: "Untitled",
        lifecycle: "trashed",
        version: 0,
        contentSize: 0,
      }),
    ]);
    expect(sharedTombstone.page[0]).not.toHaveProperty("contentHash");
    expect(
      await t.run((ctx) => ctx.db.get("docPlacements", placementId)),
    ).not.toBeNull();
    await owner.mutation(api.docs.restore, { docId: created.docId });
    await owner.mutation(api.docs.trash, { docId: created.docId });
    const purge = await owner.mutation(api.docs.deleteForever, {
      docId: created.docId,
    });
    await expect(
      t.mutation(internal.docContents.consumeDeleteGrant, {
        token: purge.cleanupToken,
      }),
    ).resolves.toMatchObject({
      objectKeyPrefix: `doc-content/${created.docId}/`,
    });
    expect(
      await owner.query(api.docs.getMine, { docId: created.docId }),
    ).toMatchObject({
      lifecycle: "trashed",
      title: "Untitled",
    });
    await owner.mutation(api.docs.confirmPurge, {
      docId: created.docId,
      cleanupToken: purge.cleanupToken,
    });
    expect(
      await owner.query(api.docs.getMine, { docId: created.docId }),
    ).toMatchObject({
      lifecycle: "purged",
      title: "Untitled",
    });
    expect(
      await t.run((ctx) => ctx.db.get("docPlacements", placementId)),
    ).not.toBeNull();
    expect(
      await t.run((ctx) =>
        ctx.db
          .query("docContents")
          .withIndex("by_docId", (q) => q.eq("docId", created.docId))
          .unique(),
      ),
    ).toBeNull();
  });

  it("paginates metadata-only results and rejects cross-owner mutations", async () => {
    const { owner, t } = await authenticatedTestClient();
    const alpha = await owner.mutation(docs.create, { folderId: null });
    await owner.mutation(docs.rename, {
      docId: alpha.docId,
      title: "Alpha plan",
    });
    const beta = await owner.mutation(docs.create, { folderId: null });
    await owner.mutation(docs.rename, {
      docId: beta.docId,
      title: "Beta plan",
    });

    const page = await owner.query(docs.listMinePaginated, {
      paginationOpts: { cursor: null, numItems: 10 },
      sort: "name-asc",
    });
    expect(page.page.map((doc: { title: string }) => doc.title)).toEqual([
      "Alpha plan",
      "Beta plan",
    ]);
    expect(page.page[0]).not.toHaveProperty("objectKey");
    expect(page.page[0]).not.toHaveProperty("markdown");

    const search = await owner.query(docs.listMinePaginated, {
      paginationOpts: { cursor: null, numItems: 10 },
      query: "alpha",
    });
    expect(search.page.map((doc: { title: string }) => doc.title)).toEqual([
      "Alpha plan",
    ]);

    const otherUserId = await t.run(async (ctx) =>
      ctx.db.insert("users", { name: "Other owner" }),
    );
    const otherOwner = t.withIdentity({
      subject: `${otherUserId}|other-session`,
    });
    await expect(
      otherOwner.mutation(docs.rename, {
        docId: alpha.docId,
        title: "Leaked",
      }),
    ).rejects.toThrow("Doc not found");
    await expect(
      otherOwner.query(docs.listMinePaginated, {
        paginationOpts: { cursor: null, numItems: 10 },
      }),
    ).resolves.toMatchObject({ page: [] });
  });
});
