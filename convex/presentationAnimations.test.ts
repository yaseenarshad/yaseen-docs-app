// @vitest-environment edge-runtime
/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const SHA256 = "a".repeat(64);

const setup = async () => {
  const t = convexTest(schema, modules);
  const ownerId = await t.run(async (ctx) =>
    ctx.db.insert("users", { name: "Presentation owner" }),
  );
  const intruderId = await t.run(async (ctx) =>
    ctx.db.insert("users", { name: "Other user" }),
  );
  const owner = t.withIdentity({ subject: `${ownerId}|owner-session` });
  const intruder = t.withIdentity({ subject: `${intruderId}|other-session` });
  const board = await owner.mutation(api.boards.create, {
    title: "Animation board",
  });
  return { t, owner, intruder, board };
};

const manifest = (diagramId: string) => ({
  diagramId: diagramId as never,
  assetId: "lesson-animation",
  version: 1,
  sourceElementId: "animation-element-1",
  slideId: "slide-1",
  mimeType: "text/html",
  size: 2048,
  sha256: SHA256,
});

describe("trusted presentation animation upload grants", () => {
  it("creates a separate strict and idempotent owner-authorized grant", async () => {
    const { t, owner, board } = await setup();
    const first = await owner.mutation(
      api.presentationAnimations.createUploadGrant,
      manifest(board.boardId),
    );
    const repeated = await owner.mutation(
      api.presentationAnimations.createUploadGrant,
      manifest(board.boardId),
    );

    expect(first).toMatchObject({
      kind: "upload",
      assetId: "lesson-animation",
      version: 1,
    });
    expect(repeated).toEqual(first);
    if (first.kind !== "upload") {
      throw new Error("Expected upload grant");
    }
    const grant = await t.run(async (ctx) =>
      ctx.db
        .query("presentationAnimationUploadGrants")
        .withIndex("by_token", (q) => q.eq("token", first.token))
        .unique(),
    );
    expect(grant).toMatchObject({
      diagramId: board.boardId,
      ownerId: expect.any(String),
      objectKey: expect.stringContaining("/presentation-animations/"),
      mimeType: "text/html",
      size: 2048,
      sha256: SHA256,
    });
    await expect(
      t.query(internal.presentationAnimations.validateUploadGrant, {
        token: first.token,
      }),
    ).resolves.toMatchObject({
      objectKey: grant?.objectKey,
      mimeType: "text/html",
      size: 2048,
      sha256: SHA256,
    });

    await t.run(async (ctx) => {
      await ctx.db.patch("presentationAnimationUploadGrants", grant!._id, {
        expiresAt: Date.now() - 1,
      });
    });
    await expect(
      t.query(internal.presentationAnimations.validateUploadGrant, {
        token: first.token,
      }),
    ).resolves.toBeNull();
    const renewed = await owner.mutation(
      api.presentationAnimations.createUploadGrant,
      manifest(board.boardId),
    );
    expect(renewed).toMatchObject({ kind: "upload" });
    expect(renewed).not.toEqual(first);
  });

  it("registers, retries, replaces, removes, and cleans immutable versions", async () => {
    const { t, owner, board } = await setup();
    const firstGrant = await owner.mutation(
      api.presentationAnimations.createUploadGrant,
      manifest(board.boardId),
    );
    if (firstGrant.kind !== "upload") {
      throw new Error("Expected upload grant");
    }
    const first = await owner.mutation(
      api.presentationAnimations.registerUpload,
      { token: firstGrant.token, etag: "etag-v1" },
    );
    await expect(
      owner.mutation(api.presentationAnimations.registerUpload, {
        token: firstGrant.token,
        etag: "etag-v1",
      }),
    ).resolves.toEqual(first);

    const secondGrant = await owner.mutation(
      api.presentationAnimations.createUploadGrant,
      {
        ...manifest(board.boardId),
        version: 2,
        replacementForVersion: 1,
        sha256: "b".repeat(64),
      },
    );
    if (secondGrant.kind !== "upload") {
      throw new Error("Expected replacement upload grant");
    }
    const second = await owner.mutation(
      api.presentationAnimations.registerUpload,
      { token: secondGrant.token, etag: "etag-v2" },
    );
    expect(second).toMatchObject({
      assetId: "lesson-animation",
      version: 2,
      etag: "etag-v2",
      sha256: "b".repeat(64),
    });
    const versions = await t.run(async (ctx) =>
      ctx.db
        .query("presentationAnimationAssets")
        .withIndex("by_diagramId", (q) => q.eq("diagramId", board.boardId))
        .collect(),
    );
    expect(versions.map(({ version }) => version).sort()).toEqual([1, 2]);

    const removed = await owner.mutation(
      api.presentationAnimations.removeVersion,
      { diagramId: board.boardId, assetId: "lesson-animation", version: 1 },
    );
    expect(removed.deleteToken).not.toBeNull();
    const cleanup = await t.mutation(internal.assets.consumeDeleteGrant, {
      token: removed.deleteToken!,
    });
    expect(cleanup?.objectKeys).toHaveLength(1);

    const deleted = await owner.mutation(api.boards.remove, {
      boardId: board.boardId,
    });
    const boardCleanup = await t.mutation(internal.assets.consumeDeleteGrant, {
      token: deleted.assetDeleteToken!,
    });
    expect(boardCleanup?.objectKeys).toEqual(
      expect.arrayContaining([
        expect.stringContaining("/presentation-animations/"),
      ]),
    );
    const remaining = await t.run(async (ctx) =>
      ctx.db
        .query("presentationAnimationAssets")
        .withIndex("by_diagramId", (q) => q.eq("diagramId", board.boardId))
        .collect(),
    );
    expect(remaining).toEqual([]);
  });

  it("cleans abandoned uploads and rejects normal image grants", async () => {
    const { t, owner, board } = await setup();
    const imageGrant = await owner.mutation(api.boardAssets.createUploadGrant, {
      boardId: board.boardId,
      fileId: "image-only",
      mimeType: "image/png",
      size: 128,
    });
    await expect(
      owner.mutation(api.presentationAnimations.registerUpload, {
        token: imageGrant.token,
        etag: "wrong-purpose",
      }),
    ).rejects.toThrow("Animation upload grant expired");

    const animationGrant = await owner.mutation(
      api.presentationAnimations.createUploadGrant,
      manifest(board.boardId),
    );
    if (animationGrant.kind !== "upload") {
      throw new Error("Expected upload grant");
    }
    const abandoned = await owner.mutation(
      api.presentationAnimations.abandonUpload,
      { token: animationGrant.token },
    );
    const cleanup = await t.mutation(internal.assets.consumeDeleteGrant, {
      token: abandoned.deleteToken!,
    });
    expect(cleanup?.objectKeys).toEqual([
      expect.stringContaining("/presentation-animations/"),
    ]);
    await expect(
      t.query(internal.presentationAnimations.validateUploadGrant, {
        token: animationGrant.token,
      }),
    ).resolves.toBeNull();
  });

  it("rejects cross-board, image-grant, invalid type, size, and checksum paths", async () => {
    const { owner, intruder, board } = await setup();

    await expect(
      intruder.mutation(
        api.presentationAnimations.createUploadGrant,
        manifest(board.boardId),
      ),
    ).rejects.toThrow("Board not found");
    await expect(
      owner.mutation(api.presentationAnimations.createUploadGrant, {
        ...manifest(board.boardId),
        mimeType: "image/svg+xml",
      }),
    ).rejects.toThrow("must be text/html");
    await expect(
      owner.mutation(api.presentationAnimations.createUploadGrant, {
        ...manifest(board.boardId),
        size: 10 * 1024 * 1024 + 1,
      }),
    ).rejects.toThrow("no larger than 10 MB");
    await expect(
      owner.mutation(api.presentationAnimations.createUploadGrant, {
        ...manifest(board.boardId),
        sha256: "not-a-checksum",
      }),
    ).rejects.toThrow("SHA-256");

    const animationGrant = await owner.mutation(
      api.presentationAnimations.createUploadGrant,
      manifest(board.boardId),
    );
    if (animationGrant.kind !== "upload") {
      throw new Error("Expected upload grant");
    }
    await expect(
      owner.mutation(api.boardAssets.registerUpload, {
        token: animationGrant.token,
        etag: "wrong-route",
      }),
    ).rejects.toThrow("Upload grant expired");
  });
});

