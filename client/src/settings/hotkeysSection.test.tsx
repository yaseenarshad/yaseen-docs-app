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

describe('one card per key (YAZ-3564)', () => {
  const chip = (text: string) => button(el.querySelector('.hotkeys__filters') as HTMLElement, text)
  const toggle = (text: string) => act(() => [...el.querySelectorAll<HTMLLabelElement>('.hotkeys__toggles label')].find((l) => l.textContent?.includes(text))?.querySelector('input')?.click())
  /** The card of a key, found by its heading ('⌘D'). */
  const card = (key: string) => [...el.querySelectorAll<HTMLElement>('.settings-group')].find((g) => g.querySelector('.hotkeys__cap-key')?.textContent === key) as HTMLElement
  /** The pick of one tab on a card: its dropdown, and what it shows. */
  const pick = (key: string, place: string) => card(key).querySelector<HTMLSelectElement>(`select[aria-label="${key} in ${place}"]`) as HTMLSelectElement
  const picked = (key: string, place: string) => pick(key, place).selectedOptions[0]?.textContent
  const choose = (key: string, place: string, label: string) =>
    act(() => {
      const select = pick(key, place)
      select.value = String([...select.options].findIndex((o) => o.textContent === label))
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
  const asked = () => [popup()?.querySelector('.confirm__text')?.textContent, ...[...(popup()?.querySelectorAll('.hotkeys__line') ?? [])].map((l) => l.textContent)]
  const lostLine = (id: string) => row(`hotkey-${id}`).querySelector('.hotkeys__lost')?.textContent

  it("a card holds every row on its key, App's first, each with its place; the shared keys a pick settles lead", async () => {
    await mount()
    expect([...el.querySelectorAll('.hotkeys__cap-key')].slice(0, 2).map((h) => h.textContent)).toEqual(['⌘D', '⌘K'])
    expect(card('⌘D').querySelector('.hotkeys__card-head .hotkeys__hint')?.textContent).toBe('Shared: each tab picks what it does.')
    expect([...card('⌘D').querySelectorAll<HTMLElement>('.setting')].map((r) => r.dataset.setting)).toEqual(['hotkey-goTo', 'hotkey-drawing-duplicate', 'hotkey-diagram-duplicate', 'hotkey-code-addSelectionToNextFindMatch'])
    expect(row('hotkey-drawing-duplicate').querySelector('.hotkeys__box-tab')?.textContent).toBe('Drawing')
    // ⌘B is two tabs' own key, no App key: no pick.
    expect(card('⌘B').querySelector('.hotkeys__card-head .hotkeys__hint')?.textContent).toBe('Each tab has its own action.')
    expect(card('⌘B').querySelector('select')).toBeNull()
    // ⌘K takes a drawing's Add a link by default: the row says what ⌘K does there now.
    expect(picked('⌘K', 'drawings')).toBe('Search the vault')
    expect(lostLine('drawing-link')).toBe('Add a link has no key here now.')
    // A code key that begins with ⌘K is on its own card, and links to ⌘K's; ⌘K's card has a box for code's pick.
    expect(lostLine('code-addCommentLine')).toBe('No key here now: ⌘K is App › Search the vault. Change it on ⌘K')
    expect(picked('⌘K', 'code')).toBe('Search the vault')
    expect(button(row('hotkey-code-addCommentLine'), 'Change it on ⌘K')).toBeDefined()
  })

  it('a pick asks first (Take it); taking ⌘D for Show in sidebar in drawings leaves Duplicate no key there, and giving it back writes nothing', async () => {
    await mount()
    expect(picked('⌘D', 'drawings')).toBe('Duplicate')
    expect(lostLine('drawing-duplicate')).toBeUndefined()
    choose('⌘D', 'drawings', 'Show in sidebar')
    expect(asked()).toEqual(['⌘D in drawings: Show in sidebar?', 'Drawing › Duplicate will have no key in drawings.'])
    expect(onChange).not.toHaveBeenCalled()
    click(button(popup() as HTMLElement, 'Cancel'))
    expect(picked('⌘D', 'drawings')).toBe('Duplicate')
    choose('⌘D', 'drawings', 'Show in sidebar')
    click(button(popup() as HTMLElement, 'Take it'))
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, hotkeysAside: { 'app.goTo@drawing': false } })
    expect(picked('⌘D', 'drawings')).toBe('Show in sidebar')
    expect(picked('⌘D', 'diagrams')).toBe('Duplicate') // one tab at a time
    expect(lostLine('drawing-duplicate')).toBe('Duplicate has no key here now.')
    // The App box says where Show in sidebar works now.
    expect(row('hotkey-goTo').querySelector('.hotkeys__box-tab')?.textContent).toBe('Notes · Folder views · Drawings')
    choose('⌘D', 'drawings', 'Duplicate')
    expect(asked()).toEqual(['⌘D in drawings: Duplicate?', 'App › Show in sidebar will not work in drawings.'])
    click(button(popup() as HTMLElement, 'Take it'))
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, hotkeysAside: {} })
  })

  it('a group chip shows one place; "Shared keys only" keeps the shared cards and the rows an App key took', async () => {
    await mount()
    click(chip('Drawing'))
    expect(shownRows().filter((id) => id?.startsWith('hotkey-')).every((id) => id?.startsWith('hotkey-drawing-'))).toBe(true)
    click(chip('All'))
    toggle('Shared keys only')
    expect(shownRows()).toEqual(expect.arrayContaining(['hotkey-goTo', 'hotkey-drawing-duplicate', 'hotkey-search', 'hotkey-drawing-link', 'hotkey-code-addCommentLine']))
    expect(shownRows()).not.toContain('hotkey-newTab')
    expect(shownRows()).not.toContain('hotkey-note-bold')
  })

  it('a changed pick is a change: "Changed from default" shows it, and Reset puts every tab back (an old one-switch entry too)', async () => {
    await mount({ 'app.search': null }, { 'app.goTo': false })
    // The old switch off: every tab gives ⌘D to Show in sidebar.
    expect(['drawings', 'diagrams', 'code'].map((p) => picked('⌘D', p))).toEqual(['Show in sidebar', 'Show in sidebar', 'Show in sidebar'])
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
    expect(new Set(shownRows().filter((id) => id?.startsWith('hotkey-')))).toEqual(new Set(['hotkey-note-bold', 'hotkey-note-quote']))
    click(button(row('hotkeys-reset-all'), 'Reset all shown'))
    click(button(el.querySelector('.confirm') as HTMLElement, 'Reset 2 hotkeys'))
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, hotkeys: {} })
  })
})

