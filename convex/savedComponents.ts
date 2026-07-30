import { getAuthUserId } from "@convex-dev/auth/server";
import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { v } from "convex/values";

import {
  MAX_SAVED_COMPONENT_BYTES,
  MAX_SAVED_COMPONENT_NAME_LENGTH,
  SAVED_COMPONENT_SCHEMA_VERSION,
  UNSUPPORTED_SAVED_COMPONENT_ELEMENT_TYPES,
} from "../packages/common/src/savedComponents";

import { mutation, query } from "./_generated/server";

import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { PaginationOptions } from "convex/server";

const savedComponentValidator = v.object({
  _id: v.id("savedComponents"),
  _creationTime: v.number(),
  name: v.string(),
  normalizedName: v.string(),
  elementsJson: v.string(),
  elementCount: v.number(),
  schemaVersion: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

const componentMutationResultValidator = v.object({
  componentId: v.id("savedComponents"),
  updatedAt: v.optional(v.number()),
});

const requireUserId = async (ctx: QueryCtx | MutationCtx) => {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new Error("Authentication required");
  }
  return userId;
};

export const normalizeComponentName = (name: string) =>
  name.trim().replace(/\s+/g, " ");

const validateName = (name: string) => {
  const normalized = normalizeComponentName(name);
  if (!normalized) {
    throw new Error("Component name is required");
  }
  if (normalized.length > MAX_SAVED_COMPONENT_NAME_LENGTH) {
    throw new Error(
      `Component names must be ${MAX_SAVED_COMPONENT_NAME_LENGTH} characters or fewer`,
    );
  }
  return {
    name: normalized,
    normalizedName: normalized.toLocaleLowerCase("en-US"),
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const validateElementsJson = ({
  elementsJson,
  elementCount,
  schemaVersion,
}: {
  elementsJson: string;
  elementCount: number;
  schemaVersion: number;
}) => {
  const payloadBytes = new TextEncoder().encode(elementsJson).byteLength;
  if (payloadBytes > MAX_SAVED_COMPONENT_BYTES) {
    throw new Error(
      `Component payloads must be ${MAX_SAVED_COMPONENT_BYTES.toLocaleString(
        "en-US",
      )} bytes or smaller`,
    );
  }
  if (
    !Number.isInteger(schemaVersion) ||
    schemaVersion !== SAVED_COMPONENT_SCHEMA_VERSION
  ) {
    throw new Error(`Unsupported component schema version: ${schemaVersion}`);
  }
  if (!Number.isInteger(elementCount) || elementCount < 0) {
    throw new Error("Component element count must be a non-negative integer");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(elementsJson);
  } catch {
    throw new Error("Provide valid component JSON");
  }
  if (
    !isRecord(parsed) ||
    parsed.type !== "growprofit/saved-component" ||
    parsed.schemaVersion !== SAVED_COMPONENT_SCHEMA_VERSION ||
    !Array.isArray(parsed.elements)
  ) {
    throw new Error("Provide a valid canonical component JSON envelope");
  }
  if (parsed.elements.length === 0) {
    throw new Error("A saved component must contain at least one element");
  }
  if (parsed.elements.length !== elementCount) {
    throw new Error("Component element count does not match its payload");
  }

  for (const element of parsed.elements) {
    if (!isRecord(element) || typeof element.type !== "string") {
      throw new Error("Every saved component element must have a valid type");
    }
    if (
      (UNSUPPORTED_SAVED_COMPONENT_ELEMENT_TYPES as readonly string[]).includes(
        element.type,
      )
    ) {
      throw new Error(
        `Saved components do not yet support ${element.type} elements`,
      );
    }
  }
};

const toClientComponent = ({
  ownerId: _ownerId,
  ...component
}: {
  ownerId: Id<"users">;
  _id: Id<"savedComponents">;
  _creationTime: number;
  name: string;
  normalizedName: string;
  elementsJson: string;
  elementCount: number;
  schemaVersion: number;
  createdAt: number;
  updatedAt: number;
}) => component;

const paginateOwnedComponents = async (
  ctx: QueryCtx,
  ownerId: Id<"users">,
  paginationOpts: PaginationOptions,
) => {
  const result = await ctx.db
    .query("savedComponents")
    .withIndex("by_ownerId_and_updatedAt", (q) => q.eq("ownerId", ownerId))
    .order("desc")
    .paginate(paginationOpts);
  return {
    ...result,
    page: result.page.map(toClientComponent),
  };
};

export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(savedComponentValidator),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    return await paginateOwnedComponents(ctx, ownerId, args.paginationOpts);
  },
});

export const search = query({
  args: {
    query: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginationResultValidator(savedComponentValidator),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const normalizedQuery = normalizeComponentName(
      args.query,
    ).toLocaleLowerCase("en-US");
    if (!normalizedQuery) {
      return await paginateOwnedComponents(ctx, ownerId, args.paginationOpts);
    }

    const result = await ctx.db
      .query("savedComponents")
      .withSearchIndex("search_normalizedName", (q) =>
        q.search("normalizedName", normalizedQuery).eq("ownerId", ownerId),
      )
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: result.page.map(toClientComponent),
    };
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    elementsJson: v.string(),
    elementCount: v.number(),
    schemaVersion: v.number(),
  },
  returns: componentMutationResultValidator,
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const name = validateName(args.name);
    validateElementsJson(args);
    const now = Date.now();
    const componentId = await ctx.db.insert("savedComponents", {
      ownerId,
      ...name,
      elementsJson: args.elementsJson,
      elementCount: args.elementCount,
      schemaVersion: args.schemaVersion,
      createdAt: now,
      updatedAt: now,
    });
    return { componentId, updatedAt: now };
  },
});

export const rename = mutation({
  args: {
    componentId: v.id("savedComponents"),
    name: v.string(),
  },
  returns: componentMutationResultValidator,
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const component = await ctx.db.get("savedComponents", args.componentId);
    if (!component || component.ownerId !== ownerId) {
      throw new Error("Saved component not found");
    }
    const name = validateName(args.name);
    const updatedAt = Date.now();
    await ctx.db.patch("savedComponents", args.componentId, {
      ...name,
      updatedAt,
    });
    return { componentId: args.componentId, updatedAt };
  },
});

export const remove = mutation({
  args: { componentId: v.id("savedComponents") },
  returns: componentMutationResultValidator,
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const component = await ctx.db.get("savedComponents", args.componentId);
    if (!component || component.ownerId !== ownerId) {
      throw new Error("Saved component not found");
    }
    await ctx.db.delete("savedComponents", args.componentId);
    return { componentId: args.componentId };
  },
});
