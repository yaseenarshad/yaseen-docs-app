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
    expect(items(el)).toEqual(['Copy', 'Paste', 'Clear cells', 'Fill cell', 'Fill row'])
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
    expect(items(el)).toEqual(['Copy', 'Paste', 'Clear cells', 'Fill cell', 'Fill row', 'Duplicate notes', 'Delete notes…'])
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
