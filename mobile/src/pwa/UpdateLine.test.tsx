// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { RESUME_AFTER_MS, type AppMoment } from './safeMoment'
import { UpdateLineView } from './UpdateLine'
import type { Updates } from './updates'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** The "A new version is ready" line (YAZ-5087) and its safe moment, with a fake update and a fake answer list. */

function fakeUpdates(ready: boolean) {
  const fns = new Set<() => void>()
  let took = false
  const u: Updates & { applied: number; checks: number; prepared: number; set(r: boolean): void; takeOver(): void } = {
    applied: 0,
    checks: 0,
    prepared: 0,
    tookOver: () => took,
    prepare: () => void u.prepared++,
    takeOver: () => void (took = true),
    start: async () => {},
    ready: () => ready,
    subscribe: (fn) => (fns.add(fn), () => void fns.delete(fn)),
    apply: () => void u.applied++,
    check: async () => void u.checks++,
    set(r) {
      ready = r
      fns.forEach((f) => f())
    },
  }
  return u
}

const calm: AppMoment = { phase: 'ready', routeOpen: false, tab: 'friends', downloading: false, answersWaiting: 0 }
let cleanup: (() => void) | null = null
afterEach(() => {
  cleanup?.()
  cleanup = null
})

async function draw(updates: Updates, moment: Partial<AppMoment> = {}, waiting = 0, now = { t: 0 }) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const props = { updates, moment: { ...calm, ...moment }, readWaiting: async () => waiting, now: () => now.t }
  await act(async () => root.render(<UpdateLineView {...props} />))
  await act(async () => {})
  cleanup = () => {
    act(() => root.unmount())
    host.remove()
  }
  return { host, text: () => host.textContent ?? '', button: () => host.querySelector('button') }
}

const visibility = async (state: 'hidden' | 'visible') => {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  await act(async () => void document.dispatchEvent(new Event('visibilitychange')))
  await act(async () => {})
}

describe('the update line', () => {
  it('nothing when no new version waits', async () => {
    const d = await draw(fakeUpdates(false))
    expect(d.text()).toBe('')
  })

  it('"A new version is ready." with Restart; Restart makes it take over', async () => {
    const u = fakeUpdates(true)
    const d = await draw(u)
    expect(d.text()).toContain('A new version is ready.')
    await act(async () => d.button()!.click())
    await act(async () => {})
    expect(u.applied).toBe(1)
  })

  it('shows up when the new version becomes ready while the app is open', async () => {
    const u = fakeUpdates(false)
    const d = await draw(u)
    await act(async () => u.set(true))
    await act(async () => {})
    expect(d.text()).toContain('A new version is ready.')
  })

  it('answers wait: it says it starts after they are sent, with no button, and nothing takes over', async () => {
    const u = fakeUpdates(true)
    const d = await draw(u, {}, 2)
    expect(d.text()).toBe('A new version is ready. It starts after your answers are sent.')
    expect(d.button()).toBeNull()
    expect(u.applied).toBe(0)
  })

  it('not over a screen or the sign-in (only on the tabs)', async () => {
    expect((await draw(fakeUpdates(true), { routeOpen: true })).text()).toBe('')
  })

  it('to the background: the waiting version is told to take over (no reload: the open page keeps its files)', async () => {
    const u = fakeUpdates(true)
    await draw(u, { tab: 'review' }, 3)
    await visibility('hidden')
    expect(u.prepared).toBe(1)
    expect(u.applied).toBe(0)
  })

  it(`back from the background after ${RESUME_AFTER_MS / 60_000} minutes on a calm tab, once the new version took over: the page loads it; it asks for a newer version`, async () => {
    const u = fakeUpdates(true)
    const now = { t: 0 }
    await draw(u, {}, 0, now)
    await visibility('hidden')
    u.takeOver()
    now.t = RESUME_AFTER_MS
    await visibility('visible')
    expect(u.checks).toBe(1)
    expect(u.applied).toBe(1)
  })

  it('back from the background, but the new version did not take over yet: no reload (it could come in the middle of what the person starts)', async () => {
    const u = fakeUpdates(true)
    const now = { t: 0 }
    await draw(u, {}, 0, now)
    await visibility('hidden')
    now.t = RESUME_AFTER_MS * 2
    await visibility('visible')
    expect(u.applied).toBe(0)
  })

  it('back from the background on the Review tab, or after a short time: no takeover', async () => {
    const u = fakeUpdates(true)
    const now = { t: 0 }
    await draw(u, { tab: 'review' }, 0, now)
    await visibility('hidden')
    u.takeOver()
    now.t = RESUME_AFTER_MS * 3
    await visibility('visible')
    expect(u.applied).toBe(0)
    cleanup!()
    const v = fakeUpdates(true)
    await draw(v, {}, 0, now)
    await visibility('hidden')
    v.takeOver()
    now.t += 1000
    await visibility('visible')
    expect(v.applied).toBe(0)
  })
})
