import { getAuthUserId } from "@convex-dev/auth/server";

import {
  DOC_PLACEMENT_REFS_PROTOCOL_VERSION,
  MAX_DOC_PLACEMENT_REFS,
  hashDocPlacementRefs,
  normalizeDocPlacementRefs,
} from "../doc-placement/types";

import {
  BOARD_SCENE_DELETE_GRANT_LIFETIME_MS,
  BOARD_SCENE_READ_GRANT_LIFETIME_MS,
  BOARD_SCENE_UPLOAD_GRANT_LIFETIME_MS,
  MAX_PENDING_BOARD_SCENE_CLEANUP_TOKENS,
  assertBoardSceneEtag,
  assertBoardSceneIntegrity,
  boardSceneKeyPrefixForDiagram,
  boardSceneReadPath,
  makeBoardSceneObjectKey,
  makeBoardSceneStagingKey,
  makeBoardSceneToken,
  toBoardSceneGrantContract,
} from "./boardSceneModel";
import { CLOUD_SAVE_PROTOCOL_VERSION } from "./cloudSaveProtocol";
import { getDocsMode } from "./docsMode";
import { shouldCreateDiagramSnapshot } from "./snapshotPolicy";

import type { BOARD_SCENE_ENCODING } from "../board-scenes/types";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

/** A migrated Board never touches `diagramContents` again. */
export const BOARD_SCENE_MOVED_MESSAGE =
  "This board's scene has moved to object storage";

const RECENT_UPLOAD_GRANTS = 10;
const MAX_BOARD_SCENE_GRANTS_PER_BOARD = 1000;

type BoardSceneIntegrity = {
  encoding: typeof BOARD_SCENE_ENCODING;
  rawSize: number;
  compressedSize: number;
  rawSha256: string;
  compressedSha256: string;
  semanticSha256: string;
};

type BoardDocRefsUpload = {
  docRefsProtocolVersion?: number;
  docRefsHash?: string;
  docRefs?: Array<{ docId: Id<"docs">; elementId: string }>;
};

type ValidatedBoardDocRefs = {
  docRefsProtocolVersion: number;
  docRefsHash: string;
  docRefs?: Array<{ docId: Id<"docs">; elementId: string }>;
};

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

const requireUserId = async (ctx: QueryCtx | MutationCtx) => {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Authentication required");
  }
  return userId;
};

export const readBoardSceneManifest = async (
  ctx: QueryCtx | MutationCtx,
  diagramId: Id<"diagrams">,
) =>
  await ctx.db
    .query("diagramSceneManifests")
    .withIndex("by_diagramId", (q) => q.eq("diagramId", diagramId))
    .unique();

export const assertBoardSceneNotMigrated = async (
  ctx: QueryCtx | MutationCtx,
  diagramId: Id<"diagrams">,
) => {
  if (await readBoardSceneManifest(ctx, diagramId)) {
    throw new Error(BOARD_SCENE_MOVED_MESSAGE);
  }
};

const filterOwnedDocPlacementRefs = async (
  ctx: MutationCtx,
  ownerId: Id<"users">,
  refs: readonly { docId: Id<"docs">; elementId: string }[],
) => {
  const ownedDocIds = new Set<Id<"docs">>();
  for (const docId of new Set(refs.map((ref) => ref.docId))) {
    const doc = await ctx.db.get("docs", docId);
    if (doc?.ownerId === ownerId && doc.lifecycle === "active") {
      ownedDocIds.add(docId);
    }
  }
  return refs.filter((ref) => ownedDocIds.has(ref.docId));
};

/**
 * New clients declare a compact hash on every grant. The full list is required
 * only when that hash differs from the accepted manifest, keeping ordinary
 * Board saves on their existing small-document path.
 */
