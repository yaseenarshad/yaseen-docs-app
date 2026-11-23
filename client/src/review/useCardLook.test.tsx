/**
 * `useCardLook` (YAZ-5484): a vault's `.yaseendocs/card-look.json`, read once per root, read again on that file's
 * change broadcast, sanitised on the way in; no file is null (the app's look); a file that is not JSON refuses a save.
 * The bridge is mocked. Made-up values.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { CARD_LOOK_FILE, CARD_LOOK_KEYS, appCardLook } from '@shared/cardLook'
import { DEFAULT_SETTINGS, type VaultConfigChange } from '@shared/types'
import { useCardLook, type CardLookState } from './useCardLook'

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
let state: CardLookState

function Probe({ vault }: { vault: string | null }) {
  state = useCardLook(vault, notice)
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

describe('useCardLook (YAZ-5484)', () => {
  it('no file: null (the app\'s look), and nothing is written; no vault asks nothing', async () => {
    await mount('/vault')
    expect(read).toHaveBeenCalledWith('/vault', CARD_LOOK_FILE)
    expect(state.look).toBeNull()
    expect(write).not.toHaveBeenCalled()
    act(() => root?.unmount())
    read.mockClear()
    await mount(null)
    expect(read).not.toHaveBeenCalled()
    expect(state.look).toBeNull()
  })

  it('a file: sanitised; read again on its own change only, keeping the object when nothing changed', async () => {
    read.mockResolvedValue({ version: 1, hiddenWords: 'box', textSize: 99 })
    await mount('/vault')
    expect(state.look).toEqual({ hiddenWords: 'box' })
    const held = state.look
    await changed({ root: '/vault', name: CARD_LOOK_FILE })
    expect(state.look).toBe(held)
    read.mockResolvedValue({ version: 1, hiddenWords: 'underline' })
    await changed({ root: '/other', name: CARD_LOOK_FILE })
    await changed({ root: '/vault', name: 'review.json' })
    expect(state.look).toBe(held)
    await changed({ root: '/vault', name: CARD_LOOK_FILE })
    expect(state.look).toEqual({ hiddenWords: 'underline' })
  })

  it('save: shows at once and writes only what differs from the defaults, with its keys; a failed write reads the file again', async () => {
    await mount('/vault')
    await act(async () => state.save({ ...appCardLook(DEFAULT_SETTINGS), shownHiddenWords: 'box', cardTitleSize: 30 }))
    expect(state.look).toEqual({ hiddenWords: 'box', titleSize: 30 })
    expect(write).toHaveBeenCalledWith('/vault', CARD_LOOK_FILE, { version: 1, hiddenWords: 'box', titleSize: 30 }, CARD_LOOK_KEYS)
    // The defaults in a vault: a file with only its version (not null: the vault's own look now).
    await act(async () => state.save(appCardLook(DEFAULT_SETTINGS)))
    expect(state.look).toEqual({})
    write.mockRejectedValueOnce(new Error('disk full'))
    read.mockResolvedValue({ version: 1, hiddenWords: 'underline' })
    await act(async () => state.save({ ...appCardLook(DEFAULT_SETTINGS), shownHiddenWords: 'box' }))
    await act(async () => {})
    expect(state.look).toEqual({ hiddenWords: 'underline' })
  })

  it('a file that is not JSON: the defaults, and a save is refused with a notice', async () => {
    read.mockRejectedValue(new BridgeRequestError('INVALID_CONFIG', 'bad json'))
    await mount('/vault')
    expect(state.look).toEqual({})
    await act(async () => state.save({ ...appCardLook(DEFAULT_SETTINGS), shownHiddenWords: 'box' }))
    expect(write).not.toHaveBeenCalled()
    expect(notice).toHaveBeenCalledWith("Can't save the card look: card-look.json is not valid JSON", 'error')
  })
})
