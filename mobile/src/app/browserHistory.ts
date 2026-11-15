import { useEffect, useRef } from 'react'
import type { Route } from './nav'

/**
 * YAZ-5499: THE BROWSER'S HISTORY FOLLOWS THE SCREENS, so a Safari TAB goes back with Safari's own edge swipe (and its
 * ‹ button), as the Home Screen app goes back with the app's swipe (`useEdgeBack.ts`). Before, the app never wrote a
 * history entry: in a tab, Safari's swipe had nothing of ours to go back to, so it did nothing or left the app.
 *
 *  - Each screen opened over another (a page, a card, Settings…) is one entry: its state holds the whole screen stack.
 *  - Back (the ← button, the app's swipe) steps the browser back one entry when the entry under is the screen under;
 *    the `popstate` then shows it. ONE path for every Back, so a Back is never done twice.
 *  - The browser's own Back (Safari's swipe in a tab) shows the stack of the entry it lands on. With Explore sheets
 *    open, it closes the top sheet instead (`interceptBrowserBack`), and the screen under stays.
 *  - Any other change (a tab, Home, another vault) rewrites the entry in place: no entry is added.
 * Only plain data goes into an entry (the routes); nothing about the vault's text, and no address change.
 */

/** An entry of ours: `s`, the screen stack; `p`: the entry under shows `s` less its top (a Back can be the browser's). */
interface Entry {
  yd: 1
  s: Route[]
  p: boolean
}

const key = (stack: readonly Route[]): string => JSON.stringify(stack)
const current = (): Entry | null => ((history.state as Entry | null)?.yd === 1 ? (history.state as Entry) : null)
const entryStack = (): Route[] => current()?.s ?? []
const write = (push: boolean, s: Route[], p: boolean): void => history[push ? 'pushState' : 'replaceState']({ yd: 1, s, p } satisfies Entry, '')

/** Something on top (the Explore sheets) takes the browser's Back first. True: it took it. */
let interceptor: (() => boolean) | null = null
export const interceptBrowserBack = (take: (() => boolean) | null): void => void (interceptor = take)

/**
 * The app's Back. True: the browser steps back and its `popstate` shows the screen under (the caller does nothing
 * else). False: the entry under is not that screen; the caller goes back itself.
 */
export function browserBack(stack: readonly Route[]): boolean {
  const entry = current()
  if (entry?.p !== true || key(entry.s) !== key(stack)) return false
  history.back()
  return true
}

/** Keeps the browser's entries with the screen stack, and shows the stack of an entry the browser goes back to. */
export function useBrowserHistory(stack: Route[], show: (stack: Route[]) => void): void {
  const latest = useRef(stack)
  latest.current = stack
  useEffect(() => {
    // The entry the app opened on is the tabs, with no screen over them.
    if (current() === null) write(false, [], false)
    const was = entryStack()
    if (key(was) === key(stack)) return
    // Grown on top of the entry's screens: one entry for each new screen.
    if (key(stack.slice(0, was.length)) === key(was)) {
      for (let i = was.length + 1; i <= stack.length; i++) write(true, stack.slice(0, i), true)
      return
    }
    // Anything else: this entry now shows it. It still sits on the entry under only if just its top changed.
    write(false, stack, current()?.p === true && stack.length === was.length && key(stack.slice(0, -1)) === key(was.slice(0, -1)))
  }, [stack])

  useEffect(() => {
    const onPop = () => {
      // The sheets close first: the screen under them stays, so the entry we left comes back.
      if (interceptor?.() === true) return write(true, latest.current, latest.current.length > 0)
      show(entryStack())
    }
    addEventListener('popstate', onPop)
    return () => removeEventListener('popstate', onPop)
  }, [show])
}
