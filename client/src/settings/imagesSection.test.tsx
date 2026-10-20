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
import { SettingsDialog } from './SettingsDialog'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    api: {
      drawing: { libraryFolder: vi.fn() },
      pickFolder: vi.fn(),
      secrets: { has: vi.fn(), set: vi.fn() },
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

  it('asks main whether a key is set: "No key", a password field, Save off until typed, Clear off with nothing to clear', async () => {
    await mountImages()
    expect(secretHas).toHaveBeenCalledExactlyOnceWith({ name: 'pixabayApiKey' })
    expect(statusText()).toBe('No key')
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
    expect(statusText()).toBe('Key set')
    expect(keyInput().value).toBe('')
    expect(el.textContent).not.toContain('sk-very-secret')
  })

  it('Clear writes null; a save that fails says so in the status line and the key stays unset', async () => {
    secretHas.mockResolvedValue(true)
    await mountImages()
    expect(statusText()).toBe('Key set')
    await act(async () => {
      rowButtons('pixabayApiKey')[1].click()
      await Promise.resolve()
    })
    expect(secretSet).toHaveBeenCalledExactlyOnceWith({ name: 'pixabayApiKey', value: null })
    expect(statusText()).toBe('No key')
    secretSet.mockRejectedValueOnce(new BridgeRequestError('IO_ERROR', 'disk went away'))
    type(keyInput(), 'k')
    await act(async () => {
      rowButtons('pixabayApiKey')[0].click()
      await Promise.resolve()
    })
    expect(statusText()).toBe('The key could not be saved.')
  })
})
