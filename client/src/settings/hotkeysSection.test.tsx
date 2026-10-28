/**
 * Settings › Hotkeys (YAZ-3397): a changed key takes two steps (D6) — record, then a pop-up that shows the key
 * now and the key it will have — and only
 * the confirm writes `settings.hotkeys`; a reset asks first (D7); a built-in or macOS key is refused and the
 * row keeps recording; the page's own search bar filters it by words ("file window"), and "Press keys to search"
 * puts the key in that box and says who owns it (D5).
 * While a recorder listens, main is told to take the menu's keys away, and no key reaches the dialog.
 * The bridge is mocked: this Mac's Spotlight is on ⌥Space, so ⌘Space is free.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MACOS_HOTKEYS } from '@shared/macosHotkeys'
import { DEFAULT_SETTINGS, type SettingsState } from '@shared/types'
import { api } from '../api'
import { SettingsDialog } from './SettingsDialog'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { state: { systemHotkeys: vi.fn() }, hotkeys: { recording: vi.fn() } },
}))

const systemHotkeys = vi.mocked(api.state.systemHotkeys)
const recording = vi.mocked(api.hotkeys.recording)

let root: Root | null = null
let el: HTMLElement
const onChange = vi.fn()
const onClose = vi.fn()

/** The dialog over live settings: a write shows at once, as App's `changeSettings` does. */
function Harness({ start }: { start: SettingsState }) {
  const [settings, setSettings] = useState(start)
  return (
    <SettingsDialog
      ctx={{
        settings,
        onChange: (next) => {
          onChange(next)
          setSettings(next)
        },
      }}
      onClose={onClose}
      initialPage="hotkeys"
    />
  )
}

beforeEach(() => {
  onChange.mockReset()
  onClose.mockReset()
  recording.mockReset().mockResolvedValue(undefined)
  systemHotkeys.mockReset().mockResolvedValue(MACOS_HOTKEYS.map((r) => (r.label === 'Spotlight' ? { label: r.label, accelerator: 'Alt+Space', changedOnThisMac: true as const } : { label: r.label, accelerator: r.accelerator })))
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  el.remove()
})

const flush = () => act(async () => await Promise.resolve())

async function mount(hotkeys: SettingsState['hotkeys'] = {}, hotkeysAside: SettingsState['hotkeysAside'] = {}) {
  el = document.createElement('div')
  document.body.appendChild(el)
  root = createRoot(el)
  act(() => root?.render(<Harness start={{ ...DEFAULT_SETTINGS, hotkeys, hotkeysAside }} />))
  await flush()
  await flush()
}

