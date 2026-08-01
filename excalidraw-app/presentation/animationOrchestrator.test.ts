import { describe, expect, it, vi } from "vitest";

import {
  AnimationOrchestrator,
  type AnimationRuntimeAdapter,
  type AnimationRuntimeDescriptor,
} from "./animationOrchestrator";

import type { PresentationFrameLifecycleDetail } from "./events";

const runtimes: AnimationRuntimeDescriptor[] = [
  {
    presentationId: "deck",
    frameId: "frame-2",
    elementId: "animation-2",
  },
  {
    presentationId: "deck",
    frameId: "frame-3",
    elementId: "animation-3",
  },
  {
    presentationId: "deck",
    frameId: "frame-9",
    elementId: "animation-9",
  },
];

const frameOrder = Array.from(
  { length: 10 },
  (_, index) => `frame-${index + 1}`,
);

const event = (
  phase: PresentationFrameLifecycleDetail["phase"],
  frameId: string | null,
  sessionId = "session-1",
): PresentationFrameLifecycleDetail => ({
  phase,
  frameId,
  sessionId,
  order: frameId ? frameOrder.indexOf(frameId) + 1 : null,
  slideCount: frameOrder.length,
  reason: phase,
});

const createAdapter = () => {
  const commands: Array<{ elementId: string; command: string }> = [];
  const adapter: AnimationRuntimeAdapter = {
    setPolicy: vi.fn(),
    send: vi.fn(async (runtime, command) => {
      commands.push({ elementId: runtime.elementId, command: command.command });
      return true;
    }),
  };
  return { adapter, commands };
};

describe("AnimationOrchestrator", () => {
  it("loads active and immediate adjacent animations, then seeks and plays only active", async () => {
    const { adapter, commands } = createAdapter();
    const orchestrator = new AnimationOrchestrator({
      adapter,
      getRuntimes: () => runtimes,
      getFrameOrder: () => frameOrder,
    });

    await orchestrator.handle(event("transitioning", "frame-2"));
    await orchestrator.handle(event("active", "frame-2"));

    expect(adapter.setPolicy).toHaveBeenCalledWith({
      sessionId: "session-1",
      activeFrameId: "frame-2",
      preloadFrameIds: ["frame-3"],
    });
    expect(commands).toEqual([
      { elementId: "animation-2", command: "load" },
      { elementId: "animation-3", command: "load" },
      { elementId: "animation-2", command: "seek" },
      { elementId: "animation-2", command: "play" },
    ]);
  });

  it("pauses immediately and supersedes a slow stale activation", async () => {
    let resolveFirstLoad: ((value: boolean) => void) | null = null;
    const commands: Array<{ elementId: string; command: string }> = [];
    const adapter: AnimationRuntimeAdapter = {
      setPolicy: vi.fn(),
      send: vi.fn((runtime, command) => {
        commands.push({
          elementId: runtime.elementId,
          command: command.command,
        });
        if (runtime.elementId === "animation-2" && command.command === "load") {
          return new Promise<boolean>((resolve) => {
            resolveFirstLoad = resolve;
          });
        }
        return Promise.resolve(true);
      }),
    };
    const orchestrator = new AnimationOrchestrator({
      adapter,
      getRuntimes: () => runtimes,
      getFrameOrder: () => frameOrder,
    });

    await orchestrator.handle(event("transitioning", "frame-2"));
    const staleActivation = orchestrator.handle(event("active", "frame-2"));
    await orchestrator.handle(event("transitioning", "frame-3"));
    await orchestrator.handle(event("active", "frame-3"));
    expect(resolveFirstLoad).not.toBeNull();
    (resolveFirstLoad as unknown as (value: boolean) => void)(true);
    await staleActivation;

    expect(commands).not.toContainEqual({
      elementId: "animation-2",
      command: "play",
    });
    expect(commands).toContainEqual({
      elementId: "animation-3",
      command: "play",
    });
  });

  it("restarts on return and releases every managed runtime on exit", async () => {
    const { adapter, commands } = createAdapter();
    const orchestrator = new AnimationOrchestrator({
      adapter,
      getRuntimes: () => runtimes,
      getFrameOrder: () => frameOrder,
    });

    for (const frameId of ["frame-2", "frame-3", "frame-2"]) {
      await orchestrator.handle(event("transitioning", frameId));
      await orchestrator.handle(event("active", frameId));
    }
    await orchestrator.handle(event("ended", null));

    expect(
      commands.filter(
        ({ elementId, command }) =>
          elementId === "animation-2" && command === "seek",
      ),
    ).toHaveLength(2);
    expect(
      commands.filter(
        ({ elementId, command }) =>
          elementId === "animation-2" && command === "play",
      ),
    ).toHaveLength(2);
    expect(commands.filter(({ command }) => command === "unload")).toEqual(
      expect.arrayContaining(
        runtimes.map(({ elementId }) => ({ elementId, command: "unload" })),
      ),
    );
    expect(adapter.setPolicy).toHaveBeenLastCalledWith(null);
  });

  it("does not block navigation or play when a runtime fails to load", async () => {
    const { adapter, commands } = createAdapter();
    vi.mocked(adapter.send).mockImplementation(
      async (_runtime, command) => command.command !== "load",
    );
    const orchestrator = new AnimationOrchestrator({
      adapter,
      getRuntimes: () => runtimes,
      getFrameOrder: () => frameOrder,
    });

    await expect(
      orchestrator.handle(event("transitioning", "frame-9")),
    ).resolves.toBeUndefined();
    await expect(
      orchestrator.handle(event("active", "frame-9")),
    ).resolves.toBeUndefined();
    expect(commands).not.toContainEqual({
      elementId: "animation-9",
      command: "play",
    });
  });

  it("retries only the current failed runtime with a fresh deterministic restart", async () => {
    const { adapter, commands } = createAdapter();
    let loadSucceeds = false;
    vi.mocked(adapter.send).mockImplementation(async (runtime, command) => {
      commands.push({ elementId: runtime.elementId, command: command.command });
      return command.command === "load" ? loadSucceeds : true;
    });
    const orchestrator = new AnimationOrchestrator({
      adapter,
      getRuntimes: () => runtimes,
      getFrameOrder: () => frameOrder,
    });

    await orchestrator.handle(event("transitioning", "frame-9"));
    await orchestrator.handle(event("active", "frame-9"));
    loadSucceeds = true;
    await orchestrator.retryActive();

    expect(commands.slice(-3)).toEqual([
      { elementId: "animation-9", command: "load" },
      { elementId: "animation-9", command: "seek" },
      { elementId: "animation-9", command: "play" },
    ]);
  });
});
