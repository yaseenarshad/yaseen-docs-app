/**
 * `useVaultNewPlaces` (YAZ-5486): where new pages and boards go, the vault's new-places.json `newPage` and `newBoard`.
 * Read once per root and again on its change; malformed refuses a save; the shortcuts are kept. The bridge is mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NEW_PLACES_FILE, NEW_PLACES_SETTINGS_KEYS } from '@shared/newPlaces'
import type { VaultConfigChange } from '@shared/types'
import { NO_NEW_PLACES, useVaultNewPlaces, type VaultNewPlacesState } from './useVaultNewPlaces'

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
const states: Record<string, VaultNewPlacesState> = {}

function Probe({ vault }: { vault: string | null }) {
  states[vault ?? 'none'] = useVaultNewPlaces(vault, notice)
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
const PAGE = { newPage: { location: 'folder' as const, folder: 'Inbox' } }

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

describe('useVaultNewPlaces', () => {
  it('reads the keys, not the shortcuts; no file is none; no vault asks nothing', async () => {
    read.mockResolvedValue({ version: 1, places: ['/x', null, null], newPage: { location: 'folder', folder: 'Inbox' }, newBoard: { folder: 'bad' } })
    await mount('/v')
    expect(read).toHaveBeenCalledWith('/v', NEW_PLACES_FILE)
    expect(states['/v'].value).toEqual({ newPage: { location: 'folder', folder: 'Inbox' }, newBoard: {} })
    act(() => root?.unmount())
    read.mockReset().mockResolvedValue(null)
    await mount('/v')
    expect(states['/v'].value).toBe(NO_NEW_PLACES)
    act(() => root?.unmount())
    read.mockClear()
    await mount(null)
    expect(read).not.toHaveBeenCalled()
  })

  it('reads again on its own file\'s change only', async () => {
    await mount('/v')
    read.mockResolvedValue(PAGE)
    await changed({ root: '/v', name: 'daily-pages.json' })
    expect(states['/v'].value).toBe(NO_NEW_PLACES)
    await changed({ root: '/v', name: NEW_PLACES_FILE })
    expect(states['/v'].value).toEqual(PAGE)
  })

  it('a save writes its keys (the shortcuts kept); a file with none gets the empty ones; the same value writes nothing', async () => {
    await mount('/v')
    await act(async () => states['/v'].save(PAGE))
    expect(write).toHaveBeenLastCalledWith('/v', NEW_PLACES_FILE, { version: 1, places: [null, null, null], ...PAGE }, NEW_PLACES_SETTINGS_KEYS)
    expect(NEW_PLACES_SETTINGS_KEYS).not.toContain('places')
    await act(async () => states['/v'].save({ ...PAGE }))
    expect(write).toHaveBeenCalledTimes(1)
    await act(async () => states['/v'].save({ ...PAGE, newBoard: { folder: 'assets' } }))
    expect(write).toHaveBeenLastCalledWith('/v', NEW_PLACES_FILE, { version: 1, ...PAGE, newBoard: { folder: 'assets' } }, NEW_PLACES_SETTINGS_KEYS)
  })

  it('a file that is not valid JSON: no keys, and a save is refused with a notice', async () => {
    read.mockRejectedValue(new BridgeRequestError('INVALID_CONFIG', 'new-places.json is not valid JSON'))
    await mount('/v')
    expect(states['/v'].value).toBe(NO_NEW_PLACES)
    await act(async () => states['/v'].save(PAGE))
    expect(write).not.toHaveBeenCalled()
    expect(notice).toHaveBeenCalledWith(expect.stringContaining('not valid JSON'), 'error')
  })

  it('YAZ-5490: the comment hint is one of its keys', async () => {
    read.mockResolvedValue({ version: 1, places: [null, null, null], commentsHint: false })
    await mount('/v')
    expect(states['/v'].value).toEqual({ commentsHint: false })
    await act(async () => states['/v'].save({ commentsHint: true }))
    expect(write).toHaveBeenLastCalledWith('/v', NEW_PLACES_FILE, { version: 1, commentsHint: true }, NEW_PLACES_SETTINGS_KEYS)
    expect(NEW_PLACES_SETTINGS_KEYS).toContain('commentsHint')
  })

  it('two vaults in one window keep two values', async () => {
    read.mockImplementation(async (r) => (r === '/a' ? PAGE : { version: 1, places: [null, null, null], newPage: { location: 'root' } }))
    await mount('/a', '/b')
    expect(states['/a'].value).toEqual(PAGE)
    expect(states['/b'].value).toEqual({ newPage: { location: 'root' } })
  })
})
