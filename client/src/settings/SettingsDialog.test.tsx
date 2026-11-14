/**
 * The settings dialog (YAZ-1679): a page for each section with grouped rows (YAZ-2709, amending
 * the one long scrolling page), a nav whose click swaps the page, search over the one registry,
 * the popover's controls rehoused row by row (Theme writes through `onChange`, the folder input's
 * draft/commit logic, the per-vault GitHub switch through `sync.setEnabled`, the per-vault review
 * settings through `review.save`), and the modal's own contract — Esc layered over search,
 * click-away, focus restored to whatever opened it.
 *
 * ONE SECTION IS ON SCREEN AT A TIME, so a test of a row in a later section goes to that
 * section's page first, the way a user does: `mountOn('Files & Links', …)` is `mount(…)` and a
 * click on that nav item.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_REVIEW_SETTINGS, type ReviewSettings } from '@shared/reviews'
import type { ShowIdsSettings } from '../search/showIds'
import { MAX_ICON_MATCH, MAX_ICON_RULES } from '@shared/vaultIcons'
import type { TextFormatting } from '@shared/textFormatting'
import { DEFAULT_SETTINGS, type GithubSyncStatus, type IdsState, type IndexResponse, type SettingsState } from '@shared/types'
import { UNIT_WORDS, unitTextOf } from '../vault/unitWord'
import { idsAskMessage, idsLettersAsk, KEEP_OTHER_ASK, keepIdsAskMessage, lettersAskMessage, lettersLine, NEW_LETTERS_ASK, oldIdsAskMessage, oldIdsLine } from './idsAskMessage'
import { HOTKEYS_SECTION } from './hotkeysSection'
import { groupsOf, SETTINGS_SECTIONS, type SettingsCtx } from './registry'
import { SettingsDialog } from './SettingsDialog'
import { NEXT_HIDDEN_SWATCH } from './options'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLElement | null = null

function mount(settings: SettingsState = { ...DEFAULT_SETTINGS }, syncStatus?: GithubSyncStatus | null, reviewSettings?: ReviewSettings, vaultIds?: { enabled: boolean; held: boolean; ask?: IndexResponse['ask']; letters?: string; old?: number; unfinished?: boolean; state?: Partial<IdsState> }, vaultName?: string, readOnlyVault?: { on: boolean }, showIdsSettings?: ShowIdsSettings) {
  const onChange = vi.fn()
  // The vault's "Show IDs" (YAZ-4940): no settings handed over is no vault open, so no rows.
  const saveShowIds = vi.fn()
  const showIds = showIdsSettings === undefined ? undefined : { settings: showIdsSettings, save: saveShowIds, inSearch: () => showIdsSettings.search, inTitle: () => showIdsSettings.title }
  // The vault's Read only (YAZ-4939): no settings handed over is no vault open, so no row.
  const saveReadOnly = vi.fn()
  const readOnly = readOnlyVault === undefined ? undefined : { settings: readOnlyVault, save: saveReadOnly, fileActionsAllowed: () => true, allowFileActions: () => undefined, lockFileActions: () => undefined, allowedUntil: null }
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
  const STATE: IdsState = { letters: vaultIds?.letters ?? 'YAZ', pages: 3, stale: 0, old: vaultIds?.old ?? 0, unfinished: false, ...vaultIds?.state }
  // It answers only where the test hands a `state` over: a row that no test looks at stays as it was mounted.
  const idsState = vi.fn((): Promise<IdsState> => (vaultIds?.state === undefined ? new Promise(() => undefined) : Promise.resolve(STATE)))
  const reletter = vi.fn(async (letters: string): Promise<IdsState> => ({ ...STATE, letters, stale: 0 }))
  const backfill = vi.fn(async (): Promise<IdsState> => ({ ...STATE, old: 0 }))
  const ids = vaultIds === undefined ? undefined : { enabled: vaultIds.enabled, held: vaultIds.held, ask, set: setIds, check: checkIds, old: vaultIds.old ?? 0, unfinished: vaultIds.unfinished ?? false, state: idsState, reletter, backfill }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  // The active vault's name (YAZ-2602 R10): App hands it only with two or more vaults in the window.
  act(() => root?.render(<SettingsDialog ctx={{ settings, onChange, sync, review, ids, vaultName, readOnlyVault: readOnly, showIds }} onClose={onClose} />))
  /** The open dialog with the vault's review settings changed under it: a save shown at once. */
  const rerender = (next: ReviewSettings) => act(() => root?.render(<SettingsDialog ctx={{ settings, onChange, sync, review: { settings: next, save } }} onClose={onClose} />))
  return { onChange, onClose, setEnabled, save, setIds, checkIds, idsState, reletter, backfill, rerender, saveReadOnly, saveShowIds, el: container }
}

/** Card review as a new vault has it: on (YAZ-4959 D14). */
const REVIEW_ON: ReviewSettings = { ...DEFAULT_REVIEW_SETTINGS }
const REVIEW_OFF: ReviewSettings = { ...DEFAULT_REVIEW_SETTINGS, enabled: false }

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
/** The one current nav item, and what it says it is: always `page`, the section the pane shows. */
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
function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const set = Object.getOwnPropertyDescriptor((input instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement : window.HTMLInputElement).prototype, 'value')?.set
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

/** jsdom lays nothing out; `scrollTop` is a plain property on the pane, so setting it and dispatching `scroll` is the whole simulation. */
const scrollTo = (el: HTMLElement, top: number) =>
  act(() => {
    pane(el).scrollTop = top
    pane(el).dispatchEvent(new Event('scroll', { bubbles: true }))
  })

/** `mount`, then the page of the section named: a row of a later section is reached by its nav item, as a user reaches it. */
const mountOn = (title: string, ...args: Parameters<typeof mount>) => {
  const mounted = mount(...args)
  clickNav(mounted.el, title)
  return mounted
}
/** Every page in nav order, each one opened by its nav item, with what `read` finds while it shows. */
const onEachPage = <T,>(el: HTMLElement, read: () => T): [string, T][] =>
  navButtons(el)
    .map((b) => b.textContent as string)
    .map((title) => {
      clickNav(el, title)
      return [title, read()]
    })

/** The rows of each page with no vault open, in registry order (registry.tsx). */
/** General (YAZ-3276 D7), the first page: the settings folder, then Reopen, moved here from Files & Links. */
const GENERAL_ROWS = ['profile', 'settingsFolder', 'startupWindows', 'vaultOpensOn']
/** Text formatting (YAZ-3068) is one vault's, so a window with no vault has no such row. */
const APPEARANCE_ROWS = ['theme', 'contentWidth', 'lineSpacing', 'blockGap', 'pageSpacingPreview', 'commentsOrder', 'commentsResolved', 'commentsHint']
/** Settings › Sidebar (YAZ-3440 D7): the sidebar tree's look, after Appearance; the colours show only with the Line set. */
/** The icon colour rows (YAZ-3440 D4, YAZ-5100 round 2), by kind. */
const colourRows = (...kinds: string[]) => kinds.map((kind) => `sidebarIconColors.${kind}`)
/** Settings › Sidebar with Material and "Colour" (the defaults), no vault open: a colour row per kind Material draws in one colour. */
const SIDEBAR_ROWS = ['sidebarLines', 'sidebarLineStyle', 'sidebarThreadColor', 'sidebarStickyLevels', 'sidebarArrowMotion', 'sidebarFolderIcons', 'sidebarRevealActive', 'sidebarIconSet', 'sidebarFileIcons', ...colourRows('page', 'drawing', 'diagram', 'folder'), 'sidebarIconRules', 'goTo']
const SIDEBAR_ROWS_BARE = SIDEBAR_ROWS.filter((id) => !id.startsWith('sidebarIconColors.'))
/** The same with a vault whose Review is on: the Card colour row too. */
const SIDEBAR_ROWS_REVIEW = SIDEBAR_ROWS.flatMap((id) => (id === 'sidebarIconColors.page' ? [id, 'sidebarIconColors.card'] : [id]))
/** Settings › Notifications (YAZ-3303), under Appearance: the toasts, the three types, the sounds. */
const NOTIFICATIONS_ROWS = ['noticeLength', 'noticeUndo', 'noticeClipboard', 'noticeLists', 'gestureSounds', 'hearSounds']
const EDITOR_ROWS = ['guideLinesOnByDefault', 'guideLinesShow', 'guideLineDarkness', 'foldingOnByDefault', 'pageBulletIndent', 'pageBulletGap', 'bulletThreading', 'threadWidth', 'threadColor', 'sectionStep', 'sectionLines', 'selectionToolbar', 'typingArrows', 'enterKeepsStylePages', 'enterKeepsStyleBoxes', 'tocOnByDefault', 'tableOfContents', 'tocLines', 'findFolds', 'outsideChangeGlow', 'outsideListPinned', 'codeBlockWidth']
/**
 * Settings › Tables (YAZ-4775), after Editor: the page tables' rows, moved off the Editor page with their keys. "All tables"
 * starts with Header row (YAZ-4774) and Width (YAZ-4783); Cell notes with the "+" (YAZ-4790).
 */
const TABLES_ROWS = ['tableHeaderRow', 'tableSubheaderRow', 'tableStickyHeader', 'tableStickySubheaders', 'tableWidth', 'tablePosition', 'tableTextInCells', 'tableNewStyle', 'tableRowBand', 'tableBandColour', 'tableBandStrength', 'tableBandRows', 'tableBandBold', 'tableCellBulletIndent', 'tableCellBulletGap', 'tableCellNoteButton', 'tableCellNoteTemplate', 'tableCellNotePinned', 'tableAllNotesOpensAt', 'tableNowMark', 'tableNowButton', 'tableDimPast', 'tableShadeDarkness', 'tableCalendarDay', 'tableTimeFormat']
/** Settings › Code (YAZ-3449), after Editor: the three switches a code tab's cog has too, then "Jump across files" (YAZ-3500). */
const CODE_ROWS = ['codeReadOnly', 'codeWrap', 'codeMinimap', 'codeLanguageHelpers']
/** The groups of the Editor page, in registry order: Outline (YAZ-4094) first, then Section indent directly under Bullet threading, whose rows draw its path (Yasin's call, YAZ-2709), and "Table of contents" (YAZ-2700) follows. */
// Find (YAZ-4787) after Table of contents; Code blocks (YAZ-4783) last; the table groups have their own page (YAZ-4775).
const EDITOR_GROUPS = ['Outline', 'Bullet threading', 'Section indent', 'Selection toolbar', 'Typing', 'Table of contents', 'Find', 'Outside changes', 'Code blocks']
/** The groups of the Tables page (YAZ-4775): "All tables" (the Editor page's "Tables" before), Cell notes, Calendar tables. */
const TABLES_GROUPS = ['All tables', 'Cell notes', 'Calendar tables']
/**
 * Settings › Drawings and diagrams (YAZ-3037; the name since YAZ-4748 D11): one row per `CanvasPrefs` key the page shows, in
 * its groups, then the draw.io diagrams group, whose one row moved here from Appearance.
 */
const CANVAS_ROWS = [...['gridModeEnabled', 'objectsSnapModeEnabled', 'snapToMidpoints', 'arrowBinding', 'selectOn', 'hoverOutline', 'toolLock', 'zenModeEnabled', 'writingMode', 'framesVisible', 'newElementStyle', 'newShapesMatchZoom', 'fillSetsTextColor', 'writingStrokeWidth', 'vectorStrokeWidth', 'defaultFontFamily', 'newTextScreenSize', 'newTextWrapMargin', 'defaultRoughness', 'defaultTextAlign', 'foldArrowsOpen', 'foldArrowSize', 'foldArrowThickness', 'foldArrowMinSize'].map((k) => `canvas.${k}`), 'embedRestSeconds', 'newBoardFolder', 'diagramDarkColors']
/** Settings › Images (YAZ-3038): the Pixabay key, the library folder and the favorites (YAZ-4363), then the icon packs (YAZ-4359). */
const IMAGES_ROWS = ['pixabayApiKey', 'libraryFolder', 'favoriteCopies', 'iconPacks', 'mediaHoverZoom', 'mediaHoverZoomSize']
/** Settings › Files & Links: the first group, then Preview on hover (YAZ-3403) — the master switch and one row per place. */
// Daily pages (YAZ-3607 D12): off by default, so its group shows the switch alone.
// New boards keep pictures and Allowed picture folders (YAZ-3943 demo 2, round 3); Links in drawings and diagrams (demo 2).
const FILES_ROWS = ['newPageLocation', 'newPageTitleTemplate', 'confirmDelete', 'confirmRename', 'newTabPlace', 'newBoardPictures', 'allowedPictureFolders', 'dailyPages', 'hoverPreview', ...['sidebar', 'search', 'newTab', 'tabBoard', 'tabs', 'backlinks', 'links', 'drawings'].map((place) => `hoverPreviewIn.${place}`)]
/** Settings › Folder pages (YAZ-4585): its personal rows, with the folder views' hover row moved from Files & Links, the view defaults, the page default. */
// Column type icons (YAZ-4779) and the "+ New" buttons (13BL) after Row numbers; sticky group headers, group lines and their style (YAZ-4798) after Group indent.
const FOLDER_PAGES_ROWS = ['folderPages.weekStartsOn', 'hoverPreviewIn.folderViews', 'hoverPreviewIn.folderLinks', 'folderPages.rowBand', 'folderPages.keepWindowPinned', 'folderPages.askBeforeDelete', 'folderPages.confirmChanges', ...['rowHeight', 'rowNumbers', 'columnTypeIcons', 'showNewButtons', 'textInCells', 'groupIndent', 'stickyGroups', 'groupLines', 'groupLineStyle', 'showEmptyGroups', 'showEmptyColumns', 'subfolders', 'foldersFirst', 'folderIcons', 'folderCounts', 'calendarScale', 'cardTitles', 'hideWeekends', 'weekLine', 'dayLine', 'showFolderPageFiles', 'showOtherFiles', 'inheritColumns', 'columnMarks'].map((part) => `folderPages.${part}`)]
// YAZ-5050 round 2: in groups — Daily limits, Answers, Scheduling, Card look (with its preview).
const REVIEW_ROWS = ['enabled', 'newPerDay', 'upNextPerDay', 'newOrder', 'buttons', 'pauseAfter', 'timeSoFar', 'retention', 'maxDays', 'fuzz', 'weights', 'shownHiddenWords', 'markNextHidden', 'nextHiddenColour', 'cardWidth', 'cardTablePosition', 'cardSpacing', 'cardSpacingPreview', 'howCardsComeBack']
/**
 * Settings › Hotkeys (YAZ-3397 D5, D8): one row per key. With no bridge main never answers for the Mac's own keys,
 * so the "Used by macOS" rows are not there; with no key changed, neither is "Reset all hotkeys".
 */
/** The Hotkeys page's rows as the default keys card them (YAZ-3564), without the Mac's (they wait for main) and Reset all (no change). */
const DEFAULT_CTX = { settings: DEFAULT_SETTINGS, onChange: () => undefined } as SettingsCtx
// A row shows while it is available: "Open today's daily page" waits for Daily pages to be on (YAZ-3607 D11).
const HOTKEY_ROWS = groupsOf(HOTKEYS_SECTION, DEFAULT_CTX)
  .flatMap((g) => g.items.filter((i) => i.available?.(DEFAULT_CTX) ?? true).map((i) => i.id))
  .filter((id) => !id.startsWith('hotkey-macos-') && id !== 'hotkeys-reset-all')
const THREADING_HINT = 'The coloured path from each list down to the bullet at the caret.'
const OUTLINE_HINT = 'Lines and folding for bullets. A page can change each one in its cog.'
const TEXT_FORMATTING_HINT = 'How text looks in every page of this vault.'
const TOC_HINT = 'The headings or the bullets of a page, at its right edge.'
const OUTSIDE_CHANGES_HINT = 'Text that an AI or another app changed in an open page.'
const SECTION_INDENT_HINT = 'Text stands below its heading, with lines that show the sections. Turn it on for a page from the page cog. The purple path uses the Bullet threading settings above.'

