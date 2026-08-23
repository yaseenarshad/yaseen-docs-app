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
import { DEFAULT_SETTINGS, type SettingsState } from '@shared/types'
import { SettingsCog } from './SettingsPanel'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLElement | null = null

function mount(settings: SettingsState) {
  const onChange = vi.fn()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<SettingsCog settings={settings} onChange={onChange} />))
  act(() => container?.querySelector<HTMLButtonElement>('.settings__cog')?.click())
  return { onChange, el: container }
}

/** The Appearance row: first labelled row of the panel. */
const appearanceButtons = (el: HTMLElement) => [...el.querySelectorAll('.settings__row')[0].querySelectorAll('button')]

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
  it("offers Obsidian's three location options under a Files & Links heading, Vault folder active by default, no folder input", () => {
    const { el } = mount({ ...DEFAULT_SETTINGS })
    expect(el.querySelector('.settings__section')?.textContent).toBe('Files & Links')
    const labels = [...el.querySelectorAll('.settings__label')].map((l) => l.textContent)
    expect(labels).toContain('Default location for new notes')
    expect(locationButtons(el).map((b) => b.textContent)).toEqual(['Vault folder', 'Same folder as current file', 'In the folder specified below'])
    expect(locationButtons(el).map((b) => b.classList.contains('settings__option--active'))).toEqual([true, false, false])
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
