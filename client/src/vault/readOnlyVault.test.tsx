/**
 * `useReadOnlyVault` (YAZ-4939): a vault's `.yaseendocs/read-only.json`, read once per root, re-read on that file's
 * change broadcast, Off with no file; the vault's unlock (YAZ-5581: "Unlock for 10 minutes" · "1 hour" · "Until I lock it"),
 * in memory only, shared by the windows of one vault. The bridge is mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { VaultConfigChange } from '@shared/types'
import { DEFAULT_READ_ONLY_VAULT, READ_ONLY_VAULT_FILE, VAULT_UNLOCK_MS, sanitizeReadOnlyVault, useReadOnlyVault, type ReadOnlyVaultState } from './readOnlyVault'

let listeners: Array<(c: VaultConfigChange) => void> = []

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: {
    vaultConfig: {
      read: vi.fn(),
      write: vi.fn(),
      onChange: vi.fn((l: (c: VaultConfigChange) => void) => {
        listeners.push(l)
        return () => (listeners = listeners.filter((x) => x !== l))
      }),
    },
  },
}))

import { api } from '../api'

const read = vi.mocked(api.vaultConfig.read)
const write = vi.mocked(api.vaultConfig.write)

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let state: ReadOnlyVaultState

function Probe({ vault }: { vault: string | null }) {
  state = useReadOnlyVault(vault)
  return null
}

async function mount(vault: string | null): Promise<void> {
  root = createRoot(document.createElement('div'))
  await act(async () => root?.render(<Probe vault={vault} />))
}

beforeEach(() => {
  listeners = []
  read.mockReset().mockResolvedValue(null)
  write.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  vi.useRealTimers()
})

describe('useReadOnlyVault', () => {
  it('an old vault (no read-only.json) reads Off and nothing is written; no call at all with no vault open', async () => {
    await mount('/vault')
    expect(read).toHaveBeenCalledWith('/vault', READ_ONLY_VAULT_FILE)
    expect(state.settings).toEqual(DEFAULT_READ_ONLY_VAULT)
    expect(state.settings.on).toBe(false)
    expect(write).not.toHaveBeenCalled()
    act(() => root?.unmount())
    read.mockClear()
    await mount(null)
    expect(read).not.toHaveBeenCalled()
    expect(state.settings.on).toBe(false)
  })

  it('only `on: true` counts; anything else is Off', () => {
    expect(sanitizeReadOnlyVault({ on: true })).toEqual({ on: true })
    expect(sanitizeReadOnlyVault({ on: 'yes' })).toEqual({ on: false })
    expect(sanitizeReadOnlyVault({ on: 1 })).toEqual({ on: false })
    expect(sanitizeReadOnlyVault(null)).toEqual({ on: false })
    expect(sanitizeReadOnlyVault('on')).toEqual({ on: false })
  })

  it('the round trip: save shows On at once and writes only the settings file; a change broadcast re-reads this vault\'s file only', async () => {
    await mount('/vault')
    await act(async () => state.save({ on: true }))
    expect(state.settings).toEqual({ on: true })
    expect(write).toHaveBeenCalledWith('/vault', READ_ONLY_VAULT_FILE, { on: true })
    read.mockResolvedValue({ on: false })
    await act(async () => listeners.forEach((l) => l({ root: '/other', name: READ_ONLY_VAULT_FILE })))
    await act(async () => listeners.forEach((l) => l({ root: '/vault', name: 'link-click.json' })))
    expect(state.settings.on).toBe(true)
    await act(async () => listeners.forEach((l) => l({ root: '/vault', name: READ_ONLY_VAULT_FILE })))
    expect(state.settings.on).toBe(false)
  })

  it('a write the disk refused: the file is read again, and what it says shows', async () => {
    read.mockResolvedValue({ on: true })
    await mount('/vault')
    write.mockRejectedValue(new Error('EACCES'))
    read.mockResolvedValue({ on: true })
    await act(async () => state.save({ on: false }))
    expect(state.settings.on).toBe(true)
  })

  it('YAZ-5581: Off, nothing is locked; On, the vault locks until "Unlock for 10 minutes" (the default), which opens file actions and every surface (`locked` false) that long; at zero it locks again by itself', async () => {
    vi.useFakeTimers()
    await mount('/vault')
    expect([state.fileActionsAllowed(), state.locked]).toEqual([true, false])
    await act(async () => state.save({ on: true }))
    expect([state.fileActionsAllowed(), state.locked, state.unlockedUntil]).toEqual([false, true, null])
    act(() => state.unlock())
    expect([state.fileActionsAllowed(), state.locked]).toEqual([true, false])
    expect(VAULT_UNLOCK_MS.ten).toBe(10 * 60_000)
    expect(state.unlockedUntil).toBe(Date.now() + VAULT_UNLOCK_MS.ten)
    act(() => vi.advanceTimersByTime(VAULT_UNLOCK_MS.ten - 1))
    expect(state.locked).toBe(false)
    await act(async () => vi.advanceTimersByTime(1))
    expect([state.fileActionsAllowed(), state.locked, state.unlockedUntil]).toEqual([false, true, null])
    // One timer runs while a timed unlock does, none after it.
    expect(vi.getTimerCount()).toBe(0)
    act(() => state.unlock('hour'))
    expect(state.unlockedUntil).toBe(Date.now() + 60 * 60_000)
    expect(vi.getTimerCount()).toBe(1)
    await act(async () => state.lock())
    expect([state.fileActionsAllowed(), state.locked, state.unlockedUntil, vi.getTimerCount()]).toEqual([false, true, null, 0])
    // Nothing of it is ever written: read-only.json says On all along.
    expect(write.mock.calls).toEqual([['/vault', READ_ONLY_VAULT_FILE, { on: true }]])
  })

  it('YAZ-5581: "Until I lock it" runs with no timer until Lock now; it ends at quit (a new run of the app starts locked)', async () => {
    vi.useFakeTimers()
    read.mockResolvedValue({ on: true })
    await mount('/vault')
    act(() => state.unlock('until'))
    expect([state.unlockedUntil, state.locked, vi.getTimerCount()]).toEqual([Infinity, false, 0])
    act(() => vi.advanceTimersByTime(24 * 60 * 60_000))
    expect(state.locked).toBe(false)
    // Quit: the app's memory goes; the next run reads On from the file and starts locked.
    act(() => root?.unmount())
    await mount('/vault')
    expect([state.locked, state.unlockedUntil]).toEqual([true, null])
    expect(write).not.toHaveBeenCalled()
  })

  it('YAZ-5581: at zero and on Lock now, each open surface\'s save step runs FIRST and the vault locks only once all are done; an unregistered step does not run; an unlock during the saves wins', async () => {
    vi.useFakeTimers()
    read.mockResolvedValue({ on: true })
    await mount('/vault')
    const order: string[] = []
    let finish!: () => void
    const off = state.beforeLock(() => new Promise<void>((resolve) => (finish = () => (order.push('page saved'), resolve()))))
    state.beforeLock(() => void order.push('card done'))
    const gone = vi.fn()
    state.beforeLock(gone)()
    act(() => state.unlock('ten'))
    await act(async () => vi.advanceTimersByTime(VAULT_UNLOCK_MS.ten))
    expect(order).toEqual(['card done'])
    expect(state.locked).toBe(false)
    await act(async () => finish())
    order.push(state.locked ? 'locked' : 'open')
    expect(order).toEqual(['card done', 'page saved', 'locked'])
    expect(gone).not.toHaveBeenCalled()
    // Lock now, and an unlock while the page saves: the unlock stands.
    act(() => state.unlock('ten'))
    act(() => state.lock())
    act(() => state.unlock('hour'))
    await act(async () => finish())
    expect(state.locked).toBe(false)
    off()
  })

  it('YAZ-5581: two windows of one vault share ONE unlock: one\'s unlock opens the other, one\'s Lock now locks both (each saves first), a window opened later learns a running unlock; another vault is not touched', async () => {
    read.mockResolvedValue({ on: true })
    const states: Record<string, ReadOnlyVaultState> = {}
    const roots: Root[] = []
    const win = async (name: string, vault: string) => {
      function Win() {
        states[name] = useReadOnlyVault(vault)
        return null
      }
      const r = createRoot(document.createElement('div'))
      roots.push(r)
      await act(async () => r.render(<Win />))
    }
    const settle = async (until: () => boolean) => {
      for (let i = 0; i < 50 && !until(); i++) await act(async () => await new Promise((r) => setTimeout(r, 5)))
    }
    try {
      await win('a', '/vault')
      await win('b', '/vault')
      await win('other', '/other')
      act(() => states.a.unlock('until'))
      await settle(() => !states.b.locked)
      expect([states.a.locked, states.b.locked, states.other.locked]).toEqual([false, false, true])
      expect(states.b.unlockedUntil).toBe(Infinity)
      // A third window of the vault, opened now, asks and is told.
      await win('c', '/vault')
      await settle(() => !states.c.locked)
      expect(states.c.unlockedUntil).toBe(Infinity)
      // Lock now in B: A saves its page first, then every window locks.
      const saved = vi.fn()
      states.a.beforeLock(saved)
      act(() => states.b.lock())
      await settle(() => states.a.locked && states.c.locked)
      expect(saved).toHaveBeenCalledOnce()
      expect([states.a.locked, states.b.locked, states.c.locked]).toEqual([true, true, true])
      expect(write).not.toHaveBeenCalled()
    } finally {
      act(() => roots.forEach((r) => r.unmount()))
    }
  })

  it('a vault that is not read only shows no unlock, even one granted before it went Off', async () => {
    vi.useFakeTimers()
    await mount('/vault')
    await act(async () => state.save({ on: true }))
    act(() => state.unlock('ten'))
    await act(async () => state.save({ on: false }))
    expect([state.unlockedUntil, state.locked]).toEqual([null, false])
  })
  // YAZ-5649 item 4: a page's timers stop while the Mac sleeps; Date.now() does not. Back from sleep (the window shows
  // or takes focus), the vault relocks as the timer does: each surface's save step first, then the lock.
  it('YAZ-5649: after a sleep past the end, the window showing or taking focus relocks (saves first); before the end it stays open', async () => {
    vi.useFakeTimers()
    read.mockResolvedValue({ on: true })
    await mount('/vault')
    const order: string[] = []
    state.beforeLock(() => void order.push('page saved'))
    act(() => state.unlock('ten'))
    // Awake, inside the ten minutes: focus does nothing.
    act(() => vi.setSystemTime(Date.now() + 5 * 60_000))
    await act(async () => window.dispatchEvent(new Event('focus')))
    expect([state.locked, order]).toEqual([false, []])
    // The lid closes for an hour: the clock moves, the timer does not fire.
    act(() => vi.setSystemTime(Date.now() + 60 * 60_000))
    expect([state.fileActionsAllowed(), state.locked]).toEqual([false, false])
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    expect([state.locked, state.unlockedUntil, order]).toEqual([true, null, ['page saved']])
    // Focus after the lock: nothing more runs.
    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(order).toEqual(['page saved'])
  })

  it('YAZ-5649: "Until I lock it" never relocks on focus', async () => {
    read.mockResolvedValue({ on: true })
    await mount('/vault')
    act(() => state.unlock('until'))
    await act(async () => window.dispatchEvent(new Event('focus')))
    expect(state.locked).toBe(false)
  })
})
