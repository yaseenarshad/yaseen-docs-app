/**
 * Settings › Folder pages as the views read them (YAZ-4585, D34 of YAZ-4501): every reader takes the view's own key
 * first, then Settings; a menu choice equal to Settings removes the key; "from Settings" and Reset in the menus; the
 * calendar week can start on Sunday; and the view tab's right-click has "Make default view" (D41, words YAZ-3746 13S) and "View settings…".
 * ViewsPane mounted with react-dom in jsdom.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_FOLDER_PAGES, type FolderPagesSettings, type IndexRecord } from '@shared/types'
import { type ParsedViews, type ViewDef, parseViews, serializeViews } from './viewSchema'
import { ViewsPane, type ViewsPaneProps } from './ViewsPane'
import { testFolderHost } from './testFolderHost'
import { TEST_RECORDS } from './testRecords'
import { chooseOwn, withDefaults } from './viewDefaults'
import { dropAllNoteWindows, noteWindowMemory } from './view/NoteWindow'
import { cellNotePinnedAtStart } from '../editor/table/cellNoteCard'

vi.mock('../lib/storage', () => ({ storage: { getViewGroups: () => [], setViewGroups: () => undefined } }))
vi.mock('./writeProperty', () => ({ writeProperty: vi.fn(), writeProperties: vi.fn() }))

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const fp = (over: Partial<FolderPagesSettings>): FolderPagesSettings => ({ ...DEFAULT_FOLDER_PAGES, ...over })
/** Settings › Folder pages with the YAZ-4779 / YAZ-4798 rows at the look before them: a view with no key needs nothing filled. */
const BEFORE: Partial<FolderPagesSettings> = { columnTypeIcons: false, stickyGroups: false, groupLines: 'off', folderCounts: true }

const rec = (path: string, properties: Record<string, unknown> = {}): IndexRecord => {
  const rel = path.slice('/vault/'.length)
  const name = rel.slice(rel.lastIndexOf('/') + 1)
  const title = name === '.folder.md' ? rel.split('/').at(-2)! : name.replace(/\.md$/, '')
  return { ...TEST_RECORDS[0], path, name, basename: name.replace(/\.md$/, ''), title, folder: rel.slice(0, rel.lastIndexOf('/')), properties }
}
const NOTES = [rec('/vault/Page/Alpha.md', { tags: ['a', 'b'], status: 'open', due: '2026-12-08' }), rec('/vault/Page/Sub/Beta.md', { tags: ['c'], status: 'done', due: '2026-12-09' })]
const FOLDER_ROWS = [{ ...rec('/vault/Page/Sub/.folder.md'), folder: 'Page' }]

let root: Root | null = null
let container: HTMLElement | null = null

function mount(text: string, props: Partial<ViewsPaneProps> = {}) {
  let parsed = parseViews(text)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const draw = () =>
    act(() =>
      root?.render(
        <ViewsPane
          parsed={parsed}
          onChange={(next: ParsedViews) => {
            parsed = next
            draw()
          }}
          root="/vault"
          folderPath="/vault/Page"
          records={NOTES}
          folderRows={FOLDER_ROWS}
          folder={testFolderHost({ vaultRecords: NOTES, renderNoteEditor: (path) => <div className="stub-editor">{path}</div> })}
          onOpenFile={vi.fn()}
          {...props}
        />,
      ),
    )
  draw()
  return { el: container, yaml: () => serializeViews(parsed), views: () => parsed.def.views, def: () => parsed.def }
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  dropAllNoteWindows()
  vi.useRealTimers()
})