describe('SettingsDialog shell (D1)', () => {
  it('is a modal dialog named Settings that opens on General with the search box focused (YAZ-3276 D7)', () => {
    const { el } = mount()
    const dialog = el.querySelector('[role="dialog"]')
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(dialog?.getAttribute('aria-label')).toBe('Settings')
    expect(currentNav(el)).toBe('General')
    expect(document.activeElement).toBe(searchInput(el))
  })

  it('General shows the "Settings folder" row and the "Reopen" row, each under its own group; Files & Links no longer shows "Reopen" (YAZ-3276 D7)', () => {
    const { el } = mount()
    expect(headings(el)).toEqual(['General'])
    expect(groupTitles(el)).toEqual(['You', 'Settings folder', 'When the app starts', 'When a vault opens'])
    expect(rowIds(el)).toEqual(GENERAL_ROWS)
    expect(row(el, 'settingsFolder')?.querySelector('.setting__label')?.textContent).toBe('Settings folder')
    expect(row(el, 'settingsFolder')?.closest('.settings-group')?.querySelector('.settings-group__title')?.textContent).toBe('Settings folder')
    expect(row(el, 'startupWindows')?.querySelector('.setting__label')?.textContent).toBe('Reopen')
    expect(row(el, 'startupWindows')?.closest('.settings-group')?.querySelector('.settings-group__title')?.textContent).toBe('When the app starts')
    clickNav(el, 'Files & Links')
    expect(row(el, 'startupWindows')).toBeNull()
    expect(groupTitles(el)).not.toContain('When the app starts')
    expect([...el.querySelectorAll('.setting__label')].map((l) => l.textContent)).not.toContain('Reopen')
  })

  it('the icon picker of Settings › Sidebar › Icon rules (YAZ-3440 D8): Escape, its × and a click outside close the picker alone; the dialog stays open and nothing changes', () => {
    const { el, onChange, onClose } = mountOn('Sidebar', { ...DEFAULT_SETTINGS, sidebarIconRules: [{ match: '*.test.ts', kind: 'file', icon: 'test-ts' }] })
    const open = () => {
      act(() => el.querySelector<HTMLButtonElement>('[aria-label="Icon: test-ts"]')?.click())
      expect(el.querySelector('.icon-picker')).not.toBeNull()
      expect(el.querySelector('.icon-picker__head')?.textContent).toBe('Icon for rule *.test.ts')
    }
    open()
    pressEscape(el.querySelector<HTMLInputElement>('.icon-picker__search')!)
    expect(el.querySelector('.icon-picker')).toBeNull()
    open()
    // Escape from an icon of the grid too.
    pressEscape(el.querySelector<HTMLButtonElement>('.icon-picker__icon')!)
    expect(el.querySelector('.icon-picker')).toBeNull()
    open()
    act(() => el.querySelector<HTMLButtonElement>('.icon-picker [aria-label="Close"]')?.click())
    expect(el.querySelector('.icon-picker')).toBeNull()
    open()
    const outside = el.querySelector<HTMLElement>('.icon-picker__outside')!
    act(() => {
      outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      outside.click()
    })
    expect(el.querySelector('.icon-picker')).toBeNull()
    expect(el.querySelector('.settings-dialog')).not.toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('Settings › Sidebar shows a colour row per kind while the icons have colour: every kind with the Line set, the one-colour kinds with Material; Grey and Off leave the folder alone (YAZ-3440 D4, YAZ-5100 round 2)', () => {
    const withColours = (...kinds: string[]) => [...SIDEBAR_ROWS_BARE.slice(0, -2), ...colourRows(...kinds), 'sidebarIconRules', 'goTo']
    const again = (...args: Parameters<typeof mount>) => {
      unmount()
      return rowIds(mountOn('Sidebar', ...args).el)
    }
    const { el } = mountOn('Sidebar', { ...DEFAULT_SETTINGS, sidebarIconSet: 'line' })
    expect(rowIds(el)).toEqual(withColours('page', 'drawing', 'diagram', 'folder', 'text', 'pdf', 'image'))
    expect(again({ ...DEFAULT_SETTINGS })).toEqual(withColours('page', 'drawing', 'diagram', 'folder'))
    for (const files of ['grey', 'off'] as const) {
      expect(again({ ...DEFAULT_SETTINGS, sidebarIconSet: 'line', sidebarFileIcons: files }), files).toEqual(withColours('folder'))
      expect(again({ ...DEFAULT_SETTINGS, sidebarFileIcons: files, sidebarFolderIcons: 'off' }), files).toEqual(SIDEBAR_ROWS_BARE)
    }
  })

  it("Settings › Sidebar's Card colour shows only while the vault's Review is on (YAZ-5100 round 2)", () => {
    const { el } = mountOn('Sidebar', { ...DEFAULT_SETTINGS }, undefined, REVIEW_ON)
    expect(rowIds(el).filter((id) => id?.startsWith('sidebarIconColors.') === true)).toEqual(colourRows('page', 'card', 'drawing', 'diagram', 'folder'))
    expect(row(el, 'sidebarIconColors.card')?.textContent).toContain('Card colour')
    unmount()
    const off = mountOn('Sidebar', { ...DEFAULT_SETTINGS }, undefined, REVIEW_OFF)
    expect(row(off.el, 'sidebarIconColors.card')).toBeNull()
    unmount()
    const grey = mountOn('Sidebar', { ...DEFAULT_SETTINGS, sidebarFileIcons: 'grey' }, undefined, REVIEW_ON)
    expect(row(grey.el, 'sidebarIconColors.card')).toBeNull()
  })

  it('a colour row picks a colour and Reset drops it; the swatch is the icon\'s colour as it shows now (YAZ-5100 round 2)', async () => {
    const { el, onChange } = mountOn('Sidebar', { ...DEFAULT_SETTINGS }, undefined, REVIEW_ON)
    // The control is its own chunk, loaded when the row shows.
    await act(async () => await import('./IconColourControl'))
    const picker = (id: string) => row(el, id)?.querySelector<HTMLInputElement>('input[type="color"]')
    // Material's own colours, and the card's purple.
    expect(picker('sidebarIconColors.drawing')?.value).toBe('#5c6bc0')
    expect(picker('sidebarIconColors.folder')?.value).toBe('#90a4ae')
    expect(picker('sidebarIconColors.card')?.value).toBe('#8a63c9')
    expect(picker('sidebarIconColors.card')?.getAttribute('aria-label')).toBe('Card icon colour')
    const reset = rowButtons(el, 'sidebarIconColors.card').find((b) => b.textContent === 'Reset')
    expect(reset?.disabled).toBe(true)
    act(() => {
      const input = picker('sidebarIconColors.card')!
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, '#cc3366')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, sidebarIconColors: { card: '#cc3366' } })
    unmount()
    const picked = mountOn('Sidebar', { ...DEFAULT_SETTINGS, sidebarIconColors: { card: '#cc3366', folder: '#112233' } }, undefined, REVIEW_ON)
    await act(async () => await import('./IconColourControl'))
    expect(row(picked.el, 'sidebarIconColors.card')?.querySelector<HTMLInputElement>('input[type="color"]')?.value).toBe('#cc3366')
    act(() => rowButtons(picked.el, 'sidebarIconColors.card').find((b) => b.textContent === 'Reset')?.click())
    expect(picked.onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, sidebarIconColors: { folder: '#112233' } })
  })

  it('Settings › Sidebar › Folder icons is Plain, By name or Off, Plain first and chosen by default (YAZ-3554 D3, D5)', () => {
    const { el, onChange } = mountOn('Sidebar')
    const buttons = [...(row(el, 'sidebarFolderIcons')?.querySelectorAll('button') ?? [])]
    expect(buttons.map((b) => b.textContent)).toEqual(['Plain', 'By name', 'Off'])
    expect(buttons[0].className).toContain('settings__option--active')
    act(() => buttons[1].click())
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, sidebarFolderIcons: 'named' })
  })

  it('Settings › Sidebar › Icon rules stops at the settings check: no rule past MAX_ICON_RULES, no pattern past MAX_ICON_MATCH characters (YAZ-3440 D9)', () => {
    const full = Array.from({ length: MAX_ICON_RULES }, (_, k) => ({ match: `*.x${k}`, kind: 'file' as const, icon: 'file' }))
    const { el } = mountOn('Sidebar', { ...DEFAULT_SETTINGS, sidebarIconRules: full })
    const add = [...(row(el, 'sidebarIconRules')?.querySelectorAll('button') ?? [])].find((b) => b.textContent === 'Add rule')
    expect(add?.disabled).toBe(true)
    expect(el.querySelector<HTMLInputElement>('.icon-rules__match')?.maxLength).toBe(MAX_ICON_MATCH)
    act(() => root?.unmount())
    container?.remove()
    const fewer = mountOn('Sidebar', { ...DEFAULT_SETTINGS, sidebarIconRules: full.slice(1) })
    expect([...(row(fewer.el, 'sidebarIconRules')?.querySelectorAll('button') ?? [])].find((b) => b.textContent === 'Add rule')?.disabled).toBe(false)
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

describe('SettingsDialog: a page for each section (YAZ-2709, amending the one long page)', () => {
  it('the nav: the settings pages (Review only with a vault, Sync only with the engine), a divider, then the Hotkeys reference page', () => {
    const { el } = mount()
    expect(navShape(el)).toEqual(['General', 'Appearance', 'Sidebar', 'Notifications', 'Editor', 'Tables', 'Code', 'Drawings and diagrams', 'Images', 'Files & Links', 'Folder pages', '—', 'Memory', 'Hotkeys'])
    unmount()
    const withSync = mount({ ...DEFAULT_SETTINGS }, status())
    expect(navShape(withSync.el)).toEqual(['General', 'Appearance', 'Sidebar', 'Notifications', 'Editor', 'Tables', 'Code', 'Drawings and diagrams', 'Images', 'Files & Links', 'Folder pages', 'Sync', '—', 'Memory', 'Hotkeys'])
    unmount()
    const withVault = mount({ ...DEFAULT_SETTINGS }, status(), REVIEW_ON)
    expect(navShape(withVault.el)).toEqual(['General', 'Appearance', 'Sidebar', 'Notifications', 'Editor', 'Tables', 'Code', 'Drawings and diagrams', 'Images', 'Files & Links', 'Folder pages', 'Review', 'Sync', '—', 'Memory', 'Hotkeys'])
  })

  it('the registry order once both YAZ-3028 halves land: canvas and images after Editor (YAZ-3037, YAZ-3038), storage and sharing after Sync (YAZ-3039, YAZ-3040), Hotkeys last', () => {
    expect(SETTINGS_SECTIONS.map((section) => section.id)).toEqual(['general', 'appearance', 'sidebar', 'notifications', 'editor', 'tables', 'code', 'canvas', 'images', 'files', 'folderPages', 'review', 'sync', 'memory', 'storage', 'sharing', 'hotkeys'])
  })

  it('opens on General, the first page: the one section in the pane, anchored by id, with only its rows — no row of a later section is there (YAZ-3276 D7)', () => {
    const { el } = mount({ ...DEFAULT_SETTINGS }, status(), REVIEW_ON)
    expect(headings(el)).toEqual(['General'])
    expect(sections(el).map((s) => s.id)).toEqual(['settings-general'])
    expect(rowIds(el)).toEqual(GENERAL_ROWS)
    expect(currentNav(el)).toBe('General')
    expect(currentKind(el)).toBe('page')
    expect(pane(el).scrollTop).toBe(0)
    for (const id of [...APPEARANCE_ROWS, ...EDITOR_ROWS, ...TABLES_ROWS, ...CANVAS_ROWS, ...IMAGES_ROWS, ...FILES_ROWS, ...REVIEW_ROWS, 'githubSync', ...HOTKEY_ROWS]) expect(row(el, id)).toBeNull()
  })

  it('a nav click shows only that section: its heading, its anchor id and its rows in registry order, every row addressed by data-setting, and it alone is aria-current="page"', () => {
    const { el } = mount({ ...DEFAULT_SETTINGS }, status(), REVIEW_ON)
    const seen = onEachPage(el, () => {
      for (const r of el.querySelectorAll<HTMLElement>('.setting')) expect(r.dataset.setting).toBeTruthy()
      return {
        headings: headings(el),
        anchors: sections(el).map((s) => s.id),
        rows: rowIds(el),
        current: navButtons(el).filter((b) => b.getAttribute('aria-current') !== null).map((b) => [b.textContent, b.getAttribute('aria-current')]),
      }
    })
    const page = (title: string, anchor: string, rows: string[]) => [title, { headings: [title], anchors: [anchor], rows, current: [[title, 'page']] }]
    expect(seen).toEqual([
      page('General', 'settings-general', GENERAL_ROWS),
      page('Appearance', 'settings-appearance', APPEARANCE_ROWS),
      page('Sidebar', 'settings-sidebar', SIDEBAR_ROWS_REVIEW),
      page('Notifications', 'settings-notifications', NOTIFICATIONS_ROWS),
      page('Editor', 'settings-editor', EDITOR_ROWS),
      page('Tables', 'settings-tables', TABLES_ROWS),
      page('Code', 'settings-code', CODE_ROWS),
      page('Drawings and diagrams', 'settings-canvas', CANVAS_ROWS),
      page('Images', 'settings-images', IMAGES_ROWS),
      page('Files & Links', 'settings-files', FILES_ROWS),
      page('Folder pages', 'settings-folderPages', FOLDER_PAGES_ROWS),
      page('Review', 'settings-review', REVIEW_ROWS),
      page('Sync', 'settings-sync', ['githubSync']),
      page('Memory', 'settings-memory', ['memoryWindows', 'tabSleepAfter', 'embedPictures', 'memoryReload']),
      page('Hotkeys', 'settings-hotkeys', HOTKEY_ROWS),
    ])
  })

  it('group titles and hints render on their own page; untitled groups are plain rows', () => {
    const { el } = mount()
    const hints = () => [...el.querySelectorAll('.settings-group__hint')].map((h) => h.textContent)
    // General, as it opens (YAZ-3276 D7): two titled groups, no hints.
    expect(groupTitles(el)).toEqual(['You', 'Settings folder', 'When the app starts', 'When a vault opens'])
    expect(hints()).toEqual([])

    clickNav(el, 'Appearance')
    // Appearance with no vault: Spacing, Comments (the sidebar's groups have their own page since YAZ-3440 D7). draw.io
    // diagrams (YAZ-3037) is on "Drawings and diagrams" since YAZ-4748 D11. Text formatting needs a vault (YAZ-3068).
    expect(groupTitles(el)).toEqual(['Spacing', 'Comments'])
    expect(hints()).toEqual([])
    expect(row(el, 'commentsOrder')?.querySelector('.setting__label')?.textContent).toBe('Order')
    expect(row(el, 'commentsOrder')?.closest('.settings-group')?.querySelector('.settings-group__title')?.textContent).toBe('Comments')
    // It starts with an untitled group: Theme and Content width sit straight under the section title.
    expect(el.querySelector('#settings-appearance .settings-group')).not.toBeNull()
    expect(el.querySelector('#settings-appearance .settings-group')?.querySelector('.settings-group__title')).toBeNull()

    // Sidebar (YAZ-3440 D7): its four groups; the Icon rules are a setting, so they need no vault (D9). Go to is ⌘D's place (YAZ-3556 D8).
    clickNav(el, 'Sidebar')
    expect(groupTitles(el)).toEqual(['Level lines', 'Folders', 'File icons', 'Icon rules', 'Show in sidebar'])
    expect(hints()).toEqual([])

    clickNav(el, 'Editor')
    expect(groupTitles(el)).toEqual(EDITOR_GROUPS)
    expect(hints()).toEqual([OUTLINE_HINT, THREADING_HINT, SECTION_INDENT_HINT, 'The buttons over a selection, as the preview shows them. Drag a square to move it, or a group by its handle; click a square to hide or show it. Hotkeys keep working.', TOC_HINT, 'What ⌘F does with folded bullets and headings. The find bar’s fold button changes it for one page.', OUTSIDE_CHANGES_HINT])
    // The table groups have their own page (YAZ-4775), with no group hints.
    clickNav(el, 'Tables')
    expect(groupTitles(el)).toEqual(TABLES_GROUPS)
    expect(hints()).toEqual([])
    clickNav(el, 'Editor')
    // The threading rows carry the shortened labels; the group names the feature.
    expect(['bulletThreading', 'threadWidth', 'threadColor'].map((id) => row(el, id)?.querySelector('.setting__label')?.textContent)).toEqual(['Bullet threading default', 'Line width', 'Line colour'])
    for (const id of ['bulletThreading', 'threadWidth', 'threadColor']) expect(row(el, id)?.closest('.settings-group')?.querySelector('.settings-group__title')?.textContent).toBe('Bullet threading')

    clickNav(el, 'Files & Links')
    // "When the app starts" moved to General (YAZ-3276 D7): with no vault, Files & Links' one titled group is Preview on hover (YAZ-3403).
    expect(groupTitles(el)).toEqual(['New pages', 'Daily pages', 'Preview on hover'])
    expect(hints()).toEqual([])
    // Files & Links starts with "New pages" (YAZ-4246), then its untitled group.
    expect(el.querySelector('#settings-files .settings-group')?.querySelector('.settings-group__title')?.textContent).toBe('New pages')
    expect(el.querySelectorAll('#settings-files .settings-group')[1]?.querySelector('.settings-group__title')).toBeNull()
  })

  it('the two per-vault sections, Review and Sync, and Memory (YAZ-3977) carry a page under their titles; no other page does', () => {
    const { el } = mount({ ...DEFAULT_SETTINGS }, status(), REVIEW_ON)
    const pages = onEachPage(el, () => [...el.querySelectorAll('.settings-section__note')].map((n) => [n.closest('[data-section]')?.id, n.textContent]))
    expect(pages).toEqual([
      ['General', []],
      ['Appearance', []],
      ['Sidebar', []],
      ['Notifications', []],
      ['Editor', []],
      ['Tables', []],
      ['Code', []],
      ['Drawings and diagrams', []],
      ['Images', []],
      ['Files & Links', []],
      ['Folder pages', []],
      ['Review', [['settings-review', "These settings are saved in this vault's .yaseendocs folder and sync with it."]]],
      ['Sync', [['settings-sync', "These settings are saved in this vault's .yaseendocs folder, not app-wide."]]],
      ['Memory', [['settings-memory', 'The app frees memory by itself. A tab that you do not use goes to sleep. A window that gets too big reloads. You do not need to do anything here.']]],
      ['Hotkeys', []],
    ])
  })

  it('two or more vaults in the window: the pages of Review and Sync, and the "This vault" group of Files & Links, each say which vault they act on, first thing under the title; one vault: no such line on any page (YAZ-2602 R10, S39)', () => {
    /** Each "Vault: …" line of each page: its words, what it stands under, and which muted line it is. */
    const lines = (el: HTMLElement) =>
      onEachPage(el, () =>
        [...el.querySelectorAll('.settings-section__note, .settings-group__hint')].filter((n) => n.textContent?.startsWith('Vault: ')).map((n) => ({ text: n.textContent, under: n.previousElementSibling?.textContent, className: n.className })),
      )
    const { el } = mount({ ...DEFAULT_SETTINGS }, status(), REVIEW_ON, { enabled: true, held: false }, 'Work')
    // The same muted lines the dialog already has: a group's hint, a section's page.
    expect(lines(el)).toEqual([
      ['General', []],
      ['Appearance', []],
      ['Sidebar', []],
      ['Notifications', []],
      ['Editor', []],
      ['Tables', []],
      ['Code', []],
      ['Drawings and diagrams', []],
      ['Images', []],
      ['Files & Links', [{ text: 'Vault: Work', under: 'This vault', className: 'settings-group__hint' }]],
      ['Folder pages', []],
      ['Review', [{ text: 'Vault: Work', under: 'Review', className: 'settings-section__note' }]],
      ['Sync', [{ text: 'Vault: Work', under: 'Sync', className: 'settings-section__note' }]],
      ['Memory', []],
      ['Hotkeys', []],
    ])
    clickNav(el, 'Review')
    expect([...el.querySelectorAll('.settings-section__note')].map((n) => n.textContent)).toEqual(['Vault: Work', "These settings are saved in this vault's .yaseendocs folder and sync with it."])
    unmount()
    const one = mount({ ...DEFAULT_SETTINGS }, status(), REVIEW_ON, { enabled: true, held: false })
    expect(lines(one.el).flatMap(([, found]) => found)).toEqual([])
  })

  it('Hotkeys is a page like the others, under the divider: clicking it swaps the pane for its groups, one row per key, and takes aria-current="page"', () => {
    const { el } = mount()
    expect(navShape(el).slice(-3)).toEqual(['—', 'Memory', 'Hotkeys'])
    clickNav(el, 'Hotkeys')
    expect(currentNav(el)).toBe('Hotkeys')
    expect(currentKind(el)).toBe('page') // the same kind every page has
    expect(navButtons(el).filter((b) => b.getAttribute('aria-current') !== null)).toHaveLength(1)
    expect(headings(el)).toEqual(['Hotkeys'])
    expect(sections(el).map((s) => s.id)).toEqual(['settings-hotkeys'])
    // One card per key since YAZ-3564, the shared keys a pick settles first; "Used by macOS" shows once main answers.
    expect(groupTitles(el).slice(0, 2)).toEqual(['⌘D', '⌘K'])
    // Then the clicks and drags, one card per gesture (YAZ-3936): Click first, then the modified clicks, then the rest.
    const titles = groupTitles(el)
    expect(titles.slice(titles.indexOf('Actions with no key'))).toEqual(['Actions with no key', 'Clicks and drags', 'Click', '⌘-click', '⇧-click', '⌥-click', '⌘⇧-click', 'Drag', '/', '⇧↩', 'Right-click', 'Double-click', 'Clicks with no gesture'])
    expect(rowIds(el)).toEqual(HOTKEY_ROWS)
    // A changeable key is a button (D6); a built-in one is text (D8).
    expect(row(el, 'hotkey-settings')?.querySelector('.hotkeys__key')?.textContent).toBe('⌘,')
    expect(row(el, 'hotkey-closeWindow')?.querySelector('.hotkeys__key')?.textContent).toBe('No key')
    // The table of contents' ⌘J can change since YAZ-3564 (K6): a button too. A typing key stays text.
    expect(row(el, 'hotkey-page-toc')?.querySelector('.hotkeys__key')?.textContent).toBe('⌘J')
    expect(row(el, 'hotkey-page-enter')?.querySelector('button')).toBeNull()
  })

  it('a section that goes while its page shows gives way to the first, General, in the pane and in the nav: Sync with the engine gone', () => {
    const { el, onChange, onClose } = mount({ ...DEFAULT_SETTINGS }, status())
    clickNav(el, 'Sync')
    expect(currentNav(el)).toBe('Sync')
    act(() => root?.render(<SettingsDialog ctx={{ settings: { ...DEFAULT_SETTINGS }, onChange }} onClose={onClose} />))
    expect(navShape(el)).toEqual(['General', 'Appearance', 'Sidebar', 'Notifications', 'Editor', 'Tables', 'Code', 'Drawings and diagrams', 'Images', 'Files & Links', 'Folder pages', '—', 'Memory', 'Hotkeys'])
    expect(headings(el)).toEqual(['General'])
    expect(currentNav(el)).toBe('General')
    expect(navButtons(el).filter((b) => b.getAttribute('aria-current') !== null)).toHaveLength(1)
  })

  it('the pane starts at the top after a swap: a nav click puts scrollTop back to 0, to a settings page and to Hotkeys', () => {
    const { el } = mount({ ...DEFAULT_SETTINGS }, status())
    scrollTo(el, 500)
    expect(pane(el).scrollTop).toBe(500) // the stub holds what it is given, so the 0 below is the click's doing
    clickNav(el, 'Editor')
    expect(headings(el)).toEqual(['Editor'])
    expect(pane(el).scrollTop).toBe(0)
    scrollTo(el, 300)
    expect(pane(el).scrollTop).toBe(300)
    clickNav(el, 'Hotkeys')
    expect(headings(el)).toEqual(['Hotkeys'])
    expect(pane(el).scrollTop).toBe(0)
  })

  it('reopening starts at General, the first page, again — no remembered page', () => {
    for (const left of ['Appearance', 'Editor', 'Hotkeys']) {
      const { el } = mount()
      clickNav(el, left)
      expect(currentNav(el)).toBe(left)
      unmount()
      const again = mount()
      expect(currentNav(again.el)).toBe('General')
      expect(currentKind(again.el)).toBe('page')
      expect(headings(again.el)).toEqual(['General'])
      expect(rowIds(again.el)).toEqual(GENERAL_ROWS)
      unmount()
    }
  })
})

describe('Settings › Code (YAZ-3449)', () => {
  it('shows the three switches as the settings are, and each writes the whole SettingsState with only its key changed', () => {
    const { el, onChange } = mountOn('Code', { ...DEFAULT_SETTINGS })
    expect(rowIds(el)).toEqual(CODE_ROWS)
    // D5 wording here; the code tab's cog row is "Read only" under "All code files" (CodeEditor.test.tsx).
    expect(CODE_ROWS.map((id) => row(el, id)?.querySelector('.setting__label')?.textContent)).toEqual(['Open code files read only', 'Wrap long lines', 'Minimap', 'Jump across files (Cmd+click, Shift+F12)'])
    const pressed = (id: string) => rowButtons(el, id).find((b) => b.getAttribute('aria-pressed') === 'true' || b.className.includes('--active'))?.textContent
    expect(CODE_ROWS.map(pressed)).toEqual(['Off', 'On', 'Off', 'Off'])
    act(() => rowButtons(el, 'codeReadOnly')[0].click()) // On
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, codeReadOnly: true })
    act(() => rowButtons(el, 'codeWrap')[1].click()) // Off
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, codeWrap: false })
    act(() => rowButtons(el, 'codeMinimap')[0].click()) // On
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, codeMinimap: true })
  })

  it('search finds the rows by what a coder types', () => {
    const { el } = mount()
    type(searchInput(el), 'word wrap')
    expect(rowIds(el)).toContain('codeWrap')
    type(searchInput(el), 'go to definition')
    expect(rowIds(el)).toContain('codeLanguageHelpers')
  })
})

