import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SortMenu } from './SortMenu'
import { type GroupBySpec, type Mutate, type SortSpec, type ViewSet, type ViewDef, groupByLevels } from '../viewSchema'
import type { FolderSettings } from '../folderSettings'
import { TEST_RECORDS } from '../testRecords'
import { liveGapPoint } from '../../test-liveGap'

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

/** "Add group level" (YAZ-4607 D60): a row on the first free column; null while the button is hidden (three levels). */
const addLevelButton = (el: ParentNode) => [...el.querySelectorAll<HTMLButtonElement>('.view-menu__action')].find((b) => b.textContent === 'Add group level') ?? null
const addLevel = (el: ParentNode) => act(() => addLevelButton(el)!.click())

/** `clientY` is px from the target row's midpoint, in a layout jsdom is given (YAZ-4606): the slot and the room are read from it. */
function drag(target: HTMLElement, type: string, clientY = 0) {
  act(() => { target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientY: liveGapPoint(target, 'y', clientY) })) })
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
    expect(el.querySelector('[data-live-parting]')).not.toBeNull() // the gap is the marker: no marker class (YAZ-4606)
    const replacement: SortSpec[] = [
      { property: 'note.priority', direction: 'ASC' },
      { property: 'file.name', direction: 'DESC' },
    ]
    replace(replacement)
    expect(el.querySelector('[data-live-parting]')).toBeNull()
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
  addLevel(el) // D60: the row first, then its picker
  act(() => el.querySelector<HTMLButtonElement>('[aria-label="Group by"]')!.click())
  const choice = el.querySelector<HTMLButtonElement>('[role="option"][data-value="note.Stage"]')
  expect(choice).not.toBeNull()
  act(() => choice!.click())
  expect(view().groupBy).toEqual({ property: 'note.Stage', direction: 'ASC' })
  expect(el.querySelector('[aria-label="Group direction"]')?.textContent).toContain('Option order')
})