describe("controlled presentation animation read grants", () => {
  const registerAsset = async (
    owner: Awaited<ReturnType<typeof setup>>["owner"],
    boardId: string,
  ) => {
    const upload = await owner.mutation(
      api.presentationAnimations.createUploadGrant,
      manifest(boardId),
    );
    if (upload.kind !== "upload") {
      throw new Error("Expected upload grant");
    }
    return await owner.mutation(api.presentationAnimations.registerUpload, {
      token: upload.token,
      etag: "read-etag",
    });
  };

  it("issues exact owner and viewer capabilities without exposing object keys", async () => {
    const { t, owner, intruder, board } = await setup();
    await registerAsset(owner, board.boardId);
    const owned = await owner.mutation(
      api.presentationAnimations.createReadGrant,
      {
        diagramId: board.boardId,
        assetId: "lesson-animation",
        version: 1,
      },
    );
    expect(owned).toMatchObject({
      path: `/api/presentation-animations/${owned.token}`,
      assetId: "lesson-animation",
      version: 1,
      etag: "read-etag",
    });
    expect(JSON.stringify(owned)).not.toContain("objectKey");
    await expect(
      t.query(internal.presentationAnimations.validateReadGrant, {
        token: owned.token,
      }),
    ).resolves.toMatchObject({
      objectKey: expect.stringContaining("/presentation-animations/"),
      sha256: SHA256,
      etag: "read-etag",
    });
    await expect(
      intruder.mutation(api.presentationAnimations.createReadGrant, {
        diagramId: board.boardId,
        assetId: "lesson-animation",
        version: 1,
      }),
    ).rejects.toThrow("Board not found");

    const sharing = await owner.mutation(api.boards.setSharing, {
      boardId: board.boardId,
      enabled: true,
    });
    const shared = await t.mutation(
      api.presentationAnimations.createReadGrant,
      {
        shareToken: sharing.shareToken!,
        assetId: "lesson-animation",
        version: 1,
      },
    );
    await expect(
      t.query(internal.presentationAnimations.validateReadGrant, {
        token: shared.token,
      }),
    ).resolves.toMatchObject({ etag: "read-etag" });

    await owner.mutation(api.boards.setSharing, {
      boardId: board.boardId,
      enabled: false,
    });
    await expect(
      t.query(internal.presentationAnimations.validateReadGrant, {
        token: shared.token,
      }),
    ).resolves.toBeNull();
  });

  it("invalidates expired, deleted, guessed, and cross-board capabilities", async () => {
    const { t, owner, board } = await setup();
    await registerAsset(owner, board.boardId);
    const other = await owner.mutation(api.boards.create, {
      title: "Other board",
    });
    await expect(
      owner.mutation(api.presentationAnimations.createReadGrant, {
        diagramId: other.boardId,
        assetId: "lesson-animation",
        version: 1,
      }),
    ).rejects.toThrow("Presentation animation not found");
    await expect(
      t.query(internal.presentationAnimations.validateReadGrant, {
        token: "a".repeat(64),
      }),
    ).resolves.toBeNull();

    const expired = await owner.mutation(
      api.presentationAnimations.createReadGrant,
      {
        diagramId: board.boardId,
        assetId: "lesson-animation",
        version: 1,
      },
    );
    await t.run(async (ctx) => {
      const grant = await ctx.db
        .query("presentationAnimationReadGrants")
        .withIndex("by_token", (q) => q.eq("token", expired.token))
        .unique();
      await ctx.db.patch("presentationAnimationReadGrants", grant!._id, {
        expiresAt: Date.now() - 1,
      });
    });
    await expect(
      t.query(internal.presentationAnimations.validateReadGrant, {
        token: expired.token,
      }),
    ).resolves.toBeNull();

    const deleted = await owner.mutation(
      api.presentationAnimations.createReadGrant,
      {
        diagramId: board.boardId,
        assetId: "lesson-animation",
        version: 1,
      },
    );
    await owner.mutation(api.presentationAnimations.removeVersion, {
      diagramId: board.boardId,
      assetId: "lesson-animation",
      version: 1,
    });
    await expect(
      t.query(internal.presentationAnimations.validateReadGrant, {
        token: deleted.token,
      }),
    ).resolves.toBeNull();
  });
});
