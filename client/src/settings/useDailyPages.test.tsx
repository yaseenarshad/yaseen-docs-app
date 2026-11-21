/**
 * `useDailyPages` (YAZ-5491): a vault's `.yaseendocs/daily-pages.json`, the one source of Daily pages on the Mac. Read
 * once per root, read again on that file's change broadcast, sanitised field by field; a file that is not valid JSON
 * reads as off and refuses a save. The bridge is mocked; the change listeners are captured.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DAILY_PAGES_FILE, DAILY_PAGES_KEYS, DAILY_PAGES_OFF, sanitizeDailyPages } from '@shared/dailyPagesFile'
import type { VaultConfigChange } from '@shared/types'
import { useDailyPages, type DailyPagesState } from './useDailyPages'

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
const states: Record<string, DailyPagesState> = {}

function Probe({ vault }: { vault: string | null }) {
  states[vault ?? 'none'] = useDailyPages(vault, notice)
  return null
}

async function mount(...vaults: Array<string | null>): Promise<void> {
  root = createRoot(document.createElement('div'))
  await act(async () =>
    root?.render(
      <>
        {vaults.map((v) => (
          <Probe key={v ?? 'none'} vault={v} />
        ))}
      </>,
    ),
  )
}

const changed = (change: VaultConfigChange) => act(async () => listeners.forEach((l) => l(change)))
const ON = { enabled: true, folder: 'Daily', format: 'YYYY-MM-DD', dayFolder: false }

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

describe('useDailyPages', () => {
  it('reads the file field by field; no file is null (the app value then); no vault asks nothing', async () => {
    read.mockResolvedValue({ version: 1, enabled: true, folder: '/Journal/', format: 'not a style ☃', dayFolder: true, later: 1 })
    await mount('/v')
    expect(read).toHaveBeenCalledWith('/v', DAILY_PAGES_FILE)
    expect(states['/v'].file).toEqual({ enabled: true, folder: 'Journal', format: 'YYYY-MM-DD', dayFolder: true })
    act(() => root?.unmount())
    read.mockReset().mockResolvedValue(null)
    await mount('/v')
    expect(states['/v'].file).toBeNull()
    act(() => root?.unmount())
    read.mockClear()
    await mount(null)
    expect(read).not.toHaveBeenCalled()
    expect(states.none.file).toBeNull()
  })

  it('reads again when its own file changes, not another file or another vault', async () => {
    await mount('/v')
    read.mockResolvedValue(ON)
    await changed({ root: '/v', name: 'text-formatting.json' })
    await changed({ root: '/other', name: DAILY_PAGES_FILE })
    expect(states['/v'].file).toBeNull()
    await changed({ root: '/v', name: DAILY_PAGES_FILE })
    expect(states['/v'].file).toEqual(ON)
  })

  it('saves through the door with its keys, in the phone\'s shape; the same value again writes nothing', async () => {
    await mount('/v')
    await act(async () => states['/v'].save(ON))
    expect(write).toHaveBeenCalledWith('/v', DAILY_PAGES_FILE, { version: 1, ...ON }, DAILY_PAGES_KEYS)
    expect(sanitizeDailyPages(write.mock.calls[0][2])).toEqual({ folder: 'Daily', format: 'YYYY-MM-DD', dayFolder: false })
    expect(states['/v'].file).toEqual(ON)
    await act(async () => states['/v'].save({ ...ON }))
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('a file that is not valid JSON reads as off and refuses a save, with a notice', async () => {
    read.mockRejectedValue(new BridgeRequestError('INVALID_CONFIG', 'daily-pages.json is not valid JSON'))
    await mount('/v')
    expect(states['/v'].file).toEqual(DAILY_PAGES_OFF)
    await act(async () => states['/v'].save(ON))
    expect(write).not.toHaveBeenCalled()
    expect(notice).toHaveBeenCalledWith(expect.stringContaining('not valid JSON'), 'error')
  })

  it('a write that fails shows what the file holds', async () => {
    await mount('/v')
    write.mockRejectedValue(new Error('EACCES'))
    read.mockResolvedValue({ enabled: false })
    await act(async () => states['/v'].save(ON))
    await act(async () => undefined)
    expect(states['/v'].file).toEqual({ ...DAILY_PAGES_OFF })
  })

  it('two vaults in one window keep two values', async () => {
    read.mockImplementation(async (r) => (r === '/a' ? ON : { enabled: true, folder: 'Journal', format: 'MM_DD', dayFolder: true }))
    await mount('/a', '/b')
    expect(states['/a'].file).toEqual(ON)
    expect(states['/b'].file).toEqual({ enabled: true, folder: 'Journal', format: 'MM_DD', dayFolder: true })
    await act(async () => states['/b'].save({ ...ON, enabled: false }))
    expect(write).toHaveBeenCalledWith('/b', DAILY_PAGES_FILE, expect.objectContaining({ enabled: false }), DAILY_PAGES_KEYS)
    expect(states['/a'].file).toEqual(ON)
  })
})
