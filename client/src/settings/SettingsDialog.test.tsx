/**
 * The settings dialog (YAZ-1679): one scrolling page of every section with grouped rows, nav
 * anchors with a scrollspy, search over the one registry, the popover's controls rehoused row by
 * row (Theme writes through `onChange`, the folder input's draft/commit logic, the per-vault
 * GitHub switch through `sync.setEnabled`, the per-vault review settings through `review.save`),
 * and the modal's own contract — Esc layered over search, click-away, focus restored to whatever
 * opened it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_REVIEW_SETTINGS, type ReviewSettings } from '@shared/reviews'
import { DEFAULT_SETTINGS, type GithubSyncStatus, type IdsState, type IndexResponse, type SettingsState } from '@shared/types'
import { idsAskMessage, idsLettersAsk, lettersAskMessage, lettersLine, NEW_LETTERS_ASK, oldIdsAskMessage, oldIdsLine } from './idsAskMessage'
import { SettingsDialog } from './SettingsDialog'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLElement | null = null

/** jsdom has no `scrollIntoView`; the nav's click is exactly that call, so it is a spy here. */
const scrollIntoView = vi.fn()
beforeEach(() => {
  Element.prototype.scrollIntoView = scrollIntoView
  scrollIntoView.mockClear()
})

function mount(settings: SettingsState = { ...DEFAULT_SETTINGS }, syncStatus?: GithubSyncStatus | null, reviewSettings?: ReviewSettings, vaultIds?: { enabled: boolean; held: boolean; ask?: IndexResponse['ask']; letters?: string; old?: number; unfinished?: boolean; state?: Partial<IdsState> }, vaultName?: string) {
  const onChange = vi.fn()
  const onClose = vi.fn()
  const setEnabled = vi.fn()
  const save = vi.fn()
  const setIds = vi.fn()
  // `undefined` (the argument omitted) means no Sync section at all; an explicit `null` is the
  // section present with its first status fetch still in flight.
  const sync = syncStatus === undefined ? undefined : { status: syncStatus, setEnabled }
  // The same for Review: no settings handed over is no vault open, so no section.
  const review = reviewSettings === undefined ? undefined : { settings: reviewSettings, save }
  // And for the vault's IDs switch (YAZ-2523): no answer handed over is no vault open, so no row.
  // `letters` are the ID letters the vault's `ids.json` already holds (YAZ-2677 S9): they come with the snapshot's `ask`.
  const ask = vaultIds?.ask === undefined ? undefined : { ...vaultIds.ask, ...(vaultIds.letters !== undefined && { letters: vaultIds.letters }) }
  // "Check for duplicates" (YAZ-2677 S55): the main process answers with one line.
  const checkIds = vi.fn(async () => 'No duplicates.')
  // The rows "ID letters" and "Old IDs" (YAZ-2677 D5, D6): the main process answers with the state of the vault.
  const STATE: IdsState = { letters: vaultIds?.letters ?? 'YAZ', notes: 3, stale: 0, old: vaultIds?.old ?? 0, unfinished: false, ...vaultIds?.state }
  // It answers only where the test hands a `state` over: a row that no test looks at stays as it was mounted.
  const idsState = vi.fn((): Promise<IdsState> => (vaultIds?.state === undefined ? new Promise(() => undefined) : Promise.resolve(STATE)))
  const reletter = vi.fn(async (letters: string): Promise<IdsState> => ({ ...STATE, letters, stale: 0 }))
  const backfill = vi.fn(async (): Promise<IdsState> => ({ ...STATE, old: 0 }))
  const ids = vaultIds === undefined ? undefined : { enabled: vaultIds.enabled, held: vaultIds.held, ask, set: setIds, check: checkIds, old: vaultIds.old ?? 0, unfinished: vaultIds.unfinished ?? false, state: idsState, reletter, backfill }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  // The active vault's name (YAZ-2602 R10): App hands it only with two or more vaults in the window.
  act(() => root?.render(<SettingsDialog ctx={{ settings, onChange, sync, review, ids, vaultName }} onClose={onClose} />))
  /** The open dialog with the vault's review settings changed under it: a save shown at once. */
  const rerender = (next: ReviewSettings) => act(() => root?.render(<SettingsDialog ctx={{ settings, onChange, sync, review: { settings: next, save } }} onClose={onClose} />))
  return { onChange, onClose, setEnabled, save, setIds, checkIds, idsState, reletter, backfill, rerender, el: container }
}

/** Upkeep turned on, the rest as a new vault has it. */
const REVIEW_ON: ReviewSettings = { ...DEFAULT_REVIEW_SETTINGS, enabled: true }

const unmount = () => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
}

afterEach(unmount)

