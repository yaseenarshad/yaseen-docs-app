import { DOC_CONTENT_SAVE_PROTOCOL_VERSION } from "../doc-content/types";

import {
  DOC_CONTENT_DELETE_GRANT_LIFETIME_MS,
  DOC_CONTENT_READ_GRANT_LIFETIME_MS,
  DOC_CONTENT_UPLOAD_GRANT_LIFETIME_MS,
  MAX_PENDING_DOC_CONTENT_CLEANUP_TOKENS,
  assertDocAssetReferences,
  assertDocContentEtag,
  assertDocContentIntegrity,
  docContentKeyPrefixForDoc,
  docContentReadPath,
  makeDocContentObjectKey,
  makeDocContentToken,
  toDocContentGrantContract,
} from "./docContentModel";
import { requireUserId } from "./boardPersistence";
import { shouldCreateDiagramSnapshot } from "./snapshotPolicy";

import type { DOC_CONTENT_ENCODING } from "../doc-content/types";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

const RECENT_UPLOAD_GRANTS = 10;

type DocContentIntegrity = {
  encoding: typeof DOC_CONTENT_ENCODING;
  rawSize: number;
  compressedSize: number;
  rawSha256: string;
  compressedSha256: string;
};

type DocAssetReferences = {
  assetIds: string[];
  assetRefsHash: string;
  assetCount: number;
};

export const readDocContentManifest = async (
  ctx: QueryCtx | MutationCtx,
  docId: Id<"docs">,
) =>
  await ctx.db
    .query("docContents")
    .withIndex("by_docId", (q) => q.eq("docId", docId))
    .unique();

const patchAssetReferenceCount = async (
  ctx: MutationCtx,
  assetId: string,
  source: "current" | "snapshot",
  delta: 1 | -1,
  now: number,
) => {
  const asset = await ctx.db
    .query("docAssets")
    .withIndex("by_assetId", (q) => q.eq("assetId", assetId))
    .unique();
  if (!asset || asset.status !== "ready") {
    throw new Error("Doc asset is unavailable");
  }
  const currentRefCount =
    asset.currentRefCount + (source === "current" ? delta : 0);
  const snapshotRefCount =
    asset.snapshotRefCount + (source === "snapshot" ? delta : 0);
  if (currentRefCount < 0 || snapshotRefCount < 0) {
    throw new Error("Doc asset reference count is invalid");
  }
  await ctx.db.patch("docAssets", asset._id, {
    currentRefCount,
    snapshotRefCount,
    ...(currentRefCount + snapshotRefCount === 0
      ? { unreferencedAt: now }
      : { unreferencedAt: undefined }),
    updatedAt: now,
  });
};

const reconcileAssetReferences = async (
  ctx: MutationCtx,
  args: {
    docId: Id<"docs">;
    source: "current" | "snapshot";
    sourceVersion: number;
    assetIds: string[];
    now: number;
  },
) => {
  const existing = await ctx.db
    .query("docAssetReferences")
    .withIndex("by_docId_and_source", (q) =>
      q.eq("docId", args.docId).eq("source", args.source),
    )
    .collect();
  const matching = existing.filter(
    (reference) => reference.sourceVersion === args.sourceVersion,
  );
  const desired = new Set(args.assetIds);
  for (const reference of matching) {
    if (!desired.delete(reference.assetId)) {
      await ctx.db.delete("docAssetReferences", reference._id);
      await patchAssetReferenceCount(
        ctx,
        reference.assetId,
        args.source,
        -1,
        args.now,
      );
    }
  }
  for (const assetId of desired) {
    await ctx.db.insert("docAssetReferences", {
      docId: args.docId,
      assetId,
      source: args.source,
      sourceVersion: args.sourceVersion,
      createdAt: args.now,
    });
    await patchAssetReferenceCount(ctx, assetId, args.source, 1, args.now);
  }
};

