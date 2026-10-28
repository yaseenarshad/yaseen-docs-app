import { describe, expect, it, vi } from "vitest";

import { newIframeElement } from "@excalidraw/element";

import {
  ANIMATION_RUNTIME_POLICY_EVENT,
  getPresentationIframeSandbox,
  getAnimationRuntimeMode,
  getTrustedPresentationAnimationUrl,
  isManagedPresentationAnimation,
  publishAnimationRuntimePolicy,
} from "./animationRuntimePolicy";

describe("animation runtime mount policy", () => {
  it("identifies only generated managed animation iframe elements", () => {
    const animation = newIframeElement({
      type: "iframe",
      x: 0,
      y: 0,
      customData: {
        animationProtocolVersion: 1,
        yaseenPresentation: {
          kind: "slide-child",
          schemaVersion: 1,
          slideId: "slide-2",
          role: "animated-visual",
        },
      },
    });

    expect(isManagedPresentationAnimation(animation)).toBe(true);
    expect(
      isManagedPresentationAnimation({
        ...animation,
        customData: {
          ...animation.customData,
          animationProtocolVersion: undefined,
        },
      }),
    ).toBe(false);
    expect(
      isManagedPresentationAnimation({
        ...animation,
        customData: {
          ...animation.customData,
          yaseenPresentation: {
            ...animation.customData?.yaseenPresentation,
            role: "static-visual",
          },
        },
      }),
    ).toBe(false);
  });

  it("maps active, adjacent, and distant frames to bounded runtime modes", () => {
    const policy = {
      sessionId: "session-1",
      activeFrameId: "frame-5",
      preloadFrameIds: ["frame-4", "frame-6"],
    };

    expect(getAnimationRuntimeMode("frame-5", policy)).toBe("active");
    expect(getAnimationRuntimeMode("frame-4", policy)).toBe("preload");
    expect(getAnimationRuntimeMode("frame-6", policy)).toBe("preload");
    expect(getAnimationRuntimeMode("frame-1", policy)).toBe("unloaded");
    expect(getAnimationRuntimeMode("frame-5", null)).toBe("unloaded");
  });

  it("publishes policy changes for the editor renderer", () => {
    const listener = vi.fn();
    window.addEventListener(ANIMATION_RUNTIME_POLICY_EVENT, listener);
    const policy = {
      sessionId: "session-1",
      activeFrameId: "frame-5",
      preloadFrameIds: ["frame-4"],
    };

    publishAnimationRuntimePolicy(policy);

    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual(policy);
    window.removeEventListener(ANIMATION_RUNTIME_POLICY_EVENT, listener);
  });

  it("accepts only same-origin controlled animation capability URLs", () => {
    const token = "a".repeat(64);
    expect(
      getTrustedPresentationAnimationUrl(
        `/api/presentation-animations/${token}`,
        "https://draw.example.test/board/one",
      ),
    ).toBe(`https://draw.example.test/api/presentation-animations/${token}`);
    expect(
      getTrustedPresentationAnimationUrl(
        `https://evil.test/api/presentation-animations/${token}`,
        "https://draw.example.test/board/one",
      ),
    ).toBeNull();
    expect(
      getTrustedPresentationAnimationUrl(
        "/api/assets/board/presentation-animations/file.html",
        "https://draw.example.test/board/one",
      ),
    ).toBeNull();
    expect(
      getTrustedPresentationAnimationUrl(
        `/api/presentation-animations/${token}?redirect=https://evil.test`,
        "https://draw.example.test/board/one",
      ),
    ).toBeNull();
  });

  it("gives managed animations a scripts-only opaque sandbox", () => {
    expect(getPresentationIframeSandbox(true, true)).toBe("allow-scripts");
    expect(getPresentationIframeSandbox(false, true)).toContain(
      "allow-same-origin",
    );
    expect(getPresentationIframeSandbox(false, false)).not.toContain(
      "allow-same-origin",
    );
  });
});