describe('Settings › Drawings (YAZ-3037; ported from Draw\'s 🔒 YAZ-1775 D9)', () => {
  const mountCanvas = () => mountOn('Drawings and diagrams', { ...DEFAULT_SETTINGS })

  it('writes the whole SettingsState with only the one canvas key changed', () => {
    const { el, onChange } = mountCanvas()
    act(() => rowButtons(el, 'canvas.gridModeEnabled')[0].click()) // On
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_SETTINGS, canvas: { ...DEFAULT_SETTINGS.canvas, gridModeEnabled: true } })
  })

  it('YAZ-4820: the embeds group: "Embeds stop moving after" (30 s by default) and "New drawings and diagrams go to" (the page`s folder); a choice writes its field', () => {
    const { el, onChange } = mountCanvas()
    const rest = rowButtons(el, 'embedRestSeconds')
    expect(rest.map((b) => b.textContent)).toEqual(['10 s', '30 s', '1 min', '5 min', 'Never'])
    expect(rest[1].getAttribute('aria-pressed')).toBe('true')
    act(() => rest[4].click())
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, embedRestSeconds: 0 })
    const folder = rowButtons(el, 'newBoardFolder')
    expect(folder.map((b) => b.textContent)).toEqual(["The page's folder", 'assets/drawings'])
    act(() => folder[1].click())
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, newBoardFolder: 'assets' })
  })

  it('Select on, sloppiness and text alignment speak their own words; Default font is a select, Assistant first and current', () => {
    const { el, onChange } = mountCanvas()
    expect(rowButtons(el, 'canvas.selectOn').map((b) => b.textContent)).toEqual(['Wrap', 'Overlap'])
    expect(rowButtons(el, 'canvas.defaultRoughness').map((b) => b.textContent)).toEqual(['Architect', 'Artist', 'Cartoonist'])
    expect(rowButtons(el, 'canvas.defaultTextAlign').map((b) => b.textContent)).toEqual(['Left', 'Center', 'Right'])
    act(() => rowButtons(el, 'canvas.selectOn')[1].click())
    expect(onChange.mock.calls[0][0].canvas.selectOn).toBe('overlap')
    const select = row(el, 'canvas.defaultFontFamily')?.querySelector('select') as HTMLSelectElement
    expect(select.options[select.selectedIndex].textContent).toBe('Assistant')
    act(() => {
      select.value = '1' // Excalifont, the second option
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onChange.mock.calls[1][0].canvas.defaultFontFamily).toBe(5)
  })

  it('a pen width commits a valid number and IGNORES anything the engine could not draw with', () => {
    const { el, onChange } = mountCanvas()
    const input = row(el, 'canvas.writingStrokeWidth')?.querySelector('input') as HTMLInputElement
    expect(input.defaultValue).toBe('0.5')
    type(input, '1.5')
    expect(onChange.mock.calls[0][0].canvas.writingStrokeWidth).toBe(1.5)
    onChange.mockClear()
    for (const bad of ['0', '-2', '', '999']) {
      type(input, bad)
      expect(onChange, bad).not.toHaveBeenCalled()
    }
  })

  it('YAZ-4404 4H and YAZ-4406 4J: "New shapes match the zoom" and "Text color follows the fill" are On · Off switches, on by default; Off writes only that key', () => {
    for (const [key, label] of [['newShapesMatchZoom', 'New shapes match the zoom'], ['fillSetsTextColor', 'Text color follows the fill']] as const) {
      const { el, onChange } = mountCanvas()
      expect(row(el, `canvas.${key}`)?.querySelector('.setting__label')?.textContent).toBe(label)
      expect(rowButtons(el, `canvas.${key}`).map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['On', 'true'], ['Off', 'false']])
      act(() => rowButtons(el, `canvas.${key}`)[1].click())
      expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_SETTINGS, canvas: { ...DEFAULT_SETTINGS.canvas, [key]: false } })
      unmount()
    }
  })

  it('YAZ-4469 4B: "Hover outline" is an On · Off switch, on by default; Off writes only `canvas.hoverOutline`; the search finds it by "highlight"', () => {
    const { el, onChange } = mountCanvas()
    expect(row(el, 'canvas.hoverOutline')?.querySelector('.setting__label')?.textContent).toBe('Hover outline')
    expect(rowButtons(el, 'canvas.hoverOutline').map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['On', 'true'], ['Off', 'false']])
    act(() => rowButtons(el, 'canvas.hoverOutline')[1].click())
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_SETTINGS, canvas: { ...DEFAULT_SETTINGS.canvas, hoverOutline: false } })
    unmount()
    const { el: all } = mount()
    type(searchInput(all), 'highlight')
    expect(rowIds(all)).toContain('canvas.hoverOutline')
  })

  it('YAZ-4404 4H and YAZ-4406 4J: the search finds each new switch by a word its label does not have', () => {
    const { el } = mount()
    for (const word of ['contrast', 'white text', 'readable']) {
      type(searchInput(el), word)
      expect(rowIds(el), word).toContain('canvas.fillSetsTextColor')
    }
    for (const word of ['arrowhead', 'corner', 'radius', 'thick']) {
      type(searchInput(el), word)
      expect(rowIds(el), word).toContain('canvas.newShapesMatchZoom')
    }
  })

  it('YAZ-4401 2E: Fold arrows has a fourth choice, "Off (no folding)", which writes `off`', () => {
    const { el, onChange } = mountCanvas()
    expect(rowButtons(el, 'canvas.foldArrowsOpen').map((b) => b.textContent)).toEqual(['On hover', 'Always', 'Off (no folding)'])
    act(() => rowButtons(el, 'canvas.foldArrowsOpen')[2].click())
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_SETTINGS, canvas: { ...DEFAULT_SETTINGS.canvas, foldArrowsOpen: 'off' } })
  })

  it('YAZ-4748 D11: Drawings and diagrams › draw.io diagrams › In dark mode writes `diagramDarkColors` (YAZ-3037)', () => {
    const { el, onChange } = mountCanvas()
    expect(rowButtons(el, 'diagramDarkColors').map((b) => b.textContent)).toEqual(['Adapt colours', 'Keep original colours'])
    act(() => rowButtons(el, 'diagramDarkColors')[1].click())
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_SETTINGS, diagramDarkColors: 'keep' })
  })

  it('YAZ-4748 D11: the page is "Drawings and diagrams" in the nav; its last group is "draw.io diagrams" with the dark-mode row, and Appearance has that row no more', () => {
    const { el } = mount()
    expect(navShape(el)).toContain('Drawings and diagrams')
    expect(navShape(el)).not.toContain('Drawings')
    clickNav(el, 'Drawings and diagrams')
    expect(headings(el)).toEqual(['Drawings and diagrams'])
    expect(groupTitles(el).at(-1)).toBe('draw.io diagrams')
    expect(rowIds(el).at(-1)).toBe('diagramDarkColors')
    expect(row(el, 'diagramDarkColors')?.closest('.settings-group')?.querySelector('.settings-group__title')?.textContent).toBe('draw.io diagrams')
    expect(row(el, 'diagramDarkColors')?.querySelector('.setting__label')?.textContent).toBe('In dark mode')
    clickNav(el, 'Appearance')
    expect(row(el, 'diagramDarkColors')).toBeNull()
    expect(groupTitles(el)).not.toContain('draw.io diagrams')
  })

  it('YAZ-4748 D11: the search finds the page by "draw.io", "drawio" and "diagram", as by "excalidraw"', () => {
    const { el } = mount()
    for (const word of ['draw.io', 'drawio', 'diagram', 'excalidraw']) {
      type(searchInput(el), word)
      expect(rowIds(el), word).toContain('diagramDarkColors')
      expect(rowIds(el), word).toContain('canvas.gridModeEnabled')
    }
  })
})

