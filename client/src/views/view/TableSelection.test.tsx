/**
 * Select cells, rows and columns in the folder table; copy, paste and bulk actions (YAZ-4593, S27 / S28). ViewsPane is
 * mounted for real over `TEST_RECORDS`; "Agentic Agency" is read only where a test says so. The selection lives on the
 * DOM (`data-selected`), so a change of selection commits no React render: a Profiler counts the commits.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Profiler, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IndexRecord } from '@shared/types'
import { type ParsedViews, parseViews, serializeViews } from '../viewSchema'
import { ViewsPane, type FolderHost, type ViewsPaneProps } from '../ViewsPane'
import { testFolderHost } from '../testFolderHost'
import { TEST_RECORDS } from '../testRecords'
import { readOnlyPaths } from '../readOnlyRows'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../lib/storage', () => ({ storage: { getViewGroups: () => [], setViewGroups: () => undefined, getSettings: () => undefined, getRoots: () => [] } }))

const TABLE = `views:
  - type: table
    name: T
    order:
      - file.name
      - note.priority
      - note.status
      - note.published
    sort:
      - property: file.name
        direction: ASC
`
const AGENCY = '/vault/Content Pillars/1. Agentic Agency/Agentic Agency.md'
const ATTRIBUTION = TEST_RECORDS[4].path
const locked = (): IndexRecord[] => TEST_RECORDS.map((r) => (r.path === AGENCY ? { ...r, properties: { ...r.properties, readonly: true } } : r))

let root: Root | null = null
let container: HTMLElement | null = null
let draw: () => void = () => {}
let commits = 0
let clip = ''
const writeText = vi.fn(async (text: string) => {
  clip = text
})

beforeEach(() => {
  clip = ''
  Object.defineProperty(navigator, 'clipboard', { value: { writeText, readText: vi.fn(async () => clip) }, configurable: true })
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  vi.clearAllMocks()
})

function mount(text: string, { records = TEST_RECORDS, ...props }: Partial<ViewsPaneProps> = {}, host: Partial<FolderHost> = {}) {
  let parsed = parseViews(text)
  const writeValues = vi.fn(async () => undefined)
  const retitle = vi.fn()
  const folder = testFolderHost({ writeValues, retitle, vaultRecords: records, ...host })
  const onChange = vi.fn((next: ParsedViews) => {
    parsed = next
    draw()
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  draw = () =>
    act(() =>
      root?.render(
        <Profiler id="table" onRender={() => void commits++}>
          <ViewsPane parsed={parsed} onChange={onChange} root="/vault" folderPath="/vault/pillars.md" records={records} readOnly={readOnlyPaths(records)} folder={folder} onOpenFile={vi.fn()} {...props} />
        </Profiler>,
      ),
    )
  draw()
  commits = 0
  return { el: container, writeValues, retitle, onChange, yaml: () => serializeViews(parsed) }
}

const cell = (el: ParentNode, r: number, c: number): HTMLElement => {
  const td = el.querySelector<HTMLElement>(`td[data-cell="${r}:${c}"]`)
  if (td === null) throw new Error(`no cell ${r}:${c}`)
  return td
}
/** The data row index of the note titled `name`. */
const rowOf = (el: ParentNode, name: string): number => Number([...el.querySelectorAll<HTMLElement>('td.view-table__name')].find((td) => td.textContent === name)!.dataset.cell!.split(':')[0])
const gutter = (el: ParentNode, r: number) => cell(el, r, 0).parentElement!.querySelector<HTMLElement>('td.view-table__gutter')!
const header = (el: ParentNode, c: number) => el.querySelectorAll<HTMLElement>('.view-table thead th')[c + 1]
/** The selected cells as `r:c`, in DOM order. */
const selected = (el: ParentNode) => [...el.querySelectorAll<HTMLElement>('td[data-cell][data-selected]')].map((td) => td.dataset.cell)
const down = (target: Element, init: MouseEventInit = {}) => act(() => void target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, ...init })))
const move = (target: Element) => act(() => void target.dispatchEvent(new MouseEvent('mousemove', { bubbles: true })))
const up = (target: Element) => act(() => void target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })))
const key = (target: Element, k: string, init: KeyboardEventInit = {}) => act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })))
const rightClick = (target: Element) => act(() => void target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 40, clientY: 40 })))
const items = (el: ParentNode) => [...el.querySelectorAll<HTMLButtonElement>('.ctx-menu [role="menuitem"]')].map((b) => b.textContent)
const item = (el: ParentNode, label: string) => [...el.querySelectorAll<HTMLButtonElement>('.ctx-menu [role="menuitem"]')].find((b) => b.textContent === label)!
const flush = () => act(async () => {})
/** A drag from one cell to another: press, move over, release. */
function drag(el: HTMLElement, from: [number, number], to: [number, number]) {
  down(cell(el, ...from))
  move(cell(el, ...to))
  up(cell(el, ...to))
}

