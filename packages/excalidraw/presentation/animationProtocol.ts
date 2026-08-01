export const ANIMATION_PROTOCOL_VERSION = 1 as const;
export const ANIMATION_COMMAND_TYPE = "yaseendraw.animation.command" as const;
export const ANIMATION_RESPONSE_TYPE = "yaseendraw.animation.response" as const;

export const ANIMATION_COMMANDS = [
  "load",
  "seek",
  "play",
  "pause",
  "preview",
  "unload",
] as const;

export const ANIMATION_RESPONSE_EVENTS = [
  "ready",
  "state",
  "complete",
  "error",
  "unsupported-version",
] as const;

export const ANIMATION_STATES = [
  "unloaded",
  "loading",
  "paused",
  "playing",
  "error",
] as const;

export type AnimationCommandName = typeof ANIMATION_COMMANDS[number];
export type AnimationResponseEvent = typeof ANIMATION_RESPONSE_EVENTS[number];
export type AnimationState = typeof ANIMATION_STATES[number];

export type AnimationMessageIdentity = {
  presentationId: string;
  sessionId: string;
  frameId: string;
  elementId: string;
  requestId: string;
};

type AnimationCommandBase = AnimationMessageIdentity & {
  type: typeof ANIMATION_COMMAND_TYPE;
  version: typeof ANIMATION_PROTOCOL_VERSION;
};

export type AnimationCommand = AnimationCommandBase &
  (
    | { command: "seek"; time: number }
    | { command: "preview"; time?: number }
    | { command: Exclude<AnimationCommandName, "seek" | "preview"> }
  );

type WithoutAnimationEnvelope<T> = T extends unknown
  ? Omit<T, "type" | "version">
  : never;

export type AnimationCommandInput = WithoutAnimationEnvelope<AnimationCommand>;

export type AnimationResponse = AnimationMessageIdentity & {
  type: typeof ANIMATION_RESPONSE_TYPE;
  version: typeof ANIMATION_PROTOCOL_VERSION;
  event: AnimationResponseEvent;
  state?: AnimationState;
  time?: number;
  message?: string;
  supportedVersions?: readonly number[];
};

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isFiniteNonNegativeNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

const hasValidIdentity = (value: UnknownRecord) =>
  isNonEmptyString(value.presentationId) &&
  isNonEmptyString(value.sessionId) &&
  isNonEmptyString(value.frameId) &&
  isNonEmptyString(value.elementId) &&
  isNonEmptyString(value.requestId);

export const createAnimationCommand = (
  command: AnimationCommandInput,
): AnimationCommand =>
  ({
    type: ANIMATION_COMMAND_TYPE,
    version: ANIMATION_PROTOCOL_VERSION,
    ...command,
  } as AnimationCommand);

export const createAnimationResponse = (
  response: Omit<AnimationResponse, "type" | "version">,
): AnimationResponse => ({
  type: ANIMATION_RESPONSE_TYPE,
  version: ANIMATION_PROTOCOL_VERSION,
  ...response,
});

export const isAnimationCommand = (
  value: unknown,
): value is AnimationCommand => {
  if (
    !isRecord(value) ||
    value.type !== ANIMATION_COMMAND_TYPE ||
    value.version !== ANIMATION_PROTOCOL_VERSION ||
    !hasValidIdentity(value) ||
    !ANIMATION_COMMANDS.includes(value.command as AnimationCommandName)
  ) {
    return false;
  }

  if (value.command === "seek") {
    return isFiniteNonNegativeNumber(value.time);
  }
  if (value.command === "preview" && value.time !== undefined) {
    return isFiniteNonNegativeNumber(value.time);
  }
  return value.time === undefined;
};

export const isAnimationResponse = (
  value: unknown,
): value is AnimationResponse => {
  if (
    !isRecord(value) ||
    value.type !== ANIMATION_RESPONSE_TYPE ||
    value.version !== ANIMATION_PROTOCOL_VERSION ||
    !hasValidIdentity(value) ||
    !ANIMATION_RESPONSE_EVENTS.includes(value.event as AnimationResponseEvent)
  ) {
    return false;
  }
  if (
    value.state !== undefined &&
    !ANIMATION_STATES.includes(value.state as AnimationState)
  ) {
    return false;
  }
  if (value.time !== undefined && !isFiniteNonNegativeNumber(value.time)) {
    return false;
  }
  if (value.message !== undefined && typeof value.message !== "string") {
    return false;
  }
  if (value.event === "unsupported-version") {
    return (
      Array.isArray(value.supportedVersions) &&
      value.supportedVersions.length > 0 &&
      value.supportedVersions.every(
        (version) => Number.isInteger(version) && version > 0,
      )
    );
  }
  return value.supportedVersions === undefined;
};

export const validateAnimationMessageEvent = (
  event: Pick<MessageEvent, "data" | "origin" | "source">,
  expected: {
    source: MessageEventSource;
    origin: string;
    elementId: string;
    requestId: string;
  },
): AnimationResponse | null => {
  if (
    expected.origin === "*" ||
    event.source !== expected.source ||
    event.origin !== expected.origin ||
    !isAnimationResponse(event.data) ||
    event.data.elementId !== expected.elementId ||
    event.data.requestId !== expected.requestId
  ) {
    return null;
  }
  return event.data;
};