describe('SettingsDialog rows write through the popover contracts', () => {
  it('Theme: System · Light · Dark in order, current active; Dark writes the whole object with theme flipped', () => {
    const { el, onChange } = mountOn('Appearance')
    const buttons = rowButtons(el, 'theme')
    expect(buttons.map((b) => b.textContent)).toEqual(['System', 'Light', 'Dark'])
    expect(buttons.map((b) => b.classList.contains('settings__option--active'))).toEqual([true, false, false])
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false'])
    act(() => buttons[2].click())
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_SETTINGS, theme: 'dark' })
  })

  it('Line colour: Default is disabled while the thread already uses the accent, enabled once a colour is set', () => {
    const { el, onChange } = mountOn('Editor')
    const defaultButton = rowButtons(el, 'threadColor').find((b) => b.textContent === 'Default') as HTMLButtonElement
    expect(defaultButton.disabled).toBe(true)
    unmount()
    const custom = mountOn('Editor', { ...DEFAULT_SETTINGS, threadColor: '#ff0000' })
    const reset = rowButtons(custom.el, 'threadColor').find((b) => b.textContent === 'Default') as HTMLButtonElement
    expect(reset.disabled).toBe(false)
    act(() => reset.click())
    expect(custom.onChange).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_SETTINGS, threadColor: null })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('Confirm before deleting carries its hint in the row', () => {
    const { el } = mountOn('Files & Links')
    expect(row(el, 'confirmDelete')?.querySelector('.setting__hint')?.textContent).toBe('Deleted pages and folders move to the Trash either way.')
  })

  it('has no "Open a link in" row (YAZ-3936): where a link opens is a gesture of Settings › Hotkeys › "Links in a page"', () => {
    const { el } = mountOn('Files & Links')
    expect(row(el, 'linkOpen')).toBeNull()
    expect([...el.querySelectorAll('.setting__label')].map((l) => l.textContent)).not.toContain('Open a link in')
  })

  it('Ask before renaming is on by default, says what it shows, and Off writes the whole object with only it flipped (YAZ-2420 3C1)', () => {
    const { el, onChange } = mountOn('Files & Links')
    expect(row(el, 'confirmRename')?.querySelector('.setting__label')?.textContent).toBe('Ask before renaming')
    expect(row(el, 'confirmRename')?.querySelector('.setting__hint')?.textContent).toBe('Shows the confirmation, with the number of links that will be updated, before a page or folder is renamed.')
    expect(rowButtons(el, 'confirmRename').map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['On', 'true'], ['Off', 'false']])
    act(() => rowButtons(el, 'confirmRename')[1].click())
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_SETTINGS, confirmRename: false })
  })

  it('Sidebar › Level lines (YAZ-3440 D7; the level lines YAZ-3309 D6–D9): Level lines, Line style and Thread colour in one group; each choice writes the whole object with only its own field changed (the group\'s place and hint: "group titles and hints render on their own page")', () => {
    const { el, onChange } = mountOn('Sidebar')
    const group = row(el, 'sidebarLines')?.closest('.settings-group')
    expect(group?.querySelector('.settings-group__title')?.textContent).toBe('Level lines')
    expect([...(group?.querySelectorAll<HTMLElement>('.setting') ?? [])].map((r) => r.dataset.setting)).toEqual(['sidebarLines', 'sidebarLineStyle', 'sidebarThreadColor'])
    expect(['sidebarLines', 'sidebarLineStyle', 'sidebarThreadColor'].map((id) => row(el, id)?.querySelector('.setting__label')?.textContent)).toEqual(['Level lines', 'Line style', 'Thread colour'])
    // Show: the TOC's three choices, On hover by default (D3).
    expect(row(el, 'sidebarLines')?.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('Level lines in the sidebar')
    expect(rowButtons(el, 'sidebarLines').map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['On hover', 'true'], ['Always show', 'false'], ['Never', 'false']])
    // Style: Plain lines by default (D8).
    expect(rowButtons(el, 'sidebarLineStyle').map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['Plain lines', 'true'], ['Thread to the row', 'false']])
    // Thread colour (D9): the swatch shows the Bullet threading default, and "Default" has nothing to clear.
    const swatch = row(el, 'sidebarThreadColor')?.querySelector<HTMLInputElement>('input[type="color"]')
    expect(swatch?.getAttribute('aria-label')).toBe('Sidebar thread colour')
    expect(rowButtons(el, 'sidebarThreadColor').find((b) => b.textContent === 'Default')?.disabled).toBe(true)
    act(() => rowButtons(el, 'sidebarLines')[2].click())
    act(() => rowButtons(el, 'sidebarLineStyle')[1].click())
    type(swatch!, '#00aa55')
    expect(onChange.mock.calls.map((call) => call[0])).toEqual([
      { ...DEFAULT_SETTINGS, sidebarLines: 'off' },
      { ...DEFAULT_SETTINGS, sidebarLineStyle: 'thread' },
      { ...DEFAULT_SETTINGS, sidebarThreadColor: '#00aa55' },
    ])
    unmount()
    // Saved values come back; "Default" clears the colour alone; the TOC's and the editor's thread fields are their own.
    const saved = mountOn('Sidebar', { ...DEFAULT_SETTINGS, sidebarLines: 'always', sidebarLineStyle: 'thread', sidebarThreadColor: '#112233', tocLines: 'off', threadColor: '#ff0000' })
    expect(rowButtons(saved.el, 'sidebarLines').map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false'])
    expect(rowButtons(saved.el, 'sidebarLineStyle').map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true'])
    expect(row(saved.el, 'sidebarThreadColor')?.querySelector<HTMLInputElement>('input[type="color"]')?.value).toBe('#112233')
    act(() => rowButtons(saved.el, 'sidebarThreadColor').find((b) => b.textContent === 'Default')?.click())
    expect(saved.onChange).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_SETTINGS, sidebarLines: 'always', sidebarLineStyle: 'thread', sidebarThreadColor: null, tocLines: 'off', threadColor: '#ff0000' })
    unmount()
    // With no colour of its own, the swatch shows the editor's thread colour, which the thread then uses.
    expect(row(mountOn('Sidebar', { ...DEFAULT_SETTINGS, threadColor: '#ff0000' }).el, 'sidebarThreadColor')?.querySelector<HTMLInputElement>('input[type="color"]')?.value).toBe('#ff0000')
  })

  it('Section indent: two rows under Editor, in the last group of the page, after Bullet threading; each writes the whole object with only its field changed (YAZ-2709)', () => {
    const { el, onChange } = mountOn('Editor')
    const rows = ['sectionStep', 'sectionLines']
    const groupOf = (id: string) => row(el, id)?.closest('.settings-group')
    for (const id of rows) expect(row(el, id)?.closest('[data-section]')?.id).toBe('settings-editor')
    // The group is the last of the page, and holds those two rows and no other.
    expect(groupTitles(el)).toEqual(EDITOR_GROUPS)
    expect(rows.map((id) => groupOf(id)?.querySelector('.settings-group__title')?.textContent)).toEqual(['Section indent', 'Section indent'])
    expect([...(groupOf('sectionStep')?.querySelectorAll<HTMLElement>('.setting') ?? [])].map((r) => r.dataset.setting)).toEqual(rows)
    expect(groupOf('sectionStep')?.querySelector('.settings-group__hint')?.textContent).toBe(SECTION_INDENT_HINT)
    expect(rows.map((id) => row(el, id)?.querySelector('.setting__label')?.textContent)).toEqual(['Step width', 'Grey lines'])
    expect(rowButtons(el, 'sectionStep').map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['24px', 'false'], ['30px', 'true'], ['36px', 'false']])
    expect(rowButtons(el, 'sectionLines').map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['Always show', 'true'], ['Only near the mouse', 'false']])
    act(() => rowButtons(el, 'sectionStep')[2].click())
    act(() => rowButtons(el, 'sectionLines')[1].click())
    expect(onChange.mock.calls.map((call) => call[0])).toEqual([
      { ...DEFAULT_SETTINGS, sectionStep: 36 },
      { ...DEFAULT_SETTINGS, sectionLines: 'hover' },
    ])
  })

  it('Outline: the first group of the Editor page, four rows (and the bullet spacing, the YAZ-3818 demo); each writes the whole object with only its field changed; the darkness presets set the stepper, the stepper steps by 5 inside 5–100, and Reset shows only off the default (YAZ-4094 D2, F1, G2, G3)', () => {
    const { el, onChange } = mountOn('Editor')
    const rows = ['guideLinesOnByDefault', 'guideLinesShow', 'guideLineDarkness', 'foldingOnByDefault']
    const groupOf = (id: string) => row(el, id)?.closest('.settings-group')
    expect([...(groupOf('guideLinesOnByDefault')?.querySelectorAll<HTMLElement>('.setting') ?? [])].map((r) => r.dataset.setting)).toEqual([...rows, 'pageBulletIndent', 'pageBulletGap'])
    expect(groupOf('guideLinesOnByDefault')?.querySelector('.settings-group__title')?.textContent).toBe('Outline')
    expect(groupOf('guideLinesOnByDefault')?.querySelector('.settings-group__hint')?.textContent).toBe(OUTLINE_HINT)
    expect(rows.map((id) => row(el, id)?.querySelector('.setting__label')?.textContent)).toEqual(['Guide lines default', 'Guide lines show', 'Guide line darkness', 'Folding default'])
    expect(rowButtons(el, 'guideLinesShow').map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['Always show', 'true'], ['Only near the mouse', 'false']])
    // Light is 15, the default: it is selected, and there is no Reset.
    expect(rowButtons(el, 'guideLineDarkness').map((b) => b.textContent)).toEqual(['Light', 'Medium', 'Strong', '−', '+'])
    expect(rowButtons(el, 'guideLineDarkness')[0].getAttribute('aria-pressed')).toBe('true')
    expect(row(el, 'guideLineDarkness')?.querySelector('.heading-styles__size')?.textContent).toBe('15%')
    act(() => rowButtons(el, 'guideLinesOnByDefault')[1].click())
    act(() => rowButtons(el, 'guideLinesShow')[1].click())
    act(() => rowButtons(el, 'guideLineDarkness')[2].click())
    act(() => rowButtons(el, 'guideLineDarkness')[4].click())
    act(() => rowButtons(el, 'foldingOnByDefault')[1].click())
    expect(onChange.mock.calls.map((call) => call[0])).toEqual([
      { ...DEFAULT_SETTINGS, guideLinesOnByDefault: false },
      { ...DEFAULT_SETTINGS, guideLinesShow: 'near' },
      { ...DEFAULT_SETTINGS, guideLineDarkness: 35 },
      { ...DEFAULT_SETTINGS, guideLineDarkness: 20 },
      { ...DEFAULT_SETTINGS, foldingOnByDefault: false },
    ])
  })

  it('"Bullet threading default": Off by default, in the look of "Guide lines default" (On, Off), and On writes the whole object with only `bulletThreading` changed (YAZ-4432)', () => {
    expect(DEFAULT_SETTINGS.bulletThreading).toBe(false)
    const { el, onChange } = mountOn('Editor')
    expect(row(el, 'bulletThreading')?.querySelector('.setting__hint')?.textContent).toBe('Off: a page can still turn it on in its cog.')
    expect(rowButtons(el, 'bulletThreading').map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['On', 'false'], ['Off', 'true']])
    act(() => rowButtons(el, 'bulletThreading')[0].click())
    expect(onChange.mock.calls.map((call) => call[0])).toEqual([{ ...DEFAULT_SETTINGS, bulletThreading: true }])
  })

  it('Guide line darkness off a preset: no preset is selected, the stepper stops at the ends, and Reset writes the default (YAZ-4094 G3)', () => {
    for (const [value, minusOff, plusOff] of [[40, false, false], [5, true, false], [100, false, true]] as const) {
      const { el, onChange } = mountOn('Editor', { ...DEFAULT_SETTINGS, guideLineDarkness: value })
      const buttons = rowButtons(el, 'guideLineDarkness')
      expect(buttons.slice(0, 3).map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false'])
      expect([buttons[3].disabled, buttons[4].disabled]).toEqual([minusOff, plusOff])
      expect(buttons[5]?.textContent).toBe('Reset')
      act(() => buttons[5].click())
      expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, guideLineDarkness: 15 })
      act(() => root?.unmount())
      el.remove()
    }
  })

  it('"Glow" under "Outside changes", the last group of the Editor page: four choices, Until I check it by default; a pick writes the whole object with only its field changed (YAZ-3704 D5)', () => {
    const { el, onChange } = mountOn('Editor')
    const group = row(el, 'outsideChangeGlow')?.closest('.settings-group')
    expect(group?.querySelector('.settings-group__title')?.textContent).toBe('Outside changes')
    expect(group?.querySelector('.settings-group__hint')?.textContent).toBe(OUTSIDE_CHANGES_HINT)
    expect(row(el, 'outsideChangeGlow')?.querySelector('.setting__label')?.textContent).toBe('Glow')
    // The YAZ-4272 demo: 1 minute, 5 minutes, Until I check it, Off (10 seconds went: too quick to read).
    expect(rowButtons(el, 'outsideChangeGlow').map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([
      ['1 minute', 'false'],
      ['5 minutes', 'false'],
      ['Until I check it', 'true'],
      ['Off', 'false'],
    ])
    act(() => rowButtons(el, 'outsideChangeGlow')[1].click())
    act(() => rowButtons(el, 'outsideChangeGlow')[3].click())
    expect(onChange.mock.calls.map((call) => call[0])).toEqual([
      { ...DEFAULT_SETTINGS, outsideChangeGlow: '5m' },
      { ...DEFAULT_SETTINGS, outsideChangeGlow: 'off' },
    ])
  })

  // The table rows have their own page since YAZ-4775: Settings › Tables, after Editor, each with its key.
  it('"Tables" (YAZ-4162 D6, D14): "Mark the current time" Line · Tint · Both, Line by default; "Dim past rows" Off · Grey text · Grey text and shade, the shade by default; each writes only its own field', () => {
    const { el, onChange } = mountOn('Tables')
    expect(row(el, 'tableNowMark')?.closest('.settings-group')?.querySelector('.settings-group__title')?.textContent).toBe('Calendar tables')
    expect(row(el, 'tableNowMark')?.querySelector('.setting__label')?.textContent).toBe('Mark the current time')
    expect(rowButtons(el, 'tableNowMark').map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['Line', 'true'], ['Tint', 'false'], ['Both', 'false']])
    expect(rowButtons(el, 'tableDimPast').map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['Off', 'false'], ['Grey text', 'false'], ['Grey text and shade', 'true']])
    act(() => rowButtons(el, 'tableNowMark')[2].click())
    act(() => rowButtons(el, 'tableDimPast')[1].click())
    expect(onChange.mock.calls.map((call) => call[0])).toEqual([
      { ...DEFAULT_SETTINGS, tableNowMark: 'both' },
      { ...DEFAULT_SETTINGS, tableDimPast: 'text' },
    ])
  })

  it('"Tables" › Calendar day (YAZ-4163 demo): "from" and "to" in 30 minute steps, 5:00 am to 10:00 pm by default; "to" lists only times after "from"', () => {
    const { el, onChange } = mountOn('Tables')
    expect(row(el, 'tableCalendarDay')?.querySelector('.setting__label')?.textContent).toBe('Calendar day')
    const [from, to] = Array.from(row(el, 'tableCalendarDay')!.querySelectorAll('select'))
    const label = (select: HTMLSelectElement) => select.options[select.selectedIndex].textContent
    expect([label(from), label(to)]).toEqual(['5:00 am', '10:00 pm'])
    expect(from.options[0].textContent).toBe('12:00 am')
    expect(to.options[0].textContent).toBe('5:30 am')
    act(() => {
      from.value = String(Array.from(from.options).findIndex((o) => o.textContent === '6:00 am'))
      from.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onChange.mock.calls.map((call) => call[0])).toEqual([{ ...DEFAULT_SETTINGS, tableDayStart: 360 }])
  })

  it('"Tables" › Row band (YAZ-4167 D16): the group\'s first row, Off · Calendar tables · All tables, All tables by default; it writes only its own field', () => {
    const { el, onChange } = mountOn('Tables')
    const group = row(el, 'tableRowBand')?.closest('.settings-group')
    // "All tables" since YAZ-4775 (on the Tables page a second "Tables" read as "Tables › Tables"); Header row (YAZ-4774)
    // and Width (YAZ-4783) stand before Row band now, and New tables start as (YAZ-4869 item 22).
    expect(group?.querySelector('.settings-group__title')?.textContent).toBe('All tables')
    expect([...group!.querySelectorAll<HTMLElement>('.setting')].map((r) => r.dataset.setting).slice(0, 7)).toEqual(['tableHeaderRow', 'tableSubheaderRow', 'tableStickyHeader', 'tableStickySubheaders', 'tableWidth', 'tablePosition', 'tableTextInCells'])
    expect(row(el, 'tableRowBand')?.querySelector('.setting__label')?.textContent).toBe('Row band')
    expect(rowButtons(el, 'tableRowBand').map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['Off', 'false'], ['Calendar tables', 'false'], ['All tables', 'true']])
    act(() => rowButtons(el, 'tableRowBand')[1].click())
    expect(onChange.mock.calls.map((call) => call[0])).toEqual([{ ...DEFAULT_SETTINGS, tableRowBand: 'calendar' }])
  })

  it('YAZ-5136 round 2: Table position is Left (the look before) or Centre, under Width; an app setting', () => {
    const { el, onChange } = mountOn('Tables')
    expect(row(el, 'tablePosition')?.querySelector('.setting__label')?.textContent).toBe('Table position')
    expect(rowButtons(el, 'tablePosition').map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['Left', 'true'], ['Centre', 'false']])
    act(() => rowButtons(el, 'tablePosition')[1].click())
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, tablePosition: 'center' })
  })

  it('Calendar tables › Now button (YAZ-4163 demo): On by default; Off writes only its own field', () => {
    const { el, onChange } = mountOn('Tables')
    expect(row(el, 'tableNowButton')?.querySelector('.setting__label')?.textContent).toBe('Now button')
    expect(rowButtons(el, 'tableNowButton').map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['On', 'true'], ['Off', 'false']])
    act(() => rowButtons(el, 'tableNowButton')[1].click())
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, tableNowButton: false })
  })

  it('Calendar tables › Shade darkness (YAZ-4163 demo): 6% by default, a stepper in steps of 2 from 2% to 30%, and Reset off the default', () => {
    const { el, onChange } = mountOn('Tables')
    expect(row(el, 'tableShadeDarkness')?.querySelector('.setting__label')?.textContent).toBe('Shade darkness')
    expect(row(el, 'tableShadeDarkness')?.textContent).toContain('6%')
    const plus = row(el, 'tableShadeDarkness')!.querySelector<HTMLButtonElement>('button[aria-label="Shade darkness larger"]')!
    act(() => plus.click())
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, tableShadeDarkness: 8 })
  })

  it('Tables › Band strength (the YAZ-3818 demo): a % you type, kept on ⏎ and clamped to 1–60; − and + step by 1', () => {
    const { el, onChange } = mountOn('Tables')
    const input = row(el, 'tableBandStrength')!.querySelector<HTMLInputElement>('input[aria-label="Band strength"]')!
    expect(input.value).toBe('10')
    const set = (text: string) => {
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      act(() => void input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    }
    set('23')
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, tableBandStrength: 23 })
    set('99')
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, tableBandStrength: 60 })
    act(() => row(el, 'tableBandStrength')!.querySelector<HTMLButtonElement>('button[aria-label="Band strength larger"]')!.click())
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, tableBandStrength: 11 })
  })

  it('Calendar tables › Shade darkness shows only with "Grey text and shade", on the page and in a search (YAZ-4176)', () => {
    for (const tableDimPast of ['off', 'text'] as const) {
      const { el } = mountOn('Tables', { ...DEFAULT_SETTINGS, tableDimPast })
      expect(row(el, 'tableDimPast')).not.toBeNull()
      expect(row(el, 'tableShadeDarkness')).toBeNull()
      type(searchInput(el), 'shade darkness')
      expect(rowIds(el)).not.toContain('tableShadeDarkness')
    }
    const { el } = mountOn('Tables', { ...DEFAULT_SETTINGS, tableDimPast: 'shade' })
    expect(row(el, 'tableShadeDarkness')).not.toBeNull()
  })

  it('Calendar tables › Time format (YAZ-4163 D15, demo): the ready styles as 9:00 am, 9:00am, 9am / 9:30am, 09:00 and Custom…; Custom… previews the draft; a style the app cannot read back keeps the stored one and says why; a good one is written', () => {
    const { el, onChange } = mountOn('Tables')
    const select = row(el, 'tableTimeFormat')?.querySelector<HTMLSelectElement>('select') as HTMLSelectElement
    expect([...select.options].map((o) => o.textContent)).toEqual(['9:00 am', '9:00am', '9am / 9:30am', '09:00', 'Custom…'])
    expect(select.selectedIndex).toBe(0)
    act(() => {
      select.value = '1'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, tableTimeFormat: 'h:mma' })
    act(() => {
      select.value = '4' // Custom…
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const input = row(el, 'tableTimeFormat')?.querySelector<HTMLInputElement>('.settings__style-pick input') as HTMLInputElement
    type(input, 'h(mm)a')
    expect(row(el, 'tableTimeFormat')?.querySelector('.settings__preview')?.textContent).toBe('Preview: 9am · 930am · 12pm · 905pm')
    type(input, 'h:mm')
    act(() => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
    expect(row(el, 'tableTimeFormat')?.querySelector('.settings__error')?.textContent).toBe('With h or hh, add a or A for am and pm')
    type(input, 'hh:mm A')
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, tableTimeFormat: 'hh:mm A' })
  })

  it('"Pin default" after "Glow" (YAZ-3704 demo, 4J): Off by default, as the table of contents\' pin; On writes only its own field; Glow says Off turns off the whole feature', () => {
    const { el, onChange } = mountOn('Editor')
    expect(row(el, 'outsideChangeGlow')?.textContent).toContain('Off turns off this whole feature: no glow, no list, no bar.')
    expect(row(el, 'outsideListPinned')?.querySelector('.setting__label')?.textContent).toBe('Pin default')
    expect(rowButtons(el, 'outsideListPinned').map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([
      ['On', 'false'],
      ['Off', 'true'],
    ])
    act(() => rowButtons(el, 'outsideListPinned')[0].click())
    expect(onChange.mock.calls.map((call) => call[0])).toEqual([{ ...DEFAULT_SETTINGS, outsideListPinned: true }])
  })

  it('"Table of contents default" (On · Off, with its hint) then "Pin default" (On · Off) under "Table of contents" on the Editor page, after Section indent; each writes the whole object with only its own field flipped (YAZ-2700; YAZ-3558 D2, D2a, D2b, D3, S15–S17)', () => {
    const { el, onChange } = mountOn('Editor')
    expect(row(el, 'tableOfContents')?.closest('[data-section]')?.id).toBe('settings-editor')
    const group = row(el, 'tableOfContents')?.closest('.settings-group')
    expect(group?.querySelector('.settings-group__title')?.textContent).toBe('Table of contents')
    expect(group?.querySelector('.settings-group__hint')?.textContent).toBe(TOC_HINT)
    expect([...el.querySelectorAll('#settings-editor .settings-group__title')].map((t) => t.textContent)).toEqual(EDITOR_GROUPS)
    expect(row(el, 'tocOnByDefault')?.querySelector('.setting__label')?.textContent).toBe('Table of contents default')
    expect(row(el, 'tocOnByDefault')?.textContent).toContain('Off: a page can still turn it on in its cog.')
    expect(rowButtons(el, 'tocOnByDefault').map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['On', 'true'], ['Off', 'false']])
    expect(row(el, 'tableOfContents')?.querySelector('.setting__label')?.textContent).toBe('Pin default')
    expect(rowButtons(el, 'tableOfContents').map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['On', 'false'], ['Off', 'true']])
    act(() => rowButtons(el, 'tableOfContents')[0].click())
    act(() => rowButtons(el, 'tocOnByDefault')[1].click())
    expect(onChange.mock.calls.map((call) => call[0])).toEqual([
      { ...DEFAULT_SETTINGS, tableOfContents: 'pinned' },
      { ...DEFAULT_SETTINGS, tocOnByDefault: false },
    ])
    unmount()
    // D2b: with the default Off, "Pin default" is still there.
    const off = mountOn('Editor', { ...DEFAULT_SETTINGS, tocOnByDefault: false })
    expect(rowButtons(off.el, 'tocOnByDefault').map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true'])
    expect(row(off.el, 'tableOfContents')).not.toBeNull()
  })

  it('Level lines: On hover · Always show · Never, the last row of "Table of contents", On hover by default; each choice writes the whole object with only `tocLines` changed, and the row shows the saved one (YAZ-2762 D5)', () => {
    const { el, onChange } = mountOn('Editor')
    const group = row(el, 'tocLines')?.closest('.settings-group')
    expect(group?.querySelector('.settings-group__title')?.textContent).toBe('Table of contents')
    // Below "Pin default", and the group holds those three rows and no other.
    expect([...(group?.querySelectorAll<HTMLElement>('.setting') ?? [])].map((r) => r.dataset.setting)).toEqual(['tocOnByDefault', 'tableOfContents', 'tocLines'])
    expect(row(el, 'tocLines')?.querySelector('.setting__label')?.textContent).toBe('Level lines')
    expect(row(el, 'tocLines')?.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('Level lines')
    expect(rowButtons(el, 'tocLines').map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['On hover', 'true'], ['Always show', 'false'], ['Never', 'false']])
    act(() => rowButtons(el, 'tocLines')[1].click())
    act(() => rowButtons(el, 'tocLines')[2].click())
    expect(onChange.mock.calls.map((call) => call[0])).toEqual([
      { ...DEFAULT_SETTINGS, tocLines: 'always' },
      { ...DEFAULT_SETTINGS, tocLines: 'off' },
    ])
    // The row beside it is a field of its own: it did not move.
    expect(rowButtons(el, 'tableOfContents').map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true'])
    unmount()
    // A saved "Never" comes back pressed.
    const saved = mountOn('Editor', { ...DEFAULT_SETTINGS, tocLines: 'off' })
    expect(rowButtons(saved.el, 'tocLines').map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true'])
  })

  describe('Text formatting (YAZ-3068; D14, D15, D16 on YAZ-3048; the heading lines YAZ-3050 D6)', () => {
    const vaultOf = (root: string, name: string, formatting: TextFormatting = {}) => ({ root, name, state: { formatting, save: vi.fn() } })
    type Vault = ReturnType<typeof vaultOf>
    /** The dialog in a window with these vaults, on the Appearance page; `active` is the active tab's vault. `rerender` hands over the vaults as App would after a change. */
    const mountTf = (vaults: Vault[], active = vaults[0].root) => {
      const onChange = vi.fn()
      container = document.createElement('div')
      document.body.appendChild(container)
      root = createRoot(container)
      const render = (list: Vault[]) => act(() => root?.render(<SettingsDialog ctx={{ settings: { ...DEFAULT_SETTINGS }, onChange, textFormatting: { vaults: list, activeRoot: active } }} onClose={() => undefined} />))
      render(vaults)
      clickNav(container, 'Appearance')
      return { el: container, onChange, rerender: render }
    }
    const tf = (el: HTMLElement) => row(el, 'textFormatting') as HTMLElement
    const line = (el: HTMLElement, level: string) => tf(el).querySelector<HTMLElement>(`:is(.heading-styles__line, .line-defaults)[data-level="${level}"]`) as HTMLElement
    const button = (el: HTMLElement, level: string, name: string) => line(el, level).querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`) as HTMLButtonElement
    const sizes = (el: HTMLElement) => [...tf(el).querySelectorAll<HTMLElement>('.heading-styles__line')].map((l) => [l.dataset.level, l.querySelector('.heading-styles__size')?.textContent])
    const dots = (el: HTMLElement, level: string) => [...line(el, level).querySelectorAll<HTMLButtonElement>(`[role="group"][aria-label="Heading ${level.slice(1)} highlight"] button`)]
    const resets = (el: HTMLElement) => [...tf(el).querySelectorAll<HTMLButtonElement>('button')].filter((b) => b.textContent === 'Reset').map((b) => b.getAttribute('aria-label'))
    const picker = (el: HTMLElement) => tf(el).querySelector<HTMLSelectElement>('select[aria-label="Vault"]')
    const pick = (el: HTMLElement, index: number) =>
      act(() => {
        const select = picker(el) as HTMLSelectElement
        select.value = String(index)
        select.dispatchEvent(new Event('change', { bubbles: true }))
      })
    const saved = (vault: Vault) => vault.state.save.mock.calls.map((call) => call[0] as TextFormatting)

    it('YAZ-3208 D10, S96, S97: the Line line — darkness in steps of 5 (5–100), thickness in steps of 1 (1–24), the style, and Reset; a field back at the app default leaves the file', () => {
      const plain = vaultOf('/pages', 'Pages')
      const { el, rerender } = mountTf([plain])
      const lineRow = line(el, 'line')
      // YAZ-3213: its own row under the grid, never a line of it, so the seven names keep their column.
      expect(lineRow.closest('.heading-styles')).toBeNull()
      expect(lineRow.querySelector('.heading-styles__name')?.textContent).toBe('Line')
      expect([...lineRow.querySelectorAll('.heading-styles__size')].map((x) => x.textContent)).toEqual(['50%', '3 px'])
      expect([...lineRow.querySelectorAll('[aria-label="Line style"] button')].map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['Solid', 'true'], ['Dotted', 'false'], ['Dashed', 'false']])
      expect(resets(el)).toEqual([])
      act(() => button(el, 'line', 'Line darkness larger').click())
      act(() => button(el, 'line', 'Line thickness smaller').click())
      act(() => (lineRow.querySelector('[aria-label="Line style"] button:nth-child(3)') as HTMLButtonElement).click())
      expect(saved(plain)).toEqual([{ line: { darkness: 55 } }, { line: { thickness: 2 } }, { line: { pattern: 'dashed' } }])
      // The limits (S96), and a hand-written darkness off the grid steps onto it.
      const edge = vaultOf('/pages', 'Pages', { text: { size: 18 }, line: { darkness: 100, thickness: 24, pattern: 'dotted' } })
      rerender([edge])
      expect(button(el, 'line', 'Line darkness larger').disabled).toBe(true)
      expect(button(el, 'line', 'Line thickness larger').disabled).toBe(true)
      expect(resets(el)).toEqual(['Reset text', 'Reset line'])
      act(() => (line(el, 'line').querySelector('[aria-label="Line style"] button') as HTMLButtonElement).click())
      act(() => button(el, 'line', 'Reset line').click())
      expect(saved(edge)).toEqual([{ text: { size: 18 }, line: { darkness: 100, thickness: 24 } }, { text: { size: 18 } }])
      const low = vaultOf('/pages', 'Pages', { line: { darkness: 52, thickness: 1 } })
      rerender([low])
      expect(button(el, 'line', 'Line thickness smaller').disabled).toBe(true)
      act(() => button(el, 'line', 'Line darkness smaller').click())
      act(() => button(el, 'line', 'Line darkness larger').click())
      // 52 steps onto the grid: down to 50 (the app default, so it leaves the key), up to 55.
      expect(saved(low)).toEqual([{ line: { thickness: 1 } }, { line: { darkness: 55, thickness: 1 } }])
      // Back at the app default (50%, 3px, solid), the key goes (S97).
      const one = vaultOf('/pages', 'Pages', { line: { darkness: 55 } })
      rerender([one])
      act(() => button(el, 'line', 'Line darkness smaller').click())
      expect(saved(one)).toEqual([{}])
    })

    it('YAZ-3208 S99: the preview draws the default line: its darkness and thickness, and the pattern class', () => {
      const { el } = mountTf([vaultOf('/pages', 'Pages', { line: { darkness: 70, thickness: 4, pattern: 'dashed' } })])
      const preview = line(el, 'line').querySelector<HTMLElement>('.heading-styles__line-preview') as HTMLElement
      expect(preview.style.getPropertyValue('--preview-darkness')).toBe('70%')
      expect(preview.style.getPropertyValue('--preview-thickness')).toBe('4px')
      expect(preview.classList.contains('heading-styles__line-preview--dashed')).toBe(true)
    })

    it('one vault: the group "Text formatting" after Spacing, its hint, one bare row (no label on screen, no gap) and no dropdown; a Text line, then H1 to H6 at their rounded default sizes', () => {
      const { el } = mountTf([vaultOf('/pages', 'Pages')])
      expect(groupTitles(el)).toEqual(['Spacing', 'Text formatting', 'Comments'])
      const group = tf(el).closest('.settings-group') as HTMLElement
      expect(group.querySelector('.settings-group__hint')?.textContent).toBe(TEXT_FORMATTING_HINT)
      // No "Vault: name" line: the dropdown replaces it (D15), and with one vault there is none.
      expect(group.querySelectorAll('.settings-group__hint')).toHaveLength(1)
      expect([...group.querySelectorAll<HTMLElement>('.setting')].map((r) => r.dataset.setting)).toEqual(['textFormatting'])
      // The bare row (D16): the control alone, the label only for a screen reader.
      expect(tf(el).classList.contains('setting--bare')).toBe(true)
      expect(tf(el).querySelector('.setting__text, .setting__label')).toBeNull()
      expect([tf(el).getAttribute('role'), tf(el).getAttribute('aria-label')]).toEqual(['group', 'Text formatting'])
      expect(picker(el)).toBeNull()
      expect(sizes(el)).toEqual([
        ['text', '16 px'],
        ['h1', '29 px'],
        ['h2', '26 px'],
        ['h3', '23 px'],
        ['h4', '20 px'],
        ['h5', '18 px'],
        ['h6', '16 px'],
      ])
      expect(line(el, 'text').querySelector('.heading-styles__name')?.textContent).toBe('Text')
      // The Text line is size only (D14): "−" and "+", no B, U or dots.
      expect([...line(el, 'text').querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toEqual(['Text smaller', 'Text larger'])
      expect(resets(el)).toEqual([])
      // The heading lines as in 1.0.15: the name in its level's look, B on, U off, the "none" dot.
      const name = (level: string) => line(el, level).querySelector<HTMLElement>('.heading-styles__name')?.style
      expect([name('h1')?.fontWeight, name('h2')?.fontWeight, name('h1')?.textDecoration, name('h2')?.backgroundColor]).toEqual(['700', '600', 'none', ''])
      expect([button(el, 'h2', 'Heading 2 bold').getAttribute('aria-pressed'), button(el, 'h2', 'Heading 2 underline').getAttribute('aria-pressed')]).toEqual(['true', 'false'])
      expect(dots(el, 'h2').map((d) => [d.getAttribute('aria-label'), d.getAttribute('aria-pressed')])).toEqual([
        ['No highlight', 'true'],
        ['Yellow', 'false'],
        ['Green', 'false'],
        ['Blue', 'false'],
        ['Pink', 'false'],
      ])
    })

    it('the Text line: steps of 1px from 16, stops at 12 and 24, "Reset" only when it is not 16; back at 16 the key goes; the headings with no size follow it (D14, D17)', () => {
      const plain = vaultOf('/pages', 'Pages')
      const { el, rerender } = mountTf([plain])
      act(() => button(el, 'text', 'Text larger').click())
      act(() => button(el, 'text', 'Text smaller').click())
      expect(saved(plain)).toEqual([{ text: { size: 17 } }, { text: { size: 15 } }])
      // Text 18: the headings with no size grow with it, an H2 the reader set stays (D17's example).
      const big = vaultOf('/pages', 'Pages', { text: { size: 18 }, h3: { size: 21 } })
      rerender([big])
      expect(sizes(el)).toEqual([
        ['text', '18 px'],
        ['h1', '32 px'],
        ['h2', '29 px'],
        ['h3', '21 px'],
        ['h4', '23 px'],
        ['h5', '20 px'],
        ['h6', '18 px'],
      ])
      expect(resets(el)).toEqual(['Reset text', 'Reset heading 3'])
      // The first "+" of a heading with no size starts from the number it shows.
      act(() => button(el, 'h2', 'Heading 2 larger').click())
      act(() => button(el, 'text', 'Reset text').click())
      expect(saved(big)).toEqual([{ text: { size: 18 }, h2: { size: 30 }, h3: { size: 21 } }, { h3: { size: 21 } }])
      // A step back to 16 is the app's look: the key goes, as with Reset.
      const near = vaultOf('/pages', 'Pages', { text: { size: 17 }, h2: { underline: true } })
      rerender([near])
      act(() => button(el, 'text', 'Text smaller').click())
      expect(saved(near)).toEqual([{ h2: { underline: true } }])
      // The edges.
      rerender([vaultOf('/pages', 'Pages', { text: { size: 24 } })])
      expect([button(el, 'text', 'Text larger').disabled, button(el, 'text', 'Text smaller').disabled]).toEqual([true, false])
      rerender([vaultOf('/pages', 'Pages', { text: { size: 12 } })])
      expect([button(el, 'text', 'Text larger').disabled, button(el, 'text', 'Text smaller').disabled]).toEqual([false, true])
    })

    it('the heading lines write only that level and field: "+"/"−" stop at 12 and 48, B and U are switches, a dot sets the highlight, "Reset" removes the level; the Text size stays', () => {
      const vault = vaultOf('/pages', 'Pages', { text: { size: 17 }, h1: { size: 48 }, h6: { size: 12 }, h5: { underline: true } })
      const { el } = mountTf([vault])
      expect([button(el, 'h1', 'Heading 1 larger').disabled, button(el, 'h6', 'Heading 6 smaller').disabled]).toEqual([true, true])
      act(() => button(el, 'h1', 'Heading 1 smaller').click())
      act(() => button(el, 'h3', 'Heading 3 bold').click())
      act(() => button(el, 'h3', 'Heading 3 underline').click())
      act(() => dots(el, 'h4')[3].click())
      act(() => button(el, 'h5', 'Reset heading 5').click())
      const base = { text: { size: 17 }, h1: { size: 48 }, h6: { size: 12 }, h5: { underline: true } }
      expect(saved(vault)).toEqual([
        { ...base, h1: { size: 47 } },
        { ...base, h3: { bold: false } },
        { ...base, h3: { underline: true } },
        { ...base, h4: { highlight: 'blue' } },
        { text: { size: 17 }, h1: { size: 48 }, h6: { size: 12 } },
      ])
    })

    it('two vaults: a "Vault" dropdown above the lines, in the window\'s order, that starts on the active tab\'s vault; switching shows the other vault\'s values, and a change saves only the chosen vault', () => {
      const pages = vaultOf('/pages', 'Pages', { h2: { size: 21 } })
      const work = vaultOf('/work', 'work', { text: { size: 18 } })
      const { el } = mountTf([pages, work], '/work')
      const select = picker(el) as HTMLSelectElement
      expect([...select.options].map((o) => o.textContent)).toEqual(['Pages', 'work'])
      // Above the lines, directly under the hint.
      expect(tf(el).querySelector(':scope > .text-formatting > :first-child')?.classList.contains('text-formatting__vault')).toBe(true)
      expect(select.value).toBe('1')
      expect(sizes(el).slice(0, 3)).toEqual([
        ['text', '18 px'],
        ['h1', '32 px'],
        ['h2', '29 px'],
      ])
      act(() => button(el, 'text', 'Text larger').click())
      expect(saved(work)).toEqual([{ text: { size: 19 } }])
      pick(el, 0)
      expect(sizes(el).slice(0, 3)).toEqual([
        ['text', '16 px'],
        ['h1', '29 px'],
        ['h2', '21 px'],
      ])
      act(() => button(el, 'h2', 'Heading 2 larger').click())
      expect(saved(pages)).toEqual([{ h2: { size: 22 } }])
      expect(saved(work)).toHaveLength(1)
    })

    it('the chosen vault leaves the window while Settings is open: the dropdown falls back to the first vault; with one vault left it goes', () => {
      const [a, b, c] = [vaultOf('/a', 'A'), vaultOf('/b', 'B', { text: { size: 20 } }), vaultOf('/c', 'C', { text: { size: 13 } })]
      const { el, rerender } = mountTf([a, b, c], '/b')
      expect(picker(el)?.value).toBe('1')
      rerender([c, a])
      expect(picker(el)?.value).toBe('0')
      expect(sizes(el)[0]).toEqual(['text', '13 px'])
      rerender([a])
      expect(picker(el)).toBeNull()
      expect(sizes(el)[0]).toEqual(['text', '16 px'])
    })

    it('a window with no vault (the Welcome window) has no group, and search does not find it', () => {
      const { el } = mountOn('Appearance')
      expect(groupTitles(el)).not.toContain('Text formatting')
      expect(row(el, 'textFormatting')).toBeNull()
      type(searchInput(el), 'headings')
      expect(rowIds(el)).not.toContain('textFormatting')
    })

    it('search finds the row by its words, under its breadcrumb: "text", "headings", "vault", "h2", "underline", "highlight", "size"', () => {
      const { el } = mountTf([vaultOf('/pages', 'Pages')])
      for (const query of ['text', 'headings', 'vault', 'h2', 'underline', 'highlight', 'size', 'text formatting']) {
        type(searchInput(el), query)
        expect(rowIds(el), query).toContain('textFormatting')
        expect(headings(el), query).toContain('Appearance › Text formatting')
      }
    })
  })

  it('Open on (YAZ-3487 D15): "A blank tab" · "Its last page" under General › "When a vault opens", blank by default; a click writes the whole object with only it flipped', () => {
    const { el, onChange } = mount()
    expect(row(el, 'vaultOpensOn')?.closest('.settings-group')?.querySelector('.settings-group__title')?.textContent).toBe('When a vault opens')
    expect(row(el, 'vaultOpensOn')?.querySelector('.setting__label')?.textContent).toBe('Open on')
    expect(rowButtons(el, 'vaultOpensOn').map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['A blank tab', 'true'], ['Its last page', 'false']])
    act(() => rowButtons(el, 'vaultOpensOn')[1].click())
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_SETTINGS, vaultOpensOn: 'last' })
  })

  it('Reopen: All vaults · Last vault · None under General › "When the app starts", Last vault by default; None writes the whole object with only it flipped (YAZ-2589 D2, A3; moved by YAZ-3276 D7)', () => {
    const { el, onChange } = mountOn('General')
    expect(row(el, 'startupWindows')?.closest('[data-section]')?.id).toBe('settings-general')
    expect(row(el, 'startupWindows')?.closest('.settings-group')?.querySelector('.settings-group__title')?.textContent).toBe('When the app starts')
    expect(row(el, 'startupWindows')?.querySelector('.setting__label')?.textContent).toBe('Reopen')
    expect(row(el, 'startupWindows')?.querySelector('.setting__hint')?.textContent).toBe('A vault that you open from a link or a launcher always opens alone.')
    expect(rowButtons(el, 'startupWindows').map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['All vaults', 'false'], ['Last vault', 'true'], ['None', 'false']])
    act(() => rowButtons(el, 'startupWindows')[2].click())
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_SETTINGS, startupWindows: 'none' })
  })

  it('Default location: a dropdown of the three Obsidian options, writing the whole object with only the location flipped; the folder input and the wide row appear only for the third', () => {
    const { el, onChange } = mountOn('Files & Links')
    const select = row(el, 'newPageLocation')?.querySelector<HTMLSelectElement>('select.settings__select') as HTMLSelectElement
    expect([...select.options].map((o) => o.textContent)).toEqual(['Vault folder', 'Same folder as current file', 'In the folder specified below'])
    expect(select.selectedOptions[0].textContent).toBe('Same folder as current file') // the YAZ-1643 default
    expect(row(el, 'newPageLocation')?.querySelector('.settings__input')).toBeNull()
    expect(row(el, 'newPageLocation')?.classList.contains('setting--wide')).toBe(false)
    act(() => {
      select.value = '0'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_SETTINGS, newPageLocation: 'root' })
    unmount()
    const folder = mountOn('Files & Links', { ...DEFAULT_SETTINGS, newPageLocation: 'folder', newPageFolder: 'Inbox' })
    expect(row(folder.el, 'newPageLocation')?.classList.contains('setting--wide')).toBe(true)
    expect(row(folder.el, 'newPageLocation')?.querySelector<HTMLInputElement>('.settings__input')?.value).toBe('Inbox')
  })

  it('New item name starts with: a "/" types, says "Name cannot contain "/"" and is not kept; the cell note template keeps a "/" (YAZ-4202)', () => {
    const { el, onChange } = mountOn('Files & Links')
    const input = row(el, 'newPageTitleTemplate')!.querySelector<HTMLInputElement>('input[aria-label="New item name starts with"]')!
    const error = () => row(el, 'newPageTitleTemplate')?.querySelector('.settings__error')?.textContent ?? null
    expect(error()).toBeNull()
    type(input, '{MM}/{DD} ')
    expect(input.value).toBe('{MM}/{DD} ')
    expect(error()).toBe('Name cannot contain "/"')
    blur(input)
    pressEnter(input)
    expect(onChange).not.toHaveBeenCalled()
    type(input, '{MM}-{DD} ')
    expect(error()).toBeNull()
    pressEnter(input)
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, newPageTitleTemplate: '{MM}-{DD} ' })
    unmount()
    const editor = mountOn('Tables')
    const box = row(editor.el, 'tableCellNoteTemplate')!.querySelector<HTMLTextAreaElement>('textarea')!
    act(() => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set?.call(box, '- see a/b')
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => void box.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
    expect(editor.onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, tableCellNoteTemplate: '- see a/b' })
  })

  it('Daily pages (YAZ-3607 D8, D12): the switch alone while off; on, the folder with Change… and Open template, the style with today\'s names and Custom…, and the day folder switch', () => {
    const { el, onChange } = mountOn('Files & Links')
    expect(['dailyPages', 'dailyPageFolder', 'dailyPageFormat', 'dailyPageDayFolder', 'dailyPageOpens'].map((id) => row(el, id) !== null)).toEqual([true, false, false, false, false])
    act(() => rowButtons(el, 'dailyPages')[0].click())
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_SETTINGS, dailyPages: true })
    unmount()
    const on = mountOn('Files & Links', { ...DEFAULT_SETTINGS, dailyPages: true, dailyPageFolder: 'Journal' })
    expect(row(on.el, 'dailyPageFolder')?.querySelector('.settings__place-path')?.textContent).toBe('Journal')
    // No vault in this dialog: no picker and no template to open.
    expect(rowButtons(on.el, 'dailyPageFolder').map((b) => [b.textContent, b.disabled])).toEqual([['Change…', true], ['Open template', true]])
    const select = row(on.el, 'dailyPageFormat')?.querySelector<HTMLSelectElement>('select') as HTMLSelectElement
    // Each ready style shows as today's name; the stored YYYY-MM-DD is the first.
    expect([select.options.length, select.selectedIndex, select.options[4].textContent]).toEqual([5, 0, 'Custom…'])
    expect(row(on.el, 'dailyPageFormat')?.querySelector('input')).toBeNull()
    act(() => rowButtons(on.el, 'dailyPageDayFolder')[0].click())
    expect(on.onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, dailyPages: true, dailyPageFolder: 'Journal', dailyPageDayFolder: true })
    // The button opens (YAZ-4164 D11): the page at now by default.
    expect(rowButtons(on.el, 'dailyPageOpens').map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['The page', 'false'], ['The page at now', 'true']])
    act(() => rowButtons(on.el, 'dailyPageOpens')[0].click())
    expect(on.onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, dailyPages: true, dailyPageFolder: 'Journal', dailyPageOpens: 'page' })
  })

  it('Daily pages › Name style › Custom… (D4): the field sits beside the dropdown; a style with no day keeps the stored one and says why; a good one is written', () => {
    const { el, onChange } = mountOn('Files & Links', { ...DEFAULT_SETTINGS, dailyPages: true })
    const select = row(el, 'dailyPageFormat')?.querySelector<HTMLSelectElement>('select') as HTMLSelectElement
    act(() => {
      select.value = '4' // Custom…
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const input = row(el, 'dailyPageFormat')?.querySelector<HTMLInputElement>('.settings__style-pick input') as HTMLInputElement
    expect(row(el, 'dailyPageFormat')?.querySelector('.settings__tokens')?.textContent).toMatch(/^YYYY 2026 · MMMM October .*Put other words in \[ \]/)
    type(input, 'YYYY-MM')
    act(() => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))) // React's onBlur
    expect(row(el, 'dailyPageFormat')?.querySelector('.settings__error')?.textContent).toBe('Add D or DD, so each day gets its own page')
    expect(onChange).not.toHaveBeenCalled()
    type(input, 'MM_DD- ddd')
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_SETTINGS, dailyPages: true, dailyPageFormat: 'MM_DD- ddd' })
  })

  it('Default location: an invalid folder keeps the stored value, marks the input aria-invalid, and keeps the typed text for fixing up', () => {
    const { el, onChange } = mountOn('Files & Links', { ...DEFAULT_SETTINGS, newPageLocation: 'folder', newPageFolder: 'Old' })
    const input = row(el, 'newPageLocation')?.querySelector<HTMLInputElement>('.settings__input') as HTMLInputElement
    expect(input.value).toBe('Old')
    type(input, 'a/../b')
    pressEnter(input)
    expect(onChange).not.toHaveBeenCalled()
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.classList.contains('settings__input--error')).toBe(true)
    expect(input.value).toBe('a/../b')
    type(input, 'Pages/Inbox')
    expect(input.getAttribute('aria-invalid')).toBe('false')
    pressEnter(input)
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_SETTINGS, newPageLocation: 'folder', newPageFolder: 'Pages/Inbox' })
  })

  it('GitHub sync: the engine-stamped `enabled` is the read-back, the hint is the detected repo, and Off calls setEnabled(false) — never onChange', () => {
    const { el, setEnabled, onChange } = mountOn('Sync', { ...DEFAULT_SETTINGS }, status({ state: 'synced', enabled: true, repo: { remoteUrl: 'git@github.com:me/pages.git', branch: 'main' } }))
    const buttons = rowButtons(el, 'githubSync')
    expect(buttons.map((b) => b.textContent)).toEqual(['On', 'Off'])
    expect(buttons.map((b) => b.classList.contains('settings__option--active'))).toEqual([true, false])
    expect(row(el, 'githubSync')?.querySelector('.setting__hint')?.textContent).toBe('repo git@github.com:me/pages.git · branch main')
    act(() => buttons[1].click())
    expect(setEnabled).toHaveBeenCalledExactlyOnceWith(false)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('GitHub sync: a null status (first fetch in flight) reads as Off, the safe default', () => {
    const { el } = mountOn('Sync', { ...DEFAULT_SETTINGS }, null)
    expect(rowButtons(el, 'githubSync').map((b) => b.classList.contains('settings__option--active'))).toEqual([false, true])
    expect(row(el, 'githubSync')?.querySelector('.setting__hint')?.textContent).toBe("This folder isn't a git repo — set it up with GitHub Desktop, then turn sync on.")
  })
})

describe('SettingsDialog: the Review section saves through the vault (YAZ-4967, D14)', () => {
  const S = REVIEW_ON
  const input = (el: HTMLElement, id: string) => row(el, id)?.querySelector<HTMLInputElement>('.settings__input') as HTMLInputElement
  const reviewRows = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('#settings-review .setting')].map((r) => r.dataset.setting)
  const ALL = REVIEW_ROWS

  it('is absent with no vault open: no Review item in the nav, and no page holds its section or a row of it', () => {
    const { el } = mount()
    expect(navByTitle(el, 'Review')).toBeUndefined()
    const found = onEachPage(el, () => [el.querySelector('#settings-review'), row(el, 'enabled'), row(el, 'weights')])
    expect(found.map(([title]) => title)).toEqual(['General', 'Appearance', 'Sidebar', 'Notifications', 'Editor', 'Tables', 'Code', 'Drawings and diagrams', 'Images', 'Files & Links', 'Folder pages', 'Memory', 'Hotkeys'])
    for (const [, nodes] of found) expect(nodes).toEqual([null, null, null])
  })

  it('on: the card rows in order, with their words and values; off: the switch alone. No upkeep row is left', () => {
    const { el, rerender } = mountOn('Review', { ...DEFAULT_SETTINGS }, status(), S)
    expect(reviewRows(el)).toEqual(ALL)
    expect(ALL.slice(0, -2).map((id) => row(el, id)?.querySelector('.setting__label')?.textContent)).toEqual(['Review cards', 'New cards a day', 'Up next a day', 'New cards first', 'Answer buttons', 'Pause the timer after', 'Time so far', 'Remember rate', 'Longest wait', 'Spread due dates', 'Weights', 'Shown hidden words', 'Mark the next hidden word', 'Colour', 'Card width', 'Card tables', 'Card spacing'])
    // YAZ-5050 round 2: the groups, in order; the card preview is the last row of Card look.
    expect([...el.querySelectorAll('#settings-review .settings-group__title')].map((t) => t.textContent)).toEqual(['Daily limits', 'Answers', 'Scheduling', 'Card look'])
    // YAZ-5020: "How cards come back" is a quiet closed line; open, it says the same-day rules and why.
    const how = row(el, 'howCardsComeBack')!.querySelector('details')!
    expect([how.open, how.querySelector('summary')?.textContent]).toEqual([false, 'How cards come back'])
    expect(how.textContent).toMatch(/later in this session.*two times in a row.*one Remembered is enough.*days.*Anki.*Mochi/s)
    expect(rowButtons(el, 'buttons').map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['Two', 'true'], ['Four', 'false']])
    expect(['retention', 'maxDays', 'newPerDay'].map((id) => input(el, id).value)).toEqual(['90', '365', '10'])
    expect(input(el, 'weights').value).toBe(DEFAULT_REVIEW_SETTINGS.weights.join(', '))
    // A box that grows to its text (YAZ-4964, `settings.css.test.ts`), 3 lines at the least: the 21 numbers need 3 at 960 px.
    expect([input(el, 'weights').tagName, input(el, 'weights').getAttribute('rows')]).toEqual(['TEXTAREA', '3'])
    expect(el.querySelector('#settings-review .settings-section__note')).not.toBeNull()
    rerender(REVIEW_OFF)
    expect(reviewRows(el)).toEqual(['enabled'])
    expect(rowButtons(el, 'enabled').map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true'])
  })

  it('YAZ-5053: Shown hidden words is Highlight · Underline · Box; Box is an app setting (onChange), never the vault\'s review.json', () => {
    const { el, save, onChange } = mountOn('Review', { ...DEFAULT_SETTINGS }, undefined, S)
    expect(rowButtons(el, 'shownHiddenWords').map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['Highlight', 'true'], ['Underline', 'false'], ['Box', 'false']])
    act(() => rowButtons(el, 'shownHiddenWords')[2].click())
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, shownHiddenWords: 'box' })
    expect(save).not.toHaveBeenCalled()
  })

  it('YAZ-5053 round 3: Mark the next hidden word is On by default, with its colour (a picker and Reset) under it; Off hides the colour; both are app settings', () => {
    const { el, onChange, save } = mountOn('Review', { ...DEFAULT_SETTINGS }, undefined, S)
        expect(row(el, 'markNextHidden')?.querySelector('.setting__label')?.textContent).toBe('Mark the next hidden word')
    expect(rowButtons(el, 'markNextHidden').map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['On', 'true'], ['Off', 'false']])
    const picker = row(el, 'nextHiddenColour')?.querySelector<HTMLInputElement>('input[type="color"]')
    expect(picker?.value).toBe(NEXT_HIDDEN_SWATCH)
    // At the default colour, Reset has nothing to do.
    const reset = () => [...(row(el, 'nextHiddenColour')?.querySelectorAll('button') ?? [])].find((b) => b.textContent === 'Reset')
    expect(reset()?.disabled).toBe(true)
    act(() => rowButtons(el, 'markNextHidden')[1].click())
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, markNextHidden: false })
    expect(save).not.toHaveBeenCalled()
    // Its rows sit in Card look, after Shown hidden words.
    const ids = reviewRows(el)
    expect(ids.slice(ids.indexOf('shownHiddenWords'), ids.indexOf('shownHiddenWords') + 3)).toEqual(['shownHiddenWords', 'markNextHidden', 'nextHiddenColour'])
  })

  it('YAZ-5053 round 3: a picked colour shows in the picker; Reset goes back to the default; Off has no colour row', () => {
    const picked = { ...DEFAULT_SETTINGS, nextHiddenColour: '#aa3399' }
    const { el, onChange } = mountOn('Review', picked, undefined, S)
    expect(row(el, 'nextHiddenColour')?.querySelector<HTMLInputElement>('input[type="color"]')?.value).toBe('#aa3399')
    act(() => [...(row(el, 'nextHiddenColour')?.querySelectorAll('button') ?? [])].find((b) => b.textContent === 'Reset')?.click())
    expect(onChange).toHaveBeenLastCalledWith({ ...picked, nextHiddenColour: null })
    expect(row(mountOn('Review', { ...DEFAULT_SETTINGS, markNextHidden: false }, undefined, S).el, 'nextHiddenColour')).toBeNull()
  })

  // YAZ-5053 round 4 (Yaseen: "clicking these options on or off doesnt stick… it doesnt select"): each choice of each
  // Card look row, clicked, sends that value; the settings that come back show it selected, and only it.
  // `store.cardLook.test.ts` saves each one through main and reads it back.
  const CHOICE_ROWS: readonly (readonly [string, Partial<SettingsState>])[] = [
    ['shownHiddenWords', {}],
    ['markNextHidden', {}],
    ['cardSpacing', {}],
    ['cardTablePosition', {}],
    ['cardLineSpacing', { cardSpacing: 'custom' }],
    ['cardBlockGap', { cardSpacing: 'custom' }],
    ['cardBulletSpace', { cardSpacing: 'custom' }],
  ]
  it.each(CHOICE_ROWS)('YAZ-5053 round 4: each choice of %s, clicked, is sent, and shows selected once it comes back', (id, start) => {
    const count = rowButtons(mountOn('Review', { ...DEFAULT_SETTINGS, ...start }, undefined, S).el, id).length
    unmount()
    expect(count).toBeGreaterThan(1)
    for (let at = 0; at < count; at++) {
      // Start from another choice, so each click is a change.
      const from = mountOn('Review', { ...DEFAULT_SETTINGS, ...start }, undefined, S)
      act(() => rowButtons(from.el, id)[(at + 1) % count].click())
      const other = from.onChange.mock.lastCall?.[0] as SettingsState | undefined
      unmount()
      const mid = mountOn('Review', other ?? { ...DEFAULT_SETTINGS, ...start }, undefined, S)
      act(() => rowButtons(mid.el, id)[at].click())
      const sent = mid.onChange.mock.lastCall?.[0] as SettingsState
      unmount()
      const back = mountOn('Review', sent, undefined, S)
      expect(rowButtons(back.el, id).map((b) => b.getAttribute('aria-pressed'))).toEqual(Array.from({ length: count }, (_, i) => String(i === at)))
      unmount()
    }
  })

  it('YAZ-5144 round 2: Card width sits before Card spacing: Same as pages · Custom; Custom starts at 640 px; an app setting', () => {
    const { el, onChange, save } = mountOn('Review', { ...DEFAULT_SETTINGS, contentWidth: 'full' }, undefined, S)
    const ids = reviewRows(el)
    expect(ids.slice(ids.indexOf('cardWidth'), ids.indexOf('cardWidth') + 3)).toEqual(['cardWidth', 'cardTablePosition', 'cardSpacing'])
    expect(row(el, 'cardWidth')?.querySelector('.setting__label')?.textContent).toBe('Card width')
    expect(rowButtons(el, 'cardWidth').map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['Same as pages', 'true'], ['Custom', 'false']])
    expect(row(el, 'cardWidth')?.querySelector('input')).toBeNull()
    expect(row(el, 'cardWidth')?.textContent).toMatch(/Same as pages follows Appearance › Content width/)
    act(() => rowButtons(el, 'cardWidth')[1].click())
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, contentWidth: 'full', cardWidth: 640 })
    expect(save).not.toHaveBeenCalled()
  })

  it('YAZ-5136 round 3: Card tables is Same as pages (the default, Settings › Tables) · Left · Centre, beside Card width; an app setting', () => {
    const { el, onChange, save } = mountOn('Review', { ...DEFAULT_SETTINGS, tablePosition: 'center' }, undefined, S)
    expect(row(el, 'cardTablePosition')?.querySelector('.setting__label')?.textContent).toBe('Card tables')
    expect(rowButtons(el, 'cardTablePosition').map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['Same as pages', 'true'], ['Left', 'false'], ['Centre', 'false']])
    expect(row(el, 'cardTablePosition')?.textContent).toMatch(/Same as pages follows Settings › Tables › Table position/)
    act(() => rowButtons(el, 'cardTablePosition')[1].click())
    expect(onChange).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, tablePosition: 'center', cardTablePosition: 'left' })
    expect(save).not.toHaveBeenCalled()
  })

  it('YAZ-5144 round 2: Custom shows its px, typed and kept on Enter, held to 400–1600; Reset goes back to 640; Same as pages goes back', () => {
    const custom = { ...DEFAULT_SETTINGS, cardWidth: 720 }
    const { el, onChange } = mountOn('Review', custom, undefined, S)
    expect(rowButtons(el, 'cardWidth').slice(0, 2).map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true'])
    const px = row(el, 'cardWidth')!.querySelector<HTMLInputElement>('input[aria-label="Card width in px"]')!
    expect(px.value).toBe('720')
    type(px, '900')
    pressEnter(px)
    expect(onChange).toHaveBeenLastCalledWith({ ...custom, cardWidth: 900 })
    type(px, '5000')
    pressEnter(px)
    expect(onChange).toHaveBeenLastCalledWith({ ...custom, cardWidth: 1600 })
    type(px, '100')
    blur(px)
    expect(onChange).toHaveBeenLastCalledWith({ ...custom, cardWidth: 400 })
    act(() => rowButtons(el, 'cardWidth').find((b) => b.textContent === 'Reset')!.click())
    expect(onChange).toHaveBeenLastCalledWith({ ...custom, cardWidth: 640 })
    act(() => rowButtons(el, 'cardWidth')[0].click())
    expect(onChange).toHaveBeenLastCalledWith({ ...custom, cardWidth: null })
    // At its start, Reset has nothing to do.
    expect(rowButtons(mountOn('Review', { ...DEFAULT_SETTINGS, cardWidth: 640 }, undefined, S).el, 'cardWidth').map((b) => b.textContent)).toEqual(['Same as pages', 'Custom'])
  })

  const CUSTOM_ROWS = ['cardLineSpacing', 'cardBlockGap', 'cardBulletIndent', 'cardBulletGap', 'cardBulletSpace']
  const CUSTOM = { cardSpacing: 'custom' as const, cardLineSpacing: 2, cardBlockGap: 8, cardBulletIndent: 40, cardBulletGap: 12, cardBulletSpace: 4 }
  it('YAZ-5050 round 3: Card spacing is Same as pages by default, with no other row; Custom starts at Mochi\'s clean values (not the pages\'), and shows its rows', () => {
    const page = { ...DEFAULT_SETTINGS, lineSpacing: 1.15, blockGap: 2, pageBulletIndent: 40, pageBulletGap: 12, ...CUSTOM, cardSpacing: 'pages' as const }
    const { el, onChange } = mountOn('Review', page, undefined, S)
    expect(rowButtons(el, 'cardSpacing').map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['Same as pages', 'true'], ['Clean', 'false'], ['Custom', 'false']])
    for (const id of CUSTOM_ROWS) expect(row(el, id)).toBeNull()
    act(() => rowButtons(el, 'cardSpacing')[2].click())
    expect(onChange).toHaveBeenLastCalledWith({ ...page, cardSpacing: 'custom', cardLineSpacing: 1.5, cardBlockGap: 8, cardBulletIndent: 34, cardBulletGap: 10, cardBulletSpace: 0 })
  })

  it('YAZ-5050 round 4: Clean is one click, with no rows; Custom from Clean starts at Clean\'s values', () => {
    const page = { ...DEFAULT_SETTINGS, ...CUSTOM, cardSpacing: 'pages' as const }
    const { el, onChange } = mountOn('Review', page, undefined, S)
    act(() => rowButtons(el, 'cardSpacing')[1].click())
    // YAZ-5144 round 2: Clean's short line is Card width Custom 520 px (Mochi's line), set by the same click.
    expect(onChange).toHaveBeenLastCalledWith({ ...page, cardSpacing: 'clean', cardWidth: 520 })
    const clean = mountOn('Review', { ...page, cardSpacing: 'clean' }, undefined, S)
    expect(rowButtons(clean.el, 'cardSpacing').map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false'])
    for (const id of CUSTOM_ROWS) expect(row(clean.el, id)).toBeNull()
    act(() => rowButtons(clean.el, 'cardSpacing')[2].click())
    expect(clean.onChange).toHaveBeenLastCalledWith({ ...page, cardSpacing: 'custom', cardLineSpacing: 1.5, cardBlockGap: 8, cardBulletIndent: 34, cardBulletGap: 10, cardBulletSpace: 0 })
  })

  it('YAZ-5050: Custom card spacing: its rows under Card spacing, in the pages\' words; a change is an app setting; Reset goes to Custom\'s start; Same as pages goes back', () => {
    const custom = { ...DEFAULT_SETTINGS, ...CUSTOM }
    const { el, onChange } = mountOn('Review', custom, undefined, S)
    expect(reviewRows(el).slice(-8)).toEqual(['cardSpacing', ...CUSTOM_ROWS, 'cardSpacingPreview', 'howCardsComeBack'])
    expect(CUSTOM_ROWS.map((id) => row(el, id)?.querySelector('.setting__label')?.textContent)).toEqual(['Line spacing', 'Space between blocks', 'Bullet indent', 'Bullet gap', 'Space between bullets'])
    act(() => rowButtons(el, 'cardBlockGap')[3].click())
    expect(onChange).toHaveBeenLastCalledWith({ ...custom, cardBlockGap: 12 })
    // Round 3: Space between bullets, Tight (Mochi's) to Relaxed.
    expect(rowButtons(el, 'cardBulletSpace').map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['Tight', 'false'], ['Compact', 'false'], ['Default', 'true'], ['Relaxed', 'false']])
    act(() => rowButtons(el, 'cardBulletSpace')[0].click())
    expect(onChange).toHaveBeenLastCalledWith({ ...custom, cardBulletSpace: 0 })
    act(() => [...(row(el, 'cardBulletGap')?.querySelectorAll('button') ?? [])].find((b) => b.textContent === 'Reset')?.click())
    expect(onChange).toHaveBeenLastCalledWith({ ...custom, cardBulletGap: 10 })
    act(() => rowButtons(el, 'cardSpacing')[0].click())
    expect(onChange).toHaveBeenLastCalledWith({ ...custom, cardSpacing: 'pages' })
    // Clean keeps Custom's values for a later Custom; the choice and Card width (520 px, YAZ-5144) change.
    act(() => rowButtons(el, 'cardSpacing')[1].click())
    expect(onChange).toHaveBeenLastCalledWith({ ...custom, cardSpacing: 'clean', cardWidth: 520 })
  })

  it('the switches save the whole object with one field changed — never onChange', () => {
    const { el, save, onChange } = mountOn('Review', { ...DEFAULT_SETTINGS }, undefined, S)
    act(() => rowButtons(el, 'buttons')[1].click())
    expect(save).toHaveBeenLastCalledWith({ ...S, buttons: 4 })
    act(() => rowButtons(el, 'fuzz')[1].click())
    expect(save).toHaveBeenLastCalledWith({ ...S, fuzz: false })
    // YAZ-4999 D2: New cards first.
    expect(rowButtons(el, 'newOrder').map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['Oldest first', 'true'], ['Newest first', 'false']])
    act(() => rowButtons(el, 'newOrder')[1].click())
    expect(save).toHaveBeenLastCalledWith({ ...S, newOrder: 'newest' })
    // YAZ-5033: Pause the timer after — four choices, 60 s by default, saved in review.json; its hint says "with no key or mouse".
    expect(rowButtons(el, 'pauseAfter').map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['30 s', 'false'], ['60 s', 'true'], ['2 min', 'false'], ['5 min', 'false']])
    expect(row(el, 'pauseAfter')?.textContent).toMatch(/Pause the timer after[\s\S]*With no key or mouse/)
    act(() => rowButtons(el, 'pauseAfter')[2].click())
    expect(save).toHaveBeenLastCalledWith({ ...S, pauseAfter: 120 })
    // YAZ-5130: Time so far — hidden by default (round 2: in the clock's hover box only), shown, or off; saved in review.json.
    expect(rowButtons(el, 'timeSoFar').map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['Hidden (hover to see)', 'true'], ['Shown', 'false'], ['Off', 'false']])
    act(() => rowButtons(el, 'timeSoFar')[2].click())
    expect(save).toHaveBeenLastCalledWith({ ...S, timeSoFar: 'off' })
    act(() => rowButtons(el, 'enabled')[1].click())
    expect(save).toHaveBeenLastCalledWith({ ...S, enabled: false })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('a valid field commits on Enter or blur: the remember rate as a percent, the weights as numbers; an unchanged one saves nothing', () => {
    const { el, save } = mountOn('Review', { ...DEFAULT_SETTINGS }, undefined, S)
    blur(input(el, 'maxDays'))
    expect(save).not.toHaveBeenCalled()
    type(input(el, 'retention'), '85')
    expect(save).not.toHaveBeenCalled() // a draft until it is committed
    pressEnter(input(el, 'retention'))
    expect(save).toHaveBeenLastCalledWith({ ...S, retention: 0.85 })
    type(input(el, 'newPerDay'), '0')
    blur(input(el, 'newPerDay'))
    expect(save).toHaveBeenLastCalledWith({ ...S, newPerDay: 0 })
    // YAZ-4999 D1: an empty box is no limit — valid, saved as null; the hint says so.
    type(input(el, 'newPerDay'), '')
    expect(input(el, 'newPerDay').getAttribute('aria-invalid')).toBe('false')
    blur(input(el, 'newPerDay'))
    expect(save).toHaveBeenLastCalledWith({ ...S, newPerDay: null })
    expect(row(el, 'newPerDay')?.textContent).toContain('Empty means no limit.')
    // YAZ-5028: Up next a day, the same box: empty by default (no limit), a number saved, empty again is null.
    expect(input(el, 'upNextPerDay').value).toBe('')
    expect(row(el, 'upNextPerDay')?.textContent).toContain('Empty means no limit.')
    // YAZ-5042 Decision 1: the cards past the number wait for another day.
    expect(row(el, 'upNextPerDay')?.textContent).toContain('The others wait for another day.')
    expect(row(el, 'upNextPerDay')?.textContent).not.toContain('normal place')
    type(input(el, 'upNextPerDay'), '2')
    blur(input(el, 'upNextPerDay'))
    expect(save).toHaveBeenLastCalledWith({ ...S, upNextPerDay: 2 })
    const weights = S.weights.map((w, i) => (i === 0 ? 0.3 : w))
    type(input(el, 'weights'), weights.join(','))
    blur(input(el, 'weights'))
    expect(save).toHaveBeenLastCalledWith({ ...S, weights })
  })

  it('a draft the rules refuse is marked while it stands, is not saved, and gives way to the last good value', () => {
    const { el, save } = mountOn('Review', { ...DEFAULT_SETTINGS }, undefined, S)
    // Each is one of `sanitizeReviewSettings`' rules: 70 to 99 %, whole days from 1, whole cards from 0, 17, 19 or 21 numbers.
    const weights = S.weights.join(', ')
    for (const [id, draft, stored] of [['retention', '50', '90'], ['retention', '', '90'], ['maxDays', '0', '365'], ['maxDays', '7.5', '365'], ['newPerDay', 'many', '10'], ['weights', '1, 2, 3', weights], ['weights', `${weights}, x`, weights]] as const) {
      const box = input(el, id)
      expect(box.getAttribute('aria-invalid')).toBe('false')
      type(box, draft)
      expect(box.getAttribute('aria-invalid')).toBe('true')
      expect(box.classList.contains('settings__input--error')).toBe(true)
      blur(box)
      expect(box.value).toBe(stored)
      expect(box.getAttribute('aria-invalid')).toBe('false')
    }
    expect(save).not.toHaveBeenCalled()
  })

  it('review off: search finds the switch and none of the rows it hides; turned on, it finds them', () => {
    const { el, rerender } = mount({ ...DEFAULT_SETTINGS }, undefined, REVIEW_OFF)
    type(searchInput(el), 'review cards')
    expect(rowIds(el)).toEqual(['enabled'])
    type(searchInput(el), 'longest wait')
    expect(rowIds(el)).toEqual([])
    rerender(S)
    expect(rowIds(el)).toEqual(['maxDays'])
  })
})

describe('SettingsDialog search (D6)', () => {
  it('"dark" shows the Theme row under Appearance, the draw.io dark-mode row (YAZ-3037) under Drawings and diagrams (YAZ-4748 D11), then the drawing\'s and the diagram\'s dark keys (YAZ-3564) — and the row still works', () => {
    const { el, onChange } = mount({ ...DEFAULT_SETTINGS }, status())
    type(searchInput(el), 'dark')
    // On Hotkeys each hit is under its key's card (YAZ-3564): draw.io's ⌘⇧6, and the canvas's no-key row.
    // And the guide lines' darkness (YAZ-4094 G3) on the Editor page, and the calendar tables' shade darkness (YAZ-4163 demo), on the Tables page (YAZ-4775).
    // And "Text color follows the fill" (YAZ-4404 4H) on the Drawings and diagrams page: its hint says "A dark fill".
    // The draw.io row is that page's last group since YAZ-4748 D11.
    expect(headings(el)).toEqual(['Appearance', 'Editor › Outline', 'Tables › Calendar tables', 'Drawings and diagrams › New elements', 'Drawings and diagrams › draw.io diagrams', 'Hotkeys › ⌘⇧6', 'Hotkeys › Actions with no key'])
    expect(rowIds(el)).toEqual(['theme', 'guideLineDarkness', 'tableShadeDarkness', 'canvas.fillSetsTextColor', 'diagramDarkColors', 'hotkey-diagram-adaptiveColors', 'hotkey-drawing-toggleTheme'])
    expect(sections(el)).toEqual([]) // the page is gone while the query stands
    act(() => rowButtons(el, 'theme')[2].click())
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_SETTINGS, theme: 'dark' })
  })

  it('a titled group heads its hits with a breadcrumb, without repeating the group title below it', () => {
    const { el } = mount()
    // "threading" is in one group's title and in the hint of Section indent, which names that group: both groups' rows, each under its own breadcrumb (Table of contents, between them, has no hit).
    // The sidebar's line style names bullet threading too (YAZ-3309 D7): its one row, under its own breadcrumb, first in registry order.
    type(searchInput(el), 'threading')
    // And a grouped folder table's Group line style (YAZ-4798), whose hint names the sidebar's thread.
    expect(headings(el)).toEqual(['Sidebar › Level lines', 'Editor › Bullet threading', 'Editor › Section indent', 'Folder pages › View defaults'])
    expect(groupTitles(el)).toEqual([])
    expect([...el.querySelectorAll('.settings-group__hint')].map((h) => h.textContent)).toEqual([THREADING_HINT, SECTION_INDENT_HINT, 'A view with no choice of its own uses these. Its menus then say "from Settings", and Reset goes back to them.'])
    expect(rowIds(el)).toEqual(['sidebarLineStyle', 'bulletThreading', 'threadWidth', 'threadColor', 'sectionStep', 'sectionLines', 'folderPages.groupLineStyle'])
    // "guide lines" finds the three guide line rows of Outline (YAZ-4094), under the one breadcrumb.
    type(searchInput(el), 'guide lines')
    expect(headings(el)).toEqual(['Editor › Outline'])
    expect(groupTitles(el)).toEqual([])
    expect([...el.querySelectorAll('.settings-group__hint')].map((h) => h.textContent)).toEqual([OUTLINE_HINT])
    expect(rowIds(el)).toEqual(['guideLinesOnByDefault', 'guideLinesShow', 'guideLineDarkness'])
  })

  it('hits from several groups stack under their own breadcrumbs, in registry order', () => {
    const { el } = mount({ ...DEFAULT_SETTINGS }, status())
    // "bullet": the threading group (by its hint and title), the two rows of the table of contents
    // group (by its hint: a page of bullets has one too, YAZ-2700 D14), the Section indent group (its hint names
    // Bullet threading) and, on the Hotkeys page, the two tables whose labels name a bullet — five
    // breadcrumbs, registry order, never rank.
    // The sidebar's line style (YAZ-3309 D7) names bullet threading: it leads, on Appearance.
    // The Selection toolbar row has "bullet" among its words (YAZ-3806 T7). Outline's hint names bullets (YAZ-4094): its four rows.
    type(searchInput(el), 'bullet')
    // Find (YAZ-4787): its hint names folded bullets.
    // The bullets in cells (YAZ-3818 demo): All tables and Cell notes too, on the Tables page since YAZ-4775.
    // The fold arrows of a drawing's text boxes (YAZ-4277 D5, D7): their group's hint names a bullet.
    // A grouped folder table's Group line style (YAZ-4798), which names bullet threading, as in the "threading" search.
    const settingsHits = ['Sidebar › Level lines', 'Editor › Outline', 'Editor › Bullet threading', 'Editor › Section indent', 'Editor › Selection toolbar', 'Editor › Table of contents', 'Editor › Find', 'Tables › All tables', 'Tables › Cell notes', 'Drawings and diagrams › Fold arrows', 'Folder pages › View defaults']
    expect(headings(el).slice(0, settingsHits.length)).toEqual(settingsHits)
    // On Hotkeys a hit is the ONE row that names a bullet, not its whole table (YAZ-3397 D5), under its key's card (YAZ-3564).
    // The clicks follow the keys (YAZ-3936): the three "Bullet dots" rows, and the built-in clicks of bullet lines and fold arrows.
    expect(headings(el).slice(-3)).toEqual(['Hotkeys › Click', 'Hotkeys › ⌘-click', 'Hotkeys › ⇧-click'])
    expect(headings(el).slice(settingsHits.length).every((h) => h?.startsWith('Hotkeys › '))).toBe(true)
    expect(rowIds(el).slice(0, 16)).toEqual(['sidebarLineStyle', 'guideLinesOnByDefault', 'guideLinesShow', 'guideLineDarkness', 'foldingOnByDefault', 'pageBulletIndent', 'pageBulletGap', 'bulletThreading', 'threadWidth', 'threadColor', 'sectionStep', 'sectionLines', 'selectionToolbar', 'tocOnByDefault', 'tableOfContents', 'tocLines'])
    expect(new Set(rowIds(el).slice(16))).toEqual(
      new Set([
        // Find's fold row (YAZ-4787) and the Group line style (YAZ-4798).
        'findFolds',
        'folderPages.groupLineStyle',
        // The cell notes' rows (YAZ-3818 demo): the bullets in cells and the template.
        'tableCellBulletIndent',
        'tableCellBulletGap',
        'tableCellNoteTemplate',
        ...['foldArrowsOpen', 'foldArrowSize', 'foldArrowThickness', 'foldArrowMinSize'].map((k) => `canvas.${k}`),
        // ⌘\ in pages (YAZ-4420): its hint says "bullets, lists, quotes and links stay".
        'hotkey-page-clearFormatting',
        ...['bulletList', 'cycleTask', 'indent', 'outdent', 'foldHere', 'unfoldHere', 'foldAll', 'unfoldAll', 'zoomIn', 'copyVisible', 'enter', 'tab', 'selectAll'].map((r) => `hotkey-page-${r}`),
        ...['thisTab', 'newTab', 'backgroundTab'].map((r) => `hotkey-bullets-${r}`),
        // A built-in click is found by its place too: "Bullet lines".
        ...['fold-unfold-that-bullet-or-heading-secti', 'collapse-direct-children-fully-expand-th'].map((r) => `hotkey-mouse-${r}`),
      ]),
    )
    type(searchInput(el), 'spacing')
    // The page's bullet spacing (the YAZ-3818 demo) too, under Outline.
    expect(headings(el)).toEqual(['Appearance › Spacing', 'Editor › Outline'])
    // YAZ-5050 round 2: the Spacing preview with its rows.
    expect(rowIds(el)).toEqual(['lineSpacing', 'blockGap', 'pageSpacingPreview', 'pageBulletIndent', 'pageBulletGap'])
    // Comments is a group of Appearance now, so its breadcrumb says so.
    type(searchInput(el), 'comments')
    // A code key's row says "comment" too (YAZ-3564). General › You (YAZ-4615 D7, who you comment as) leads, then the Appearance group.
    expect(headings(el).slice(0, 2)).toEqual(['General › You', 'Appearance › Comments'])
    expect(rowIds(el).slice(0, 4)).toEqual(['profile', 'commentsOrder', 'commentsResolved', 'commentsHint'])
    type(searchInput(el), 'section indent')
    expect(headings(el)).toEqual(['Editor › Section indent'])
    expect(rowIds(el)).toEqual(['sectionStep', 'sectionLines'])
    type(searchInput(el), 'close tab')
    expect(headings(el)).toEqual(['Hotkeys › ⌘W'])
    expect(rowIds(el)).toEqual(['hotkey-closeTab'])
  })

  it('clearing a query returns to the page that was showing before it — a later settings page and the Hotkeys page alike', () => {
    const { el } = mount()
    for (const [title, rows] of [['Editor', EDITOR_ROWS], ['Hotkeys', HOTKEY_ROWS]] as const) {
      clickNav(el, title)
      type(searchInput(el), 'system')
      expect(headings(el)).toEqual(['Appearance'])
      expect(rowIds(el)).toEqual(['theme'])
      pressEscape(searchInput(el))
      expect(headings(el)).toEqual([title])
      expect(rowIds(el)).toEqual(rows)
      expect(currentNav(el)).toBe(title)
    }
  })

  it('no hit says so, quoting the query', () => {
    const { el } = mount()
    type(searchInput(el), 'zzzz')
    expect(el.querySelector('.settings-empty')?.textContent).toBe('No settings match “zzzz”.')
    expect(rowIds(el)).toEqual([])
  })

  it('"Show in settings" (the YAZ-3818 demo): the arrow after a hit\'s heading clears the search, opens its page and flashes its group; the heading does the same', () => {
    vi.useFakeTimers()
    try {
      const { el } = mount()
      type(searchInput(el), 'spacing')
      const arrows = [...el.querySelectorAll<HTMLButtonElement>('.settings-search__goto')]
      expect(arrows.map((b) => b.getAttribute('aria-label'))).toEqual(['Show in settings', 'Show in settings'])
      act(() => arrows[1]!.click())
      expect(searchInput(el).value).toBe('')
      expect(headings(el)).toEqual(['Editor'])
      const outline = row(el, 'pageBulletGap')?.closest('.settings-group')
      expect(outline?.classList.contains('settings-group--revealed')).toBe(true)
      act(() => vi.advanceTimersByTime(3000))
      expect(outline?.classList.contains('settings-group--revealed')).toBe(false)
      type(searchInput(el), 'spacing')
      act(() => el.querySelector<HTMLElement>('.settings-search__goto-text')!.click())
      expect(headings(el)).toEqual(['Appearance'])
      expect(row(el, 'lineSpacing')?.closest('.settings-group')?.classList.contains('settings-group--revealed')).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('Escape with a query clears it and brings back the page that was showing; the × button does the same', () => {
    const { el, onClose } = mount()
    // As it opens: General (YAZ-3276 D7).
    type(searchInput(el), 'trash')
    expect(rowIds(el)).toEqual(['gestureSounds', 'hearSounds', 'confirmDelete', 'folderPages.askBeforeDelete', 'hotkey-app-trash']) // ⌘⌫'s row says "Trash" too (YAZ-3272 D20), and so does a folder page's delete (YAZ-4592)
    pressEscape(searchInput(el))
    expect(onClose).not.toHaveBeenCalled()
    expect(searchInput(el).value).toBe('')
    expect(headings(el)).toEqual(['General'])
    expect(rowIds(el)).toEqual(GENERAL_ROWS)

    // From a later page: the same page again, not the first.
    clickNav(el, 'Files & Links')
    type(searchInput(el), 'system')
    expect(rowIds(el)).toEqual(['theme'])
    pressEscape(searchInput(el))
    expect(onClose).not.toHaveBeenCalled()
    expect(searchInput(el).value).toBe('')
    expect(headings(el)).toEqual(['Files & Links'])
    expect(rowIds(el)).toEqual(FILES_ROWS)

    type(searchInput(el), 'system')
    act(() => el.querySelector<HTMLButtonElement>('[aria-label="Clear search settings"]')?.click())
    expect(searchInput(el).value).toBe('')
    expect(headings(el)).toEqual(['Files & Links'])
    expect(rowIds(el)).toEqual(FILES_ROWS)
    expect(currentNav(el)).toBe('Files & Links')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('a nav click during a search clears the query and shows that page, from its top', () => {
    const { el } = mount()
    scrollTo(el, 400)
    type(searchInput(el), 'system')
    expect(rowIds(el)).toEqual(['theme'])
    clickNav(el, 'Files & Links')
    expect(searchInput(el).value).toBe('')
    expect(currentNav(el)).toBe('Files & Links')
    expect(currentKind(el)).toBe('page')
    expect(headings(el)).toEqual(['Files & Links'])
    expect(sections(el).map((sec) => sec.id)).toEqual(['settings-files'])
    expect(rowIds(el)).toEqual(FILES_ROWS)
    expect(pane(el).scrollTop).toBe(0)
    // And a click on the page the search was typed over: the query goes, that page is back.
    type(searchInput(el), 'system')
    clickNav(el, 'Files & Links')
    expect(searchInput(el).value).toBe('')
    expect(rowIds(el)).toEqual(FILES_ROWS)
  })
})

describe("SettingsDialog: Give this vault's pages IDs (YAZ-2523 V4, V13)", () => {
  const OFF_TEXT = "This vault's pages will show their file names, and links stored as IDs will not open, until you turn this back on. Nothing is removed."
  const withIds = (enabled: boolean, held = false) => mountOn('Files & Links', { ...DEFAULT_SETTINGS }, undefined, undefined, { enabled, held })
  const pressed = (el: HTMLElement) => rowButtons(el, 'ids').map((b) => b.getAttribute('aria-pressed'))
  const sheetBtn = (el: HTMLElement, label: string) => [...el.querySelectorAll<HTMLButtonElement>('.confirm__btn')].find((b) => b.textContent === label)

  it('with no vault open the row is absent, and so is its "This vault" group; a search does not find it', () => {
    const { el } = mountOn('Files & Links')
    expect(row(el, 'ids')).toBeNull()
    expect(groupTitles(el)).not.toContain('This vault')
    type(searchInput(el), 'files & links')
    expect(rowIds(el)).toEqual(FILES_ROWS)
  })

  it('a vault open: the row sits in Files & Links under "This vault", with its label and hint', () => {
    const { el } = withIds(false)
    expect(row(el, 'ids')?.closest('[data-section]')?.id).toBe('settings-files')
    expect(row(el, 'ids')?.closest('.settings-group')?.querySelector('.settings-group__title')?.textContent).toBe('This vault')
    expect(row(el, 'ids')?.querySelector('.setting__label')?.textContent).toBe("Give this vault's pages IDs")
    expect(row(el, 'ids')?.querySelector('.setting__hint')?.textContent).toBe('Saved in this vault and synced with it. On: every page gets an ID and the app names its file. Off: the app leaves every file as it is.')
    expect(rowButtons(el, 'ids').map((b) => b.textContent)).toEqual(['On', 'Off'])
  })

  it("shows the vault's answer: On where it said yes, Off where it said no or has no answer", () => {
    expect(pressed(withIds(true, true).el)).toEqual(['true', 'false'])
    unmount()
    expect(pressed(withIds(false).el)).toEqual(['false', 'true'])
  })

  it('Off in a vault whose pages hold IDs asks first, in the locked words; Cancel and Esc leave it on and the dialog open', () => {
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

  it('Off in a vault whose pages hold IDs writes no only on "Turn off"', () => {
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
  const ASK = { pages: 3, folders: 1, foreign: 0 }
  const open = async (vaultIds: { ask?: IndexResponse['ask']; letters?: string } = { ask: ASK }, vaultName?: string) => {
    const mounted = mountOn('Files & Links', { ...DEFAULT_SETTINGS }, undefined, undefined, { enabled: false, held: false, ...vaultIds }, vaultName)
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
    const { el, setIds } = await open({ ask: { pages: 0, folders: 0, foreign: 0 } })
    expect(el.querySelector('.confirm__text')?.textContent).toBe(idsAskMessage({ pages: 0, folders: 0, foreign: 0 }))
    type(field(el), 'bus')
    act(() => sheetBtn(el, 'Give IDs').click())
    expect(setIds).toHaveBeenCalledExactlyOnceWith(true, 'BUS')
  })

  it('with two or more vaults in the window the box names the vault that it acts on (S13)', async () => {
    const { el } = await open({ ask: ASK }, 'Work')
    expect(el.querySelector('.confirm__text')?.textContent).toBe(idsAskMessage(ASK, 'Work'))
    expect(el.querySelector('.confirm__text')?.textContent).toContain('Give the pages in Work IDs?')
  })

  it('Off in a vault whose pages hold IDs still asks first, and "Turn off" saves no with no letters handed over (S11)', async () => {
    const { el, setIds } = mountOn('Files & Links', { ...DEFAULT_SETTINGS }, undefined, undefined, { enabled: true, held: true })
    act(() => rowButtons(el, 'ids')[1].click())
    expect(el.querySelector('.confirm__input')).toBeNull()
    expect(setIds).not.toHaveBeenCalled()
    act(() => sheetBtn(el, 'Turn off').click())
    expect(setIds).toHaveBeenCalledExactlyOnceWith(false)
  })
})

/**
 * A folder whose pages already hold number IDs (YAZ-4922 🔒 D2, gap 1): the box counts them by their letters and
 * offers "Keep <letters>" of the biggest group first. Other letters can be typed instead. Nothing is written until
 * one of the two is chosen.
 */
describe('SettingsDialog: the box offers to keep the IDs the pages already hold (YAZ-4922 D2)', () => {
  const ASK = { pages: 29, folders: 0, foreign: 26, groups: [{ letters: 'YAS', count: 120 }, { letters: 'TECH', count: 26 }] }
  const open = async (ask: IndexResponse['ask'] = ASK) => {
    const mounted = mountOn('Files & Links', { ...DEFAULT_SETTINGS }, undefined, undefined, { enabled: false, held: false, ask })
    await act(async () => rowButtons(mounted.el, 'ids')[0].click())
    return mounted
  }
  const buttons = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('.confirm__btn')]
  const sheetBtn = (el: HTMLElement, label: string) => buttons(el).find((b) => b.textContent === label) as HTMLButtonElement
  const field = (el: HTMLElement) => el.querySelector('.confirm__input') as HTMLInputElement

  it('the box says how many pages hold IDs with which letters, and "Keep YAS" is its first answer, with the focus', async () => {
    const { el, setIds } = await open()
    expect(el.querySelector('.confirm__text')?.textContent).toBe(keepIdsAskMessage(ASK))
    expect(keepIdsAskMessage(ASK)).toContain('120 pages and folders have an ID with YAS, and 26 with TECH')
    // The vault's word (YAZ-4938) reaches every "page" of the box.
    expect(keepIdsAskMessage(ASK, undefined, unitTextOf(UNIT_WORDS.doc))).toContain('120 docs and folders have an ID with YAS')
    // What "Use <letters>" does (YAZ-4922, "Yes, leave them"): only this vault's own links follow; a link out keeps its ID.
    expect(keepIdsAskMessage(ASK)).toContain('Or type other letters: each YAS ID takes them and keeps its number. Their file names follow, and so does each link to them. A link to a page outside this vault stays as it is.')
    expect(keepIdsAskMessage(ASK)).not.toContain('each link and file name follows')
    expect(el.querySelector('.confirm__letters')?.textContent).toBe(KEEP_OTHER_ASK)
    expect(buttons(el).map((b) => b.textContent)).toEqual(['Use other letters', 'Cancel', 'Keep YAS'])
    expect(document.activeElement).toBe(sheetBtn(el, 'Keep YAS'))
    expect(sheetBtn(el, 'Use other letters').disabled).toBe(true)
    expect(sheetBtn(el, 'Use other letters').classList.contains('confirm__btn--other')).toBe(true)
    expect(setIds).not.toHaveBeenCalled()
  })

  it('"Keep YAS" and Enter save yes with YAS', async () => {
    const { el, setIds } = await open()
    act(() => sheetBtn(el, 'Keep YAS').click())
    expect(setIds).toHaveBeenCalledExactlyOnceWith(true, 'YAS')
    expect(el.querySelector('.confirm')).toBeNull()
    unmount()
    const again = await open()
    pressEnter(field(again.el))
    expect(again.setIds).toHaveBeenCalledExactlyOnceWith(true, 'YAS')
  })

  it('typed other letters: the left button says them and saves them, and so does Enter in the field', async () => {
    const { el, setIds } = await open()
    type(field(el), 'abc')
    expect(sheetBtn(el, 'Use ABC').disabled).toBe(false)
    act(() => sheetBtn(el, 'Use ABC').click())
    expect(setIds).toHaveBeenCalledExactlyOnceWith(true, 'ABC')
    unmount()
    const again = await open()
    type(field(again.el), 'abc')
    pressEnter(field(again.el))
    expect(again.setIds).toHaveBeenCalledExactlyOnceWith(true, 'ABC')
  })

  it('bad letters in the field: the left button and Enter in the field do nothing', async () => {
    const { el, setIds } = await open()
    type(field(el), 'A1')
    expect(sheetBtn(el, 'Use other letters').disabled).toBe(true)
    pressEnter(field(el))
    expect(setIds).not.toHaveBeenCalled()
    expect(el.querySelector('.confirm')).not.toBeNull()
  })

  it('Cancel writes nothing', async () => {
    const { el, setIds } = await open()
    act(() => sheetBtn(el, 'Cancel').click())
    expect(el.querySelector('.confirm')).toBeNull()
    expect(setIds).not.toHaveBeenCalled()
  })
})

describe('SettingsDialog: Duplicate IDs (YAZ-2677 D7, S55 to S57)', () => {
  const withIds = (enabled: boolean) => mountOn('Files & Links', { ...DEFAULT_SETTINGS }, undefined, undefined, { enabled, held: enabled })
  const button = (el: HTMLElement) => rowButtons(el, 'duplicates')[0]
  const result = (el: HTMLElement) => row(el, 'duplicates')?.querySelector('[role="status"]')?.textContent

  it('the row shows only while the vault uses IDs: under "This vault", after the switch, with one button', () => {
    expect(row(withIds(false).el, 'duplicates')).toBeNull()
    unmount()
    expect(row(mountOn('Files & Links').el, 'duplicates')).toBeNull()
    unmount()
    const { el, checkIds } = withIds(true)
    expect(row(el, 'duplicates')?.closest('.settings-group')?.querySelector('.settings-group__title')?.textContent).toBe('This vault')
    expect(row(el, 'duplicates')?.querySelector('.setting__label')?.textContent).toBe('Duplicate IDs')
    expect(rowButtons(el, 'duplicates').map((b) => b.textContent)).toEqual(['Check for duplicates'])
    expect(result(el)).toBe('')
    // Nothing runs until the user asks.
    expect(checkIds).not.toHaveBeenCalled()
    type(searchInput(el), 'duplicate')
    // A drawing's and a diagram's Duplicate key answer too (YAZ-3564); the vault's row is first.
    expect(rowIds(el)[0]).toBe('duplicates')
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
    checkIds.mockResolvedValueOnce('YAZ-101 is on two pages. The Mac that made "Bar" fixes it when its app runs.')
    await act(async () => button(el).click())
    expect(result(el)).toBe('YAZ-101 is on two pages. The Mac that made "Bar" fixes it when its app runs.')
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
    const mounted = mountOn('Files & Links', { ...DEFAULT_SETTINGS }, undefined, undefined, { enabled, held: enabled, letters: 'YAZ', state: state ?? {} }, vaultName)
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
    expect(row(mountOn('Files & Links').el, 'idLetters')).toBeNull()
    unmount()
    const { el, idsState, reletter } = await withIds(true)
    expect(row(el, 'idLetters')?.closest('.settings-group')?.querySelector('.settings-group__title')?.textContent).toBe('This vault')
    expect(row(el, 'idLetters')?.querySelector('.setting__label')?.textContent).toBe('ID letters')
    // The hint says what a change reaches (YAZ-4922, "Yes, leave them"): this vault's IDs, their file names and the links to them; a link out stays.
    expect(row(el, 'idLetters')?.querySelector('.setting__hint:not([role])')?.textContent).toBe('The letters in front of each number, like the YAZ in YAZ-12. A change reaches each ID in this vault, its file name and each link to it. A link to a page outside this vault stays as it is.')
    expect(idsState).toHaveBeenCalledTimes(1)
    expect(line(el)).toBe("This vault's ID letters are YAZ.")
    expect(buttons(el).map((b) => b.textContent)).toEqual(['Change letters'])
    expect(reletter).not.toHaveBeenCalled()
  })

  it('S80: "Change letters" opens a box with the count of pages and a text field, and writes nothing', async () => {
    const { el, reletter } = await withIds(true, { pages: 745 }, 'Work')
    act(() => buttons(el)[0].click())
    expect(el.querySelector('.confirm__text')?.textContent).toBe(lettersAskMessage({ letters: 'YAZ', pages: 745 }, 'Work'))
    expect(el.querySelector('.confirm__text')?.textContent).toContain('745 pages')
    // The same pass as "Use <letters>" (YAZ-4922, "Yes, leave them"): a link to a page outside this vault keeps its letters.
    expect(el.querySelector('.confirm__text')?.textContent).toContain('The app will change the ID of 745 pages, the file name of each, and each link to them. A link to a page outside this vault stays as it is.')
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

  it('S83: a change that stopped: the row says how many pages still have the old letters, and "Finish" runs the same change again', async () => {
    const { el, reletter } = await withIds(true, { letters: 'DOC', stale: 12 })
    expect(line(el)).toBe(lettersLine({ letters: 'DOC', stale: 12 }))
    expect(line(el)).toBe("This vault's ID letters are DOC. 12 pages still have the old letters.")
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
    const mounted = mountOn('Files & Links', { ...DEFAULT_SETTINGS }, undefined, undefined, { enabled, held: enabled, letters: 'YAZ', old, state: {} }, vaultName)
    await act(async () => undefined)
    return mounted
  }
  const button = (el: HTMLElement) => rowButtons(el, 'oldIds')[0]
  const line = (el: HTMLElement) => row(el, 'oldIds')?.querySelector('[role="status"]')?.textContent
  const sheetBtn = (el: HTMLElement, label: string) => [...el.querySelectorAll<HTMLButtonElement>('.confirm__btn')].find((b) => b.textContent === label) as HTMLButtonElement
  const field = (el: HTMLElement) => el.querySelector('.confirm__input') as HTMLInputElement

  it('S88: the row shows only in a vault that uses IDs and has pages with an old ID: the count and one button', async () => {
    expect(row((await withOld(0)).el, 'oldIds')).toBeNull()
    unmount()
    expect(row((await withOld(745, false)).el, 'oldIds')).toBeNull()
    unmount()
    const { el, backfill } = await withOld(745)
    expect(row(el, 'oldIds')?.querySelector('.setting__label')?.textContent).toBe('Old IDs')
    expect(line(el)).toBe(oldIdsLine(745))
    expect(line(el)).toContain('745 pages')
    expect(rowButtons(el, 'oldIds').map((b) => b.textContent)).toEqual(['Give them numbers'])
    expect(backfill).not.toHaveBeenCalled()
  })

  it('S89, S91: the box says the count and to sync and close the other Mac first, and only the vault\'s letters start it', async () => {
    const { el, backfill } = await withOld(745, true, 'Work')
    await act(async () => button(el).click())
    expect(el.querySelector('.confirm__text')?.textContent).toBe(oldIdsAskMessage(745, 'Work'))
    expect(el.querySelector('.confirm__text')?.textContent).toContain('745 pages')
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
    expect(line(el)).toBe('Each page has a number now.')
  })

  it('S90: a run that left pages says how many, and to run it again; Cancel writes nothing', async () => {
    const { el, backfill } = await withOld(3)
    await act(async () => button(el).click())
    act(() => sheetBtn(el, 'Cancel').click())
    expect(backfill).not.toHaveBeenCalled()
    backfill.mockResolvedValueOnce({ letters: 'YAZ', pages: 5, stale: 0, old: 1, unfinished: true })
    await act(async () => button(el).click())
    type(field(el), 'YAZ')
    await act(async () => sheetBtn(el, 'Give them numbers').click())
    expect(line(el)).toBe('1 page has an old ID, like 6cbnmcq5n2sj. Run it again to finish.')
  })

  it('S90: a run that stopped with links left, after each page has its number: the row still shows, and a second run finishes it', async () => {
    const mounted = mountOn('Files & Links', { ...DEFAULT_SETTINGS }, undefined, undefined, { enabled: true, held: true, letters: 'YAZ', old: 0, unfinished: true, state: {} })
    await act(async () => undefined)
    const { el, backfill } = mounted
    expect(line(el)).toBe('Each page has a number, but some links still hold an old ID.')
    await act(async () => button(el).click())
    expect(el.querySelector('.confirm__text')?.textContent).toBe(oldIdsAskMessage(0))
    expect(el.querySelector('.confirm__text')?.textContent).toContain('Finish giving the old IDs in this vault numbers?')
    backfill.mockResolvedValueOnce({ letters: 'YAZ', pages: 5, stale: 0, old: 0, unfinished: true })
    type(field(el), 'YAZ')
    await act(async () => sheetBtn(el, 'Give them numbers').click())
    expect(line(el)).toBe('Each page has a number, but some links still hold an old ID. Run it again to finish.')
    await act(async () => button(el).click())
    type(field(el), 'YAZ')
    await act(async () => sheetBtn(el, 'Give them numbers').click())
    expect(backfill).toHaveBeenCalledTimes(2)
    expect(line(el)).toBe('Each page has a number now.')
  })
})

/** Settings › This vault › "Read only" (YAZ-4939): Off (default) · On, saved in the vault. */
describe('This vault › Read only (YAZ-4939)', () => {
  it('with no vault open the row is absent', () => {
    const { el } = mount()
    expect(row(el, 'readOnlyVault')).toBeNull()
  })

  it('a vault open: the row sits under "This vault" with its label, hint and On / Off; it shows the vault’s answer', () => {
    const { el } = mountOn('Files & Links', undefined, undefined, undefined, undefined, undefined, { on: false })
    expect(row(el, 'readOnlyVault')?.closest('.settings-group')?.querySelector('.settings-group__title')?.textContent).toBe('This vault')
    expect(row(el, 'readOnlyVault')?.querySelector('.setting__label')?.textContent).toBe('Read only')
    expect(row(el, 'readOnlyVault')?.querySelector('.setting__hint')?.textContent).toContain('every page, drawing, diagram, code file and folder page in this vault opens read only')
    expect(rowButtons(el, 'readOnlyVault').map((b) => b.textContent)).toEqual(['On', 'Off'])
    expect(rowButtons(el, 'readOnlyVault').map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true'])
    expect(rowButtons(mountOn('Files & Links', undefined, undefined, undefined, undefined, undefined, { on: true }).el, 'readOnlyVault').map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false'])
  })

  it('On and Off save the vault’s file', () => {
    const { el, saveReadOnly } = mountOn('Files & Links', undefined, undefined, undefined, undefined, undefined, { on: false })
    act(() => rowButtons(el, 'readOnlyVault')[0].click())
    expect(saveReadOnly).toHaveBeenCalledExactlyOnceWith({ on: true })
  })
})

describe('SettingsDialog: Show IDs (YAZ-4940), three rows in one block under "This vault"', () => {
  const SHOW_IDS: ShowIdsSettings = { search: 'always', title: true, files: 'off' }
  const withShowIds = (idsOn: boolean, showIds: ShowIdsSettings = SHOW_IDS) => mountOn('Files & Links', { ...DEFAULT_SETTINGS }, undefined, undefined, { enabled: idsOn, held: idsOn }, undefined, undefined, showIds)
  const pressed = (el: HTMLElement, id: string) => rowButtons(el, id).map((b) => b.getAttribute('aria-pressed'))

  it('in a vault with IDs: "in search", "in the title" and "in the files list", one after the other, under "This vault"; each shows the vault\'s choice', () => {
    const { el } = withShowIds(true)
    const ids = rowIds(el)
    const at = ids.indexOf('showIds')
    expect(ids.slice(at, at + 3)).toEqual(['showIds', 'showIds.title', 'showIds.files'])
    expect(row(el, 'showIds.title')?.closest('.settings-group')?.querySelector('.settings-group__title')?.textContent).toBe('This vault')
    expect(row(el, 'showIds.title')?.querySelector('.setting__label')?.textContent).toBe('Show IDs in the title')
    expect(row(el, 'showIds.files')?.querySelector('.setting__label')?.textContent).toBe('Show IDs in the files list')
    expect(rowButtons(el, 'showIds.title').map((b) => b.textContent)).toEqual(['On', 'Off'])
    expect(pressed(el, 'showIds.title')).toEqual(['true', 'false'])
    expect(rowButtons(el, 'showIds.files').map((b) => b.textContent)).toEqual(['Off', 'Number (#12)', 'Full ID (EMB-12)'])
    expect(pressed(el, 'showIds.files')).toEqual(['true', 'false', 'false'])
  })

  it('"in the files list" shows the vault\'s choice of three, and each saves its own', () => {
    const { el, saveShowIds } = withShowIds(true, { ...SHOW_IDS, files: 'number' })
    expect(pressed(el, 'showIds.files')).toEqual(['false', 'true', 'false'])
    act(() => rowButtons(el, 'showIds.files')[2].click())
    expect(saveShowIds).toHaveBeenLastCalledWith({ search: 'always', title: true, files: 'full' })
    act(() => rowButtons(el, 'showIds.files')[0].click())
    expect(saveShowIds).toHaveBeenLastCalledWith({ search: 'always', title: true, files: 'off' })
  })

  it('a click saves the one choice with the other two as they are', () => {
    const { el, saveShowIds } = withShowIds(true)
    act(() => rowButtons(el, 'showIds.title')[1].click())
    expect(saveShowIds).toHaveBeenLastCalledWith({ search: 'always', title: false, files: 'off' })
    act(() => rowButtons(el, 'showIds.files')[1].click())
    expect(saveShowIds).toHaveBeenLastCalledWith({ search: 'always', title: true, files: 'number' })
    act(() => rowButtons(el, 'showIds')[1].click())
    expect(saveShowIds).toHaveBeenLastCalledWith({ search: 'match', title: true, files: 'off' })
  })

  it('in a vault without IDs, or with no vault open, none of the three rows shows', () => {
    const { el } = withShowIds(false)
    expect(rowIds(el).filter((id) => id?.startsWith('showIds'))).toEqual([])
    unmount()
    const none = mountOn('Files & Links')
    expect(rowIds(none.el).filter((id) => id?.startsWith('showIds'))).toEqual([])
  })
})
