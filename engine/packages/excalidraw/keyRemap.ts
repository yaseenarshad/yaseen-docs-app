// Yaseen Docs (YAZ-3564 K5): the user's drawing keys.
//
// The host passes `keyBindings` (`ExcalidrawProps`): one entry per action or
// tool whose key the user changed, with the default chords the engine's
// handlers test for and the user's chords. `App.onKeyDown` then:
// - runs an action on the user's chord alone, as if its first default chord
//   was pressed (`remapKeyDown`), so the action's own `keyTest` still checks
//   the selection and the rest;
// - stops an action or a tool the user moved away from hearing its old chord
//   (`keyMovedAway`, `toolMovedAway`), and picks a tool by the user's chord
//   (`boundTool`).
// A text field is never remapped: typing stays typing. A keyup of a key the
// remap took at keydown names the default key too, so key down and up pair.
// One set per page: every canvas of the host gets the same bindings.
import { isDarwin, isWritableElement } from "@excalidraw/common";

import { getShortcutKey } from "./shortcut";

export type KeyChord = {
  /** `KeyboardEvent.code`: "KeyD", "Digit1", "BracketLeft", "ArrowUp" */
  code: string;
  /** `KeyboardEvent.key` as the chord types it: "d", "D" with Shift, "[" */
  key: string;
  /** the key's own name in a label: "D", "[", "↑" */
  name: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

export type KeyBinding = {
  /** an action's name ("duplicateSelection"), or "tool:<type>" ("tool:rectangle") */
  name: string;
  /** the engine's own chords for it; a user chord becomes the first */
  defaults: readonly KeyChord[];
  /** the user's chords; [] = no key */
  keys: readonly KeyChord[];
};

type KeyEvent = React.KeyboardEvent | KeyboardEvent;

const TOOL = "tool:";

let byName = new Map<string, KeyBinding>();
let byChord = new Map<string, KeyBinding>();
/** the remapped events, by the action they stand for */
const remapped = new WeakMap<object, string>();
/** the code of each key held down that the remap took, and the default chord it became */
const held = new Map<string, KeyChord>();

/** `code`, or for an event without one (a synthetic event) the code its letter or digit has */
const codeOf = (event: KeyEvent) =>
  event.code ||
  (/^[a-z]$/i.test(event.key)
    ? `Key${event.key.toUpperCase()}`
    : /^\d$/.test(event.key)
    ? `Digit${event.key}`
    : event.key);

const chordId = (
  chord: Pick<KeyChord, "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
  code: string,
) =>
  `${chord.metaKey ? "M" : ""}${chord.ctrlKey ? "C" : ""}${
    chord.altKey ? "A" : ""
  }${chord.shiftKey ? "S" : ""}:${code}`;

export const setKeyBindings = (bindings: readonly KeyBinding[] = []) => {
  byName = new Map(bindings.map((binding) => [binding.name, binding]));
  byChord = new Map(
    bindings.flatMap((binding) =>
      binding.keys.map((key) => [chordId(key, key.code), binding] as const),
    ),
  );
  held.clear();
};

/** the event as `fields` say, every other property the event's own */
const seenAs = <T extends KeyEvent>(event: T, fields: Partial<KeyChord>): T =>
  new Proxy(event, {
    get(ev: any, prop) {
      if (prop !== "name" && prop in fields) {
        return fields[prop as keyof KeyChord];
      }
      const value = ev[prop];
      // fix for Proxies hijacking `this`
      return typeof value === "function" ? value.bind(ev) : value;
    },
  });

const bindingOf = (event: KeyEvent) =>
  byChord.size === 0 || isWritableElement(event.target)
    ? undefined
    : byChord.get(chordId(event, codeOf(event)));

/**
 * A keydown on the user's chord for an action, as the event of the action's
 * default chord; null for any other key.
 */
export const remapKeyDown = <T extends KeyEvent>(event: T): T | null => {
  const binding = bindingOf(event);
  const chord = binding?.defaults[0];
  if (!binding || !chord || binding.name.startsWith(TOOL)) {
    return null;
  }
  held.set(codeOf(event), chord);
  const proxy = seenAs(event, chord);
  remapped.set(proxy, binding.name);
  return proxy;
};

/** the keyup of a key `remapKeyDown` took names that default key too */
export const remapKeyUp = <T extends KeyEvent>(event: T): T => {
  const chord = held.get(codeOf(event));
  if (!chord) {
    return event;
  }
  held.delete(codeOf(event));
  return seenAs(event, { key: chord.key, code: chord.code });
};

/** whether `event` must not run `action`: the user moved its key, and this is not the user's chord */
export const keyMovedAway = (action: string, event: KeyEvent) =>
  byName.has(action) && remapped.get(event) !== action;

/** the tool the user's chord picks; null for any other key */
export const boundTool = (event: KeyEvent): string | null => {
  const name = bindingOf(event)?.name;
  return name?.startsWith(TOOL) ? name.slice(TOOL.length) : null;
};

/** whether the user moved the tool's letters away */
export const toolMovedAway = (type: string) => byName.has(`${TOOL}${type}`);

/**
 * The user's key for an action or a tool ("tool:<type>") as a label: "" for
 * no key; undefined when the user did not change it.
 */
export const boundShortcut = (
  name: string,
  format: (text: string) => string = getShortcutKey,
): string | undefined => {
  const binding = byName.get(name);
  if (!binding) {
    return undefined;
  }
  const key = binding.keys[0];
  return key
    ? format(
        [
          isDarwin && key.ctrlKey && "Control",
          (isDarwin ? key.metaKey : key.ctrlKey) && "CtrlOrCmd",
          key.shiftKey && "Shift",
          key.altKey && "Alt",
          key.name,
        ]
          .filter(Boolean)
          .join("+"),
      )
    : "";
};