const q = <T extends Element>(el: ParentNode, sel: string): T => {
  const n = el.querySelector<T>(sel)
  if (n === null) throw new Error(`missing ${sel}`)
  return n
}
const click = (el: Element): void => act(() => void el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
/** The Properties popover on its View tab (YAZ-4607 D59), where the view settings live. */
const openView = (el: ParentNode): void => {
  click(q(el, '.view-toolbar [aria-label="Columns and view"]'))
  click(q(el, '.view-popover--properties .view-menu__tab[data-tab="view"]'))
}
const rightClick = (el: Element): void => act(() => void el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 })))
function choose(select: HTMLSelectElement, value: string): void {
  act(() => {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
/** A segmented choice of the View tab (`ChoiceSeg`): its pressed option's text, and a click on an option. */
const pressedIn = (el: ParentNode, label: string): string | undefined => [...el.querySelectorAll<HTMLButtonElement>(`.view-popover--properties [role="group"][aria-label="${label}"] button`)].find((b) => b.getAttribute('aria-pressed') === 'true')?.textContent ?? undefined
const pick = (el: ParentNode, label: string, text: string): void => click([...el.querySelectorAll<HTMLButtonElement>(`.view-popover--properties [role="group"][aria-label="${label}"] button`)].find((b) => b.textContent === text)!)
/** The slot after a row's control (`FromSettings`): empty while the view follows Settings, the ↺ "Reset to Settings" once it has its own value. */
const follows = (slot: Element | null | undefined): boolean => slot != null && !slot.classList.contains('view-from-settings--reset')
const resetIn = (slot: Element | null | undefined): HTMLElement | null => (slot?.matches('[aria-label="Reset to Settings"]') ? (slot as HTMLElement) : null)
const menuItem = (text: string): HTMLElement => {
  const found = [...document.querySelectorAll<HTMLElement>('.ctx-menu [role^="menuitem"]')].find((b) => b.textContent === text)
  if (found === undefined) throw new Error(`no item ${text}`)
  return found
}
/** A row's title as the eye reads it, without a folder row's "N inside". */
const names = (el: ParentNode) =>
  [...el.querySelectorAll('.view-table__name')].map((n) => {
    const copy = n.cloneNode(true) as Element
    copy.querySelector('.view-folder-row__inside')?.remove()
    return copy.textContent ?? ''
  })

const table = (extra = '') => `views:
  - type: table
    name: T
    order:
      - file.name
      - note.tags
      - note.status
    sort:
      - property: file.name
        direction: ASC
${extra}`
const GROUPED = table('    groupBy:\n      property: note.status\n')
const CALENDAR = (extra = '') => `views:\n  - type: calendar\n    name: C\n${extra}`

describe('withDefaults and chooseOwn (YAZ-4585)', () => {
  it('fills each key the view lacks from Settings; the view’s own key wins; a view that needs nothing filled is the same object', () => {
    const view: ViewDef = { type: 'table', name: 'T', rowHeight: 'medium' }
    // Show empty groups is on by default (YAZ-3746 demo round 2): a Table with no key of its own shows its empty groups.
    // Column type icons (YAZ-4779), sticky group headers and group lines on hover (YAZ-4798) are on by default too: every
    // view with no key of its own takes them (plain lines are the look before, so `groupLineStyle` is not filled).
    // The notes inside count is off by default (YAZ-4848): a view with no key of its own reads it off.
    const NEW_ON = { columnTypeIcons: true, stickyGroups: true, groupLines: 'hover', folderCounts: false } as const
    expect(withDefaults(view, DEFAULT_FOLDER_PAGES)).toEqual({ ...view, ...NEW_ON, showEmptyColumns: true })
    const board: ViewDef = { type: 'board', name: 'B' }
    expect(withDefaults(board, DEFAULT_FOLDER_PAGES)).toEqual({ ...board, ...NEW_ON })
    // Settings at the look before: nothing to fill, the same object.
    expect(withDefaults(board, fp(BEFORE))).toBe(board)
    expect(withDefaults(view, fp({ ...BEFORE, showEmptyGroups: false }))).toBe(view)
    const all = fp({ ...BEFORE, rowHeight: 'tall', rowNumbers: false, groupIndent: 'large', showEmptyGroups: true, subfolders: 'both', foldersFirst: false, calendarScale: 'week', cardTitles: 'wrap', hideWeekends: true })
    expect(withDefaults(view, all)).toEqual({ type: 'table', name: 'T', rowHeight: 'medium', rowNumbers: false, groupIndent: 'large', showEmptyColumns: true, subfolders: 'both', foldersFirst: false, calendarScale: 'week', cardTitles: 'wrap', hideWeekends: true })
    expect(view).toEqual({ type: 'table', name: 'T', rowHeight: 'medium' })
  })

  it('C2 (YAZ-4608): a Table’s showEmptyColumns reads "Show empty groups", a Board’s reads "Show empty columns"', () => {
    const table: ViewDef = { type: 'table', name: 'T' }
    const board: ViewDef = { type: 'board', name: 'B' }
    expect(withDefaults(table, fp({ showEmptyGroups: true })).showEmptyColumns).toBe(true)
    expect(withDefaults(board, fp({ ...BEFORE, showEmptyGroups: true }))).toBe(board)
    expect(withDefaults(board, fp({ showEmptyColumns: true })).showEmptyColumns).toBe(true)
    expect(withDefaults(table, fp({ ...BEFORE, showEmptyGroups: false, showEmptyColumns: true }))).toBe(table)
    // A choice equal to the part the view reads removes the key; the other part does not count.
    const b: ViewDef = { type: 'board', name: 'B', showEmptyColumns: true }
    chooseOwn(b, 'showEmptyColumns', true, fp({ showEmptyColumns: true, showEmptyGroups: false }))
    expect(b).not.toHaveProperty('showEmptyColumns')
    chooseOwn(b, 'showEmptyColumns', true, fp({ showEmptyGroups: true }))
    expect(b.showEmptyColumns).toBe(true)
  })

  it('a choice equal to Settings removes the key; any other is written, the built-in value too', () => {
    const v: ViewDef = { type: 'table', name: 'T', groupIndent: 'large' }
    chooseOwn(v, 'groupIndent', 'medium', DEFAULT_FOLDER_PAGES)
    expect(v).not.toHaveProperty('groupIndent')
    chooseOwn(v, 'groupIndent', 'medium', fp({ groupIndent: 'small' }))
    expect(v.groupIndent).toBe('medium')
    chooseOwn(v, 'subfolders', 'notes', fp({ subfolders: 'rows' }))
    expect(v.subfolders).toBe('notes')
  })
})

describe('each reader: no view key → Settings; a view key → the view (YAZ-4585)', () => {
  it('row height', () => {
    const rowH = (el: ParentNode) => q<HTMLElement>(el, '.view-table').style.getPropertyValue('--view-table-row-h')
    expect(rowH(mount(table(), { folderPages: fp({ rowHeight: 'tall' }) }).el)).toBe('68px')
    act(() => root?.unmount())
    expect(rowH(mount(table('    rowHeight: medium\n'), { folderPages: fp({ rowHeight: 'tall' }) }).el)).toBe('44px')
  })

  it('row numbers', () => {
    // Off leaves the slim strip with no numbers (YAZ-4610 D62).
    expect(mount(table(), { folderPages: fp({ rowNumbers: false }) }).el.querySelector('td.view-table__gutter')?.classList.contains('view-table__gutter--slim')).toBe(true)
    act(() => root?.unmount())
    expect(mount(table('    rowNumbers: true\n'), { folderPages: fp({ rowNumbers: false }) }).el.querySelector('td.view-table__gutter')?.classList.contains('view-table__gutter--slim')).toBe(false)
  })

  it('text in cells: Clip clips the chip column too; a column’s own Wrap beats it; By kind is the old rule', () => {
    const clipped = (el: ParentNode, c: number) => [...el.querySelectorAll<HTMLElement>(`.view-table tbody td[data-cell$=":${c}"]`)].every((td) => td.classList.contains('view-table__cell--clip'))
    let { el } = mount(table(), { folderPages: fp({ textInCells: 'clip' }) })
    expect(clipped(el, 1)).toBe(true)
    act(() => root?.unmount())
    ;({ el } = mount(table('    columnWrap:\n      note.tags: true\n'), { folderPages: fp({ textInCells: 'clip' }) }))
    expect(clipped(el, 1)).toBe(false)
    act(() => root?.unmount())
    ;({ el } = mount(table(), { folderPages: fp({ textInCells: 'wrap' }) }))
    expect(clipped(el, 2)).toBe(false)
    act(() => root?.unmount())
    ;({ el } = mount(table()))
    expect([clipped(el, 1), clipped(el, 2)]).toEqual([false, true])
  })

  it('group indent', () => {
    const indent = (el: ParentNode) => q<HTMLElement>(el, '.view-table').style.getPropertyValue('--view-group-indent')
    expect(indent(mount(GROUPED, { folderPages: fp({ groupIndent: 'large' }) }).el)).toBe('42px')
    act(() => root?.unmount())
    expect(indent(mount(GROUPED.replace('    groupBy:', '    groupIndent: small\n    groupBy:'), { folderPages: fp({ groupIndent: 'large' }) }).el)).toBe('14px')
  })

  it('subfolders and folders first', () => {
    expect(names(mount(table(), { folderPages: fp({ subfolders: 'rows' }) }).el)).toEqual(['Sub', 'Alpha'])
    act(() => root?.unmount())
    expect(names(mount(table(), { folderPages: fp({ subfolders: 'both', foldersFirst: false }) }).el)).toEqual(['Alpha', 'Beta', 'Sub'])
    act(() => root?.unmount())
    expect(names(mount(table('    subfolders: notes\n'), { folderPages: fp({ subfolders: 'rows' }) }).el)).toEqual(['Alpha', 'Beta'])
    act(() => root?.unmount())
    expect(names(mount(table('    subfolders: both\n    foldersFirst: true\n'), { folderPages: fp({ foldersFirst: false }) }).el)).toEqual(['Sub', 'Alpha', 'Beta'])
  })

  it('calendar scale, card titles, and the week start', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 11, 10, 12, 0))
    const weekdays = (el: ParentNode) => [...el.querySelectorAll('.view-cal__weekday')].map((d) => d.textContent)
    const days = (el: ParentNode) => [...el.querySelectorAll('.view-cal__day')].map((d) => d.getAttribute('data-day'))
    let { el } = mount(CALENDAR(), { folderPages: fp({ calendarScale: 'week', cardTitles: 'wrap', weekStartsOn: 'sunday' }) })
    expect(days(el)).toEqual(['2026-12-06', '2026-12-07', '2026-12-08', '2026-12-09', '2026-12-10', '2026-12-11', '2026-12-12'])
    expect(weekdays(el)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])
    expect(q(el, '.view-cal__card').classList.contains('view-cal__card--wrap')).toBe(true)
    act(() => root?.unmount())
    ;({ el } = mount(CALENDAR('    calendarScale: month\n    cardTitles: clip\n'), { folderPages: fp({ calendarScale: 'week', cardTitles: 'wrap', weekStartsOn: 'sunday' }) }))
    // December 2026 starts on a Tuesday: Sunday first, its grid starts on Sunday 29 November.
    expect(days(el)[0]).toBe('2026-11-29')
    expect(weekdays(el)[0]).toBe('Sun')
    expect(q(el, '.view-cal__card').classList.contains('view-cal__card--wrap')).toBe(false)
    act(() => root?.unmount())
    // Monday first: its grid starts on Monday 30 November.
    ;({ el } = mount(CALENDAR(), { folderPages: fp({ weekStartsOn: 'monday' }) }))
    expect(days(el)[0]).toBe('2026-11-30')
    expect(weekdays(el)[0]).toBe('Mon')
    act(() => root?.unmount())
    // The default week starts on Sunday (YAZ-3746 demo round 2).
    ;({ el } = mount(CALENDAR()))
    expect(days(el)[0]).toBe('2026-11-29')
    expect(weekdays(el)[0]).toBe('Sun')
  })

  it('the note window’s pin: Settings › Folder pages, else "Keep cell notes open"', () => {
    expect(noteWindowMemory('/a.md', false).pinned).toBe(false)
    expect(noteWindowMemory('/a.md', true).pinned).toBe(true)
    expect(noteWindowMemory('/a.md').pinned).toBe(cellNotePinnedAtStart())
    const { el } = mount(table(), { folderPages: fp({ keepWindowPinned: false }) })
    rightClick([...el.querySelectorAll('.view-table__name')][0])
    click(menuItem('Open in mini window'))
    expect(q(document, '.note-window [aria-label="Pin mini window"]').getAttribute('aria-pressed')).toBe('false')
  })
})