describe('select gestures (YAZ-4593 S27, S28)', () => {
  it('a drag across cells selects the range between them, and renders nothing', () => {
    const { el } = mount(TABLE)
    drag(el, [0, 1], [2, 2])
    expect(selected(el)).toEqual(['0:1', '0:2', '1:1', '1:2', '2:1', '2:2'])
    // The count-based guard: no React commit for the whole gesture, so no cell rendered again.
    expect(commits).toBe(0)
  })

  it('⇧-click selects the range from the focused cell', () => {
    const { el } = mount(TABLE)
    act(() => cell(el, 1, 0).focus())
    down(cell(el, 3, 2), { shiftKey: true })
    expect(selected(el)).toEqual(['1:0', '1:1', '1:2', '2:0', '2:1', '2:2', '3:0', '3:1', '3:2'])
    // ⇧ again moves the far corner; the anchor stays.
    down(cell(el, 1, 3), { shiftKey: true })
    expect(selected(el)).toEqual(['1:0', '1:1', '1:2', '1:3'])
    expect(commits).toBe(0)
  })

  it('a plain press on a cell clears the selection', () => {
    const { el } = mount(TABLE)
    drag(el, [0, 1], [1, 2])
    down(cell(el, 4, 0))
    up(cell(el, 4, 0))
    expect(selected(el)).toEqual([])
  })

  it('# selects a row, ⇧ extends it, ⌘ adds or removes one row', () => {
    const { el } = mount(TABLE)
    down(gutter(el, 1))
    expect(selected(el)).toEqual(['1:0', '1:1', '1:2', '1:3'])
    expect(gutter(el, 1).hasAttribute('data-selected')).toBe(true)
    down(gutter(el, 3), { shiftKey: true })
    expect(selected(el).map((at) => at!.split(':')[0])).toEqual(['1', '1', '1', '1', '2', '2', '2', '2', '3', '3', '3', '3'])
    down(gutter(el, 2), { metaKey: true })
    expect(new Set(selected(el).map((at) => at!.split(':')[0]))).toEqual(new Set(['1', '3']))
    expect(gutter(el, 2).hasAttribute('data-selected')).toBe(false)
    expect(commits).toBe(0)
  })

  it('⇧-click on a header selects the column, ⇧ extends, ⌘ adds; a plain press selects nothing', () => {
    const { el } = mount(TABLE)
    down(header(el, 2))
    expect(selected(el)).toEqual([])
    down(header(el, 2), { shiftKey: true })
    expect(selected(el)).toEqual(Array.from({ length: 8 }, (_, r) => `${r}:2`))
    expect(header(el, 2).hasAttribute('data-selected')).toBe(true)
    down(header(el, 3), { shiftKey: true })
    expect(selected(el)).toHaveLength(16)
    down(header(el, 0), { metaKey: true })
    expect(selected(el)).toHaveLength(24)
    expect(commits).toBe(0)
  })

  it('Esc clears the selection', () => {
    const { el } = mount(TABLE)
    drag(el, [0, 1], [2, 2])
    key(cell(el, 0, 1), 'Escape')
    expect(selected(el)).toEqual([])
    expect(commits).toBe(0)
  })

  it('with 600 notes (windowed), the selection marks the rows a scroll mounts', () => {
    const many = Array.from({ length: 600 }, (_, i): IndexRecord => ({ ...TEST_RECORDS[4], path: `/vault/n${String(i).padStart(3, '0')}.md`, basename: `n${i}`, name: `n${i}.md`, title: `n${String(i).padStart(3, '0')}`, folder: '', properties: {} }))
    const { el } = mount('views:\n  - type: table\n    name: T\n    order:\n      - file.name\n      - note.status\n', { records: many })
    down(header(el, 1), { shiftKey: true })
    expect(el.querySelector('td[data-cell="599:1"]')).toBeNull()
    const wrap = el.querySelector<HTMLElement>('.view-table-wrap')!
    act(() => {
      Object.defineProperty(wrap, 'scrollTop', { value: 5000, configurable: true })
      wrap.dispatchEvent(new Event('scroll', { bubbles: true }))
    })
    const shown = [...el.querySelectorAll<HTMLElement>('td[data-cell$=":1"]')]
    expect(shown.length).toBeGreaterThan(0)
    expect(shown.every((td) => td.hasAttribute('data-selected'))).toBe(true)
    expect(el.querySelectorAll('td[data-cell$=":0"][data-selected]')).toHaveLength(0)
  })
})

