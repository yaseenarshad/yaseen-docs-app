/**
 * View chrome (GRO-2135): ViewsPane mounted with react-dom in jsdom over `TEST_RECORDS` and
 * Yasin's base. `onChange` is a spy that swaps in the new `ParsedViews` and re-renders, so every
 * assertion can read the YAML the file would get (`serializeViews`) next to the DOM.
 *
 * YAZ-846: the mount is a FOLDER PAGE's contents block, because that is the only mount there is.
 * Two consequences run through this file — the **Filter** menu is gone (a folder page's set IS
 * the lookup, 🔒 Q3), and the tabs are SWITCH-ONLY — the editable tab half was deleted with its
 * last reachable surface (view management is parked on YAZ-824).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { type ViewSet, type ViewDef, type ParsedViews, parseViews, serializeViews } from '../viewSchema'
import { ViewsPane, type ViewsPaneProps } from '../ViewsPane'
import { testFolderPage } from '../testFolderPage'
import { TEST_RECORDS } from '../testRecords'

/** The document skin's editor is a real Crepe instance; the toolbar's own chrome is what is under test. */
vi.mock('./OutlineEditor', () => ({ OutlineEditor: () => null }))

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/** YAZ-846: `folderPage` is required — the contents block is the only mount there is. */
const FOLDER_PAGE = testFolderPage()

/** Yasin's real base (also pinned in viewSchema.test.ts and engine.test.ts). */
const YASIN_BASE = `views:
  - type: table
    name: Table
    order:
      - file.name
    sort:
      - property: formula.Untitled
        direction: ASC
  - type: cards
    name: View
  - type: table
    name: View 2
    indentProperties: false
`

let root: Root | null = null
let container: HTMLElement | null = null
let draw: () => void = () => {}

