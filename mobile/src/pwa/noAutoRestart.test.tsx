// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { hasAnyUnsentDraft, keepDraft } from '../page/comments/unsentDrafts'
import type { AppMoment } from './safeMoment'
import { SKIP_WAITING, STATE_ASK, chooseVersion, wire, type ShellBuild, type WorkerState } from './swCore'
import { fakeCaches, fakeScope, fakeServer } from './testing'
import { UpdateLineView } from './UpdateLine'
import { createUpdates, type SwContainerLike, type SwRegistrationLike, type SwWorkerLike } from './updates'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * YAZ-5555 (Yaseen's decision): NOTHING restarts by itself. Whenever a new build is there, "A new version is ready" with
 * Restart shows, on a cold start and on a return; only the tap loads it, and never over waiting answers or words in a
 * comment box (the line then says why). The REAL page side (`createUpdates`) and line, a fake service worker (a build
 * waiting, or one the browser activated at a cold start), fake visibility and clock; and the REAL worker logic for
 * the cold start (it keeps serving the chosen build).
 */

type Fn = () => void
function fakeWorker() {
  const sent: unknown[] = []
  const w: SwWorkerLike & { sent: unknown[] } = { state: 'installed', sent, postMessage: (m) => void sent.push(m), addEventListener: () => {} }
  return w
}
function fakeContainer(waiting: SwWorkerLike | null) {
  const changes: Fn[] = []
  const reg: SwRegistrationLike = { waiting, installing: null, update: async () => {}, addEventListener: () => {} }
  const c: SwContainerLike & { takeOver(): void } = {
    controller: {},
    getRegistration: async () => reg,
    register: async () => reg,
    addEventListener: (_type, fn) => void changes.push(fn),
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

/** The app open on its tabs, with a build waiting (`waiting`) or one the browser activated at a cold start (`state`). */
async function app(opts: { moment?: Partial<AppMoment>; answers?: () => Promise<number>; waiting?: boolean; state?: () => Promise<WorkerState | null> } = {}) {
  const waiting = opts.waiting === false ? null : fakeWorker()
  const container = fakeContainer(waiting)
  const clock = { t: 0 }
  let reloads = 0
  const updates = createUpdates({ container, reload: () => reloads++, now: () => clock.t, readState: opts.state })
  await updates.start()
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const props = { updates, moment: { ...calm, ...opts.moment }, readWaiting: opts.answers ?? (async () => 0), unsentText: hasAnyUnsentDraft }
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
  const away = async (ms: number) => {
    await visibility('hidden')
    clock.t += ms
    await visibility('visible')
  }
  const tap = async () => {
    await act(async () => host.querySelector('button')!.click())
    await act(async () => {})
  }
  return { waiting, container, away, tap, reloads: () => reloads, text: () => host.textContent ?? '', button: () => host.querySelector('button') }
}

describe('YAZ-5555: nothing restarts by itself; the prompt shows', () => {
  it('a cold start with a build waiting: the prompt shows; nothing is sent to the worker, nothing reloads', async () => {
    const a = await app()
    expect(a.text()).toBe('A new version is ready.Restart')
    expect(a.waiting!.sent).toEqual([])
    expect(a.reloads()).toBe(0)
  })

  it('a cold start after the browser activated the new build (the worker keeps the chosen one): the prompt shows', async () => {
    const a = await app({ waiting: false, state: async () => ({ active: 'v2', chosen: 'v1' }) })
    expect(a.text()).toBe('A new version is ready.Restart')
    expect(a.reloads()).toBe(0)
    await a.tap()
    expect(a.reloads()).toBe(1)
  })

  it('away 30 s, 5 minutes, a day, and back: never a reload; the prompt is still there', async () => {
    const a = await app()
    for (const ms of [30_000, 5 * 60_000, 24 * 60 * 60_000]) await a.away(ms)
    // Even when the waiting build took over meanwhile (another tab sent the message).
    a.container.takeOver()
    await a.away(10 * 60_000)
    expect(a.reloads()).toBe(0)
    expect(a.waiting!.sent).toEqual([])
    expect(a.text()).toBe('A new version is ready.Restart')
  })

  it('a build that comes while the app is away shows on the return (the state is read again)', async () => {
    let state: WorkerState | null = { active: 'v1', chosen: 'v1' }
    const a = await app({ waiting: false, state: async () => state })
    expect(a.text()).toBe('')
    state = { active: 'v2', chosen: 'v1' }
    await a.away(60_000)
    expect(a.text()).toBe('A new version is ready.Restart')
    expect(a.reloads()).toBe(0)
  })

  it('a tap on Restart: the waiting build takes over, then the page loads it once', async () => {
    const a = await app()
    await a.tap()
    expect(a.waiting!.sent).toEqual([{ type: SKIP_WAITING }])
    expect(a.reloads()).toBe(0)
    a.container.takeOver()
    expect(a.reloads()).toBe(1)
  })

  it('words in a comment box: no button; the line says why; nothing reloads. Cleared, Restart shows again', async () => {
    keepDraft('notes/idea.md', 'Half a thought')
    const a = await app()
    expect(a.text()).toBe('A new version is ready. Restart after you send or clear your comment.')
    expect(a.button()).toBeNull()
    await a.away(60 * 60_000)
    expect(a.reloads()).toBe(0)
    keepDraft('notes/idea.md', '')
    await a.away(1000)
    expect(a.button()?.textContent).toBe('Restart')
  })

  it('answers waiting: no button; the line says why; a tap that finds answers at the last moment does nothing', async () => {
    let answers = 2
    const a = await app({ answers: async () => answers })
    expect(a.text()).toBe('A new version is ready. Restart after your answers are sent.')
    answers = 0
    await a.away(1000)
    expect(a.button()?.textContent).toBe('Restart')
    answers = 1
    await a.tap()
    expect(a.waiting!.sent).toEqual([])
    expect(a.text()).toBe('A new version is ready. Restart after your answers are sent.')
  })
})

describe('YAZ-5555: the worker never switches the build at a cold start', () => {
  const ORIGIN = 'https://notecards.test'
  const site = (v: string) => {
    const entry = `/assets/index-${v}.js`
    const files = { '/': { body: `<script type="module" src="${entry}"></script>` }, [entry]: { body: v } }
    const build: ShellBuild = { version: v, entry, files: Object.keys(files), pages: { '/': entry } }
    return { files, build }
  }
  it('v2 activates by itself (no page of v1 left), yet the open gets v1 and the state says a new one is ready; the Restart open gets v2', async () => {
    const caches = fakeCaches()
    for (const v of ['v1', 'v2']) {
      const { files, build } = site(v)
      const sw = fakeScope(fakeServer(files, ORIGIN), caches)
      wire(sw.scope, build)
      await sw.install()
      if (v === 'v1') await chooseVersion(caches, 'v1')
      await sw.activate()
      if (v === 'v1') continue
      expect(await (await sw.request(`${ORIGIN}/`, { mode: 'navigate', resultingClientId: 'A' }))!.text()).toContain('index-v1.js')
      const got: unknown[] = []
      await sw.message({ type: STATE_ASK }, [{ postMessage: (m: unknown) => void got.push(m) }])
      expect(got).toEqual([{ active: 'v2', chosen: 'v1' }])
      expect(await (await sw.request(`${ORIGIN}/?notecards-update=1`, { mode: 'navigate', resultingClientId: 'B' }))!.text()).toContain('index-v2.js')
    }
  })
})
