import { useEffect, useRef } from 'react'
import type { Route } from './nav'

/**
 * THE BROWSER'S HISTORY FOLLOWS THE SCREENS, so a Safari TAB goes back with Safari's own edge swipe (and its
 * ‹ button), as the Home Screen app goes back with the app's swipe (`useEdgeBack.ts`). Before, the app never wrote a
 * history entry: in a tab, Safari's swipe had nothing of ours to go back to, so it did nothing or left the app.
 *
 *  - Each screen opened over another (a page, a card, Settings…) is one entry: its state holds the whole screen stack.
 *  - Back (the ← button, the app's swipe) steps the browser back one entry when the entry under is the screen under;
 *    the `popstate` then shows it. ONE path for every Back, so a Back is never done twice.
 *  - Any other change (a tab, Home, another vault) rewrites the entry in place: no entry is added.
 *
 * ONE STACK OF OVERLAYS over the screens: the Explore sheets, a page's panels (Properties, Headings, Find),
 * its menus (⋯) and its full-screen views (a table, a drawing). Each overlay open is ONE entry more (`o`: how many are
 * open at that entry), so every Back (the browser's, Safari's swipe, the app's swipe, ←) closes the TOP overlay first,
 * one at a time, and the screen under stays. An overlay closed in the app (✕, a tap outside, a drag) takes its entry
 * with it: the app steps the browser back over it itself, quietly (that `popstate` is ours, not a Back).
 * Only plain data goes into an entry (the routes); nothing about the vault's text, and no address change.
 */

/** An entry of ours: `s`, the screen stack; `p`: the entry under shows `s` less its top; `o`: the overlays open over `s`. */
interface Entry {
  yd: 1
  s: Route[]
  p: boolean
  o?: number
}

const key = (stack: readonly Route[]): string => JSON.stringify(stack)
const current = (): Entry | null => ((history.state as Entry | null)?.yd === 1 ? (history.state as Entry) : null)
const entryStack = (): Route[] => current()?.s ?? []
const write = (push: boolean, s: Route[], p: boolean, o = 0): void =>
  history[push ? 'pushState' : 'replaceState']({ yd: 1, s, p, ...(o > 0 && { o }) } satisfies Entry, '')

/** The overlays open, the bottom one first. `close` closes it on the screen (a Back took its entry). */
const overlays: { close: () => void }[] = []
/** Our own steps back still to land: their `popstate` is not a Back. */
let quiet = 0
let quietTimer: ReturnType<typeof setTimeout> | undefined
/** The screen stack shown, and whether its entries wait for our steps back to land. */
let shown: Route[] = []
let screensWait = false
let started = false
let syncing = false
/** An app Back asked while our step back was on its way: done once it lands. */
let backAfter: Route[] | null = null
let showScreens: ((stack: Route[]) => void) | null = null

/** The entries follow the overlays: one more entry for each overlay opened, a quiet step back over each one closed. */
function syncOverlays(): void {
  syncing = false
  const entry = current()
  if (!started || quiet > 0 || entry === null) return
  const have = entry.o ?? 0
  const want = overlays.length
  for (let o = have + 1; o <= want; o++) write(true, entry.s, false, o)
  if (want >= have) return
  quiet++
  // A step that never lands (no such entry) must not hold the history for good.
  clearTimeout(quietTimer)
  quietTimer = setTimeout(landed, 1000)
  history.go(want - have)
}
/** Opens and closes in one turn are one history change (three sheets closed: one step of three). */
function later(): void {
  if (syncing) return
  syncing = true
  queueMicrotask(syncOverlays)
}
/** Our step back landed: the screens and overlays changed meanwhile are written now. */
function landed(): void {
  quiet = Math.max(0, quiet - 1)
  if (quiet > 0) return
  clearTimeout(quietTimer)
  if (screensWait) {
    screensWait = false
    syncScreens(shown)
  }
  syncOverlays()
  if (backAfter === null || quiet > 0) return
  const stack = backAfter
  backAfter = null
  if (!browserBack(stack)) showScreens?.(stack.slice(0, -1))
}

