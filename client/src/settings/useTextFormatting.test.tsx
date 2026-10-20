/**
 * `useTextFormatting` (YAZ-3066, D10): a vault's `.yaseendocs/text-formatting.json`, read once per
 * root, read again on that file's change broadcast, sanitised on the way in. The bridge is mocked;
 * the change listeners are captured so a test can push a broadcast.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { TEXT_FORMATTING_FILE } from '@shared/textFormatting'
import type { VaultConfigChange } from '@shared/types'
import { NO_TEXT_FORMATTING, useTextFormatting, type TextFormattingState } from './useTextFormatting'

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
let state: TextFormattingState

function Probe({ vault }: { vault: string | null }) {
  state = useTextFormatting(vault, notice)
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

describe('useTextFormatting', () => {
  it('loads the file sanitised; no file is the app\'s look and writes nothing; no vault asks nothing', async () => {
    read.mockResolvedValue({ version: 1, text: { size: 18 }, h2: { size: 21, underline: true }, h3: { size: 99 } })
    await mount('/vault')
    expect(read).toHaveBeenCalledWith('/vault', TEXT_FORMATTING_FILE)
    expect(state.formatting).toEqual({ text: { size: 18 }, h2: { size: 21, underline: true } })
    act(() => root?.unmount())
    read.mockReset().mockResolvedValue(null)
    await mount('/vault')
    expect(state.formatting).toBe(NO_TEXT_FORMATTING)
    expect(write).not.toHaveBeenCalled()
    act(() => root?.unmount())
    read.mockClear()
    await mount(null)
    expect(read).not.toHaveBeenCalled()
    expect(state.formatting).toBe(NO_TEXT_FORMATTING)
  })

  it('an external change (sync, another window) to this vault\'s file only is read again', async () => {
    await mount('/vault')
    read.mockResolvedValue({ version: 1, h1: { size: 25 } })
    await changed({ root: '/other', name: TEXT_FORMATTING_FILE })
    await changed({ root: '/vault', name: 'review.json' })
    expect(state.formatting).toBe(NO_TEXT_FORMATTING)
    await changed({ root: '/vault', name: TEXT_FORMATTING_FILE })
    expect(state.formatting).toEqual({ h1: { size: 25 } })
  })

  it('save shows the change at once and writes `{ version: 1, ...only the changes }`; a failed write falls back to the file', async () => {
    await mount('/vault')
    await act(async () => state.save({ text: { size: 17 }, h2: { size: 21, bold: undefined } }))
    expect(state.formatting).toEqual({ text: { size: 17 }, h2: { size: 21 } })
    expect(write).toHaveBeenCalledExactlyOnceWith('/vault', TEXT_FORMATTING_FILE, { version: 1, text: { size: 17 }, h2: { size: 21 } })
    write.mockRejectedValue(new Error('read-only'))
    read.mockResolvedValue({ version: 1, text: { size: 17 } })
    await act(async () => state.save({ text: { size: 20 } }))
    expect(state.formatting).toEqual({ text: { size: 17 } })
  })

  it('a file that is not valid JSON: the app\'s look, and a save is refused with a notice until the file parses again', async () => {
    read.mockResolvedValue({ version: 1, h2: { size: 21 } })
    await mount('/vault')
    read.mockRejectedValue(new BridgeRequestError('INVALID_CONFIG', 'text-formatting.json is not valid JSON'))
    await changed({ root: '/vault', name: TEXT_FORMATTING_FILE })
    expect(state.formatting).toBe(NO_TEXT_FORMATTING)
    await act(async () => state.save({ h2: { size: 22 } }))
    expect(state.formatting).toBe(NO_TEXT_FORMATTING)
    expect(write).not.toHaveBeenCalled()
    expect(notice).toHaveBeenCalledExactlyOnceWith("Can't save the text formatting: text-formatting.json is not valid JSON", 'error')
    read.mockResolvedValue({ version: 1, h2: { size: 21 } })
    await changed({ root: '/vault', name: TEXT_FORMATTING_FILE })
    expect(state.formatting).toEqual({ h2: { size: 21 } })
    await act(async () => state.save({ h2: { size: 22 } }))
    expect(write).toHaveBeenCalledExactlyOnceWith('/vault', TEXT_FORMATTING_FILE, { version: 1, h2: { size: 22 } })
  })
})