const navButtons = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('.settings-nav__item')]
/** The nav in reading order, the divider included, so a test can pin what sits on each side of it. */
const navShape = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('.settings-nav__item, .settings-nav__divider')].map((n) => (n.tagName === 'HR' ? '—' : n.textContent))
const navByTitle = (el: HTMLElement, title: string) => navButtons(el).find((b) => b.textContent === title) as HTMLButtonElement
const clickNav = (el: HTMLElement, title: string) => act(() => navByTitle(el, title).click())
/** The one current nav item, whichever kind: `location` on a scroll anchor, `page` on a standalone page. */
const currentNav = (el: HTMLElement) => navButtons(el).find((b) => b.getAttribute('aria-current') !== null)?.textContent
const currentKind = (el: HTMLElement) => navButtons(el).find((b) => b.getAttribute('aria-current') !== null)?.getAttribute('aria-current')
const headings = (el: HTMLElement) => [...el.querySelectorAll('.settings-section__title')].map((h) => h.textContent)
const groupTitles = (el: HTMLElement) => [...el.querySelectorAll('.settings-group__title')].map((h) => h.textContent)
const rowIds = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('.setting')].map((r) => r.dataset.setting)
const row = (el: HTMLElement, id: string) => el.querySelector<HTMLElement>(`[data-setting="${id}"]`)
const rowButtons = (el: HTMLElement, id: string) => [...(row(el, id)?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
const searchInput = (el: HTMLElement) => el.querySelector<HTMLInputElement>('input[aria-label="Search settings"]') as HTMLInputElement
const pane = (el: HTMLElement) => el.querySelector<HTMLElement>('.settings-pane') as HTMLElement
const sections = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('[data-section]')]

/** Drive a CONTROLLED input like a user: native value setter + input event. */
function type(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  act(() => {
    set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const pressEscape = (target: HTMLElement) => act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
const pressEnter = (input: HTMLInputElement) => act(() => void input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
/** React hears blur as the bubbling `focusout`. */
const blur = (input: HTMLInputElement) => act(() => void input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
const status = (extra: Partial<GithubSyncStatus> = {}): GithubSyncStatus => ({ root: '/vault', state: 'off', ...extra })

/**
 * jsdom lays nothing out, so the scroll geometry is stubbed: every section 300px tall in order,
 * the pane 400px tall showing the whole 1500px page as it scrolls. `scrollTop` is a plain
 * property on the pane, so setting it and dispatching `scroll` is the whole simulation.
 */
function layOut(el: HTMLElement, sectionHeight = 300, paneHeight = 400) {
  const all = sections(el)
  all.forEach((s, i) => Object.defineProperty(s, 'offsetTop', { value: i * sectionHeight, configurable: true }))
  Object.defineProperty(pane(el), 'clientHeight', { value: paneHeight, configurable: true })
  Object.defineProperty(pane(el), 'scrollHeight', { value: all.length * sectionHeight, configurable: true })
}
const scrollTo = (el: HTMLElement, top: number) =>
  act(() => {
    pane(el).scrollTop = top
    pane(el).dispatchEvent(new Event('scroll', { bubbles: true }))
  })

describe('SettingsDialog shell (D1)', () => {
  it('is a modal dialog named Settings that opens at the top with the search box focused', () => {
    const { el } = mount()
    const dialog = el.querySelector('[role="dialog"]')
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(dialog?.getAttribute('aria-label')).toBe('Settings')
    expect(currentNav(el)).toBe('Appearance')
    expect(document.activeElement).toBe(searchInput(el))
  })

  it('Escape with no query closes; a mousedown on the overlay closes; one inside the dialog does not', () => {
    const { el, onClose } = mount()
    pressEscape(searchInput(el))
    expect(onClose).toHaveBeenCalledTimes(1)
    act(() => void el.querySelector('.settings-dialog')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(onClose).toHaveBeenCalledTimes(1)
    act(() => void el.querySelector('.settings-overlay')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(onClose).toHaveBeenCalledTimes(2)
    act(() => el.querySelector<HTMLButtonElement>('[aria-label="Close settings"]')?.click())
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('gives focus back to whatever had it before — the cog, or the editor ⌘, was pressed in', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    expect(document.activeElement).toBe(opener)
    const { el } = mount()
    expect(document.activeElement).toBe(searchInput(el))
    unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })
})

describe('SettingsDialog: one page of every settings section (the post-demo redesign)', () => {
  it('the nav: the settings-page anchors (Review only with a vault, Sync only with the engine), a divider, then the standalone Hotkeys page', () => {
    const { el } = mount()
    expect(navShape(el)).toEqual(['Appearance', 'Editor', 'Files & Links', '—', 'Hotkeys'])
    unmount()
    const withSync = mount({ ...DEFAULT_SETTINGS }, status())
    expect(navShape(withSync.el)).toEqual(['Appearance', 'Editor', 'Files & Links', 'Sync', '—', 'Hotkeys'])
    unmount()
    const withVault = mount({ ...DEFAULT_SETTINGS }, status(), DEFAULT_REVIEW_SETTINGS)
    expect(navShape(withVault.el)).toEqual(['Appearance', 'Editor', 'Files & Links', 'Review', 'Sync', '—', 'Hotkeys'])
  })

  it('renders every settings section on the one page, in order, each anchored by id and every row addressed by data-setting — Hotkeys is not on it', () => {
    const { el } = mount({ ...DEFAULT_SETTINGS }, status(), REVIEW_ON)
    expect(headings(el)).toEqual(['Appearance', 'Editor', 'Files & Links', 'Review', 'Sync'])
    expect(sections(el).map((s) => s.id)).toEqual(['settings-appearance', 'settings-editor', 'settings-files', 'settings-review', 'settings-sync'])
    expect(rowIds(el)).toEqual(['theme', 'contentWidth', 'lineSpacing', 'blockGap', 'bulletThreading', 'threadWidth', 'threadColor', 'commentsOrder', 'confirmDelete', 'confirmRename', 'newNoteLocation', 'startupWindows', 'enabled', 'baseDays', 'growth', 'maxDays', 'reviewByDefault', 'githubSync'])
    for (const r of el.querySelectorAll<HTMLElement>('.setting')) expect(r.dataset.setting).toBeTruthy()
    expect(el.querySelector('[data-setting^="hotkeys"]')).toBeNull()
  })

  it('group titles and hints render under their section; untitled groups are plain rows', () => {
    const { el } = mount()
    expect(groupTitles(el)).toEqual(['Spacing', 'Bullet threading', 'Comments', 'When the app starts'])
    expect([...el.querySelectorAll('.settings-group__hint')].map((h) => h.textContent)).toEqual(['Guide lines that connect nested bullets.'])
    // The threading rows carry the shortened labels; the group names the feature.
    expect(row(el, 'bulletThreading')?.querySelector('.setting__label')?.textContent).toBe('Show')
    expect(row(el, 'threadWidth')?.querySelector('.setting__label')?.textContent).toBe('Line width')
    expect(row(el, 'commentsOrder')?.querySelector('.setting__label')?.textContent).toBe('Order')
    // Files & Links starts with an untitled group: its rows sit straight under the section title.
    expect(el.querySelector('#settings-files .settings-group')?.querySelector('.settings-group__title')).toBeNull()
  })

  it('the two per-vault sections, Review and Sync, carry a note under their titles; no other section does', () => {
    const { el } = mount({ ...DEFAULT_SETTINGS }, status(), DEFAULT_REVIEW_SETTINGS)
    const notes = [...el.querySelectorAll('.settings-section__note')]
    expect(notes.map((n) => n.textContent)).toEqual(["These settings are saved in this vault's .yaseendocs folder and sync with it.", "These settings are saved in this vault's .yaseendocs folder, not app-wide."])
    expect(notes.map((n) => n.closest('[data-section]')?.id)).toEqual(['settings-review', 'settings-sync'])
  })

  it('two or more vaults in the window: Review, Sync and the "This vault" group each say which vault they act on, first thing under the title; one vault: no such line (YAZ-2602 R10, S39)', () => {
    const lines = (el: HTMLElement) => [...el.querySelectorAll('.settings-section__note, .settings-group__hint')].filter((n) => n.textContent?.startsWith('Vault: '))
    const { el } = mount({ ...DEFAULT_SETTINGS }, status(), DEFAULT_REVIEW_SETTINGS, { enabled: true, held: false }, 'Work')
    expect(lines(el).map((n) => n.textContent)).toEqual(['Vault: Work', 'Vault: Work', 'Vault: Work'])
    expect(lines(el).map((n) => n.previousElementSibling?.textContent)).toEqual(['This vault', 'Review', 'Sync'])
    // The same muted lines the dialog already has: a group's hint, a section's note.
    expect(lines(el).map((n) => n.className)).toEqual(['settings-group__hint', 'settings-section__note', 'settings-section__note'])
    expect(lines(el)[1].nextElementSibling?.textContent).toBe("These settings are saved in this vault's .yaseendocs folder and sync with it.")
    unmount()
    expect(lines(mount({ ...DEFAULT_SETTINGS }, status(), DEFAULT_REVIEW_SETTINGS, { enabled: true, held: false }).el)).toEqual([])
  })

  it('Hotkeys is its own page: clicking it swaps the pane for its four tables and takes aria-current; no anchor is current meanwhile', () => {
    const { el } = mount()
    clickNav(el, 'Hotkeys')
    expect(currentNav(el)).toBe('Hotkeys')
    expect(currentKind(el)).toBe('page') // a page, where an anchor says `location`
    expect(headings(el)).toEqual(['Hotkeys'])
    expect(groupTitles(el)).toEqual(['Keyboard', 'Views', 'Window', 'Mouse'])
    expect(rowIds(el)).toEqual(['hotkeys-keyboard', 'hotkeys-views', 'hotkeys-window', 'hotkeys-mouse'])
    expect([...el.querySelectorAll('[data-setting="hotkeys-window"] .hotkeys__keys')].map((k) => k.textContent)).toContain('⌘,')
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('an anchor click from the Hotkeys page returns to the settings page and scrolls to that section', () => {
    const { el } = mount()
    clickNav(el, 'Hotkeys')
    clickNav(el, 'Editor')
    expect(currentNav(el)).toBe('Editor')
    expect(headings(el)).toEqual(['Appearance', 'Editor', 'Files & Links'])
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView.mock.instances[0]).toBe(el.querySelector('#settings-editor'))
  })

  it('an anchor click scrolls its section into view and marks it current — as a location, not a page', () => {
    const { el } = mount({ ...DEFAULT_SETTINGS }, status())
    clickNav(el, 'Sync')
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView.mock.instances[0]).toBe(el.querySelector('#settings-sync'))
    expect(currentNav(el)).toBe('Sync')
    expect(currentKind(el)).toBe('location')
  })

  it('scrolling while the Hotkeys page shows leaves aria-current on Hotkeys — the spy only watches the settings page', () => {
    const { el } = mount({ ...DEFAULT_SETTINGS }, status())
    clickNav(el, 'Hotkeys')
    scrollTo(el, 500)
    expect(currentNav(el)).toBe('Hotkeys')
    expect(currentKind(el)).toBe('page')
  })

  it('scrollspy: the current nav item follows the pane scroll — last heading above the read line, the last section at the bottom', () => {
    const { el } = mount({ ...DEFAULT_SETTINGS }, status())
    layOut(el) // sections at 0 / 300 / 600 / 900, pane 400 of 1200
    scrollTo(el, 0)
    expect(currentNav(el)).toBe('Appearance')
    scrollTo(el, 270) // the read line (scrollTop + 24 = 294) is still above Editor's top (300)
    expect(currentNav(el)).toBe('Appearance')
    scrollTo(el, 280) // 304: Editor's top is now at or above it
    expect(currentNav(el)).toBe('Editor')
    scrollTo(el, 650)
    expect(currentNav(el)).toBe('Files & Links')
    // The bottom: 1200 - 400 = 800, and Sync's top (900) never reaches the read line.
    scrollTo(el, 800)
    expect(currentNav(el)).toBe('Sync')
  })

  it('reopening starts at the top of the settings page again — no remembered page', () => {
    const { el } = mount()
    clickNav(el, 'Hotkeys')
    expect(currentNav(el)).toBe('Hotkeys')
    unmount()
    const again = mount()
    expect(currentNav(again.el)).toBe('Appearance')
    expect(headings(again.el)).toEqual(['Appearance', 'Editor', 'Files & Links'])
  })
})

describe('SettingsDialog rows write through the popover contracts', () => {
  it('Theme: System · Light · Dark in order, current active; Dark writes the whole object with theme flipped', () => {
    const { el, onChange } = mount()
    const buttons = rowButtons(el, 'theme')
    expect(buttons.map((b) => b.textContent)).toEqual(['System', 'Light', 'Dark'])
    expect(buttons.map((b) => b.classList.contains('settings__option--active'))).toEqual([true, false, false])
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false'])
    act(() => buttons[2].click())
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_SETTINGS, theme: 'dark' })
  })

  it('Line colour: Default is disabled while the thread already uses the accent, enabled once a colour is set', () => {
    const { el, onChange } = mount()
    const defaultButton = rowButtons(el, 'threadColor').find((b) => b.textContent === 'Default') as HTMLButtonElement
    expect(defaultButton.disabled).toBe(true)
    unmount()
    const custom = mount({ ...DEFAULT_SETTINGS, threadColor: '#ff0000' })
    const reset = rowButtons(custom.el, 'threadColor').find((b) => b.textContent === 'Default') as HTMLButtonElement
    expect(reset.disabled).toBe(false)
    act(() => reset.click())
    expect(custom.onChange).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_SETTINGS, threadColor: null })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('Confirm before deleting carries its hint in the row', () => {
    const { el } = mount()
    expect(row(el, 'confirmDelete')?.querySelector('.setting__hint')?.textContent).toBe('Deleted notes and folders move to the Trash either way.')
  })

  it('Ask before renaming is on by default, says what it shows, and Off writes the whole object with only it flipped (YAZ-2420 3C1)', () => {
    const { el, onChange } = mount()
    expect(row(el, 'confirmRename')?.querySelector('.setting__label')?.textContent).toBe('Ask before renaming')
    expect(row(el, 'confirmRename')?.querySelector('.setting__hint')?.textContent).toBe('Shows the confirmation, with the number of links that will be updated, before a note or folder is renamed.')
    expect(rowButtons(el, 'confirmRename').map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['On', 'true'], ['Off', 'false']])
    act(() => rowButtons(el, 'confirmRename')[1].click())
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_SETTINGS, confirmRename: false })
  })

  it('Reopen: All vaults · Last vault · None under "When the app starts", Last vault by default; None writes the whole object with only it flipped (YAZ-2589 D2, A3)', () => {
    const { el, onChange } = mount()
    expect(row(el, 'startupWindows')?.closest('[data-section]')?.id).toBe('settings-files')
    expect(row(el, 'startupWindows')?.closest('.settings-group')?.querySelector('.settings-group__title')?.textContent).toBe('When the app starts')
    expect(row(el, 'startupWindows')?.querySelector('.setting__label')?.textContent).toBe('Reopen')
    expect(row(el, 'startupWindows')?.querySelector('.setting__hint')?.textContent).toBe('A vault that you open from a link or a launcher always opens alone.')
    expect(rowButtons(el, 'startupWindows').map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['All vaults', 'false'], ['Last vault', 'true'], ['None', 'false']])
    act(() => rowButtons(el, 'startupWindows')[2].click())
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_SETTINGS, startupWindows: 'none' })
  })

  it('Default location: a dropdown of the three Obsidian options, writing the whole object with only the location flipped; the folder input and the wide row appear only for the third', () => {
    const { el, onChange } = mount()
    const select = row(el, 'newNoteLocation')?.querySelector<HTMLSelectElement>('select.settings__select') as HTMLSelectElement
    expect([...select.options].map((o) => o.textContent)).toEqual(['Vault folder', 'Same folder as current file', 'In the folder specified below'])
    expect(select.selectedOptions[0].textContent).toBe('Same folder as current file') // the YAZ-1643 default
    expect(row(el, 'newNoteLocation')?.querySelector('.settings__input')).toBeNull()
    expect(row(el, 'newNoteLocation')?.classList.contains('setting--wide')).toBe(false)
    act(() => {
      select.value = '0'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_SETTINGS, newNoteLocation: 'root' })
    unmount()
    const folder = mount({ ...DEFAULT_SETTINGS, newNoteLocation: 'folder', newNoteFolder: 'Inbox' })
    expect(row(folder.el, 'newNoteLocation')?.classList.contains('setting--wide')).toBe(true)
    expect(row(folder.el, 'newNoteLocation')?.querySelector<HTMLInputElement>('.settings__input')?.value).toBe('Inbox')
  })

  it('Default location: an invalid folder keeps the stored value, marks the input aria-invalid, and keeps the typed text for fixing up', () => {
    const { el, onChange } = mount({ ...DEFAULT_SETTINGS, newNoteLocation: 'folder', newNoteFolder: 'Old' })
    const input = row(el, 'newNoteLocation')?.querySelector<HTMLInputElement>('.settings__input') as HTMLInputElement
    expect(input.value).toBe('Old')
    type(input, 'a/../b')
    pressEnter(input)
    expect(onChange).not.toHaveBeenCalled()
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.classList.contains('settings__input--error')).toBe(true)
    expect(input.value).toBe('a/../b')
    type(input, 'Notes/Inbox')
    expect(input.getAttribute('aria-invalid')).toBe('false')
    pressEnter(input)
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_SETTINGS, newNoteLocation: 'folder', newNoteFolder: 'Notes/Inbox' })
  })

  it('GitHub sync: the engine-stamped `enabled` is the read-back, the hint is the detected repo, and Off calls setEnabled(false) — never onChange', () => {
    const { el, setEnabled, onChange } = mount({ ...DEFAULT_SETTINGS }, status({ state: 'synced', enabled: true, repo: { remoteUrl: 'git@github.com:me/notes.git', branch: 'main' } }))
    const buttons = rowButtons(el, 'githubSync')
    expect(buttons.map((b) => b.textContent)).toEqual(['On', 'Off'])
    expect(buttons.map((b) => b.classList.contains('settings__option--active'))).toEqual([true, false])
    expect(row(el, 'githubSync')?.querySelector('.setting__hint')?.textContent).toBe('repo git@github.com:me/notes.git · branch main')
    act(() => buttons[1].click())
    expect(setEnabled).toHaveBeenCalledExactlyOnceWith(false)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('GitHub sync: a null status (first fetch in flight) reads as Off, the safe default', () => {
    const { el } = mount({ ...DEFAULT_SETTINGS }, null)
    expect(rowButtons(el, 'githubSync').map((b) => b.classList.contains('settings__option--active'))).toEqual([false, true])
    expect(row(el, 'githubSync')?.querySelector('.setting__hint')?.textContent).toBe("This folder isn't a git repo — set it up with GitHub Desktop, then turn sync on.")
  })
})

