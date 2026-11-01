/**
 * THE CLICKS THE USER CAN CHANGE (YAZ-3936, demo round 1 C4 of YAZ-3879): a gesture is a set of modifiers and a
 * click ('CmdOrCtrl+Click', 'Shift+Click', 'Click'). Two places have rows, each with the same three actions:
 * "Links in a note" and "Bullet dots". The other clicks and drags of the app are built in (Settings › Hotkeys
 * shows them from `client/src/settings/hotkeys.ts`).
 *
 * The user's changes live in `SettingsState.hotkeys` with the keys' changes (`HotkeyOverrides`), by row id
 * ('links.thisTab'): only a change is stored, null is "No gesture", and a value equal to the default is never
 * stored, so `{}` is every default. A click reads its binding when it happens (`gestureAction`): a change works at once.
 *
 * Two rows of one place on one gesture are a clash: the Hotkeys page moves the gesture, never shares it. If a stored
 * state has one anyway, the first row in `GESTURE_ROWS` order wins. Pure and DOM-free: main, the renderer and the
 * tests read it alike.
 */
import type { HotkeyOverrides } from '../hotkeyBindings'

/** Where a gesture works. */
export type GesturePlace = 'links' | 'bullets'
/** What a gesture does there: open the link's page (or the bullet, zoomed in) in this tab, a new tab, or a new tab behind. */
export type GestureAction = 'thisTab' | 'newTab' | 'backgroundTab'

export interface GestureRow {
  /** `<place>.<action>`, stable: the settings store keys a change by it. */
  id: string
  place: GesturePlace
  action: GestureAction
  /** Short, sentence case: "Open in this tab". */
  label: string
  /** What the label does not say; shown muted under it. */
  hint?: string
  /** The default gesture, or null for none. */
  gesture: string | null
}

/** The place tags of Settings › Hotkeys; the page's search finds a row by them ("links in a note"). */
export const GESTURE_PLACE_TITLES: Record<GesturePlace, string> = { links: 'Links in a note', bullets: 'Bullet dots' }

const LINK_HINT = 'A [[link]] or a Markdown link. A link to a page that does not exist makes the page first.'
const BULLET_HINT = 'Zoomed into the bullet. The names in the zoom path too.'

/**
 * The rows, in the order the page lists them. Defaults (YAZ-3747 demo, Yaseen: "Browser style"): on a link, as in a
 * browser, ⌘-click opens a background tab and ⌘⇧-click a new tab in front; "Open in this tab" has no click (right-click ›
 * Open), and Click is the text's. Bullet dots as before: Click zooms in, ⇧-click a new tab in front, ⌘-click behind.
 */
export const GESTURE_ROWS: readonly GestureRow[] = [
  { id: 'links.thisTab', place: 'links', action: 'thisTab', label: 'Open in this tab', hint: LINK_HINT, gesture: null },
  { id: 'links.newTab', place: 'links', action: 'newTab', label: 'Open in a new tab', hint: LINK_HINT, gesture: 'CmdOrCtrl+Shift+Click' },
  { id: 'links.backgroundTab', place: 'links', action: 'backgroundTab', label: 'Open in a background tab', hint: LINK_HINT, gesture: 'CmdOrCtrl+Click' },
  { id: 'bullets.thisTab', place: 'bullets', action: 'thisTab', label: 'Open in this tab (zoom in)', hint: BULLET_HINT, gesture: 'Click' },
  { id: 'bullets.newTab', place: 'bullets', action: 'newTab', label: 'Open in a new tab', hint: BULLET_HINT, gesture: 'Shift+Click' },
  { id: 'bullets.backgroundTab', place: 'bullets', action: 'backgroundTab', label: 'Open in a background tab', hint: BULLET_HINT, gesture: 'CmdOrCtrl+Click' },
]

const BY_ID = new Map(GESTURE_ROWS.map((row) => [row.id, row]))
/** The row of a stored id, or undefined for an id that is not a gesture's. */
export const gestureRow = (id: string): GestureRow | undefined => BY_ID.get(id)

// ---------- reading one ----------

/** The modifiers of a gesture, or of a mouse event (`metaKey` is ⌘ on a Mac, Ctrl elsewhere: `CmdOrCtrl`). */
export interface Held {
  cmd: boolean
  ctrl: boolean
  alt: boolean
  shift: boolean
}

const MODIFIERS: Record<string, keyof Held> = { cmdorctrl: 'cmd', commandorcontrol: 'cmd', command: 'cmd', cmd: 'cmd', control: 'ctrl', ctrl: 'ctrl', alt: 'alt', option: 'alt', shift: 'shift' }

