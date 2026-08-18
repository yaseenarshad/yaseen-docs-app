import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import {
  docFolderSummaryValidator,
  MAX_DOC_FOLDERS_PER_OWNER,
  MAX_DOCS_PER_FOLDER_SCOPE,
  validateDocFolderName,
} from "./docLibraryModel";
import { DOC_UNFILED_SCOPE } from "./docModel";
import { requireUserId } from "./boardPersistence";
import { requireDocsReadable, requireDocsWritable } from "./docsMode";

export const listMine = query({
  args: {},
  returns: v.array(docFolderSummaryValidator),
  handler: async (ctx) => {
    requireDocsReadable();
    const ownerId = await requireUserId(ctx);
    const folders = await ctx.db
      .query("docFolders")
      .withIndex("by_ownerId_and_normalizedName", (q) =>
        q.eq("ownerId", ownerId),
      )
      .take(MAX_DOC_FOLDERS_PER_OWNER);
    return folders.map(({ _id, name, createdAt, updatedAt }) => ({
      _id,
      name,
      createdAt,
      updatedAt,
    }));
  },
});

export const create = mutation({
  args: { name: v.string() },
  returns: v.object({ folderId: v.id("docFolders") }),
  handler: async (ctx, args) => {
    requireDocsWritable();
    const ownerId = await requireUserId(ctx);
    const { name, normalizedName } = validateDocFolderName(args.name);
    const duplicate = await ctx.db
      .query("docFolders")
      .withIndex("by_ownerId_and_normalizedName", (q) =>
        q.eq("ownerId", ownerId).eq("normalizedName", normalizedName),
      )
      .unique();
    if (duplicate) {
      throw new Error("A folder with that name already exists");
    }
    const existing = await ctx.db
      .query("docFolders")
      .withIndex("by_ownerId_and_normalizedName", (q) =>
        q.eq("ownerId", ownerId),
      )
      .take(MAX_DOC_FOLDERS_PER_OWNER);
    if (existing.length >= MAX_DOC_FOLDERS_PER_OWNER) {
      throw new Error(
        `You can create up to ${MAX_DOC_FOLDERS_PER_OWNER} folders`,
      );
    }
    const now = Date.now();
    const folderId = await ctx.db.insert("docFolders", {
      ownerId,
      name,
      normalizedName,
      createdAt: now,
      updatedAt: now,
    });
    return { folderId };
  },
});

export const rename = mutation({
  args: { folderId: v.id("docFolders"), name: v.string() },
  returns: v.union(
    v.object({ status: v.literal("renamed"), name: v.string() }),
    v.object({ status: v.literal("unchanged") }),
  ),
  handler: async (ctx, args) => {
    requireDocsWritable();
    const ownerId = await requireUserId(ctx);
    const folder = await ctx.db.get("docFolders", args.folderId);
    if (!folder || folder.ownerId !== ownerId) {
      throw new Error("Folder not found");
    }
    const { name, normalizedName } = validateDocFolderName(args.name);
    if (folder.name === name && folder.normalizedName === normalizedName) {
      return { status: "unchanged" as const };
    }
    const duplicate = await ctx.db
      .query("docFolders")
      .withIndex("by_ownerId_and_normalizedName", (q) =>
        q.eq("ownerId", ownerId).eq("normalizedName", normalizedName),
      )
      .unique();
    if (duplicate && duplicate._id !== folder._id) {
      throw new Error("A folder with that name already exists");
    }
    await ctx.db.patch("docFolders", folder._id, {
      name,
      normalizedName,
      updatedAt: Date.now(),
    });
    return { status: "renamed" as const, name };
  },
});

export const remove = mutation({
  args: { folderId: v.id("docFolders") },
  returns: v.union(
    v.object({
      status: v.literal("removed"),
      movedDocCount: v.number(),
    }),
    v.object({
      status: v.literal("conflict"),
      conflicts: v.array(v.object({ docId: v.id("docs"), title: v.string() })),
    }),
  ),
  handler: async (ctx, args) => {
    requireDocsWritable();
    const ownerId = await requireUserId(ctx);
    const folder = await ctx.db.get("docFolders", args.folderId);
    if (!folder || folder.ownerId !== ownerId) {
      throw new Error("Folder not found");
    }
    const docs = await ctx.db
      .query("docs")
      .withIndex("by_ownerId_and_folderScope_and_updatedAt", (q) =>
        q.eq("ownerId", ownerId).eq("folderScope", folder._id),
      )
      .take(MAX_DOCS_PER_FOLDER_SCOPE + 1);
    if (docs.length > MAX_DOCS_PER_FOLDER_SCOPE) {
      throw new Error(
        `A Doc folder can contain up to ${MAX_DOCS_PER_FOLDER_SCOPE} Docs`,
      );
    }
    const unfiledDocs = await ctx.db
      .query("docs")
      .withIndex("by_ownerId_and_folderScope_and_updatedAt", (q) =>
        q.eq("ownerId", ownerId).eq("folderScope", DOC_UNFILED_SCOPE),
      )
      .take(MAX_DOCS_PER_FOLDER_SCOPE + 1);
    if (unfiledDocs.length > MAX_DOCS_PER_FOLDER_SCOPE) {
      throw new Error(
        `Unfiled can contain up to ${MAX_DOCS_PER_FOLDER_SCOPE} Docs`,
      );
    }
    const unfiledTitles = new Set(
      unfiledDocs.map((doc) => doc.normalizedTitle),
    );
    const conflicts = docs
      .filter((doc) => unfiledTitles.has(doc.normalizedTitle))
      .map((doc) => ({ docId: doc._id, title: doc.title }));
    if (conflicts.length > 0) {
      return { status: "conflict" as const, conflicts };
    }
    const now = Date.now();
    for (const doc of docs) {
      await ctx.db.patch("docs", doc._id, {
        folderId: undefined,
        folderScope: DOC_UNFILED_SCOPE,
        updatedAt: now,
      });
    }
    await ctx.db.delete("docFolders", folder._id);
    return { status: "removed" as const, movedDocCount: docs.length };
  },
});
