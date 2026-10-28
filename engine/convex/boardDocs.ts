import { v } from "convex/values";

import { MAX_DOC_PLACEMENT_REFS } from "../doc-placement/types";

import { mutation, query } from "./_generated/server";
import {
  insertDocContentReadGrant,
  readDocContentManifest,
} from "./docContentPersistence";
import { docContentReadGrantResultValidator } from "./docContentModel";
import { docLifecycleValidator } from "./docModel";
import { requireUserId } from "./boardPersistence";
import { requireDocsReadable } from "./docsMode";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

export const BOARD_DOC_MANIFEST_PAGE_SIZE = 200;
export const BOARD_DOC_READ_GRANT_BATCH_SIZE = 25;
const MAX_RAW_BATCH_IDS = 100;

const boardDocAccessArgs = {
  boardId: v.union(v.id("diagrams"), v.null()),
  shareToken: v.union(v.string(), v.null()),
};

const boardDocManifestSummaryValidator = v.object({
  docId: v.id("docs"),
  title: v.string(),
  lifecycle: docLifecycleValidator,
  version: v.number(),
  contentSize: v.number(),
  contentHash: v.optional(v.string()),
});

const boardDocGrantDenialReasonValidator = v.union(
  v.literal("not-placed"),
  v.literal("not-found"),
  v.literal("deleted"),
  v.literal("content-missing"),
);

const boardDocGrantResultValidator = v.union(
  v.object({
    docId: v.id("docs"),
    status: v.literal("granted"),
    grant: docContentReadGrantResultValidator,
  }),
  v.object({
    docId: v.id("docs"),
    status: v.literal("denied"),
    reason: boardDocGrantDenialReasonValidator,
  }),
);

type BoardDocAccess = {
  diagram: Doc<"diagrams">;
  access: "owner" | "shared";
  shareToken?: string;
};

const requireBoardDocAccess = async (
  ctx: QueryCtx | MutationCtx,
  args: { boardId: Id<"diagrams"> | null; shareToken: string | null },
): Promise<BoardDocAccess> => {
  if ((args.boardId === null) === (args.shareToken === null)) {
    throw new Error("Choose owner or shared Board access");
  }
  if (args.boardId !== null) {
    const ownerId = await requireUserId(ctx);
    const diagram = await ctx.db.get("diagrams", args.boardId);
    if (!diagram || diagram.ownerId !== ownerId) {
      throw new Error("Board not found");
    }
    return { diagram, access: "owner" };
  }

  const diagram = await ctx.db
    .query("diagrams")
    .withIndex("by_shareToken", (q) => q.eq("shareToken", args.shareToken!))
    .unique();
  if (!diagram || !diagram.shareEnabled) {
    throw new Error("Shared board not found");
  }
  return { diagram, access: "shared", shareToken: args.shareToken! };
};

export const listManifestPage = query({
  args: {
    ...boardDocAccessArgs,
    cursor: v.union(v.id("docs"), v.null()),
  },
  returns: v.object({
    page: v.array(boardDocManifestSummaryValidator),
    nextCursor: v.union(v.id("docs"), v.null()),
    isDone: v.boolean(),
  }),
  handler: async (ctx, args) => {
    requireDocsReadable();
    const { diagram } = await requireBoardDocAccess(ctx, args);
    const placements = await ctx.db
      .query("docPlacements")
      .withIndex("by_diagramId_and_docId", (q) => {
        const boardRange = q.eq("diagramId", diagram._id);
        return args.cursor ? boardRange.gt("docId", args.cursor) : boardRange;
      })
      .take(MAX_DOC_PLACEMENT_REFS + 1);
    if (placements.length > MAX_DOC_PLACEMENT_REFS) {
      throw new Error("Board has too many Doc placements");
    }

    const uniqueDocIds = [
      ...new Set(placements.map((placement) => placement.docId)),
    ];
    const selectedIds = uniqueDocIds.slice(0, BOARD_DOC_MANIFEST_PAGE_SIZE);
    const page = [];
    for (const docId of selectedIds) {
      const doc = await ctx.db.get("docs", docId);
      if (!doc || doc.ownerId !== diagram.ownerId) {
        continue;
      }
      // Tombstones expose only the former title and lifecycle. Content
      // versions, hashes, and sizes remain private after deletion.
      const manifest =
        doc.lifecycle === "active"
          ? await readDocContentManifest(ctx, docId)
          : null;
      page.push({
        docId,
        title: doc.title,
        lifecycle: doc.lifecycle,
        version: manifest?.version ?? 0,
        contentSize: manifest?.rawSize ?? 0,
        ...(manifest ? { contentHash: manifest.rawSha256 } : {}),
      });
    }
    const isDone = uniqueDocIds.length <= BOARD_DOC_MANIFEST_PAGE_SIZE;
    return {
      page,
      nextCursor: isDone ? null : selectedIds[selectedIds.length - 1] ?? null,
      isDone,
    };
  },
});

export const createReadGrants = mutation({
  args: { ...boardDocAccessArgs, docIds: v.array(v.id("docs")) },
  returns: v.object({
    results: v.array(boardDocGrantResultValidator),
    metrics: v.object({
      requested: v.number(),
      unique: v.number(),
      granted: v.number(),
    }),
  }),
  handler: async (ctx, args) => {
    requireDocsReadable();
    if (args.docIds.length > MAX_RAW_BATCH_IDS) {
      throw new Error("A read batch is too large");
    }
    const uniqueDocIds = [...new Set(args.docIds)];
    if (uniqueDocIds.length > BOARD_DOC_READ_GRANT_BATCH_SIZE) {
      throw new Error(
        `Request up to ${BOARD_DOC_READ_GRANT_BATCH_SIZE} unique Docs`,
      );
    }
    const boardAccess = await requireBoardDocAccess(ctx, args);
    const results = [];
    let granted = 0;
    for (const docId of uniqueDocIds) {
      const placement = await ctx.db
        .query("docPlacements")
        .withIndex("by_diagramId_and_docId", (q) =>
          q.eq("diagramId", boardAccess.diagram._id).eq("docId", docId),
        )
        .first();
      if (!placement) {
        results.push({
          docId,
          status: "denied" as const,
          reason: "not-placed" as const,
        });
        continue;
      }
      const doc = await ctx.db.get("docs", docId);
      if (!doc || doc.ownerId !== boardAccess.diagram.ownerId) {
        results.push({
          docId,
          status: "denied" as const,
          reason: "not-found" as const,
        });
        continue;
      }
      if (doc.lifecycle !== "active") {
        results.push({
          docId,
          status: "denied" as const,
          reason: "deleted" as const,
        });
        continue;
      }
      const manifest = await readDocContentManifest(ctx, docId);
      if (!manifest) {
        results.push({
          docId,
          status: "denied" as const,
          reason: "content-missing" as const,
        });
        continue;
      }
      const grant = await insertDocContentReadGrant(ctx, {
        docId,
        object: { source: "current", ...manifest },
        access: boardAccess.access,
        ...(boardAccess.access === "shared"
          ? {
              diagramId: boardAccess.diagram._id,
              shareToken: boardAccess.shareToken,
            }
          : {}),
      });
      results.push({ docId, status: "granted" as const, grant });
      granted += 1;
    }
    return {
      results,
      metrics: {
        requested: args.docIds.length,
        unique: uniqueDocIds.length,
        granted,
      },
    };
  },
});