describe('⌘C and ⌘V (YAZ-4593)', () => {
  it('⌘C copies the selection as tab-separated rendered text', async () => {
    const { el } = mount(TABLE)
    const a = rowOf(el, 'Agentic Agency')
    const b = rowOf(el, 'Attribution')
    expect([a, b]).toEqual([0, 1])
    drag(el, [0, 0], [1, 3])
    key(cell(el, 0, 0), 'c', { metaKey: true })
    await flush()
    expect(writeText).toHaveBeenCalledWith('Agentic Agency\t2\tidea\tfalse\nAttribution\t\t\t')
  })

  it('⌘C on a focused cell with no selection copies that cell', async () => {
    const { el } = mount(TABLE)
    key(cell(el, 0, 2), 'c', { metaKey: true })
    await flush()
    expect(writeText).toHaveBeenCalledWith('idea')
  })

  it('⌘V pastes from the top-left cell: values per kind, ONE write per note, the Name column skipped', async () => {
    const { el, writeValues, retitle } = mount(TABLE)
    clip = 'Renamed\t5\tdone\tyes\nOther\t7\tx\tno\n'
    key(cell(el, 0, 0), 'v', { metaKey: true })
    await flush()
    expect(retitle).not.toHaveBeenCalled()
    expect(writeValues).toHaveBeenCalledTimes(2)
    expect(writeValues).toHaveBeenCalledWith(AGENCY, [
      { key: 'priority', value: 5 },
      { key: 'status', value: 'done' },
      { key: 'published', value: true },
    ])
    expect(writeValues).toHaveBeenCalledWith(ATTRIBUTION, [
      { key: 'priority', value: 7 },
      { key: 'status', value: 'x' },
      { key: 'published', value: false },
    ])
  })

  it('⌘V skips a read-only note, a text that is no value of the kind, and a value that is already there', async () => {
    const { el, writeValues } = mount(TABLE, { records: locked() })
    clip = '9\tidea\n10\tdone'
    key(cell(el, 0, 1), 'v', { metaKey: true })
    await flush()
    expect(writeValues).toHaveBeenCalledTimes(1)
    expect(writeValues).toHaveBeenCalledWith(ATTRIBUTION, [
      { key: 'priority', value: 10 },
      { key: 'status', value: 'done' },
    ])
    writeValues.mockClear()
    clip = 'abc\tidea'
    key(cell(el, rowOf(el, 'Creator Economy'), 1), 'v', { metaKey: true })
    await flush()
    // "abc" is no number, and Creator Economy's status is "published": only the status changes.
    expect(writeValues).toHaveBeenCalledWith(TEST_RECORDS[2].path, [{ key: 'status', value: 'idea' }])
  })
})

