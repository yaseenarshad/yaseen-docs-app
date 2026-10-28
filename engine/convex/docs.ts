import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";

import { internalMutation, mutation, query } from "./_generated/server";
import {
  docSortValidator,
  docSummaryValidator,
  MAX_DOCS_PER_FOLDER_SCOPE,
  validateDocTitle,
} from "./docLibraryModel";
import { docFolderScope } from "./docModel";
import { requireUserId } from "./boardPersistence";
import {
  getDocsMode,
  requireDocsReadable,
  requireDocsWritable,
} from "./docsMode";
import {
  purgeDocContentRecords,
  removeAllDocAssetReferences,
} from "./docContentPersistence";

import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import type { PaginationOptions } from "convex/server";
import type { Infer } from "convex/values";

type DocSort = Infer<typeof docSortValidator>;
const DOC_TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const toDocSummary = (doc: Doc<"docs">) => ({
  _id: doc._id,
  title: doc.title,
  ...(doc.folderId ? { folderId: doc.folderId } : {}),
  lifecycle: doc.lifecycle,
  ...(doc.deletedAt !== undefined ? { deletedAt: doc.deletedAt } : {}),
  ...(doc.purgedAt !== undefined ? { purgedAt: doc.purgedAt } : {}),
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt,
});

const requireOwnedFolder = async (
  ctx: Parameters<typeof requireUserId>[0],
  ownerId: Id<"users">,
  folderId: Id<"docFolders">,
) => {
  const folder = await ctx.db.get("docFolders", folderId);
  if (!folder || folder.ownerId !== ownerId) {
    throw new Error("Folder not found");
  }
  return folder;
};

const requireOwnedDoc = async (
  ctx: Parameters<typeof requireUserId>[0],
  ownerId: Id<"users">,
  docId: Id<"docs">,
) => {
  const doc = await ctx.db.get("docs", docId);
  if (!doc || doc.ownerId !== ownerId) {
    throw new Error("Doc not found");
  }
  return doc;
};

const findScopedTitle = async (
  ctx: Parameters<typeof requireUserId>[0],
  ownerId: Id<"users">,
  folderScope: string,
  normalizedTitle: string,
) =>
  await ctx.db
    .query("docs")
    .withIndex("by_ownerId_and_folderScope_and_normalizedTitle", (q) =>
      q
        .eq("ownerId", ownerId)
        .eq("folderScope", folderScope)
        .eq("normalizedTitle", normalizedTitle),
    )
    .unique();

const chooseUntitledTitle = async (
  ctx: Parameters<typeof requireUserId>[0],
  ownerId: Id<"users">,
  folderScope: string,
) => {
  const existing = await ctx.db
    .query("docs")
    .withIndex("by_ownerId_and_folderScope_and_normalizedTitle", (q) =>
      q.eq("ownerId", ownerId).eq("folderScope", folderScope),
    )
    .take(MAX_DOCS_PER_FOLDER_SCOPE + 1);
  if (existing.length > MAX_DOCS_PER_FOLDER_SCOPE) {
    throw new Error(
      `A Doc folder can contain up to ${MAX_DOCS_PER_FOLDER_SCOPE} Docs`,
    );
  }
  const titles = new Set(existing.map((doc) => doc.normalizedTitle));
  for (let suffix = 1; suffix <= MAX_DOCS_PER_FOLDER_SCOPE + 1; suffix++) {
    const title = suffix === 1 ? "Untitled" : `Untitled ${suffix}`;
    if (!titles.has(title.toLocaleLowerCase("en-US"))) {
      return { title, normalizedTitle: title.toLocaleLowerCase("en-US") };
    }
  }
  throw new Error("Could not choose an unused Doc title");
};

const getDocSummaryComparator =
  (sort: DocSort) =>
  (
    left: ReturnType<typeof toDocSummary>,
    right: ReturnType<typeof toDocSummary>,
  ) => {
    const direction = sort.endsWith("desc") ? -1 : 1;
    const value = sort.startsWith("name")
      ? left.title.localeCompare(right.title, "en-US", { sensitivity: "base" })
      : sort.startsWith("created")
      ? left.createdAt - right.createdAt
      : left.updatedAt - right.updatedAt;
    return value === 0
      ? left._id.localeCompare(right._id) * direction
      : value * direction;
  };