const replaceCurrentAssetReferences = async (
  ctx: MutationCtx,
  args: {
    docId: Id<"docs">;
    version: number;
    assetIds: string[];
    now: number;
  },
) => {
  const existing = await ctx.db
    .query("docAssetReferences")
    .withIndex("by_docId_and_source", (q) =>
      q.eq("docId", args.docId).eq("source", "current"),
    )
    .collect();
  for (const reference of existing) {
    await ctx.db.delete("docAssetReferences", reference._id);
    await patchAssetReferenceCount(
      ctx,
      reference.assetId,
      "current",
      -1,
      args.now,
    );
  }
  await reconcileAssetReferences(ctx, {
    docId: args.docId,
    source: "current",
    sourceVersion: args.version,
    assetIds: args.assetIds,
    now: args.now,
  });
};

export const removeSnapshotAssetReferences = async (
  ctx: MutationCtx,
  args: { docId: Id<"docs">; version: number; now: number },
) => {
  const references = await ctx.db
    .query("docAssetReferences")
    .withIndex("by_docId_and_source", (q) =>
      q.eq("docId", args.docId).eq("source", "snapshot"),
    )
    .collect();
  for (const reference of references) {
    if (reference.sourceVersion !== args.version) {
      continue;
    }
    await ctx.db.delete("docAssetReferences", reference._id);
    await patchAssetReferenceCount(
      ctx,
      reference.assetId,
      "snapshot",
      -1,
      args.now,
    );
  }
};

export const removeAllDocAssetReferences = async (
  ctx: MutationCtx,
  docId: Id<"docs">,
  now = Date.now(),
) => {
  const references = await ctx.db
    .query("docAssetReferences")
    .withIndex("by_docId_and_source", (q) => q.eq("docId", docId))
    .collect();
  for (const reference of references) {
    await ctx.db.delete("docAssetReferences", reference._id);
    await patchAssetReferenceCount(
      ctx,
      reference.assetId,
      reference.source,
      -1,
      now,
    );
  }
};

const assertOwnedReadyAssets = async (
  ctx: MutationCtx,
  ownerId: Id<"users">,
  assetIds: string[],
) => {
  for (const assetId of assetIds) {
    const asset = await ctx.db
      .query("docAssets")
      .withIndex("by_assetId", (q) => q.eq("assetId", assetId))
      .unique();
    if (!asset || asset.ownerId !== ownerId || asset.status !== "ready") {
      throw new Error("Doc asset is unavailable");
    }
  }
};

export const createDocContentDeleteGrant = async (
  ctx: MutationCtx,
  args: {
    ownerId: Id<"users">;
    docId?: Id<"docs">;
    objectKeys: string[];
    objectKeyPrefix?: string;
    retainUntilConfirmed?: boolean;
  },
) => {
  const objectKeys = [...new Set(args.objectKeys)];
  if (objectKeys.length === 0 && args.objectKeyPrefix === undefined) {
    return null;
  }
  const token = makeDocContentToken();
  const now = Date.now();
  await ctx.db.insert("docContentDeleteGrants", {
    token,
    ownerId: args.ownerId,
    ...(args.docId ? { docId: args.docId } : {}),
    objectKeys,
    ...(args.objectKeyPrefix ? { objectKeyPrefix: args.objectKeyPrefix } : {}),
    ...(args.retainUntilConfirmed ? { retainUntilConfirmed: true } : {}),
    createdAt: now,
    expiresAt: now + DOC_CONTENT_DELETE_GRANT_LIFETIME_MS,
  });
  return token;
};

const findReusableUploadGrant = async (
  ctx: MutationCtx,
  args: DocContentIntegrity &
    DocAssetReferences & {
      docId: Id<"docs">;
      expectedVersion: number;
      now: number;
    },
) => {
  const recent = await ctx.db
    .query("docContentUploadGrants")
    .withIndex("by_docId", (q) => q.eq("docId", args.docId))
    .order("desc")
    .take(RECENT_UPLOAD_GRANTS);
  return (
    recent.find(
      (grant) =>
        grant.expectedVersion === args.expectedVersion &&
        grant.expiresAt >= args.now &&
        grant.resolvedAt === undefined &&
        grant.registeredAt === undefined &&
        grant.encoding === args.encoding &&
        grant.rawSize === args.rawSize &&
        grant.compressedSize === args.compressedSize &&
        grant.rawSha256 === args.rawSha256 &&
        grant.compressedSha256 === args.compressedSha256 &&
        grant.assetRefsHash === args.assetRefsHash &&
        grant.assetCount === args.assetCount &&
        grant.assetIds.join("\n") === args.assetIds.join("\n"),
    ) ?? null
  );
};

