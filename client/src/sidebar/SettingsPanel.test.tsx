/**
 * The settings cog's Appearance row (Desktop K, GRO-2218): Obsidian's control — System,
 * Light, Dark in that order — writing through the same onChange as every other row.
 * The Files & Links section (Links C2-, GRO-2240): Obsidian's "Default location for new
 * notes" — Vault folder · Same folder as current file · In the folder specified below,
 * with the root-relative folder input shown only for the third option, validated on
 * commit (invalid keeps the stored value and marks the input, CreateInline-style).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_SETTINGS, type GithubSyncStatus, type SettingsState } from '@shared/types'
import { SettingsCog } from './SettingsPanel'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLElement | null = null

function mount(settings: SettingsState, syncStatus?: GithubSyncStatus | null) {
  const onChange = vi.fn()
  const setEnabled = vi.fn()
  // `undefined` (the argument omitted) means no GitHub Sync section at all; an explicit `null`
  // is the section present with its first status fetch still in flight.
  const sync = syncStatus === undefined ? undefined : { status: syncStatus, setEnabled }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<SettingsCog settings={settings} onChange={onChange} sync={sync} />))
  act(() => container?.querySelector<HTMLButtonElement>('.settings__cog')?.click())
  return { onChange, setEnabled, el: container }
}

/** The Appearance row: first labelled row of the panel. */
const appearanceButtons = (el: HTMLElement) => [...el.querySelectorAll('.settings__row')[0].querySelectorAll('button')]
/** Content width follows Appearance and uses the same compact segmented control. */
const contentWidthButtons = (el: HTMLElement) => [...el.querySelectorAll('.settings__row')[1].querySelectorAll('button')]

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

describe('SettingsCog Appearance row (Desktop K, GRO-2218)', () => {
  it('offers System · Light · Dark in that order, with the current value active', () => {
    const { el } = mount({ ...DEFAULT_SETTINGS })
    expect(el.querySelectorAll('.settings__label')[0].textContent).toBe('Appearance')
    const buttons = appearanceButtons(el)
    expect(buttons.map((b) => b.textContent)).toEqual(['System', 'Light', 'Dark'])
    expect(buttons.map((b) => b.classList.contains('settings__option--active'))).toEqual([true, false, false])
  })

  it('clicking Dark writes the whole settings object with theme flipped, nothing else touched', () => {
    const { onChange, el } = mount({ ...DEFAULT_SETTINGS })
    appearanceButtons(el)[2].click()
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_SETTINGS, theme: 'dark' })
  })

  it('marks Dark active when the stored theme is dark', () => {
    const { el } = mount({ ...DEFAULT_SETTINGS, theme: 'dark' })
    expect(appearanceButtons(el).map((b) => b.classList.contains('settings__option--active'))).toEqual([false, false, true])
  })
})

describe('SettingsCog Content width row (YAZ-1176)', () => {
  it('offers Narrow · Medium · Full in that order, with Narrow active by default', () => {
    const { el } = mount({ ...DEFAULT_SETTINGS })
    expect(el.querySelectorAll('.settings__label')[1].textContent).toBe('Content width')
    const buttons = contentWidthButtons(el)
    expect(buttons.map((b) => b.textContent)).toEqual(['Narrow', 'Medium', 'Full'])
    expect(buttons.map((b) => b.classList.contains('settings__option--active'))).toEqual([true, false, false])
  })

  it('clicking Full writes the whole settings object with only contentWidth changed', () => {
    const { onChange, el } = mount({ ...DEFAULT_SETTINGS })
    contentWidthButtons(el)[2].click()
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_SETTINGS, contentWidth: 'full' })
  })

  it('marks Medium active when the stored content width is medium', () => {
    const { el } = mount({ ...DEFAULT_SETTINGS, contentWidth: 'medium' })
    expect(contentWidthButtons(el).map((b) => b.classList.contains('settings__option--active'))).toEqual([false, true, false])
  })
})

/** The Comments row's two options, found by its label so the row's position is not what the test pins. */
const commentsOrderButtons = (el: HTMLElement) => {
  const label = [...el.querySelectorAll('.settings__label')].find((p) => p.textContent === 'Comments')
  return [...(label?.nextElementSibling?.querySelectorAll('button') ?? [])]
}

describe('SettingsCog Comments row (YAZ-1515)', () => {
  it('offers Oldest first · Newest first in that order, above Files & Links, with Oldest first active by default', () => {
    const { el } = mount({ ...DEFAULT_SETTINGS })
    const labels = [...el.querySelectorAll('.settings__label, .settings__section')].map((p) => p.textContent)
    expect(labels.indexOf('Comments')).toBeLessThan(labels.indexOf('Files & Links'))
    const buttons = commentsOrderButtons(el)
    expect(buttons.map((b) => b.textContent)).toEqual(['Oldest first', 'Newest first'])
    expect(buttons.map((b) => b.classList.contains('settings__option--active'))).toEqual([true, false])
  })

  it('clicking Newest first writes the whole settings object with only commentsOrder changed', () => {
    const { onChange, el } = mount({ ...DEFAULT_SETTINGS })
    commentsOrderButtons(el)[1].click()
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_SETTINGS, commentsOrder: 'newest' })
  })

  it('marks Newest first active when the stored order is newest', () => {
    const { el } = mount({ ...DEFAULT_SETTINGS, commentsOrder: 'newest' })
    expect(commentsOrderButtons(el).map((b) => b.classList.contains('settings__option--active'))).toEqual([false, true])
  })
})

