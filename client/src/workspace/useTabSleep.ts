/**
 * TAB SLEEP (YAZ-3737 5A; D2, D5, D10, S9, S10). A tab you have not looked at for `tabSleepAfter` (Settings › Memory,
 * 30 min by default) frees its memory: its editor unmounts (`sleep` in `useWorkspace.ts`), and the tab, its name, its
 * place and its Back steps stay. A click on it is the wake: `withActive` mounts it again, and the editor starts from
 * the page view kept at sleep in App's `startView` map (scroll, caret, folds, bullet zoom, text size; a drawing's pan
 * and zoom). Undo starts fresh (accepted).
 *
 * THE CLOCK. `lastShown` holds, per tab, when it last left the front: a ref, never stored, no render. About once a
 * minute a round looks for mounted tabs unseen that long. The clock counts only the time the Mac is awake (S9): the
 * Mac's sleep stops this page's timer, so a gap between two rounds of `RESUME_GAP_TICKS` or more means it slept, and
 * every stamp starts again from then. That keeps a laptop that wakes from putting all its tabs to sleep at once.
 *
 * WHO SLEEPS (D5, S21): every kind of tab, but never the tab on show, the active tab, the review's layer, a tab whose
 * strip tab is being dragged, or anything while the tab board shows (its animation layer and its card drags). The
 * right panel's editors are not in `mounted` at all. In a hidden or minimized window the active tab sleeps too (S10):
 * it stays in `mounted` (`active ∈ mounted` holds), and App only leaves out its editor (`held`) until the window
 * comes back or another tab becomes active.
 *
 * SAVE FIRST (D2). A round saves each tab first (`flushRenamedPath`) and puts it to sleep only when its file is then
 * clean (`dirtyPaths`): a tab with a save conflict keeps its typing in its editor and tries again next round. All the
 * tabs of one round sleep in ONE change.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PageView, TabSleepAfter } from '@shared/types'
import { readPageView } from '../lib/pageView'
import { dirtyPaths, flushRenamedPath } from '../lib/renameContinuity'

/** How often a window looks for tabs to sleep. */
export const SLEEP_TICK_MS = 60_000
/**
 * A gap of this many ticks between two rounds means the Mac slept (S9). Not 2: the timer of a minimized window's page
 * can be held to the next whole minute, so an awake gap may come close to two ticks.
 */
export const RESUME_GAP_TICKS = 3

const MINUTE = 60_000
const AFTER_MS: Record<Exclude<TabSleepAfter, 'never'>, number> = { '15m': 15 * MINUTE, '30m': 30 * MINUTE, '1h': 60 * MINUTE, '2h': 120 * MINUTE }

/**
 * The perf harness's sleep clock in seconds (long-day-open), or null: `?sleepSeconds=` on the page's URL, which main
 * sets only under `YASEEN_DOCS_E2E=1` from `YASEEN_DOCS_TAB_SLEEP_SECONDS`. It replaces the setting's time; 'never' stays off.
 */
export function testSleepSeconds(search: string = typeof location === 'undefined' ? '' : location.search): number | null {
  const n = Number(new URLSearchParams(search).get('sleepSeconds'))
  return Number.isFinite(n) && n > 0 ? n : null
}

/** What the rounds read of the window, as it is now. */
export interface SleepWorld {
  setting: TabSleepAfter
  tabs: readonly { id: string; path: string }[]
  mounted: readonly string[]
  active: string | null
  /** The tab whose layer shows: the active one, the review's layer during a review, null under the blank tab. */
  shown: string | null
  /** The tab board shows or animates (its `overview.from` layer and card drags). */
  boardOpen: boolean
  /** The review's layer, or null. */
  review: string | null
  /** The window is hidden or minimized (S10). */
  away: boolean
}

/** The tab of the strip being dragged now (YAZ-3637), by its `data-tab`: read when a round runs, never followed. */
const draggedTab = (): string | null => (typeof document === 'undefined' ? null : (document.querySelector('.tabbar__tab--dragging')?.getAttribute('data-tab') ?? null))

/** Whether tab `id` may sleep now (D5, S10, S21). */
export function maySleep(id: string, w: SleepWorld, dragging: string | null): boolean {
  if (w.boardOpen || id === w.review || id === dragging) return false
  return w.away || (id !== w.active && id !== w.shown)
}

export interface SleepDoors {
  /** App's `startView` map: the view a tab sleeps with is its wake's start. */
  startView: Map<string, PageView>
  /** The workspace's `sleep` (the active id never leaves `mounted`). */
  sleep: (ids: readonly string[]) => void
  /** The workspace's `wake`: mounted behind the page on show. */
  wake: (id: string) => void
}

export interface TabSleep {
  /** The tabs asleep now: the zzz mark (D11). */
  asleep: ReadonlySet<string>
  /** The active tab of a hidden window, asleep (S10): App renders its layer with no editor. */
  held: string | null
  /** A hover on a sleeping tab (S7): it mounts behind the page on show, and its clock starts again. */
  wake: (id: string) => void
}

const NONE: ReadonlySet<string> = new Set()