describe('the selection right-click (YAZ-4593)', () => {
  it('a cell range offers Copy, Paste, Clear cells and Fill; no Set value over two columns, no note actions', () => {
    const { el } = mount(TABLE)
    drag(el, [0, 1], [1, 2])
    rightClick(cell(el, 1, 1))
    expect(items(el)).toEqual(['Copy', 'Paste', 'Clear cells', 'Fill cell', 'Fill row', 'Clear formatting', 'New row below'])
    // Its own menu, not the row menu.
    expect(items(el)).not.toContain('Open')
  })

  it('a right-click outside the selection clears it and opens the row menu', () => {
    const { el } = mount(TABLE)
    drag(el, [0, 1], [1, 2])
    rightClick(cell(el, 4, 1))
    expect(selected(el)).toEqual([])
    expect(items(el)).toContain('Copy path')
  })

  it('rows offer Duplicate notes and Delete notes… (off with no host action)', () => {
    const { el } = mount(TABLE)
    down(gutter(el, 1))
    down(gutter(el, 2), { shiftKey: true })
    rightClick(cell(el, 2, 2))
    expect(items(el)).toEqual(['Copy', 'Paste', 'Clear cells', 'Fill cell', 'Fill row', 'Clear formatting', 'New row below', 'Duplicate notes', 'Delete notes…'])
    // ViewsPane wires 11C's `onDuplicateNote` / `onDeleteNotes` at merge (YAZ-4592); without them the items are off.
    expect(item(el, 'Delete notes…').disabled).toBe(true)
    expect(item(el, 'Copy').disabled).toBe(false)
  })

  it('with the host duplicate and trash (11C, YAZ-4592), Duplicate notes copies each row and Delete notes… asks, then trashes them all', () => {
    const duplicate = vi.fn()
    const trash = vi.fn(() => Promise.resolve())
    const { el } = mount(TABLE, {}, { duplicate, trash })
    const paths = [1, 2].map((r) => TEST_RECORDS.find((rec) => rec.title === cell(el, r, 0).textContent)!.path)
    down(gutter(el, 1))
    down(gutter(el, 2), { shiftKey: true })
    rightClick(cell(el, 2, 2))
    act(() => item(el, 'Duplicate notes').click())
    expect(duplicate.mock.calls.map(([path]) => path)).toEqual(paths)
    rightClick(cell(el, 2, 2))
    act(() => item(el, 'Delete notes…').click())
    expect(trash).not.toHaveBeenCalled()
    const del = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent === 'Delete')!
    act(() => del.click())
    expect(trash).toHaveBeenCalledExactlyOnceWith(paths)
  })

  it('Clear cells writes the empty value once per note, only where there is a value and the note is not read only', async () => {
    const { el, writeValues } = mount(TABLE, { records: locked() })
    const creator = rowOf(el, 'Creator Economy')
    drag(el, [0, 1], [creator, 2])
    rightClick(cell(el, 0, 1))
    act(() => item(el, 'Clear cells').click())
    await flush()
    expect(writeValues).toHaveBeenCalledTimes(1)
    expect(writeValues).toHaveBeenCalledWith(TEST_RECORDS[2].path, [
      { key: 'priority', value: null },
      { key: 'status', value: null },
    ])
    expect(el.querySelector('.ctx-menu')).toBeNull()
  })

  it('Fill cell › paints every selected cell in ONE view write', () => {
    const { el, onChange, yaml } = mount(TABLE)
    drag(el, [0, 1], [1, 2])
    rightClick(cell(el, 0, 1))
    act(() => item(el, 'Fill cell').click())
    act(() => item(el, 'Red').click())
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(yaml().match(/fill: red/g)).toHaveLength(4)
    expect(cell(el, 1, 2).style.getPropertyValue('--view-cell-fill')).toBe('var(--table-fill-red)')
  })

  it('Set value › over one column writes that value to each note that does not have it', async () => {
    const { el, writeValues } = mount(TABLE, { records: locked() })
    down(header(el, 3), { shiftKey: true })
    rightClick(cell(el, 2, 3))
    expect(items(el)).toContain('Set value')
    act(() => item(el, 'Set value').click())
    act(() => item(el, 'Checked').click())
    await flush()
    // 8 notes: Agentic Agency is read only, Creator Economy is already checked.
    expect(writeValues).toHaveBeenCalledTimes(6)
    for (const [, writes] of writeValues.mock.calls as unknown as [string, unknown][]) expect(writes).toEqual([{ key: 'published', value: true }])
  })

  it('Set value › on a text column types the value', async () => {
    const { el, writeValues } = mount(TABLE)
    drag(el, [0, 2], [1, 2])
    rightClick(cell(el, 0, 2))
    act(() => item(el, 'Set value').click())
    const input = el.querySelector<HTMLInputElement>('.ctx-menu input')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'review')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    key(input, 'Enter')
    await flush()
    expect(writeValues).toHaveBeenCalledTimes(2)
    expect(writeValues).toHaveBeenCalledWith(AGENCY, [{ key: 'status', value: 'review' }])
  })
})

