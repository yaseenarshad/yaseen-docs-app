import { getAuthUserId } from "@convex-dev/auth/server";

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
  makeBoardSceneToken,
  toBoardSceneGrantContract,
} from "./boardSceneModel";
import { CLOUD_SAVE_PROTOCOL_VERSION } from "./cloudSaveProtocol";
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
  args: BoardSceneIntegrity & {
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
        grant.encoding === args.encoding &&
        grant.rawSize === args.rawSize &&
        grant.compressedSize === args.compressedSize &&
        grant.rawSha256 === args.rawSha256 &&
        grant.compressedSha256 === args.compressedSha256 &&
        grant.semanticSha256 === args.semanticSha256,
    ) ?? null
  );
};

export const createBoardSceneUploadGrant = async (
  ctx: MutationCtx,
  args: BoardSceneIntegrity & {
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
  // The binding-echo safety valve, decided from one small document: an
  // unchanged scene is accepted without an upload and without a scene read.
  if (manifest && manifest.semanticSha256 === args.semanticSha256) {
    return {
      status: "unchanged" as const,
      version: manifest.version,
      updatedAt: manifest.updatedAt,
    };
  }

  const now = Date.now();
  const reusable = await findReusableUploadGrant(ctx, {
    ...args,
    diagramId: diagram._id,
    now,
  });
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
  const version =
    args.purpose === "migration" ? currentVersion : currentVersion + 1;
  await ctx.db.insert("boardSceneUploadGrants", {
    token,
    purpose: args.purpose,
    diagramId: diagram._id,
    ownerId,
    expectedVersion: args.expectedVersion,
    version,
    objectKey: makeBoardSceneObjectKey(diagram._id),
    encoding: args.encoding,
    rawSize: args.rawSize,
    compressedSize: args.compressedSize,
    rawSha256: args.rawSha256,
    compressedSha256: args.compressedSha256,
    semanticSha256: args.semanticSha256,
    createdAt: now,
    expiresAt,
  });
  return { status: "upload" as const, token, version, expiresAt };
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
    await ctx.db.delete("boardSceneUploadGrants", grant._id);
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
    force: false,
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
  const cleanupToken = await createBoardSceneDeleteGrant(ctx, {
    ownerId,
    diagramId: grant.diagramId,
    objectKeys: [grant.objectKey],
  });
  await ctx.db.delete("boardSceneUploadGrants", grant._id);
  return { cleanupToken };
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

  const token = makeBoardSceneToken();
  const now = Date.now();
  const expiresAt = now + BOARD_SCENE_READ_GRANT_LIFETIME_MS;
  await ctx.db.insert("boardSceneReadGrants", {
    token,
    diagramId: diagram._id,
    ...object,
    access,
    ...(access === "shared" ? { shareToken: args.shareToken } : null),
    createdAt: now,
    expiresAt,
  });
  return {
    token,
    path: boardSceneReadPath(token),
    version: object.version,
    expiresAt,
    encoding: object.encoding,
    rawSize: object.rawSize,
    compressedSize: object.compressedSize,
    rawSha256: object.rawSha256,
    compressedSha256: object.compressedSha256,
    semanticSha256: object.semanticSha256,
    etag: object.etag,
  };
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
    await ctx.db.delete("boardSceneUploadGrants", grant._id);
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
