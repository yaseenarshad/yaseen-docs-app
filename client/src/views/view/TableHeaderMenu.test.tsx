/**
 * The table header's context menu (YAZ-1513): ViewsPane mounted with react-dom in jsdom over
 * `TEST_RECORDS`; a right-click on a column `<th>` offers Rename / Hide / Add-to-the-right, and
 * on the `#` header only Hide row numbers. Every write is one `onChange` (the Properties menu's own
 * rules: `setDisplayName`, `setViewOrder`) or one `setColumns` — the folder host's door.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_FOLDER_PAGES } from '@shared/types'
import { type ParsedViews, type ViewSet, parseViews, serializeViews } from '../viewSchema'
import { type FolderHost, ViewsPane, type ViewsPaneProps } from '../ViewsPane'
import { testFolderHost } from '../testFolderHost'
import { TEST_RECORDS } from '../testRecords'
import { deleteColumnLabel, deleteColumnMessage } from './ConfirmDeleteColumn'
import { insertAfter } from './TableHeaderMenu'
import viewsCss from '../views.css?inline'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const BASE = `views:
  - type: table
    name: T
    frozenColumns: 2
    order:
      - file.name
      - note.status
      - note.priority
`

let root: Root | null = null
let container: HTMLElement | null = null
let draw: () => void = () => {}

function mount(text = BASE, props: Partial<ViewsPaneProps> = {}, host: Partial<FolderHost> = {}) {
  let parsed = parseViews(text)
  const onChange = vi.fn((next: ParsedViews) => {
    parsed = next
  })
  const setColumns = vi.fn()
  const deleteColumn = vi.fn(async () => {})
  const folder = testFolderHost({ settings: { columns: { status: { kind: 'text' } }, views: [], problems: [] }, setColumns, deleteColumn, ...host })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  draw = () =>
    act(() =>
      root?.render(
        <ViewsPane parsed={parsed} onChange={onChange} root="/vault" folderPath="/vault/pillars.md" records={TEST_RECORDS} folder={folder} onOpenFile={vi.fn()} {...props} />,
      ),
    )
  draw()
  return { el: container, onChange, setColumns, deleteColumn, yaml: () => serializeViews(parsed), def: (): ViewSet => parsed.def }
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  vi.restoreAllMocks()
})

// ---------- DOM helpers ----------

function q<T extends Element>(el: ParentNode, sel: string): T {
  const n = el.querySelector<T>(sel)
  if (n === null) throw new Error(`missing ${sel}`)
  return n
}

function click(el: Element): void {
  act(() => (el as HTMLElement).click())
  draw()
}

function rightClick(el: EventTarget): void {
  act(() => void el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 40, clientY: 20 })))
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

const headers = (el: ParentNode): string[] => [...el.querySelectorAll('.view-table thead th:not(.view-table__gutter)')].map((t) => t.textContent ?? '')
const th = (el: ParentNode, index: number): HTMLElement => [...el.querySelectorAll<HTMLElement>('.view-table thead th:not(.view-table__gutter)')][index]
const menuItems = (el: ParentNode): string[] => [...el.querySelectorAll('.ctx-menu [role="menuitem"]')].map((b) => b.textContent ?? '')
const item = (el: ParentNode, text: string): HTMLElement => {
  const n = [...el.querySelectorAll<HTMLElement>('.ctx-menu [role="menuitem"]')].find((b) => b.textContent === text)
  if (n === undefined) throw new Error(`missing menu item ${text}`)
  return n
}
/** The open flyout's rows (YAZ-4588): its menuitems, and its ✓, drawn from `data-hint`. */
const flyout = (el: ParentNode): HTMLElement[] => [...el.querySelectorAll<HTMLElement>('.ctx-menu__sub [role="menuitem"]')]
const flyoutItems = (el: ParentNode): string[] => flyout(el).map((b) => b.textContent ?? '')
const checked = (el: ParentNode): string[] => [...el.querySelectorAll<HTMLElement>('.ctx-menu__sub [data-hint="✓"]')].map((b) => b.textContent ?? '')
/** Open a flyout by a click, then pick a row in it. */
function pick(el: ParentNode, parent: string, row: string): void {
  click(item(el, parent))
  const n = flyout(el).find((b) => b.textContent === row)
  if (n === undefined) throw new Error(`missing ${parent} › ${row}: ${flyoutItems(el).join(', ')}`)
  click(n)
}

// ---------- tests ----------