const validateBoardDocRefsUpload = async (
  ctx: MutationCtx,
  args: BoardDocRefsUpload,
  ownerId: Id<"users">,
  manifest: Doc<"diagramSceneManifests"> | null,
): Promise<ValidatedBoardDocRefs | null> => {
  const hasAnyField =
    args.docRefsProtocolVersion !== undefined ||
    args.docRefsHash !== undefined ||
    args.docRefs !== undefined;
  if (!hasAnyField) {
    return null;
  }
  const docsMode = getDocsMode();
  if (docsMode === "off") {
    return null;
  }
  if (
    args.docRefsProtocolVersion !== DOC_PLACEMENT_REFS_PROTOCOL_VERSION ||
    args.docRefsHash === undefined ||
    !SHA256_PATTERN.test(args.docRefsHash)
  ) {
    throw new Error("Doc placement reference contract is invalid");
  }

  const changed =
    manifest?.docRefsProtocolVersion !== args.docRefsProtocolVersion ||
    manifest?.docRefsHash !== args.docRefsHash;
  if (docsMode === "read-only") {
    if (changed) {
      throw new Error("Docs are read-only");
    }
    return null;
  }
  if (changed && args.docRefs === undefined) {
    throw new Error("Full Doc placement refs are required for a changed hash");
  }

  let refs: Array<{ docId: Id<"docs">; elementId: string }> | undefined;
  if (args.docRefs !== undefined) {
    refs = normalizeDocPlacementRefs(args.docRefs).map((ref) => ({
      docId: ref.docId as Id<"docs">,
      elementId: ref.elementId,
    }));
    if ((await hashDocPlacementRefs(refs)) !== args.docRefsHash) {
      throw new Error("Doc placement hash does not match its refs");
    }
  }

  return {
    docRefsProtocolVersion: args.docRefsProtocolVersion,
    docRefsHash: args.docRefsHash,
    ...(changed ? { docRefs: refs } : null),
  };
};

/**
 * The legacy version only needs a content read for Boards written before
 * `contentVersion` existed; a migrated Board never reaches this at all.
 */
const readLegacyBoardVersion = async (
  ctx: QueryCtx | MutationCtx,
  diagram: Doc<"diagrams">,
) => {
  if (diagram.contentVersion !== undefined) {
    return diagram.contentVersion;
  }
  const content = await ctx.db
    .query("diagramContents")
    .withIndex("by_diagramId", (q) => q.eq("diagramId", diagram._id))
    .unique();
  if (!content) {
    throw new Error("Board content is missing");
  }
  return content.version;
};

export const createBoardSceneDeleteGrant = async (
  ctx: MutationCtx,
  args: {
    ownerId: Id<"users">;
    diagramId?: Id<"diagrams">;
    objectKeys: string[];
    objectKeyPrefix?: string;
  },
) => {
  const objectKeys = [...new Set(args.objectKeys)];
  if (objectKeys.length === 0 && args.objectKeyPrefix === undefined) {
    return null;
  }
  const token = makeBoardSceneToken();
  const now = Date.now();
  await ctx.db.insert("boardSceneDeleteGrants", {
    token,
    ownerId: args.ownerId,
    ...(args.diagramId ? { diagramId: args.diagramId } : null),
    objectKeys,
    ...(args.objectKeyPrefix
      ? { objectKeyPrefix: args.objectKeyPrefix }
      : null),
    createdAt: now,
    expiresAt: now + BOARD_SCENE_DELETE_GRANT_LIFETIME_MS,
  });
  return token;
};

const findReusableUploadGrant = async (
  ctx: MutationCtx,
  args: BoardSceneIntegrity &
    BoardDocRefsUpload & {
      diagramId: Id<"diagrams">;
      purpose: "migration" | "save";
      expectedVersion: number;
      now: number;
    },
) => {
  const recent = await ctx.db
    .query("boardSceneUploadGrants")
    .withIndex("by_diagramId", (q) => q.eq("diagramId", args.diagramId))
    .order("desc")
    .take(RECENT_UPLOAD_GRANTS);
  return (
    recent.find(
      (grant) =>
        grant.purpose === args.purpose &&
        grant.expectedVersion === args.expectedVersion &&
        grant.expiresAt >= args.now &&
        grant.resolvedAt === undefined &&
        grant.registeredAt === undefined &&
        grant.stagingObjectKey !== undefined &&
        grant.finalizationId === undefined &&
        grant.abandonedAt === undefined &&
        grant.encoding === args.encoding &&
        grant.rawSize === args.rawSize &&
        grant.compressedSize === args.compressedSize &&
        grant.rawSha256 === args.rawSha256 &&
        grant.compressedSha256 === args.compressedSha256 &&
        grant.semanticSha256 === args.semanticSha256 &&
        grant.docRefsProtocolVersion === args.docRefsProtocolVersion &&
        grant.docRefsHash === args.docRefsHash &&
        JSON.stringify(grant.docRefs) === JSON.stringify(args.docRefs),
    ) ?? null
  );
};