const row = (id: string) => el.querySelector<HTMLElement>(`[data-setting="${id}"]`) as HTMLElement
const keyButton = (id: string) => row(`hotkey-${id}`).querySelector<HTMLButtonElement>('.hotkeys__key') as HTMLButtonElement
const button = (scope: HTMLElement, text: string) => [...scope.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === text) as HTMLButtonElement
const lines = (id: string) => [...row(`hotkey-${id}`).querySelectorAll('.hotkeys__line')].map((l) => l.textContent)
const click = (b: HTMLElement) => act(() => b.click())
/** The change pop-up (D6), or null. */
const popup = () => el.querySelector<HTMLElement>('.confirm')
/** What the pop-up says: its question, the key now → the key it will have, and its other lines. */
const says = () => {
  const p = popup() as HTMLElement
  const caps = [...p.querySelectorAll('.hotkeys__cap')].map((c) => c.textContent)
  return [p.querySelector('.confirm__text')?.textContent, `${caps[0]} → ${caps[1]}`, ...[...p.querySelectorAll('.hotkeys__line')].map((l) => l.textContent)]
}
const shownRows = () => [...el.querySelectorAll<HTMLElement>('.setting')].map((r) => r.dataset.setting)
const hotkeyBox = () => el.querySelector<HTMLInputElement>('input[aria-label="Search hotkeys"]') as HTMLInputElement
function type(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  act(() => {
    set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
/** A key as the user presses it, aimed at whatever has the focus. */
const press = (key: string, code: string, mods: KeyboardEventInit = {}) =>
  act(() => void (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true, ...mods })))

describe('a changeable key (D6, D7)', () => {
  it('record → a pop-up with the key now → the new key, nothing written; Save writes the change; the menu loses its keys only while recording', async () => {
    await mount()
    expect(keyButton('search').textContent).toBe('⌘K')
    click(keyButton('search'))
    expect(keyButton('search').textContent).toBe('Press new keys…')
    expect(lines('search')).toEqual(['Esc cancels. ⌫ removes the key. Nothing happens? Another app may own that key.'])
    await flush()
    expect(recording.mock.calls).toEqual([[true]])

    press('Y', 'KeyY', { metaKey: true, altKey: true }) // free in every place (⌘⇧K is a diagram's and a code tab's too, YAZ-3564)
    expect(says()).toEqual(['Change the key for Search the vault?', '⌘K → ⌥⌘Y'])
    expect(popup()?.getAttribute('role')).toBe('dialog')
    // Nothing destroyed, nothing Mac-standard: the keyboard starts on Save.
    expect(document.activeElement?.textContent).toBe('Save')
    expect(onChange).not.toHaveBeenCalled()
    await flush()
    expect(recording.mock.calls).toEqual([[true], [false]])

    click(button(popup() as HTMLElement, 'Save'))
    expect(popup()).toBeNull()
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, hotkeys: { 'app.search': 'CmdOrCtrl+Alt+Y' } })
    expect(keyButton('search').textContent).toBe('⌥⌘Y')
    expect(keyButton('search').classList.contains('hotkeys__key--changed')).toBe(true)

    // Reset asks first, and only its confirm writes: back to `{}`.
    click(button(row('hotkey-search'), 'Reset'))
    expect(says()).toEqual(['Reset Search the vault?', '⌥⌘Y → ⌘K'])
    expect(onChange).toHaveBeenCalledTimes(1)
    click(button(popup() as HTMLElement, 'Cancel'))
    expect(popup()).toBeNull()
    expect(onChange).toHaveBeenCalledTimes(1)
    click(button(row('hotkey-search'), 'Reset'))
    click(button(popup() as HTMLElement, 'Reset'))
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, hotkeys: {} })
    expect(button(row('hotkey-search'), 'Reset')).toBeUndefined()
  })

  it('a built-in or macOS key is refused in red and the row keeps recording; Esc cancels it and never reaches the dialog', async () => {
    await mount()
    click(keyButton('search'))
    // ⌘⌫ is the window's own Trash key: built in (⌘J can change since YAZ-3564, so it would move instead).
    press('Backspace', 'Backspace', { metaKey: true })
    expect(lines('search')[0]).toBe('⌘⌫ is built in: App › Move the selected files and folders to the Trash. Pick a different key.')
    press('Q', 'KeyQ', { metaKey: true, shiftKey: true })
    expect(lines('search')[0]).toBe('macOS uses ⌘⇧Q for Log out. Pick a different key.')
    // Red is the refused class (jsdom has no colour; the e2e step 5 checks the colour): the hint under it is not refused.
    const [refusedLine, hintLine] = row('hotkey-search').querySelectorAll('.hotkeys__line')
    expect(refusedLine.classList.contains('hotkeys__line--refused')).toBe(true)
    expect(hintLine.classList.contains('hotkeys__line--refused')).toBe(false)
    expect(keyButton('search').textContent).toBe('Press new keys…')
    // This Mac moved Spotlight to ⌥Space: ⌘Space is free.
    press(' ', 'Space', { metaKey: true })
    expect(says()).toEqual(['Change the key for Search the vault?', '⌘K → ⌘Space'])
    // Esc answers the pop-up, never the Settings dialog under it.
    press('Escape', 'Escape')
    expect(popup()).toBeNull()
    expect(onClose).not.toHaveBeenCalled()

    click(keyButton('search'))
    press('Escape', 'Escape')
    expect(keyButton('search').textContent).toBe('⌘K')
    expect(onClose).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
  })

  it("another command's key moves here and that command loses it; a Mac-standard key asks harder; ⌫ asks before it removes", async () => {
    await mount()
    click(keyButton('search'))
    press('W', 'KeyW', { metaKey: true, shiftKey: true })
    expect(says()).toEqual(['Change the key for Search the vault?', '⌘K → ⌘⇧W', '⌘⇧W is App › New Files window now. It will lose its key.'])
    click(button(popup() as HTMLElement, 'Move it here'))
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, hotkeys: { 'app.search': 'CmdOrCtrl+Shift+W', 'app.newFilesWindow': null } })
    expect(keyButton('newFilesWindow').textContent).toBe('No key')

    click(keyButton('closeTab'))
    press('Y', 'KeyY', { metaKey: true, altKey: true })
    expect(says()).toEqual(['Change the key for Close tab?', '⌘W → ⌥⌘Y', '⌘W is the Mac standard for Close tab. Most Mac apps use it.'])
    // A Mac-standard key asks harder: a red "Change anyway", and the keyboard starts on Cancel.
    expect(button(popup() as HTMLElement, 'Change anyway').classList.contains('confirm__btn--danger')).toBe(true)
    expect(document.activeElement?.textContent).toBe('Cancel')
    click(button(popup() as HTMLElement, 'Cancel'))

    click(keyButton('closeTab'))
    press('Backspace', 'Backspace')
    expect(says()).toEqual(['Remove the key from Close tab?', '⌘W → No key', '⌘W is the Mac standard for Close tab. Most Mac apps use it.'])
    click(button(popup() as HTMLElement, 'Remove'))
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, hotkeys: { 'app.search': 'CmdOrCtrl+Shift+W', 'app.newFilesWindow': null, 'app.closeTab': null } })
  })

  it('"Reset all hotkeys" is there only with a change, and asks in the confirm sheet with the list of changes', async () => {
    await mount({ search: 'CmdOrCtrl+Shift+K', closeTab: null })
    click(button(row('hotkeys-reset-all'), 'Reset all hotkeys'))
    const sheet = el.querySelector<HTMLElement>('.confirm') as HTMLElement
    expect(sheet.querySelector('.confirm__text')?.textContent).toBe('Reset 2 changed hotkeys?')
    expect([...sheet.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['App › Close tab: No key → ⌘W', 'App › Search the vault: ⌘⇧K → ⌘K'])
    expect(onChange).not.toHaveBeenCalled()
    click(button(sheet, 'Reset 2 hotkeys'))
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, hotkeys: {} })
    expect(row('hotkeys-reset-all')).toBeNull()
  })
})

