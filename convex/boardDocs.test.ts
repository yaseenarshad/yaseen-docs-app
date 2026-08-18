// @vitest-environment edge-runtime
/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { api, internal } from "./_generated/api";
import schema from "./schema";

import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");
const SHA256 = "a".repeat(64);

const setup = async () => {
  const t = convexTest(schema, modules);
  const ownerId = await t.run(async (ctx) =>
    ctx.db.insert("users", { name: "Board owner" }),
  );
  const intruderId = await t.run(async (ctx) =>
    ctx.db.insert("users", { name: "Other owner" }),
  );
  const owner = t.withIdentity({ subject: `${ownerId}|owner-session` });
  const intruder = t.withIdentity({
    subject: `${intruderId}|other-session`,
  });
  const board = await owner.mutation(api.boards.create, { title: "Docs" });
  return { t, owner, intruder, ownerId, intruderId, board };
};

const seedDoc = async (
  t: Awaited<ReturnType<typeof setup>>["t"],
  args: {
    ownerId: Id<"users">;
    boardId: Id<"diagrams">;
    suffix: string;
    placements?: number;
    lifecycle?: "active" | "trashed" | "purged";
    withContent?: boolean;
  },
) =>
  await t.run(async (ctx) => {
    const now = Date.now();
    const docId = await ctx.db.insert("docs", {
      ownerId: args.ownerId,
      folderScope: "unfiled",
      title: `Doc ${args.suffix}`,
      normalizedTitle: `doc ${args.suffix}`,
      lifecycle: args.lifecycle ?? "active",
      ...(args.lifecycle && args.lifecycle !== "active"
        ? { deletedAt: now, purgeAfter: now + 1_000 }
        : null),
      createdAt: now,
      updatedAt: now,
    });
    for (let index = 0; index < (args.placements ?? 1); index++) {
      await ctx.db.insert("docPlacements", {
        diagramId: args.boardId,
        docId,
        elementId: `${args.suffix}-${index}`,
        createdAt: now,
        updatedAt: now,
      });
    }
    if (args.withContent !== false) {
      await ctx.db.insert("docContents", {
        docId,
        version: 3,
        objectKey: `doc-content/${docId}/current.bin`,
        encoding: "deflate-v1",
        rawSize: 123,
        compressedSize: 99,
        rawSha256: SHA256,
        compressedSha256: SHA256,
        etag: `etag-${args.suffix}`,
        assetRefsHash: SHA256,
        assetCount: 0,
        createdAt: now,
        updatedAt: now,
      });
    }
    return docId;
  });

describe("Board Doc manifest", () => {
  it("deduplicates 100 placements into one metadata page and creates no grants", async () => {
    const { t, owner, ownerId, board } = await setup();
    const docIds = [];
    for (let index = 0; index < 25; index++) {
      docIds.push(
        await seedDoc(t, {
          ownerId,
          boardId: board.boardId,
          suffix: `${index}`.padStart(2, "0"),
          placements: 4,
        }),
      );
    }

    const page = await owner.query(api.boardDocs.listManifestPage, {
      boardId: board.boardId,
      shareToken: null,
      cursor: null,
    });

    expect(page.page).toHaveLength(25);
    expect(new Set(page.page.map((doc) => doc.docId))).toEqual(new Set(docIds));
    expect(page).toMatchObject({ isDone: true, nextCursor: null });
    expect(page.page[0]).toEqual({
      docId: expect.any(String),
      title: expect.stringMatching(/^Doc /),
      lifecycle: "active",
      version: 3,
      contentSize: 123,
      contentHash: SHA256,
    });
    expect(JSON.stringify(page)).not.toContain("objectKey");
    expect(JSON.stringify(page)).not.toContain("/api/doc-content/");
    await expect(
      t.run(async (ctx) => ctx.db.query("docContentReadGrants").collect()),
    ).resolves.toEqual([]);
  });

  it("paginates at 200 unique Docs on the indexed Doc order", async () => {
    const { t, owner, ownerId, board } = await setup();
    for (let index = 0; index < 201; index++) {
      await seedDoc(t, {
        ownerId,
        boardId: board.boardId,
        suffix: `${index}`.padStart(3, "0"),
        withContent: false,
      });
    }

    const first = await owner.query(api.boardDocs.listManifestPage, {
      boardId: board.boardId,
      shareToken: null,
      cursor: null,
    });
    const second = await owner.query(api.boardDocs.listManifestPage, {
      boardId: board.boardId,
      shareToken: null,
      cursor: first.nextCursor,
    });

    expect(first.page).toHaveLength(200);
    expect(first.isDone).toBe(false);
    expect(second.page).toHaveLength(1);
    expect(second.isDone).toBe(true);
    expect(second.page[0]).toMatchObject({ version: 0, contentSize: 0 });
  });

  it("authorizes owner or live share context and exposes deletion state", async () => {
    const { t, owner, intruder, ownerId, board } = await setup();
    await seedDoc(t, {
      ownerId,
      boardId: board.boardId,
      suffix: "deleted",
      lifecycle: "trashed",
    });
    const { shareToken } = await owner.mutation(api.boards.setSharing, {
      boardId: board.boardId,
      enabled: true,
    });

    await expect(
      t.query(api.boardDocs.listManifestPage, {
        boardId: null,
        shareToken,
        cursor: null,
      }),
    ).resolves.toMatchObject({ page: [{ lifecycle: "trashed" }] });
    await expect(
      intruder.query(api.boardDocs.listManifestPage, {
        boardId: board.boardId,
        shareToken: null,
        cursor: null,
      }),
    ).rejects.toThrow("Board not found");
    await owner.mutation(api.boards.setSharing, {
      boardId: board.boardId,
      enabled: false,
    });
    await expect(
      t.query(api.boardDocs.listManifestPage, {
        boardId: null,
        shareToken,
        cursor: null,
      }),
    ).rejects.toThrow("Shared board not found");
  });
});