const issueBoardSceneUploadGrant = async (
  ctx: MutationCtx,
  args: BoardSceneIntegrity &
    BoardDocRefsUpload & {
      diagramId: Id<"diagrams">;
      ownerId: Id<"users">;
      purpose: "migration" | "save";
      expectedVersion: number;
      version: number;
      reuse: boolean;
    },
) => {
  const now = Date.now();
  const reusable = args.reuse
    ? await findReusableUploadGrant(ctx, { ...args, now })
    : null;
  if (reusable) {
    return {
      status: "upload" as const,
      token: reusable.token,
      version: reusable.version,
      expiresAt: reusable.expiresAt,
    };
  }

  const token = makeBoardSceneToken();
  const expiresAt = now + BOARD_SCENE_UPLOAD_GRANT_LIFETIME_MS;
  await ctx.db.insert("boardSceneUploadGrants", {
    token,
    purpose: args.purpose,
    diagramId: args.diagramId,
    ownerId: args.ownerId,
    expectedVersion: args.expectedVersion,
    version: args.version,
    objectKey: makeBoardSceneObjectKey(args.diagramId),
    stagingObjectKey: makeBoardSceneStagingKey(args.diagramId),
    forceSnapshot: !args.reuse,
    encoding: args.encoding,
    rawSize: args.rawSize,
    compressedSize: args.compressedSize,
    rawSha256: args.rawSha256,
    compressedSha256: args.compressedSha256,
    semanticSha256: args.semanticSha256,
    ...(args.docRefsProtocolVersion !== undefined
      ? { docRefsProtocolVersion: args.docRefsProtocolVersion }
      : null),
    ...(args.docRefsHash !== undefined
      ? { docRefsHash: args.docRefsHash }
      : null),
    ...(args.docRefs !== undefined ? { docRefs: args.docRefs } : null),
    createdAt: now,
    expiresAt,
  });
  return { status: "upload" as const, token, version: args.version, expiresAt };
};

/**
 * The trusted counterpart of `createBoardSceneUploadGrant` for a server-side
 * edit that has already authorized its caller and already holds the scene it
 * means to replace. A server edit is never a binding echo, so the semantic
 * no-op is deliberately not applied: an edit that happens to reproduce the
 * current scene still commits a new version, exactly as the legacy path did.
 */
export const createServerBoardSceneUploadGrant = async (
  ctx: MutationCtx,
  args: BoardSceneIntegrity &
    BoardDocRefsUpload & {
      boardId: Id<"diagrams">;
      expectedVersion: number;
    },
) => {
  const ownerId = await requireUserId(ctx);
  const diagram = await ctx.db.get("diagrams", args.boardId);
  if (!diagram || diagram.ownerId !== ownerId) {
    throw new Error("Board not found");
  }
  assertBoardSceneIntegrity(args);
  const manifest = await readBoardSceneManifest(ctx, diagram._id);
  if (!manifest) {
    throw new Error("Board scene manifest is missing");
  }
  if (manifest.version !== args.expectedVersion) {
    return { status: "conflict" as const, version: manifest.version };
  }
  const docRefs = await validateBoardDocRefsUpload(
    ctx,
    args,
    ownerId,
    manifest,
  );
  return await issueBoardSceneUploadGrant(ctx, {
    ...args,
    diagramId: diagram._id,
    ownerId,
    purpose: "save",
    version: manifest.version + 1,
    reuse: false,
    ...(docRefs ?? null),
  });
};

