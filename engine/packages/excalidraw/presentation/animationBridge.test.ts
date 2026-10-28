import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ANIMATION_PROTOCOL_VERSION,
  createAnimationCommand,
} from "./animationProtocol";
import {
  ANIMATION_BRIDGE_MARKER,
  animationBridgeBootstrap,
  wrapAnimationHtmlWithLifecycleBridge,
} from "./animationBridge";

const identity = {
  presentationId: "foundations",
  sessionId: "session-1",
  frameId: "frame-2",
  elementId: "animation-2",
};

describe("animation iframe lifecycle bridge", () => {
  const cleanup: Array<() => void> = [];

  afterEach(() => {
    cleanup.splice(0).forEach((dispose) => dispose());
    delete (window as typeof window & { __timelines?: unknown }).__timelines;
    vi.restoreAllMocks();
  });

  it("drives the registered timeline with deterministic load, seek, and play", () => {
    let time = 0;
    const timeline = {
      pause: vi.fn(),
      play: vi.fn(),
      time: vi.fn((next?: number) => {
        if (next !== undefined) {
          time = next;
          return timeline;
        }
        return time;
      }),
    };
    (window as typeof window & { __timelines?: unknown }).__timelines = {
      demo: timeline,
    };
    const postMessage = vi
      .spyOn(window.parent, "postMessage")
      .mockImplementation(() => undefined);
    cleanup.push(animationBridgeBootstrap());

    const send = (command: ReturnType<typeof createAnimationCommand>) =>
      window.dispatchEvent(
        new MessageEvent("message", {
          data: command,
          origin: "https://draw.yaseendraw.test",
          source: window.parent,
        }),
      );

    send(
      createAnimationCommand({
        ...identity,
        requestId: "load-1",
        command: "load",
      }),
    );
    send(
      createAnimationCommand({
        ...identity,
        requestId: "seek-1",
        command: "seek",
        time: 2.5,
      }),
    );
    send(
      createAnimationCommand({
        ...identity,
        requestId: "play-1",
        command: "play",
      }),
    );

    expect(timeline.pause).toHaveBeenCalledTimes(3);
    expect(timeline.time).toHaveBeenCalledWith(0);
    expect(timeline.time).toHaveBeenCalledWith(2.5);
    expect(timeline.play).toHaveBeenCalledTimes(1);
    expect(
      postMessage.mock.calls.map(
        ([response]) => (response as { event: string }).event,
      ),
    ).toEqual(["ready", "state", "state"]);
    expect(postMessage.mock.calls.at(-1)?.[0]).toMatchObject({
      requestId: "play-1",
      state: "playing",
      version: ANIMATION_PROTOCOL_VERSION,
    });
  });

  it("is idempotent for repeated request IDs and fails unknown versions safely", () => {
    const timeline = {
      pause: vi.fn(),
      play: vi.fn(),
      time: vi.fn(() => 0),
    };
    (window as typeof window & { __timelines?: unknown }).__timelines = {
      demo: timeline,
    };
    const postMessage = vi
      .spyOn(window.parent, "postMessage")
      .mockImplementation(() => undefined);
    cleanup.push(animationBridgeBootstrap());
    const play = createAnimationCommand({
      ...identity,
      requestId: "play-repeat",
      command: "play",
    });

    for (const data of [play, play, { ...play, version: 99 }]) {
      window.dispatchEvent(
        new MessageEvent("message", {
          data,
          origin: "https://draw.yaseendraw.test",
          source: window.parent,
        }),
      );
    }

    expect(timeline.play).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledTimes(3);
    expect(postMessage.mock.calls.at(-1)?.[0]).toMatchObject({
      event: "unsupported-version",
      supportedVersions: [ANIMATION_PROTOCOL_VERSION],
    });
  });

  it("ignores messages that do not come from the parent window", () => {
    const timeline = {
      pause: vi.fn(),
      play: vi.fn(),
      time: vi.fn(() => 0),
    };
    (window as typeof window & { __timelines?: unknown }).__timelines = {
      demo: timeline,
    };
    const postMessage = vi
      .spyOn(window.parent, "postMessage")
      .mockImplementation(() => undefined);
    cleanup.push(animationBridgeBootstrap());

    window.dispatchEvent(
      new MessageEvent("message", {
        data: createAnimationCommand({
          ...identity,
          requestId: "play-foreign",
          command: "play",
        }),
        origin: "https://draw.yaseendraw.test",
        source: {} as MessageEventSource,
      }),
    );

    expect(timeline.play).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("injects one bridge into existing animated-slide HTML", () => {
    const html = "<html><body><main>Animation</main></body></html>";
    const once = wrapAnimationHtmlWithLifecycleBridge(html);
    const twice = wrapAnimationHtmlWithLifecycleBridge(once);

    expect(once).toContain(ANIMATION_BRIDGE_MARKER);
    expect(twice).toBe(once);
    expect(once.indexOf(ANIMATION_BRIDGE_MARKER)).toBeGreaterThan(
      once.indexOf("<main>Animation</main>"),
    );
    expect(once.indexOf(ANIMATION_BRIDGE_MARKER)).toBeLessThan(
      once.indexOf("</body>"),
    );
  });
});
