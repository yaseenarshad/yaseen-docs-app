// @vitest-environment edge-runtime
/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import {
  MAX_SAVED_COMPONENT_BYTES,
  SAVED_COMPONENT_SCHEMA_VERSION,
} from "../packages/common/src/savedComponents";

import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const savedComponentsApi = api.savedComponents;

const payload = (
  elements: Array<Record<string, unknown>> = [
    { id: "shape-1", type: "rectangle" },
  ],
) =>
  JSON.stringify({
    type: "growprofit/saved-component",
    schemaVersion: SAVED_COMPONENT_SCHEMA_VERSION,
    elements,
  });

const createUser = async (t: ReturnType<typeof convexTest>, name: string) => {
  const userId = await t.run(async (ctx) => ctx.db.insert("users", { name }));
  return {
    userId,
    client: t.withIdentity({ subject: `${userId}|test-session` }),
  };
};

describe("saved components API", () => {
  it("creates, paginates, searches, renames, and removes owned components", async () => {
    const t = convexTest(schema, modules);
    const { client } = await createUser(t, "Owner");
    const first = await client.mutation(savedComponentsApi.create, {
      name: "  Number   badge  ",
      elementsJson: payload(),
      elementCount: 1,
      schemaVersion: SAVED_COMPONENT_SCHEMA_VERSION,
    });
    await client.mutation(savedComponentsApi.create, {
      name: "Flow card",
      elementsJson: payload([{ id: "text-1", type: "text" }]),
      elementCount: 1,
      schemaVersion: SAVED_COMPONENT_SCHEMA_VERSION,
    });

    const firstPage = await client.query(savedComponentsApi.list, {
      paginationOpts: { cursor: null, numItems: 1 },
    });
    expect(firstPage.page).toHaveLength(1);
    expect(firstPage.isDone).toBe(false);
    const secondPage = await client.query(savedComponentsApi.list, {
      paginationOpts: {
        cursor: firstPage.continueCursor,
        numItems: 1,
      },
    });
    expect(secondPage.page).toHaveLength(1);
    expect(secondPage.isDone).toBe(true);

    const results = await client.query(savedComponentsApi.search, {
      query: "number",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(results.page).toMatchObject([{ name: "Number badge" }]);

    const renamed = await client.mutation(savedComponentsApi.rename, {
      componentId: first.componentId,
      name: "Primary badge",
    });
    expect(renamed.componentId).toBe(first.componentId);
    const renamedResults = await client.query(savedComponentsApi.search, {
      query: "primary",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(renamedResults.page).toMatchObject([{ name: "Primary badge" }]);

    expect(
      await client.mutation(savedComponentsApi.remove, {
        componentId: first.componentId,
      }),
    ).toEqual({ componentId: first.componentId });
    const afterDelete = await client.query(savedComponentsApi.search, {
      query: "primary",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(afterDelete.page).toEqual([]);
  });

  it("uses the list path for blank search and allows duplicate names", async () => {
    const t = convexTest(schema, modules);
    const { client } = await createUser(t, "Owner");
    for (let index = 0; index < 2; index++) {
      await client.mutation(savedComponentsApi.create, {
        name: "Repeated",
        elementsJson: payload([{ id: `shape-${index}`, type: "ellipse" }]),
        elementCount: 1,
        schemaVersion: SAVED_COMPONENT_SCHEMA_VERSION,
      });
    }

    const results = await client.query(savedComponentsApi.search, {
      query: "   ",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(results.page).toHaveLength(2);
  });

  it("isolates list, search, rename, and remove by authenticated owner", async () => {
    const t = convexTest(schema, modules);
    const ownerA = await createUser(t, "Owner A");
    const ownerB = await createUser(t, "Owner B");
    const created = await ownerA.client.mutation(savedComponentsApi.create, {
      name: "Secret component",
      elementsJson: payload(),
      elementCount: 1,
      schemaVersion: SAVED_COMPONENT_SCHEMA_VERSION,
    });

    const listB = await ownerB.client.query(savedComponentsApi.list, {
      paginationOpts: { cursor: null, numItems: 10 },
    });
    const searchB = await ownerB.client.query(savedComponentsApi.search, {
      query: "secret",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(listB.page).toEqual([]);
    expect(searchB.page).toEqual([]);
    await expect(
      ownerB.client.mutation(savedComponentsApi.rename, {
        componentId: created.componentId,
        name: "Stolen",
      }),
    ).rejects.toThrow("Saved component not found");
    await expect(
      ownerB.client.mutation(savedComponentsApi.remove, {
        componentId: created.componentId,
      }),
    ).rejects.toThrow("Saved component not found");
  });

  it("rejects signed-out calls", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.query(savedComponentsApi.list, {
        paginationOpts: { cursor: null, numItems: 10 },
      }),
    ).rejects.toThrow("Authentication required");
    await expect(
      t.mutation(savedComponentsApi.create, {
        name: "No owner",
        elementsJson: payload(),
        elementCount: 1,
        schemaVersion: SAVED_COMPONENT_SCHEMA_VERSION,
      }),
    ).rejects.toThrow("Authentication required");
  });

  it.each([
    {
      label: "empty name",
      args: {
        name: "   ",
        elementsJson: payload(),
        elementCount: 1,
        schemaVersion: SAVED_COMPONENT_SCHEMA_VERSION,
      },
      message: "name is required",
    },
    {
      label: "malformed JSON",
      args: {
        name: "Broken",
        elementsJson: "{",
        elementCount: 1,
        schemaVersion: SAVED_COMPONENT_SCHEMA_VERSION,
      },
      message: "valid component JSON",
    },
    {
      label: "unsupported schema",
      args: {
        name: "Future",
        elementsJson: payload(),
        elementCount: 1,
        schemaVersion: 2,
      },
      message: "schema version",
    },
    {
      label: "empty elements",
      args: {
        name: "Empty",
        elementsJson: payload([]),
        elementCount: 0,
        schemaVersion: SAVED_COMPONENT_SCHEMA_VERSION,
      },
      message: "at least one element",
    },
    {
      label: "count mismatch",
      args: {
        name: "Mismatch",
        elementsJson: payload(),
        elementCount: 2,
        schemaVersion: SAVED_COMPONENT_SCHEMA_VERSION,
      },
      message: "element count",
    },
    {
      label: "unsupported element",
      args: {
        name: "Image",
        elementsJson: payload([{ id: "image-1", type: "image" }]),
        elementCount: 1,
        schemaVersion: SAVED_COMPONENT_SCHEMA_VERSION,
      },
      message: "image",
    },
  ])("rejects $label without writing a row", async ({ args, message }) => {
    const t = convexTest(schema, modules);
    const { client, userId } = await createUser(t, "Owner");

    await expect(
      client.mutation(savedComponentsApi.create, args),
    ).rejects.toThrow(message);
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("savedComponents")
        .withIndex("by_ownerId_and_updatedAt", (q) => q.eq("ownerId", userId))
        .take(10),
    );
    expect(rows).toEqual([]);
  });

  it("rejects oversized names and UTF-8 payloads", async () => {
    const t = convexTest(schema, modules);
    const { client } = await createUser(t, "Owner");
    await expect(
      client.mutation(savedComponentsApi.create, {
        name: "x".repeat(121),
        elementsJson: payload(),
        elementCount: 1,
        schemaVersion: SAVED_COMPONENT_SCHEMA_VERSION,
      }),
    ).rejects.toThrow("120");

    const oversizedJson = JSON.stringify({
      type: "growprofit/saved-component",
      schemaVersion: SAVED_COMPONENT_SCHEMA_VERSION,
      elements: [
        {
          id: "text-1",
          type: "text",
          text: "é".repeat(MAX_SAVED_COMPONENT_BYTES / 2),
        },
      ],
    });
    expect(new TextEncoder().encode(oversizedJson).byteLength).toBeGreaterThan(
      MAX_SAVED_COMPONENT_BYTES,
    );
    await expect(
      client.mutation(savedComponentsApi.create, {
        name: "Oversized",
        elementsJson: oversizedJson,
        elementCount: 1,
        schemaVersion: SAVED_COMPONENT_SCHEMA_VERSION,
      }),
    ).rejects.toThrow("750,000");
  });
});