export const createBoardSceneUploadGrant = async (
  ctx: MutationCtx,
  args: BoardSceneIntegrity &
    BoardDocRefsUpload & {
      boardId: Id<"diagrams">;
      clientSaveProtocol?: number;
      purpose: "migration" | "save";
      expectedVersion: number;
    },
) => {
  // Deliberately first: a stale client learns to reload before it can
  // authenticate or make this transaction read anything.
  if (args.clientSaveProtocol !== CLOUD_SAVE_PROTOCOL_VERSION) {
    return { status: "upgrade-required" as const };
  }
  const ownerId = await requireUserId(ctx);
  const diagram = await ctx.db.get("diagrams", args.boardId);
  if (!diagram || diagram.ownerId !== ownerId) {
    throw new Error("Board not found");
  }
  assertBoardSceneIntegrity(args);

  const manifest = await readBoardSceneManifest(ctx, diagram._id);
  if (args.purpose === "migration") {
    if (manifest) {
      throw new Error("Board scene is already stored in object storage");
    }
  } else if (!manifest) {
    throw new Error("Board scene manifest is missing");
  }

  const currentVersion = manifest
    ? manifest.version
    : await readLegacyBoardVersion(ctx, diagram);
  if (currentVersion !== args.expectedVersion) {
    return { status: "conflict" as const, version: currentVersion };
  }
  const docRefs = await validateBoardDocRefsUpload(
    ctx,
    args,
    ownerId,
    manifest,
  );
  // The binding-echo safety valve, decided from one small document: an
  // unchanged scene is accepted without an upload and without a scene read.
  if (
    manifest &&
    manifest.semanticSha256 === args.semanticSha256 &&
    (docRefs === null || manifest.docRefsHash === docRefs.docRefsHash)
  ) {
    return {
      status: "unchanged" as const,
      version: manifest.version,
      updatedAt: manifest.updatedAt,
    };
  }

  return await issueBoardSceneUploadGrant(ctx, {
    ...args,
    diagramId: diagram._id,
    ownerId,
    version: args.purpose === "migration" ? currentVersion : currentVersion + 1,
    reuse: true,
    ...(docRefs ?? null),
  });
};

const reconcileBoardDocPlacements = async (
  ctx: MutationCtx,
  args: {
    diagramId: Id<"diagrams">;
    ownerId: Id<"users">;
    previousHash?: string;
    grant: Doc<"boardSceneUploadGrants">;
    now: number;
  },
) => {
  if (getDocsMode() !== "on") {
    return;
  }
  if (
    args.grant.docRefsProtocolVersion === undefined ||
    args.grant.docRefsHash === undefined ||
    args.previousHash === args.grant.docRefsHash
  ) {
    return;
  }
  const refs = args.grant.docRefs;
  if (!refs) {
    throw new Error("Full Doc placement refs are required for reconciliation");
  }
  const ownedRefs = await filterOwnedDocPlacementRefs(ctx, args.ownerId, refs);
  const existing = await ctx.db
    .query("docPlacements")
    .withIndex("by_diagramId_and_elementId", (q) =>
      q.eq("diagramId", args.diagramId),
    )
    .take(MAX_DOC_PLACEMENT_REFS + 1);
  if (existing.length > MAX_DOC_PLACEMENT_REFS) {
    throw new Error("Board has too many Doc placement rows to reconcile");
  }

  const desired = new Map(ownedRefs.map((ref) => [ref.elementId, ref.docId]));
  const settled = new Set<string>();
  for (const placement of existing) {
    const desiredDocId = desired.get(placement.elementId);
    if (
      desiredDocId === undefined ||
      desiredDocId !== placement.docId ||
      settled.has(placement.elementId)
    ) {
      await ctx.db.delete("docPlacements", placement._id);
      continue;
    }
    settled.add(placement.elementId);
  }
  for (const ref of ownedRefs) {
    if (settled.has(ref.elementId)) {
      continue;
    }
    await ctx.db.insert("docPlacements", {
      diagramId: args.diagramId,
      docId: ref.docId,
      elementId: ref.elementId,
      createdAt: args.now,
      updatedAt: args.now,
    });
  }
};

/**
 * Snapshot timing for a migrated Board comes from the manifest, so a normal
 * save never reads the newest snapshot document.
 */
const createBoardSceneSnapshotIfNeeded = async (
  ctx: MutationCtx,
  args: {
    diagram: Doc<"diagrams">;
    manifest: Doc<"diagramSceneManifests">;
    ownerId: Id<"users">;
    now: number;
    force: boolean;
  },
) => {
  if (args.diagram.lastSnapshotVersion === args.manifest.version) {
    return false;
  }
  const lastSnapshotAt =
    args.manifest.lastSnapshotAt ?? args.diagram.lastSnapshotAt ?? null;
  if (
    !shouldCreateDiagramSnapshot({
      currentVersion: args.manifest.version,
      force: args.force,
      lastSnapshotAt,
      now: args.now,
    })
  ) {
    return false;
  }
  await ctx.db.insert("diagramSnapshots", {
    diagramId: args.diagram._id,
    createdBy: args.ownerId,
    objectKey: args.manifest.objectKey,
    encoding: args.manifest.encoding,
    rawSize: args.manifest.rawSize,
    compressedSize: args.manifest.compressedSize,
    rawSha256: args.manifest.rawSha256,
    compressedSha256: args.manifest.compressedSha256,
    semanticSha256: args.manifest.semanticSha256,
    etag: args.manifest.etag,
    version: args.manifest.version,
    createdAt: args.now,
  });
  await ctx.db.patch("diagrams", args.diagram._id, {
    lastSnapshotAt: args.now,
    lastSnapshotVersion: args.manifest.version,
  });
  return true;
};

