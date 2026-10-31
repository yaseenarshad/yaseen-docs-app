/**
 * A click on a link in a note (YAZ-3935, demo round 1 C1 of YAZ-3879): in an editable note it works as a click on
 * text, and only a bound gesture opens (Settings › Hotkeys › "Links in a note", `shared/keys/gestures.ts`). A
 * read-only note keeps "a click opens" (point 6). `[[links]]` (`wikilinkClick.ts`) and Markdown links
 * (`markdownLink.ts`) both ask here.
 *
 * The pointer (C1): the text cursor on a link of an editable note, the hand only while the modifiers of a bound open
 * gesture are held. One attribute on the editor's root (`LINK_HAND_ATTR`), set by a window keydown / keyup / blur
 * listener that acts on a modifier's own key alone: no work per mouse move, one Set lookup per typed key.
 */
import type { EditorView } from '@milkdown/kit/prose/view'
import type { HotkeyOverrides } from '@shared/hotkeyBindings'
import { gestureAction, gestureDisplay, gestureFor, type GestureAction, type MouseMods } from '@shared/keys'

/** On the editor's root while a bound open gesture's modifiers are held: the CSS shows the hand on its links. */
export const LINK_HAND_ATTR = 'data-link-hand'

const plain = (event: MouseMods): boolean => !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey

/** What a primary click on a link does: an open action, or null for a click that works as on text. Bindings read now. */
export function linkClickAction(view: EditorView, event: MouseMods, hotkeys: HotkeyOverrides | undefined): GestureAction | null {
  const bound = gestureAction('links', event, hotkeys)
  if (bound !== null) return bound
  // A read-only note and a preview keep "a click opens" (YAZ-3879 point 6): there is no caret to put.
  return !view.editable && plain(event) ? 'thisTab' : null
}

const OPEN_WORDS: Record<GestureAction, string> = { thisTab: 'to open', newTab: 'to open in a new tab', backgroundTab: 'to open in a background tab' }

/**
 * The hover card's one quiet line (YAZ-3879 point 9): how to open the link now, from the bound gestures. "⌘-click to
 * open" (Open in this tab), else the first action that has a gesture; none bound, no line. A read-only note: "Click to open".
 */
export function linkOpenHint(hotkeys: HotkeyOverrides | undefined, editable: boolean): string | undefined {
  if (!editable) return 'Click to open'
  for (const action of ['thisTab', 'newTab', 'backgroundTab'] as const) {
    const gesture = gestureFor('links', action, hotkeys)
    if (gesture !== null) return `${gestureDisplay(gesture)} ${OPEN_WORDS[action]}`
  }
  return undefined
}

const MODIFIER_KEYS = new Set(['Meta', 'Control', 'Alt', 'Shift'])
const NONE: MouseMods = { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false }

/** Keeps `LINK_HAND_ATTR` on `view`'s root in step with the held modifiers; returns the cleanup. */
export function trackLinkHand(view: EditorView, hotkeys: () => HotkeyOverrides | undefined): () => void {
  const set = (event: MouseMods) => {
    const on = view.editable && gestureAction('links', event, hotkeys()) !== null
    if (view.dom.hasAttribute(LINK_HAND_ATTR) !== on) view.dom.toggleAttribute(LINK_HAND_ATTR, on)
  }
  // Only a modifier's own key changes what is held: a typing key costs one lookup.
  const onKey = (event: KeyboardEvent) => {
    if (MODIFIER_KEYS.has(event.key)) set(event)
  }
  const onBlur = () => set(NONE)
  // "The old way" (a plain click opens) shows the hand with no key held; the pointer coming on the note checks again.
  const onEnter = (event: MouseEvent) => set(event)
  set(NONE)
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('keyup', onKey, true)
  window.addEventListener('blur', onBlur)
  view.dom.addEventListener('mouseenter', onEnter)
  return () => {
    window.removeEventListener('keydown', onKey, true)
    window.removeEventListener('keyup', onKey, true)
    window.removeEventListener('blur', onBlur)
    view.dom.removeEventListener('mouseenter', onEnter)
  }
}
