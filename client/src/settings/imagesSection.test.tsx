/**
 * Settings › Images (YAZ-3038; Draw's Settings › Images and Files › Library folder tests, ported): the
 * Pixabay key goes to main's secrets and never comes back, and the library folder row shows what main
 * resolves. The bridge is mocked: no row may reach a real main process or a provider.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_SETTINGS, type SettingsState } from '@shared/types'
import { api, BridgeRequestError } from '../api'
import type { IconPacksStatus } from '@shared/iconPacks'
import { resetIconPacks } from '../image-studio/useIconPacks'
import { SettingsDialog } from './SettingsDialog'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    api: {
      drawing: { libraryFolder: vi.fn() },
      media: { packs: vi.fn(async () => null), onPacksProgress: vi.fn(() => () => undefined) },
      pickFolder: vi.fn(),
      secrets: { has: vi.fn(), set: vi.fn() },
      // Settings opens on General (YAZ-3276 D7), whose Settings folder row asks main where the settings are.
      state: { settingsFolder: vi.fn(async () => ({ folder: null, missing: false })), setSettingsFolder: vi.fn() },
    },
  }
})

const libraryFolder = vi.mocked(api.drawing.libraryFolder)
const pickFolder = vi.mocked(api.pickFolder)
const secretHas = vi.mocked(api.secrets.has)
const secretSet = vi.mocked(api.secrets.set)

let root: Root | null = null
let el: HTMLElement
const onChange = vi.fn()

beforeEach(() => {
  libraryFolder.mockReset().mockResolvedValue('/userData/library')
  pickFolder.mockReset().mockResolvedValue({ cancelled: true })
  secretHas.mockReset().mockResolvedValue(false)
  secretSet.mockReset().mockResolvedValue(undefined)
  onChange.mockReset()
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  el.remove()
})

const flush = () => act(async () => await Promise.resolve())

/** The dialog, on the Images page, as a user reaches it. */
async function mountImages(settings: SettingsState = { ...DEFAULT_SETTINGS }) {
  el = document.createElement('div')
  document.body.appendChild(el)
  root = createRoot(el)
  act(() => root?.render(<SettingsDialog ctx={{ settings, onChange }} onClose={vi.fn()} />))
  act(() => [...el.querySelectorAll<HTMLButtonElement>('.settings-nav__item')].find((b) => b.textContent === 'Images')?.click())
  await flush()
}
const row = (id: string) => el.querySelector<HTMLElement>(`[data-setting="${id}"]`)
const rowButtons = (id: string) => [...(row(id)?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
function type(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  act(() => {
    set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('Settings › Images › Library folder', () => {
  it('shows the default main resolved, marked as the default; Reset is off while it IS the default', async () => {
    await mountImages()
    expect(el.querySelector('[data-testid="library-folder-path"]')?.textContent).toBe('/userData/library (default)')
    expect(rowButtons('libraryFolder').map((b) => [b.textContent, b.disabled])).toEqual([
      ['Choose…', false],
      ['Reset to default', true],
    ])
  })

  it('a chosen folder is its own answer; Reset writes null, never an empty string; Choose… writes the picked path', async () => {
    await mountImages({ ...DEFAULT_SETTINGS, libraryFolder: '/Vault/Library' })
    expect(el.querySelector('[data-testid="library-folder-path"]')?.textContent).toBe('/Vault/Library')
    expect(libraryFolder).not.toHaveBeenCalled()
    act(() => rowButtons('libraryFolder')[1].click())
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_SETTINGS, libraryFolder: null })
    onChange.mockClear()
    pickFolder.mockResolvedValueOnce({ path: '/Elsewhere/Library' })
    await act(async () => {
      rowButtons('libraryFolder')[0].click()
      await Promise.resolve()
    })
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_SETTINGS, libraryFolder: '/Elsewhere/Library' })
  })
})

describe('Settings › Images › Pixabay API key', () => {
  const statusText = () => el.querySelector('[data-testid="pixabay-key-status"]')?.textContent
  const keyInput = () => row('pixabayApiKey')?.querySelector<HTMLInputElement>('input') as HTMLInputElement

  it('asks main whether a key is set: "No key saved", a password field, Save off until typed, Clear off with nothing to clear', async () => {
    await mountImages()
    expect(secretHas).toHaveBeenCalledExactlyOnceWith({ name: 'pixabayApiKey' })
    expect(statusText()).toBe('No key saved. Photos are off.')
    expect(keyInput().type).toBe('password')
    expect(rowButtons('pixabayApiKey').map((b) => [b.textContent, b.disabled])).toEqual([
      ['Save', true],
      ['Clear', true],
    ])
  })

  it('Save sends the typed value to main ONCE, then empties the field — the value is never echoed, and nothing rides the settings', async () => {
    await mountImages()
    type(keyInput(), 'sk-very-secret')
    await act(async () => {
      rowButtons('pixabayApiKey')[0].click()
      await Promise.resolve()
    })
    expect(secretSet).toHaveBeenCalledExactlyOnceWith({ name: 'pixabayApiKey', value: 'sk-very-secret' })
    expect(onChange).not.toHaveBeenCalled()
    expect(statusText()).toBe('✓ Key saved. Photos are on.')
    expect(keyInput().value).toBe('')
    // A saved key reads as saved (demo 6F): green, and the empty field asks for a REPLACEMENT, not a key.
    expect(el.querySelector('[data-testid="pixabay-key-status"]')?.classList.contains('is-set')).toBe(true)
    expect(keyInput().placeholder).toBe('Paste a new key to replace it')
    expect(el.textContent).not.toContain('sk-very-secret')
  })

  it('Clear writes null; a save that fails says so in the status line and the key stays unset', async () => {
    secretHas.mockResolvedValue(true)
    await mountImages()
    expect(statusText()).toBe('✓ Key saved. Photos are on.')
    await act(async () => {
      rowButtons('pixabayApiKey')[1].click()
      await Promise.resolve()
    })
    expect(secretSet).toHaveBeenCalledExactlyOnceWith({ name: 'pixabayApiKey', value: null })
    expect(statusText()).toBe('No key saved. Photos are off.')
    secretSet.mockRejectedValueOnce(new BridgeRequestError('IO_ERROR', 'disk went away'))
    type(keyInput(), 'k')
    await act(async () => {
      rowButtons('pixabayApiKey')[0].click()
      await Promise.resolve()
    })
    expect(statusText()).toBe('The key could not be saved.')
  })
})

describe('Settings › Images › Icon packs (YAZ-4359)', () => {
  const status = (over: Partial<IconPacksStatus> = {}): IconPacksStatus => ({ state: 'none', folder: '/userData/icon-packs', version: null, packs: 0, total: 281, bytes: 0, totalBytes: 135 * 1024 * 1024, checkedAt: null, message: null, failed: false, ...over })
  const text = (id: string) => el.querySelector(`[data-testid="${id}"]`)?.textContent
  const labels = () => rowButtons('iconPacks').map((b) => [b.textContent, b.disabled])
  let push: ((s: IconPacksStatus) => void) | null = null
  beforeEach(() => {
    resetIconPacks()
    vi.mocked(api.media.packs).mockReset().mockResolvedValue(status())
    vi.mocked(api.media.onPacksProgress).mockReset().mockImplementation((listener) => {
      push = listener as (s: IconPacksStatus) => void
      return () => undefined
    })
  })

  it('with no pack: says so, offers the download after the confirm box, and names the default folder', async () => {
    await mountImages()
    expect(text('icon-packs-status')).toBe('Not on this Mac. Icons stream from Iconify as you search.')
    expect(text('icon-packs-folder')).toBe('/userData/icon-packs (default)')
    expect(labels()).toEqual([
      ['Download all icon packs', false],
      ['Choose a folder…', false],
      ['Reset to default', true],
    ])
    act(() => rowButtons('iconPacks')[0].click())
    expect(document.getElementById('confirm-icon-packs-text')?.textContent).toContain('All 281 free icon packs from Iconify come to this Mac: about 135 MB.')
    expect(api.media.packs).not.toHaveBeenCalledWith({ op: 'download' })
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('.confirm button')].find((b) => b.textContent === 'Download')!.click())
    expect(api.media.packs).toHaveBeenCalledWith({ op: 'download' })
  })

  it('during a run: the progress and Stop; after it: Check for new icons, Remove… after a confirm, and GitHub`s limit said', async () => {
    await mountImages()
    act(() => push?.(status({ state: 'downloading', packs: 37, bytes: 17 * 1024 * 1024 })))
    expect(text('icon-packs-status')).toBe('Downloading icon packs: 37 of 281 (17 MB of 135 MB)')
    expect(labels()[0]).toEqual(['Stop', false])
    act(() => rowButtons('iconPacks')[0].click())
    expect(api.media.packs).toHaveBeenCalledWith({ op: 'stop' })

    const done = status({ state: 'complete', packs: 281, bytes: 135 * 1024 * 1024, version: '2.2.553', message: "GitHub's limit of 60 checks an hour is reached, so the app used unpkg. Up to date: version 2.2.553." })
    vi.mocked(api.media.packs).mockResolvedValue(done)
    act(() => push?.(done))
    expect(text('icon-packs-status')).toBe('All 281 packs are on this Mac: 135 MB, version 2.2.553. Icon search, tiles and adds work offline.')
    expect(text('icon-packs-message')).toContain("GitHub's limit of 60 checks an hour is reached")
    expect(labels().map(([label]) => label)).toEqual(['Check for new icons', 'Remove…', 'Choose a folder…', 'Reset to default'])
    await act(async () => rowButtons('iconPacks')[0].click())
    expect(api.media.packs).toHaveBeenCalledWith({ op: 'check' })
    act(() => rowButtons('iconPacks')[1].click())
    expect(document.getElementById('confirm-icon-packs-remove-text')?.textContent).toContain('Remove the icon packs?')
    expect(api.media.packs).not.toHaveBeenCalledWith({ op: 'remove' })
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('.confirm button')].find((b) => b.textContent === 'Remove')!.click())
    expect(api.media.packs).toHaveBeenCalledWith({ op: 'remove' })
  })

  it('a stopped download offers Download the rest; Choose a folder… writes the picked folder, Reset writes null', async () => {
    vi.mocked(api.media.packs).mockResolvedValue(status({ state: 'partial', packs: 37, folder: '/Drive/Packs' }))
    await mountImages({ ...DEFAULT_SETTINGS, iconPacksFolder: '/Drive/Packs' })
    expect(text('icon-packs-status')).toBe('37 of 281 packs are on this Mac (0 MB).')
    expect(text('icon-packs-folder')).toBe('/Drive/Packs')
    expect(labels()[0]).toEqual(['Download the rest', false])
    act(() => rowButtons('iconPacks').find((b) => b.textContent === 'Reset to default')!.click())
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_SETTINGS, iconPacksFolder: null })
    onChange.mockClear()
    pickFolder.mockResolvedValueOnce({ path: '/Other/Packs' })
    await act(async () => {
      rowButtons('iconPacks').find((b) => b.textContent === 'Choose a folder…')!.click()
      await Promise.resolve()
    })
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_SETTINGS, iconPacksFolder: '/Other/Packs' })
  })
})