export const createDocContentUploadGrant = async (
  ctx: MutationCtx,
  args: DocContentIntegrity &
    DocAssetReferences & {
      docId: Id<"docs">;
      clientSaveProtocol?: number;
      expectedVersion: number;
    },
) => {
  if (args.clientSaveProtocol !== DOC_CONTENT_SAVE_PROTOCOL_VERSION) {
    return { status: "upgrade-required" as const };
  }
  const ownerId = await requireUserId(ctx);
  const doc = await ctx.db.get("docs", args.docId);
  if (!doc || doc.ownerId !== ownerId || doc.lifecycle !== "active") {
    throw new Error("Doc not found");
  }
  assertDocContentIntegrity(args);
  await assertDocAssetReferences(args);
  await assertOwnedReadyAssets(ctx, ownerId, args.assetIds);
  const manifest = await readDocContentManifest(ctx, doc._id);
  const currentVersion = manifest?.version ?? 0;
  if (currentVersion !== args.expectedVersion) {
    return { status: "conflict" as const, version: currentVersion };
  }
  if (
    manifest &&
    manifest.rawSha256 === args.rawSha256 &&
    manifest.assetRefsHash === args.assetRefsHash
  ) {
    return {
      status: "unchanged" as const,
      version: manifest.version,
      updatedAt: manifest.updatedAt,
    };
  }

  const now = Date.now();
  const reusable = await findReusableUploadGrant(ctx, { ...args, now });
  if (reusable) {
    return {
      status: "upload" as const,
      token: reusable.token,
      version: reusable.version,
      expiresAt: reusable.expiresAt,
    };
  }
  const token = makeDocContentToken();
  const expiresAt = now + DOC_CONTENT_UPLOAD_GRANT_LIFETIME_MS;
  const version = currentVersion + 1;
  await ctx.db.insert("docContentUploadGrants", {
    token,
    docId: doc._id,
    ownerId,
    expectedVersion: args.expectedVersion,
    version,
    objectKey: makeDocContentObjectKey(doc._id),
    encoding: args.encoding,
    rawSize: args.rawSize,
    compressedSize: args.compressedSize,
    rawSha256: args.rawSha256,
    compressedSha256: args.compressedSha256,
    assetIds: args.assetIds,
    assetRefsHash: args.assetRefsHash,
    assetCount: args.assetCount,
    createdAt: now,
    expiresAt,
  });
  return { status: "upload" as const, token, version, expiresAt };
};

const createSnapshotIfNeeded = async (
  ctx: MutationCtx,
  args: {
    doc: Doc<"docs">;
    manifest: Doc<"docContents">;
    now: number;
  },
) => {
  if (args.doc.lastSnapshotVersion === args.manifest.version) {
    return false;
  }
  if (
    !shouldCreateDiagramSnapshot({
      currentVersion: args.manifest.version,
      force: false,
      lastSnapshotAt: args.doc.lastSnapshotAt ?? null,
      now: args.now,
    })
  ) {
    return false;
  }
  await ctx.db.insert("docContentSnapshots", {
    docId: args.doc._id,
    version: args.manifest.version,
    objectKey: args.manifest.objectKey,
    encoding: args.manifest.encoding,
    rawSize: args.manifest.rawSize,
    compressedSize: args.manifest.compressedSize,
    rawSha256: args.manifest.rawSha256,
    compressedSha256: args.manifest.compressedSha256,
    etag: args.manifest.etag,
    assetIds: args.manifest.assetIds ?? [],
    assetRefsHash: args.manifest.assetRefsHash,
    assetCount: args.manifest.assetCount,
    createdAt: args.now,
  });
  await reconcileAssetReferences(ctx, {
    docId: args.doc._id,
    source: "snapshot",
    sourceVersion: args.manifest.version,
    assetIds: args.manifest.assetIds ?? [],
    now: args.now,
  });
  await ctx.db.patch("docs", args.doc._id, {
    lastSnapshotAt: args.now,
    lastSnapshotVersion: args.manifest.version,
  });
  return true;
};

