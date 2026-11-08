/**
 * Settings › Folder pages as the views read them (YAZ-4585, D34 of YAZ-4501): every reader takes the view's own key
 * first, then Settings; a menu choice equal to Settings removes the key; "from Settings" and Reset in the menus; the
 * calendar week can start on Sunday; and the view tab's right-click has "Open on this view" (D41) and "View settings…".
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
const rightClick = (el: Element): void => act(() => void el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 })))
function choose(select: HTMLSelectElement, value: string): void {
  act(() => {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
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
  it('fills each key the view lacks from Settings; the view’s own key wins; default Settings give the same object', () => {
    const view: ViewDef = { type: 'table', name: 'T', rowHeight: 'medium' }
    expect(withDefaults(view, DEFAULT_FOLDER_PAGES)).toBe(view)
    const all = fp({ rowHeight: 'tall', rowNumbers: false, groupIndent: 'large', showEmptyGroups: true, subfolders: 'both', foldersFirst: false, calendarScale: 'week', cardTitles: 'wrap', hideWeekends: true })
    expect(withDefaults(view, all)).toEqual({ type: 'table', name: 'T', rowHeight: 'medium', rowNumbers: false, groupIndent: 'large', showEmptyColumns: true, subfolders: 'both', foldersFirst: false, calendarScale: 'week', cardTitles: 'wrap', hideWeekends: true })
    expect(view).toEqual({ type: 'table', name: 'T', rowHeight: 'medium' })
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
    ;({ el } = mount(CALENDAR()))
    expect(days(el)[0]).toBe('2026-11-30')
    expect(weekdays(el)[0]).toBe('Mon')
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
    click(q(el, '.view-toolbar [aria-label="Properties"]'))
    const toggle = () => q<HTMLInputElement>(el, '.view-popover--properties [aria-label="Row numbers"]')
    const hint = () => toggle().closest('label')!.querySelector('.view-from-settings')
    expect(toggle().checked).toBe(false)
    expect(hint()?.textContent).toBe('from Settings')
    click(toggle())
    expect(yaml()).toContain('rowNumbers: true')
    expect(toggle().checked).toBe(true)
    expect(hint()?.textContent).toBe('Reset')
    click(hint()!)
    expect(yaml()).not.toContain('rowNumbers')
    expect(toggle().checked).toBe(false)
  })

  it('Sort and group › Indent and Subfolders: Settings’ value removes the key', () => {
    const { el, yaml } = mount(GROUPED, { folderPages: fp({ groupIndent: 'small', subfolders: 'rows' }) })
    click(q(el, '.view-toolbar [aria-label="Sort"]'))
    const indent = (step: string) => q<HTMLButtonElement>(el, `.view-popover--sort [data-indent="${step}"]`)
    expect(indent('small').getAttribute('aria-pressed')).toBe('true')
    click(indent('medium'))
    expect(yaml()).toContain('groupIndent: medium')
    click(indent('small'))
    expect(yaml()).not.toContain('groupIndent')
    const subfolders = () => q<HTMLSelectElement>(el, '.view-popover--sort [aria-label="Subfolders"]')
    expect(subfolders().value).toBe('rows')
    expect(subfolders().closest('label')!.querySelector('.view-from-settings')?.textContent).toBe('from Settings')
    choose(subfolders(), 'notes')
    expect(yaml()).toContain('subfolders: notes')
    choose(subfolders(), 'rows')
    expect(yaml()).not.toContain('subfolders')
  })

  it('Properties › Show empty groups and Calendar › Card titles read Settings and write the same way', () => {
    let { el, yaml } = mount(GROUPED, { folderPages: fp({ showEmptyGroups: true }) })
    click(q(el, '.view-toolbar [aria-label="Properties"]'))
    const empty = q<HTMLInputElement>(el, '.view-popover--properties .property-board-setting input')
    expect(empty.checked).toBe(true)
    click(empty)
    expect(yaml()).toContain('showEmptyColumns: false')
    act(() => root?.unmount())
    ;({ el, yaml } = mount(CALENDAR(), { folderPages: fp({ cardTitles: 'wrap' }) }))
    click(q(el, '.view-toolbar [aria-label="Properties"]'))
    const titles = () => q<HTMLSelectElement>(el, '.view-popover--properties [aria-label="Card titles"]')
    expect(titles().value).toBe('wrap')
    choose(titles(), 'clip')
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

  it('the menu is Rename, Duplicate, Open on this view, View settings…, Delete', () => {
    const { el } = mount(TWO)
    rightClick(tab(el, 'Second'))
    expect([...document.querySelectorAll('.ctx-menu [role^="menuitem"]')].map((b) => b.textContent)).toEqual(['Rename', 'Duplicate', 'Open on this view', 'View settings…', 'Export as CSV…', 'Copy as table', 'Delete'])
  })

  it('"Open on this view" writes defaultView, shows ✓, and clears it; the page opens on it', () => {
    const { el, yaml } = mount(TWO)
    rightClick(tab(el, 'Second'))
    click(menuItem('Open on this view'))
    expect(yaml()).toContain('defaultView: Second')
    rightClick(tab(el, 'Second'))
    expect(menuItem('✓ Open on this view').getAttribute('aria-checked')).toBe('true')
    const saved = yaml()
    act(() => root?.unmount())
    const again = mount(saved)
    expect(activeTab(again.el)).toBe('Second')
    rightClick(tab(again.el, 'Second'))
    click(menuItem('✓ Open on this view'))
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
