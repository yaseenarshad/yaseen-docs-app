/**
 * `useLinkPills` (YAZ-4924): a vault's `.yaseendocs/link-pills.json`, read once per root, read again on that file's
 * change broadcast, sanitised on the way in; an old vault with no file reads as today. The bridge is mocked; the
 * change listeners are captured so a test can push a broadcast. The pattern of `useTextFormatting.test.tsx`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { LINK_PILLS_FILE, NO_LINK_PILLS } from '@shared/linkPills'
import type { VaultConfigChange } from '@shared/types'
import { useLinkPills, type LinkPillsState } from './useLinkPills'

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
let state: LinkPillsState

function Probe({ vault }: { vault: string | null }) {
  state = useLinkPills(vault, notice)
  return null
}

async function mount(vault: string | null): Promise<void> {
  root = createRoot(document.createElement('div'))
  await act(async () => root?.render(<Probe vault={vault} />))
}

const changed = (change: VaultConfigChange) => act(async () => listeners.forEach((l) => l(change)))

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

describe('useLinkPills (YAZ-4924)', () => {
  it('an old vault with no file reads as today, the one shared object; no vault asks the bridge for nothing', async () => {
    await mount(null)
    expect(state.pills).toBe(NO_LINK_PILLS)
    expect(read).not.toHaveBeenCalled()
    await mount('/v')
    expect(read).toHaveBeenCalledWith('/v', LINK_PILLS_FILE)
    expect(state.pills).toBe(NO_LINK_PILLS)
  })

  it('the file loads sanitised; a save shows at once and writes the version with only the changes', async () => {
    read.mockResolvedValue({ version: 1, background: 'none', bold: true, shape: 'round' })
    await mount('/v')
    expect(state.pills).toEqual({ background: 'none', bold: true })
    await act(async () => state.save({ background: 'none', bold: true, after: ')' }))
    expect(state.pills).toEqual({ background: 'none', bold: true, after: ')' })
    expect(write).toHaveBeenCalledWith('/v', LINK_PILLS_FILE, { version: 1, background: 'none', bold: true, after: ')' })
    // Reset: every field gone is today's object again.
    await act(async () => state.save({}))
    expect(state.pills).toBe(NO_LINK_PILLS)
    expect(write).toHaveBeenLastCalledWith('/v', LINK_PILLS_FILE, { version: 1 })
  })

  it("a change broadcast of this vault's file reads it again; another file or vault does nothing", async () => {
    await mount('/v')
    read.mockResolvedValue({ version: 1, icon: 'hide' })
    await changed({ root: '/other', name: LINK_PILLS_FILE })
    await changed({ root: '/v', name: 'review.json' })
    expect(state.pills).toBe(NO_LINK_PILLS)
    await changed({ root: '/v', name: LINK_PILLS_FILE })
    expect(state.pills).toEqual({ icon: 'hide' })
  })

  it('a file that is not valid JSON shows today and refuses a save with a notice; a failed write falls back to the file', async () => {
    read.mockRejectedValue(new BridgeRequestError('INVALID_CONFIG', 'bad'))
    await mount('/v')
    expect(state.pills).toBe(NO_LINK_PILLS)
    await act(async () => state.save({ bold: true }))
    expect(write).not.toHaveBeenCalled()
    expect(notice).toHaveBeenCalledWith(expect.stringContaining('not valid JSON'), 'error')
    // A write that fails: what the file holds comes back.
    read.mockResolvedValue({ version: 1, italic: true })
    await changed({ root: '/v', name: LINK_PILLS_FILE })
    write.mockRejectedValue(new Error('disk'))
    await act(async () => state.save({ bold: true }))
    await act(async () => {})
    expect(state.pills).toEqual({ italic: true })
  })
})