describe('one drag rule, ⇧+arrows and ⌘A (YAZ-4603 D53)', () => {
  const GROUPED = `${TABLE}    groupBy:
      property: note.status
`

  it('a drag across cells selects in a grouped table too, and renders nothing; no row and no cell is a drag source', () => {
    const { el } = mount(GROUPED)
    expect(el.querySelectorAll('tbody tr[draggable], tbody td[data-cell][draggable]')).toHaveLength(0)
    drag(el, [0, 1], [1, 2])
    expect(selected(el)).toEqual(['0:1', '0:2', '1:1', '1:2'])
    expect(commits).toBe(0)
  })

  it('a click on a movable row\'s # still selects the row, and lets the press through so a drag can start', () => {
    const { el } = mount(GROUPED)
    const grip = gutter(el, 1)
    expect(grip.getAttribute('draggable')).toBe('true')
    let pressed = true
    act(() => void (pressed = grip.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))))
    expect(pressed).toBe(true)
    expect(selected(el)).toEqual(['1:0', '1:1', '1:2', '1:3'])
    act(() => grip.click())
    expect(document.activeElement).toBe(cell(el, 1, 0))
  })

  it('⇧+arrow grows and shrinks the range from its anchor, one cell at a time; a plain arrow clears it', () => {
    const { el } = mount(TABLE)
    act(() => cell(el, 1, 1).focus())
    key(cell(el, 1, 1), 'ArrowDown', { shiftKey: true })
    expect(selected(el)).toEqual(['1:1', '2:1'])
    key(cell(el, 1, 1), 'ArrowRight', { shiftKey: true })
    expect(selected(el)).toEqual(['1:1', '1:2', '2:1', '2:2'])
    key(cell(el, 1, 1), 'ArrowUp', { shiftKey: true })
    expect(selected(el)).toEqual(['1:1', '1:2'])
    // Past the anchor: the range flips to the other side of it.
    key(cell(el, 1, 1), 'ArrowUp', { shiftKey: true })
    expect(selected(el)).toEqual(['0:1', '0:2', '1:1', '1:2'])
    expect(commits).toBe(0)
    expect(document.activeElement).toBe(cell(el, 1, 1))
    key(cell(el, 1, 1), 'ArrowDown')
    expect(selected(el)).toEqual([])
    expect(document.activeElement).toBe(cell(el, 2, 1))
  })

  it('⇧+arrow on whole rows extends the rows; back on the anchor it is one row', () => {
    const { el } = mount(TABLE)
    down(gutter(el, 2))
    key(cell(el, 2, 0), 'ArrowDown', { shiftKey: true })
    expect(new Set(selected(el).map((at) => at!.split(':')[0]))).toEqual(new Set(['2', '3']))
    expect(gutter(el, 3).hasAttribute('data-selected')).toBe(true)
    key(cell(el, 2, 0), 'ArrowUp', { shiftKey: true })
    expect(new Set(selected(el).map((at) => at!.split(':')[0]))).toEqual(new Set(['2']))
  })

  it('⌘A selects every shown cell, the windowed ones too: ⌘C then copies all 600 rows', async () => {
    const many = Array.from({ length: 600 }, (_, i): IndexRecord => ({ ...TEST_RECORDS[4], path: `/vault/n${String(i).padStart(3, '0')}.md`, basename: `n${i}`, name: `n${i}.md`, title: `n${String(i).padStart(3, '0')}`, folder: '', properties: {} }))
    const { el } = mount('views:\n  - type: table\n    name: T\n    order:\n      - file.name\n      - note.status\n', { records: many })
    key(cell(el, 0, 0), 'a', { metaKey: true })
    const mounted = el.querySelectorAll('td[data-cell]')
    expect(el.querySelectorAll('td[data-cell][data-selected]')).toHaveLength(mounted.length)
    expect(commits).toBe(0)
    key(cell(el, 0, 0), 'c', { metaKey: true })
    await flush()
    expect(clip.split('\n')).toHaveLength(600)
    expect(clip.split('\n')[599]).toBe('n599\t')
  })
})

