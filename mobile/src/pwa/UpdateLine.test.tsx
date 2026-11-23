// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import type { AppMoment } from './safeMoment'
import { UpdateLineView } from './UpdateLine'
import type { Updates } from './updates'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** The "A new version is ready" line (YAZ-5087) and its rule (YAZ-5555: only a tap), with a fake update and a fake answer list. */

function fakeUpdates(ready: boolean) {
  const fns = new Set<() => void>()
  let took = false
  const u: Updates & { applied: number; checks: number; set(r: boolean): void; takeOver(): void } = {
    applied: 0,
    checks: 0,
    tookOver: () => took,
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

async function draw(updates: Updates, moment: Partial<AppMoment> = {}, waiting = 0) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const props = { updates, moment: { ...calm, ...moment }, readWaiting: async () => waiting }
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

  it('answers wait: it says to restart after they are sent, with no button, and nothing takes over', async () => {
    const u = fakeUpdates(true)
    const d = await draw(u, {}, 2)
    expect(d.text()).toBe('A new version is ready. Restart after your answers are sent.')
    expect(d.button()).toBeNull()
    expect(u.applied).toBe(0)
  })

  it('not over a screen or the sign-in (only on the tabs)', async () => {
    expect((await draw(fakeUpdates(true), { routeOpen: true })).text()).toBe('')
  })

  it('YAZ-5555: to the background and back, after any time, on any tab: nothing takes over; it asks for a newer version', async () => {
    for (const tab of ['friends', 'review', 'search'] as const) {
      const u = fakeUpdates(true)
      const d = await draw(u, { tab })
      u.takeOver()
      await visibility('hidden')
      await visibility('visible')
      expect([tab, u.applied, u.checks]).toEqual([tab, 0, 1])
      expect(d.text()).toBe('A new version is ready.Restart')
      cleanup!()
      cleanup = null
    }
  })

  it('YAZ-5269: a review in progress behind another tab: Restart still works (the person chose it)', async () => {
    const u = fakeUpdates(true)
    const d = await draw(u, { tab: 'friends', reviewInProgress: true })
    await act(async () => d.button()!.click())
    await act(async () => {})
    expect(u.applied).toBe(1)
  })
})
