import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";

import { query } from "./_generated/server";

export const current = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      isAnonymous: v.boolean(),
      username: v.union(v.null(), v.string()),
    }),
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return null;
    }
    const user = await ctx.db.get("users", userId);
    if (!user) {
      return null;
    }
    return {
      isAnonymous: user.isAnonymous === true,
      username: user.name ?? null,
    };
  },
});
