/**
 * `useTableLook` (YAZ-5487): a vault's `.yaseendocs/table-look.json`, read once per root, read again on that file's
 * change broadcast, sanitised on the way in; no file is null (the app's look); a file that is not JSON refuses a save.
 * The bridge is mocked. Made-up values.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { TABLE_LOOK_DEFAULTS, TABLE_LOOK_FILE, TABLE_LOOK_KEYS, appTableLook } from '@shared/tableLook'
import { DEFAULT_SETTINGS, type VaultConfigChange } from '@shared/types'
import { useTableLook, type TableLookState } from './useTableLook'

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
let state: TableLookState

function Probe({ vault }: { vault: string | null }) {
  state = useTableLook(vault, notice)
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

describe('useTableLook (YAZ-5487)', () => {
  it('no file: null (the app\'s look), and nothing is written; no vault asks nothing', async () => {
    await mount('/vault')
    expect(read).toHaveBeenCalledWith('/vault', TABLE_LOOK_FILE)
    expect(state.look).toBeNull()
    expect(state.settings).toBeNull()
    expect(write).not.toHaveBeenCalled()
    act(() => root?.unmount())
    read.mockClear()
    await mount(null)
    expect(read).not.toHaveBeenCalled()
    expect(state.look).toBeNull()
  })

  it('a file: sanitised, as the 21 settings; read again on its own change only, keeping the objects when nothing changed', async () => {
    read.mockResolvedValue({ version: 1, look: { rowBand: 'calendar', bandStrength: 99 }, newTables: { dayStart: 360 } })
    await mount('/vault')
    expect(state.look).toEqual({ look: { rowBand: 'calendar' }, newTables: { dayStart: 360 } })
    expect(state.settings).toEqual({ ...TABLE_LOOK_DEFAULTS, tableRowBand: 'calendar', tableDayStart: 360 })
    const held = state.settings
    await changed({ root: '/vault', name: TABLE_LOOK_FILE })
    expect(state.settings).toBe(held)
    read.mockResolvedValue({ version: 1, look: { rowBand: 'off' } })
    await changed({ root: '/other', name: TABLE_LOOK_FILE })
    await changed({ root: '/vault', name: 'card-look.json' })
    expect(state.settings).toBe(held)
    await changed({ root: '/vault', name: TABLE_LOOK_FILE })
    expect(state.settings?.tableRowBand).toBe('off')
  })

  it('save: shows at once and writes only what differs from the defaults, with its keys; a failed write reads the file again', async () => {
    await mount('/vault')
    await act(async () => state.save({ ...appTableLook(DEFAULT_SETTINGS), tableDimPast: 'text', tableHeaderRow: { ...DEFAULT_SETTINGS.tableHeaderRow, color: 'blue' } }))
    expect(state.look).toEqual({ look: { dimPast: 'text', headerRow: { color: 'blue' } } })
    expect(write).toHaveBeenCalledWith('/vault', TABLE_LOOK_FILE, { version: 1, look: { dimPast: 'text', headerRow: { color: 'blue' } } }, TABLE_LOOK_KEYS)
    // The defaults in a vault: a file with only its version (not null: the vault's own look now).
    await act(async () => state.save(appTableLook(DEFAULT_SETTINGS)))
    expect(state.look).toEqual({})
    expect(state.settings).toEqual(TABLE_LOOK_DEFAULTS)
    write.mockRejectedValueOnce(new Error('disk full'))
    read.mockResolvedValue({ version: 1, look: { nowMark: 'tint' } })
    await act(async () => state.save({ ...appTableLook(DEFAULT_SETTINGS), tableNowMark: 'both' }))
    await act(async () => {})
    expect(state.look).toEqual({ look: { nowMark: 'tint' } })
  })

  it('a file that is not JSON: the defaults, and a save is refused with a notice', async () => {
    read.mockRejectedValue(new BridgeRequestError('INVALID_CONFIG', 'bad json'))
    await mount('/vault')
    expect(state.look).toEqual({})
    await act(async () => state.save({ ...appTableLook(DEFAULT_SETTINGS), tableRowBand: 'off' }))
    expect(write).not.toHaveBeenCalled()
    expect(notice).toHaveBeenCalledWith("Can't save the table look: table-look.json is not valid JSON", 'error')
  })
})