/** The Files & Links location options (stacked — the long Obsidian labels get a column, not a row). */
const locationButtons = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('.settings__stack button')]
const folderInput = (el: HTMLElement) => el.querySelector<HTMLInputElement>('.settings__input')

/** Drive the CONTROLLED folder input like a user: native value setter + input event, then commit. */
function typeFolder(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  act(() => {
    set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const pressEnter = (input: HTMLInputElement) => act(() => void input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
const blur = (input: HTMLInputElement) => act(() => void input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))

describe('SettingsCog Files & Links section (Links C2-, GRO-2240)', () => {
  it("offers Obsidian's three location options under a Files & Links heading, Same folder as current file active by default (YAZ-1643), no folder input", () => {
    const { el } = mount({ ...DEFAULT_SETTINGS })
    expect(el.querySelector('.settings__section')?.textContent).toBe('Files & Links')
    const labels = [...el.querySelectorAll('.settings__label')].map((l) => l.textContent)
    expect(labels).toContain('Default location for new notes')
    expect(locationButtons(el).map((b) => b.textContent)).toEqual(['Vault folder', 'Same folder as current file', 'In the folder specified below'])
    expect(locationButtons(el).map((b) => b.classList.contains('settings__option--active'))).toEqual([false, true, false])
    expect(folderInput(el)).toBeNull() // the input shows only for the third option
  })

  it('clicking an option writes the whole settings object with only the location flipped', () => {
    const { onChange, el } = mount({ ...DEFAULT_SETTINGS })
    locationButtons(el)[1].click()
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_SETTINGS, newNoteLocation: 'current' })
  })

  it('"In the folder specified below" shows the input seeded with the stored folder; Enter commits a valid root-relative path', () => {
    const { onChange, el } = mount({ ...DEFAULT_SETTINGS, newNoteLocation: 'folder', newNoteFolder: 'Old' })
    const input = folderInput(el)
    expect(input).not.toBeNull()
    expect(input?.value).toBe('Old')
    typeFolder(input as HTMLInputElement, 'Notes/Inbox')
    pressEnter(input as HTMLInputElement)
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_SETTINGS, newNoteLocation: 'folder', newNoteFolder: 'Notes/Inbox' })
  })

  it('blur commits too, and blurring with the stored value untouched writes nothing', () => {
    const { onChange, el } = mount({ ...DEFAULT_SETTINGS, newNoteLocation: 'folder', newNoteFolder: 'Old' })
    const input = folderInput(el) as HTMLInputElement
    blur(input) // untouched → no write
    expect(onChange).not.toHaveBeenCalled()
    typeFolder(input, 'Fresh')
    blur(input)
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_SETTINGS, newNoteLocation: 'folder', newNoteFolder: 'Fresh' })
  })

  // Dot-names (GRO-2197): create-on-click rejects hidden `.name` segments, so the validator must too.
  it.each([['/abs'], ['a/../b'], ['a//b'], ['Notes/'], ['.archive'], ['Notes/.archive']])('an invalid folder (%s) keeps the stored value and marks the input; editing clears the mark', (bad) => {
    const { onChange, el } = mount({ ...DEFAULT_SETTINGS, newNoteLocation: 'folder', newNoteFolder: 'Old' })
    const input = folderInput(el) as HTMLInputElement
    typeFolder(input, bad)
    pressEnter(input)
    expect(onChange).not.toHaveBeenCalled() // stored value untouched
    expect(input.classList.contains('settings__input--error')).toBe(true)
    expect(input.value).toBe(bad) // the typed text stays for fixing up
    typeFolder(input, 'ok')
    expect(input.classList.contains('settings__input--error')).toBe(false)
  })

  it('committing an empty folder is valid — it means the vault root', () => {
    const { onChange, el } = mount({ ...DEFAULT_SETTINGS, newNoteLocation: 'folder', newNoteFolder: 'Old' })
    const input = folderInput(el) as HTMLInputElement
    typeFolder(input, '  ')
    pressEnter(input)
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_SETTINGS, newNoteLocation: 'folder', newNoteFolder: '' })
  })
})

/**
 * GitHub Sync (YAZ-1081 3B): the one section NOT backed by `SettingsState` — the switch lives
 * per-vault in `.yaseendocs/github.json`, so it reads and writes through the engine. The panel
 * therefore has no config prop: the STATUS is the switch's read-back, and the hint states what
 * we detected about the repo rather than telling the user what they already know.
 */
