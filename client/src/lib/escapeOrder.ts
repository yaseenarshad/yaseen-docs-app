/**
 * THE ESC ORDER (YAZ-4995, YAZ-6492): One Esc closes ONE thing, the top one first:
 *
 *  1. A menu, a popover, the slash menu, the `[[` link picker, the find bar (each its own Esc, before anything here).
 *  2. A dialog or a sheet (each its own Esc; `useModalKeys` takes the key in the capture phase).
 *     The card course (YAZ-5120) is one: a full layer, a dialog, whose Esc closes it (`CardCourse`, capture phase). While
 *     its guided tour runs (6E), the course is hidden and the tour's own Esc goes back to the course.
 *  3. An Explore layer, one at a time (`ExploreStack`), and an unlocked page's lock (YAZ-4997: Esc in its text saves and
 *     locks it again, `createCrepe`'s Esc and the Explore edit layer).
 *  4. An overlay Right Panel (`closeRightOverlay`), even when the left sidebar is already closed.
 *  5. The sidebar's search, when focus is inside the sidebar (`YAZ-6180`): back to the tab it came from (`leaveSearch`).
 *  6. The left sidebar closes (`closeSidebar`). Only when nothing above is open.
 *
 * The Inbox is no step (YAZ-5011): it is a tab, and closes as one (its ✕, ⌘W). Esc in it closes only its ⋯ row (a
 * menu, step 1); then the key goes on to the steps below, as from a page tab.
 *
 * Steps 1 to 3 are many surfaces with an Esc of their own (some 90 of them): each one closes itself and takes the key.
 * This file is the LAST word, App's one listener for what is left (steps 4 to 6), and it is the one place that knows
 * the order. So that a surface which closed on this Esc without saying so (no `preventDefault`) is not followed by a
 * second close, the facts are read in the CAPTURE phase, before any surface runs: what was open when the key came, not
 * after it. Then, in the bubble phase, it acts only on a key no one took.
 *
 * Limits: Esc in a form field (input, textarea, select, inline rename, search bar, comment composer, Edit card) never
 * closes the overlay or sidebar; idle Esc in a document editor (Markdown `.editor-instance .ProseMirror` outside Edit
 * card, or Monaco `.monaco-editor .inputarea`) closes the overlay or sidebar directly and keeps the caret and selection
 * intact. Esc never opens the sidebar. Only on Esc: nothing here runs for any other key.
 */
import { useEffect, useRef } from 'react'

/** What one Esc does here: close overlay right panel, leave sidebar search, close left sidebar, or nothing. */
export type EscapeStep = 'closeRightOverlay' | 'leaveSearch' | 'closeSidebar' | null

/** What was open, and where the keyboard was, when an Esc came (read before any surface ran). */
export interface EscapeFacts {
  /** A menu, popover, picker, find bar, sheet or dialog showed (steps 1 and 2). */
  owner: boolean
  /** The Explore stack showed (step 3). */
  explore: boolean
  /** The keyboard was in a form field or Edit card (not a main Markdown or Monaco document editor). */
  inText: boolean
  /** The right panel is open in overlay mode over the workspace. */
  rightOverlayOpen: boolean
  /** The sidebar shows. */
  sidebarShown: boolean
  /** It shows its Search tab. */
  searchShown: boolean
  /** The keyboard target was inside the left sidebar. */
  inSidebar: boolean
  /** It can close: not a Files window, which IS the sidebar. */
  canClose: boolean
}

/** The order above, for what is left after the surfaces: one step, or none. */
export function escapeStep(f: EscapeFacts): EscapeStep {
  if (f.owner || f.explore) return null
  if (f.inText) return null
  if (f.rightOverlayOpen) return 'closeRightOverlay'
  if (!f.sidebarShown) return null
  if (f.searchShown && f.inSidebar) return 'leaveSearch'
  return f.canClose ? 'closeSidebar' : null
}

/** A menu, a picker, a find bar, a sheet or a dialog: only one that SHOWS (each editor keeps its `[[` picker in the DOM, hidden). */
const OWNERS = '[role="dialog"], [role="menu"], [role="listbox"], .ctx-menu, .quicklook, .find-bar'
const FIELD = 'input, textarea, select, [contenteditable="true"], [contenteditable=""]'
const EDITABLE = '[contenteditable="true"], [contenteditable=""]'
const shows = (el: HTMLElement): boolean =>
  typeof el.checkVisibility === 'function' ? el.checkVisibility({ visibilityProperty: true }) : el.closest('[hidden]') === null && el.dataset.show !== 'false'