describe('the page (D5, D8)', () => {
  it('"Used by macOS" lists this Mac\'s keys, and says which the user set', async () => {
    await mount()
    expect(systemHotkeys).toHaveBeenCalledTimes(1)
    expect(row('hotkey-macos-spotlight').textContent).toBe('⌥SpaceSpotlight (you set it on this Mac)')
    expect(row('hotkey-macos-spotlight').querySelector('button')).toBeNull()
  })

  it('the page\'s search bar filters the page by words, a slip forgiven: "file window" and "file winodw" find New Files window first; Esc clears the box, then closes', async () => {
    await mount()
    expect(hotkeyBox().placeholder).toBe('Search hotkeys…')
    type(hotkeyBox(), 'file window')
    expect(shownRows()[0]).toBe('hotkey-newFilesWindow')
    expect(shownRows().every((id) => id?.startsWith('hotkey-'))).toBe(true)
    type(hotkeyBox(), 'file winodw')
    expect(shownRows()[0]).toBe('hotkey-newFilesWindow')
    type(hotkeyBox(), 'close tab')
    expect(shownRows()).toEqual(['hotkey-closeTab'])
    // The box stays while its query filters, and the nav's search box is untouched.
    expect(hotkeyBox().value).toBe('close tab')
    expect(el.querySelector<HTMLInputElement>('input[aria-label="Search settings"]')?.value).toBe('')
    type(hotkeyBox(), 'zzzz')
    expect(el.querySelector('.settings-empty')?.textContent).toBe('No hotkeys match “zzzz”.')

    act(() => void hotkeyBox().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(hotkeyBox().value).toBe('')
    expect(shownRows()).toContain('hotkey-newFilesWindow')
    expect(onClose).not.toHaveBeenCalled()
    act(() => void hotkeyBox().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('"Press keys to search" puts the key in the page\'s search box, filters to its row and says who owns it; Esc stops it', async () => {
    await mount()
    const search = () => el.querySelector<HTMLElement>('.hotkeys__search') as HTMLElement
    click(button(search(), 'Press keys to search'))
    press('k', 'KeyK', { metaKey: true })
    expect(hotkeyBox().value).toBe('⌘K')
    expect(search().querySelector('[role="status"]')?.textContent).toMatch(/^⌘K: App › Search the vault; Drawing › .*; Diagram › .*; Code › /)
    // Every row on ⌘K shows, in every place (YAZ-3564 K10): Search the vault first.
    expect(shownRows()[0]).toBe('hotkey-search')
    expect(shownRows()).toContain('hotkey-drawing-link')
    // Typing over the pressed key ends its answer.
    type(hotkeyBox(), '⌘K ')
    expect(search().querySelector('[role="status"]')).toBeNull()

    for (const [key, code, mods, answer] of [
      ['Y', 'KeyY', { metaKey: true, altKey: true }, '⌥⌘Y is free. You can use it.'],
      // Every action on the key, in every place (YAZ-3564 K10).
      ['j', 'KeyJ', { metaKey: true }, '⌘J: Note › Table of contents; Diagram › Fit the page.'],
      ['Q', 'KeyQ', { metaKey: true, shiftKey: true }, "⌘⇧Q: macOS uses it for Log out. You can't use it."],
    ] as const) {
      click(button(search(), 'Press keys to search'))
      press(key, code, mods)
      expect(search().querySelector('[role="status"]')?.textContent).toBe(answer)
    }

    click(button(search(), 'Press keys to search'))
    press('Escape', 'Escape')
    expect(button(search(), 'Press keys to search')).toBeDefined()
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('every place on one page (YAZ-3564)', () => {
  const chip = (text: string) => button(el.querySelector('.hotkeys__filters') as HTMLElement, text)
  const toggle = (text: string) => act(() => [...el.querySelectorAll<HTMLLabelElement>('.hotkeys__toggles label')].find((l) => l.textContent?.includes(text))?.querySelector('input')?.click())

  it('a group chip shows one place (K7); a blocked row says who fires first (K3); "Show clashes only" keeps the blocked rows and the App keys that block them', async () => {
    await mount()
    click(chip('Drawing'))
    expect(shownRows().every((id) => id?.startsWith('hotkey-drawing-'))).toBe(true)
    // ⌘K is Search the vault's: on a Mac the menu fires first, so a drawing's Add link never works.
    expect(row('hotkey-drawing-link').querySelector('.hotkeys__blocked')?.textContent).toBe(' Blocked: App › Search the vault fires first')
    expect(row('hotkey-drawing-duplicate').querySelector('.hotkeys__blocked')).toBeNull() // Go to your place lets drawings keep ⌘D (K9)
    click(chip('All'))
    toggle('Show clashes only')
    expect(shownRows()).toContain('hotkey-search')
    expect(shownRows()).toContain('hotkey-drawing-link')
    expect(shownRows()).not.toContain('hotkey-drawing-duplicate')
    expect(shownRows()).not.toContain('hotkey-newTab')
  })

  it('"Let drawings, diagrams and code keep this key" (K9): off for Go to your place, and a drawing\'s Duplicate is blocked; on again, it writes nothing', async () => {
    await mount()
    const aside = () => row('hotkey-goTo').querySelector<HTMLInputElement>('.hotkeys__aside input') as HTMLInputElement
    expect(aside().checked).toBe(true)
    act(() => aside().click())
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, hotkeysAside: { 'app.goTo': false } })
    expect(row('hotkey-drawing-duplicate').querySelector('.hotkeys__blocked')?.textContent).toBe(' Blocked: App › Go to your place fires first')
    act(() => aside().click())
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, hotkeysAside: {} })
    // Every other App key starts with it off.
    expect(row('hotkey-search').querySelector<HTMLInputElement>('.hotkeys__aside input')?.checked).toBe(false)
  })

  it('the switch shows only where the menu can let a key go (Copy path, which the page handles, and a row with no key have none); a changed switch is a change Reset undoes', async () => {
    await mount({ 'app.search': null }, { 'app.goTo': false })
    const hasSwitch = (id: string) => row(id).querySelector('.hotkeys__aside') !== null
    expect([hasSwitch('hotkey-goTo'), hasSwitch('hotkey-newTab'), hasSwitch('hotkey-copyPath'), hasSwitch('hotkey-search')]).toEqual([true, true, false, false])
    toggle('Changed from default')
    expect(shownRows().filter((id) => id?.startsWith('hotkey-'))).toEqual(['hotkey-goTo', 'hotkey-search'])
    click(button(row('hotkey-goTo'), 'Reset'))
    click(button(popup() as HTMLElement, 'Reset'))
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, hotkeys: { 'app.search': null }, hotkeysAside: {} })
  })

  it('a place key moves off another place\'s row with "Move it here" (K8), and "Changed from default" shows the changes with "Reset all shown" (K7)', async () => {
    await mount()
    // A note's Quote has no key (D10); give it Bold's ⌘B.
    click(keyButton('note-quote'))
    press('b', 'KeyB', { metaKey: true })
    expect(says()).toEqual(['Change the key for Quote?', 'No key → ⌘B', '⌘B is Note › Bold now. It will lose its key.'])
    click(button(popup() as HTMLElement, 'Move it here'))
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, hotkeys: { 'note.bold': null, 'note.quote': 'CmdOrCtrl+B' } })
    toggle('Changed from default')
    expect(shownRows().filter((id) => id?.startsWith('hotkey-'))).toEqual(['hotkey-note-bold', 'hotkey-note-quote'])
    click(button(row('hotkeys-reset-all'), 'Reset all shown'))
    click(button(el.querySelector('.confirm') as HTMLElement, 'Reset 2 hotkeys'))
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, hotkeys: {} })
  })
})