function mount(text = YASIN_BASE, props: Partial<ViewsPaneProps> = {}) {
  let parsed = parseViews(text)
  const onOpenFile = vi.fn()
  const onChange = vi.fn((next: ParsedViews) => {
    parsed = next
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  draw = () =>
    act(() =>
      root?.render(
        <ViewsPane
          parsed={parsed}
          onChange={onChange}
          root={null}
          thisFile={null}
          records={TEST_RECORDS}
          folderPage={FOLDER_PAGE}
          onOpenFile={onOpenFile}
          {...props}
        />,
      ),
    )
  draw()
  const el = container
  return { el, onChange, onOpenFile, yaml: () => serializeViews(parsed), def: (): ViewSet => parsed.def }
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

// ---------- DOM helpers ----------

function q<T extends Element>(el: ParentNode, sel: string): T {
  const n = el.querySelector<T>(sel)
  if (n === null) throw new Error(`missing ${sel}`)
  return n
}

const byLabel = <T extends HTMLElement>(el: ParentNode, label: string): T => q<T>(el, `[aria-label="${label}"]`)

function byText<T extends HTMLElement>(el: ParentNode, sel: string, text: string): T {
  const n = [...el.querySelectorAll<T>(sel)].find((x) => x.textContent === text)
  if (n === undefined) throw new Error(`missing ${sel} "${text}"`)
  return n
}

function click(el: Element): void {
  act(() => (el as HTMLElement).click())
  draw()
}

/** Native prototype setter + bubbling event, so React's value tracker sees the change. */
function setValue(el: HTMLInputElement | HTMLSelectElement, value: string): void {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  const set = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  act(() => {
    set?.call(el, value)
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
  draw()
}

function press(el: Element, key: string): void {
  act(() => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))
  draw()
}

/** Type into a TextField and commit with Enter (one onChange). */
function type(el: HTMLInputElement, text: string): void {
  setValue(el, text)
  press(el, 'Enter')
}

const tabs = (el: ParentNode): string[] => [...el.querySelectorAll('[role="tab"]')].map((t) => t.textContent ?? '')
const selected = (el: ParentNode): string | undefined => [...el.querySelectorAll('[role="tab"]')].find((t) => t.getAttribute('aria-selected') === 'true')?.textContent ?? undefined
/** Note links in the body: the table's name cells (4B) or the placeholder list of other view types. */
const rows = (el: ParentNode): string[] => [...el.querySelectorAll('.view-table__link, .view-row__link')].map((b) => b.textContent ?? '')
const count = (el: ParentNode): string => q(el, '.view-toolbar__count').textContent ?? ''
const openMenu = (el: ParentNode, label: string): HTMLElement => {
  click(byLabel(el, label))
  return q(el, '.view-popover')
}

// ---------- tests ----------

describe('view switcher', () => {
  it('renders the tabs, count and the rows of the active view', () => {
    const { el, onChange } = mount()
    expect(tabs(el)).toEqual(['Table', 'View', 'View 2'])
    expect(selected(el)).toBe('Table')
    expect(count(el)).toBe('8 items')
    expect(rows(el)).toHaveLength(8)
    expect(rows(el)[0]).toBe('Agentic Agency.md')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('clicking a tab switches views without writing', () => {
    const { el, onChange } = mount()
    click(byText(el, '[role="tab"]', 'View 2'))
    expect(selected(el)).toBe('View 2')
    expect(onChange).not.toHaveBeenCalled()
  })

  // 🔒 rule 4 (YAZ-819), unconditional since YAZ-846: view CRUD is not this block's gesture. The
  // four write-throughs that used to be proved here — "+", rename, duplicate, delete, move —
  // moved down to `ViewTabs`' own mount, which is the only place its editable half is reachable.
  it('the tabs are SWITCH-ONLY: no "+", no "…" menu, no right-click menu', () => {
    const { el, onChange } = mount()
    expect(el.querySelector('[aria-label="Add view"]')).toBeNull()
    expect(el.querySelector('[aria-label="View menu"]')).toBeNull()
    act(() => byText(el, '[role="tab"]', 'Table').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    draw()
    expect(el.querySelector('[role="menu"]')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('sort menu', () => {
  it('add / retarget / flip write view.sort in order; remove deletes the key', () => {
    const { el, onChange, def, yaml } = mount()
    const pop = openMenu(el, 'Sort')
    click(byLabel(pop, 'Remove sort')) // drop the dangling formula.Untitled sort
    expect(def().views[0].sort).toBeUndefined()
    expect(yaml()).not.toContain('sort:')
    click(byText(pop, 'button', 'Add sort'))
    expect(def().views[0].sort).toEqual([{ property: 'file.name', direction: 'ASC' }])
    setValue(byLabel(pop, 'Sort property'), 'note.priority')
    click(byLabel(pop, 'Direction'))
    expect(onChange).toHaveBeenCalledTimes(4)
    expect(def().views[0].sort).toEqual([{ property: 'note.priority', direction: 'DESC' }])
    expect(rows(el).slice(0, 3)).toEqual(['Creator Economy.md', 'Agentic Agency.md', 'The Levels of an Agency.md'])
  })

  it('a second sort can move above the first', () => {
    const { el, def } = mount()
    const pop = openMenu(el, 'Sort')
    click(byText(pop, 'button', 'Add sort'))
    expect(def().views[0].sort?.map((s) => s.property)).toEqual(['formula.Untitled', 'file.name'])
    click([...pop.querySelectorAll('[aria-label="Move up"]')][1])
    expect(def().views[0].sort?.map((s) => s.property)).toEqual(['file.name', 'formula.Untitled'])
  })

  it('Group by writes view.groupBy, counts in the Sort badge, and None deletes it', () => {
    const { el, onChange, def, yaml } = mount()
    expect(byText(el, '.view-toolbar__badge', '1')).toBeDefined() // the existing sort
    const pop = openMenu(el, 'Sort')
    setValue(byLabel(pop, 'Group by'), 'note.status')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(def().views[0].groupBy).toEqual({ property: 'note.status', direction: 'ASC' })
    expect(yaml()).toContain('groupBy:')
    expect(byText(el, '.view-toolbar__badge', '2')).toBeDefined()
    click(byLabel(pop, 'Group direction'))
    expect(def().views[0].groupBy).toEqual({ property: 'note.status', direction: 'DESC' })
    setValue(byLabel(pop, 'Group by'), '')
    expect(def().views[0].groupBy).toBeUndefined()
  })
})

describe('collapse all groups', () => {
  const GROUPED = 'views:\n  - type: table\n    name: T\n    groupBy:\n      property: note.status\n'

  it('the toggle is there only when the view is grouped', () => {
    expect(mount().el.querySelector('[aria-label="Collapse all groups"]')).toBeNull()
    expect(mount(GROUPED).el.querySelector('[aria-label="Collapse all groups"]')).not.toBeNull()
  })

  it('one click collapses every group, the next expands them, and neither writes the file', () => {
    const { el, onChange } = mount(GROUPED)
    expect(rows(el)).toHaveLength(8)
    click(byLabel(el, 'Collapse all groups'))
    expect(rows(el)).toEqual([])
    expect([...el.querySelectorAll('.view-group__toggle')].map((t) => t.getAttribute('aria-expanded'))).toEqual(['false', 'false', 'false', 'false'])
    click(byLabel(el, 'Expand all groups'))
    expect(rows(el)).toHaveLength(8)
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('properties menu', () => {
  it('offers a Table-only Frozen columns select over the visible positional prefix', () => {
    const { el } = mount('views:\n  - type: table\n    name: Table\n    order:\n      - file.name\n      - note.status\n      - note.priority\n  - type: cards\n    name: Cards\n')
    const table = openMenu(el, 'Properties')
    const select = byLabel<HTMLSelectElement>(table, 'Frozen columns')
    expect([...select.options].map((option) => option.textContent)).toEqual(['None', '1 — through file.name', '2 — through status', '3 — through priority'])
    expect(select.value).toBe('0')

    click(byText(el, '[role="tab"]', 'Cards'))
    expect(byLabel(el, 'Properties').getAttribute('aria-expanded')).toBe('true')
    expect(q(el, '.view-popover').querySelector('[aria-label="Frozen columns"]')).toBeNull()
  })

  it('writes the selected frozen prefix once; choosing None deletes the optional key', () => {
    const { el, onChange, def, yaml } = mount('views:\n  - type: table\n    name: T\n    order:\n      - file.name\n      - note.status\n')
    const select = byLabel<HTMLSelectElement>(openMenu(el, 'Properties'), 'Frozen columns')

    setValue(select, '2')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(def().views[0].frozenColumns).toBe(2)
    expect(yaml()).toContain('frozenColumns: 2')

    setValue(select, '0')
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(def().views[0].frozenColumns).toBeUndefined()
    expect(yaml()).not.toContain('frozenColumns')
  })

  it('clamps after hides, leaves restored columns outside the prefix, and follows reorder positionally', () => {
    const { el, def } = mount('views:\n  - type: table\n    name: T\n    frozenColumns: 2\n    order:\n      - file.name\n      - note.status\n      - note.priority\n')
    const pop = openMenu(el, 'Properties')

    click(byLabel(pop, 'Show priority'))
    expect(def().views[0].frozenColumns).toBe(2)
    click(byLabel(pop, 'Show status'))
    expect(def().views[0].order).toEqual(['file.name'])
    expect(def().views[0].frozenColumns).toBe(1)

    click(byLabel(pop, 'Show status'))
    expect(def().views[0].order).toEqual(['file.name', 'note.status'])
    expect(def().views[0].frozenColumns).toBe(1)
    click([...pop.querySelectorAll('[aria-label="Move up"]')][1])
    expect(def().views[0].order).toEqual(['note.status', 'file.name'])
    expect(def().views[0].frozenColumns).toBe(1)
  })

  it('a table can hide and re-show file.name through view.order', () => {
    const { el, onChange, def } = mount()
    const pop = openMenu(el, 'Properties')
    const name = byLabel<HTMLInputElement>(pop, 'Show file.name')
    expect(name.checked).toBe(true)
    expect(name.disabled).toBe(false)

    click(byLabel(pop, 'Show status'))
    expect(def().views[0].order).toEqual(['file.name', 'note.status'])
    expect(q(el, '[data-cell="0:1"]').textContent).toBe('idea')

    click(byLabel(pop, 'Show file.name'))
    expect(def().views[0].order).toEqual(['note.status'])
    expect([...el.querySelectorAll('.view-table thead th')].map((th) => th.textContent)).toEqual(['status'])
    expect(q(el, '[data-cell="0:0"]').textContent).toBe('idea')
    expect(el.querySelector('.view-table__link')).toBeNull()

    click(byLabel(pop, 'Show file.name'))
    expect(def().views[0].order).toEqual(['note.status', 'file.name'])
    expect([...el.querySelectorAll('.view-table thead th')].map((th) => th.textContent)).toEqual(['status', 'file.name'])
    expect(el.querySelector('.view-table__link')).not.toBeNull()
    expect(onChange).toHaveBeenCalledTimes(3)
  })

  it.each(['cards', 'list', 'board'])('keeps file.name disabled in %s views', (type) => {
    const { el } = mount(`views:\n  - type: ${type}\n    name: V\n`)
    expect(byLabel<HTMLInputElement>(openMenu(el, 'Properties'), 'Show file.name').disabled).toBe(true)
  })

  it('allows an empty table order and keeps Properties available to restore file.name', () => {
    const { el, def } = mount('views:\n  - type: table\n    name: T\n    order:\n      - file.name\n')
    const pop = openMenu(el, 'Properties')
    click(byLabel(pop, 'Show file.name'))
    expect(def().views[0].order).toEqual([])
    expect(el.querySelector('.view-table thead th')).toBeNull()
    expect(byLabel<HTMLInputElement>(pop, 'Show file.name').checked).toBe(false)
    click(byLabel(pop, 'Show file.name'))
    expect(def().views[0].order).toEqual(['file.name'])
  })

  it('up/down reorder the shown keys only', () => {
    const { el, def } = mount('views:\n  - type: table\n    name: T\n    order:\n      - file.name\n      - note.status\n      - note.priority\n')
    const pop = openMenu(el, 'Properties')
    const ups = [...pop.querySelectorAll<HTMLButtonElement>('[aria-label="Move up"]')]
    expect(ups[0].disabled).toBe(true) // file.name row
    click(ups[2]) // note.priority above note.status
    expect(def().views[0].order).toEqual(['file.name', 'note.priority', 'note.status'])
  })

  it('the folder page’s DECLARED columns are offered too, valueless or not (YAZ-895)', () => {
    const settings = { columns: { owner: { kind: 'link' as const } }, views: [], problems: [] }
    const { el } = mount(undefined, { folderPage: testFolderPage({ settings }) })
    expect(byLabel(openMenu(el, 'Properties'), 'Show owner')).toBeDefined()
  })

  it('keeps a long column identity separate from its controls (YAZ-1006)', () => {
    const name = 'campaign_narrative_summary'
    const settings = { columns: { [name]: { kind: 'text' as const } }, views: [], problems: [] }
    const { el } = mount(undefined, { folderPage: testFolderPage({ settings }) })
    const pop = openMenu(el, 'Properties')
    const row = byLabel(pop, `Show ${name}`).closest<HTMLElement>('.view-prop')
    expect(row).not.toBeNull()
    expect(q(row!, '.view-prop__identity .view-prop__name').firstChild?.textContent).toBe(name)
    expect(byLabel(q(row!, '.view-prop__identity'), `Rename ${name}`)).toBeDefined()
    expect(byLabel(q(row!, '.view-prop__controls'), `Type of ${name}`)).toBeDefined()
  })

  it('+ Add column declares it and shows it, in ONE write (YAZ-896)', () => {
    const setColumns = vi.fn()
    const settings = { columns: { tag: { kind: 'text' as const } }, views: [], problems: [] }
    const { el, onChange } = mount(undefined, { folderPage: testFolderPage({ settings, setColumns }) })
    const pop = openMenu(el, 'Properties')
    click(byText(pop, 'button', '+ Add column'))
    setValue(byLabel(pop, 'Column name'), 'budget')
    setValue(byLabel(pop, 'Column kind'), 'number')
    click(byLabel(pop, 'Save column'))
    expect(setColumns).toHaveBeenCalledTimes(1)
    const [columns, views] = setColumns.mock.calls[0] as [Record<string, unknown>, ViewDef[]]
    expect(columns).toEqual({ tag: { kind: 'text' }, budget: { kind: 'number' } })
    // The order rides in that same write (🔒 D3) — never a second one through `onUpdate`.
    expect(views.map((v) => v.name)).toEqual(['Table', 'View', 'View 2'])
    expect(views[0].order).toEqual(['file.name', 'note.budget'])
    expect(views[2].indentProperties).toBe(false)
    expect(onChange).not.toHaveBeenCalled()
    expect(pop.querySelector('[aria-label="Column name"]')).toBeNull() // collapsed again
  })

  it('an invalid or already-taken column name says so and writes nothing', () => {
    const setColumns = vi.fn()
    const { el } = mount(undefined, { folderPage: testFolderPage({ setColumns }) })
    const pop = openMenu(el, 'Properties')
    click(byText(pop, 'button', '+ Add column'))
    setValue(byLabel(pop, 'Column name'), 'Budget!')
    click(byLabel(pop, 'Save column'))
    expect(q(pop, '[role="alert"]').textContent).toContain('lower case')
    setValue(byLabel(pop, 'Column name'), 'status')
    click(byLabel(pop, 'Save column'))
    expect(q(pop, '[role="alert"]').textContent).toContain('already')
    expect(setColumns).not.toHaveBeenCalled()
  })

  it('the target is offered for link kinds only, and lands in the declaration', () => {
    const setColumns = vi.fn()
    const { el } = mount(undefined, { folderPage: testFolderPage({ setColumns }) })
    const pop = openMenu(el, 'Properties')
    click(byText(pop, 'button', '+ Add column'))
    expect(pop.querySelector('[aria-label="Column target"]')).toBeNull()
    setValue(byLabel(pop, 'Column kind'), 'multi-link')
    setValue(byLabel(pop, 'Column name'), 'owner')
    setValue(byLabel(pop, 'Column target'), '  People  ')
    click(byLabel(pop, 'Save column'))
    expect(setColumns.mock.calls[0][0]).toEqual({ owner: { kind: 'multi-link', target: 'People' } })
  })

  it("a declared link column's per-page target is editable in place; empty deletes it (YAZ-897)", () => {
    const setColumns = vi.fn()
    const columns = { owner: { kind: 'link' as const, target: 'People' }, tag: { kind: 'text' as const } }
    const { el } = mount(undefined, { folderPage: testFolderPage({ settings: { columns, views: [], problems: [] }, setColumns }) })
    const pop = openMenu(el, 'Properties')
    expect(pop.querySelector('[aria-label="Target of tag"]')).toBeNull()
    type(byLabel(pop, 'Target of owner'), '  Teams  ')
    expect(setColumns).toHaveBeenCalledTimes(1)
    expect(setColumns.mock.calls[0][0]).toEqual({ owner: { kind: 'link', target: 'Teams' }, tag: { kind: 'text' } })
    type(byLabel(pop, 'Target of owner'), '')
    expect(setColumns.mock.calls[1][0]).toEqual({ owner: { kind: 'link' }, tag: { kind: 'text' } })
  })

  it('a target typed under a link kind does not ride into a non-link declaration', () => {
    const setColumns = vi.fn()
    const { el } = mount(undefined, { folderPage: testFolderPage({ setColumns }) })
    const pop = openMenu(el, 'Properties')
    click(byText(pop, 'button', '+ Add column'))
    setValue(byLabel(pop, 'Column kind'), 'link')
    setValue(byLabel(pop, 'Column target'), 'People')
    setValue(byLabel(pop, 'Column kind'), 'text')
    setValue(byLabel(pop, 'Column name'), 'notes')
    click(byLabel(pop, 'Save column'))
    expect(setColumns.mock.calls[0][0]).toEqual({ notes: { kind: 'text' } })
  })

  it('a declared column shows its kind; changing it rewrites that declaration only (YAZ-897)', () => {
    const setColumns = vi.fn()
    const settings = { columns: { owner: { kind: 'link' as const, target: 'People' }, tag: { kind: 'text' as const } }, views: [], problems: [] }
    const { el, onChange } = mount(undefined, { folderPage: testFolderPage({ settings, setColumns }) })
    const pop = openMenu(el, 'Properties')
    const kind = byLabel<HTMLSelectElement>(pop, 'Type of owner')
    expect(kind.value).toBe('link')
    setValue(kind, 'multi-link')
    expect(setColumns).toHaveBeenCalledTimes(1)
    // C1 (locked): the DECLARATION alone moves — the target rides along, the other column is untouched.
    expect(setColumns.mock.calls[0][0]).toEqual({ owner: { kind: 'multi-link', target: 'People' }, tag: { kind: 'text' } })
    expect(setColumns.mock.calls[0][1]).toBeUndefined() // no `views` — the order is not this gesture's
    expect(onChange).not.toHaveBeenCalled()
  })

  it('an undeclared note key reads `auto`, and picking a kind declares it (YAZ-897)', () => {
    const setColumns = vi.fn()
    const { el, onChange } = mount(undefined, { folderPage: testFolderPage({ setColumns }) })
    const pop = openMenu(el, 'Properties')
    const kind = byLabel<HTMLSelectElement>(pop, 'Type of status')
    expect(kind.value).toBe('') // the ladder's lower rungs decide
    expect(kind.selectedOptions[0].textContent).toBe('auto')
    expect(kind.selectedOptions[0].disabled).toBe(true)
    setValue(kind, 'date')
    expect(setColumns).toHaveBeenCalledExactlyOnceWith({ status: { kind: 'date' } })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('file.* rows get no Type select — they are not note properties (YAZ-897)', () => {
    const pop = openMenu(mount().el, 'Properties')
    expect(pop.querySelector('[aria-label="Type of file.name"]')).toBeNull()
    expect(byLabel(pop, 'Type of status')).toBeDefined()
  })

  it('the pencil sets def.properties[key].displayName; clearing it deletes the entry', () => {
    const { el, onChange, def, yaml } = mount()
    const pop = openMenu(el, 'Properties')
    click(byLabel(pop, 'Rename status'))
    type(byLabel(pop, 'Display name'), 'Stage')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(def().properties).toEqual({ status: { displayName: 'Stage' } })
    expect(yaml()).toContain('displayName: Stage')
    expect(byLabel(pop, 'Show Stage')).toBeDefined()
    click(byLabel(pop, 'Rename Stage'))
    type(byLabel(pop, 'Display name'), '')
    expect(def().properties).toBeUndefined()
    expect(yaml()).not.toContain('properties:')
  })
})

describe('search, count and body', () => {
  it('search narrows the rows client-side and the count shows shown / total', () => {
    const { el, onChange } = mount()
    click(byLabel(el, 'Search'))
    const input = byLabel<HTMLInputElement>(el, 'Search rows')
    setValue(input, 'vsl')
    expect(rows(el)).toEqual(['VSL-v1.md'])
    expect(count(el)).toBe('1 / 8 items')
    expect(onChange).not.toHaveBeenCalled()
    press(input, 'Escape')
    expect(el.querySelector('[aria-label="Search rows"]')).toBeNull()
    expect(count(el)).toBe('8 items')
  })

  it('search matches any rendered value, not only the name', () => {
    const { el } = mount('views:\n  - type: table\n    name: T\n    order:\n      - file.name\n      - note.status\n')
    click(byLabel(el, 'Search'))
    setValue(byLabel(el, 'Search rows'), 'drafting')
    expect(rows(el)).toEqual(['The Levels of an Agency.md'])
  })

  it('a view limit also reduces the count to shown / total', () => {
    const { el } = mount('views:\n  - type: table\n    name: T\n    limit: 3\n')
    expect(rows(el)).toHaveLength(3)
    expect(count(el)).toBe('3 / 8 items')
  })

  it('row links open the note; the other order values are the row cells (4B)', () => {
    const { el, onOpenFile } = mount('views:\n  - type: table\n    name: T\n    order:\n      - file.name\n      - note.status\n      - note.priority\n')
    expect(q(el, '[data-cell="0:1"]').textContent).toBe('idea')
    expect(q(el, '[data-cell="0:2"]').textContent).toBe('2')
    click(q(el, '.view-table__link'))
    expect(onOpenFile).toHaveBeenCalledExactlyOnceWith('/vault/Content Pillars/1. Agentic Agency/Agentic Agency.md')
  })

  it('a corrupt properties.json shows its error banner but the rows still render (report-never-block)', () => {
    const { el } = mount(YASIN_BASE, { properties: { root: '/vault', version: 1, properties: {}, error: 'properties.json is not valid JSON: x' } })
    expect(q(el, '.views-pane__error').textContent).toBe("Could not load the vault's property declarations: properties.json is not valid JSON: x")
    expect(rows(el).length).toBeGreaterThan(0)
  })
})

/**
 * The report-don't-block footnote (YAZ-861). Both halves were produced on every render and read
 * by nobody until this line existed; neither may block a row, and neither is an `alert`.
 */
describe('the notes line', () => {
  it('says nothing at all when there is nothing to say', () => {
    const { el } = mount()
    expect(el.querySelector('.views-pane__notes')).toBeNull()
  })

  it("lists the settings' problems — the one-liners folderPageSettings collects while ignoring an unusable key", () => {
    const problems = ['folder_page_settings.folder must be a root-relative folder name — ignoring it']
    const { el } = mount(YASIN_BASE, { folderPage: testFolderPage({ settings: { columns: {}, views: [], problems } }) })
    const note = q<HTMLElement>(el, '.views-pane__notes')
    expect(note.getAttribute('role')).toBe('note') // a note, never an alert: nothing here failed
    expect(note.textContent).toBe(problems[0])
    expect(rows(el).length).toBeGreaterThan(0) // and it blocks nothing above it
  })

  it("lists the engine's compile errors, `where: message`, from a hand-written filters block", () => {
    const { el } = mount('filters: 1 +\nviews:\n  - type: table\n    name: T\n    order:\n      - file.name\n')
    const note = q<HTMLElement>(el, '.views-pane__notes')
    expect(note.getAttribute('role')).toBe('note')
    expect(note.textContent).toMatch(/^filters: /)
  })

  it('joins both halves into ONE line — the settings first, then the engine', () => {
    const problems = ['folder_page_settings must be a map of settings — using the defaults']
    const { el } = mount('filters: 1 +\nviews:\n  - type: table\n    name: T\n    order:\n      - file.name\n', {
      folderPage: testFolderPage({ settings: { columns: {}, views: [], problems } }),
    })
    const notes = el.querySelectorAll('.views-pane__notes')
    expect(notes).toHaveLength(1)
    expect(notes[0].textContent).toBe(`${problems[0]} · filters: unexpected end of input`)
  })
})

describe('popover behaviour', () => {
  it('opens focused, closes on Escape and on click-away', () => {
    const { el } = mount()
    const pop = openMenu(el, 'Sort')
    expect(pop.contains(document.activeElement)).toBe(true)
    press(window as unknown as Element, 'Escape')
    expect(el.querySelector('.view-popover')).toBeNull()

    openMenu(el, 'Sort')
    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    draw()
    expect(el.querySelector('.view-popover')).toBeNull()
  })
})

/**
 * "Sync from folder" (YAZ-953). The gesture appends a disk folder's notes to the outline DOCUMENT,
 * so the button rides that skin and no other: a table or a board has nothing to append them to.
 */
describe('sync from folder', () => {
  const OUTLINE = 'views:\n  - type: outline\n    name: Outline\n'

  it('the button is offered on the document skin, and only there', () => {
    expect(mount().el.querySelector('[aria-label="Sync from folder"]')).toBeNull() // the table skin
    expect(mount(OUTLINE).el.querySelector('[aria-label="Sync from folder"]')).toBeNull() // no folder page under it, no document
    expect(byLabel(mount(OUTLINE, { thisFile: '/vault/Topic.md' }).el, 'Sync from folder')).toBeDefined()
  })
})

/**
 * `ViewTabs`' EDITABLE half, on its own mount (YAZ-846). ViewsPane passes `readOnly` — the folder
 * page's contents block is the only mount and its views are switch-only (🔒 rule 4) — so these
 * gestures are unreachable from the app today and are pinned here at the component's own edge:
 * each one must call its callback with the right arguments, which is what ViewsPane turns into the
 * ONE `folder_page_settings` write.
 */