export const commitDocContentUpload = async (
  ctx: MutationCtx,
  args: { clientSaveProtocol?: number; token: string; etag: string },
) => {
  if (args.clientSaveProtocol !== DOC_CONTENT_SAVE_PROTOCOL_VERSION) {
    return { status: "upgrade-required" as const };
  }
  const ownerId = await requireUserId(ctx);
  assertDocContentEtag(args.etag);
  const grant = await ctx.db
    .query("docContentUploadGrants")
    .withIndex("by_token", (q) => q.eq("token", args.token))
    .unique();
  const now = Date.now();
  if (
    !grant ||
    grant.ownerId !== ownerId ||
    grant.registeredAt !== undefined ||
    grant.expiresAt < now
  ) {
    throw new Error("Doc content upload grant expired");
  }
  const doc = await ctx.db.get("docs", grant.docId);
  const manifest = await readDocContentManifest(ctx, grant.docId);
  const currentVersion = manifest?.version ?? 0;
  if (
    !doc ||
    doc.ownerId !== ownerId ||
    doc.lifecycle !== "active" ||
    currentVersion !== grant.expectedVersion
  ) {
    await ctx.db.delete("docContentUploadGrants", grant._id);
    return {
      status: "conflict" as const,
      version: currentVersion,
      cleanupToken: await createDocContentDeleteGrant(ctx, {
        ownerId,
        docId: grant.docId,
        objectKeys: [grant.objectKey],
      }),
    };
  }

  let snapshotCreated = false;
  let cleanupToken: string | null = null;
  if (manifest) {
    snapshotCreated = await createSnapshotIfNeeded(ctx, { doc, manifest, now });
    cleanupToken = snapshotCreated
      ? null
      : await createDocContentDeleteGrant(ctx, {
          ownerId,
          docId: doc._id,
          objectKeys: [manifest.objectKey],
        });
    await ctx.db.patch("docContents", manifest._id, {
      version: grant.version,
      objectKey: grant.objectKey,
      encoding: grant.encoding,
      rawSize: grant.rawSize,
      compressedSize: grant.compressedSize,
      rawSha256: grant.rawSha256,
      compressedSha256: grant.compressedSha256,
      etag: args.etag,
      assetIds: grant.assetIds,
      assetRefsHash: grant.assetRefsHash,
      assetCount: grant.assetCount,
      updatedAt: now,
    });
  } else {
    await ctx.db.insert("docContents", {
      docId: doc._id,
      version: grant.version,
      objectKey: grant.objectKey,
      encoding: grant.encoding,
      rawSize: grant.rawSize,
      compressedSize: grant.compressedSize,
      rawSha256: grant.rawSha256,
      compressedSha256: grant.compressedSha256,
      etag: args.etag,
      assetIds: grant.assetIds,
      assetRefsHash: grant.assetRefsHash,
      assetCount: grant.assetCount,
      createdAt: now,
      updatedAt: now,
    });
  }
  await replaceCurrentAssetReferences(ctx, {
    docId: doc._id,
    version: grant.version,
    assetIds: grant.assetIds,
    now,
  });
  await ctx.db.patch("docs", doc._id, { updatedAt: now });
  await ctx.db.patch("docContentUploadGrants", grant._id, {
    registeredAt: now,
    etag: args.etag,
  });
  return {
    status: "committed" as const,
    version: grant.version,
    updatedAt: now,
    snapshotCreated,
    cleanupToken,
  };
};