describe('Group levels: handles, remove, third level (YAZ-4532)', () => {
  const THREE: GroupBySpec[] = [
    { property: 'note.status', direction: 'ASC' },
    { property: 'note.priority', direction: 'DESC' },
    { property: 'note.pillar', direction: 'ASC' },
  ]
  const levelGrip = (el: HTMLElement, index: number, label: string) => el.querySelector<HTMLButtonElement>(`[aria-label="Reorder group level ${index}: ${label}"]`)!

  it('a drag moves a level: the outer dropped below the last makes it the innermost', () => {
    const { el, view } = mount({ name: 'Table', type: 'table', groupBy: structuredClone(THREE) })
    drag(levelGrip(el, 1, 'Status'), 'dragstart')
    const last = levelGrip(el, 3, 'Pillar').closest('li')!
    drag(last, 'dragover', 5)
    expect(last.style.transform).toBe('translateY(-100px)') // the rows after the grab slide up: the gap opens at the end
    drag(last, 'drop', 5)
    expect(view().groupBy).toEqual([THREE[1], THREE[2], THREE[0]])
  })

  it('arrow keys move the focused level, and the focus stays on its handle', () => {
    const { el, view, onUpdate } = mount({ name: 'Table', type: 'table', groupBy: structuredClone(THREE) })
    const grip = levelGrip(el, 2, 'Priority')
    grip.focus()
    press(grip, 'ArrowUp')
    expect(view().groupBy).toEqual([THREE[1], THREE[0], THREE[2]])
    expect(document.activeElement).toBe(levelGrip(el, 1, 'Priority'))
    press(levelGrip(el, 1, 'Priority'), 'ArrowUp') // already first: nothing to write
    expect(onUpdate).toHaveBeenCalledTimes(1)
  })

  it('× removes the outer level and the inner moves up into the single-object form', () => {
    const { el, view } = mount({ name: 'Table', type: 'table', groupBy: [THREE[0], THREE[1]] })
    act(() => el.querySelector<HTMLButtonElement>('[aria-label="Remove group level 1: Status"]')!.click())
    expect(view().groupBy).toEqual(THREE[1])
    act(() => el.querySelector<HTMLButtonElement>('[aria-label="Remove group level 1: Priority"]')!.click())
    expect(view().groupBy).toBeUndefined()
  })

  it('× asks for the Undo toast with the level it removed (YAZ-4594 S29); a level added asks for none', () => {
    const { el, onUpdate } = mount({ name: 'Table', type: 'table', groupBy: [THREE[0], THREE[1]] })
    act(() => el.querySelector<HTMLButtonElement>('[aria-label="Remove group level 1: Status"]')!.click())
    expect(onUpdate.mock.lastCall?.[1]).toBe('Removed group level Status')
    addLevel(el)
    expect(onUpdate.mock.lastCall?.[1]).toBeUndefined()
  })

  it('a handle is disabled while there is one level only', () => {
    const { el } = mount({ name: 'Table', type: 'table', groupBy: THREE[0] })
    expect(levelGrip(el, 1, 'Status').disabled).toBe(true)
  })

  // YAZ-4607 D60: "Add group level" replaced the empty third picker; a level's picker exists only once its row does.
  it('"Add group level" adds the second and third level, each row picker refuses a column used above, and the button is gone at five (YAZ-3746 13AF)', () => {
    const { el, view } = mount({ name: 'Table', type: 'table', groupBy: THREE[0] })
    expect(el.querySelector('[aria-label="Then group by"]')).toBeNull()
    addLevel(el)
    act(() => el.querySelector<HTMLButtonElement>('[aria-label="Then group by"]')!.click())
    act(() => el.querySelector<HTMLButtonElement>('[role="option"][data-value="note.priority"]')!.click())
    expect(el.querySelector('[aria-label="Then group by (level 3)"]')).toBeNull()
    addLevel(el)
    act(() => el.querySelector<HTMLButtonElement>('[aria-label="Then group by (level 3)"]')!.click())
    const offered = [...el.querySelectorAll<HTMLElement>('[role="option"]')].map(o => o.dataset.value)
    expect(offered).not.toContain('note.status') // the same property twice is refused
    expect(offered).not.toContain('note.priority')
    act(() => el.querySelector<HTMLButtonElement>('[role="option"][data-value="note.pillar"]')!.click())
    expect(view().groupBy).toEqual([THREE[0], { property: 'note.priority', direction: 'ASC' }, { property: 'note.pillar', direction: 'ASC' }])
    expect(el.querySelectorAll('[aria-label^="Reorder group level"]')).toHaveLength(3)
    expect(el.querySelectorAll('[aria-label="Group by"], [aria-label="Then group by"], [aria-label="Then group by (level 3)"]')).toHaveLength(3)
    addLevel(el) // levels 4 and 5 take the first free columns (MAX_GROUP_LEVELS, YAZ-3746 13AF)
    addLevel(el)
    expect(groupByLevels(view())).toHaveLength(5)
    expect(addLevelButton(el)).toBeNull() // no sixth level
  })

  it('Folder may repeat at every level (YAZ-2541)', () => {
    const { el, view } = mount({ name: 'Table', type: 'table', groupBy: [{ property: 'file.folder', direction: 'ASC' }, { property: 'file.folder', direction: 'ASC' }] })
    addLevel(el)
    act(() => el.querySelector<HTMLButtonElement>('[aria-label="Then group by (level 3)"]')!.click())
    act(() => el.querySelector<HTMLButtonElement>('[role="option"][data-value="file.folder"]')!.click())
    expect(groupByLevels(view()).map(l => l.property)).toEqual(['file.folder', 'file.folder', 'file.folder'])
  })

  it('every write keeps a level\'s `by`, `highlight` and `large`: direction, property, move and remove', () => {
    const styled: GroupBySpec[] = [
      { property: 'note.status', direction: 'ASC', by: 'value', highlight: 'yellow', large: true },
      { property: 'note.priority', direction: 'ASC', highlight: 'blue' },
      { property: 'note.pillar', direction: 'ASC', large: true },
    ]
    const { el, view } = mount({ name: 'Table', type: 'table', groupBy: structuredClone(styled) })
    pick(el, 'Then group direction', 'Z → A')
    expect(view().groupBy).toEqual([styled[0], { ...styled[1], direction: 'DESC' }, styled[2]])
    act(() => el.querySelector<HTMLButtonElement>('[aria-label="Then group by (level 3)"]')!.click())
    act(() => el.querySelector<HTMLButtonElement>('[role="option"][data-value="note.tags"]')!.click())
    expect(groupByLevels(view())[2]).toEqual({ property: 'note.tags', direction: 'ASC', large: true })
    const grip = levelGrip(el, 1, 'Status')
    grip.focus()
    press(grip, 'ArrowDown')
    expect(groupByLevels(view())[1]).toEqual(styled[0])
    act(() => el.querySelector<HTMLButtonElement>('[aria-label="Remove group level 1: Priority"]')!.click())
    expect(view().groupBy).toEqual([styled[0], { property: 'note.tags', direction: 'ASC', large: true }])
  })

  // Group indent moved to Properties › View › Groups (YAZ-4607 D60): its tests are in PropertiesTabs.test.tsx.
})