describe('⌘\\ Clear formatting (YAZ-4603 D54)', () => {
  // Agentic Agency (row 0): a row fill and a Status cell fill; Attribution (row 1): a Priority cell fill. Status wraps, Priority clips.
  const FORMATTED = `${TABLE}    fills:
      - note: "[[Agentic Agency]]"
        fill: red
      - note: "[[Agentic Agency]]"
        column: note.status
        fill: blue
      - note: "[[Attribution]]"
        column: note.priority
        fill: green
    columnWrap:
      note.status: true
      note.priority: false
`
  const setup = () => {
    const onNotice = vi.fn()
    return { ...mount(FORMATTED, {}, { onNotice }), onNotice }
  }
  const fillOf = (el: ParentNode, r: number, c: number) => cell(el, r, c).style.getPropertyValue('--view-cell-fill')

  it('on a cell range: the cells\' fills go in ONE view write with Undo; the row fill, the Wrap / Clip and the values stay', () => {
    const { el, onChange, onNotice, writeValues, yaml } = setup()
    drag(el, [0, 1], [1, 2])
    key(cell(el, 0, 1), '\\', { metaKey: true })
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(yaml()).not.toContain('fill: blue')
    expect(yaml()).not.toContain('fill: green')
    expect(yaml()).toContain('fill: red')
    expect(yaml()).toContain('columnWrap:\n      note.status: true\n      note.priority: false')
    // The row fill shows again on the cell that lost its own.
    expect(fillOf(el, 0, 2)).toBe('var(--table-fill-red)')
    expect(fillOf(el, 1, 1)).toBe('')
    expect(writeValues).not.toHaveBeenCalled()
    expect(onNotice.mock.lastCall?.[0]).toBe('Cleared formatting')
    const [, , , action] = onNotice.mock.lastCall as [string, string, string, { run: () => void }]
    act(() => action.run())
    expect(yaml()).toContain('fill: blue')
    expect(yaml()).toContain('fill: green')
  })

  it('on whole rows: the row fill goes too', () => {
    const { el, yaml } = setup()
    down(gutter(el, 0))
    key(cell(el, 0, 0), '\\', { metaKey: true })
    expect(yaml()).not.toContain('fill: red')
    expect(yaml()).not.toContain('fill: blue')
    expect(yaml()).toContain('fill: green')
    expect(yaml()).toContain('columnWrap')
  })

  it('on whole columns: the cell fills in them and their Wrap / Clip go; the other column keeps its own', () => {
    const { el, yaml } = setup()
    down(header(el, 2), { shiftKey: true })
    key(cell(el, 0, 2), '\\', { metaKey: true })
    expect(yaml()).not.toContain('fill: blue')
    expect(yaml()).toContain('fill: green')
    expect(yaml()).toContain('columnWrap:\n      note.priority: false')
    expect(yaml()).not.toContain('note.status: true')
  })

  it('with nothing to clear: no write and no toast', () => {
    const { el, onChange, onNotice } = setup()
    key(cell(el, 2, 3), '\\', { metaKey: true })
    expect(onChange).not.toHaveBeenCalled()
    expect(onNotice).not.toHaveBeenCalled()
  })

  it('"Clear formatting" in the selection menu and in the cell menu (the focused cell only)', () => {
    const { el, yaml } = setup()
    rightClick(cell(el, 0, 2))
    expect(item(el, 'Clear formatting').dataset.hint).toBe('⌘\\')
    act(() => item(el, 'Clear formatting').click())
    expect(yaml()).not.toContain('fill: blue')
    expect(yaml()).toContain('fill: red')
    drag(el, [1, 1], [1, 2])
    rightClick(cell(el, 1, 1))
    act(() => item(el, 'Clear formatting').click())
    expect(yaml()).not.toContain('fill: green')
    expect(el.querySelector('.ctx-menu')).toBeNull()
  })
})

describe('the group header row (YAZ-4604)', () => {
  it('a right-click on its empty part shows no system menu', () => {
    const { el } = mount(`${TABLE}    groupBy:
      property: note.status
`)
    const td = el.querySelector<HTMLElement>('td.view-table__group-cell')!
    let shown = true
    act(() => void (shown = td.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }))))
    expect(shown).toBe(false)
  })
})