describe('the menus: "from Settings", Reset, and a choice equal to Settings (YAZ-4585)', () => {
  it('Properties › Row numbers: from Settings with no key; a choice off Settings writes it, then Reset removes it', () => {
    const { el, yaml } = mount(table(), { folderPages: fp({ rowNumbers: false }) })
    openView(el)
    const toggle = () => q<HTMLInputElement>(el, '.view-popover--properties [aria-label="Row numbers"]')
    const hint = () => toggle().closest('label')!.querySelector('.view-from-settings')
    expect(toggle().checked).toBe(false)
    expect(follows(hint())).toBe(true)
    click(toggle())
    expect(yaml()).toContain('rowNumbers: true')
    expect(toggle().checked).toBe(true)
    expect(resetIn(hint())).not.toBeNull()
    click(resetIn(hint())!)
    expect(yaml()).not.toContain('rowNumbers')
    expect(toggle().checked).toBe(false)
  })

  it('Properties › Row height (YAZ-4544 10A): from Settings with no key; a choice off Settings writes it and the rows follow; Reset removes it', () => {
    const { el, yaml } = mount(table(), { folderPages: fp({ rowHeight: 'tall' }) })
    openView(el)
    // A segmented choice since the YAZ-3746 demo; the slot after it is empty while the view follows Settings.
    const hint = () => q(el, '.view-popover--properties [role="group"][aria-label="Row height"]').closest('.view-settings-row')!.querySelector('.view-from-settings')
    const rowH = () => q<HTMLElement>(el, '.view-table').style.getPropertyValue('--view-table-row-h')
    expect(pressedIn(el, 'Row height')).toBe('Tall')
    expect(follows(hint())).toBe(true)
    pick(el, 'Row height', 'Medium')
    expect(yaml()).toContain('rowHeight: medium')
    expect(rowH()).toBe('44px')
    expect(resetIn(hint())).not.toBeNull()
    pick(el, 'Row height', 'Tall')
    expect(yaml()).not.toContain('rowHeight')
    pick(el, 'Row height', 'Short')
    click(resetIn(hint())!)
    expect(yaml()).not.toContain('rowHeight')
    expect(rowH()).toBe('68px')
  })

  it('Properties › Text in cells (YAZ-4544 10A): a view-wide default under the column’s own choice and over Settings; from Settings and Reset', () => {
    const clipped = (c: number) => [...el.querySelectorAll<HTMLElement>(`.view-table tbody td[data-cell$=":${c}"]`)].every((td) => td.classList.contains('view-table__cell--clip'))
    const { el, yaml } = mount(table('    columnWrap:\n      note.status: true\n'))
    openView(el)
    const hint = () => q(el, '.view-popover--properties [role="group"][aria-label="Text in cells"]').closest('.view-settings-row')!.querySelector('.view-from-settings')
    expect(pressedIn(el, 'Text in cells')).toBe('By kind')
    expect(follows(hint())).toBe(true)
    expect([clipped(1), clipped(2)]).toEqual([false, false])
    pick(el, 'Text in cells', 'Clip')
    expect(yaml()).toContain('textInCells: clip')
    // The view clips the chip column; the Status column's own Wrap still wins.
    expect([clipped(1), clipped(2)]).toEqual([true, false])
    expect(resetIn(hint())).not.toBeNull()
    click(resetIn(hint())!)
    expect(yaml()).not.toContain('textInCells')
    expect([clipped(1), clipped(2)]).toEqual([false, false])
  })

  it('a view’s Text in cells beats Settings’ (YAZ-4544 10A)', () => {
    const clipped = (el: ParentNode, c: number) => [...el.querySelectorAll<HTMLElement>(`.view-table tbody td[data-cell$=":${c}"]`)].every((td) => td.classList.contains('view-table__cell--clip'))
    const { el } = mount(table('    textInCells: wrap\n'), { folderPages: fp({ textInCells: 'clip' }) })
    expect(clipped(el, 1)).toBe(false)
    expect(clipped(el, 2)).toBe(false)
  })

  // Both moved from the ⇅ popover to Properties › View (YAZ-4607 D60): Group indent under Groups, Subfolders under Rows.
  it('Properties › View › Group indent and Subfolders: Settings’ value removes the key', () => {
    const { el, yaml } = mount(GROUPED, { folderPages: fp({ groupIndent: 'small', subfolders: 'rows' }) })
    openView(el)
    const indent = (step: string) => q<HTMLButtonElement>(el, `.view-popover--properties [data-indent="${step}"]`)
    expect(indent('small').getAttribute('aria-pressed')).toBe('true')
    click(indent('medium'))
    expect(yaml()).toContain('groupIndent: medium')
    click(indent('small'))
    expect(yaml()).not.toContain('groupIndent')
    const subfolders = () => q<HTMLSelectElement>(el, '.view-popover--properties [aria-label="Subfolders"]')
    expect(subfolders().value).toBe('rows')
    expect(follows(subfolders().closest('label')!.querySelector('.view-from-settings'))).toBe(true)
    choose(subfolders(), 'notes')
    expect(yaml()).toContain('subfolders: notes')
    choose(subfolders(), 'rows')
    expect(yaml()).not.toContain('subfolders')
  })

  it('Properties › Show empty groups and Calendar › Card titles read Settings and write the same way', () => {
    let { el, yaml } = mount(GROUPED, { folderPages: fp({ showEmptyGroups: true }) })
    openView(el)
    const empty = q<HTMLInputElement>(el, '.view-popover--properties .property-board-setting input')
    expect(empty.checked).toBe(true)
    click(empty)
    expect(yaml()).toContain('showEmptyColumns: false')
    act(() => root?.unmount())
    // A Board reads Settings' "Show empty columns", not "Show empty groups" (YAZ-4608 C2).
    ;({ el, yaml } = mount('views:\n  - type: board\n    name: B\n    groupBy:\n      property: note.status\n', { folderPages: fp({ showEmptyGroups: true }) }))
    openView(el)
    const board = () => q<HTMLInputElement>(el, '.view-popover--properties .property-board-setting input')
    expect(board().closest('label')?.textContent).toContain('Show empty columns')
    expect(board().checked).toBe(false)
    act(() => root?.unmount())
    ;({ el, yaml } = mount('views:\n  - type: board\n    name: B\n    groupBy:\n      property: note.status\n', { folderPages: fp({ showEmptyColumns: true }) }))
    openView(el)
    expect(board().checked).toBe(true)
    click(board())
    expect(yaml()).toContain('showEmptyColumns: false')
    act(() => root?.unmount())
    ;({ el, yaml } = mount(CALENDAR(), { folderPages: fp({ cardTitles: 'wrap' }) }))
    openView(el)
    expect(pressedIn(el, 'Card titles')).toBe('Wrap')
    pick(el, 'Card titles', 'Clip')
    expect(yaml()).toContain('cardTitles: clip')
  })

  it('the calendar’s Month / Week switch: Settings’ scale removes the key', () => {
    const { el, yaml } = mount(CALENDAR(), { folderPages: fp({ calendarScale: 'week' }) })
    const scale = (name: string) => q<HTMLButtonElement>(el, `[aria-label="Calendar scale"] [data-scale="${name}"]`)
    expect(scale('week').getAttribute('aria-pressed')).toBe('true')
    click(scale('month'))
    expect(yaml()).toContain('calendarScale: month')
    click(scale('week'))
    expect(yaml()).not.toContain('calendarScale')
  })
})

