/**
 * `useReviewSettings` (YAZ-2322 🔒 D7): a vault's `.yaseendocs/review.json`, read once per root,
 * re-read on that file's change broadcast, sanitised on the way in. The bridge is mocked; the
 * change listeners are captured so a test can push a broadcast.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_REVIEW_SETTINGS, REVIEW_SETTINGS_FILE } from '@shared/reviews'
import type { VaultConfigChange } from '@shared/types'
import { useReviewSettings, type ReviewSettingsState } from './useReviewSettings'

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

import { BridgeRequestError, api } from '../api'

const read = vi.mocked(api.vaultConfig.read)
const write = vi.mocked(api.vaultConfig.write)
const notice = vi.fn()

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let state: ReviewSettingsState

function Probe({ vault }: { vault: string | null }) {
  state = useReviewSettings(vault, notice)
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
  notice.mockReset()
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
})

describe('useReviewSettings', () => {
  it('a vault with no review.json: upkeep is off and nothing is written; no call at all with no vault open', async () => {
    await mount('/vault')
    expect(read).toHaveBeenCalledWith('/vault', REVIEW_SETTINGS_FILE)
    expect(state.settings).toEqual(DEFAULT_REVIEW_SETTINGS)
    expect(state.settings.enabled).toBe(false)
    expect(write).not.toHaveBeenCalled()
    act(() => root?.unmount())
    read.mockClear()
    await mount(null)
    expect(read).not.toHaveBeenCalled()
    expect(state.settings).toEqual(DEFAULT_REVIEW_SETTINGS)
  })

  it('sanitises what the file holds', async () => {
    read.mockResolvedValue({ baseDays: 7, growth: 'fast' })
    await mount('/vault')
    expect(state.settings).toEqual({ ...DEFAULT_REVIEW_SETTINGS, baseDays: 7 })
  })

  it('turned on: the file says so, and a change broadcast turns it on or off in place', async () => {
    read.mockResolvedValue({ enabled: true })
    await mount('/vault')
    expect(state.settings).toEqual({ ...DEFAULT_REVIEW_SETTINGS, enabled: true })
    read.mockResolvedValue({ enabled: false })
    await act(async () => listeners.forEach((l) => l({ root: '/vault', name: REVIEW_SETTINGS_FILE })))
    expect(state.settings.enabled).toBe(false)
  })

  it('re-reads on a change to this vault\'s file only', async () => {
    await mount('/vault')
    read.mockResolvedValue({ baseDays: 14 })
    await act(async () => listeners.forEach((l) => l({ root: '/other', name: REVIEW_SETTINGS_FILE })))
    await act(async () => listeners.forEach((l) => l({ root: '/vault', name: 'github.json' })))
    expect(state.settings.baseDays).toBe(30)
    await act(async () => listeners.forEach((l) => l({ root: '/vault', name: REVIEW_SETTINGS_FILE })))
    expect(state.settings.baseDays).toBe(14)
  })

  it('save shows the new settings at once and writes only the settings file', async () => {
    await mount('/vault')
    const next = { ...DEFAULT_REVIEW_SETTINGS, baseDays: 10 }
    await act(async () => state.save(next))
    expect(state.settings).toEqual(next)
    expect(write).toHaveBeenCalledWith('/vault', REVIEW_SETTINGS_FILE, next)
  })

  it('save sanitises, so the file never holds a longest wait under the first', async () => {
    await mount('/vault')
    await act(async () => state.save({ ...DEFAULT_REVIEW_SETTINGS, baseDays: 400 }))
    expect(state.settings.maxDays).toBe(400)
    expect(write).toHaveBeenCalledWith('/vault', REVIEW_SETTINGS_FILE, { ...DEFAULT_REVIEW_SETTINGS, baseDays: 400, maxDays: 400 })
  })

  it('a review.json that stops being valid JSON mid-session: the settings stay as they were and a save is refused with a notice, until the file parses again', async () => {
    const on = { ...DEFAULT_REVIEW_SETTINGS, enabled: true }
    const changed = () => act(async () => listeners.forEach((l) => l({ root: '/vault', name: REVIEW_SETTINGS_FILE })))
    read.mockResolvedValue({ enabled: true })
    await mount('/vault')
    read.mockRejectedValue(new BridgeRequestError('INVALID_CONFIG', 'review.json is not valid JSON'))
    await changed()
    expect(state.settings).toEqual(on)
    await act(async () => state.save({ ...on, baseDays: 10 }))
    expect(state.settings).toEqual(on)
    expect(write).not.toHaveBeenCalled()
    expect(notice).toHaveBeenCalledExactlyOnceWith("Can't save the review settings: review.json is not valid JSON", 'error')
    read.mockResolvedValue({ enabled: true, baseDays: 7 })
    await changed()
    await act(async () => state.save({ ...on, baseDays: 10 }))
    expect(write).toHaveBeenCalledExactlyOnceWith('/vault', REVIEW_SETTINGS_FILE, { ...on, baseDays: 10 })
  })

  it('a save that fails falls back to what the file holds', async () => {
    await mount('/vault')
    write.mockRejectedValue(new Error('read-only'))
    await act(async () => state.save({ ...DEFAULT_REVIEW_SETTINGS, baseDays: 10 }))
    expect(state.settings).toEqual(DEFAULT_REVIEW_SETTINGS)
  })
})
