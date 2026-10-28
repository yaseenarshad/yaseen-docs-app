// @vitest-environment edge-runtime
/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";

import { api, internal } from "./_generated/api";
import { CLOUD_SAVE_PROTOCOL_VERSION } from "./cloudSaveProtocol";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const setup = async () => {
  const t = convexTest(schema, modules);
  const ownerId = await t.run((ctx) =>
    ctx.db.insert("users", { name: "Owner" }),
  );
  const owner = t.withIdentity({ subject: `${ownerId}|session` });
  const board = await owner.mutation(api.boards.create, {
    title: "Direct upload",
  });
  const grant = await owner.mutation(api.boardScenes.createUploadGrant, {
    boardId: board.boardId,
    clientSaveProtocol: CLOUD_SAVE_PROTOCOL_VERSION,
    purpose: "migration",
    expectedVersion: 0,
    encoding: "deflate-v1",
    rawSize: 100,
    compressedSize: 50,
    rawSha256: "a".repeat(64),
    compressedSha256: "b".repeat(64),
    semanticSha256: "c".repeat(64),
  });
  if (grant.status !== "upload") {
    throw new Error("Expected upload grant");
  }
  return { t, owner, board, grant };
};

describe("verified direct upload coordination", () => {
  it("retains failed cleanup with only one retry scheduled by each expiry pass", async () => {
    vi.useFakeTimers();
    vi.stubEnv("BOARD_SCENE_R2_ENDPOINT", undefined);
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    try {
      const { t } = await setup();
      const grantId = await t.run(async (ctx) => {
        const row = (await ctx.db.query("boardSceneUploadGrants").first())!;
        await ctx.db.patch("boardSceneUploadGrants", row._id, {
          createdAt: Date.now() - 30 * 60 * 1000,
          expiresAt: Date.now() - 1,
        });
        return row._id;
      });
      const scheduledCount = () =>
        t.run(
          async (ctx) =>
            (await ctx.db.system.query("_scheduled_functions").take(20)).length,
        );
      expect(await scheduledCount()).toBe(0);
      for (let pass = 1; pass <= 3; pass++) {
        await t.mutation(internal.boardSceneCleanup.pruneExpiredGrants, {});
        expect(await scheduledCount()).toBe(pass);
        await t.action(internal.boardSceneUploads.cleanup, { grantId });
        expect(await scheduledCount()).toBe(pass);
        expect(
          await t.run((ctx) => ctx.db.get("boardSceneUploadGrants", grantId)),
        ).toMatchObject({ abandonedAt: expect.any(Number) });
        vi.setSystemTime(Date.now() + 60 * 60 * 1000 + 1);
      }
      expect(warning).toHaveBeenCalledTimes(3);
    } finally {
      warning.mockRestore();
      vi.unstubAllEnvs();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it("defers cleanup until an expired in-flight finalizer has drained", async () => {
    const { t, owner, grant } = await setup();
    await owner.mutation(internal.boardSceneFinalization.claim, {
      token: grant.token,
    });
    const grantId = await t.run(async (ctx) => {
      const row = (await ctx.db.query("boardSceneUploadGrants").first())!;
      await ctx.db.patch("boardSceneUploadGrants", row._id, {
        expiresAt: Date.now() - 1,
      });
      return row._id;
    });
    await t.mutation(internal.boardSceneCleanup.pruneExpiredGrants, {});
    const result = await t.mutation(
      internal.boardSceneFinalization.beginCleanup,
      { grantId },
    );
    expect(result?.waitUntil).toBeGreaterThan(Date.now());
    expect(
      await t.run((ctx) => ctx.db.get("boardSceneUploadGrants", grantId)),
    ).toMatchObject({ abandonedAt: expect.any(Number) });
  });

  it("expires a registered receipt without deleting the saved scene", async () => {
    const { t, owner, grant } = await setup();
    const claim = await owner.mutation(internal.boardSceneFinalization.claim, {
      token: grant.token,
    });
    if (claim.status !== "claimed") {
      throw new Error("Expected claim");
    }
    await owner.mutation(internal.boardSceneFinalization.commit, {
      token: grant.token,
      claimId: claim.claimId,
      etag: "verified",
    });
    const grantId = await t.run(
      async (ctx) =>
        (await ctx.db.query("boardSceneUploadGrants").first())!._id,
    );
    expect(
      await t.mutation(internal.boardSceneFinalization.beginCleanup, {
        grantId,
      }),
    ).toBeNull();
    expect(
      await t.run((ctx) => ctx.db.query("diagramSceneManifests").first()),
    ).toMatchObject({ etag: "verified" });
  });
  it("retires a public caller-supplied ETag even for an authenticated current client", async () => {
    const { owner, grant, t } = await setup();
    await expect(
      owner.mutation(api.boardScenes.commitUpload, {
        clientSaveProtocol: CLOUD_SAVE_PROTOCOL_VERSION,
        token: grant.token,
        etag: "invented",
      }),
    ).resolves.toEqual({ status: "upgrade-required" });
    expect(
      await t.run((ctx) => ctx.db.query("diagramSceneManifests").first()),
    ).toBeNull();
  });

  it("separates staging from final keys and refuses the legacy Worker capability", async () => {
    const { owner, grant, t } = await setup();
    const upload = await owner.mutation(
      internal.boardSceneFinalization.prepare,
      { token: grant.token },
    );
    expect(upload.stagingObjectKey).toMatch(/^board-scene-uploads\//);
    expect(upload.objectKey).toMatch(/^board-scenes\//);
    expect(
      await t.mutation(internal.boardScenes.resolveUploadGrant, {
        token: grant.token,
      }),
    ).toBeNull();
  });

  it("requires ownership and reserves a grant once", async () => {
    const { owner, grant, t } = await setup();
    await expect(
      t.mutation(internal.boardSceneFinalization.claim, { token: grant.token }),
    ).rejects.toThrow("Authentication required");
    const first = await owner.mutation(internal.boardSceneFinalization.claim, {
      token: grant.token,
    });
    expect(first.status).toBe("claimed");
    await expect(
      owner.mutation(internal.boardSceneFinalization.claim, {
        token: grant.token,
      }),
    ).rejects.toThrow("already being finalized");
  });

  it("rejects an unfenced internal commit, and returns the original receipt on a committed retry", async () => {
    const { owner, grant } = await setup();
    const claim = await owner.mutation(internal.boardSceneFinalization.claim, {
      token: grant.token,
    });
    if (claim.status !== "claimed") {
      throw new Error("Expected claim");
    }
    await expect(
      owner.mutation(internal.boardSceneFinalization.commit, {
        token: grant.token,
        claimId: "wrong",
        etag: "verified",
      }),
    ).rejects.toThrow("finalization");
    const result = await owner.mutation(
      internal.boardSceneFinalization.commit,
      {
        token: grant.token,
        claimId: claim.claimId,
        etag: "verified",
      },
    );
    expect(result.status).toBe("committed");
    expect(
      await owner.mutation(internal.boardSceneFinalization.claim, {
        token: grant.token,
      }),
    ).toEqual({ status: "finished", result });
  });

  it("keeps an abandoned in-flight grant for cleanup and cannot commit it", async () => {
    const { owner, grant, t } = await setup();
    const claim = await owner.mutation(internal.boardSceneFinalization.claim, {
      token: grant.token,
    });
    if (claim.status !== "claimed") {
      throw new Error("Expected claim");
    }
    expect(
      await owner.mutation(api.boardScenes.abandonUpload, {
        token: grant.token,
      }),
    ).toEqual({ cleanupToken: null });
    const stored = await t.run((ctx) =>
      ctx.db.query("boardSceneUploadGrants").first(),
    );
    expect(stored?.abandonedAt).toBeTypeOf("number");
    await expect(
      owner.mutation(internal.boardSceneFinalization.commit, {
        token: grant.token,
        claimId: claim.claimId,
        etag: "verified",
      }),
    ).rejects.toThrow("finalization");
    expect(
      await t.run((ctx) => ctx.db.query("diagramSceneManifests").first()),
    ).toBeNull();
  });
});
