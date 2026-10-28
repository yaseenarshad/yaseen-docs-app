import { describe, expect, it, vi } from "vitest";

import { deleteBoardAndCleanup } from "./boardDeletion";

const startedRoute = { identity: "owner:deleted", generation: 3 };

describe("active Board deletion", () => {
  it("navigates to a surviving Board before cleaning up R2 assets", async () => {
    const calls: string[] = [];

    await deleteBoardAndCleanup({
      boardId: "board-id",
      destination: { kind: "owner", slug: "fallback" },
      isActive: true,
      startedRoute,
      getCurrentRoute: () => startedRoute,
      removeBoard: async () => {
        calls.push("remove");
        return { assetDeleteToken: "delete-token" };
      },
      navigate: (destination) => {
        calls.push(
          destination.kind === "owner"
            ? `navigate:owner:${destination.slug}`
            : "navigate:home",
        );
      },
      cleanupAssets: async () => {
        calls.push("cleanup");
      },
      onCleanupError: vi.fn(),
    });

    expect(calls).toEqual(["remove", "navigate:owner:fallback", "cleanup"]);
  });

  it("navigates home after deleting the last Board", async () => {
    const navigate = vi.fn();

    await deleteBoardAndCleanup({
      boardId: "board-id",
      destination: { kind: "home" },
      isActive: true,
      startedRoute,
      getCurrentRoute: () => startedRoute,
      removeBoard: async () => ({ assetDeleteToken: null }),
      navigate,
      cleanupAssets: vi.fn(),
      onCleanupError: vi.fn(),
    });

    expect(navigate).toHaveBeenCalledWith({ kind: "home" });
  });

  it("does not hijack a newer route or navigate when deleting a background Board", async () => {
    const navigate = vi.fn();
    const removeBoard = vi.fn(async () => ({ assetDeleteToken: null }));
    const shared = {
      boardId: "board-id",
      destination: { kind: "owner", slug: "fallback" } as const,
      startedRoute,
      removeBoard,
      navigate,
      cleanupAssets: vi.fn(),
      onCleanupError: vi.fn(),
    };

    await deleteBoardAndCleanup({
      ...shared,
      isActive: true,
      getCurrentRoute: () => ({
        identity: "owner:newer",
        generation: 4,
      }),
    });
    await deleteBoardAndCleanup({
      ...shared,
      isActive: false,
      getCurrentRoute: () => startedRoute,
    });

    expect(navigate).not.toHaveBeenCalled();
    expect(removeBoard).toHaveBeenCalledTimes(2);
  });

  it("sweeps the Board's stored scene objects alongside its images", async () => {
    const cleanupAssets = vi.fn();
    const cleanupScenes = vi.fn();

    await deleteBoardAndCleanup({
      boardId: "board-id",
      destination: { kind: "home" },
      isActive: true,
      startedRoute,
      getCurrentRoute: () => startedRoute,
      removeBoard: async () => ({
        assetDeleteToken: "asset-token",
        sceneDeleteToken: "scene-token",
      }),
      navigate: vi.fn(),
      cleanupAssets,
      cleanupScenes,
      onCleanupError: vi.fn(),
    });

    expect(cleanupAssets).toHaveBeenCalledWith("asset-token");
    expect(cleanupScenes).toHaveBeenCalledWith("scene-token");
  });

  it("still sweeps stored scenes when the image sweep fails", async () => {
    const cleanupScenes = vi.fn();
    const onCleanupError = vi.fn();

    await deleteBoardAndCleanup({
      boardId: "board-id",
      destination: { kind: "home" },
      isActive: true,
      startedRoute,
      getCurrentRoute: () => startedRoute,
      removeBoard: async () => ({
        assetDeleteToken: "asset-token",
        sceneDeleteToken: "scene-token",
      }),
      navigate: vi.fn(),
      cleanupAssets: async () => {
        throw new Error("R2 unavailable");
      },
      cleanupScenes,
      onCleanupError,
    });

    expect(cleanupScenes).toHaveBeenCalledWith("scene-token");
    expect(onCleanupError).toHaveBeenCalledOnce();
  });

  it("reports an R2 cleanup failure after leaving the deleted route", async () => {
    const navigate = vi.fn();
    const onCleanupError = vi.fn();

    await deleteBoardAndCleanup({
      boardId: "board-id",
      destination: { kind: "home" },
      isActive: true,
      startedRoute,
      getCurrentRoute: () => startedRoute,
      removeBoard: async () => ({ assetDeleteToken: "delete-token" }),
      navigate,
      cleanupAssets: async () => {
        throw new Error("R2 unavailable");
      },
      onCleanupError,
    });

    expect(navigate).toHaveBeenCalledBefore(onCleanupError);
    expect(onCleanupError).toHaveBeenCalledOnce();
  });
});