const paginateOwnedDocs = async (
  ctx: QueryCtx,
  paginationOpts: PaginationOptions,
  sort: DocSort,
  searchQuery: string,
) => {
  const ownerId = await requireUserId(ctx);
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase("en-US");
  if (normalizedQuery) {
    const result = await ctx.db
      .query("docs")
      .withSearchIndex("search_normalizedTitle", (q) =>
        q
          .search("normalizedTitle", normalizedQuery)
          .eq("ownerId", ownerId)
          .eq("lifecycle", "active"),
      )
      .paginate(paginationOpts);
    const page = result.page.map(toDocSummary);
    page.sort(getDocSummaryComparator(sort));
    return { ...result, page };
  }

  const result = sort.startsWith("name")
    ? await ctx.db
        .query("docs")
        .withIndex("by_ownerId_and_lifecycle_and_normalizedTitle", (q) =>
          q.eq("ownerId", ownerId).eq("lifecycle", "active"),
        )
        .order(sort.endsWith("asc") ? "asc" : "desc")
        .paginate(paginationOpts)
    : sort.startsWith("created")
    ? await ctx.db
        .query("docs")
        .withIndex("by_ownerId_and_lifecycle_and_createdAt", (q) =>
          q.eq("ownerId", ownerId).eq("lifecycle", "active"),
        )
        .order(sort.endsWith("asc") ? "asc" : "desc")
        .paginate(paginationOpts)
    : await ctx.db
        .query("docs")
        .withIndex("by_ownerId_and_lifecycle_and_updatedAt", (q) =>
          q.eq("ownerId", ownerId).eq("lifecycle", "active"),
        )
        .order(sort.endsWith("asc") ? "asc" : "desc")
        .paginate(paginationOpts);
  return { ...result, page: result.page.map(toDocSummary) };
};

export const create = mutation({
  args: { folderId: v.union(v.id("docFolders"), v.null()) },
  returns: v.object({ docId: v.id("docs"), title: v.string() }),
  handler: async (ctx, args) => {
    requireDocsWritable();
    const ownerId = await requireUserId(ctx);
    if (args.folderId) {
      await requireOwnedFolder(ctx, ownerId, args.folderId);
    }
    const folderScope = docFolderScope(args.folderId ?? undefined);
    const { title, normalizedTitle } = await chooseUntitledTitle(
      ctx,
      ownerId,
      folderScope,
    );
    const now = Date.now();
    const docId = await ctx.db.insert("docs", {
      ownerId,
      ...(args.folderId ? { folderId: args.folderId } : {}),
      folderScope,
      title,
      normalizedTitle,
      lifecycle: "active",
      createdAt: now,
      updatedAt: now,
    });
    return { docId, title };
  },
});

export const listMinePaginated = query({
  args: {
    paginationOpts: paginationOptsValidator,
    sort: v.optional(docSortValidator),
    query: v.optional(v.string()),
  },
  returns: paginationResultValidator(docSummaryValidator),
  handler: async (ctx, args) => {
    requireDocsReadable();
    return await paginateOwnedDocs(
      ctx,
      args.paginationOpts,
      args.sort ?? "modified-desc",
      args.query ?? "",
    );
  },
});

export const rename = mutation({
  args: { docId: v.id("docs"), title: v.string() },
  returns: v.union(
    v.object({ status: v.literal("renamed"), title: v.string() }),
    v.object({ status: v.literal("unchanged") }),
    v.object({ status: v.literal("conflict"), title: v.string() }),
  ),
  handler: async (ctx, args) => {
    requireDocsWritable();
    const ownerId = await requireUserId(ctx);
    const doc = await requireOwnedDoc(ctx, ownerId, args.docId);
    if (doc.lifecycle !== "active") {
      throw new Error("Doc is not active");
    }
    const { title, normalizedTitle } = validateDocTitle(args.title);
    if (doc.title === title && doc.normalizedTitle === normalizedTitle) {
      return { status: "unchanged" as const };
    }
    const duplicate = await findScopedTitle(
      ctx,
      ownerId,
      doc.folderScope,
      normalizedTitle,
    );
    if (duplicate && duplicate._id !== doc._id) {
      return { status: "conflict" as const, title };
    }
    await ctx.db.patch("docs", doc._id, {
      title,
      normalizedTitle,
      updatedAt: Date.now(),
    });
    return { status: "renamed" as const, title };
  },
});