export const abandonDocContentUpload = async (
  ctx: MutationCtx,
  token: string,
) => {
  const ownerId = await requireUserId(ctx);
  const grant = await ctx.db
    .query("docContentUploadGrants")
    .withIndex("by_token", (q) => q.eq("token", token))
    .unique();
  if (!grant || grant.ownerId !== ownerId || grant.registeredAt !== undefined) {
    throw new Error("Doc content upload grant not found");
  }
  const cleanupToken = await createDocContentDeleteGrant(ctx, {
    ownerId,
    docId: grant.docId,
    objectKeys: [grant.objectKey],
  });
  await ctx.db.delete("docContentUploadGrants", grant._id);
  return { cleanupToken };
};

type ReadGrantObject = {
  source: "current" | "snapshot";
  snapshotId?: Id<"docContentSnapshots">;
  version: number;
  objectKey: string;
  encoding: typeof DOC_CONTENT_ENCODING;
  rawSize: number;
  compressedSize: number;
  rawSha256: string;
  compressedSha256: string;
  etag: string;
};

/**
 * Inserts one narrow capability from an object the caller already authorized.
 * Board batches use this seam so they do not repeat Doc/manifest reads in a
 * per-card helper, while standalone owner reads keep their existing contract.
 */
export const insertDocContentReadGrant = async (
  ctx: MutationCtx,
  args: {
    docId: Id<"docs">;
    object: ReadGrantObject;
    access: "owner" | "shared";
    diagramId?: Id<"diagrams">;
    shareToken?: string;
  },
) => {
  const token = makeDocContentToken();
  const now = Date.now();
  const expiresAt = now + DOC_CONTENT_READ_GRANT_LIFETIME_MS;
  await ctx.db.insert("docContentReadGrants", {
    token,
    docId: args.docId,
    source: args.object.source,
    ...(args.object.snapshotId ? { snapshotId: args.object.snapshotId } : {}),
    version: args.object.version,
    objectKey: args.object.objectKey,
    encoding: args.object.encoding,
    rawSize: args.object.rawSize,
    compressedSize: args.object.compressedSize,
    rawSha256: args.object.rawSha256,
    compressedSha256: args.object.compressedSha256,
    etag: args.object.etag,
    access: args.access,
    ...(args.diagramId ? { diagramId: args.diagramId } : {}),
    ...(args.shareToken ? { shareToken: args.shareToken } : {}),
    createdAt: now,
    expiresAt,
  });
  return {
    token,
    path: docContentReadPath(token),
    version: args.object.version,
    expiresAt,
    encoding: args.object.encoding,
    rawSize: args.object.rawSize,
    compressedSize: args.object.compressedSize,
    rawSha256: args.object.rawSha256,
    compressedSha256: args.object.compressedSha256,
    etag: args.object.etag,
  };
};

export const createDocContentReadGrant = async (
  ctx: MutationCtx,
  args: { docId: Id<"docs">; snapshotId?: Id<"docContentSnapshots"> },
) => {
  const ownerId = await requireUserId(ctx);
  const doc = await ctx.db.get("docs", args.docId);
  if (!doc || doc.ownerId !== ownerId || doc.lifecycle !== "active") {
    throw new Error("Doc not found");
  }
  let object: ReadGrantObject;
  if (args.snapshotId) {
    const snapshot = await ctx.db.get("docContentSnapshots", args.snapshotId);
    if (!snapshot || snapshot.docId !== doc._id) {
      throw new Error("Doc content snapshot not found");
    }
    object = { source: "snapshot", snapshotId: snapshot._id, ...snapshot };
  } else {
    const manifest = await readDocContentManifest(ctx, doc._id);
    if (!manifest) {
      throw new Error("Doc content is missing");
    }
    object = { source: "current", ...manifest };
  }
  return await insertDocContentReadGrant(ctx, {
    docId: doc._id,
    object,
    access: "owner",
  });
};

