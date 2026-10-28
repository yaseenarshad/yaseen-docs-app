import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { requireUserId } from "./boardPersistence";

const MAX_NAME_LENGTH = 120;
const MAX_FOLDERS_PER_OWNER = 200;

const folderValidator = v.object({
  _id: v.id("boardFolders"),
  name: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

const normalizeFolderName = (value: string) =>
  value.trim().toLocaleLowerCase("en-US");

const validateFolderName = (value: string) => {
  const name = value.trim();
  if (!name) {
    throw new Error("Folder name is required");
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new Error(
      `Folder names must be ${MAX_NAME_LENGTH} characters or fewer`,
    );
  }
  return { name, normalizedName: normalizeFolderName(name) };
};

export const listMine = query({
  args: {},
  returns: v.array(folderValidator),
  handler: async (ctx) => {
    const ownerId = await requireUserId(ctx);
    const folders = await ctx.db
      .query("boardFolders")
      .withIndex("by_ownerId_and_normalizedName", (q) =>
        q.eq("ownerId", ownerId),
      )
      .take(MAX_FOLDERS_PER_OWNER);
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
  returns: v.object({ folderId: v.id("boardFolders") }),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const { name, normalizedName } = validateFolderName(args.name);
    const duplicate = await ctx.db
      .query("boardFolders")
      .withIndex("by_ownerId_and_normalizedName", (q) =>
        q.eq("ownerId", ownerId).eq("normalizedName", normalizedName),
      )
      .unique();
    if (duplicate) {
      throw new Error("A folder with that name already exists");
    }
    const existing = await ctx.db
      .query("boardFolders")
      .withIndex("by_ownerId_and_normalizedName", (q) =>
        q.eq("ownerId", ownerId),
      )
      .take(MAX_FOLDERS_PER_OWNER);
    if (existing.length >= MAX_FOLDERS_PER_OWNER) {
      throw new Error(`You can create up to ${MAX_FOLDERS_PER_OWNER} folders`);
    }
    const now = Date.now();
    const folderId = await ctx.db.insert("boardFolders", {
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
  args: {
    folderId: v.id("boardFolders"),
    name: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const folder = await ctx.db.get("boardFolders", args.folderId);
    if (!folder || folder.ownerId !== ownerId) {
      throw new Error("Folder not found");
    }
    const { name, normalizedName } = validateFolderName(args.name);
    const duplicate = await ctx.db
      .query("boardFolders")
      .withIndex("by_ownerId_and_normalizedName", (q) =>
        q.eq("ownerId", ownerId).eq("normalizedName", normalizedName),
      )
      .unique();
    if (duplicate && duplicate._id !== folder._id) {
      throw new Error("A folder with that name already exists");
    }
    if (folder.name === name && folder.normalizedName === normalizedName) {
      return null;
    }
    await ctx.db.patch("boardFolders", folder._id, {
      name,
      normalizedName,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const remove = mutation({
  args: { folderId: v.id("boardFolders") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const folder = await ctx.db.get("boardFolders", args.folderId);
    if (!folder || folder.ownerId !== ownerId) {
      throw new Error("Folder not found");
    }
    const boards = ctx.db
      .query("diagrams")
      .withIndex("by_ownerId_and_folderId", (q) =>
        q.eq("ownerId", ownerId).eq("folderId", folder._id),
      );
    for await (const board of boards) {
      await ctx.db.patch("diagrams", board._id, {
        folderId: undefined,
      });
    }
    await ctx.db.delete("boardFolders", folder._id);
    return null;
  },
});
