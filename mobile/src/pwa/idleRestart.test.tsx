// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { hasAnyUnsentDraft, keepDraft } from '../page/comments/unsentDrafts'
import { RESUME_AFTER_MS, holdsOf, swapNow, type AppMoment } from './safeMoment'
import { SKIP_WAITING } from './swCore'
import { UpdateLineView } from './UpdateLine'
import { createUpdates, swapAtStart, type SwContainerLike, type SwRegistrationLike, type SwWorkerLike } from './updates'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * YAZ-5555: a new build that waits restarts the app BY ITSELF when it is idle: the first return to the foreground after
 * 30 s or more hidden (or a cold start), only when nothing is unsaved. The REAL page side (`createUpdates`) on a fake
 * service worker (a waiting version, its takeover), the real line, and fake visibility and clock.
 */

type Fn = () => void
function fakeWorker() {
  const sent: unknown[] = []
  const w: SwWorkerLike & { sent: unknown[] } = { state: 'installed', sent, postMessage: (m) => void sent.push(m), addEventListener: () => {} }
  return w
}
function fakeContainer(waiting: SwWorkerLike) {
  const changes: Fn[] = []
  const reg: SwRegistrationLike = { waiting, installing: null, update: async () => {}, addEventListener: () => {} }
  const c: SwContainerLike & { takeOver(): void } = {
    controller: {},
    getRegistration: async () => reg,
    register: async () => reg,
    addEventListener: (_type, fn) => void changes.push(fn),
    // The waiting worker took over (after its SKIP_WAITING): the browser fires `controllerchange`.
    takeOver: () => changes.forEach((f) => f()),
  }
  return c
}

const calm: AppMoment = { phase: 'ready', routeOpen: false, tab: 'friends', downloading: false, answersWaiting: 0 }
let cleanup: (() => void) | null = null
afterEach(() => {
  cleanup?.()
  cleanup = null
  keepDraft('notes/idea.md', '')
})

async function app(opts: { moment?: Partial<AppMoment>; answers?: () => Promise<number>; writes?: () => Promise<number> } = {}) {
  const waiting = fakeWorker()
  const container = fakeContainer(waiting)
  const clock = { t: 0 }
  let reloads = 0
  const updates = createUpdates({ container, reload: () => reloads++, now: () => clock.t })
  await updates.start()
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const props = { updates, moment: { ...calm, ...opts.moment }, readWaiting: opts.answers ?? (async () => 0), readWrites: opts.writes ?? (async () => 0), unsentText: hasAnyUnsentDraft, now: () => clock.t }
  await act(async () => root.render(<UpdateLineView {...props} />))
  await act(async () => {})
  cleanup = () => {
    act(() => root.unmount())
    host.remove()
  }
  const visibility = async (state: 'hidden' | 'visible') => {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
    await act(async () => void document.dispatchEvent(new Event('visibilitychange')))
    await act(async () => {})
  }
  /** Away for `ms`: hidden (the waiting version is told to take over, and does), then back. */
  const away = async (ms: number) => {
    await visibility('hidden')
    container.takeOver()
    clock.t += ms
    await visibility('visible')
  }
  return { waiting, container, host, away, reloads: () => reloads, text: () => host.textContent ?? '', button: () => host.querySelector('button') }
}

describe('YAZ-5555: the restart by itself when the app is idle', () => {
  it('the rule: 30 s hidden is idle; less is not', () => {
    expect(RESUME_AFTER_MS).toBe(30_000)
    expect(swapNow({ ready: true, trigger: 'resume', holds: [], hiddenMs: 30_000 })).toBe(true)
    expect(swapNow({ ready: true, trigger: 'resume', holds: [], hiddenMs: 29_999 })).toBe(false)
  })

  it('"A new version is ready" shows; hidden 30 s and back, with nothing unsaved: it restarts into the new build, once', async () => {
    const a = await app()
    expect(a.text()).toBe('A new version is ready.Restart')
    await a.away(RESUME_AFTER_MS)
    expect(a.waiting.sent).toEqual([{ type: SKIP_WAITING }])
    expect(a.reloads()).toBe(1)
  })

  it('back after 29 s: no restart; the next return after 30 s or more does it', async () => {
    const a = await app()
    await a.away(RESUME_AFTER_MS - 1000)
    expect(a.reloads()).toBe(0)
    expect(a.text()).toContain('A new version is ready.')
    await a.away(RESUME_AFTER_MS)
    expect(a.reloads()).toBe(1)
  })

  it('a comment box with words not sent: no restart by itself (and no Restart button); cleared, the next return restarts', async () => {
    keepDraft('notes/idea.md', 'Half a thought')
    const a = await app()
    expect(a.text()).toBe('A new version is ready. It starts after you send or clear your comment.')
    expect(a.button()).toBeNull()
    await a.away(RESUME_AFTER_MS * 10)
    expect(a.reloads()).toBe(0)
    keepDraft('notes/idea.md', '')
    await a.away(RESUME_AFTER_MS)
    expect(a.reloads()).toBe(1)
  })

  it('comments or friends removes that wait to be written: no restart by itself; Restart (the active case) still works', async () => {
    let writes = 2
    const a = await app({ writes: async () => writes })
    await a.away(RESUME_AFTER_MS * 10)
    expect(a.reloads()).toBe(0)
    expect(a.button()?.textContent).toBe('Restart')
    await act(async () => a.button()!.click())
    await act(async () => {})
    expect(a.reloads()).toBe(1)
    writes = 0
  })

  it('answers that wait: never (not by itself, and no Restart)', async () => {
    const a = await app({ answers: async () => 1 })
    await a.away(RESUME_AFTER_MS * 10)
    expect(a.reloads()).toBe(0)
    expect(a.button()).toBeNull()
  })

  it('a write list that cannot be read counts as waiting: no restart by itself', async () => {
    const a = await app({ writes: async () => Promise.reject(new Error('store closed')) })
    await a.away(RESUME_AFTER_MS * 10)
    expect(a.reloads()).toBe(0)
  })

  it('a screen or a form over the tabs, a review in progress: no restart by itself', async () => {
    for (const moment of [{ routeOpen: true }, { reviewInProgress: true }, { phase: 'sign-in' as const }]) {
      const a = await app({ moment })
      await a.away(RESUME_AFTER_MS * 10)
      expect([moment, a.reloads()]).toEqual([moment, 0])
      cleanup!()
      cleanup = null
    }
  })

  it('the holds of the rule: writes and typing hold a return; a tap ignores waiting writes, never words in a box', () => {
    expect(holdsOf({ ...calm, writesWaiting: 1 })).toEqual(['writes'])
    expect(holdsOf({ ...calm, unsentText: true })).toEqual(['typing'])
    expect(swapNow({ ready: true, trigger: 'tap', holds: ['writes'], hiddenMs: 0 })).toBe(true)
    expect(swapNow({ ready: true, trigger: 'tap', holds: ['typing'], hiddenMs: 0 })).toBe(false)
    expect(swapNow({ ready: true, trigger: 'resume', holds: ['writes'], hiddenMs: RESUME_AFTER_MS })).toBe(false)
  })

  it('a cold start with a build waiting: it starts the new build before the app runs', async () => {
    const waiting = fakeWorker()
    const container = fakeContainer(waiting)
    let reloads = 0
    const swapping = swapAtStart(container, () => reloads++, 1000)
    await Promise.resolve()
    await Promise.resolve()
    expect(waiting.sent).toEqual([{ type: SKIP_WAITING }])
    container.takeOver()
    expect(await swapping).toBe(true)
    expect(reloads).toBe(1)
  })
})
