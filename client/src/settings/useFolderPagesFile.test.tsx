/**
 * `useFolderPagesFile` (YAZ-5489): a vault's `.yaseendocs/folder-pages.json`, read once per root, read again on that
 * file's change broadcast, sanitised on the way in; no file is null (the app's); a file that is not JSON refuses a save.
 * The bridge is mocked. Made-up values.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { FOLDER_PAGES_FILE, FOLDER_PAGES_KEYS } from '@shared/folderPages'
import { DEFAULT_FOLDER_PAGES, type VaultConfigChange } from '@shared/types'
import { useFolderPagesFile, type FolderPagesFileState } from './useFolderPagesFile'

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
let state: FolderPagesFileState

function Probe({ vault }: { vault: string | null }) {
  state = useFolderPagesFile(vault, notice)
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

describe('useFolderPagesFile (YAZ-5489)', () => {
  it('no file: null (the app\'s), nothing written; a file: sanitised, as the 27 parts; read again on its own change only', async () => {
    await mount('/vault')
    expect(read).toHaveBeenCalledWith('/vault', FOLDER_PAGES_FILE)
    expect([state.file, state.vault]).toEqual([null, null])
    expect(write).not.toHaveBeenCalled()
    read.mockResolvedValue({ version: 1, rowHeight: 'tall', rowNumbers: 7 })
    await changed({ root: '/other', name: FOLDER_PAGES_FILE })
    expect(state.file).toBeNull()
    await changed({ root: '/vault', name: FOLDER_PAGES_FILE })
    expect(state.file).toEqual({ rowHeight: 'tall' })
    expect(state.vault?.rowHeight).toBe('tall')
    expect(state.vault?.rowNumbers).toBe(DEFAULT_FOLDER_PAGES.rowNumbers)
    const held = state.vault
    await changed({ root: '/vault', name: FOLDER_PAGES_FILE })
    expect(state.vault).toBe(held)
  })

  it('save: only the vault parts that differ from the defaults, with its keys; the personal parts never', async () => {
    await mount('/vault')
    await act(async () => state.save({ ...DEFAULT_FOLDER_PAGES, subfolders: 'both', weekStartsOn: 'monday', askBeforeDelete: false }))
    expect(write).toHaveBeenCalledWith('/vault', FOLDER_PAGES_FILE, { version: 1, subfolders: 'both' }, FOLDER_PAGES_KEYS)
    expect(state.file).toEqual({ subfolders: 'both' })
  })

  it('a file that is not JSON: the defaults, and a save is refused with a notice', async () => {
    read.mockRejectedValue(new BridgeRequestError('INVALID_CONFIG', 'bad json'))
    await mount('/vault')
    expect(state.file).toEqual({})
    await act(async () => state.save({ ...DEFAULT_FOLDER_PAGES, rowHeight: 'tall' }))
    expect(write).not.toHaveBeenCalled()
    expect(notice).toHaveBeenCalledWith("Can't save the folder page defaults: folder-pages.json is not valid JSON", 'error')
  })
})
