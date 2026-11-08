/**
 * The table header's context menu (YAZ-1513): ViewsPane mounted with react-dom in jsdom over
 * `TEST_RECORDS`; a right-click on a column `<th>` offers Rename / Hide / Add-to-the-right, and
 * on the `#` header only Hide row numbers. Every write is one `onChange` (the Properties menu's own
 * rules: `setDisplayName`, `setViewOrder`) or one `setColumns` — the folder host's door.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { type ParsedViews, type ViewSet, parseViews, serializeViews } from '../viewSchema'
import { type FolderHost, ViewsPane, type ViewsPaneProps } from '../ViewsPane'
import { testFolderHost } from '../testFolderHost'
import { TEST_RECORDS } from '../testRecords'
import { deleteColumnMessage } from './ConfirmDeleteColumn'
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

// ---------- tests ----------

describe('the header menu (YAZ-1513)', () => {
  it('opens on a column header with Rename / Hide / Add to the right; Escape closes it without a write', () => {
    const { el, onChange } = mount()
    expect(el.querySelector('.ctx-menu')).toBeNull()
    rightClick(th(el, 1))
    expect(menuItems(el)).toEqual([
      'Edit column…',
      'Rename column…',
      'Hide column',
      'Add column to the right…',
      'Sort A to Z',
      'Sort Z to A',
      'Group by this column',
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
    expect(el.querySelector('.view-table__gutter')).toBeNull()
  })

  it('Delete column…: asks first — the sheet names the label, the key and the count of notes holding a value; Cancel deletes nothing', () => {
    const { el, deleteColumn, onChange } = mount()
    rightClick(th(el, 1))
    click(item(el, 'Delete column…'))
    expect(el.querySelector('.ctx-menu')).toBeNull() // the menu yields to the sheet
    const sheet = q<HTMLElement>(el, '.confirm[role="dialog"]')
    // TEST_RECORDS: five of the eight carry `status`
    expect(q(sheet, '.confirm__text').textContent).toBe('Delete "Status"? This removes the column from this folder and the "status" value from 5 notes.')
    expect(document.activeElement?.textContent).toBe('Cancel')
    click([...sheet.querySelectorAll<HTMLButtonElement>('.confirm__btn')].find((b) => b.textContent === 'Cancel')!)
    expect(el.querySelector('.confirm')).toBeNull()
    expect(deleteColumn).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('Delete a column from a folder: the confirm sheet’s copy is `Delete "<label>"? This removes the column from this folder and the "<key>" value from N notes.` — and nothing more', () => {
    const lost = (notes: string): string => `Delete "Status"? This removes the column from this folder and the "status" value from ${notes}.`
    expect(deleteColumnMessage('Status', 'status', 1)).toBe(lost('1 note'))
    expect(deleteColumnMessage('Status', 'status', 3)).toBe(lost('3 notes'))
    expect(deleteColumnMessage('Status', 'status', 0)).toBe(lost('0 notes'))
  })

  it('Delete column…: confirming hands the key to FolderHost.deleteColumn — the ONE function — and closes the sheet', () => {
    const { el, deleteColumn } = mount()
    rightClick(th(el, 1))
    click(item(el, 'Delete column…'))
    click([...el.querySelectorAll<HTMLButtonElement>('.confirm__btn')].find((b) => b.textContent === 'Delete')!)
    expect(deleteColumn).toHaveBeenCalledExactlyOnceWith('note.status')
    expect(el.querySelector('.confirm')).toBeNull()
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
    const select = q<HTMLSelectElement>(detail, '[aria-label="Edit property Status"]')
    expect(select.value).toBe('text')
    setValue(select, 'number')
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
    click(item(el, 'Sort A to Z'))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(view(def).sort).toEqual([{ property: 'note.status', direction: 'ASC' }])
    expect(el.querySelector('.ctx-menu')).toBeNull()
    rightClick(th(el, 0))
    click(item(el, 'Sort Z to A'))
    expect(view(def).sort).toEqual([{ property: 'file.name', direction: 'DESC' }])
    expect(yaml()).toContain('property: file.name\n        direction: DESC')
  })

  it('on a Select or Multi-select column, Sort A to Z / Z to A sort by value, not in option order (YAZ-4544)', () => {
    for (const kind of ['select', 'multi-select'] as const) {
      const { el, def } = mount(BASE, {}, { settings: { columns: { status: { kind, options: ['zeta', 'alpha'] } }, views: [], problems: [] } })
      rightClick(th(el, 1))
      click(item(el, 'Sort A to Z'))
      expect(view(def).sort).toEqual([{ property: 'note.status', direction: 'ASC', by: 'value' }])
      rightClick(th(el, 1))
      click(item(el, 'Sort Z to A'))
      expect(view(def).sort).toEqual([{ property: 'note.status', direction: 'DESC', by: 'value' }])
      act(() => root?.unmount())
      container?.remove()
    }
  })

  it('Group by this column sets the FIRST level: no grouping yet → the single-object form', () => {
    const { el, def } = mount()
    rightClick(th(el, 1))
    click(item(el, 'Group by this column'))
    expect(view(def).groupBy).toEqual({ property: 'note.status', direction: 'ASC' })
  })

  it('Group by this column keeps the other levels and the first level’s style; the column leaves a later level', () => {
    const levels = `${BASE}    groupBy:\n      - property: note.pillar\n        direction: DESC\n        highlight: blue\n      - property: note.priority\n        direction: ASC\n`
    const first = mount(levels)
    rightClick(th(first.el, 1))
    click(item(first.el, 'Group by this column'))
    expect(view(first.def).groupBy).toEqual([
      { property: 'note.status', direction: 'ASC', highlight: 'blue' },
      { property: 'note.priority', direction: 'ASC' },
    ])
    act(() => root?.unmount())
    container?.remove()

    const again = mount(levels)
    rightClick(th(again.el, 2)) // priority, the second level today
    click(item(again.el, 'Group by this column'))
    expect(view(again.def).groupBy).toEqual({ property: 'note.priority', direction: 'ASC', highlight: 'blue' })
  })

  it('Group by this column keeps a later entry with no column as it is (YAZ-4544)', () => {
    const { el, def } = mount(`${BASE}    groupBy:\n      - property: note.pillar\n      - {}\n`)
    rightClick(th(el, 1))
    click(item(el, 'Group by this column'))
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

  it('an empty name is refused: "Type a name"', () => {
    const { el, setColumns } = mount()
    rightClick(th(el, 0))
    click(item(el, 'Add column to the right…'))
    click(q(el, '.ctx-menu [aria-label="Save column"]'))
    expect(q(el, '.ctx-menu [role="alert"]').textContent).toBe('Type a name')
    expect(setColumns).not.toHaveBeenCalled()
  })
})