export const moveToFolder = mutation({
  args: {
    docId: v.id("docs"),
    folderId: v.union(v.id("docFolders"), v.null()),
  },
  returns: v.union(
    v.object({ status: v.literal("moved") }),
    v.object({ status: v.literal("unchanged") }),
    v.object({ status: v.literal("conflict"), title: v.string() }),
  ),
  handler: async (ctx, args) => {
    requireDocsWritable();
    const ownerId = await requireUserId(ctx);
    const doc = await requireOwnedDoc(ctx, ownerId, args.docId);
    if (doc.lifecycle !== "active") {
      throw new Error("Doc is not active");
    }
    if (args.folderId) {
      await requireOwnedFolder(ctx, ownerId, args.folderId);
    }
    const folderScope = docFolderScope(args.folderId ?? undefined);
    if (doc.folderScope === folderScope) {
      return { status: "unchanged" as const };
    }
    const duplicate = await findScopedTitle(
      ctx,
      ownerId,
      folderScope,
      doc.normalizedTitle,
    );
    if (duplicate && duplicate._id !== doc._id) {
      return { status: "conflict" as const, title: doc.title };
    }
    await ctx.db.patch("docs", doc._id, {
      folderId: args.folderId ?? undefined,
      folderScope,
      updatedAt: Date.now(),
    });
    return { status: "moved" as const };
  },
});

export const getMine = query({
  args: { docId: v.id("docs") },
  returns: v.union(v.null(), docSummaryValidator),
  handler: async (ctx, args) => {
    requireDocsReadable();
    const ownerId = await requireUserId(ctx);
    const doc = await ctx.db.get("docs", args.docId);
    return doc && doc.ownerId === ownerId ? toDocSummary(doc) : null;
  },
});

export const listTrashPaginated = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(docSummaryValidator),
  handler: async (ctx, args) => {
    requireDocsReadable();
    const ownerId = await requireUserId(ctx);
    const result = await ctx.db
      .query("docs")
      .withIndex("by_ownerId_and_lifecycle_and_updatedAt", (q) =>
        q.eq("ownerId", ownerId).eq("lifecycle", "trashed"),
      )
      .order("desc")
      .paginate(args.paginationOpts);
    return { ...result, page: result.page.map(toDocSummary) };
  },
});

export const trash = mutation({
  args: { docId: v.id("docs") },
  returns: v.object({
    status: v.union(v.literal("trashed"), v.literal("unchanged")),
  }),
  handler: async (ctx, args) => {
    requireDocsWritable();
    const ownerId = await requireUserId(ctx);
    const doc = await requireOwnedDoc(ctx, ownerId, args.docId);
    if (doc.lifecycle !== "active") {
      return { status: "unchanged" as const };
    }
    const now = Date.now();
    await ctx.db.patch("docs", doc._id, {
      lifecycle: "trashed",
      deletedAt: now,
      purgeAfter: now + DOC_TRASH_RETENTION_MS,
      updatedAt: now,
    });
    return { status: "trashed" as const };
  },
});

export const restore = mutation({
  args: { docId: v.id("docs") },
  returns: v.object({
    status: v.union(v.literal("restored"), v.literal("unchanged")),
  }),
  handler: async (ctx, args) => {
    requireDocsWritable();
    const ownerId = await requireUserId(ctx);
    const doc = await requireOwnedDoc(ctx, ownerId, args.docId);
    if (doc.lifecycle === "active") {
      return { status: "unchanged" as const };
    }
    if (
      doc.lifecycle !== "trashed" ||
      doc.purgeRequestedAt !== undefined ||
      (doc.purgeAfter ?? 0) <= Date.now()
    ) {
      throw new Error("This Doc can no longer be restored");
    }
    await ctx.db.patch("docs", doc._id, {
      lifecycle: "active",
      deletedAt: undefined,
      purgeAfter: undefined,
      purgeRequestedAt: undefined,
      purgeCleanupToken: undefined,
      updatedAt: Date.now(),
    });
    return { status: "restored" as const };
  },
});