export const commitBoardSceneUpload = async (
  ctx: MutationCtx,
  args: { clientSaveProtocol?: number; token: string; etag: string },
  options: { forceSnapshot: boolean; claimId?: string } = {
    forceSnapshot: false,
  },
) => {
  if (args.clientSaveProtocol !== CLOUD_SAVE_PROTOCOL_VERSION) {
    return { status: "upgrade-required" as const };
  }
  const ownerId = await requireUserId(ctx);
  assertBoardSceneEtag(args.etag);
  const grant = await ctx.db
    .query("boardSceneUploadGrants")
    .withIndex("by_token", (q) => q.eq("token", args.token))
    .unique();
  const now = Date.now();
  if (
    grant?.stagingObjectKey &&
    (!options.claimId ||
      grant.finalizationId !== options.claimId ||
      grant.abandonedAt !== undefined)
  ) {
    throw new Error("Board scene finalization is not authorized");
  }
  if (
    !grant ||
    grant.ownerId !== ownerId ||
    grant.registeredAt !== undefined ||
    grant.expiresAt < now
  ) {
    throw new Error("Board scene upload grant expired");
  }
  const diagram = await ctx.db.get("diagrams", grant.diagramId);
  if (!diagram || diagram.ownerId !== ownerId) {
    throw new Error("Board not found");
  }

  const manifest = await readBoardSceneManifest(ctx, diagram._id);
  const currentVersion = manifest
    ? manifest.version
    : await readLegacyBoardVersion(ctx, diagram);
  // A commit is atomic in the strong sense: grant, owner, Board, manifest state
  // and expected version must all still agree, or nothing is written.
  if (
    currentVersion !== grant.expectedVersion ||
    (grant.purpose === "migration") !== (manifest === null)
  ) {
    if (!grant.stagingObjectKey) {
      await ctx.db.delete("boardSceneUploadGrants", grant._id);
    }
    return {
      status: "conflict" as const,
      version: currentVersion,
      cleanupToken: await createBoardSceneDeleteGrant(ctx, {
        ownerId,
        diagramId: diagram._id,
        objectKeys: [grant.objectKey],
      }),
    };
  }

  if (!manifest) {
    await reconcileBoardDocPlacements(ctx, {
      diagramId: diagram._id,
      ownerId,
      grant,
      now,
    });
    await ctx.db.insert("diagramSceneManifests", {
      diagramId: diagram._id,
      version: grant.version,
      objectKey: grant.objectKey,
      encoding: grant.encoding,
      rawSize: grant.rawSize,
      compressedSize: grant.compressedSize,
      rawSha256: grant.rawSha256,
      compressedSha256: grant.compressedSha256,
      semanticSha256: grant.semanticSha256,
      etag: args.etag,
      ...(grant.docRefsHash !== undefined
        ? { docRefsHash: grant.docRefsHash }
        : null),
      ...(grant.docRefsProtocolVersion !== undefined
        ? { docRefsProtocolVersion: grant.docRefsProtocolVersion }
        : null),
      ...(diagram.lastSnapshotAt !== undefined
        ? { lastSnapshotAt: diagram.lastSnapshotAt }
        : null),
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch("boardSceneUploadGrants", grant._id, {
      registeredAt: now,
      etag: args.etag,
    });
    // Migration is not an edit: the version and the user-visible modified time
    // both stay exactly where the legacy Board left them.
    if (diagram.contentVersion !== grant.version) {
      await ctx.db.patch("diagrams", diagram._id, {
        contentVersion: grant.version,
      });
    }
    return {
      status: "committed" as const,
      version: grant.version,
      updatedAt: diagram.updatedAt,
      snapshotCreated: false,
      cleanupToken: null,
    };
  }

  const snapshotCreated = await createBoardSceneSnapshotIfNeeded(ctx, {
    diagram,
    manifest,
    ownerId,
    now,
    force: options.forceSnapshot,
  });
  // The displaced object is either preserved as the snapshot or handed back as
  // bounded cleanup work; it is never both and never silently leaked.
  const cleanupToken = snapshotCreated
    ? null
    : await createBoardSceneDeleteGrant(ctx, {
        ownerId,
        diagramId: diagram._id,
        objectKeys: [manifest.objectKey],
      });
  await reconcileBoardDocPlacements(ctx, {
    diagramId: diagram._id,
    ownerId,
    previousHash: manifest.docRefsHash,
    grant,
    now,
  });
  await ctx.db.patch("diagramSceneManifests", manifest._id, {
    version: grant.version,
    objectKey: grant.objectKey,
    encoding: grant.encoding,
    rawSize: grant.rawSize,
    compressedSize: grant.compressedSize,
    rawSha256: grant.rawSha256,
    compressedSha256: grant.compressedSha256,
    semanticSha256: grant.semanticSha256,
    etag: args.etag,
    ...(grant.docRefsHash !== undefined
      ? { docRefsHash: grant.docRefsHash }
      : null),
    ...(grant.docRefsProtocolVersion !== undefined
      ? { docRefsProtocolVersion: grant.docRefsProtocolVersion }
      : null),
    ...(snapshotCreated ? { lastSnapshotAt: now } : null),
    updatedAt: now,
  });
  await ctx.db.patch("diagrams", diagram._id, {
    contentVersion: grant.version,
    updatedAt: now,
  });
  await ctx.db.patch("boardSceneUploadGrants", grant._id, {
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

export const abandonBoardSceneUpload = async (
  ctx: MutationCtx,
  token: string,
) => {
  const ownerId = await requireUserId(ctx);
  const grant = await ctx.db
    .query("boardSceneUploadGrants")
    .withIndex("by_token", (q) => q.eq("token", token))
    .unique();
  if (!grant || grant.ownerId !== ownerId || grant.registeredAt !== undefined) {
    throw new Error("Board scene upload grant not found");
  }
  if (grant.stagingObjectKey) {
    // Keep the final key tracked until every possible in-flight copy has ended.
    await ctx.db.patch("boardSceneUploadGrants", grant._id, {
      abandonedAt: Date.now(),
    });
    return { cleanupToken: null };
  }
  const cleanupToken = await createBoardSceneDeleteGrant(ctx, {
    ownerId,
    diagramId: grant.diagramId,
    objectKeys: [grant.objectKey],
  });
  await ctx.db.delete("boardSceneUploadGrants", grant._id);
  return { cleanupToken };
};

type BoardSceneReadGrantObject = {
  source: "current" | "snapshot";
  snapshotId?: Id<"diagramSnapshots">;
  version: number;
  objectKey: string;
  encoding: typeof BOARD_SCENE_ENCODING;
  rawSize: number;
  compressedSize: number;
  rawSha256: string;
  compressedSha256: string;
  semanticSha256: string;
  etag: string;
};

/**
 * The read capability itself: an unguessable token, the exact object it names,
 * and the integrity contract the caller must verify. The object key stays in
 * the row and never appears in the returned capability.
 */
const insertBoardSceneReadGrant = async (
  ctx: MutationCtx,
  args: {
    diagramId: Id<"diagrams">;
    object: BoardSceneReadGrantObject;
    access: "owner" | "shared";
    shareToken?: string;
  },
) => {
  const token = makeBoardSceneToken();
  const now = Date.now();
  const expiresAt = now + BOARD_SCENE_READ_GRANT_LIFETIME_MS;
  await ctx.db.insert("boardSceneReadGrants", {
    token,
    diagramId: args.diagramId,
    ...args.object,
    access: args.access,
    ...(args.shareToken ? { shareToken: args.shareToken } : null),
    createdAt: now,
    expiresAt,
  });
  return {
    token,
    path: boardSceneReadPath(token),
    version: args.object.version,
    expiresAt,
    encoding: args.object.encoding,
    rawSize: args.object.rawSize,
    compressedSize: args.object.compressedSize,
    rawSha256: args.object.rawSha256,
    compressedSha256: args.object.compressedSha256,
    semanticSha256: args.object.semanticSha256,
    etag: args.object.etag,
  };
};

/**
 * Trusted backend code reading a Board's current scene for its own use. The
 * caller is responsible for authorization; there is no user identity here, so
 * the grant is recorded as owner access against the Board's own owner.
 */
export const createInternalBoardSceneReadGrant = async (
  ctx: MutationCtx,
  diagramId: Id<"diagrams">,
) => {
  const manifest = await readBoardSceneManifest(ctx, diagramId);
  if (!manifest) {
    return null;
  }
  return await insertBoardSceneReadGrant(ctx, {
    diagramId,
    access: "owner",
    object: {
      source: "current" as const,
      version: manifest.version,
      objectKey: manifest.objectKey,
      encoding: manifest.encoding,
      rawSize: manifest.rawSize,
      compressedSize: manifest.compressedSize,
      rawSha256: manifest.rawSha256,
      compressedSha256: manifest.compressedSha256,
      semanticSha256: manifest.semanticSha256,
      etag: manifest.etag,
    },
  });
};

export const createBoardSceneReadGrant = async (
  ctx: MutationCtx,
  args: {
    boardId?: Id<"diagrams">;
    shareToken?: string;
    snapshotId?: Id<"diagramSnapshots">;
  },
) => {
  if ((args.boardId === undefined) === (args.shareToken === undefined)) {
    throw new Error("Choose owner or shared board access");
  }

  let diagram: Doc<"diagrams"> | null;
  let access: "owner" | "shared";
  if (args.boardId !== undefined) {
    const ownerId = await requireUserId(ctx);
    diagram = await ctx.db.get("diagrams", args.boardId);
    if (!diagram || diagram.ownerId !== ownerId) {
      throw new Error("Board not found");
    }
    access = "owner";
  } else {
    diagram = await ctx.db
      .query("diagrams")
      .withIndex("by_shareToken", (q) => q.eq("shareToken", args.shareToken))
      .unique();
    if (!diagram || !diagram.shareEnabled) {
      throw new Error("Shared board not found");
    }
    access = "shared";
  }

  let object;
  if (args.snapshotId !== undefined) {
    const snapshot =
      access === "owner"
        ? await ctx.db.get("diagramSnapshots", args.snapshotId)
        : null;
    if (
      !snapshot ||
      snapshot.diagramId !== diagram._id ||
      snapshot.objectKey === undefined ||
      snapshot.encoding === undefined ||
      snapshot.rawSize === undefined ||
      snapshot.compressedSize === undefined ||
      snapshot.rawSha256 === undefined ||
      snapshot.compressedSha256 === undefined ||
      snapshot.semanticSha256 === undefined ||
      snapshot.etag === undefined
    ) {
      throw new Error("Board scene snapshot not found");
    }
    object = {
      source: "snapshot" as const,
      snapshotId: snapshot._id,
      version: snapshot.version,
      objectKey: snapshot.objectKey,
      encoding: snapshot.encoding,
      rawSize: snapshot.rawSize,
      compressedSize: snapshot.compressedSize,
      rawSha256: snapshot.rawSha256,
      compressedSha256: snapshot.compressedSha256,
      semanticSha256: snapshot.semanticSha256,
      etag: snapshot.etag,
    };
  } else {
    const manifest = await readBoardSceneManifest(ctx, diagram._id);
    if (!manifest) {
      throw new Error("Board scene manifest is missing");
    }
    object = {
      source: "current" as const,
      version: manifest.version,
      objectKey: manifest.objectKey,
      encoding: manifest.encoding,
      rawSize: manifest.rawSize,
      compressedSize: manifest.compressedSize,
      rawSha256: manifest.rawSha256,
      compressedSha256: manifest.compressedSha256,
      semanticSha256: manifest.semanticSha256,
      etag: manifest.etag,
    };
  }

  return await insertBoardSceneReadGrant(ctx, {
    diagramId: diagram._id,
    object,
    access,
    ...(access === "shared" ? { shareToken: args.shareToken } : null),
  });
};

/**
 * Resolved for the Worker on every read. Revocation, supersession and Board
 * deletion all invalidate an outstanding grant here rather than at issue time.
 */
export const resolveBoardSceneReadGrant = async (
  ctx: QueryCtx,
  token: string,
) => {
  const grant = await ctx.db
    .query("boardSceneReadGrants")
    .withIndex("by_token", (q) => q.eq("token", token))
    .unique();
  if (!grant || grant.expiresAt < Date.now()) {
    return null;
  }
  const diagram = await ctx.db.get("diagrams", grant.diagramId);
  if (
    !diagram ||
    (grant.access === "shared" &&
      (!diagram.shareEnabled || diagram.shareToken !== grant.shareToken))
  ) {
    return null;
  }
  const object =
    grant.source === "current"
      ? await readBoardSceneManifest(ctx, grant.diagramId)
      : grant.snapshotId
      ? await ctx.db.get("diagramSnapshots", grant.snapshotId)
      : null;
  if (
    !object ||
    object.diagramId !== grant.diagramId ||
    object.version !== grant.version ||
    object.objectKey !== grant.objectKey ||
    object.encoding !== grant.encoding ||
    object.compressedSize !== grant.compressedSize ||
    object.compressedSha256 !== grant.compressedSha256 ||
    object.rawSize !== grant.rawSize ||
    object.rawSha256 !== grant.rawSha256 ||
    object.etag !== grant.etag
  ) {
    return null;
  }
  return {
    ...toBoardSceneGrantContract({ ...grant, diagramId: grant.diagramId }),
    etag: grant.etag,
    expiresAt: grant.expiresAt,
  };
};

/** Single-use: a resolved token can never be replayed against the Worker. */
export const resolveBoardSceneUploadGrant = async (
  ctx: MutationCtx,
  token: string,
) => {
  const grant = await ctx.db
    .query("boardSceneUploadGrants")
    .withIndex("by_token", (q) => q.eq("token", token))
    .unique();
  const now = Date.now();
  if (
    !grant ||
    grant.stagingObjectKey !== undefined ||
    grant.expiresAt < now ||
    grant.resolvedAt !== undefined ||
    grant.registeredAt !== undefined
  ) {
    return null;
  }
  await ctx.db.patch("boardSceneUploadGrants", grant._id, { resolvedAt: now });
  return toBoardSceneGrantContract({ ...grant, diagramId: grant.diagramId });
};

/** Single-use and idempotent: the Worker's delete itself is a no-op on retry. */
export const consumeBoardSceneDeleteGrant = async (
  ctx: MutationCtx,
  token: string,
) => {
  const grant = await ctx.db
    .query("boardSceneDeleteGrants")
    .withIndex("by_token", (q) => q.eq("token", token))
    .unique();
  if (!grant) {
    return null;
  }
  await ctx.db.delete("boardSceneDeleteGrants", grant._id);
  if (grant.expiresAt < Date.now()) {
    return null;
  }
  return {
    objectKeys: grant.objectKeys,
    ...(grant.objectKeyPrefix
      ? { objectKeyPrefix: grant.objectKeyPrefix }
      : null),
  };
};

export const listPendingBoardSceneCleanup = async (ctx: QueryCtx) => {
  const ownerId = await requireUserId(ctx);
  const now = Date.now();
  const grants = await ctx.db
    .query("boardSceneDeleteGrants")
    .withIndex("by_ownerId_and_createdAt", (q) => q.eq("ownerId", ownerId))
    .order("asc")
    .take(MAX_PENDING_BOARD_SCENE_CLEANUP_TOKENS);
  return grants
    .filter((grant) => grant.expiresAt >= now)
    .map((grant) => grant.token);
};

/**
 * Board deletion drops every scene coordination record and authorizes deleting
 * the whole Board-scene folder, which also covers snapshot and orphan objects.
 */
export const purgeBoardSceneRecords = async (
  ctx: MutationCtx,
  diagram: Doc<"diagrams">,
  ownerId: Id<"users">,
) => {
  const [manifest, uploadGrants, readGrants] = await Promise.all([
    readBoardSceneManifest(ctx, diagram._id),
    ctx.db
      .query("boardSceneUploadGrants")
      .withIndex("by_diagramId", (q) => q.eq("diagramId", diagram._id))
      .take(MAX_BOARD_SCENE_GRANTS_PER_BOARD),
    ctx.db
      .query("boardSceneReadGrants")
      .withIndex("by_diagramId", (q) => q.eq("diagramId", diagram._id))
      .take(MAX_BOARD_SCENE_GRANTS_PER_BOARD),
  ]);
  if (manifest) {
    await ctx.db.delete("diagramSceneManifests", manifest._id);
  }
  for (const grant of uploadGrants) {
    if (grant.stagingObjectKey && grant.registeredAt === undefined) {
      await ctx.db.patch("boardSceneUploadGrants", grant._id, {
        abandonedAt: Date.now(),
      });
    } else {
      await ctx.db.delete("boardSceneUploadGrants", grant._id);
    }
  }
  for (const grant of readGrants) {
    await ctx.db.delete("boardSceneReadGrants", grant._id);
  }
  return await createBoardSceneDeleteGrant(ctx, {
    ownerId,
    objectKeys: [],
    objectKeyPrefix: boardSceneKeyPrefixForDiagram(diagram._id),
  });
};
