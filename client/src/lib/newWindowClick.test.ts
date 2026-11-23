/** YAZ-4444 (D32 of YAZ-4278): ⇧⌘-click on a file opens it in a new window; Settings › Hotkeys › Files in lists changes it. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type SettingsState } from '@shared/types'

vi.mock('../api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../api')>()), api: { window: { open: vi.fn().mockResolvedValue({}) } } }))
const here = vi.hoisted(() => ({ settings: null as SettingsState | null, roots: ['/v', '/w'] }))
vi.mock('./storage', () => ({ storage: { getSettings: () => here.settings, getRoots: () => here.roots } }))
import { api } from '../api'
import { isNewWindowClick, newWindowClick } from './newWindowClick'

const mods = (held: string) => ({ metaKey: held.includes('⌘'), ctrlKey: held.includes('⌃'), altKey: held.includes('⌥'), shiftKey: held.includes('⇧') })

describe('newWindowClick (YAZ-4444)', () => {
  beforeEach(() => {
    here.settings = DEFAULT_SETTINGS
    vi.mocked(api.window.open).mockClear()
  })

  it('⇧⌘-click opens the file in a new window on the vault that holds it; no other click does', () => {
    expect(newWindowClick(mods('⌘⇧'), '/w/Docs/Plan.md')).toBe(true)
    expect(api.window.open).toHaveBeenCalledExactlyOnceWith({ root: '/w', file: '/w/Docs/Plan.md' })
    for (const held of ['', '⇧', '⌘', '⌥', '⌥⌘⇧', '⌃⌘⇧']) expect(newWindowClick(mods(held), '/v/a.md'), held).toBe(false)
    expect(api.window.open).toHaveBeenCalledTimes(1)
  })

  it('a path in none of the window\'s vaults opens no window, but the click is still taken', () => {
    expect(newWindowClick(mods('⌘⇧'), '/elsewhere/a.md')).toBe(true)
    expect(api.window.open).not.toHaveBeenCalled()
  })

  it('reads the binding at the click: a changed gesture works at once, and ⇧⌘-click is then a plain ⇧⌘-click', () => {
    here.settings = { ...DEFAULT_SETTINGS, hotkeys: { 'files.newWindow': 'CmdOrCtrl+Alt+Click' } }
    expect(isNewWindowClick(mods('⌘⇧'))).toBe(false)
    expect(newWindowClick(mods('⌥⌘'), '/v/a.md')).toBe(true)
    expect(api.window.open).toHaveBeenCalledExactlyOnceWith({ root: '/v', file: '/v/a.md' })
    here.settings = { ...DEFAULT_SETTINGS, hotkeys: { 'files.newWindow': null } }
    expect(isNewWindowClick(mods('⌘⇧'))).toBe(false)
  })
})
