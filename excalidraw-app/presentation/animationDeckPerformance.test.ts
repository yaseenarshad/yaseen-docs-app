import { describe, expect, it, vi } from "vitest";

import {
  AnimationOrchestrator,
  type AnimationRuntimeAdapter,
  type AnimationRuntimeDescriptor,
  type AnimationRuntimePolicy,
} from "./animationOrchestrator";

import type { PresentationFrameLifecycleDetail } from "./events";

const frameOrder = Array.from(
  { length: 17 },
  (_, index) => `frame-${index + 1}`,
);
const animationFrameNumbers = [2, 5, 8, 11, 14, 17];
let runtimes: AnimationRuntimeDescriptor[] = animationFrameNumbers.map(
  (number) => ({
    presentationId: "mixed-deck",
    frameId: `frame-${number}`,
    elementId: `animation-${number}`,
  }),
);

const lifecycle = (
  phase: PresentationFrameLifecycleDetail["phase"],
  frameId: string | null,
): PresentationFrameLifecycleDetail => ({
  phase,
  frameId,
  sessionId: "performance-session",
  order: frameId ? frameOrder.indexOf(frameId) + 1 : null,
  slideCount: frameOrder.length,
  reason: "performance-proof",
});

describe("mixed animation deck performance", () => {
  it("keeps mounts and playback bounded through forward, backward, rapid, failure, deletion, and exit flows", async () => {
    const mountedCounts: number[] = [];
    const playing = new Set<string>();
    const playingCounts: number[] = [];
    const seeksByElement = new Map<string, number[]>();
    const policies: Array<AnimationRuntimePolicy | null> = [];
    const adapter: AnimationRuntimeAdapter = {
      setPolicy: vi.fn((policy) => {
        policies.push(policy);
        if (!policy) {
          mountedCounts.push(0);
          return;
        }
        mountedCounts.push(
          runtimes.filter(
            ({ frameId }) =>
              frameId === policy.activeFrameId ||
              policy.preloadFrameIds.includes(frameId),
          ).length,
        );
      }),
      send: vi.fn(async (runtime, command) => {
        if (command.command === "play") {
          playing.add(runtime.elementId);
        } else if (
          command.command === "pause" ||
          command.command === "unload"
        ) {
          playing.delete(runtime.elementId);
        } else if (command.command === "seek") {
          const seeks = seeksByElement.get(runtime.elementId) ?? [];
          seeks.push(command.time);
          seeksByElement.set(runtime.elementId, seeks);
        }
        playingCounts.push(playing.size);
        // Simulate a protocol/load failure on slide 11. Camera navigation must
        // still resolve and every other runtime remains usable.
        return !(
          runtime.elementId === "animation-11" && command.command === "load"
        );
      }),
    };
    const orchestrator = new AnimationOrchestrator({
      adapter,
      getRuntimes: () => runtimes,
      getFrameOrder: () => frameOrder,
    });
    const visit = async (frameId: string) => {
      await orchestrator.handle(lifecycle("transitioning", frameId));
      await orchestrator.handle(lifecycle("active", frameId));
    };

    for (const frameId of frameOrder) {
      await visit(frameId);
    }
    for (const frameId of ["frame-17", "frame-8", "frame-2", "frame-14"]) {
      await visit(frameId);
    }

    // A frame can disappear while the player is open. The next lifecycle
    // event must normalize around the remaining runtime set without throwing.
    runtimes = runtimes.filter(({ frameId }) => frameId !== "frame-14");
    await expect(visit("frame-15")).resolves.toBeUndefined();
    await expect(
      orchestrator.handle(lifecycle("ended", null)),
    ).resolves.toBeUndefined();

    expect(Math.max(...mountedCounts)).toBeLessThanOrEqual(3);
    expect(Math.max(...playingCounts)).toBeLessThanOrEqual(1);
    expect(seeksByElement.get("animation-2")).toEqual([0, 0]);
    expect(seeksByElement.get("animation-8")).toEqual([0, 0]);
    expect(seeksByElement.has("animation-11")).toBe(false);
    expect(playing).toEqual(new Set());
    expect(policies.at(-1)).toBeNull();
  });
});