export function useTabSleep(world: SleepWorld, doors: SleepDoors): TabSleep {
  const live = useRef(world)
  live.current = world
  const doorsRef = useRef(doors)
  doorsRef.current = doors
  const lastShown = useRef(new Map<string, number>())
  const [held, setHeld] = useState<string | null>(null)
  const heldRef = useRef(held)
  heldRef.current = held
  /** Every tab a round put to sleep, until it is awake again or gone: `asleep` is this, less what is mounted. */
  const [slept, setSlept] = useState<ReadonlySet<string>>(NONE)
  const sleptRef = useRef(slept)
  sleptRef.current = slept

  // The stamp: a tab's clock starts when it leaves the front, and the front tab's when its window goes away (S10).
  const was = useRef(world.shown)
  useEffect(() => {
    if (was.current !== null && was.current !== world.shown) lastShown.current.set(was.current, Date.now())
    was.current = world.shown
  }, [world.shown])
  useEffect(() => {
    if (world.away && world.active !== null) lastShown.current.set(world.active, Date.now())
  }, [world.away, world.active])

  // The held tab wakes when its window comes back. Another tab made active while away: it sleeps as any other tab
  // does, out of `mounted`, so it never mounts in a window no one sees.
  useEffect(() => {
    if (held === null) return
    if (held !== world.active) doorsRef.current.sleep([held])
    if (held !== world.active || !world.away) setHeld(null)
  }, [held, world.active, world.away])

  const testSeconds = useMemo(() => testSleepSeconds(), [])
  const tickMs = testSeconds === null ? SLEEP_TICK_MS : Math.max(1000, testSeconds * 250)

  useEffect(() => {
    let alive = true
    let busy = false
    let lastTick = Date.now()
    const round = async (): Promise<void> => {
      const t = Date.now()
      const gap = t - lastTick
      lastTick = t
      const stamps = lastShown.current
      if (gap >= RESUME_GAP_TICKS * tickMs) {
        // The Mac slept (S9): the time away is no idle time.
        for (const id of stamps.keys()) stamps.set(id, t)
        return
      }
      if (busy) return
      const w = live.current
      const ids = new Set(w.tabs.map((tab) => tab.id))
      for (const id of [...stamps.keys()]) if (!ids.has(id)) stamps.delete(id)
      // A woken tab is no longer asleep; a closed one leaves its kept view behind.
      const keep = [...sleptRef.current].filter((id) => ids.has(id) && (!w.mounted.includes(id) || id === heldRef.current))
      if (keep.length !== sleptRef.current.size) {
        for (const id of sleptRef.current) if (!ids.has(id)) doorsRef.current.startView.delete(id)
        setSlept(new Set(keep))
      }
      const after = w.setting === 'never' ? null : testSeconds !== null ? testSeconds * 1000 : AFTER_MS[w.setting]
      if (after === null) return
      const dragging = draggedTab()
      const due: string[] = []
      for (const id of w.mounted) {
        if (id === heldRef.current) continue
        const at = stamps.get(id)
        // A tab with no stamp yet (one mounted at boot) starts its clock now.
        if (at === undefined) stamps.set(id, t)
        else if (t - at >= after && maySleep(id, w, dragging)) due.push(id)
      }
      if (due.length === 0) return
      busy = true
      try {
        const pathOf = (id: string): string | undefined => live.current.tabs.find((tab) => tab.id === id)?.path
        // Save first (D2): a save that fails leaves the file dirty, and the dirty check below keeps the tab awake.
        await Promise.all([...new Set(due.map(pathOf))].map((path) => (path === undefined ? undefined : flushRenamedPath(path).catch(() => undefined))))
        if (!alive) return
        const dirty = new Set(dirtyPaths())
        const now = live.current
        const still = draggedTab()
        const go = due.filter((id) => {
          const path = pathOf(id)
          return path !== undefined && !dirty.has(path) && now.mounted.includes(id) && maySleep(id, now, still)
        })
        if (go.length === 0) return
        for (const id of go) {
          const view = readPageView(id)
          if (view !== undefined) doorsRef.current.startView.set(id, view)
        }
        const back = go.filter((id) => id !== now.active)
        if (back.length > 0) doorsRef.current.sleep(back)
        if (back.length < go.length) setHeld(now.active)
        setSlept((s) => new Set([...s, ...go]))
      } finally {
        busy = false
      }
    }
    const timer = setInterval(() => void round(), tickMs)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [tickMs, testSeconds])

  const wake = useCallback((id: string) => {
    if (!sleptRef.current.has(id) || live.current.mounted.includes(id)) return
    lastShown.current.set(id, Date.now())
    doorsRef.current.wake(id)
  }, [])

  const { mounted, tabs } = world
  const asleep = useMemo(() => {
    if (slept.size === 0) return NONE
    const ids = new Set(tabs.map((tab) => tab.id))
    return new Set([...slept].filter((id) => ids.has(id) && (!mounted.includes(id) || id === held)))
  }, [slept, mounted, tabs, held])

  return { asleep, held, wake }
}