describe('a group level with no column (YAZ-4544, finding 21)', () => {
  it('the menu opens, shows the usable level, and an edit keeps the bad entry as it is', () => {
    const bad = {} as GroupBySpec
    const { el, view } = mount({ name: 'Table', type: 'table', groupBy: [{ property: 'note.status' }, bad] })
    expect(el.querySelector('[aria-label="Group by"]')).not.toBeNull()
    expect(el.querySelector('[aria-label="Remove group level 1: Status"]')).not.toBeNull()
    expect(el.querySelector('[aria-label^="Remove group level 2"]')).toBeNull()
    expect(addLevelButton(el)).not.toBeNull() // D60: a button, no empty picker
    pick(el, 'Group direction', 'Z → A')
    expect(view().groupBy).toEqual([{ property: 'note.status', direction: 'DESC' }, {}])
    act(() => el.querySelector<HTMLButtonElement>('[aria-label="Remove group level 1: Status"]')!.click())
    expect(view().groupBy).toEqual([{}])
  })
})

describe('Group header style chip (YAZ-3742 D5)', () => {
  const chip = (el: HTMLElement, level: number) => el.querySelector<HTMLButtonElement>(`[aria-label="Style of group level ${level}"]`)!
  const panel = (el: HTMLElement) => el.querySelector<HTMLElement>('[role="dialog"][aria-label^="Style of group level"]')

  it('each level has an "Aa" chip that opens None, the 8 colours and Large', () => {
    const { el } = mount({ name: 'Table', type: 'table', groupBy: [{ property: 'note.status' }, { property: 'note.priority' }] })
    expect(chip(el, 1).textContent).toBe('Aa')
    expect(chip(el, 2)).not.toBeNull()
    act(() => chip(el, 1).click())
    expect(chip(el, 1).getAttribute('aria-expanded')).toBe('true')
    expect([...panel(el)!.querySelectorAll('[data-highlight]')].map(b => b.getAttribute('data-highlight'))).toEqual(['', 'yellow', 'green', 'blue', 'pink', 'orange', 'purple', 'red', 'gray'])
    expect(panel(el)!.querySelector('[data-highlight=""]')!.getAttribute('aria-pressed')).toBe('true')
    expect(panel(el)!.querySelector('[aria-label="Large"]')!.getAttribute('aria-pressed')).toBe('false')
  })

  it('a swatch writes `highlight`, Large writes `large`, and None / Large off remove the keys; the other level is untouched', () => {
    const { el, view } = mount({ name: 'Table', type: 'table', groupBy: [{ property: 'note.status', direction: 'DESC', by: 'value' }, { property: 'note.priority', direction: 'ASC' }] })
    act(() => chip(el, 1).click())
    act(() => panel(el)!.querySelector<HTMLButtonElement>('[data-highlight="green"]')!.click())
    expect(view().groupBy).toEqual([{ property: 'note.status', direction: 'DESC', by: 'value', highlight: 'green' }, { property: 'note.priority', direction: 'ASC' }])
    expect(panel(el)).not.toBeNull() // stays open for the next choice
    act(() => panel(el)!.querySelector<HTMLButtonElement>('[aria-label="Large"]')!.click())
    expect(groupByLevels(view())[0]).toEqual({ property: 'note.status', direction: 'DESC', by: 'value', highlight: 'green', large: true })
    expect(chip(el, 1).querySelector('.group-style__sample--large')).not.toBeNull() // the chip shows the style
    act(() => panel(el)!.querySelector<HTMLButtonElement>('[data-highlight=""]')!.click())
    act(() => panel(el)!.querySelector<HTMLButtonElement>('[aria-label="Large"]')!.click())
    expect(groupByLevels(view())[0]).toEqual({ property: 'note.status', direction: 'DESC', by: 'value' })
    expect(groupByLevels(view())[1]).toEqual({ property: 'note.priority', direction: 'ASC' })
  })

  it('Escape closes the panel and gives the focus back to the chip', () => {
    const { el } = mount({ name: 'Table', type: 'table', groupBy: { property: 'note.status' } })
    act(() => chip(el, 1).click())
    press(panel(el)!, 'Escape')
    expect(panel(el)).toBeNull()
    expect(document.activeElement).toBe(chip(el, 1))
  })

  it('the style stays through a property change and an order change', () => {
    const { el, view } = mount({ name: 'Table', type: 'table', groupBy: { property: 'note.status', highlight: 'pink', large: true } })
    pick(el, 'Group direction', 'Z → A')
    act(() => el.querySelector<HTMLButtonElement>('[aria-label="Group by"]')!.click())
    act(() => el.querySelector<HTMLButtonElement>('[role="option"][data-value="note.priority"]')!.click())
    expect(view().groupBy).toEqual({ property: 'note.priority', direction: 'DESC', highlight: 'pink', large: true })
  })
})

