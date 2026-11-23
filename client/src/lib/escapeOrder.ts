/**
 * THE ESC ORDER (YAZ-4995, Yaseen: "so yes its last in line exactly one thing at a time"). One Esc closes ONE thing, the
 * top one first:
 *
 *  1. A menu, a popover, the slash menu, the `[[` link picker, the find bar (each its own Esc, before anything here).
 *  2. A dialog or a sheet (each its own Esc; `useModalKeys` takes the key in the capture phase).
 *     The card course (YAZ-5120) is one: a full layer, a dialog, whose Esc closes it (`CardCourse`, capture phase). While
 *     its guided tour runs (6E), the course is hidden and the tour's own Esc goes back to the course.
 *  3. An Explore layer, one at a time (`ExploreStack`), and an unlocked page's lock (YAZ-4997: Esc in its text saves and
 *     locks it again, `createCrepe`'s Esc and the Explore edit layer).
 *  4. The sidebar's search: back to the tab it came from, the keyboard on its row (`Sidebar`, or `escapeStep` here).
 *  5. The left sidebar closes. Only when nothing above is open.
 *
 * The Inbox is no step (YAZ-5011): it is a tab, and closes as one (its ✕, ⌘W). Esc in it closes only its ⋯ row (a
 * menu, step 1); then the key goes on to steps 4 and 5, as from a page tab.
 *
 * Steps 1 to 3 are many surfaces with an Esc of their own (some 90 of them): each one closes itself and takes the key.
 * This file is the LAST word, App's one listener for what is left (steps 4 and 5), and it is the one place that knows
 * the order. So that a surface which closed on this Esc without saying so (no `preventDefault`) is not followed by a
 * second close, the facts are read in the CAPTURE phase, before any surface runs: what was open when the key came, not
 * after it. Then, in the bubble phase, it acts only on a key no one took.
 *
 * Limits (Yaseen's): Esc with the caret in the page text (or any field) never closes the sidebar; Esc never opens it.
 * Only on Esc: nothing here runs for any other key.
 */
import { useEffect, useRef } from 'react'
import { pageHoldsKeys } from './readOnlyCaret'

/** What one Esc does here: the sidebar's search goes back to its tab, the sidebar closes, or nothing (a surface's, or none). */
export type EscapeStep = 'leaveSearch' | 'closeSidebar' | null

/** What was open, and where the keyboard was, when an Esc came (read before any surface ran). */
export interface EscapeFacts {
  /** A menu, popover, picker, sheet or dialog showed (steps 1 and 2). */
  owner: boolean
  /** The Explore stack showed (step 3). */
  explore: boolean
  /** The keyboard was in text: a field, a page's body (an unlocked page's too: its own Esc, YAZ-4997), or the page's selection. */
  inText: boolean
  /** The sidebar shows. */
  sidebarShown: boolean
  /** It shows its Search tab. */
  searchShown: boolean
  /** It can close: not a Files window, which IS the sidebar. */
  canClose: boolean
}

/** The order above, for what is left after the surfaces: one step, or none. */
export function escapeStep(f: EscapeFacts): EscapeStep {
  if (f.owner || f.explore) return null
  if (f.inText || !f.sidebarShown) return null
  if (f.searchShown) return 'leaveSearch'
  return f.canClose ? 'closeSidebar' : null
}

/** A menu, a picker, a sheet or a dialog: only one that SHOWS (each editor keeps its `[[` picker in the DOM, hidden). */
const OWNERS = '[role="dialog"], [role="menu"], [role="listbox"], .ctx-menu, .quicklook'
const FIELD = 'input, textarea, select, [contenteditable="true"], [contenteditable=""]'
const shows = (el: HTMLElement): boolean =>
  typeof el.checkVisibility === 'function' ? el.checkVisibility({ visibilityProperty: true }) : el.closest('[hidden]') === null && el.dataset.show !== 'false'

/** The sidebar's state, from App. */
export interface SidebarFacts {
  aside: HTMLElement | null
  searchShown: boolean
  canClose: boolean
}

/** The facts of one Esc, from the DOM and the sidebar's state. Cheap: it runs on Esc only. */
export function readEscapeFacts(event: KeyboardEvent, sidebar: SidebarFacts): EscapeFacts {
  const doc = document
  const target = event.target instanceof Element ? event.target : null
  // The sidebar's own search list shows with its tab: it is the search (step 5), not a picker over it.
  const owner = [...doc.querySelectorAll<HTMLElement>(OWNERS)].some((el) => !(sidebar.aside?.contains(el) === true && el.matches('.search-results')) && shows(el))
  return {
    owner,
    explore: doc.querySelector('.explore') !== null,
    inText: (target !== null && target.closest(FIELD) !== null) || pageHoldsKeys(target),
    sidebarShown: sidebar.aside?.isConnected === true,
    searchShown: sidebar.searchShown,
    canClose: sidebar.canClose,
  }
}

/**
 * App's last Esc (steps 4 and 5). `sidebar` is read at each Esc; `act` runs the step. A key with a modifier (⇧Esc is
 * Explore's), one in an IME composition, and one a surface took (`defaultPrevented`, or stopped before the window) do nothing.
 */
export function useEscapeLast(sidebar: () => SidebarFacts, act: (step: Exclude<EscapeStep, null>) => void): void {
  const doors = useRef({ sidebar, act })
  doors.current = { sidebar, act }
  useEffect(() => {
    let facts: EscapeFacts | null = null
    const plain = (e: KeyboardEvent) => e.key === 'Escape' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.isComposing
    const before = (e: KeyboardEvent) => {
      facts = plain(e) ? readEscapeFacts(e, doors.current.sidebar()) : null
    }
    const after = (e: KeyboardEvent) => {
      const f = facts
      facts = null
      if (f === null || !plain(e) || e.defaultPrevented) return
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