describe('the fill handle (YAZ-4609 D61)', () => {
  const COLS = ['num', 'due', 'day', 'week', 'tag']
  const FILL_TABLE = `views:
  - type: table
    name: T
    order:
      - file.name
${COLS.map((k) => `      - note.${k}`).join('\n')}
    sort:
      - property: file.name
        direction: ASC
`
  const note = (i: number, properties: Record<string, unknown> = {}): IndexRecord => ({ ...TEST_RECORDS[4], path: `/vault/f/a${i}.md`, basename: `a${i}`, name: `a${i}.md`, title: `a${i}`, folder: 'f', properties })
  const NOTES = [note(0, { num: 1, due: '2026-01-30', day: 'Monday', week: 'Week 1', tag: 'x' }), note(1, { num: 3 }), note(2), note(3), note(4)]
  const handle = (el: ParentNode) => el.querySelector<HTMLElement>('.view-table__fill-handle')
  /** Press the handle, move over `to`, release there. */
  function fillTo(el: HTMLElement, to: [number, number]) {
    down(handle(el)!)
    move(cell(el, ...to))
    up(cell(el, ...to))
  }
  const writesOf = (writeValues: ReturnType<typeof vi.fn>, path: string) => (writeValues.mock.calls as unknown as [string, unknown][]).filter(([p]) => p === path).map(([, w]) => w)

  it('the handle sits in the corner of the focused cell, then of the selection; placing it renders nothing', () => {
    const { el } = mount(FILL_TABLE, { records: NOTES })
    act(() => cell(el, 1, 2).focus())
    expect(handle(el)?.parentElement).toBe(cell(el, 1, 2))
    drag(el, [0, 1], [2, 3])
    expect(handle(el)?.parentElement).toBe(cell(el, 2, 3))
    expect(cell(el, 2, 3).hasAttribute('data-fill-corner')).toBe(true)
    expect(commits).toBe(0)
  })

  it('a drag down marks the target with its outer edges, and continues a number step; ONE write per note, no render', async () => {
    const { el, writeValues } = mount(FILL_TABLE, { records: NOTES })
    drag(el, [0, 1], [1, 1])
    down(handle(el)!)
    move(cell(el, 3, 1))
    expect(cell(el, 0, 1).getAttribute('data-fill-target')).toBe('top left right')
    expect(cell(el, 3, 1).getAttribute('data-fill-target')).toBe('bottom left right')
    up(cell(el, 3, 1))
    expect(el.querySelectorAll('[data-fill-target]')).toHaveLength(0)
    expect(commits).toBe(0)
    await flush()
    expect(writeValues).toHaveBeenCalledTimes(2)
    expect(writesOf(writeValues, NOTES[2].path)).toEqual([[{ key: 'num', value: 5 }]])
    expect(writesOf(writeValues, NOTES[3].path)).toEqual([[{ key: 'num', value: 7 }]])
  })

  it('one source row down: a date steps by a day, a weekday and a trailing number by 1, other text repeats', async () => {
    const { el, writeValues } = mount(FILL_TABLE, { records: NOTES })
    drag(el, [0, 2], [0, 5])
    fillTo(el, [2, 2])
    await flush()
    expect(writeValues).toHaveBeenCalledTimes(2)
    expect(writesOf(writeValues, NOTES[1].path)).toEqual([
      [
        { key: 'due', value: '2026-01-31' },
        { key: 'day', value: 'Tuesday' },
        { key: 'week', value: 'Week 2' },
        { key: 'tag', value: 'x' },
      ],
    ])
    expect(writesOf(writeValues, NOTES[2].path)[0]).toEqual([
      { key: 'due', value: '2026-02-01' },
      { key: 'day', value: 'Wednesday' },
      { key: 'week', value: 'Week 3' },
      { key: 'tag', value: 'x' },
    ])
  })

  it('a drag right continues each row across the columns', async () => {
    const records = [note(0, { num: 1, due: 2 }), note(1)]
    const { el, writeValues } = mount(FILL_TABLE, { records })
    drag(el, [0, 1], [0, 2])
    fillTo(el, [0, 4])
    await flush()
    // Day and Week hold no numbers, so they are text columns: each new value is typed as its cell's kind.
    expect(writeValues).toHaveBeenCalledExactlyOnceWith(records[0].path, [
      { key: 'day', value: '3' },
      { key: 'week', value: '4' },
    ])
  })

  it('read-only notes and the Name column are skipped; Undo writes the old values back, one write per note', async () => {
    const onNotice = vi.fn()
    const records = NOTES.map((r, i) => (i === 2 ? { ...r, properties: { ...r.properties, readonly: true } } : r))
    const { el, writeValues, retitle } = mount(FILL_TABLE, { records }, { onNotice })
    // Name a0, a1 would go on as a2, a3: the Name column is never written.
    drag(el, [0, 0], [1, 1])
    fillTo(el, [3, 1])
    await flush()
    expect(retitle).not.toHaveBeenCalled()
    expect(writeValues).toHaveBeenCalledExactlyOnceWith(records[3].path, [{ key: 'num', value: 7 }])
    expect(onNotice).toHaveBeenCalledTimes(1)
    const [message, , type, action] = onNotice.mock.lastCall as [string, string, string, { run: () => void }]
    expect([message, type]).toEqual(['Filled 1 cell', 'undo'])
    writeValues.mockClear()
    act(() => action.run())
    expect(writeValues).toHaveBeenCalledExactlyOnceWith(records[3].path, [{ key: 'num', value: undefined }])
  })

  it('a windowed table (600 notes) fills the rows a drag passes', async () => {
    const many = Array.from({ length: 600 }, (_, i): IndexRecord => ({ ...note(i, i === 0 ? { num: 4 } : {}), title: `n${String(i).padStart(3, '0')}` }))
    const { el, writeValues } = mount(FILL_TABLE, { records: many })
    act(() => cell(el, 0, 1).focus())
    fillTo(el, [20, 1])
    expect(commits).toBe(0)
    await flush()
    expect(writeValues).toHaveBeenCalledTimes(20)
    for (const [, writes] of writeValues.mock.calls as unknown as [string, unknown][]) expect(writes).toEqual([{ key: 'num', value: 4 }])
  })
})