describe('the header menu (YAZ-1513)', () => {
  it('opens on a column header with Rename / Hide / Add to the right; Escape closes it without a write', () => {
    const { el, onChange } = mount()
    expect(el.querySelector('.ctx-menu')).toBeNull()
    rightClick(th(el, 1))
    // One order (YAZ-4608 C8): the edits, then the view items (Hide column with the freezes), then Delete last.
    expect(menuItems(el)).toEqual([
      'Edit column…',
      'Rename column…',
      'Add column to the right…',
      'Sort', // YAZ-4588 D42: three flyouts replace the flat sort, group and wrap items
      'Group',
      'Filter', // YAZ-4919: quick rules on this column, right under Group
      'Text',
      'Fill column', // YAZ-3746 13AQ: the column's fill, in its own group after the edits
      'Header row', // YAZ-4794: the whole header row's look, as the View tab's
      'Hide column',
      '✓ Frozen up to this column', // BASE freezes two: Status is the last frozen column
      'Unfreeze columns',
      'Delete column…',
    ])
    press(window.document.body, 'Escape')
    expect(el.querySelector('.ctx-menu')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('Rename column…: an inline field prefilled with the current label; Enter writes def.properties[key].displayName', () => {
    const { el, onChange, def, yaml } = mount()
    expect(headers(el)).toEqual(['Name', 'Status', 'Priority'])
    rightClick(th(el, 1))
    click(item(el, 'Rename column…'))
    const field = q<HTMLInputElement>(el, '.ctx-menu input[aria-label="Rename Status"]')
    expect(field.value).toBe('') // no stored name yet: the default label is the placeholder (YAZ-1549)
    expect(field.placeholder).toBe('Status')

    setValue(field, 'Stage')
    press(field, 'Enter')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(def().properties).toEqual({ status: { displayName: 'Stage' } })
    expect(yaml()).toContain('displayName: Stage')
    expect(headers(el)).toEqual(['Name', 'Stage', 'Priority'])
    expect(el.querySelector('.ctx-menu')).toBeNull() // done closes the menu
    // the KEY is untouched
    expect(def().views[0].order).toEqual(['file.name', 'note.status', 'note.priority'])
  })

  it('Rename column…: an emptied field clears the label back to the default and leaves no key behind; Esc cancels', () => {
    const { el, onChange, def, yaml } = mount(`${BASE}properties:\n  status:\n    displayName: Stage\n`)
    expect(headers(el)[1]).toBe('Stage')
    rightClick(th(el, 1))
    click(item(el, 'Rename column…'))
    const field = q<HTMLInputElement>(el, '.ctx-menu input[aria-label="Rename Stage"]')
    expect(field.value).toBe('Stage') // the stored name, editable as-is
    expect(field.placeholder).toBe('Status')
    setValue(field, 'Nope')
    press(field, 'Escape')
    expect(onChange).not.toHaveBeenCalled()
    expect(headers(el)[1]).toBe('Stage')
    expect(el.querySelector('.ctx-menu')).toBeNull()

    rightClick(th(el, 1))
    click(item(el, 'Rename column…'))
    const again = q<HTMLInputElement>(el, '.ctx-menu input[aria-label="Rename Stage"]')
    setValue(again, '')
    press(again, 'Enter')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(def().properties).toBeUndefined()
    expect(yaml()).not.toContain('displayName')
    expect(headers(el)[1]).toBe('Status')
  })

  it('Hide column removes the key from view.order and clamps frozenColumns — file.name included, a table may hide it (YAZ-1007)', () => {
    const { el, onChange, def } = mount()
    rightClick(th(el, 1))
    click(item(el, 'Hide column'))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(def().views[0].order).toEqual(['file.name', 'note.priority'])
    expect(def().views[0].frozenColumns).toBe(2)
    expect(headers(el)).toEqual(['Name', 'Priority'])

    rightClick(th(el, 0))
    click(item(el, 'Hide column'))
    expect(def().views[0].order).toEqual(['note.priority'])
    expect(def().views[0].frozenColumns).toBe(1)
    expect(headers(el)).toEqual(['Priority'])
  })

  it('Add column to the right…: the "+ Add column" form, declaring through setColumns with the new key inserted right after this column', () => {
    const { el, onChange, setColumns } = mount()
    rightClick(th(el, 0))
    click(item(el, 'Add column to the right…'))
    const name = q<HTMLInputElement>(el, '.ctx-menu input[aria-label="Column name"]')
    setValue(name, 'owner')
    click(q(el, '.ctx-menu [aria-label="Save column"]'))

    expect(setColumns).toHaveBeenCalledExactlyOnceWith(
      { status: { kind: 'text' }, owner: { kind: 'text' } },
      [{ type: 'table', name: 'T', frozenColumns: 2, order: ['file.name', 'note.owner', 'note.status', 'note.priority'] }],
    )
    expect(onChange).not.toHaveBeenCalled() // ONE write, the host's
    expect(el.querySelector('.ctx-menu')).toBeNull()
  })

  it('Add column to the right… refuses a key the page already offers, and Cancel closes without a write', () => {
    const { el, setColumns } = mount()
    rightClick(th(el, 0))
    click(item(el, 'Add column to the right…'))
    setValue(q<HTMLInputElement>(el, '.ctx-menu input[aria-label="Column name"]'), 'status')
    click(q(el, '.ctx-menu [aria-label="Save column"]'))
    expect(q(el, '.ctx-menu [role="alert"]').textContent).toBe('status is already a column')
    expect(setColumns).not.toHaveBeenCalled()
    click(q(el, '.ctx-menu [aria-label="Cancel column"]'))
    expect(el.querySelector('.ctx-menu')).toBeNull()
  })

  it('Add column to the right… refuses an app key, in the Properties panel\'s words (YAZ-4544)', () => {
    const { el, setColumns } = mount()
    rightClick(th(el, 0))
    click(item(el, 'Add column to the right…'))
    setValue(q<HTMLInputElement>(el, '.ctx-menu input[aria-label="Column name"]'), 'readonly')
    click(q(el, '.ctx-menu [aria-label="Save column"]'))
    expect(q(el, '.ctx-menu [role="alert"]').textContent).toBe("readonly is the app's own property — it is set where it belongs, not here")
    expect(setColumns).not.toHaveBeenCalled()
  })

  it('the # header offers only Hide row numbers, which writes rowNumbers: false', () => {
    const { el, onChange, def, yaml } = mount()
    rightClick(q(el, '.view-table thead th.view-table__gutter'))
    expect(menuItems(el)).toEqual(['Hide row numbers'])
    click(item(el, 'Hide row numbers'))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(def().views[0].rowNumbers).toBe(false)
    expect(yaml()).toContain('rowNumbers: false')
    // The slim strip stays (YAZ-4610 D62); its menu shows the numbers again.
    expect(q(el, '.view-table thead th.view-table__gutter').textContent).toBe('')
    rightClick(q(el, '.view-table thead th.view-table__gutter'))
    expect(menuItems(el)).toEqual(['Show row numbers'])
    click(item(el, 'Show row numbers'))
    // A choice equal to Settings removes the view's key (YAZ-4585 D34, YAZ-4637 M4): the view follows Settings again.
    expect(def().views[0].rowNumbers).toBeUndefined()
  })

  it('the # header\'s choice goes through chooseOwn (M4): with Settings › Row numbers off, Hide removes the key and Show writes true', () => {
    const { el, def } = mount(BASE, { folderPages: { ...DEFAULT_FOLDER_PAGES, rowNumbers: false } })
    rightClick(q(el, '.view-table thead th.view-table__gutter'))
    expect(menuItems(el)).toEqual(['Show row numbers'])
    click(item(el, 'Show row numbers'))
    expect(def().views[0].rowNumbers).toBe(true)
    rightClick(q(el, '.view-table thead th.view-table__gutter'))
    click(item(el, 'Hide row numbers'))
    expect(def().views[0].rowNumbers).toBeUndefined()
  })

  it('Delete column…: asks first — the sheet names the label and the folder; the buttons clear the N values or keep them (C7); Cancel deletes nothing', () => {
    const { el, deleteColumn, onChange } = mount()
    rightClick(th(el, 1))
    click(item(el, 'Delete column…'))
    expect(el.querySelector('.ctx-menu')).toBeNull() // the menu yields to the sheet
    const sheet = q<HTMLElement>(el, '.confirm[role="dialog"]')
    // TEST_RECORDS: five of the eight carry `status`
    expect(q(sheet, '.confirm__text').textContent).toBe('Delete the column "Status"? It goes from vault and every page under it.')
    expect([...sheet.querySelectorAll('.confirm__btn')].map((b) => b.textContent)).toEqual(expect.arrayContaining(['Delete column and clear 5 values', 'Keep the values in the notes', 'Cancel']))
    expect(document.activeElement?.textContent).toBe('Cancel')
    click([...sheet.querySelectorAll<HTMLButtonElement>('.confirm__btn')].find((b) => b.textContent === 'Cancel')!)
    expect(el.querySelector('.confirm')).toBeNull()
    expect(deleteColumn).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('Delete a column from a folder: the sheet names the folder, and the main button the values it clears (YAZ-4713 C7)', () => {
    expect(deleteColumnMessage('Status', 'Schema')).toBe('Delete the column "Status"? It goes from Schema and every page under it.')
    expect(deleteColumnLabel(1)).toBe('Delete column and clear 1 value')
    expect(deleteColumnLabel(3)).toBe('Delete column and clear 3 values')
    expect(deleteColumnLabel(0)).toBe('Delete column')
  })

  it('Delete column…: confirming hands the key to FolderHost.deleteColumn — the ONE function — and closes the sheet', () => {
    const { el, deleteColumn } = mount()
    rightClick(th(el, 1))
    click(item(el, 'Delete column…'))
    click([...el.querySelectorAll<HTMLButtonElement>('.confirm__btn')].find((b) => b.textContent?.startsWith('Delete column'))!)
    expect(deleteColumn).toHaveBeenCalledExactlyOnceWith('note.status', true)
    expect(el.querySelector('.confirm')).toBeNull()
    rightClick(th(el, 1))
    click(item(el, 'Delete column…'))
    click([...el.querySelectorAll<HTMLButtonElement>('.confirm__btn')].find((b) => b.textContent === 'Keep the values in the notes')!)
    expect(deleteColumn).toHaveBeenLastCalledWith('note.status', false)
  })

  it('a column from a parent folder offers Hide, not Delete (YAZ-4713 C7); its header shows ↳ with "From Schema" (C11)', () => {
    const sources = { ...testFolderHost().sources, of: (key: string) => (key === 'status' ? { from: 'Schema' } : {}) }
    const { el } = mount(BASE, {}, { sources })
    const mark = th(el, 1).querySelector('.view-column-mark')!
    // The app's hover box carries the words (YAZ-4772: a native title showed nothing); the icon is named by them.
    expect(mark.querySelector('svg')!.getAttribute('aria-label')).toBe('From Schema')
    expect(mark.getAttribute('data-mark')).toBe('parent')
    rightClick(th(el, 1))
    expect([...el.querySelectorAll('.ctx-menu__item')].map((b) => b.textContent)).not.toContain('Delete column…')
  })

  it('header marks (C11): a separate column shows the lock; "Icon and folder name" adds the name; Off shows none', () => {
    const settings = { columns: { status: { kind: 'text' as const, separate: true as const } }, views: [], problems: [] }
    const named = mount(BASE, {}, { settings, sources: { ...testFolderHost().sources, folderName: 'Desserts', marks: 'name' } })
    const mark = th(named.el, 1).querySelector('.view-column-mark')!
    expect(mark.querySelector('svg')!.getAttribute('aria-label')).toBe('Separate value for Desserts') // YAZ-4772: no native title
    expect(mark.textContent).toBe('Desserts')
    act(() => root?.unmount())
    container?.remove()
    const off = mount(BASE, {}, { settings, sources: { ...testFolderHost().sources, marks: 'off' } })
    expect(th(off.el, 1).querySelector('.view-column-mark')).toBeNull()
  })

  it('Delete column… is disabled with the tooltip on file.name — hide it instead', () => {
    const { el } = mount()
    rightClick(th(el, 0))
    const del = item(el, 'Delete column…') as HTMLButtonElement
    expect(del.disabled).toBe(true)
    expect(del.title).toBe('Built-in column — hide it instead')
    press(window.document.body, 'Escape')
    rightClick(th(el, 1))
    expect((item(el, 'Delete column…') as HTMLButtonElement).disabled).toBe(false)
  })

  it('insertAfter lands the key right after its anchor, or last when the anchor is not shown', () => {
    expect(insertAfter(['file.name', 'note.a', 'note.b'], 'note.a', 'note.x')).toEqual(['file.name', 'note.a', 'note.x', 'note.b'])
    expect(insertAfter(['file.name', 'a'], 'note.a', 'note.x')).toEqual(['file.name', 'a', 'note.x']) // canonical match
    expect(insertAfter(['file.name'], 'note.gone', 'note.x')).toEqual(['file.name', 'note.x'])
  })
})

describe('the type line and "Edit column…" (YAZ-4533)', () => {
  const heading = (el: ParentNode): string | null => el.querySelector('.ctx-menu .ctx-menu__heading')?.textContent ?? null

  it('the menu opens on a grey "<Type> · <key>" line: the declaration, else the inferred kind; file.* reads File field', () => {
    const { el } = mount()
    rightClick(th(el, 1))
    expect(heading(el)).toBe('Text · note.status') // declared
    press(window.document.body, 'Escape')
    rightClick(th(el, 2))
    expect(heading(el)).toBe('Number · note.priority') // inferred from the values
    press(window.document.body, 'Escape')
    rightClick(th(el, 0))
    expect(heading(el)).toBe('File field · file.name')
    press(window.document.body, 'Escape')
    rightClick(q(el, '.view-table thead th.view-table__gutter'))
    expect(heading(el)).toBeNull() // the # header stays as it was
  })

  it('"Edit column…" opens the column editor in the menu; a type change is ONE setColumn — the folder_settings write — against the declaration', () => {
    const setColumn = vi.fn().mockResolvedValue(undefined)
    const { el, onChange } = mount(BASE, {}, { setColumn })
    rightClick(th(el, 1))
    click(item(el, 'Edit column…'))
    const detail = q<HTMLElement>(el, '.ctx-menu .column-detail')
    expect(q(detail, '.column-detail__key').textContent).toBe('note.status')
    expect(q<HTMLInputElement>(detail, '[aria-label="Display name"]').placeholder).toBe('Status')
    // The Type is the picker (YAZ-3746 13L): a button that names the type, then a list of every type.
    const trigger = q<HTMLButtonElement>(detail, '[aria-label="Edit property Status"]')
    expect(trigger.textContent).toBe('Text')
    click(trigger)
    click([...detail.querySelectorAll<HTMLElement>('.type-picker__option')].find((o) => o.querySelector('.type-picker__name')?.textContent === 'Number')!)
    expect(setColumn).toHaveBeenCalledExactlyOnceWith('status', { kind: 'number' }, { kind: 'text' })
    expect(onChange).not.toHaveBeenCalled()
    expect(el.querySelector('.ctx-menu .column-detail')).not.toBeNull() // the editor stays open
  })

  it('‹ and Esc step back to the menu; Hide in this view writes the order and closes the menu', () => {
    const { el, onChange, def } = mount()
    rightClick(th(el, 1))
    click(item(el, 'Edit column…'))
    click(q(el, '.ctx-menu [aria-label="Back to columns"]'))
    expect(menuItems(el)).toContain('Edit column…')
    click(item(el, 'Edit column…'))
    press(q(el, '.ctx-menu .column-detail'), 'Escape')
    expect(menuItems(el)).toContain('Edit column…') // back, not closed
    click(item(el, 'Edit column…'))
    click(q(el, '.ctx-menu [aria-label="Hide Status in this view"]'))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(def().views[0].order).toEqual(['file.name', 'note.priority'])
    expect(el.querySelector('.ctx-menu')).toBeNull()
  })
})

describe('freeze, sort and group from the header (YAZ-4534)', () => {
  const view = (def: () => ViewSet) => def().views[0]

  it('Sort A to Z / Z to A replace the sort with ONE rule on this column', () => {
    const { el, onChange, def, yaml } = mount(`${BASE}    sort:\n      - property: note.priority\n        direction: DESC\n`)
    rightClick(th(el, 1))
    pick(el, 'Sort', 'A to Z')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(view(def).sort).toEqual([{ property: 'note.status', direction: 'ASC' }])
    expect(el.querySelector('.ctx-menu')).toBeNull()
    rightClick(th(el, 0))
    pick(el, 'Sort', 'Z to A')
    expect(view(def).sort).toEqual([{ property: 'file.name', direction: 'DESC' }])
    expect(yaml()).toContain('property: file.name\n        direction: DESC')
  })

  it('on a Select or Multi-select column, Sort A to Z / Z to A sort by value, not in option order (YAZ-4544)', () => {
    for (const kind of ['select', 'multi-select'] as const) {
      const { el, def } = mount(BASE, {}, { settings: { columns: { status: { kind, options: ['zeta', 'alpha'] } }, views: [], problems: [] } })
      rightClick(th(el, 1))
      pick(el, 'Sort', 'A to Z')
      expect(view(def).sort).toEqual([{ property: 'note.status', direction: 'ASC', by: 'value' }])
      rightClick(th(el, 1))
      pick(el, 'Sort', 'Z to A')
      expect(view(def).sort).toEqual([{ property: 'note.status', direction: 'DESC', by: 'value' }])
      act(() => root?.unmount())
      container?.remove()
    }
  })

  it('Group by this column: no grouping yet → the single-object form', () => {
    const { el, def } = mount()
    rightClick(th(el, 1))
    pick(el, 'Group', 'Group by this column')
    expect(view(def).groupBy).toEqual({ property: 'note.status', direction: 'ASC' })
  })

  // YAZ-4588 D42 changed this rule: the column REPLACES the grouping (it was: the column becomes the first level, the others stay).
  it('Group by this column replaces the grouping with this column alone; the first level’s look stays, a level keeps its own fields', () => {
    const levels = `${BASE}    groupBy:\n      - property: note.pillar\n        direction: DESC\n        highlight: blue\n      - property: note.priority\n        direction: DESC\n        large: true\n`
    const first = mount(levels)
    rightClick(th(first.el, 1))
    pick(first.el, 'Group', 'Group by this column')
    expect(view(first.def).groupBy).toEqual({ property: 'note.status', direction: 'ASC', highlight: 'blue' })
    act(() => root?.unmount())
    container?.remove()

    const again = mount(levels)
    rightClick(th(again.el, 2)) // priority, the second level today
    pick(again.el, 'Group', 'Group by this column')
    expect(view(again.def).groupBy).toEqual({ property: 'note.priority', direction: 'DESC', large: true })
  })

  it('Group by this column keeps a later entry with no column as it is (YAZ-4544)', () => {
    const { el, def } = mount(`${BASE}    groupBy:\n      - property: note.pillar\n      - {}\n`)
    rightClick(th(el, 1))
    pick(el, 'Group', 'Group by this column')
    expect(view(def).groupBy).toEqual([{ property: 'note.status', direction: 'ASC' }, {}])
  })

  it('Freeze up to this column writes frozenColumns; on the last frozen column the item reads ✓ and a click unfreezes', () => {
    const { el, def } = mount() // frozenColumns: 2
    rightClick(th(el, 1))
    expect(menuItems(el)).toContain('✓ Frozen up to this column')
    expect(menuItems(el)).not.toContain('Freeze up to this column')
    click(item(el, '✓ Frozen up to this column'))
    expect(view(def).frozenColumns).toBeUndefined()

    rightClick(th(el, 2))
    click(item(el, 'Freeze up to this column'))
    expect(view(def).frozenColumns).toBe(3)
  })

  it('Unfreeze columns deletes frozenColumns, and is disabled when nothing is frozen', () => {
    const { el, def, yaml } = mount()
    rightClick(th(el, 2))
    click(item(el, 'Unfreeze columns'))
    expect(view(def).frozenColumns).toBeUndefined()
    expect(yaml()).not.toContain('frozenColumns')
    rightClick(th(el, 2))
    expect((item(el, 'Unfreeze columns') as HTMLButtonElement).disabled).toBe(true)
  })

  it('the freeze line: view-table__frozen-end sits on the LAST frozen column — header, body cells and the summary cell', () => {
    const { el } = mount() // frozenColumns: 2 → the Status column
    const ends = (sel: string) => [...el.querySelectorAll<HTMLElement>(sel)].map((c) => c.classList.contains('view-table__frozen-end'))
    expect(ends('.view-table thead th:not(.view-table__gutter)')).toEqual([false, true, false])
    const bodyRow = q<HTMLElement>(el, '.view-table tbody tr:has(td[data-cell])')
    expect(ends('.view-table tbody tr:has(td[data-cell]) td:not(.view-table__gutter)').slice(0, 3)).toEqual([false, true, false])
    expect(bodyRow.querySelectorAll('.view-table__frozen-end')).toHaveLength(1)
    expect(ends('.view-table tfoot td:not(.view-table__gutter)')).toEqual([false, true, false])
    expect(el.querySelectorAll('tbody .view-table__frozen-end').length).toBe(el.querySelectorAll('tbody tr:has(td[data-cell])').length)
  })

  it('the freeze line CSS: 3px in the line colour that does not widen the column — a 1px border and a 2px strip inside it (YAZ-4534 polish)', () => {
    const rule = (selector: string) => new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(viewsCss)?.[1] ?? ''
    const end = rule('.view-table .view-table__frozen-end')
    expect(end).not.toMatch(/border-right-width/)
    expect(end).toMatch(/border-right-color:\s*color-mix\(in srgb, var\(--border\) 60%, var\(--fg\) 40%\)/)
    const strip = rule('.view-table .view-table__frozen-end::after')
    expect(strip).toMatch(/content:\s*''/)
    expect(strip).toMatch(/position:\s*absolute/)
    expect(strip).toMatch(/right:\s*0/)
    expect(strip).toMatch(/width:\s*2px/)
    expect(strip).toMatch(/background:\s*color-mix\(in srgb, var\(--border\) 60%, var\(--fg\) 40%\)/)
    expect(strip).toMatch(/pointer-events:\s*none/)
    // The strip's box is the cell: every frozen cell — header, body and summary — is sticky.
    expect(rule('.view-table .view-table__frozen')).toMatch(/position:\s*sticky/)
  })

  it('no frozen columns → no freeze line', () => {
    const { el } = mount(BASE.replace('    frozenColumns: 2\n', ''))
    expect(el.querySelector('.view-table__frozen-end')).toBeNull()
  })
})

describe('"Add column to the right…" takes any name (YAZ-4535)', () => {
  const DUE = { ...TEST_RECORDS[0], path: '/vault/Due.md', name: 'Due.md', basename: 'Due', title: 'Due', properties: { 'Due Date': '2026-12-01' } }

  it.each(['Due Date', 'Yaseen', 'AI or App'])('"%s" is the key, as typed, declared and shown in ONE write', (typed) => {
    const { el, onChange, setColumns } = mount()
    rightClick(th(el, 0))
    click(item(el, 'Add column to the right…'))
    setValue(q<HTMLInputElement>(el, '.ctx-menu input[aria-label="Column name"]'), typed)
    click(q(el, '.ctx-menu [aria-label="Save column"]'))
    expect(setColumns).toHaveBeenCalledExactlyOnceWith(
      { status: { kind: 'text' }, [typed]: { kind: 'text' } },
      [{ type: 'table', name: 'T', frozenColumns: 2, order: ['file.name', `note.${typed}`, 'note.status', 'note.priority'] }],
    )
    expect(onChange).not.toHaveBeenCalled()
  })

  it('S1: a note property of the same name is shown right of this column — no twin, no declaration', () => {
    const { el, onChange, setColumns, def } = mount(BASE, { records: [...TEST_RECORDS, DUE] })
    rightClick(th(el, 0))
    click(item(el, 'Add column to the right…'))
    setValue(q<HTMLInputElement>(el, '.ctx-menu input[aria-label="Column name"]'), 'Due Date')
    click(q(el, '.ctx-menu [aria-label="Save column"]'))
    expect(setColumns).not.toHaveBeenCalled()
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(def().views[0].order).toEqual(['file.name', 'note.Due Date', 'note.status', 'note.priority'])
    expect(headers(el)).toEqual(['Name', 'Due Date', 'Status', 'Priority'])
    expect(el.querySelector('.ctx-menu')).toBeNull()
  })

  it('YAZ-4769: a name the page has in other capitals is that column — refused when shown, in its own spelling; an app key too', () => {
    const { el, setColumns } = mount()
    rightClick(th(el, 0))
    click(item(el, 'Add column to the right…'))
    setValue(q<HTMLInputElement>(el, '.ctx-menu input[aria-label="Column name"]'), 'STATUS')
    click(q(el, '.ctx-menu [aria-label="Save column"]'))
    expect(q(el, '.ctx-menu [role="alert"]').textContent).toBe('"status" is already a column')
    setValue(q<HTMLInputElement>(el, '.ctx-menu input[aria-label="Column name"]'), 'ReadOnly')
    click(q(el, '.ctx-menu [aria-label="Save column"]'))
    expect(q(el, '.ctx-menu [role="alert"]').textContent).toBe("readonly is the app's own property — it is set where it belongs, not here")
    expect(setColumns).not.toHaveBeenCalled()
  })

  it('YAZ-4769: a hidden note property in other capitals is shown under its own spelling — no twin, no declaration', () => {
    const { el, setColumns, def } = mount(BASE, { records: [...TEST_RECORDS, DUE] })
    rightClick(th(el, 0))
    click(item(el, 'Add column to the right…'))
    setValue(q<HTMLInputElement>(el, '.ctx-menu input[aria-label="Column name"]'), 'due date')
    click(q(el, '.ctx-menu [aria-label="Save column"]'))
    expect(setColumns).not.toHaveBeenCalled()
    expect(def().views[0].order).toEqual(['file.name', 'note.Due Date', 'note.status', 'note.priority'])
  })

  it('an empty name is refused: "Type a name"', () => {
    const { el, setColumns } = mount()
    rightClick(th(el, 0))
    click(item(el, 'Add column to the right…'))
    click(q(el, '.ctx-menu [aria-label="Save column"]'))
    expect(q(el, '.ctx-menu [role="alert"]').textContent).toBe('Type a name')
    expect(setColumns).not.toHaveBeenCalled()
  })
})


describe('the Sort, Group and Text flyouts (YAZ-4588 D42)', () => {
  const view = (def: () => ViewSet) => def().views[0]
  const SELECT: Partial<FolderHost> = { settings: { columns: { status: { kind: 'select', options: ['zeta', 'alpha'] } }, views: [], problems: [] } }
  const flyoutHeading = (el: ParentNode): string | null => el.querySelector('.ctx-menu__sub .ctx-menu__heading')?.textContent ?? null
  const hover = (target: Element) => {
    act(() => void target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
  }

  it('Sort › on a text column: A to Z and Z to A, no option order; no rule → no ✓ and no Remove sort', () => {
    const { el } = mount()
    rightClick(th(el, 1))
    click(item(el, 'Sort'))
    expect(flyoutItems(el)).toEqual(['A to Z', 'Z to A'])
    expect(checked(el)).toEqual([])
  })

  it('Sort › ✓ marks this column’s rule; Remove sort deletes only that rule, and the last rule takes the sort key with it', () => {
    const { el, def, yaml } = mount(`${BASE}    sort:\n      - property: note.priority\n        direction: ASC\n      - property: status\n        direction: DESC\n`)
    rightClick(th(el, 1))
    click(item(el, 'Sort'))
    expect(flyoutItems(el)).toEqual(['A to Z', 'Z to A', 'Remove sort'])
    expect(checked(el)).toEqual(['Z to A'])
    click(item(el, 'Remove sort'))
    expect(view(def).sort).toEqual([{ property: 'note.priority', direction: 'ASC' }])
    expect(el.querySelector('.ctx-menu')).toBeNull()

    rightClick(th(el, 2))
    pick(el, 'Sort', 'Remove sort')
    expect(yaml()).not.toContain('sort:')
  })

  it('Sort › on a Select or Multi-select column adds Option order and Reversed option order; ✓ reads `by`', () => {
    for (const kind of ['select', 'multi-select'] as const) {
      const { el, def } = mount(`${BASE}    sort:\n      - property: note.status\n        direction: DESC\n`, {}, { settings: { columns: { status: { kind, options: ['zeta', 'alpha'] } }, views: [], problems: [] } })
      rightClick(th(el, 1))
      click(item(el, 'Sort'))
      expect(flyoutItems(el)).toEqual(['A to Z', 'Z to A', 'Option order', 'Reversed option order', 'Remove sort'])
      expect(checked(el)).toEqual(['Reversed option order']) // no `by` = option order
      click(item(el, 'A to Z'))
      expect(view(def).sort).toEqual([{ property: 'note.status', direction: 'ASC', by: 'value' }])
      rightClick(th(el, 1))
      click(item(el, 'Sort'))
      expect(checked(el)).toEqual(['A to Z'])
      click(item(el, 'Option order'))
      expect(view(def).sort).toEqual([{ property: 'note.status', direction: 'ASC' }])
      act(() => root?.unmount())
      container?.remove()
    }
  })

  // Changed by YAZ-4544 (4F, D42): with nothing grouped "Add as next group level" is the same act, so it is hidden.
  it('Group › not grouped: only Group by this column; no Levels', () => {
    const { el, def } = mount()
    rightClick(th(el, 1))
    click(item(el, 'Group'))
    expect(flyoutItems(el)).toEqual(['Group by this column'])
    expect(flyoutHeading(el)).toBeNull()
    click(item(el, 'Group by this column'))
    expect(view(def).groupBy).toEqual({ property: 'note.status', direction: 'ASC' })
  })

  // YAZ-3746 13V: the read-only "Levels" list is gone (it looked clickable and did nothing); a column that is no level shows no heading.
  it('Group › grouped by other columns (1 and 2 levels): no level heading; Add appends this column, each level keeps its fields', () => {
    const { el, def } = mount(`${BASE}    groupBy:\n      property: note.pillar\n      direction: DESC\n      highlight: blue\n`)
    rightClick(th(el, 1))
    click(item(el, 'Group'))
    expect(flyoutItems(el)).toEqual(['Group by this column', 'Add as next group level'])
    expect(flyoutHeading(el)).toBeNull()
    click(item(el, 'Add as next group level'))
    expect(view(def).groupBy).toEqual([{ property: 'note.pillar', direction: 'DESC', highlight: 'blue' }, { property: 'note.status', direction: 'ASC' }])

    rightClick(th(el, 2))
    click(item(el, 'Group'))
    expect(flyoutHeading(el)).toBeNull()
    click(item(el, 'Add as next group level'))
    expect(view(def).groupBy).toEqual([
      { property: 'note.pillar', direction: 'DESC', highlight: 'blue' },
      { property: 'note.status', direction: 'ASC' },
      { property: 'note.priority', direction: 'ASC' },
    ])
  })

  it('Group › at five levels (YAZ-3746 13AF): Add as next group level is disabled, with the tip', () => {
    // Folder may group at more than one level (YAZ-2541).
    const { el, onChange } = mount(`${BASE}    groupBy:\n      - property: note.pillar\n      - property: note.tags\n      - property: note.priority\n      - property: file.folder\n      - property: file.folder\n`)
    rightClick(th(el, 1))
    click(item(el, 'Group'))
    const add = item(el, 'Add as next group level') as HTMLButtonElement
    expect(add.disabled).toBe(true)
    expect(add.title).toBe('Five levels at most')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('Group › this column a level (YAZ-3746 13V): its level heading, Move up / down, no Add, and Remove this group level moves the levels below up', () => {
    const { el, def } = mount(`${BASE}    groupBy:\n      - property: note.pillar\n      - property: status\n        highlight: green\n      - property: note.priority\n        direction: DESC\n        large: true\n`)
    rightClick(th(el, 1))
    click(item(el, 'Group'))
    expect(flyoutItems(el)).toEqual(['Group by this column', 'Move up a level', 'Move down a level', 'Remove this group level'])
    expect(flyoutHeading(el)).toBe('Group level 2 of 3')
    click(item(el, 'Remove this group level'))
    expect(view(def).groupBy).toEqual([{ property: 'note.pillar' }, { property: 'note.priority', direction: 'DESC', large: true }])
  })

  it('Text › Wrap text and Clip text, ✓ on the effective choice (D29); then the column\'s alignment (YAZ-3746 13Y)', () => {
    const { el } = mount()
    rightClick(th(el, 1))
    click(item(el, 'Text'))
    expect(flyoutItems(el)).toEqual(['Wrap text', 'Clip text', 'Auto alignment', 'Align left', 'Align center', 'Align right'])
    expect(checked(el)).toEqual(['Clip text', 'Auto alignment'])
  })

  // YAZ-4794 demo ("holy shite thats a long flyout"): Plain, then three tabs, Fill · Text · Style, one short list at a time;
  // Black fill and White text from the same demo.
  it('Header row › (YAZ-4794): Plain, then the Fill, Text and Style tabs, ✓ at the table; a pick writes the view and the menu stays open', () => {
    const { el, def } = mount()
    rightClick(th(el, 1))
    click(item(el, 'Header row'))
    const colours = ['Red', 'Orange', 'Yellow', 'Green', 'Teal', 'Blue', 'Purple', 'Pink']
    const seg = (label: string) => [...el.querySelectorAll<HTMLElement>(`.ctx-menu__sub [aria-label="${label}"] button`)]
    const pressed = (label: string) => seg(label).filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent)
    const tab = (word: string) => click(seg('Header row part').find((b) => b.textContent === word)!)
    expect(seg('Header row part').map((b) => b.textContent)).toEqual(['Fill', 'Text', 'Style'])
    expect(pressed('Header row part')).toEqual(['Fill'])
    // Fill: the strength as one row of choices, then the fill colours.
    expect(seg('Strength').map((b) => b.textContent)).toEqual(['Off', 'Light', 'Medium', 'Strong'])
    expect(pressed('Strength')).toEqual(['Light'])
    expect(flyoutItems(el)).toEqual(['Plain, like any row', 'Gray', ...colours, 'Black'])
    expect(checked(el)).toEqual(['Gray'])
    tab('Text')
    expect(flyoutItems(el)).toEqual(['Plain, like any row', 'Muted', 'Full', 'White', ...colours])
    expect(checked(el)).toEqual(['Muted'])
    click(flyout(el).find((b) => b.textContent === 'Blue')!)
    expect(def().views[0].headerRow).toEqual({ text: 'blue' })
    expect(el.querySelector('.ctx-menu__sub')).not.toBeNull()
    expect(checked(el)).toEqual(['Blue'])
    tab('Style')
    expect([...el.querySelectorAll('.ctx-menu__sub .ctx-menu__heading')].map((h) => h.textContent)).toEqual(['Weight', 'Align'])
    expect(flyoutItems(el)).toEqual(['Plain, like any row', 'Bold', 'Regular', 'Follow column', 'Left', 'Center', 'Right'])
    expect(checked(el)).toEqual(['Bold', 'Follow column'])
    click(flyout(el).find((b) => b.textContent === 'Center')!)
    expect(def().views[0].headerRow).toEqual({ text: 'blue', align: 'center' })
    expect(el.querySelector('.ctx-menu__sub')).not.toBeNull()
    expect(checked(el)).toEqual(['Bold', 'Center'])
    expect(el.querySelector('.view-table')!.getAttribute('data-table-header-align')).toBe('center')
    // A pick equal to Settings removes the part.
    click(flyout(el).find((b) => b.textContent === 'Follow column')!)
    expect(def().views[0].headerRow).toEqual({ text: 'blue' })
  })

  it('a flyout opens on hover; hovering another row swaps or closes it after the hover wait', () => {
    vi.useFakeTimers()
    try {
      const { el } = mount(BASE, {}, SELECT)
      rightClick(th(el, 1))
      hover(item(el, 'Sort'))
      expect(item(el, 'Sort').getAttribute('aria-expanded')).toBe('true') // the first flyout opens at once
      hover(item(el, 'Group'))
      expect(item(el, 'Sort').getAttribute('aria-expanded')).toBe('true') // a switch waits
      act(() => void vi.advanceTimersByTime(200))
      expect(item(el, 'Group').getAttribute('aria-expanded')).toBe('true')
      expect(item(el, 'Sort').getAttribute('aria-expanded')).toBe('false')
      hover(item(el, 'Hide column'))
      act(() => void vi.advanceTimersByTime(200))
      expect(el.querySelector('.ctx-menu__sub')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('by keyboard: ArrowRight or Enter opens a flyout, ArrowLeft steps back to its row', () => {
    const { el } = mount()
    rightClick(th(el, 1))
    press(item(el, 'Group'), 'ArrowRight')
    expect(item(el, 'Group').getAttribute('aria-expanded')).toBe('true')
    const first = item(el, 'Group by this column')
    act(() => first.focus())
    press(first, 'ArrowLeft')
    expect(el.querySelector('.ctx-menu__sub')).toBeNull()
    expect(document.activeElement).toBe(item(el, 'Group'))
    press(item(el, 'Text'), 'Enter')
    expect(flyoutItems(el)).toEqual(['Wrap text', 'Clip text', 'Auto alignment', 'Align left', 'Align center', 'Align right'])
  })

  it('Esc closes the open flyout alone, then the menu; nothing is written', () => {
    const { el, onChange } = mount()
    rightClick(th(el, 1))
    click(item(el, 'Sort'))
    press(window.document.body, 'Escape')
    expect(el.querySelector('.ctx-menu__sub')).toBeNull()
    expect(menuItems(el)).toContain('Sort')
    press(window.document.body, 'Escape')
    expect(el.querySelector('.ctx-menu')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('the Filter flyout (YAZ-4919)', () => {
  const view = (def: () => ViewSet) => def().views[0]
  /** Every kind the flyout fits, declared on the folder; the headers after `#`: Name 0, Status 1, Priority 2, Published 3, Date 4, Pillar 5, Tags 6. */
  const ORDER = `views:
  - type: table
    name: T
    order:
      - file.name
      - note.status
      - note.priority
      - note.published
      - note.date
      - note.pillar
      - note.tags
`
  const HOST: Partial<FolderHost> = {
    settings: {
      columns: {
        status: { kind: 'select', options: ['idea', 'drafting', 'published'] },
        priority: { kind: 'number' },
        published: { kind: 'checkbox' },
        date: { kind: 'date' },
        pillar: { kind: 'text' },
        tags: { kind: 'multi-select', options: ['agentic', 'creator'] },
      },
      views: [],
      problems: [],
    },
  }
  const FILTERED = `${ORDER}    filters:
      and:
        - 'note.status == "idea"'
        - '!note.priority.isEmpty() && note.priority > 1'
`
  /** The checklist's rows and their ticks (`menuitemcheckbox`, a ✓ box each). */
  const checks = (el: ParentNode): HTMLElement[] => [...el.querySelectorAll<HTMLElement>('.ctx-menu__sub [role="menuitemcheckbox"]')]
  const checkLabels = (el: ParentNode): string[] => checks(el).map((b) => b.textContent?.replace('✓', '') ?? '')
  const ticked = (el: ParentNode): string[] => checks(el).filter((b) => b.getAttribute('aria-checked') === 'true').map((b) => b.textContent?.replace('✓', '') ?? '')
  const check = (el: ParentNode, label: string): void => {
    const n = checks(el).find((b) => b.textContent?.replace('✓', '') === label)
    if (n === undefined) throw new Error(`missing tick ${label}: ${checkLabels(el).join(', ')}`)
    click(n)
  }
  const box = (el: ParentNode, label: string): HTMLInputElement => q(el, `.ctx-menu__sub input[aria-label="${label}"]`)
  const opButton = (el: ParentNode, word: string): HTMLElement => {
    const n = [...el.querySelectorAll<HTMLElement>('.ctx-menu__sub .fill-target__opt')].find((b) => b.textContent === word)
    if (n === undefined) throw new Error(`missing operator ${word}`)
    return n
  }
  const pressed = (el: ParentNode): string[] => [...el.querySelectorAll<HTMLElement>('.ctx-menu__sub .fill-target__opt[aria-pressed="true"]')].map((b) => b.textContent ?? '')
  const badge = (el: ParentNode): string | null => el.querySelector('.view-toolbar__btn[aria-label="Filter"] .view-toolbar__badge')?.textContent ?? null
  /** The live count under the Contains box (YAZ-4919 round 2), or null while the box is empty. */
  const count = (el: ParentNode): string | null => el.querySelector('.ctx-menu__sub .column-filter__count')?.textContent ?? null
  /** The value rows under the count: each value with its row count. */
  const valueRows = (el: ParentNode): [string, string | null][] => [...el.querySelectorAll<HTMLElement>('.ctx-menu__sub .column-filter__value')].map((b) => [b.textContent ?? '', b.getAttribute('data-count')])
  /** Types into a flyout box and presses Enter: the one write, and the menu closes. */
  const enter = (el: ParentNode, label: string, value: string): void => {
    const input = box(el, label)
    setValue(input, value)
    press(input, 'Enter')
  }

  it('Filter › sits right under Group ›; a text column: a Contains box, Is empty, Is not empty, then Open the filter panel…; no ✓ and no Clear', () => {
    const { el, onChange } = mount(ORDER, {}, HOST)
    rightClick(th(el, 5))
    const items = menuItems(el)
    expect(items.indexOf('Filter')).toBe(items.indexOf('Group') + 1)
    expect(item(el, 'Filter').getAttribute('data-hint')).toBeNull()
    click(item(el, 'Filter'))
    // The column's own values under the box (YAZ-4919 round 2), most rows first: pillar is two values, two rows each.
    expect(flyoutItems(el)).toEqual(['Agentic Agency', 'Creator Economy', 'Is empty', 'Is not empty', 'Open the filter panel…'])
    expect(box(el, 'Contains').value).toBe('')
    expect(count(el)).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('a text column: Contains + Enter writes ONE `contains` rule into the view\'s filters (one ⌘Z), the menu closes, and the toolbar\'s badge counts it', () => {
    const { el, def, onChange } = mount(ORDER, {}, HOST)
    expect(badge(el)).toBeNull()
    rightClick(th(el, 5))
    click(item(el, 'Filter'))
    enter(el, 'Contains', 'Agentic')
    // Case ignored (YAZ-4919 round 2): `lower()` on the column, the value lowercased.
    expect(view(def).filters).toEqual({ and: ['note.pillar.lower().contains("agentic")'] })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(el.querySelector('.ctx-menu')).toBeNull()
    expect(badge(el)).toBe('1')
    // Back in: ✓ on the parent, the box holds the text, the values are those that contain it, and Clear is offered.
    rightClick(th(el, 5))
    expect(item(el, 'Filter').getAttribute('data-hint')).toBe('✓')
    click(item(el, 'Filter'))
    expect(box(el, 'Contains').value).toBe('agentic')
    expect(count(el)).toBe('2 rows match')
    expect(flyoutItems(el)).toEqual(['Agentic Agency', 'Is empty', 'Is not empty', "Clear this column's filter", 'Open the filter panel…'])
    // Is not empty replaces the column's rule: still one rule.
    click(item(el, 'Is not empty'))
    expect(view(def).filters).toEqual({ and: ['!note.pillar.isEmpty()'] })
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('a Select column: its options as a checklist; each tick is one write of ONE "is any of" rule and the menu stays open; the last untick takes the rule away', () => {
    const { el, def, yaml, onChange } = mount(ORDER, {}, HOST)
    rightClick(th(el, 1))
    click(item(el, 'Filter'))
    expect(checkLabels(el)).toEqual(['idea', 'drafting', 'published'])
    expect(flyoutItems(el)).toEqual(['Is empty', 'Open the filter panel…'])
    check(el, 'idea')
    expect(view(def).filters).toEqual({ and: ['["idea"].contains(note.status)'] })
    expect(el.querySelector('.ctx-menu__sub')).not.toBeNull()
    expect(ticked(el)).toEqual(['idea'])
    expect(item(el, 'Filter').getAttribute('data-hint')).toBe('✓')
    check(el, 'drafting')
    expect(view(def).filters).toEqual({ and: ['["idea", "drafting"].contains(note.status)'] })
    expect(onChange).toHaveBeenCalledTimes(2)
    check(el, 'idea')
    check(el, 'drafting')
    expect(yaml()).not.toContain('filters:')
    expect(item(el, 'Filter').getAttribute('data-hint')).toBeNull()
    expect(onChange).toHaveBeenCalledTimes(4)
  })

  it('a Multi-select column ticks write "has any of"; a Checkbox column offers Checked · Unchecked, and the second replaces the first', () => {
    const { el, def } = mount(ORDER, {}, HOST)
    rightClick(th(el, 6))
    click(item(el, 'Filter'))
    check(el, 'creator')
    expect(view(def).filters).toEqual({ and: ['note.tags.containsAny("creator")'] })
    press(window.document.body, 'Escape')
    press(window.document.body, 'Escape')

    rightClick(th(el, 3))
    click(item(el, 'Filter'))
    expect(flyoutItems(el)).toEqual(['Checked', 'Unchecked', 'Open the filter panel…'])
    click(item(el, 'Checked'))
    expect(view(def).filters).toEqual({ and: ['note.tags.containsAny("creator")', 'note.published == true'] })
    rightClick(th(el, 3))
    pick(el, 'Filter', 'Unchecked')
    expect(view(def).filters).toEqual({ and: ['note.tags.containsAny("creator")', 'note.published == false'] })
    rightClick(th(el, 3))
    click(item(el, 'Filter'))
    expect(checked(el)).toEqual(['Unchecked'])
  })

  it('a Number column: = ≠ > < over one box; > 1 + Enter writes the guarded rule, and back in, > is pressed and the box holds 1; Is empty', () => {
    const { el, def, onChange } = mount(ORDER, {}, HOST)
    rightClick(th(el, 2))
    click(item(el, 'Filter'))
    expect(pressed(el)).toEqual(['='])
    expect(flyoutItems(el)).toEqual(['Is empty', 'Open the filter panel…'])
    click(opButton(el, '>'))
    enter(el, 'Number', '1')
    expect(view(def).filters).toEqual({ and: ['!note.priority.isEmpty() && note.priority > 1'] })
    expect(onChange).toHaveBeenCalledTimes(1)
    rightClick(th(el, 2))
    click(item(el, 'Filter'))
    expect(pressed(el)).toEqual(['>'])
    expect(box(el, 'Number').value).toBe('1')
    click(item(el, 'Is empty'))
    expect(view(def).filters).toEqual({ and: ['note.priority.isEmpty()'] })
  })

  it('a Date column: Today · This week · This month write the LIVE rules (the engine reads the day at each run), ✓ on the one the column holds; Before / After over a date box', () => {
    const { el, def, onChange } = mount(ORDER, {}, HOST)
    rightClick(th(el, 4))
    click(item(el, 'Filter'))
    expect(flyoutItems(el)).toEqual(['Today', 'This week', 'This month', 'Is empty', 'Open the filter panel…'])
    expect(pressed(el)).toEqual(['Before'])
    click(item(el, 'Today'))
    expect(view(def).filters).toEqual({ and: ['note.date.isToday()'] })
    expect(onChange).toHaveBeenCalledTimes(1)
    rightClick(th(el, 4))
    click(item(el, 'Filter'))
    expect(checked(el)).toEqual(['Today'])
    click(item(el, 'This week'))
    expect(view(def).filters).toEqual({ and: ['note.date.isThisWeek()'] })
    rightClick(th(el, 4))
    click(item(el, 'Filter'))
    expect(checked(el)).toEqual(['This week'])
    click(item(el, 'This month'))
    expect(view(def).filters).toEqual({ and: ['note.date.isThisMonth()'] })
    rightClick(th(el, 4))
    click(item(el, 'Filter'))
    expect(checked(el)).toEqual(['This month'])
    click(opButton(el, 'After'))
    enter(el, 'Date', '2026-12-01')
    expect(view(def).filters).toEqual({ and: ['!note.date.isEmpty() && note.date > date("2026-12-01")'] })
    rightClick(th(el, 4))
    click(item(el, 'Filter'))
    expect(pressed(el)).toEqual(['After'])
    expect(box(el, 'Date').value).toBe('2026-12-01')
    expect(checked(el)).toEqual([])
  })

  it('a filter the panel wrote shows its ✓ and its tick; Clear this column\'s filter removes only that column\'s rules, one write; the last rule takes the key with it', () => {
    const { el, def, yaml, onChange } = mount(FILTERED, {}, HOST)
    expect(badge(el)).toBe('2')
    rightClick(th(el, 1))
    expect(item(el, 'Filter').getAttribute('data-hint')).toBe('✓')
    click(item(el, 'Filter'))
    expect(ticked(el)).toEqual(['idea'])
    expect(flyoutItems(el)).toEqual(['Is empty', "Clear this column's filter", 'Open the filter panel…'])
    click(item(el, "Clear this column's filter"))
    expect(view(def).filters).toEqual({ and: ['!note.priority.isEmpty() && note.priority > 1'] })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(el.querySelector('.ctx-menu')).toBeNull()
    expect(badge(el)).toBe('1')
    // A column with no rule: no ✓, no Clear.
    rightClick(th(el, 5))
    expect(item(el, 'Filter').getAttribute('data-hint')).toBeNull()
    click(item(el, 'Filter'))
    expect(flyoutItems(el)).not.toContain("Clear this column's filter")
    press(window.document.body, 'Escape')
    press(window.document.body, 'Escape')
    rightClick(th(el, 2))
    pick(el, 'Filter', "Clear this column's filter")
    expect(yaml()).not.toContain('filters:')
    expect(badge(el)).toBeNull()
  })

  it('the opposite on a Select column (YAZ-4929): "Is none of" over the checklist; a tick under it writes ONE "is none of" rule, back in it is pressed with the tick, and the switch alone rewrites the ticks under the other operator, one write each', () => {
    const { el, def, onChange } = mount(ORDER, {}, HOST)
    rightClick(th(el, 1))
    click(item(el, 'Filter'))
    expect(pressed(el)).toEqual(['Is any of'])
    click(opButton(el, 'Is none of'))
    expect(onChange).not.toHaveBeenCalled() // no ticks yet: nothing to rewrite
    check(el, 'idea')
    expect(view(def).filters).toEqual({ and: ['!["idea"].contains(note.status)'] })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(el.querySelector('.ctx-menu__sub')).not.toBeNull()
    expect(ticked(el)).toEqual(['idea'])
    expect(item(el, 'Filter').getAttribute('data-hint')).toBe('✓')
    press(window.document.body, 'Escape')
    press(window.document.body, 'Escape')
    rightClick(th(el, 1))
    click(item(el, 'Filter'))
    expect(pressed(el)).toEqual(['Is none of'])
    expect(ticked(el)).toEqual(['idea'])
    click(opButton(el, 'Is any of'))
    expect(view(def).filters).toEqual({ and: ['["idea"].contains(note.status)'] })
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(pressed(el)).toEqual(['Is any of'])
    expect(ticked(el)).toEqual(['idea'])
    check(el, 'idea')
    expect(view(def).filters).toBeUndefined()
  })

  it('a Multi-select column: "Has none of" writes the panel\'s "has none of"; a panel-written "is not" reads as one tick under Is none of; a Checkbox already has both values', () => {
    const { el, def } = mount(`${ORDER}    filters:\n      and:\n        - 'note.status != "idea"'\n`, {}, HOST)
    rightClick(th(el, 6))
    click(item(el, 'Filter'))
    expect(pressed(el)).toEqual(['Has any of'])
    click(opButton(el, 'Has none of'))
    check(el, 'creator')
    expect(view(def).filters).toEqual({ and: ['note.status != "idea"', '!note.tags.containsAny("creator")'] })
    press(window.document.body, 'Escape')
    press(window.document.body, 'Escape')
    rightClick(th(el, 1))
    click(item(el, 'Filter'))
    expect(pressed(el)).toEqual(['Is none of'])
    expect(ticked(el)).toEqual(['idea'])
    press(window.document.body, 'Escape')
    press(window.document.body, 'Escape')
    rightClick(th(el, 3))
    click(item(el, 'Filter'))
    expect(flyoutItems(el)).toEqual(['Checked', 'Unchecked', 'Open the filter panel…'])
    expect(pressed(el)).toEqual([])
  })

  it('a text column: "Does not contain" over the box; Enter writes ONE `notContains` rule, and back in it is pressed with the text in the box', () => {
    const { el, def, onChange } = mount(ORDER, {}, HOST)
    rightClick(th(el, 5))
    click(item(el, 'Filter'))
    expect(pressed(el)).toEqual(['Contains'])
    click(opButton(el, 'Does not contain'))
    expect(onChange).not.toHaveBeenCalled()
    enter(el, 'Does not contain', 'Agentic')
    expect(view(def).filters).toEqual({ and: ['!note.pillar.lower().contains("agentic")'] })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(el.querySelector('.ctx-menu')).toBeNull()
    rightClick(th(el, 5))
    expect(item(el, 'Filter').getAttribute('data-hint')).toBe('✓')
    click(item(el, 'Filter'))
    expect(pressed(el)).toEqual(['Does not contain'])
    expect(box(el, 'Does not contain').value).toBe('agentic')
    // The switch back keeps the text: Contains + Enter rewrites it as the plain rule.
    click(opButton(el, 'Contains'))
    expect(box(el, 'Contains').value).toBe('agentic')
    enter(el, 'Contains', 'agentic')
    expect(view(def).filters).toEqual({ and: ['note.pillar.lower().contains("agentic")'] })
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('Open the filter panel… closes the menu and opens the toolbar\'s Filter popover; nothing is written', () => {
    const { el, onChange } = mount(ORDER, {}, HOST)
    const button = q<HTMLElement>(el, '.view-toolbar__btn[aria-label="Filter"]')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    rightClick(th(el, 1))
    pick(el, 'Filter', 'Open the filter panel…')
    expect(el.querySelector('.ctx-menu')).toBeNull()
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(el.querySelector('.view-popover--filter .filter-menu')).not.toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('one pair of quotes around the typed text is dropped (YAZ-4919 round 2): "Agentic", \'Agentic\' and “Agentic” are Agentic; an emptied pair takes the rule away', () => {
    const { el, def, onChange } = mount(ORDER, {}, HOST)
    rightClick(th(el, 5))
    click(item(el, 'Filter'))
    enter(el, 'Contains', '"Agentic"')
    expect(view(def).filters).toEqual({ and: ['note.pillar.lower().contains("agentic")'] })
    rightClick(th(el, 5))
    click(item(el, 'Filter'))
    enter(el, 'Contains', '“Creator”')
    expect(view(def).filters).toEqual({ and: ['note.pillar.lower().contains("creator")'] })
    rightClick(th(el, 5))
    click(item(el, 'Filter'))
    enter(el, 'Contains', '""')
    expect(view(def).filters).toBeUndefined()
    expect(onChange).toHaveBeenCalledTimes(3)
  })

  it('a live count under the box (YAZ-4919 round 2): "2 rows match" / "No rows match" after the typing pause, under the pressed operator, with the other columns\' rules applied; nothing is written', () => {
    vi.useFakeTimers()
    try {
      const { el, onChange } = mount(FILTERED, {}, HOST)
      // FILTERED keeps one row (status idea, priority > 1): Agentic Agency.
      rightClick(th(el, 5))
      click(item(el, 'Filter'))
      expect(valueRows(el)).toEqual([['Agentic Agency', '1']])
      const input = box(el, 'Contains')
      setValue(input, 'AGEN')
      expect(count(el)).toBeNull() // not per keystroke
      act(() => void vi.advanceTimersByTime(300))
      draw()
      expect(count(el)).toBe('1 row matches')
      setValue(input, 'creator')
      act(() => void vi.advanceTimersByTime(300))
      draw()
      expect(count(el)).toBe('No rows match')
      expect(valueRows(el)).toEqual([])
      // Does not contain: the one row does not contain "creator".
      click(opButton(el, 'Does not contain'))
      act(() => void vi.advanceTimersByTime(300))
      draw()
      expect(count(el)).toBe('1 row matches')
      expect(onChange).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('the count and the values leave this column\'s own rule out, so an old exact rule still shows every value that contains the text', () => {
    vi.useFakeTimers()
    try {
      const { el } = mount(`${ORDER}    filters:\n      and:\n        - 'note.pillar.contains("Creator")'\n`, {}, HOST)
      rightClick(th(el, 5))
      click(item(el, 'Filter'))
      expect(box(el, 'Contains').value).toBe('Creator')
      expect(count(el)).toBe('2 rows match')
      expect(valueRows(el)).toEqual([['Creator Economy', '2']])
      setValue(box(el, 'Contains'), '')
      act(() => void vi.advanceTimersByTime(300))
      draw()
      expect(count(el)).toBeNull()
      expect(valueRows(el)).toEqual([
        ['Agentic Agency', '2'],
        ['Creator Economy', '2'],
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it('a click on a value writes ONE exact "is" rule and closes the menu; back in, that value wears the ✓', () => {
    const { el, def, onChange } = mount(ORDER, {}, HOST)
    rightClick(th(el, 5))
    click(item(el, 'Filter'))
    click(flyout(el).find((b) => b.textContent === 'Creator Economy')!)
    expect(view(def).filters).toEqual({ and: ['note.pillar == "Creator Economy"'] })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(el.querySelector('.ctx-menu')).toBeNull()
    expect(badge(el)).toBe('1')
    rightClick(th(el, 5))
    expect(item(el, 'Filter').getAttribute('data-hint')).toBe('✓')
    click(item(el, 'Filter'))
    expect(checked(el)).toEqual(['Creator Economy'])
    expect(valueRows(el)).toEqual([
      ['Agentic Agency', '2'],
      ['Creator Economy', '2'],
    ])
  })

  it('Esc in a box closes the flyout alone and writes nothing; a tick keeps the menu, and Esc then closes the flyout', () => {
    const { el, onChange } = mount(ORDER, {}, HOST)
    rightClick(th(el, 5))
    click(item(el, 'Filter'))
    const input = box(el, 'Contains')
    setValue(input, 'Agen')
    press(input, 'Escape')
    expect(el.querySelector('.ctx-menu__sub')).toBeNull()
    expect(menuItems(el)).toContain('Filter')
    expect(onChange).not.toHaveBeenCalled()
  })
})
