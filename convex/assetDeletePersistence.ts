import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

const DELETE_GRANT_LIFETIME_MS = 10 * 60 * 1000;

const makeToken = () =>
  `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");

export const createAssetDeleteGrant = async (
  ctx: MutationCtx,
  ownerId: Id<"users">,
  objectKeys: string[],
) => {
  const uniqueObjectKeys = [...new Set(objectKeys)];
  if (uniqueObjectKeys.length === 0) {
    return null;
  }
  const token = makeToken();
  const now = Date.now();
  await ctx.db.insert("assetDeleteGrants", {
    token,
    ownerId,
    objectKeys: uniqueObjectKeys,
    createdAt: now,
    expiresAt: now + DELETE_GRANT_LIFETIME_MS,
  });
  return token;
};
