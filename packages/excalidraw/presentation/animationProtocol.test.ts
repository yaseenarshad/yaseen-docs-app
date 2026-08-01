import { describe, expect, it } from "vitest";

import {
  ANIMATION_PROTOCOL_VERSION,
  createAnimationCommand,
  createAnimationResponse,
  isAnimationCommand,
  isAnimationResponse,
  validateAnimationMessageEvent,
} from "./animationProtocol";

const identity = {
  presentationId: "foundations",
  sessionId: "session-1",
  frameId: "frame-2",
  elementId: "animation-2",
  requestId: "request-9",
};

describe("presentation animation protocol", () => {
  it("creates and validates the versioned host command envelope", () => {
    const command = createAnimationCommand({
      ...identity,
      command: "seek",
      time: 2.5,
    });

    expect(command).toEqual({
      type: "yaseendraw.animation.command",
      version: ANIMATION_PROTOCOL_VERSION,
      ...identity,
      command: "seek",
      time: 2.5,
    });
    expect(isAnimationCommand(command)).toBe(true);
    expect(isAnimationCommand({ ...command, version: 999 })).toBe(false);
    expect(isAnimationCommand({ ...command, command: "explode" })).toBe(false);
    expect(isAnimationCommand({ ...command, time: -1 })).toBe(false);
  });

  it("validates iframe responses including safe unsupported-version results", () => {
    const ready = createAnimationResponse({
      ...identity,
      event: "ready",
      state: "paused",
      time: 0,
    });

    expect(isAnimationResponse(ready)).toBe(true);
    expect(
      isAnimationResponse({
        ...ready,
        event: "unsupported-version",
        supportedVersions: [ANIMATION_PROTOCOL_VERSION],
      }),
    ).toBe(true);
    expect(isAnimationResponse({ ...ready, time: Number.NaN })).toBe(false);
  });

  it("rejects the wrong window, origin, element, or stale request", () => {
    const source = {} as MessageEventSource;
    const response = createAnimationResponse({
      ...identity,
      event: "state",
      state: "playing",
      time: 1,
    });
    const event = {
      data: response,
      source,
      origin: "https://assets.yaseendraw.test",
    } as MessageEvent;

    expect(
      validateAnimationMessageEvent(event, {
        source,
        origin: "https://assets.yaseendraw.test",
        elementId: identity.elementId,
        requestId: identity.requestId,
      }),
    ).toEqual(response);
    expect(
      validateAnimationMessageEvent(event, {
        source: {} as MessageEventSource,
        origin: "https://assets.yaseendraw.test",
        elementId: identity.elementId,
        requestId: identity.requestId,
      }),
    ).toBeNull();
    expect(
      validateAnimationMessageEvent(event, {
        source,
        origin: "https://evil.test",
        elementId: identity.elementId,
        requestId: identity.requestId,
      }),
    ).toBeNull();
    expect(
      validateAnimationMessageEvent(event, {
        source,
        origin: "https://assets.yaseendraw.test",
        elementId: "other-animation",
        requestId: identity.requestId,
      }),
    ).toBeNull();
    expect(
      validateAnimationMessageEvent(event, {
        source,
        origin: "https://assets.yaseendraw.test",
        elementId: identity.elementId,
        requestId: "stale-request",
      }),
    ).toBeNull();
  });

  it("allows opaque srcdoc origins only when the host explicitly expects one", () => {
    const source = {} as MessageEventSource;
    const response = createAnimationResponse({
      ...identity,
      event: "complete",
      state: "paused",
      time: 6,
    });
    const event = { data: response, source, origin: "null" } as MessageEvent;

    expect(
      validateAnimationMessageEvent(event, {
        source,
        origin: "null",
        elementId: identity.elementId,
        requestId: identity.requestId,
      }),
    ).toEqual(response);
    expect(
      validateAnimationMessageEvent(event, {
        source,
        origin: "*",
        elementId: identity.elementId,
        requestId: identity.requestId,
      }),
    ).toBeNull();
  });
});
