import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SortMenu } from './SortMenu'
import type { Mutate, SortSpec, ViewSet, ViewDef } from '../viewSchema'
import type { FolderSettings } from '../folderSettings'
import { TEST_RECORDS } from '../testRecords'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let container: HTMLDivElement | undefined
const INITIAL: SortSpec[] = [
  { property: 'note.status', direction: 'DESC' },
  { property: 'file.name', direction: 'ASC' },
  { property: 'note.priority', direction: 'DESC' },
]

function mount(view: ViewDef = { name: 'Table', type: 'table', sort: structuredClone(INITIAL) }, settings: FolderSettings = { columns: {}, views: [], problems: [] }, records = TEST_RECORDS) {
  let def: ViewSet = { views: [view] }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const onUpdate = vi.fn<Mutate>((mutate) => {
    def = structuredClone(def)
    mutate(def)
    render()
  })
  const render = () => root!.render(<SortMenu def={def} view={def.views[0]} viewIndex={0} records={records} onUpdate={onUpdate} settings={settings} />)
  act(render)
  const el = container
  const grip = (index: number, label: string) => el.querySelector<HTMLButtonElement>(`[aria-label="Reorder sort ${index}: ${label}"]`)!
  const replace = (sort: SortSpec[]) => act(() => {
    def = { ...def, views: [{ ...def.views[0], sort: structuredClone(sort) }] }
    render()
  })
  return { el, grip, replace, onUpdate, sort: () => def.views[0].sort!, view: () => def.views[0] }
}

function drag(target: HTMLElement, type: string, clientY = 0) {
  act(() => { target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientY })) })
}
function press(target: HTMLElement, key: string) {
  act(() => { target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key })) })
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
})

describe('SortMenu external settings refresh', () => {
  it('discards an in-flight drag after changed sort settings arrive, then reorders the replacement safely', () => {
    const { el, grip, replace, sort, onUpdate } = mount()
    drag(grip(1, 'Status'), 'dragstart')
    drag(grip(3, 'Priority').closest('li')!, 'dragover', 5)
    expect(el.querySelector('.view-prop--dragging')).not.toBeNull()
    const replacement: SortSpec[] = [
      { property: 'note.priority', direction: 'ASC' },
      { property: 'file.name', direction: 'DESC' },
    ]
    replace(replacement)
    expect(el.querySelector('.view-prop--dragging, .view-prop--insert-after')).toBeNull()
    drag(grip(2, 'Name').closest('li')!, 'drop', 5)
    expect(onUpdate).not.toHaveBeenCalled()
    expect(sort()).toEqual(replacement)

    const last = grip(2, 'Name')
    last.focus()
    press(last, 'ArrowUp')
    expect(sort()).toEqual([replacement[1], replacement[0]])
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(grip(1, 'Name'))
  })

  it('retains rule DOM identity and focused control across an equivalent freshly parsed sort array', () => {
    const { grip, replace, sort, onUpdate } = mount()
    const focused = grip(2, 'Name')
    const row = focused.closest('li')
    focused.focus()
    replace(INITIAL)
    expect(grip(2, 'Name')).toBe(focused)
    expect(grip(2, 'Name').closest('li')).toBe(row)
    expect(document.activeElement).toBe(focused)
    expect(onUpdate).not.toHaveBeenCalled()

    press(focused, 'ArrowDown')
    expect(sort()).toEqual([INITIAL[0], INITIAL[2], INITIAL[1]])
    expect(grip(3, 'Name')).toBe(focused)
    expect(document.activeElement).toBe(focused)
    expect(onUpdate).toHaveBeenCalledTimes(1)
  })
})


/** Open a DirectionPicker by its label and choose one item by its text (YAZ-3940). */
function pick(el: HTMLElement, label: string, item: string) {
  act(() => el.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click())
  const choice = [...el.querySelectorAll<HTMLElement>('[role="menuitemradio"], [role="menuitem"]')].find(b => b.textContent?.replace('✓', '').trim() === item)
  expect(choice, item).toBeDefined()
  act(() => choice!.click())
}
const itemsOf = (el: HTMLElement, label: string) => {
  act(() => el.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click())
  const items = [...el.querySelectorAll<HTMLElement>('[role="menuitemradio"], [role="menuitem"]')].map(b => b.textContent?.replace('✓', '').trim())
  act(() => el.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click())
  return items
}