describe('a calendar tab (YAZ-4540)', () => {
  it('offers Sort only: no Group by, no levels, no indent, even when the YAML has a groupBy', () => {
    const { el } = mount({ name: 'Cal', type: 'calendar', sort: [{ property: 'note.status', direction: 'ASC' }], groupBy: [{ property: 'note.status' }, { property: 'note.priority' }] })
    expect(el.querySelector('[aria-label="Sort property"]')).not.toBeNull()
    expect(el.textContent).toContain('Add sort')
    expect([...el.querySelectorAll('.view-menu__label')].map((p) => p.textContent)).toEqual(['Sort']) // no "Group" section (D60's name)
    expect(el.querySelector('[aria-label^="Group by"], [aria-label^="Then group by"], [aria-label^="Reorder group level"]')).toBeNull()
    expect(addLevelButton(el)).toBeNull()
  })

  it('a table still offers Group', () => {
    const { el } = mount({ name: 'T', type: 'table', groupBy: { property: 'note.status' } })
    expect([...el.querySelectorAll('.view-menu__label')].map((p) => p.textContent)).toContain('Group')
    expect(addLevelButton(el)).not.toBeNull()
  })
})

describe('the ⇅ popover holds only sorting and grouping (YAZ-4607 D60)', () => {
  it('two sections, Sort and Group; the Indent and the Subfolders switch are gone (they live in Properties › View)', () => {
    const { el } = mount({ name: 'Table', type: 'table', groupBy: { property: 'note.status' } })
    expect([...el.querySelectorAll('.view-menu__label')].map((p) => p.textContent)).toEqual(['Sort', 'Group'])
    expect(el.querySelector('[aria-label="Group indent"]')).toBeNull()
    expect(el.querySelector('[aria-label="Subfolders"]')).toBeNull()
    expect(el.textContent).not.toContain('Indent')
  })

  it('an empty sort shows "Add sort" alone, no "No sort" line', () => {
    const { el } = mount({ name: 'Table', type: 'table' })
    expect(el.textContent).not.toContain('No sort')
    expect([...el.querySelectorAll('.view-menu__action')].map((b) => b.textContent)).toEqual(['Add sort', 'Add group level'])
  })

  it('"Add group level" adds a level on the first free column; no empty picker; the button is gone at five levels (YAZ-3746 13AF)', () => {
    const { el, view } = mount({ name: 'Table', type: 'table' })
    const add = () => [...el.querySelectorAll<HTMLButtonElement>('.view-menu__action')].find((b) => b.textContent === 'Add group level')
    expect(el.querySelector('[aria-label="Group by"]')).toBeNull()
    act(() => add()!.click())
    expect(el.querySelector('[aria-label="Group by"]')).not.toBeNull()
    expect(el.querySelector('[aria-label="Then group by"]')).toBeNull()
    expect(groupByLevels(view())).toHaveLength(1)
    act(() => add()!.click())
    act(() => add()!.click())
    expect(groupByLevels(view())).toHaveLength(3)
    expect(add()).toBeDefined()
    act(() => add()!.click())
    act(() => add()!.click())
    expect(groupByLevels(view())).toHaveLength(5)
    expect(new Set(groupByLevels(view()).map((l) => l.property)).size).toBe(5) // five different columns
    expect(add()).toBeUndefined()
    expect(el.querySelectorAll('[aria-label^="Reorder group level"]')).toHaveLength(5)
  })

  it('"Folders first" sits under Sort, before Group, and only while the view shows folder rows', () => {
    expect(mount({ name: 'Table', type: 'table' }).el.querySelector('[aria-label="Folders first"]')).toBeNull()
    act(() => root?.unmount())
    container?.remove()
    const { el, view } = mount({ name: 'Table', type: 'table', subfolders: 'both' })
    const toggle = el.querySelector<HTMLInputElement>('[aria-label="Folders first"]')!
    expect(toggle.checked).toBe(true)
    const group = [...el.querySelectorAll('.view-menu__label')].find((p) => p.textContent === 'Group')!
    expect(toggle.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    act(() => toggle.click())
    expect(view().foldersFirst).toBe(false)
  })
})