/** Found through the section's own label, not by index: "Confirm before deleting" shares the options-row class. */
const syncRow = (el: HTMLElement) => [...el.querySelectorAll('.settings__label')].find((l) => l.textContent === 'Sync this vault to GitHub')?.nextElementSibling ?? null
const syncButtons = (el: HTMLElement) => [...(syncRow(el)?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
const syncHint = (el: HTMLElement) => syncRow(el)?.nextElementSibling?.textContent
const status = (extra: Partial<GithubSyncStatus> = {}): GithubSyncStatus => ({ root: '/vault', state: 'off', ...extra })

describe('SettingsCog GitHub Sync section (YAZ-1081 3B)', () => {
  it('is absent entirely when App passes no sync — the panel is unchanged for mounts without it', () => {
    const { el } = mount({ ...DEFAULT_SETTINGS })
    expect([...el.querySelectorAll('.settings__section')].map((s) => s.textContent)).toEqual(['Files & Links'])
    expect([...el.querySelectorAll('.settings__label')].map((l) => l.textContent)).not.toContain('Sync this vault to GitHub')
  })

  it('renders under its own heading with an On/Off row when the prop is there', () => {
    const { el } = mount({ ...DEFAULT_SETTINGS }, status())
    expect([...el.querySelectorAll('.settings__section')].map((s) => s.textContent)).toEqual(['Files & Links', 'GitHub Sync'])
    expect([...el.querySelectorAll('.settings__label')].map((l) => l.textContent)).toContain('Sync this vault to GitHub')
    expect(syncButtons(el).map((b) => b.textContent)).toEqual(['On', 'Off'])
  })

  it('an `off` status marks Off active', () => {
    const { el } = mount({ ...DEFAULT_SETTINGS }, status())
    expect(syncButtons(el).map((b) => b.classList.contains('settings__option--active'))).toEqual([false, true])
  })

  it.each(['synced', 'pending', 'syncing', 'attention'] as const)('an enabled `%s` status marks On active — the engine-stamped `enabled` is the read-back', (state) => {
    const { el } = mount({ ...DEFAULT_SETTINGS }, status({ state, enabled: true }))
    expect(syncButtons(el).map((b) => b.classList.contains('settings__option--active'))).toEqual([true, false])
  })

  it('an enabled vault that is not syncable yet (`enabled` + `state: off` — no repo/remote) still reads On, so the click never looks ignored', () => {
    const { el } = mount({ ...DEFAULT_SETTINGS }, status({ enabled: true }))
    expect(syncButtons(el).map((b) => b.classList.contains('settings__option--active'))).toEqual([true, false])
  })

  it('a null status (first fetch in flight) reads as Off — the safe default, never an optimistic On', () => {
    const { el } = mount({ ...DEFAULT_SETTINGS }, null)
    expect(syncButtons(el).map((b) => b.classList.contains('settings__option--active'))).toEqual([false, true])
  })

  it('clicking On calls setEnabled(true) and writes no SettingsState — this switch is not one of those', () => {
    const { el, setEnabled, onChange } = mount({ ...DEFAULT_SETTINGS }, status())
    syncButtons(el)[0].click()
    expect(setEnabled).toHaveBeenCalledExactlyOnceWith(true)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('clicking Off calls setEnabled(false)', () => {
    const { el, setEnabled } = mount({ ...DEFAULT_SETTINGS }, status({ state: 'synced' }))
    syncButtons(el)[1].click()
    expect(setEnabled).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('a detected remote is stated as fact: repo and branch', () => {
    const { el } = mount({ ...DEFAULT_SETTINGS }, status({ state: 'synced', repo: { remoteUrl: 'git@github.com:me/notes.git', branch: 'main' } }))
    expect(syncHint(el)).toBe('repo git@github.com:me/notes.git · branch main')
  })

  it('a repo whose branch could not be read still names the remote', () => {
    const { el } = mount({ ...DEFAULT_SETTINGS }, status({ repo: { remoteUrl: 'https://github.com/me/notes', branch: null } }))
    expect(syncHint(el)).toBe('repo https://github.com/me/notes · branch —')
  })

  it('a repo with no remote points at GitHub Desktop rather than growing a remote-setup flow', () => {
    const { el } = mount({ ...DEFAULT_SETTINGS }, status({ repo: { remoteUrl: null, branch: 'main' } }))
    expect(syncHint(el)).toBe('This folder is a git repo with no GitHub remote — add one with GitHub Desktop, then turn sync on.')
  })

  it('a folder that is not a repo at all says so', () => {
    const { el } = mount({ ...DEFAULT_SETTINGS }, status())
    expect(syncHint(el)).toBe("This folder isn't a git repo — set it up with GitHub Desktop, then turn sync on.")
  })
})
