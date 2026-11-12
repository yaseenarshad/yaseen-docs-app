/**
 * `useReviewSettings` (YAZ-4959 D14, YAZ-4967): a vault's `.yaseendocs/review.json`, read once per root,
 * re-read on that file's change broadcast, sanitised on the way in. The bridge is mocked; the
 * change listeners are captured so a test can push a broadcast.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_REVIEW_SETTINGS, REVIEW_SETTINGS_FILE, type ReviewSettings } from '@shared/reviews'
import type { VaultConfigChange } from '@shared/types'
import { useReviewSettings, useVaultReviewSettings, type ReviewSettingsState } from './useReviewSettings'

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
let seen: ReviewSettings | undefined

function Probe({ vault }: { vault: string | null }) {
  state = useReviewSettings(vault, notice)
  seen = useVaultReviewSettings('/vault')
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
  const D = DEFAULT_REVIEW_SETTINGS
  const changed = (r = '/vault', name = REVIEW_SETTINGS_FILE) => act(async () => listeners.forEach((l) => l({ root: r, name })))

  it('a vault with no review.json has the defaults — review on — and nothing is written; no call at all with no vault open', async () => {
    await mount('/vault')
    expect(read).toHaveBeenCalledWith('/vault', REVIEW_SETTINGS_FILE)
    expect(state.settings).toEqual(D)
    expect(state.settings.enabled).toBe(true)
    expect(write).not.toHaveBeenCalled()
    act(() => root?.unmount())
    read.mockClear()
    await mount(null)
    expect(read).not.toHaveBeenCalled()
    expect(state.settings).toEqual(D)
  })

  it('sanitises what the file holds, field by field, and re-reads on a change to this vault\'s file only', async () => {
    read.mockResolvedValue({ buttons: 4, retention: 2, newPerDay: 5 })
    await mount('/vault')
    expect(state.settings).toEqual({ ...D, buttons: 4, newPerDay: 5 })
    read.mockResolvedValue({ enabled: false })
    await changed('/other')
    await changed('/vault', 'github.json')
    expect(state.settings.enabled).toBe(true)
    await changed()
    expect(state.settings.enabled).toBe(false)
  })

  it('save shows the new settings at once, and writes only what changed over the file as read: a key this build does not know stays, a default never set stays out', async () => {
    read.mockResolvedValue({ later: 'kept', newPerDay: 3 })
    await mount('/vault')
    const next = { ...state.settings, maxDays: 90 }
    await act(async () => state.save(next))
    expect(state.settings).toEqual(next)
    expect(write).toHaveBeenCalledWith('/vault', REVIEW_SETTINGS_FILE, { later: 'kept', newPerDay: 3, maxDays: 90 })
  })

  it('publishes the settings by root for the folder tables, and takes them back when the vault closes', async () => {
    read.mockResolvedValue({ newPerDay: 4 })
    await mount('/vault')
    expect(seen).toBe(state.settings)
    act(() => root?.unmount())
    root = null
    await mount(null)
    expect(seen).toBeUndefined()
  })

  it('a review.json that stops being valid JSON mid-session: the settings stay and a save is refused with a notice, until the file parses again', async () => {
    read.mockResolvedValue({ buttons: 4 })
    await mount('/vault')
    const on = state.settings
    read.mockRejectedValue(new BridgeRequestError('INVALID_CONFIG', 'review.json is not valid JSON'))
    await changed()
    expect(state.settings).toEqual(on)
    await act(async () => state.save({ ...on, maxDays: 10 }))
    expect(state.settings).toEqual(on)
    expect(write).not.toHaveBeenCalled()
    expect(notice).toHaveBeenCalledExactlyOnceWith("Can't save the review settings: review.json is not valid JSON", 'error')
    read.mockResolvedValue({ buttons: 4 })
    await changed()
    await act(async () => state.save({ ...on, maxDays: 10 }))
    expect(write).toHaveBeenCalledExactlyOnceWith('/vault', REVIEW_SETTINGS_FILE, { buttons: 4, maxDays: 10 })
  })

  it('a save that fails falls back to what the file holds', async () => {
    await mount('/vault')
    write.mockRejectedValue(new Error('read-only'))
    await act(async () => state.save({ ...D, maxDays: 10 }))
    expect(state.settings).toEqual(D)
  })
})