const requestDocPurge = async (
  ctx: Parameters<typeof purgeDocContentRecords>[0],
  doc: Doc<"docs">,
) => {
  if (doc.lifecycle !== "trashed") {
    throw new Error("Doc is not in Trash");
  }
  if (doc.purgeCleanupToken) {
    const existing = await ctx.db
      .query("docContentDeleteGrants")
      .withIndex("by_token", (q) => q.eq("token", doc.purgeCleanupToken!))
      .unique();
    if (existing && existing.expiresAt >= Date.now()) {
      return doc.purgeCleanupToken;
    }
    if (existing) {
      await ctx.db.delete("docContentDeleteGrants", existing._id);
    }
  }
  const cleanupToken = await purgeDocContentRecords(ctx, doc);
  if (!cleanupToken) {
    throw new Error("Could not prepare Doc cleanup");
  }
  await ctx.db.patch("docs", doc._id, {
    purgeRequestedAt: Date.now(),
    purgeCleanupToken: cleanupToken,
    updatedAt: Date.now(),
  });
  return cleanupToken;
};

export const deleteForever = mutation({
  args: { docId: v.id("docs") },
  returns: v.object({ cleanupToken: v.string() }),
  handler: async (ctx, args) => {
    requireDocsWritable();
    const ownerId = await requireUserId(ctx);
    const doc = await requireOwnedDoc(ctx, ownerId, args.docId);
    return { cleanupToken: await requestDocPurge(ctx, doc) };
  },
});

export const pendingPurges = query({
  args: {},
  returns: v.array(v.object({ docId: v.id("docs"), cleanupToken: v.string() })),
  handler: async (ctx) => {
    requireDocsReadable();
    const ownerId = await requireUserId(ctx);
    const docs = await ctx.db
      .query("docs")
      .withIndex("by_ownerId_and_lifecycle_and_updatedAt", (q) =>
        q.eq("ownerId", ownerId).eq("lifecycle", "trashed"),
      )
      .take(100);
    return docs
      .filter((doc) => doc.purgeCleanupToken !== undefined)
      .map((doc) => ({
        docId: doc._id,
        cleanupToken: doc.purgeCleanupToken!,
      }));
  },
});

export const confirmPurge = mutation({
  args: { docId: v.id("docs"), cleanupToken: v.string() },
  returns: v.object({ status: v.literal("purged") }),
  handler: async (ctx, args) => {
    requireDocsWritable();
    const ownerId = await requireUserId(ctx);
    const doc = await requireOwnedDoc(ctx, ownerId, args.docId);
    if (doc.lifecycle === "purged") {
      return { status: "purged" as const };
    }
    if (
      doc.lifecycle !== "trashed" ||
      doc.purgeCleanupToken !== args.cleanupToken
    ) {
      throw new Error("Doc purge confirmation is invalid");
    }
    await removeAllDocAssetReferences(ctx, doc._id);
    const [manifest, snapshots, uploads, reads] = await Promise.all([
      ctx.db
        .query("docContents")
        .withIndex("by_docId", (q) => q.eq("docId", doc._id))
        .unique(),
      ctx.db
        .query("docContentSnapshots")
        .withIndex("by_docId_and_createdAt", (q) => q.eq("docId", doc._id))
        .collect(),
      ctx.db
        .query("docContentUploadGrants")
        .withIndex("by_docId", (q) => q.eq("docId", doc._id))
        .collect(),
      ctx.db
        .query("docContentReadGrants")
        .withIndex("by_docId", (q) => q.eq("docId", doc._id))
        .collect(),
    ]);
    if (manifest) {
      await ctx.db.delete("docContents", manifest._id);
    }
    const cleanupGrant = await ctx.db
      .query("docContentDeleteGrants")
      .withIndex("by_token", (q) => q.eq("token", args.cleanupToken))
      .unique();
    if (cleanupGrant) {
      await ctx.db.delete("docContentDeleteGrants", cleanupGrant._id);
    }
    for (const row of [...snapshots, ...uploads, ...reads]) {
      await ctx.db.delete(row._id);
    }
    await ctx.db.patch("docs", doc._id, {
      lifecycle: "purged",
      purgedAt: Date.now(),
      purgeCleanupToken: undefined,
      updatedAt: Date.now(),
    });
    return { status: "purged" as const };
  },
});

export const scheduleExpiredPurges = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    if (getDocsMode() !== "on") {
      return 0;
    }
    const docs = await ctx.db
      .query("docs")
      .withIndex("by_lifecycle_and_purgeAfter", (q) =>
        q.eq("lifecycle", "trashed").lt("purgeAfter", Date.now()),
      )
      .take(50);
    for (const doc of docs) {
      await requestDocPurge(ctx, doc);
    }
    return docs.length;
  },
});
