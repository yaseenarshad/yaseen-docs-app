// @vitest-environment edge-runtime
/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import {
  MAX_SAVED_COMPONENT_BYTES,
  SAVED_COMPONENT_SCHEMA_VERSION,
} from "../packages/common/src/savedComponents";

import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("savedComponents schema", () => {
  it("stores independent account-scoped rows through the approved indexes", async () => {
    const t = convexTest(schema, modules);
    const result = await t.run(async (ctx) => {
      const ownerId = await ctx.db.insert("users", { name: "Owner" });
      const otherOwnerId = await ctx.db.insert("users", {
        name: "Other owner",
      });
      const elementsJson = JSON.stringify({
        type: "growprofit/saved-component",
        schemaVersion: SAVED_COMPONENT_SCHEMA_VERSION,
        elements: [],
      });
      const componentId = await ctx.db.insert("savedComponents", {
        ownerId,
        name: "Number badge",
        normalizedName: "number badge",
        elementsJson,
        elementCount: 0,
        schemaVersion: SAVED_COMPONENT_SCHEMA_VERSION,
        createdAt: 100,
        updatedAt: 200,
      });
      await ctx.db.insert("savedComponents", {
        ownerId: otherOwnerId,
        name: "Private",
        normalizedName: "private",
        elementsJson,
        elementCount: 0,
        schemaVersion: SAVED_COMPONENT_SCHEMA_VERSION,
        createdAt: 300,
        updatedAt: 400,
      });

      const ownerRows = await ctx.db
        .query("savedComponents")
        .withIndex("by_ownerId_and_updatedAt", (q) => q.eq("ownerId", ownerId))
        .order("desc")
        .take(10);
      const namedRows = await ctx.db
        .query("savedComponents")
        .withIndex("by_ownerId_and_normalizedName", (q) =>
          q.eq("ownerId", ownerId).eq("normalizedName", "number badge"),
        )
        .take(10);
      return { componentId, ownerRows, namedRows };
    });

    expect(result.ownerRows.map((row) => row._id)).toEqual([
      result.componentId,
    ]);
    expect(result.namedRows.map((row) => row._id)).toEqual([
      result.componentId,
    ]);
  });

  it("defines the shared payload boundary below the Convex document limit", () => {
    expect(MAX_SAVED_COMPONENT_BYTES).toBe(750_000);
    expect(MAX_SAVED_COMPONENT_BYTES).toBeLessThan(1_000_000);
  });
});