export const resolveDocContentUploadGrant = async (
  ctx: MutationCtx,
  token: string,
) => {
  const grant = await ctx.db
    .query("docContentUploadGrants")
    .withIndex("by_token", (q) => q.eq("token", token))
    .unique();
  const now = Date.now();
  if (
    !grant ||
    grant.expiresAt < now ||
    grant.resolvedAt !== undefined ||
    grant.registeredAt !== undefined
  ) {
    return null;
  }
  await ctx.db.patch("docContentUploadGrants", grant._id, { resolvedAt: now });
  return toDocContentGrantContract(grant);
};

export const resolveDocContentReadGrant = async (
  ctx: MutationCtx,
  token: string,
) => {
  const grant = await ctx.db
    .query("docContentReadGrants")
    .withIndex("by_token", (q) => q.eq("token", token))
    .unique();
  if (!grant || grant.expiresAt < Date.now()) {
    return null;
  }
  const doc = await ctx.db.get("docs", grant.docId);
  if (!doc || doc.lifecycle !== "active") {
    return null;
  }
  if (grant.access === "shared") {
    const diagram = grant.diagramId
      ? await ctx.db.get("diagrams", grant.diagramId)
      : null;
    const placement = grant.diagramId
      ? await ctx.db
          .query("docPlacements")
          .withIndex("by_diagramId_and_docId", (q) =>
            q.eq("diagramId", grant.diagramId!).eq("docId", grant.docId),
          )
          .take(1)
      : [];
    if (
      !diagram ||
      !diagram.shareEnabled ||
      diagram.shareToken !== grant.shareToken ||
      placement.length === 0
    ) {
      return null;
    }
  }
  const object =
    grant.source === "current"
      ? await readDocContentManifest(ctx, grant.docId)
      : grant.snapshotId
      ? await ctx.db.get("docContentSnapshots", grant.snapshotId)
      : null;
  if (
    !object ||
    object.docId !== grant.docId ||
    object.version !== grant.version ||
    object.objectKey !== grant.objectKey ||
    object.encoding !== grant.encoding ||
    object.rawSize !== grant.rawSize ||
    object.compressedSize !== grant.compressedSize ||
    object.rawSha256 !== grant.rawSha256 ||
    object.compressedSha256 !== grant.compressedSha256 ||
    object.etag !== grant.etag
  ) {
    return null;
  }
  return {
    ...toDocContentGrantContract({ ...grant, docId: grant.docId }),
    etag: grant.etag,
    expiresAt: grant.expiresAt,
  };
};

export const consumeDocContentDeleteGrant = async (
  ctx: MutationCtx,
  token: string,
) => {
  const grant = await ctx.db
    .query("docContentDeleteGrants")
    .withIndex("by_token", (q) => q.eq("token", token))
    .unique();
  if (!grant) {
    return null;
  }
  if (!grant.retainUntilConfirmed) {
    await ctx.db.delete("docContentDeleteGrants", grant._id);
  }
  if (grant.expiresAt < Date.now()) {
    return null;
  }
  return {
    objectKeys: grant.objectKeys,
    ...(grant.objectKeyPrefix
      ? { objectKeyPrefix: grant.objectKeyPrefix }
      : {}),
  };
};

export const listPendingDocContentCleanup = async (
  ctx: QueryCtx,
  now: number,
) => {
  const ownerId = await requireUserId(ctx);
  const grants = await ctx.db
    .query("docContentDeleteGrants")
    .withIndex("by_ownerId_and_createdAt", (q) => q.eq("ownerId", ownerId))
    .order("asc")
    .take(MAX_PENDING_DOC_CONTENT_CLEANUP_TOKENS);
  return grants
    .filter((grant) => grant.expiresAt >= now)
    .map((grant) => grant.token);
};

export const purgeDocContentRecords = async (
  ctx: MutationCtx,
  doc: Doc<"docs">,
) => {
  return await createDocContentDeleteGrant(ctx, {
    ownerId: doc.ownerId,
    docId: doc._id,
    objectKeys: [],
    objectKeyPrefix: docContentKeyPrefixForDoc(doc._id),
    retainUntilConfirmed: true,
  });
};