/**
 * An overlay opens over the screen: one history entry. `close` closes it when a Back takes it. Returns its `done`, to
 * call when it closed by itself (✕, a tap outside, its screen went): its entry goes. `done` after a Back does nothing.
 */
export function openOverlay(close: () => void): () => void {
  const me = { close }
  overlays.push(me)
  later()
  return () => {
    const at = overlays.indexOf(me)
    if (at < 0) return
    overlays.splice(at, 1)
    later()
  }
}

/** How many overlays are open (the edge swipe asks: a touch that closed one is not also a Back). */
export const overlayCount = (): number => overlays.length

/** The top overlay closes (a Back): true when there was one. */
function closeTopOverlay(): boolean {
  const top = overlays.pop()
  if (top === undefined) return false
  top.close()
  later()
  return true
}

/** An overlay for as long as `open` is true (a React panel or menu); a Back calls `close`. */
export function useOverlay(open: boolean, close: () => void): void {
  const latest = useRef(close)
  latest.current = close
  useEffect(() => (open ? openOverlay(() => latest.current()) : undefined), [open])
}

/**
 * The app's Back. True: done (the top overlay closed; or the browser steps back and its `popstate` shows the screen
 * under: the caller does nothing else). False: the entry under is not that screen; the caller goes back itself.
 */
export function browserBack(stack: readonly Route[]): boolean {
  if (closeTopOverlay()) return true
  const entry = current()
  // An overlay just closed (a tap on ← closed the ⋯ menu first): its step back lands first, then this Back.
  if (quiet > 0 || (entry?.o ?? 0) > 0) {
    backAfter = [...stack]
    later()
    return true
  }
  if (entry?.p !== true || key(entry.s) !== key(stack)) return false
  history.back()
  return true
}

/** The screens' entries: one for each screen opened over the entry's; any other change rewrites the entry. */
function syncScreens(stack: Route[]): void {
  shown = stack
  if (quiet > 0) return void (screensWait = true)
  // The entry the app opened on is the tabs, with no screen over them.
  if (current() === null) write(false, [], false)
  const was = entryStack()
  if (key(was) === key(stack)) return
  const o = overlays.length
  // Grown on top of the entry's screens: one entry for each new screen.
  if (key(stack.slice(0, was.length)) === key(was)) {
    for (let i = was.length + 1; i <= stack.length; i++) write(true, stack.slice(0, i), true, o)
    return
  }
  // Anything else: this entry now shows it. It still sits on the entry under only if just its top changed.
  write(false, stack, current()?.p === true && stack.length === was.length && key(stack.slice(0, -1)) === key(was.slice(0, -1)), o)
}

/** Keeps the browser's entries with the screen stack and the overlays, and shows the stack of an entry the browser goes back to. */
export function useBrowserHistory(stack: Route[], show: (stack: Route[]) => void): void {
  useEffect(() => {
    syncScreens(stack)
    // The first time: an entry left with overlays (the page was loaded again) steps back to its screen.
    if (!started) {
      started = true
      syncOverlays()
    }
  }, [stack])

  useEffect(() => {
    showScreens = show
    // One listener for good: our own steps back land even while no screen listens (the app drawn again).
    if (!listening) addEventListener('popstate', onPop)
    listening = true
    return () => void (showScreens === show && (showScreens = null))
  }, [show])
}

let listening = false
function onPop(): void {
  if (quiet > 0) return landed()
  // A Back over overlays: the ones over the entry it lands on close (the top one, for one step back).
  const o = current()?.o ?? 0
  while (overlays.length > o) overlays.pop()!.close()
  if (key(entryStack()) !== key(shown)) showScreens?.(entryStack())
  // An entry with more overlays than are open (Forward, or a page loaded again): back to the ones open.
  later()
}