describe("batched Board Doc read grants", () => {
  it("deduplicates requests and returns typed partial failures", async () => {
    const { t, owner, ownerId, intruderId, board } = await setup();
    const active = await seedDoc(t, {
      ownerId,
      boardId: board.boardId,
      suffix: "active",
    });
    const deleted = await seedDoc(t, {
      ownerId,
      boardId: board.boardId,
      suffix: "deleted",
      lifecycle: "trashed",
    });
    const empty = await seedDoc(t, {
      ownerId,
      boardId: board.boardId,
      suffix: "empty",
      withContent: false,
    });
    const unplaced = await seedDoc(t, {
      ownerId,
      boardId: board.boardId,
      suffix: "unplaced",
      placements: 0,
    });
    const foreign = await seedDoc(t, {
      ownerId: intruderId,
      boardId: board.boardId,
      suffix: "foreign",
    });

    const result = await owner.mutation(api.boardDocs.createReadGrants, {
      boardId: board.boardId,
      shareToken: null,
      docIds: [active, active, deleted, empty, unplaced, foreign],
    });

    expect(result.metrics).toEqual({ requested: 6, unique: 5, granted: 1 });
    expect(result.results).toMatchObject([
      { docId: active, status: "granted", grant: { version: 3 } },
      { docId: deleted, status: "denied", reason: "deleted" },
      { docId: empty, status: "denied", reason: "content-missing" },
      { docId: unplaced, status: "denied", reason: "not-placed" },
      { docId: foreign, status: "denied", reason: "not-found" },
    ]);
    expect(JSON.stringify(result)).not.toContain("objectKey");
  });

  it("caps batches at 25 unique Docs", async () => {
    const { t, owner, ownerId, board } = await setup();
    const docIds = [];
    for (let index = 0; index < 26; index++) {
      docIds.push(
        await seedDoc(t, {
          ownerId,
          boardId: board.boardId,
          suffix: `${index}`,
        }),
      );
    }

    await expect(
      owner.mutation(api.boardDocs.createReadGrants, {
        boardId: board.boardId,
        shareToken: null,
        docIds,
      }),
    ).rejects.toThrow("up to 25 unique Docs");
  });

  it("binds shared grants to the live placement and share token", async () => {
    const { t, owner, ownerId, board } = await setup();
    const docId = await seedDoc(t, {
      ownerId,
      boardId: board.boardId,
      suffix: "shared",
    });
    const { shareToken } = await owner.mutation(api.boards.setSharing, {
      boardId: board.boardId,
      enabled: true,
    });
    const result = await t.mutation(api.boardDocs.createReadGrants, {
      boardId: null,
      shareToken,
      docIds: [docId],
    });
    const [granted] = result.results;
    if (granted.status !== "granted") {
      throw new Error("Expected a read grant");
    }
    await expect(
      t.run(async (ctx) =>
        ctx.db
          .query("docContentReadGrants")
          .withIndex("by_token", (q) => q.eq("token", granted.grant.token))
          .unique(),
      ),
    ).resolves.toMatchObject({
      access: "shared",
      diagramId: board.boardId,
      shareToken,
    });
    await expect(
      t.mutation(internal.docContents.resolveReadGrant, {
        token: granted.grant.token,
      }),
    ).resolves.toMatchObject({ docId });

    await owner.mutation(api.boards.setSharing, {
      boardId: board.boardId,
      enabled: false,
    });
    await expect(
      t.mutation(internal.docContents.resolveReadGrant, {
        token: granted.grant.token,
      }),
    ).resolves.toBeNull();
    await expect(
      t.mutation(api.boardDocs.createReadGrants, {
        boardId: null,
        shareToken,
        docIds: [docId],
      }),
    ).rejects.toThrow("Shared board not found");
  });
});
