/**
 * The table header's tools (YAZ-4590): the sort arrow (S19), the auto-fit of a column's width on a double-click of its
 * resize edge (S20), and the column description on header hover (S23). ViewsPane mounted with react-dom in jsdom over
 * `TEST_RECORDS`. jsdom has no layout, so the S20 tests give the measured nodes their widths.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ColumnDecl } from '../folderSettings'
import { type ParsedViews, type ViewSet, parseViews } from '../viewSchema'
import { type FolderHost, ViewsPane } from '../ViewsPane'
import { testFolderHost } from '../testFolderHost'
import { TEST_RECORDS } from '../testRecords'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const table = (extra = '') => `views:
  - type: table
    name: T
    order:
      - file.name
      - note.status
      - note.priority
${extra}`

let root: Root | null = null
let container: HTMLElement | null = null
let draw: () => void = () => {}

function mount(text: string, columns: Record<string, ColumnDecl> = { status: { kind: 'text' } }, host: Partial<FolderHost> = {}) {
  let parsed = parseViews(text)
  const onChange = vi.fn((next: ParsedViews) => {
    parsed = next
  })
  const folder = testFolderHost({ settings: { columns, views: [], problems: [] }, ...host })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  draw = () =>
    act(() =>
      root?.render(<ViewsPane parsed={parsed} onChange={onChange} root="/vault" folderPath="/vault/pillars.md" records={TEST_RECORDS} folder={folder} onOpenFile={vi.fn()} />),
    )
  draw()
  return { el: container, onChange, def: (): ViewSet => parsed.def }
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  delete (Range.prototype as Partial<Range>).getBoundingClientRect
  vi.restoreAllMocks()
})

function q<T extends Element>(el: ParentNode, sel: string): T {
  const n = el.querySelector<T>(sel)
  if (n === null) throw new Error(`missing ${sel}`)
  return n
}
function fire(target: Element, type: string): void {
  act(() => void target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 })))
  draw()
}
const th = (el: ParentNode, index: number): HTMLElement => [...el.querySelectorAll<HTMLElement>('.view-table thead th:not(.view-table__gutter)')][index]
const arrow = (el: ParentNode, index: number): HTMLElement | null => th(el, index).querySelector<HTMLElement>('.view-table__sort')

describe('the sort arrow on the header (YAZ-4590 S19)', () => {
  it('a sorted column shows ▲ for A → Z and no position when there is one rule; other columns show none', () => {
    const { el } = mount(table('    sort:\n      - property: note.priority\n        direction: ASC\n'))
    const a = arrow(el, 2)!
    expect(a.dataset.dir).toBe('ASC')
    expect(a.dataset.pos).toBeUndefined()
    expect(a.getAttribute('aria-label')).toBe('Sorted A → Z. Click to flip')
    expect(arrow(el, 0)).toBeNull()
    expect(arrow(el, 1)).toBeNull()
    // The header still reads as its label: the glyph is drawn by views.css.
    expect(th(el, 2).textContent).toBe('Priority')
  })

  it('a Select column names its order (D1b): Option order is ▲, Z → A by value is ▼', () => {
    const select: Record<string, ColumnDecl> = { status: { kind: 'select', options: ['idea', 'drafting', 'published'] } }
    let { el } = mount(table('    sort:\n      - property: note.status\n        direction: ASC\n'), select)
    expect(arrow(el, 1)!.dataset.dir).toBe('ASC')
    expect(arrow(el, 1)!.getAttribute('aria-label')).toBe('Sorted Option order. Click to flip')
    act(() => root?.unmount())
    container?.remove()
    ;({ el } = mount(table('    sort:\n      - property: note.status\n        direction: DESC\n        by: value\n'), select))
    expect(arrow(el, 1)!.dataset.dir).toBe('DESC')
    expect(arrow(el, 1)!.getAttribute('aria-label')).toBe('Sorted Z → A. Click to flip')
  })

  it('several sorts: each sorted header shows its position in the sort', () => {
    const { el } = mount(table('    sort:\n      - property: note.priority\n        direction: DESC\n      - property: note.status\n        direction: ASC\n'))
    expect(arrow(el, 2)!.dataset.pos).toBe('1')
    expect(arrow(el, 2)!.dataset.dir).toBe('DESC')
    expect(arrow(el, 1)!.dataset.pos).toBe('2')
    expect(arrow(el, 1)!.getAttribute('aria-label')).toBe('Sort 2: A → Z. Click to flip')
  })

  it('a click on the arrow flips that rule only: ONE write, its `by` kept, the other rule untouched', () => {
    const { el, onChange, def } = mount(table('    sort:\n      - property: note.priority\n        direction: DESC\n      - property: note.status\n        direction: ASC\n        by: value\n'), { status: { kind: 'select', options: ['idea'] } })
    fire(arrow(el, 1)!, 'click')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(def().views[0].sort).toEqual([
      { property: 'note.priority', direction: 'DESC' },
      { property: 'note.status', direction: 'DESC', by: 'value' },
    ])
    expect(arrow(el, 1)!.dataset.dir).toBe('DESC')
    expect(el.querySelector('.ctx-menu')).toBeNull()
  })
})

describe('auto-fit width on a double-click of the resize edge (YAZ-4590 S20)', () => {
  /** jsdom has no layout: text measures 7px a character, and each mounted Priority value `width` px (cells pad 1px a side). */
  function layout(el: ParentNode, width: number): void {
    Range.prototype.getBoundingClientRect = function (this: Range) {
      return { width: (this.startContainer.textContent ?? '').length * 7 } as DOMRect
    }
    for (const cell of el.querySelectorAll<HTMLElement>('td[data-cell$=":2"]'))
      for (const child of cell.children) Object.defineProperty(child, 'scrollWidth', { configurable: true, value: width })
  }
  const grip = (el: ParentNode): HTMLElement => q(th(el, 2), '.view-table__resize')
  const doubleClick = (el: ParentNode): void => {
    // A real double-click is two presses first: each starts a resize that moves nothing.
    for (const type of ['mousedown', 'mouseup', 'mousedown', 'mouseup']) fire(type === 'mousedown' ? grip(el) : (window as unknown as Element), type)
    fire(grip(el), 'dblclick')
  }

  it('fits the column to its widest mounted cell in ONE columnSize write; the two presses write nothing', () => {
    const { el, onChange, def } = mount(table())
    layout(el, 230)
    doubleClick(el)
    expect(onChange).toHaveBeenCalledTimes(1)
    // 230 and the cell's two side paddings, as the page computes them: views.css says `var(--view-table-cell-pad-x)`
    // (8px on screen), which jsdom does not resolve.
    const style = getComputedStyle(q(el, 'td[data-cell$=":2"]'))
    const pads = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0)
    expect(def().views[0].columnSize).toEqual({ 'note.priority': 230 + pads })
  })

  it('the header label counts too, and the width is clamped to 40–600 (YAZ-4819: 40px, was 60px)', () => {
    let { el, def } = mount(table())
    layout(el, 2)
    doubleClick(el)
    expect(def().views[0].columnSize).toEqual({ 'note.priority': 56 }) // "Priority" is 56px: over the 40px floor, so it fits the label
    act(() => root?.unmount())
    container?.remove()
    ;({ el, def } = mount(table()))
    layout(el, 4000)
    doubleClick(el)
    expect(def().views[0].columnSize).toEqual({ 'note.priority': 600 })
  })
})

