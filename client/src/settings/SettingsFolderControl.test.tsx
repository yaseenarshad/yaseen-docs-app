/**
 * Settings › General › Settings folder (YAZ-3276 D5, D7): the row says what main answers — the default, a
 * chosen path, the red line while that folder is missing — and its two buttons send what D6 needs. The
 * bridge is mocked: no row may reach a real main process.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_SETTINGS } from '@shared/types'
import { api } from '../api'
import { SettingsDialog } from './SettingsDialog'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: {
    pickFolder: vi.fn(),
    state: { settingsFolder: vi.fn(), setSettingsFolder: vi.fn() },
  },
}))

const settingsFolder = vi.mocked(api.state.settingsFolder)
const setSettingsFolder = vi.mocked(api.state.setSettingsFolder)
const pickFolder = vi.mocked(api.pickFolder)

let root: Root | null = null
let el: HTMLElement

beforeEach(() => {
  settingsFolder.mockReset().mockResolvedValue({ folder: null, missing: false })
  setSettingsFolder.mockReset().mockResolvedValue(undefined)
  pickFolder.mockReset().mockResolvedValue({ cancelled: true })
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  el.remove()
})

const flush = () => act(async () => await Promise.resolve())

/** The dialog as it opens: on General, the first page. */
async function mount() {
  el = document.createElement('div')
  document.body.appendChild(el)
  root = createRoot(el)
  act(() => root?.render(<SettingsDialog ctx={{ settings: { ...DEFAULT_SETTINGS }, onChange: vi.fn() }} onClose={vi.fn()} />))
  await flush()
}
const path = () => el.querySelector('[data-testid="settings-folder-path"]')?.textContent
const alert = () => el.querySelector('[data-setting="settingsFolder"] [role="alert"]')?.textContent ?? null
const button = (label: string) => [...el.querySelectorAll<HTMLButtonElement>('[data-setting="settingsFolder"] button')].find((b) => b.textContent === label)

describe('Settings › General › Settings folder', () => {
  it('the default: "On this Mac only (default)", no red line, Reset off', async () => {
    await mount()
    expect(path()).toBe('On this Mac only (default)')
    expect(alert()).toBeNull()
    expect(button('Reset to default')?.disabled).toBe(true)
    expect(button('Choose…')?.disabled).toBe(false)
  })

  it('Choose… sends the picked folder, then shows what main answers', async () => {
    pickFolder.mockResolvedValue({ path: '/Sync/yaseen-docs-settings' } as Awaited<ReturnType<typeof api.pickFolder>>)
    await mount()
    settingsFolder.mockResolvedValue({ folder: '/Sync/yaseen-docs-settings', missing: false })
    act(() => button('Choose…')?.click())
    await flush()
    await flush()
    expect(setSettingsFolder).toHaveBeenCalledWith('/Sync/yaseen-docs-settings')
    expect(path()).toBe('/Sync/yaseen-docs-settings')
    expect(button('Reset to default')?.disabled).toBe(false)
  })

  it('a missing folder (D5): the red line; Reset to default sends null and the line goes', async () => {
    settingsFolder.mockResolvedValue({ folder: '/Sync/gone', missing: true })
    await mount()
    expect(path()).toBe('/Sync/gone')
    expect(alert()).toBe("Can't find this folder. This Mac uses its last settings. It reads the folder again when it comes back.")
    settingsFolder.mockResolvedValue({ folder: null, missing: false })
    act(() => button('Reset to default')?.click())
    await flush()
    await flush()
    expect(setSettingsFolder).toHaveBeenCalledWith(null)
    expect(path()).toBe('On this Mac only (default)')
    expect(alert()).toBeNull()
  })

  it('YAZ-3308: Choose… and Reset to default sit side by side in one row, so a wide row does not stretch each one to full width', async () => {
    await mount()
    const group = el.querySelector('[data-setting="settingsFolder"] .settings__options')
    expect([...(group?.querySelectorAll('button') ?? [])].map((b) => b.textContent)).toEqual(['Choose…', 'Reset to default'])
  })

  it('a bridge that cannot answer leaves "…", never a wrong path', async () => {
    settingsFolder.mockRejectedValue(new Error('no bridge'))
    await mount()
    expect(path()).toBe('…')
  })
})
