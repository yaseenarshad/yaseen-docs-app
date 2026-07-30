import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { mediaItemValidator } from "./mediaTypes";

const RECENT_LIMIT = 60;

const requireUserId = async (ctx: Parameters<typeof getAuthUserId>[0]) => {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Authentication required");
  }
  return userId;
};

const storedItemValidator = v.object({
  ...mediaItemValidator.fields,
  updatedAt: v.number(),
});

export const listFavorites = query({
  args: {},
  returns: v.array(storedItemValidator),
  handler: async (ctx) => {
    const ownerId = await requireUserId(ctx);
    const rows = await ctx.db
      .query("mediaFavorites")
      .withIndex("by_ownerId_and_updatedAt", (q) => q.eq("ownerId", ownerId))
      .order("desc")
      .take(500);
    return rows.map(
      ({ ownerId: _ownerId, _id, _creationTime: _time, ...row }) => row,
    );
  },
});

export const addFavorite = mutation({
  args: { item: mediaItemValidator },
  returns: v.boolean(),
  handler: async (ctx, { item }) => {
    const ownerId = await requireUserId(ctx);
    const existing = await ctx.db
      .query("mediaFavorites")
      .withIndex("by_ownerId_and_itemKey", (q) =>
        q.eq("ownerId", ownerId).eq("itemKey", item.itemKey),
      )
      .unique();
    if (existing) {
      return false;
    }
    await ctx.db.insert("mediaFavorites", {
      ownerId,
      ...item,
      updatedAt: Date.now(),
    });
    return true;
  },
});

export const removeFavorite = mutation({
  args: { itemKey: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { itemKey }) => {
    const ownerId = await requireUserId(ctx);
    const existing = await ctx.db
      .query("mediaFavorites")
      .withIndex("by_ownerId_and_itemKey", (q) =>
        q.eq("ownerId", ownerId).eq("itemKey", itemKey),
      )
      .unique();
    if (!existing) {
      return false;
    }
    await ctx.db.delete("mediaFavorites", existing._id);
    return true;
  },
});

export const listRecent = query({
  args: {},
  returns: v.array(storedItemValidator),
  handler: async (ctx) => {
    const ownerId = await requireUserId(ctx);
    const rows = await ctx.db
      .query("mediaRecent")
      .withIndex("by_ownerId_and_updatedAt", (q) => q.eq("ownerId", ownerId))
      .order("desc")
      .take(RECENT_LIMIT);
    return rows.map(
      ({ ownerId: _ownerId, _id, _creationTime: _time, ...row }) => row,
    );
  },
});

export const recordRecent = mutation({
  args: { item: mediaItemValidator },
  returns: v.null(),
  handler: async (ctx, { item }) => {
    const ownerId = await requireUserId(ctx);
    const existing = await ctx.db
      .query("mediaRecent")
      .withIndex("by_ownerId_and_itemKey", (q) =>
        q.eq("ownerId", ownerId).eq("itemKey", item.itemKey),
      )
      .unique();
    const row = { ...item, updatedAt: Date.now() };
    if (existing) {
      await ctx.db.patch("mediaRecent", existing._id, row);
    } else {
      await ctx.db.insert("mediaRecent", { ownerId, ...row });
    }

    const overflow = await ctx.db
      .query("mediaRecent")
      .withIndex("by_ownerId_and_updatedAt", (q) => q.eq("ownerId", ownerId))
      .order("desc")
      .take(RECENT_LIMIT + 25);
    await Promise.all(
      overflow
        .slice(RECENT_LIMIT)
        .map((entry) => ctx.db.delete("mediaRecent", entry._id)),
    );
    return null;
  },
});