describe('SettingsDialog: the Review section saves through the vault (YAZ-2322)', () => {
  const S = REVIEW_ON
  const number = (el: HTMLElement, id: string) => row(el, id)?.querySelector<HTMLInputElement>('.settings__input') as HTMLInputElement
  const reviewRows = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('#settings-review .setting')].map((r) => r.dataset.setting)

  it('is absent with no vault open', () => {
    const { el } = mount()
    expect(el.querySelector('#settings-review')).toBeNull()
    expect(row(el, 'baseDays')).toBeNull()
  })

  it('upkeep off: the Review section shows one row, a switch labelled "Enable upkeep review", reading Off', () => {
    const { el } = mount({ ...DEFAULT_SETTINGS }, status(), DEFAULT_REVIEW_SETTINGS)
    expect(reviewRows(el)).toEqual(['enabled'])
    expect(row(el, 'enabled')?.querySelector('.setting__label')?.textContent).toBe('Enable upkeep review')
    expect(rowButtons(el, 'enabled').map((b) => b.textContent)).toEqual(['On', 'Off'])
    expect(rowButtons(el, 'enabled').map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true'])
    expect(el.querySelector('#settings-review .settings-section__note')).not.toBeNull()
  })

  it('Enable upkeep review: On saves the whole object with enabled true, Off with it false — never onChange', () => {
    const off = mount({ ...DEFAULT_SETTINGS }, undefined, DEFAULT_REVIEW_SETTINGS)
    act(() => rowButtons(off.el, 'enabled')[0].click())
    expect(off.save).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_REVIEW_SETTINGS, enabled: true })
    expect(off.onChange).not.toHaveBeenCalled()
    unmount()
    const on = mount({ ...DEFAULT_SETTINGS }, undefined, { ...S, baseDays: 14 })
    act(() => rowButtons(on.el, 'enabled')[1].click())
    expect(on.save).toHaveBeenCalledExactlyOnceWith({ ...S, baseDays: 14, enabled: false })
  })

  it('turned on: the three numbers and "New notes are in review" appear under the switch at once; turned off, they go', () => {
    const { el, rerender } = mount({ ...DEFAULT_SETTINGS }, undefined, DEFAULT_REVIEW_SETTINGS)
    rerender(S)
    expect(reviewRows(el)).toEqual(['enabled', 'baseDays', 'growth', 'maxDays', 'reviewByDefault'])
    expect(rowButtons(el, 'enabled').map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false'])
    rerender(DEFAULT_REVIEW_SETTINGS)
    expect(reviewRows(el)).toEqual(['enabled'])
  })

  it('upkeep off: search finds the switch and none of the rows it hides; turned on, it finds them', () => {
    const { el, rerender } = mount({ ...DEFAULT_SETTINGS }, undefined, DEFAULT_REVIEW_SETTINGS)
    type(searchInput(el), 'upkeep')
    expect(rowIds(el)).toEqual(['enabled'])
    type(searchInput(el), 'longest wait')
    expect(rowIds(el)).toEqual([])
    expect(el.querySelector('.settings-empty')).not.toBeNull()
    rerender(S)
    expect(rowIds(el)).toEqual(['maxDays'])
  })

  it('turned on, the four rows under the switch show the current values, each number beside its unit', () => {
    const { el } = mount({ ...DEFAULT_SETTINGS }, undefined, { ...S, baseDays: 14, growth: 1.5, maxDays: 90, reviewByDefault: false })
    expect(['baseDays', 'growth', 'maxDays', 'reviewByDefault'].map((id) => row(el, id)?.querySelector('.setting__label')?.textContent)).toEqual(['Check a note after', 'Each time it is still relevant, wait', 'Longest wait', 'New notes are in review'])
    expect(['baseDays', 'growth', 'maxDays'].map((id) => number(el, id).value)).toEqual(['14', '1.5', '90'])
    expect(['baseDays', 'growth', 'maxDays'].map((id) => row(el, id)?.querySelector('.setting__control')?.textContent)).toEqual(['days', '× longer', 'days'])
    expect(number(el, 'baseDays').getAttribute('aria-label')).toBe('Check a note after')
    expect(rowButtons(el, 'reviewByDefault').map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true'])
  })

  it('says the schedule in words under the three numbers', () => {
    const { el } = mount({ ...DEFAULT_SETTINGS }, undefined, S)
    expect(row(el, 'maxDays')?.querySelector('.setting__hint')?.textContent).toBe('30 days, then 60, 120, 240, 365.')
    unmount()
    const fixed = mount({ ...DEFAULT_SETTINGS }, undefined, { ...S, growth: 1 })
    expect(row(fixed.el, 'maxDays')?.querySelector('.setting__hint')?.textContent).toBe('Every 30 days.')
  })

  it('a valid number commits on Enter or blur: save gets the whole object with that one field changed — never onChange', () => {
    const { el, save, onChange } = mount({ ...DEFAULT_SETTINGS }, undefined, S)
    type(number(el, 'baseDays'), '45')
    expect(save).not.toHaveBeenCalled() // a draft until it is committed
    pressEnter(number(el, 'baseDays'))
    expect(save).toHaveBeenCalledExactlyOnceWith({ ...S, baseDays: 45 })
    type(number(el, 'growth'), '1.5')
    blur(number(el, 'growth'))
    expect(save).toHaveBeenLastCalledWith({ ...S, growth: 1.5 })
    type(number(el, 'maxDays'), '90')
    blur(number(el, 'maxDays'))
    expect(save).toHaveBeenLastCalledWith({ ...S, maxDays: 90 })
    expect(save).toHaveBeenCalledTimes(3)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('an unchanged number saves nothing', () => {
    const { el, save } = mount({ ...DEFAULT_SETTINGS }, undefined, S)
    blur(number(el, 'baseDays'))
    expect(save).not.toHaveBeenCalled()
  })

  it('a draft the rules refuse is marked while it stands, is not saved, and gives way to the last good value', () => {
    const { el, save } = mount({ ...DEFAULT_SETTINGS }, undefined, S)
    // Each is one of `sanitizeReviewSettings`' rules: whole days from 1, growth from 1, the longest wait never under the first.
    for (const [id, draft, stored] of [['baseDays', '0', '30'], ['baseDays', '7.5', '30'], ['growth', '0.5', '2'], ['maxDays', '10', '365'], ['maxDays', 'soon', '365'], ['growth', '', '2']] as const) {
      const input = number(el, id)
      expect(input.getAttribute('aria-invalid')).toBe('false')
      type(input, draft)
      expect(input.getAttribute('aria-invalid')).toBe('true')
      expect(input.classList.contains('settings__input--error')).toBe(true)
      blur(input)
      expect(input.value).toBe(stored)
      expect(input.getAttribute('aria-invalid')).toBe('false')
    }
    expect(save).not.toHaveBeenCalled()
  })

  it('New notes are in review: On · Off, and Off saves the whole object with reviewByDefault flipped', () => {
    const { el, save, onChange } = mount({ ...DEFAULT_SETTINGS }, undefined, S)
    const buttons = rowButtons(el, 'reviewByDefault')
    expect(buttons.map((b) => b.textContent)).toEqual(['On', 'Off'])
    expect(buttons.map((b) => b.classList.contains('settings__option--active'))).toEqual([true, false])
    act(() => buttons[1].click())
    expect(save).toHaveBeenCalledExactlyOnceWith({ ...S, reviewByDefault: false })
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('SettingsDialog search (D6)', () => {
  it('"dark" shows the Theme row under an Appearance heading and nothing else — and the row still works', () => {
    const { el, onChange } = mount({ ...DEFAULT_SETTINGS }, status())
    type(searchInput(el), 'dark')
    expect(headings(el)).toEqual(['Appearance'])
    expect(rowIds(el)).toEqual(['theme'])
    expect(sections(el)).toEqual([]) // the page is gone while the query stands
    act(() => rowButtons(el, 'theme')[2].click())
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_SETTINGS, theme: 'dark' })
  })

  it('a titled group heads its hits with a breadcrumb, without repeating the group title below it', () => {
    const { el } = mount()
    type(searchInput(el), 'threading')
    expect(headings(el)).toEqual(['Editor › Bullet threading'])
    expect(groupTitles(el)).toEqual([])
    expect([...el.querySelectorAll('.settings-group__hint')].map((h) => h.textContent)).toEqual(['Guide lines that connect nested bullets.'])
    expect(rowIds(el)).toEqual(['bulletThreading', 'threadWidth', 'threadColor'])
  })

  it('hits from several groups stack under their own breadcrumbs, in registry order', () => {
    const { el } = mount({ ...DEFAULT_SETTINGS }, status())
    // "bullet": the threading group (by its hint and title) and, on the standalone Hotkeys page,
    // the two tables whose labels name a bullet — three breadcrumbs, registry order, never rank.
    type(searchInput(el), 'bullet')
    expect(headings(el)).toEqual(['Editor › Bullet threading', 'Hotkeys › Keyboard', 'Hotkeys › Mouse'])
    expect(rowIds(el)).toEqual(['bulletThreading', 'threadWidth', 'threadColor', 'hotkeys-keyboard', 'hotkeys-mouse'])
    type(searchInput(el), 'spacing')
    expect(headings(el)).toEqual(['Appearance › Spacing'])
    expect(rowIds(el)).toEqual(['lineSpacing', 'blockGap'])
    type(searchInput(el), 'close tab')
    expect(headings(el)).toEqual(['Hotkeys › Window'])
    expect(rowIds(el)).toEqual(['hotkeys-window'])
  })

  it('clearing a query returns to whatever page was showing before it — the Hotkeys page included', () => {
    const { el } = mount()
    clickNav(el, 'Hotkeys')
    type(searchInput(el), 'dark')
    expect(headings(el)).toEqual(['Appearance'])
    pressEscape(searchInput(el))
    expect(headings(el)).toEqual(['Hotkeys'])
    expect(currentNav(el)).toBe('Hotkeys')
  })

  it('no hit says so, quoting the query', () => {
    const { el } = mount()
    type(searchInput(el), 'zzzz')
    expect(el.querySelector('.settings-empty')?.textContent).toBe('No settings match “zzzz”.')
    expect(rowIds(el)).toEqual([])
  })

  it('Escape with a query clears it and brings the page back; the × button does the same', () => {
    const { el, onClose } = mount()
    type(searchInput(el), 'dark')
    expect(rowIds(el)).toEqual(['theme'])
    pressEscape(searchInput(el))
    expect(onClose).not.toHaveBeenCalled()
    expect(searchInput(el).value).toBe('')
    expect(headings(el)).toEqual(['Appearance', 'Editor', 'Files & Links'])

    type(searchInput(el), 'dark')
    act(() => el.querySelector<HTMLButtonElement>('[aria-label="Clear search settings"]')?.click())
    expect(searchInput(el).value).toBe('')
    expect(headings(el)).toEqual(['Appearance', 'Editor', 'Files & Links'])
  })

  it('a nav click during a search clears the query and then scrolls to that section on the restored page', () => {
    const { el } = mount()
    type(searchInput(el), 'dark')
    clickNav(el, 'Files & Links')
    expect(searchInput(el).value).toBe('')
    expect(currentNav(el)).toBe('Files & Links')
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView.mock.instances[0]).toBe(el.querySelector('#settings-files'))
  })
})

describe("SettingsDialog: Give this vault's notes IDs (YAZ-2523 V4, V13)", () => {
  const OFF_TEXT = "This vault's notes will show their file names, and links stored as IDs will not open, until you turn this back on. Nothing is removed."
  const withIds = (enabled: boolean, held = false) => mount({ ...DEFAULT_SETTINGS }, undefined, undefined, { enabled, held })
  const pressed = (el: HTMLElement) => rowButtons(el, 'ids').map((b) => b.getAttribute('aria-pressed'))
  const sheetBtn = (el: HTMLElement, label: string) => [...el.querySelectorAll<HTMLButtonElement>('.confirm__btn')].find((b) => b.textContent === label)

  it('with no vault open the row is absent, and so is its "This vault" group; a search does not find it', () => {
    const { el } = mount()
    expect(row(el, 'ids')).toBeNull()
    expect(groupTitles(el)).not.toContain('This vault')
    type(searchInput(el), 'files & links')
    expect(rowIds(el)).toEqual(['confirmDelete', 'confirmRename', 'newNoteLocation', 'startupWindows'])
  })

  it('a vault open: the row sits in Files & Links under "This vault", with its label and hint', () => {
    const { el } = withIds(false)
    expect(row(el, 'ids')?.closest('[data-section]')?.id).toBe('settings-files')
    expect(row(el, 'ids')?.closest('.settings-group')?.querySelector('.settings-group__title')?.textContent).toBe('This vault')
    expect(row(el, 'ids')?.querySelector('.setting__label')?.textContent).toBe("Give this vault's notes IDs")
    expect(row(el, 'ids')?.querySelector('.setting__hint')?.textContent).toBe('Saved in this vault and synced with it. On: every note gets an ID and the app names its file. Off: the app leaves every file as it is.')
    expect(rowButtons(el, 'ids').map((b) => b.textContent)).toEqual(['On', 'Off'])
  })

  it("shows the vault's answer: On where it said yes, Off where it said no or has no answer", () => {
    expect(pressed(withIds(true, true).el)).toEqual(['true', 'false'])
    unmount()
    expect(pressed(withIds(false).el)).toEqual(['false', 'true'])
  })

  it('Off in a vault whose notes hold IDs asks first, in the locked words; Cancel and Esc leave it on and the dialog open', () => {
    const { el, setIds, onClose } = withIds(true, true)
    act(() => rowButtons(el, 'ids')[1].click())
    expect(el.querySelector('.confirm__text')?.textContent).toBe(OFF_TEXT)
    expect([...el.querySelectorAll('.confirm__btn')].map((b) => b.textContent)).toEqual(['Cancel', 'Turn off'])
    act(() => sheetBtn(el, 'Cancel')?.click())
    expect(el.querySelector('.confirm')).toBeNull()
    act(() => rowButtons(el, 'ids')[1].click())
    pressEscape(sheetBtn(el, 'Cancel') as HTMLElement)
    expect(el.querySelector('.confirm')).toBeNull()
    expect(setIds).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(pressed(el)).toEqual(['true', 'false'])
  })

  it('Off in a vault whose notes hold IDs writes no only on "Turn off"', () => {
    const { el, setIds } = withIds(true, true)
    act(() => rowButtons(el, 'ids')[1].click())
    expect(setIds).not.toHaveBeenCalled()
    act(() => sheetBtn(el, 'Turn off')?.click())
    expect(setIds).toHaveBeenCalledExactlyOnceWith(false)
    expect(el.querySelector('.confirm')).toBeNull()
  })

  it('a click on the answer the row already shows writes nothing and asks nothing', () => {
    const on = withIds(true, true)
    act(() => rowButtons(on.el, 'ids')[0].click())
    expect(on.setIds).not.toHaveBeenCalled()
    unmount()
    const off = withIds(false)
    act(() => rowButtons(off.el, 'ids')[1].click())
    expect(off.setIds).not.toHaveBeenCalled()
    expect(off.el.querySelector('.confirm')).toBeNull()
  })

  it('Off in a vault that holds no IDs writes no at once', () => {
    const { el, setIds } = withIds(true)
    act(() => rowButtons(el, 'ids')[1].click())
    expect(setIds).toHaveBeenCalledExactlyOnceWith(false)
    expect(el.querySelector('.confirm')).toBeNull()
  })
})

/**
 * On asks first (YAZ-2677 🔒 D2): a box with what an ID is, the counts, how to undo, and a text field
 * for the vault's ID letters. Nothing is written until the letters are valid and "Give IDs" is chosen.
 */
describe('SettingsDialog: On opens the box with the typed ID letters (YAZ-2677 D2)', () => {
  const ASK = { notes: 3, folders: 1, foreign: 0 }
  const open = async (vaultIds: { ask?: IndexResponse['ask']; letters?: string } = { ask: ASK }, vaultName?: string) => {
    const mounted = mount({ ...DEFAULT_SETTINGS }, undefined, undefined, { enabled: false, held: false, ...vaultIds }, vaultName)
    await act(async () => rowButtons(mounted.el, 'ids')[0].click())
    return mounted
  }
  /** On and Off: the row's first two buttons. An open box's buttons come after them. */
  const pressed = (el: HTMLElement) => rowButtons(el, 'ids').slice(0, 2).map((b) => b.getAttribute('aria-pressed'))
  const sheetBtn = (el: HTMLElement, label: string) => [...el.querySelectorAll<HTMLButtonElement>('.confirm__btn')].find((b) => b.textContent === label) as HTMLButtonElement
  const field = (el: HTMLElement) => el.querySelector('.confirm__input') as HTMLInputElement

  it('a click on On opens the box and writes nothing: what an ID is, the counts, how to undo, and a text field (S5, S12)', async () => {
    const { el, setIds } = await open()
    expect(el.querySelector('.confirm__text')?.textContent).toBe(idsAskMessage(ASK))
    expect(el.querySelector('.confirm__letters')?.textContent).toBe(idsLettersAsk(undefined))
    expect(field(el).value).toBe('')
    expect(document.activeElement).toBe(field(el))
    expect([...el.querySelectorAll('.confirm__btn')].map((b) => b.textContent)).toEqual(['Cancel', 'Give IDs'])
    expect(sheetBtn(el, 'Give IDs').disabled).toBe(true)
    expect(setIds).not.toHaveBeenCalled()
    expect(pressed(el)).toEqual(['false', 'true'])
  })

  it.each(['', 'Y', 'ABCDEF', 'YA1', '7', 'YA Z', ' YAZ', 'YAZ '])('with %j in the field, "Give IDs" and Enter do nothing (S6)', async (typed) => {
    const { el, setIds } = await open()
    type(field(el), typed)
    expect(sheetBtn(el, 'Give IDs').disabled).toBe(true)
    act(() => sheetBtn(el, 'Give IDs').click())
    pressEnter(field(el))
    expect(setIds).not.toHaveBeenCalled()
    expect(el.querySelector('.confirm')).not.toBeNull()
  })

  it.each(['ya', 'yaz', 'Docs', 'ABCDE'])('%j, then "Give IDs", saves yes and the letters in capitals, and the box closes (S7)', async (typed) => {
    const { el, setIds } = await open()
    type(field(el), typed)
    expect(sheetBtn(el, 'Give IDs').disabled).toBe(false)
    act(() => sheetBtn(el, 'Give IDs').click())
    expect(setIds).toHaveBeenCalledExactlyOnceWith(true, typed.toUpperCase())
    expect(el.querySelector('.confirm')).toBeNull()
  })

  it('Enter in the field with valid letters is "Give IDs", and the dialog under the box stays open (S7)', async () => {
    const { el, setIds, onClose } = await open()
    type(field(el), 'yaz')
    pressEnter(field(el))
    expect(setIds).toHaveBeenCalledExactlyOnceWith(true, 'YAZ')
    expect(el.querySelector('.confirm')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Cancel, Esc and a click outside close the box: nothing is written, the switch stays Off, and the dialog stays open (S8)', async () => {
    const { el, setIds, onClose } = await open()
    type(field(el), 'yaz')
    act(() => sheetBtn(el, 'Cancel').click())
    expect(el.querySelector('.confirm')).toBeNull()
    await act(async () => rowButtons(el, 'ids')[0].click())
    expect(field(el).value).toBe('')
    type(field(el), 'yaz')
    pressEscape(field(el))
    expect(el.querySelector('.confirm')).toBeNull()
    await act(async () => rowButtons(el, 'ids')[0].click())
    type(field(el), 'yaz')
    act(() => void el.querySelector('.confirm-overlay')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(el.querySelector('.confirm')).toBeNull()
    expect(setIds).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(pressed(el)).toEqual(['false', 'true'])
  })

  it('a vault that already has letters asks for those letters, and only those start "Give IDs" (S9)', async () => {
    const { el, setIds } = await open({ ask: ASK, letters: 'YAZ' })
    expect(el.querySelector('.confirm__letters')?.textContent).toBe(idsLettersAsk('YAZ'))
    for (const typed of ['DOC', 'YA', 'YAZZ']) {
      type(field(el), typed)
      expect(sheetBtn(el, 'Give IDs').disabled).toBe(true)
      pressEnter(field(el))
    }
    expect(setIds).not.toHaveBeenCalled()
    type(field(el), 'yaz')
    act(() => sheetBtn(el, 'Give IDs').click())
    expect(setIds).toHaveBeenCalledExactlyOnceWith(true, 'YAZ')
  })

  it('a yes that would write nothing still opens the box, and it sets the letters (S10)', async () => {
    const { el, setIds } = await open({ ask: { notes: 0, folders: 0, foreign: 0 } })
    expect(el.querySelector('.confirm__text')?.textContent).toBe(idsAskMessage({ notes: 0, folders: 0, foreign: 0 }))
    type(field(el), 'bus')
    act(() => sheetBtn(el, 'Give IDs').click())
    expect(setIds).toHaveBeenCalledExactlyOnceWith(true, 'BUS')
  })

  it('with two or more vaults in the window the box names the vault that it acts on (S13)', async () => {
    const { el } = await open({ ask: ASK }, 'Work')
    expect(el.querySelector('.confirm__text')?.textContent).toBe(idsAskMessage(ASK, 'Work'))
    expect(el.querySelector('.confirm__text')?.textContent).toContain('Give the notes in Work IDs?')
  })

  it('Off in a vault whose notes hold IDs still asks first, and "Turn off" saves no with no letters handed over (S11)', async () => {
    const { el, setIds } = mount({ ...DEFAULT_SETTINGS }, undefined, undefined, { enabled: true, held: true })
    act(() => rowButtons(el, 'ids')[1].click())
    expect(el.querySelector('.confirm__input')).toBeNull()
    expect(setIds).not.toHaveBeenCalled()
    act(() => sheetBtn(el, 'Turn off').click())
    expect(setIds).toHaveBeenCalledExactlyOnceWith(false)
  })
})

describe('SettingsDialog: Duplicate IDs (YAZ-2677 D7, S55 to S57)', () => {
  const withIds = (enabled: boolean) => mount({ ...DEFAULT_SETTINGS }, undefined, undefined, { enabled, held: enabled })
  const button = (el: HTMLElement) => rowButtons(el, 'duplicates')[0]
  const result = (el: HTMLElement) => row(el, 'duplicates')?.querySelector('[role="status"]')?.textContent

  it('the row shows only while the vault uses IDs: under "This vault", after the switch, with one button', () => {
    expect(row(withIds(false).el, 'duplicates')).toBeNull()
    unmount()
    expect(row(mount().el, 'duplicates')).toBeNull()
    unmount()
    const { el, checkIds } = withIds(true)
    expect(row(el, 'duplicates')?.closest('.settings-group')?.querySelector('.settings-group__title')?.textContent).toBe('This vault')
    expect(row(el, 'duplicates')?.querySelector('.setting__label')?.textContent).toBe('Duplicate IDs')
    expect(rowButtons(el, 'duplicates').map((b) => b.textContent)).toEqual(['Check for duplicates'])
    expect(result(el)).toBe('')
    // Nothing runs until the user asks.
    expect(checkIds).not.toHaveBeenCalled()
    type(searchInput(el), 'duplicate')
    expect(rowIds(el)).toEqual(['duplicates'])
  })

  it('S55: a click runs the check now and tells the result in one line', async () => {
    const { el, checkIds } = withIds(true)
    await act(async () => button(el).click())
    expect(checkIds).toHaveBeenCalledExactlyOnceWith()
    expect(result(el)).toBe('No duplicates.')
  })

  it('S56, S57: the line is what the main process answers, whatever it is', async () => {
    const { el, checkIds } = withIds(true)
    checkIds.mockResolvedValueOnce('YAZ-101 was used on two Macs. "Bar" is now YAZ-102. 1 link updated.')
    await act(async () => button(el).click())
    expect(result(el)).toBe('YAZ-101 was used on two Macs. "Bar" is now YAZ-102. 1 link updated.')
    checkIds.mockResolvedValueOnce('YAZ-101 is on two notes. The Mac that made "Bar" fixes it when its app runs.')
    await act(async () => button(el).click())
    expect(result(el)).toBe('YAZ-101 is on two notes. The Mac that made "Bar" fixes it when its app runs.')
  })

  it('while a check runs the button does nothing more, and a check that fails says why', async () => {
    const { el, checkIds } = withIds(true)
    let fail: (err: Error) => void = () => undefined
    checkIds.mockReturnValueOnce(new Promise<string>((_, reject) => (fail = reject)))
    act(() => button(el).click())
    expect(button(el).disabled).toBe(true)
    expect(result(el)).toBe('Checking…')
    act(() => button(el).click())
    expect(checkIds).toHaveBeenCalledTimes(1)
    await act(async () => fail(new Error('the disk said no')))
    expect(button(el).disabled).toBe(false)
    expect(result(el)).toBe("Couldn't check: the disk said no")
  })
})

describe('SettingsDialog: ID letters (YAZ-2677 D5, S79, S80, S83, S85)', () => {
  const withIds = async (enabled: boolean, state?: Partial<IdsState>, vaultName?: string) => {
    const mounted = mount({ ...DEFAULT_SETTINGS }, undefined, undefined, { enabled, held: enabled, letters: 'YAZ', state: state ?? {} }, vaultName)
    // The row reads the letters and the counts from the main process as it appears.
    await act(async () => undefined)
    return mounted
  }
  const buttons = (el: HTMLElement) => rowButtons(el, 'idLetters').filter((b) => !b.classList.contains('confirm__btn'))
  const line = (el: HTMLElement) => row(el, 'idLetters')?.querySelector('[role="status"]')?.textContent
  const sheetBtn = (el: HTMLElement, label: string) => [...el.querySelectorAll<HTMLButtonElement>('.confirm__btn')].find((b) => b.textContent === label) as HTMLButtonElement
  const field = (el: HTMLElement) => el.querySelector('.confirm__input') as HTMLInputElement

  it('S79: the row shows only while the vault uses IDs, with the letters and one button', async () => {
    expect(row((await withIds(false)).el, 'idLetters')).toBeNull()
    unmount()
    expect(row(mount().el, 'idLetters')).toBeNull()
    unmount()
    const { el, idsState, reletter } = await withIds(true)
    expect(row(el, 'idLetters')?.closest('.settings-group')?.querySelector('.settings-group__title')?.textContent).toBe('This vault')
    expect(row(el, 'idLetters')?.querySelector('.setting__label')?.textContent).toBe('ID letters')
    expect(idsState).toHaveBeenCalledTimes(1)
    expect(line(el)).toBe("This vault's ID letters are YAZ.")
    expect(buttons(el).map((b) => b.textContent)).toEqual(['Change letters'])
    expect(reletter).not.toHaveBeenCalled()
  })

  it('S80: "Change letters" opens a box with the count of notes and a text field, and writes nothing', async () => {
    const { el, reletter } = await withIds(true, { notes: 745 }, 'Work')
    act(() => buttons(el)[0].click())
    expect(el.querySelector('.confirm__text')?.textContent).toBe(lettersAskMessage({ letters: 'YAZ', notes: 745 }, 'Work'))
    expect(el.querySelector('.confirm__text')?.textContent).toContain('745 notes')
    expect(el.querySelector('.confirm__letters')?.textContent).toBe(NEW_LETTERS_ASK)
    expect(document.activeElement).toBe(field(el))
    expect([...el.querySelectorAll('.confirm__btn')].map((b) => b.textContent)).toEqual(['Cancel', 'Change letters'])
    expect(sheetBtn(el, 'Change letters').disabled).toBe(true)
    act(() => sheetBtn(el, 'Cancel').click())
    expect(el.querySelector('.confirm')).toBeNull()
    expect(reletter).not.toHaveBeenCalled()
  })

  it.each(['', 'D', 'ABCDEF', 'DO1', 'DO C', 'yaz', 'YAZ'])('S80, S85: with %j in the field (bad input, or the letters the vault has), the button and Enter do nothing', async (typed) => {
    const { el, reletter } = await withIds(true)
    act(() => buttons(el)[0].click())
    type(field(el), typed)
    expect(sheetBtn(el, 'Change letters').disabled).toBe(true)
    act(() => sheetBtn(el, 'Change letters').click())
    pressEnter(field(el))
    expect(reletter).not.toHaveBeenCalled()
    expect(el.querySelector('.confirm')).not.toBeNull()
  })

  it('S81: valid new letters, then "Change letters": the main process changes them, in capitals, and the row shows the new letters', async () => {
    const { el, reletter, onClose } = await withIds(true)
    act(() => buttons(el)[0].click())
    type(field(el), 'doc')
    await act(async () => sheetBtn(el, 'Change letters').click())
    expect(reletter).toHaveBeenCalledExactlyOnceWith('DOC')
    expect(el.querySelector('.confirm')).toBeNull()
    expect(line(el)).toBe("This vault's ID letters are DOC.")
    expect(onClose).not.toHaveBeenCalled()
  })

  it('S83: a change that stopped: the row says how many notes still have the old letters, and "Finish" runs the same change again', async () => {
    const { el, reletter } = await withIds(true, { letters: 'DOC', stale: 12 })
    expect(line(el)).toBe(lettersLine({ letters: 'DOC', stale: 12 }))
    expect(line(el)).toBe("This vault's ID letters are DOC. 12 notes still have the old letters.")
    expect(buttons(el).map((b) => b.textContent)).toEqual(['Change letters', 'Finish'])
    await act(async () => buttons(el)[1].click())
    expect(reletter).toHaveBeenCalledExactlyOnceWith('DOC')
    expect(line(el)).toBe("This vault's ID letters are DOC.")
    expect(buttons(el).map((b) => b.textContent)).toEqual(['Change letters'])
  })

  it('a change that fails says why, and the row keeps the letters it had', async () => {
    const { el, reletter } = await withIds(true)
    reletter.mockRejectedValueOnce(new Error('ids.json is not valid JSON'))
    act(() => buttons(el)[0].click())
    type(field(el), 'doc')
    await act(async () => sheetBtn(el, 'Change letters').click())
    expect(line(el)).toBe("Couldn't change the letters: ids.json is not valid JSON")
  })
})

describe('SettingsDialog: Old IDs (YAZ-2677 D6, S88 to S91)', () => {
  const withOld = async (old: number, enabled = true, vaultName?: string) => {
    const mounted = mount({ ...DEFAULT_SETTINGS }, undefined, undefined, { enabled, held: enabled, letters: 'YAZ', old, state: {} }, vaultName)
    await act(async () => undefined)
    return mounted
  }
  const button = (el: HTMLElement) => rowButtons(el, 'oldIds')[0]
  const line = (el: HTMLElement) => row(el, 'oldIds')?.querySelector('[role="status"]')?.textContent
  const sheetBtn = (el: HTMLElement, label: string) => [...el.querySelectorAll<HTMLButtonElement>('.confirm__btn')].find((b) => b.textContent === label) as HTMLButtonElement
  const field = (el: HTMLElement) => el.querySelector('.confirm__input') as HTMLInputElement

  it('S88: the row shows only in a vault that uses IDs and has notes with an old ID: the count and one button', async () => {
    expect(row((await withOld(0)).el, 'oldIds')).toBeNull()
    unmount()
    expect(row((await withOld(745, false)).el, 'oldIds')).toBeNull()
    unmount()
    const { el, backfill } = await withOld(745)
    expect(row(el, 'oldIds')?.querySelector('.setting__label')?.textContent).toBe('Old IDs')
    expect(line(el)).toBe(oldIdsLine(745))
    expect(line(el)).toContain('745 notes')
    expect(rowButtons(el, 'oldIds').map((b) => b.textContent)).toEqual(['Give them numbers'])
    expect(backfill).not.toHaveBeenCalled()
  })

  it('S89, S91: the box says the count and to sync and close the other Mac first, and only the vault\'s letters start it', async () => {
    const { el, backfill } = await withOld(745, true, 'Work')
    await act(async () => button(el).click())
    expect(el.querySelector('.confirm__text')?.textContent).toBe(oldIdsAskMessage(745, 'Work'))
    expect(el.querySelector('.confirm__text')?.textContent).toContain('745 notes')
    expect(el.querySelector('.confirm__text')?.textContent).toContain('First sync this vault and close the app on your other Macs')
    expect(el.querySelector('.confirm__letters')?.textContent).toBe(idsLettersAsk('YAZ'))
    for (const typed of ['', 'DOC', 'YA', 'YAZZ']) {
      type(field(el), typed)
      expect(sheetBtn(el, 'Give them numbers').disabled).toBe(true)
      pressEnter(field(el))
    }
    expect(backfill).not.toHaveBeenCalled()
    type(field(el), 'yaz')
    await act(async () => sheetBtn(el, 'Give them numbers').click())
    expect(backfill).toHaveBeenCalledExactlyOnceWith()
    expect(el.querySelector('.confirm')).toBeNull()
    expect(line(el)).toBe('Each note has a number now.')
  })

  it('S90: a run that left notes says how many, and to run it again; Cancel writes nothing', async () => {
    const { el, backfill } = await withOld(3)
    await act(async () => button(el).click())
    act(() => sheetBtn(el, 'Cancel').click())
    expect(backfill).not.toHaveBeenCalled()
    backfill.mockResolvedValueOnce({ letters: 'YAZ', notes: 5, stale: 0, old: 1, unfinished: true })
    await act(async () => button(el).click())
    type(field(el), 'YAZ')
    await act(async () => sheetBtn(el, 'Give them numbers').click())
    expect(line(el)).toBe('1 note has an old ID, like 6cbnmcq5n2sj. Run it again to finish.')
  })

  it('S90: a run that stopped with links left, after each note has its number: the row still shows, and a second run finishes it', async () => {
    const mounted = mount({ ...DEFAULT_SETTINGS }, undefined, undefined, { enabled: true, held: true, letters: 'YAZ', old: 0, unfinished: true, state: {} })
    await act(async () => undefined)
    const { el, backfill } = mounted
    expect(line(el)).toBe('Each note has a number, but some links still hold an old ID.')
    await act(async () => button(el).click())
    expect(el.querySelector('.confirm__text')?.textContent).toBe(oldIdsAskMessage(0))
    expect(el.querySelector('.confirm__text')?.textContent).toContain('Finish giving the old IDs in this vault numbers?')
    backfill.mockResolvedValueOnce({ letters: 'YAZ', notes: 5, stale: 0, old: 0, unfinished: true })
    type(field(el), 'YAZ')
    await act(async () => sheetBtn(el, 'Give them numbers').click())
    expect(line(el)).toBe('Each note has a number, but some links still hold an old ID. Run it again to finish.')
    await act(async () => button(el).click())
    type(field(el), 'YAZ')
    await act(async () => sheetBtn(el, 'Give them numbers').click())
    expect(backfill).toHaveBeenCalledTimes(2)
    expect(line(el)).toBe('Each note has a number now.')
  })
})