/**
 * Main document editors where an idle Esc (not taken by a picker, find bar, cell note, timed unlock, or Monaco widget)
 * closes the overlay or left sidebar directly: Markdown page editors (including read-only and nested CodeMirror blocks,
 * excluding Edit card and real form inputs inside the page) and Monaco code editors.
 */
const isDocumentEditor = (el: Element): boolean =>
  (el.matches(EDITABLE) && el.closest('.editor-instance .ProseMirror') !== null && el.closest('.card--editing, .card__editor') === null) ||
  el.matches('.monaco-editor .inputarea')

/** The sidebar's state, from App. */
export interface SidebarFacts {
  aside: HTMLElement | null
  searchShown: boolean
  canClose: boolean
  rightOverlayOpen?: boolean
}

/** The facts of one Esc, from the DOM and the sidebar's state. Cheap: it runs on Esc only. */
export function readEscapeFacts(event: KeyboardEvent, sidebar: SidebarFacts): EscapeFacts {
  const doc = document
  const target = event.target instanceof Element ? event.target : null
  // The sidebar's own search list shows with its tab: it is the search (step 5), not a picker over it.
  const owner = [...doc.querySelectorAll<HTMLElement>(OWNERS)].some((el) => !(sidebar.aside?.contains(el) === true && el.matches('.search-results')) && shows(el))
  const field = target?.closest(FIELD) ?? null
  return {
    owner,
    explore: doc.querySelector('.explore') !== null,
    inText: field !== null && !isDocumentEditor(field),
    rightOverlayOpen: sidebar.rightOverlayOpen ?? [...doc.querySelectorAll<HTMLElement>('.right-panel--overlay')].some(shows),
    sidebarShown: sidebar.aside?.isConnected === true,
    searchShown: sidebar.searchShown,
    inSidebar: target !== null && sidebar.aside?.contains(target) === true,
    canClose: sidebar.canClose,
  }
}

/**
 * ProseMirror's `captureKeyDown` unconditionally calls `event.preventDefault()` for `keyCode === 27` (Escape)
 * even when every keymap and `handleKeyDown` declined. `createCrepe`'s lowest-priority Escape command (`priority: 10`)
 * marks its `view.dom` here on an idle decline so `useEscapeLast` (and `PageWindow`) know `defaultPrevented` came only
 * from ProseMirror's fallback and not from a surface (`[[` picker, cell note, find bar, timed unlock, etc.).
 */
let idleEscapeHost: HTMLElement | null = null
let idleEscapeToken = 0

/** Marks `host` (`.ProseMirror`) as having declined the in-flight Escape event at lowest editor priority. */
export function allowIdleEscape(host: HTMLElement): void {
  idleEscapeHost = host
  const token = ++idleEscapeToken
  queueMicrotask(() => {
    if (idleEscapeToken === token) idleEscapeHost = null
  })
}

/** True while the current Escape event was only prevented by ProseMirror's `captureKeyDown` fallback for `target`. */
export function isIdleEscape(target: EventTarget | null): boolean {
  return idleEscapeHost !== null && target instanceof Node && idleEscapeHost.contains(target)
}

/**
 * App's last Esc (steps 4 to 6). `sidebar` is read at each Esc; `act` runs the step. A key with a modifier (⇧Esc is
 * Explore's), one in an IME composition, and one a surface took (`defaultPrevented`, or stopped before the window) do nothing.
 */
export function useEscapeLast(sidebar: () => SidebarFacts, act: (step: Exclude<EscapeStep, null>) => void): void {
  const doors = useRef({ sidebar, act })
  doors.current = { sidebar, act }
  useEffect(() => {
    let facts: EscapeFacts | null = null
    const plain = (e: KeyboardEvent) => e.key === 'Escape' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.isComposing
    const before = (e: KeyboardEvent) => {
      if (plain(e)) {
        idleEscapeHost = null
        facts = readEscapeFacts(e, doors.current.sidebar())
      } else {
        facts = null
      }
    }
    const after = (e: KeyboardEvent) => {
      const f = facts
      const pmIdle = isIdleEscape(e.target)
      idleEscapeHost = null
      facts = null
      if (f === null || !plain(e) || (e.defaultPrevented && !pmIdle)) return
      const step = escapeStep(f)
      if (step === null) return
      e.preventDefault()
      doors.current.act(step)
    }
    window.addEventListener('keydown', before, true)
    window.addEventListener('keydown', after)
    return () => {
      window.removeEventListener('keydown', before, true)
      window.removeEventListener('keydown', after)
    }
  }, [])
}
