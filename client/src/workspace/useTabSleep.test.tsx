/**
 * Tab sleep's clock and rules (YAZ-3737 5A; D2, D5, S9, S10, S20, S21): which tabs sleep, that each saves first and
 * a dirty one (a save conflict) stays awake, that the view each sleeps with goes to `startView`, that the Mac's own
 * sleep does not count, and that a hidden window's front tab sleeps as a held layer. The workspace doors are spies:
 * the reducer's side is `useWorkspace.test.tsx`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { PageView, TabSleepAfter } from '@shared/types'
import { registerPageView } from '../lib/pageView'
import { _resetRenameContinuity, registerRenameContinuity, type RenameContinuityHandle } from '../lib/renameContinuity'
import { RESUME_GAP_TICKS, SLEEP_TICK_MS, testSleepSeconds, useTabSleep, type SleepWorld, type TabSleep } from './useTabSleep'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const MIN = 60_000
const TABS = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, path: `/v/${id}.md` }))

let reactRoot: Root | null = null
let latest: TabSleep
let startView: Map<string, PageView>
let setWorld: (next: (w: SleepWorld) => SleepWorld) => void = () => undefined
/** The workspace's doors, as the reducer does them: `sleep` keeps the active tab mounted. */
const sleep = vi.fn<(ids: readonly string[]) => void>((ids) => setWorld((w) => ({ ...w, mounted: w.mounted.filter((id) => id === w.active || !ids.includes(id)) })))
const wake = vi.fn<(id: string) => void>((id) => setWorld((w) => ({ ...w, mounted: [...w.mounted, id] })))

function Probe({ initial }: { initial: SleepWorld }) {
  const [w, set] = useState(initial)
  setWorld = set
  latest = useTabSleep(w, { startView, sleep, wake })
  return null
}

const world = (over: Partial<SleepWorld> = {}): SleepWorld => ({ setting: '15m' as TabSleepAfter, tabs: TABS, mounted: TABS.map((t) => t.id), active: 'a', shown: 'a', boardOpen: false, review: null, away: false, ...over })
/** The first render takes the whole world; after it, `change` moves only what a test names, as App's renders do. */
const render = (w: SleepWorld): void => act(() => reactRoot?.render(<Probe initial={w} />))
const change = (over: Partial<SleepWorld>): void => act(() => setWorld((w) => ({ ...w, ...over })))
/** Time goes by one round at a time, each in its own act, so App would have rendered between two rounds. */
const pass = async (ms: number): Promise<void> => {
  for (let left = ms; left > 0; left -= SLEEP_TICK_MS) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(Math.min(left, SLEEP_TICK_MS))
    })
  }
}

/** A tab's editor as the rename map sees it: a save that may stay dirty (a conflict). */
function editor(path: string, dirty: () => boolean): RenameContinuityHandle & { flushes: number } {
  const h = { flushes: 0, flush: async () => void h.flushes++, capture: () => null, retire: () => undefined, dirty }
  registerRenameContinuity(path, h)
  return h
}

/** A tab layer with a page view reader, as an editor registers it. */
function layer(id: string, view: PageView): void {
  const el = document.createElement('div')
  el.dataset.tab = id
  el.innerHTML = '<div class="editor-host"></div>'
  document.body.appendChild(el)
  registerPageView(el.firstElementChild!, () => view)
}

const VIEW_B: PageView = { scrollTop: 300, zoomKey: null, folds: ['x:0'], magnification: 125, selection: { anchor: 4, head: 9 } }

beforeEach(() => {
  vi.useFakeTimers()
  startView = new Map()
  reactRoot = createRoot(document.createElement('div'))
})

afterEach(() => {
  act(() => reactRoot?.unmount())
  reactRoot = null
  document.body.innerHTML = ''
  _resetRenameContinuity()
  sleep.mockReset()
  wake.mockReset()
  vi.useRealTimers()
})

