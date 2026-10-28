import { ANIMATION_PROTOCOL_VERSION } from "./animationProtocol";

export const ANIMATION_BRIDGE_MARKER = "data-yaseendraw-animation-bridge";

type AnimationTimeline = {
  pause: () => unknown;
  play: () => unknown;
  time: (value?: number) => unknown;
};

type AnimationBridgeWindow = Window & {
  __timelines?: Record<string, AnimationTimeline>;
};

/**
 * Installs the iframe side of the v1 lifecycle protocol.
 *
 * Keep this function self-contained: its source is serialized into generated
 * animation HTML by `wrapAnimationHtmlWithLifecycleBridge()`.
 */
export function animationBridgeBootstrap(): () => void {
  const VERSION = 1;
  const COMMAND_TYPE = "yaseendraw.animation.command";
  const RESPONSE_TYPE = "yaseendraw.animation.response";
  const COMMANDS = new Set([
    "load",
    "seek",
    "play",
    "pause",
    "preview",
    "unload",
  ]);
  const responseByRequest = new Map<string, Record<string, unknown>>();
  const bridgeWindow = window as AnimationBridgeWindow;
  const getTimeline = () => {
    const timelines = bridgeWindow.__timelines;
    if (!timelines) {
      return null;
    }
    return Object.values(timelines)[0] ?? null;
  };
  const currentTime = (timeline: AnimationTimeline) => {
    const value = timeline.time();
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  };
  const isNonEmptyString = (value: unknown) =>
    typeof value === "string" && value.trim().length > 0;
  const hasIdentity = (value: Record<string, unknown>) =>
    isNonEmptyString(value.presentationId) &&
    isNonEmptyString(value.sessionId) &&
    isNonEmptyString(value.frameId) &&
    isNonEmptyString(value.elementId) &&
    isNonEmptyString(value.requestId);
  const makeResponse = (
    data: Record<string, unknown>,
    response: Record<string, unknown>,
  ) => ({
    type: RESPONSE_TYPE,
    version: VERSION,
    presentationId: data.presentationId,
    sessionId: data.sessionId,
    frameId: data.frameId,
    elementId: data.elementId,
    requestId: data.requestId,
    ...response,
  });
  const postResponse = (
    event: MessageEvent,
    response: Record<string, unknown>,
  ) => {
    const source = event.source as WindowProxy | null;
    source?.postMessage(response, event.origin);
  };

  // The existing animated-slide template starts its evergreen loop itself.
  // Pause it as soon as the bridge is installed so a preloaded runtime never
  // remains active before the host explicitly sends `play`.
  const initialTimeline = getTimeline();
  initialTimeline?.pause();
  initialTimeline?.time(0);

  const onMessage = (event: MessageEvent) => {
    if (event.source !== window.parent) {
      return;
    }
    const data = event.data;
    if (
      typeof data !== "object" ||
      data === null ||
      Array.isArray(data) ||
      data.type !== COMMAND_TYPE ||
      !hasIdentity(data as Record<string, unknown>)
    ) {
      return;
    }
    const command = data as Record<string, unknown>;
    if (command.version !== VERSION) {
      postResponse(
        event,
        makeResponse(command, {
          event: "unsupported-version",
          state: "error",
          supportedVersions: [VERSION],
          message: `Animation protocol v${String(
            command.version,
          )} is unsupported`,
        }),
      );
      return;
    }
    if (!COMMANDS.has(command.command as string)) {
      postResponse(
        event,
        makeResponse(command, {
          event: "error",
          state: "error",
          message: `Unknown animation command: ${String(command.command)}`,
        }),
      );
      return;
    }

    const requestKey = `${String(command.sessionId)}|${String(
      command.requestId,
    )}`;
    const cached = responseByRequest.get(requestKey);
    if (cached) {
      postResponse(event, cached);
      return;
    }
    const timeline = getTimeline();
    if (!timeline) {
      const response = makeResponse(command, {
        event: "error",
        state: "loading",
        message: "Animation timeline is not ready",
      });
      responseByRequest.set(requestKey, response);
      postResponse(event, response);
      return;
    }

    let response: Record<string, unknown>;
    if (command.command === "load") {
      timeline.pause();
      timeline.time(0);
      response = makeResponse(command, {
        event: "ready",
        state: "paused",
        time: 0,
      });
    } else if (command.command === "seek") {
      if (
        typeof command.time !== "number" ||
        !Number.isFinite(command.time) ||
        command.time < 0
      ) {
        response = makeResponse(command, {
          event: "error",
          state: "error",
          message: "Seek requires a finite non-negative time",
        });
      } else {
        timeline.pause();
        timeline.time(command.time);
        response = makeResponse(command, {
          event: "state",
          state: "paused",
          time: command.time,
        });
      }
    } else if (command.command === "preview") {
      const previewTime =
        typeof command.time === "number" &&
        Number.isFinite(command.time) &&
        command.time >= 0
          ? command.time
          : 0;
      timeline.pause();
      timeline.time(previewTime);
      response = makeResponse(command, {
        event: "state",
        state: "paused",
        time: previewTime,
      });
    } else if (command.command === "play") {
      timeline.play();
      response = makeResponse(command, {
        event: "state",
        state: "playing",
        time: currentTime(timeline),
      });
    } else if (command.command === "pause") {
      timeline.pause();
      response = makeResponse(command, {
        event: "state",
        state: "paused",
        time: currentTime(timeline),
      });
    } else {
      timeline.pause();
      timeline.time(0);
      response = makeResponse(command, {
        event: "state",
        state: "unloaded",
        time: 0,
      });
    }

    responseByRequest.set(requestKey, response);
    postResponse(event, response);
  };

  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}

export const wrapAnimationHtmlWithLifecycleBridge = (html: string) => {
  if (html.includes(ANIMATION_BRIDGE_MARKER)) {
    return html;
  }
  const bridge = `<script ${ANIMATION_BRIDGE_MARKER}="${ANIMATION_PROTOCOL_VERSION}">(${animationBridgeBootstrap.toString()})();</script>`;
  const bodyClose = html.toLowerCase().lastIndexOf("</body>");
  return bodyClose >= 0
    ? `${html.slice(0, bodyClose)}${bridge}${html.slice(bodyClose)}`
    : `${html}${bridge}`;
};