describe('the view tab right-click (YAZ-4585, D41)', () => {
  const TWO = 'views:\n  - type: table\n    name: First\n  - type: board\n    name: Second\n'
  const tab = (el: ParentNode, name: string) => [...el.querySelectorAll<HTMLElement>('.view-tab')].find((t) => t.textContent === name)!
  const activeTab = (el: ParentNode) => el.querySelector('[role="tab"][aria-selected="true"]')?.textContent

  it('the menu is Rename, Duplicate, Make default view, View settings…, the two exports, Delete', () => {
    const { el } = mount(TWO)
    rightClick(tab(el, 'Second'))
    expect([...document.querySelectorAll('.ctx-menu [role^="menuitem"]')].map((b) => b.textContent)).toEqual(['Rename', 'Duplicate', 'Make default view', 'View settings…', 'Export as CSV…', 'Copy as table', 'Delete'])
  })

  it('"Make default view" writes defaultView, then reads "✓ Default view", and clears it; the page opens on it', () => {
    const { el, yaml } = mount(TWO)
    rightClick(tab(el, 'Second'))
    click(menuItem('Make default view'))
    expect(yaml()).toContain('defaultView: Second')
    rightClick(tab(el, 'Second'))
    expect(menuItem('✓ Default view').getAttribute('aria-checked')).toBe('true')
    const saved = yaml()
    act(() => root?.unmount())
    const again = mount(saved)
    expect(activeTab(again.el)).toBe('Second')
    rightClick(tab(again.el, 'Second'))
    click(menuItem('✓ Default view'))
    expect(again.yaml()).not.toContain('defaultView')
  })

  it('"View settings…" makes the view active and opens its Properties menu; the Page has none (YAZ-4584 D38)', () => {
    const { el } = mount(`${TWO}  - type: page\n    name: Notes\n`)
    rightClick(tab(el, 'Second'))
    click(menuItem('View settings…'))
    expect(activeTab(el)).toBe('Second')
    expect(el.querySelector('.view-popover--properties')).not.toBeNull()
    rightClick(tab(el, 'Notes'))
    expect((menuItem('View settings…') as HTMLButtonElement).disabled).toBe(true)
  })
})
