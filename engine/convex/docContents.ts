import { v } from "convex/values";

import {
  docAssetReferenceArgs,
  docContentCommitResultValidator,
  docContentDeleteGrantContractValidator,
  docContentIntegrityFields,
  docContentReadGrantContractValidator,
  docContentReadGrantResultValidator,
  docContentUploadGrantContractValidator,
  docContentUploadGrantResultValidator,
} from "./docContentModel";
import {
  abandonDocContentUpload,
  commitDocContentUpload,
  consumeDocContentDeleteGrant,
  createDocContentReadGrant,
  createDocContentUploadGrant,
  listPendingDocContentCleanup,
  resolveDocContentReadGrant,
  resolveDocContentUploadGrant,
} from "./docContentPersistence";
import { requireDocsReadable, requireDocsWritable } from "./docsMode";
import { internalMutation, mutation, query } from "./_generated/server";

export const createUploadGrant = mutation({
  args: {
    docId: v.id("docs"),
    clientSaveProtocol: v.optional(v.number()),
    expectedVersion: v.number(),
    ...docContentIntegrityFields,
    ...docAssetReferenceArgs,
  },
  returns: docContentUploadGrantResultValidator,
  handler: async (ctx, args) => {
    requireDocsWritable();
    return await createDocContentUploadGrant(ctx, args);
  },
});

export const commitUpload = mutation({
  args: {
    clientSaveProtocol: v.optional(v.number()),
    token: v.string(),
    etag: v.string(),
  },
  returns: docContentCommitResultValidator,
  handler: async (ctx, args) => {
    requireDocsWritable();
    return await commitDocContentUpload(ctx, args);
  },
});

export const abandonUpload = mutation({
  args: { token: v.string() },
  returns: v.object({ cleanupToken: v.union(v.string(), v.null()) }),
  handler: async (ctx, args) => {
    requireDocsWritable();
    return await abandonDocContentUpload(ctx, args.token);
  },
});

export const createReadGrant = mutation({
  args: {
    docId: v.id("docs"),
    snapshotId: v.optional(v.id("docContentSnapshots")),
  },
  returns: docContentReadGrantResultValidator,
  handler: async (ctx, args) => {
    requireDocsReadable();
    return await createDocContentReadGrant(ctx, args);
  },
});

export const pendingCleanup = query({
  args: { now: v.number() },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    requireDocsWritable();
    return await listPendingDocContentCleanup(ctx, args.now);
  },
});

export const resolveUploadGrant = internalMutation({
  args: { token: v.string() },
  returns: v.union(v.null(), docContentUploadGrantContractValidator),
  handler: async (ctx, args) => {
    requireDocsWritable();
    return await resolveDocContentUploadGrant(ctx, args.token);
  },
});

export const resolveReadGrant = internalMutation({
  args: { token: v.string() },
  returns: v.union(v.null(), docContentReadGrantContractValidator),
  handler: async (ctx, args) => {
    requireDocsReadable();
    return await resolveDocContentReadGrant(ctx, args.token);
  },
});

export const consumeDeleteGrant = internalMutation({
  args: { token: v.string() },
  returns: v.union(v.null(), docContentDeleteGrantContractValidator),
  handler: async (ctx, args) => {
    requireDocsWritable();
    return await consumeDocContentDeleteGrant(ctx, args.token);
  },
});