describe('the # column and the headers as handles, the corner selects all (YAZ-4610 D62)', () => {
  const click = (target: Element, init: MouseEventInit = {}) => act(() => void target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init })))
  const corner = (el: ParentNode) => el.querySelector<HTMLElement>('.view-table thead th.view-table__gutter')!

  it('a plain click on a header selects the column; ⇧-click extends; no render', () => {
    const { el } = mount(TABLE)
    down(header(el, 2))
    click(header(el, 2))
    expect(selected(el)).toEqual(Array.from({ length: 8 }, (_, r) => `${r}:2`))
    expect(header(el, 2).hasAttribute('data-selected')).toBe(true)
    down(header(el, 3), { shiftKey: true })
    click(header(el, 3), { shiftKey: true })
    expect(selected(el)).toHaveLength(16)
    expect(commits).toBe(0)
  })

  it('a header drag still moves the column (a drag fires no click), and the sort arrow and the resize edge select nothing', () => {
    const { el, yaml } = mount(TABLE)
    const fire = (target: Element, type: string) => act(() => void target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true })))
    fire(header(el, 1), 'dragstart')
    fire(header(el, 3), 'dragover')
    fire(header(el, 3), 'drop')
    // Priority moved past Status: the drag is the header's own (YAZ-1548).
    expect(yaml()).toContain('- file.name\n      - note.status')
    expect(selected(el)).toEqual([])
    click(header(el, 0).querySelector('.view-table__resize')!)
    click(header(el, 0).querySelector('.view-table__sort')!)
    expect(selected(el)).toEqual([])
  })

  it('a click on the corner cell selects every cell, as ⌘A', () => {
    const { el } = mount(TABLE)
    click(corner(el))
    expect(selected(el)).toHaveLength(8 * 4)
    expect(commits).toBe(0)
  })

  it('with row numbers off, the slim strip selects the row and drags it', () => {
    const { el } = mount(`${TABLE}    groupBy:
      property: note.status
    rowNumbers: false
`)
    const strip = gutter(el, 1)
    expect(strip.textContent).toBe('')
    expect(strip.getAttribute('draggable')).toBe('true')
    down(strip)
    expect(selected(el)).toEqual(['1:0', '1:1', '1:2', '1:3'])
  })
})