describe('the column description (YAZ-4590 S23)', () => {
  // YAZ-4772: in the app's hover box (a native title showed nothing in the app), around the column's name.
  it('the header shows a column description on hover; a column with none has no tooltip', () => {
    vi.useFakeTimers()
    try {
      const { el } = mount(table(), { status: { kind: 'text', description: 'Where the page stands' } })
      const described = th(el, 1).querySelector<HTMLElement>(':scope > span:not([class])')!
      expect(described.textContent).toBe('Status')
      act(() => void described.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
      act(() => void vi.advanceTimersByTime(400))
      expect(document.querySelector('.hover-tip[role="tooltip"]')?.textContent).toBe('Where the page stands')
      expect(th(el, 1).hasAttribute('title')).toBe(false)
      expect(th(el, 2).querySelector(':scope > span:not([class])')).toBeNull()
      expect(th(el, 2).hasAttribute('title')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('Edit column sets it through ONE setColumn, and a blank field removes it', () => {
    const setColumn = vi.fn().mockResolvedValue(undefined)
    const { el } = mount(table(), { status: { kind: 'text', description: 'Old' } }, { setColumn })
    fire(th(el, 1), 'contextmenu')
    const edit = [...el.querySelectorAll<HTMLElement>('.ctx-menu [role="menuitem"]')].find((b) => b.textContent === 'Edit column…')!
    act(() => edit.click())
    draw()
    const field = q<HTMLInputElement>(el, '.column-detail [aria-label="Column description"]')
    expect(field.value).toBe('Old')
    const commit = (value: string) => {
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, value)
        field.dispatchEvent(new Event('input', { bubbles: true }))
      })
      act(() => void field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
      draw()
    }
    commit('Where the page stands')
    expect(setColumn).toHaveBeenLastCalledWith('status', { kind: 'text', description: 'Where the page stands' }, { kind: 'text', description: 'Old' })
    commit('  ')
    expect(setColumn).toHaveBeenLastCalledWith('status', { kind: 'text' }, { kind: 'text', description: 'Old' })
    expect(setColumn).toHaveBeenCalledTimes(2)
  })

  it('an undeclared column is declared with the kind it shows when it gets a description', () => {
    const setColumn = vi.fn().mockResolvedValue(undefined)
    const { el } = mount(table(), {}, { setColumn })
    fire(th(el, 2), 'contextmenu')
    act(() => [...el.querySelectorAll<HTMLElement>('.ctx-menu [role="menuitem"]')].find((b) => b.textContent === 'Edit column…')!.click())
    draw()
    const field = q<HTMLInputElement>(el, '.column-detail [aria-label="Column description"]')
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, 'How urgent')
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => void field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    expect(setColumn).toHaveBeenCalledExactlyOnceWith('priority', { kind: 'number', description: 'How urgent' }, undefined)
  })
})

describe('a Linked mentions column\'s Edit column (YAZ-4739 L2)', () => {
  const editColumn = (el: HTMLElement) => {
    fire(th(el, 1), 'contextmenu')
    act(() => [...el.querySelectorAll<HTMLElement>('.ctx-menu [role="menuitem"]')].find((b) => b.textContent === 'Edit column…')!.click())
    draw()
  }
  const commit = (field: HTMLInputElement, value: string) => {
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, value)
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => void field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    draw()
  }

  it('"Only from the column" and "Only from the folder" each write `from` in ONE setColumn; a folder gets its brackets', () => {
    const setColumn = vi.fn().mockResolvedValue(undefined)
    const { el } = mount(table(), { status: { kind: 'mentions' } }, { setColumn })
    editColumn(el)
    // No relation and no separate value for a column no note holds.
    expect(el.querySelector('.column-detail [aria-label="Link target"], .column-detail [aria-label^="Relation for"]')).toBeNull()
    commit(q<HTMLInputElement>(el, '.column-detail [aria-label="Only from the column for Status"]'), 'Reads / writes')
    expect(setColumn).toHaveBeenLastCalledWith('status', { kind: 'mentions', from: { column: 'Reads / writes' } }, { kind: 'mentions' })
    commit(q<HTMLInputElement>(el, '.column-detail [aria-label="Only from the folder for Status"]'), 'API')
    expect(setColumn).toHaveBeenLastCalledWith('status', { kind: 'mentions', from: { folder: '[[API]]' } }, { kind: 'mentions' })
  })

  it('"Only from the column" asks for a field name and suggests the link columns the vault’s folders define; any name still types (7A 20)', () => {
    const folderMd = (folder: string, columns: Record<string, ColumnDecl>) => ({ ...TEST_RECORDS[0], path: `/vault/${folder}/.folder.md`, folder, properties: { folder_settings: { columns } } })
    const vaultFolders = [folderMd('api', { reads_writes: { kind: 'multi-link' }, owner: { kind: 'text' } }), folderMd('kpis', { calls: { kind: 'link' }, reads_writes: { kind: 'multi-link' } })]
    const { el } = mount(table(), { status: { kind: 'mentions' } }, { vaultFolders })
    editColumn(el)
    const field = q<HTMLInputElement>(el, '.column-detail [aria-label="Only from the column for Status"]')
    expect(field.placeholder).toBe('field name, e.g. reads_writes')
    expect([...(field.list?.options ?? [])].map((o) => o.value)).toEqual(['calls', 'reads_writes'])
  })

  it('a blank field removes its part alone', () => {
    const setColumn = vi.fn().mockResolvedValue(undefined)
    const { el } = mount(table(), { status: { kind: 'mentions', from: { column: 'calls', folder: '[[API]]' } } }, { setColumn })
    editColumn(el)
    commit(q<HTMLInputElement>(el, '.column-detail [aria-label="Only from the column for Status"]'), '')
    expect(setColumn).toHaveBeenLastCalledWith('status', { kind: 'mentions', from: { folder: '[[API]]' } }, { kind: 'mentions', from: { column: 'calls', folder: '[[API]]' } })
  })
})