describe('Option order menu (YAZ-3940)', () => {
  const folder: FolderSettings = { columns: { status: { kind: 'select', options: ['Z', 'A'], optionSort: 'ascending' }, tags: { kind: 'multi-select', options: ['B', 'A'] } }, views: [], problems: [] }
  it('labels select grouping as option order and its reversal without changing stored direction semantics', () => {
    const { el, onUpdate, view } = mount({ name: 'Board', type: 'board', groupBy: [{ property: 'note.status' }, { property: 'note.tags', direction: 'DESC' }] }, folder)
    const outer = () => el.querySelector<HTMLButtonElement>('[aria-label="Group direction"]')!
    const inner = () => el.querySelector<HTMLButtonElement>('[aria-label="Then group direction"]')!
    expect(outer().textContent).toContain('Option order')
    expect(inner().textContent).toContain('Reversed option order')
    pick(el, 'Group direction', 'Reversed option order')
    expect(outer().textContent).toContain('Reversed option order')
    pick(el, 'Then group direction', 'Option order')
    expect(inner().textContent).toContain('Option order')
    expect(view().groupBy).toEqual([{ property: 'note.status', direction: 'DESC' }, { property: 'note.tags', direction: 'ASC' }])
    expect(onUpdate).toHaveBeenCalledTimes(2)
  })
  it('a Table names the option order too: the board-only guard is gone', () => {
    const { el } = mount({ name: 'Table', type: 'table', groupBy: { property: 'note.status', direction: 'DESC' } }, folder)
    expect(el.querySelector('[aria-label="Group direction"]')?.textContent).toContain('Reversed option order')
  })
  it('a Select column offers the four orders; another column offers A → Z and Z → A', () => {
    const { el } = mount({ name: 'Table', type: 'table', sort: [{ property: 'note.status', direction: 'ASC' }, { property: 'note.other', direction: 'DESC' }] }, folder)
    const [first, second] = [...el.querySelectorAll<HTMLButtonElement>('[aria-label="Direction"]')]
    expect(second.textContent).toContain('Z → A')
    act(() => first.click())
    expect([...el.querySelectorAll('[role="menuitemradio"]')].map(b => [b.textContent?.replace('✓', '').trim(), b.getAttribute('aria-checked')])).toEqual([
      ['Option order', 'true'], ['Reversed option order', 'false'], ['A → Z', 'false'], ['Z → A', 'false'],
    ])
    act(() => first.click())
    act(() => second.click())
    expect([...el.querySelectorAll('[role="menuitemradio"]')].map(b => b.textContent?.replace('✓', '').trim())).toEqual(['A → Z', 'Z → A'])
  })
  it('A → Z on a Select column saves `by: value`; Option order removes it again', () => {
    const { el, sort } = mount({ name: 'Table', type: 'table', sort: [{ property: 'note.status', direction: 'DESC' }] }, folder)
    pick(el, 'Direction', 'A → Z')
    expect(sort()).toEqual([{ property: 'note.status', direction: 'ASC', by: 'value' }])
    expect(el.querySelector('[aria-label="Direction"]')?.textContent).toContain('A → Z')
    pick(el, 'Direction', 'Option order')
    expect(sort()).toEqual([{ property: 'note.status', direction: 'ASC' }])
    expect(Object.hasOwn(sort()[0], 'by')).toBe(false)
  })
  it('a group level saves `by: value` the same way, and keeps it when the other level changes', () => {
    const { el, view } = mount({ name: 'Table', type: 'table', groupBy: { property: 'note.status' } }, folder)
    pick(el, 'Group direction', 'Z → A')
    expect(view().groupBy).toEqual({ property: 'note.status', direction: 'DESC', by: 'value' })
  })
  it('another column writes only the direction', () => {
    const { el, sort } = mount({ name: 'Table', type: 'table', sort: [{ property: 'note.other', direction: 'ASC' }] }, folder)
    pick(el, 'Direction', 'Z → A')
    expect(sort()).toEqual([{ property: 'note.other', direction: 'DESC' }])
  })
  it('"Edit option order…" shows only when the menu can open the column editor, and names the column', () => {
    expect(itemsOf(mount({ name: 'Table', type: 'table', groupBy: { property: 'note.status' } }, folder).el, 'Group direction')).not.toContain('Edit option order…')
    act(() => root?.unmount())
    container?.remove()
    const onEditColumn = vi.fn()
    const def: ViewSet = { views: [{ name: 'Table', type: 'table', groupBy: { property: 'status' } }] }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root!.render(<SortMenu def={def} view={def.views[0]} viewIndex={0} records={TEST_RECORDS} onUpdate={vi.fn()} settings={folder} onEditColumn={onEditColumn} />))
    expect(itemsOf(container, 'Group direction')).toContain('Edit option order…')
    pick(container, 'Group direction', 'Edit option order…')
    expect(onEditColumn).toHaveBeenCalledWith('note.status')
    expect(container.querySelector('[role="menu"]')).toBeNull()
  })
  it('Escape closes the menu and gives the focus back to its button', () => {
    const { el } = mount({ name: 'Table', type: 'table', sort: [{ property: 'note.status', direction: 'ASC' }] }, folder)
    const trigger = el.querySelector<HTMLButtonElement>('[aria-label="Direction"]')!
    act(() => trigger.click())
    const menu = el.querySelector<HTMLElement>('[role="menu"]')!
    expect(document.activeElement?.getAttribute('aria-checked')).toBe('true')
    press(menu, 'Escape')
    expect(el.querySelector('[role="menu"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})


it('offers a declared-only property for Board grouping with zero records', () => {
  const folder: FolderSettings = { columns: { Stage: { kind: 'select', options: ['Inbox', 'Ready'] } }, views: [{ type: 'table', name: 'Table', order: ['note.Stage'] }], problems: [] }
  const { el, view } = mount({ type: 'board', name: 'Board' }, folder, [])
  act(() => el.querySelector<HTMLButtonElement>('[aria-label="Group by"]')!.click())
  const choice = el.querySelector<HTMLButtonElement>('[role="option"][data-value="note.Stage"]')
  expect(choice).not.toBeNull()
  act(() => choice!.click())
  expect(view().groupBy).toEqual({ property: 'note.Stage', direction: 'ASC' })
  expect(el.querySelector('[aria-label="Group direction"]')?.textContent).toContain('Option order')
})