/** A gesture's modifiers, or null when it is not modifiers and a click. */
export function parseGesture(gesture: string): Held | null {
  const parts = gesture.split('+')
  if (parts.pop()?.toLowerCase() !== 'click') return null
  const held: Held = { cmd: false, ctrl: false, alt: false, shift: false }
  for (const part of parts) {
    const mod = MODIFIERS[part.toLowerCase()]
    if (mod === undefined || held[mod]) return null
    held[mod] = true
  }
  return held
}

/** A set of modifiers as the gesture the store writes: ⌘ as `CmdOrCtrl`, in the order the menu writes keys. */
export const toGesture = (held: Held): string => [held.cmd && 'CmdOrCtrl', held.ctrl && 'Control', held.alt && 'Alt', held.shift && 'Shift', 'Click'].filter(Boolean).join('+')

/** The parts of a DOM `MouseEvent` this file reads (`shared/` has no DOM types). */
export interface MouseMods {
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

export const heldOf = (event: MouseMods): Held => ({ cmd: event.metaKey, ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey })

/** A mouse event's gesture: exactly the modifiers held, and a click. */
export const gestureOfEvent = (event: MouseMods): string => toGesture(heldOf(event))

const sameHeld = (a: Held, b: Held): boolean => a.cmd === b.cmd && a.ctrl === b.ctrl && a.alt === b.alt && a.shift === b.shift

/** Two gestures are the same when their modifiers are, whatever their order or spelling. */
export function sameGesture(a: string | null, b: string | null): boolean {
  const ha = a === null ? null : parseGesture(a)
  const hb = b === null ? null : parseGesture(b)
  return ha !== null && hb !== null && sameHeld(ha, hb)
}

/** As the app writes a gesture: 'Click', '⌘-click', '⌘⇧-click' (⌃⌥⌘⇧, as keys). '' for none. */
export function gestureDisplay(gesture: string | null): string {
  const held = gesture === null ? null : parseGesture(gesture)
  if (held === null) return gesture ?? ''
  const mods = `${held.ctrl ? '⌃' : ''}${held.alt ? '⌥' : ''}${held.cmd ? '⌘' : ''}${held.shift ? '⇧' : ''}`
  return mods === '' ? 'Click' : `${mods}-click`
}

// ---------- the user's changes ----------

/** The gesture a row has now: the user's change (null = none), else its default. */
export function gestureOf(row: GestureRow, overrides: HotkeyOverrides | undefined): string | null {
  const own = overrides?.[row.id]
  return own === undefined ? row.gesture : own
}

/** `overrides` with `row` on `gesture`: a gesture equal to the default deletes the entry. A new object. */
export function withGesture(overrides: HotkeyOverrides, row: GestureRow, gesture: string | null): HotkeyOverrides {
  const next = { ...overrides }
  if (gesture === null ? row.gesture === null : sameGesture(gesture, row.gesture)) delete next[row.id]
  else next[row.id] = gesture
  return next
}

/** Whether a stored entry reads as a gesture change: a row's id, and null or a gesture. The store's check. */
export const isGestureEntry = (id: string, value: unknown): boolean => gestureRow(id) !== undefined && (value === null || (typeof value === 'string' && parseGesture(value) !== null))

/** Whether a stored entry is the row's default (the store drops it). */
export const isDefaultGesture = (id: string, value: string | null): boolean => {
  const row = gestureRow(id)
  return row !== undefined && (value === null ? row.gesture === null : sameGesture(value, row.gesture))
}

/** The other rows of `row`'s place that have `gesture` now: they would lose it to `row`. */
export const gestureClashes = (row: GestureRow, gesture: string, overrides: HotkeyOverrides | undefined): GestureRow[] =>
  GESTURE_ROWS.filter((other) => other.id !== row.id && other.place === row.place && sameGesture(gestureOf(other, overrides), gesture))

/**
 * What a click in `place` does now (C4): the action whose gesture has exactly the modifiers held, or null for a click
 * no row has. Read at the click, so a change in Settings works at once; a scan of three rows.
 */
export function gestureAction(place: GesturePlace, event: MouseMods, overrides: HotkeyOverrides | undefined): GestureAction | null {
  const held = heldOf(event)
  for (const row of GESTURE_ROWS) {
    if (row.place !== place) continue
    const gesture = gestureOf(row, overrides)
    const mods = gesture === null ? null : parseGesture(gesture)
    if (mods !== null && sameHeld(mods, held)) return row.action
  }
  return null
}

/** The gesture an action of `place` has now, or null: the hover card's line and a menu row's hint read it. */
export const gestureFor = (place: GesturePlace, action: GestureAction, overrides: HotkeyOverrides | undefined): string | null => {
  const row = GESTURE_ROWS.find((r) => r.place === place && r.action === action)
  return row === undefined ? null : gestureOf(row, overrides)
}