describe('who sleeps, and when (D5, S21)', () => {
  it('a tab unseen for the setting sleeps, saved first, with its view kept; never the active one, the review layer or a dragged tab; ONE change per round', async () => {
    const b = editor('/v/b.md', () => false)
    layer('b', VIEW_B)
    const dragged = document.createElement('div')
    dragged.className = 'tabbar__tab tabbar__tab--dragging'
    dragged.dataset.tab = 'e'
    document.body.appendChild(dragged)
    render(world({ review: 'd' }))
    await pass(SLEEP_TICK_MS) // the first round starts every clock
    await pass(14 * MIN)
    expect(sleep).not.toHaveBeenCalled()
    await pass(MIN)
    expect(b.flushes).toBe(1)
    expect(sleep.mock.calls).toEqual([[['b', 'c']]])
    expect(startView.get('b')).toEqual(VIEW_B)
    // c has no editor that answers (a PDF, an image): it sleeps with no view.
    expect(startView.has('c')).toBe(false)
  })

  it('nothing sleeps while the tab board shows, or with "Never"', async () => {
    render(world({ boardOpen: true }))
    await pass(20 * MIN)
    expect(sleep).not.toHaveBeenCalled()
    change({ boardOpen: false, setting: 'never' })
    await pass(3 * 60 * MIN)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('a tab\'s clock starts when it leaves the front: the one just left waits its full time again', async () => {
    render(world({ mounted: ['a', 'b'] }))
    await pass(10 * MIN)
    change({ active: 'b', shown: 'b' })
    await pass(14 * MIN)
    expect(sleep).not.toHaveBeenCalled()
    await pass(2 * MIN)
    expect(sleep.mock.calls).toEqual([[['a']]])
  })
})

describe('save first (D2)', () => {
  it('a tab whose save stays dirty (a conflict) stays awake and tries again next round; clean, it sleeps', async () => {
    let conflict = true
    const c = editor('/v/c.md', () => conflict)
    render(world({ mounted: ['a', 'c'] }))
    await pass(16 * MIN)
    expect(c.flushes).toBeGreaterThan(0)
    expect(sleep).not.toHaveBeenCalled()
    conflict = false
    await pass(SLEEP_TICK_MS)
    expect(sleep.mock.calls).toEqual([[['c']]])
  })

  it('S20: two copies of one file, one in front and typing — the copy behind waits for the shared file to be clean', async () => {
    let typing = true
    const tabs = [{ id: 'front', path: '/v/n.md' }, { id: 'twin', path: '/v/n.md' }]
    const front = editor('/v/n.md', () => typing)
    const twin = editor('/v/n.md', () => false)
    render(world({ tabs, mounted: ['front', 'twin'], active: 'front', shown: 'front' }))
    await pass(16 * MIN)
    // The save reaches both copies (`flushRenamedPath`); the file is still dirty, so the twin stays.
    expect(front.flushes).toBeGreaterThan(0)
    expect(twin.flushes).toBeGreaterThan(0)
    expect(sleep).not.toHaveBeenCalled()
    typing = false
    await pass(SLEEP_TICK_MS)
    expect(sleep.mock.calls).toEqual([[['twin']]])
  })
})

describe('the Mac\'s own sleep is no idle time (S9)', () => {
  it(`a gap of ${RESUME_GAP_TICKS} ticks or more between rounds starts every clock again`, async () => {
    render(world({ mounted: ['a', 'b'] }))
    await pass(SLEEP_TICK_MS)
    await pass(10 * MIN)
    // The lid closes for two hours: this page's timer stops, and the next round sees the wall clock jump.
    vi.setSystemTime(Date.now() + 120 * MIN)
    await pass(SLEEP_TICK_MS)
    expect(sleep).not.toHaveBeenCalled()
    await pass(14 * MIN)
    expect(sleep).not.toHaveBeenCalled()
    await pass(MIN)
    expect(sleep.mock.calls).toEqual([[['b']]])
  })
})

describe('a hidden or minimized window (S10)', () => {
  it('its front tab sleeps too, as a held layer that stays in `mounted`; the window back, it wakes', async () => {
    render(world({ mounted: ['a'] }))
    await pass(20 * MIN)
    change({ away: true })
    await pass(14 * MIN)
    expect(latest.held).toBeNull()
    await pass(2 * MIN)
    expect(latest.held).toBe('a')
    expect(latest.asleep).toEqual(new Set(['a']))
    expect(sleep).not.toHaveBeenCalled()
    change({ away: false })
    expect(latest.held).toBeNull()
    expect(latest.asleep.size).toBe(0)
  })

  it('another tab made active while the window is away: the held tab sleeps the ordinary way, out of `mounted`', async () => {
    render(world({ mounted: ['a', 'b'], away: true }))
    await pass(17 * MIN)
    expect(latest.held).toBe('a')
    // b slept in that round too; the window's own board or a menu then makes it active, and it mounts.
    expect(sleep.mock.calls).toEqual([[['b']]])
    sleep.mockClear()
    change({ active: 'b', shown: 'b', mounted: ['a', 'b'] })
    expect(sleep.mock.calls).toEqual([[['a']]])
    expect(latest.held).toBeNull()
  })
})

describe('the zzz mark and the hover wake (D11, S7)', () => {
  it('`asleep` is the tabs a round put to sleep that are not mounted again; `wake` mounts only a sleeping tab, and its clock starts over', async () => {
    render(world({ mounted: ['a', 'b', 'c'] }))
    await pass(17 * MIN)
    expect(sleep.mock.calls).toEqual([[['b', 'c']]])
    expect(latest.asleep).toEqual(new Set(['b', 'c']))
    act(() => latest.wake('a'))
    expect(wake).not.toHaveBeenCalled()
    act(() => latest.wake('b'))
    expect(wake.mock.calls).toEqual([['b']])
    expect(latest.asleep).toEqual(new Set(['c']))
    // The woken tab waits its full time again.
    sleep.mockClear()
    await pass(14 * MIN)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('a kept view of a tab that is gone goes at the second round that misses it: a slept tab closed, a reload\'s view of a tab closed before it mounted (YAZ-3870)', async () => {
    layer('b', VIEW_B)
    render(world({ mounted: ['a', 'b'] }))
    await pass(17 * MIN)
    expect(startView.has('b')).toBe(true)
    // A memory reload gave 'c' a view (D4); 'c' closes before it ever mounts. 'b' closes asleep.
    startView.set('c', VIEW_B)
    change({ tabs: TABS.filter((t) => t.id === 'a') })
    await pass(SLEEP_TICK_MS)
    expect([startView.has('b'), startView.has('c')]).toEqual([true, true]) // one miss: a moved tab's view may be just before its render
    await pass(SLEEP_TICK_MS)
    expect([startView.has('b'), startView.has('c')]).toEqual([false, false])
    // A view whose tab shows up by the next round stays.
    startView.set('n', VIEW_B)
    await pass(SLEEP_TICK_MS)
    change({ tabs: [...TABS.filter((t) => t.id === 'a'), { id: 'n', path: '/v/n.md' }] })
    await pass(2 * SLEEP_TICK_MS)
    expect(startView.has('n')).toBe(true)
  })
})

it('the perf harness\'s clock (`?sleepSeconds=`, set by main under YASEEN_DOCS_E2E=1 only)', () => {
  expect(testSleepSeconds('?win=w1&sleepSeconds=20')).toBe(20)
  expect(testSleepSeconds('?win=w1')).toBeNull()
  expect(testSleepSeconds('?sleepSeconds=x')).toBeNull()
})