/** YAZ-3936 (demo round 1 C4 of YAZ-3879): the clicks are cards like the keys, and two places are the user's to change. */
describe('the clicks and drags (YAZ-3936)', () => {
  const clickBox = (id: string) => row(`hotkey-${id}`).querySelector<HTMLButtonElement>('.hotkeys__key') as HTMLButtonElement
  /** A click on the record box, with the modifiers held: what the recorder hears. */
  const clickWith = (b: HTMLElement, mods: MouseEventInit = {}) =>
    act(() => {
      b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, ...mods }))
      b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...mods }))
    })
  const cardOf = (id: string) => row(`hotkey-${id}`).closest('.settings-group')?.querySelector('.settings-group__title')?.textContent
  const tagOf = (id: string) => row(`hotkey-${id}`).querySelector('.hotkeys__box-tab')?.textContent

  it('one card per gesture, each row with its place tag: ⌘-click holds Links › Open in this tab and Bullet dots › Open in a background tab', async () => {
    await mount()
    expect(cardOf('links-thisTab')).toBe('⌘-click')
    expect(cardOf('bullets-backgroundTab')).toBe('⌘-click')
    expect(cardOf('bullets-thisTab')).toBe('Click')
    expect(cardOf('bullets-newTab')).toBe('⇧-click')
    expect(cardOf('links-backgroundTab')).toBe('⌘⇧-click')
    expect(cardOf('links-newTab')).toBe('Clicks with no gesture')
    expect([tagOf('links-thisTab'), tagOf('bullets-backgroundTab')]).toEqual(['Links in a note', 'Bullet dots'])
    expect(clickBox('links-newTab').textContent).toBe('No gesture')
    // The other clicks are built in, in the same boxes: muted text, no button.
    const drag = row('hotkey-mouse-move-block')
    expect(drag.closest('.settings-group')?.querySelector('.settings-group__title')?.textContent).toBe('Drag')
    expect(drag.querySelector('.hotkeys__box-tab')?.textContent).toBe('6 dots')
    expect(drag.querySelector('.hotkeys__key')).toBeNull()
    expect(drag.querySelector('.hotkeys__hint')?.textContent).toBe('Built in')
  })

  it('the "Clicks" chip shows only the click and drag cards, the built-in ones too; All brings the keys back (YAZ-3747 demo)', async () => {
    await mount()
    const chip = (text: string) => button(el.querySelector('.hotkeys__filters') as HTMLElement, text)
    const isClick = (id: string | undefined) => /^hotkey-(links|bullets|mouse)-/.test(id ?? '')
    click(chip('Clicks'))
    const shown = shownRows().filter((id) => id?.startsWith('hotkey'))
    expect(shown).toEqual(expect.arrayContaining(['hotkeys-click-legend', 'hotkey-links-thisTab', 'hotkey-bullets-newTab', 'hotkey-mouse-move-block']))
    expect(shown.filter((id) => id !== 'hotkeys-click-legend').every(isClick)).toBe(true)
    click(chip('All'))
    expect(shownRows()).toEqual(expect.arrayContaining(['hotkey-goTo', 'hotkey-links-thisTab']))
  })

  it('record: click the box, hold the keys and click it again → the pop-up, nothing written; Save writes only the change; Reset asks, then puts the default back', async () => {
    await mount()
    click(clickBox('links-newTab'))
    expect(clickBox('links-newTab').textContent).toBe('Hold keys, click here')
    expect(recording).not.toHaveBeenCalled() // a click takes no key from the menu
    clickWith(clickBox('links-newTab'), { altKey: true })
    expect(says()).toEqual(['Change the gesture for Links in a note › Open in a new tab?', 'No gesture → ⌥-click'])
    expect(onChange).not.toHaveBeenCalled()
    click(button(popup() as HTMLElement, 'Save'))
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, hotkeys: { 'links.newTab': 'Alt+Click' } })
    expect(cardOf('links-newTab')).toBe('⌥-click')
    expect(clickBox('links-newTab').classList.contains('hotkeys__key--changed')).toBe(true)

    click(button(row('hotkey-links-newTab'), 'Reset'))
    expect(says()).toEqual(['Reset Links in a note › Open in a new tab?', '⌥-click → No gesture'])
    click(button(popup() as HTMLElement, 'Reset'))
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, hotkeys: {} })
  })

  it('"the old way" (#11): Click on Links › Open in this tab; a gesture of the same place moves, with "Move it here"; another place keeps its own', async () => {
    await mount()
    click(clickBox('links-thisTab'))
    clickWith(clickBox('links-thisTab'))
    expect(says()).toEqual(['Change the gesture for Links in a note › Open in this tab?', '⌘-click → Click'])
    expect(button(popup() as HTMLElement, 'Save')).toBeDefined()
    click(button(popup() as HTMLElement, 'Save'))
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, hotkeys: { 'links.thisTab': 'Click' } })
    // Click is Bullet dots › Open in this tab too: another place, no clash. ⌘⇧-click is Links › background's: it moves.
    click(clickBox('links-newTab'))
    clickWith(clickBox('links-newTab'), { metaKey: true, shiftKey: true })
    expect(says()).toEqual(['Change the gesture for Links in a note › Open in a new tab?', 'No gesture → ⌘⇧-click', '⌘⇧-click is Links in a note › Open in a background tab now. It will lose its gesture.'])
    click(button(popup() as HTMLElement, 'Move it here'))
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, hotkeys: { 'links.thisTab': 'Click', 'links.newTab': 'CmdOrCtrl+Shift+Click', 'links.backgroundTab': null } })
  })

  it('⌃-click is refused (the Mac\'s right-click) and the box keeps recording; Esc stops it and never reaches the dialog; ⌫ asks to remove the gesture', async () => {
    await mount()
    click(clickBox('bullets-newTab'))
    clickWith(clickBox('bullets-newTab'), { ctrlKey: true })
    expect(lines('bullets-newTab')[0]).toBe("⌃-click is the Mac's right-click. Pick a different gesture.")
    expect(clickBox('bullets-newTab').textContent).toBe('Hold keys, click here')
    press('Escape', 'Escape')
    expect(onClose).not.toHaveBeenCalled()
    expect(clickBox('bullets-newTab').textContent).toBe('⇧-click')
    click(clickBox('bullets-newTab'))
    press('Backspace', 'Backspace')
    expect(says()).toEqual(['Remove the gesture from Bullet dots › Open in a new tab?', '⇧-click → No gesture'])
    click(button(popup() as HTMLElement, 'Remove'))
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, hotkeys: { 'bullets.newTab': null } })
  })

  it('the page\'s search finds a row by its place and by its action: "links in a note" → the three Links rows; Reset all lists a click change too', async () => {
    await mount({ 'links.thisTab': 'Click' })
    type(hotkeyBox(), 'links in a note')
    expect(shownRows().filter((id) => id?.startsWith('hotkey-'))).toEqual(['hotkey-links-thisTab', 'hotkey-links-backgroundTab', 'hotkey-links-newTab'])
    type(hotkeyBox(), 'open in a background tab')
    expect(shownRows().filter((id) => id?.startsWith('hotkey-'))).toEqual(['hotkey-bullets-backgroundTab', 'hotkey-links-backgroundTab'])
    type(hotkeyBox(), '')
    click(button(row('hotkeys-reset-all'), 'Reset all hotkeys'))
    expect([...(el.querySelector('.hotkeys__changes') as HTMLElement).querySelectorAll('li')].map((li) => li.textContent)).toEqual(['Links in a note › Open in this tab: Click → ⌘-click'])
    click(button(el.querySelector('.confirm') as HTMLElement, 'Reset 1 hotkey'))
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, hotkeys: {} })
  })
})
