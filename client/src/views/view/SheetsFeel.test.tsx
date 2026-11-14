/**
 * Sheets feel and bulk-edit guard rails in the folder table (YAZ-4612 S41-S51): ⌘Z / ⇧⌘Z over value changes, type to
 * edit, Tab and Enter moves, Delete clears, the Count / Sum / Average chip, batched writes with a progress page, the
 * confirms, and paste's limits. ViewsPane is mounted for real; a Profiler counts the commits for the 0-render guard.
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
import { MAX_STEPS, dropAllHistories, renameHistoryPaths, valueHistory } from './valueHistory'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../lib/storage', () => ({ storage: { getViewGroups: () => [], setViewGroups: () => undefined, getSettings: () => undefined, getRoots: () => [] } }))

const page = (i: number, properties: Record<string, unknown>): IndexRecord => ({ ...TEST_RECORDS[4], path: `/vault/f/n${String(i).padStart(2, '0')}.md`, basename: `n${i}`, name: `n${i}.md`, title: `n${String(i).padStart(2, '0')}`, folder: 'f', properties })
/** n00…n04: a number, a text and a tag each; n02 is read only where a test says so. */
const PAGES = Array.from({ length: 5 }, (_, i) => page(i, { num: i + 1, word: `w${i}`, tag: 'keep' }))
const TABLE = `views:
  - type: table
    name: T
    order:
      - file.name
      - note.num
      - note.word
    sort:
      - property: file.name
        direction: ASC
`

let root: Root | null = null
let container: HTMLElement | null = null
let commits = 0
let clip = ''

beforeEach(() => {
  dropAllHistories()
  clip = ''
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async (t: string) => void (clip = t)), readText: vi.fn(async () => clip) }, configurable: true })
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

function mount(text = TABLE, { records = PAGES, ...props }: Partial<ViewsPaneProps> = {}, host: Partial<FolderHost> = {}) {
  let parsed = parseViews(text)
  const writeValues = vi.fn(async () => undefined)
  const onNotice = vi.fn()
  const folder = testFolderHost({ writeValues, onNotice, vaultRecords: records, ...host })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const draw = () =>
    act(() =>
      root?.render(
        <Profiler id="t" onRender={() => void commits++}>
          <ViewsPane
            parsed={parsed}
            onChange={(next: ParsedViews) => {
              parsed = next
              draw()
            }}
            root="/vault"
            folderPath="/vault/f"
            records={records}
            readOnly={readOnlyPaths(records)}
            folder={folder}
            onOpenFile={vi.fn()}
            {...props}
          />
        </Profiler>,
      ),
    )
  draw()
  commits = 0
  return { el: container, writeValues, onNotice, yaml: () => serializeViews(parsed) }
}

const cell = (el: ParentNode, r: number, c: number) => el.querySelector<HTMLElement>(`td[data-cell="${r}:${c}"]`)!
const gutter = (el: ParentNode, r: number) => cell(el, r, 0).parentElement!.querySelector<HTMLElement>('td.view-table__gutter')!
const down = (target: Element, init: MouseEventInit = {}) => act(() => void target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, ...init })))
const move = (target: Element) => act(() => void target.dispatchEvent(new MouseEvent('mousemove', { bubbles: true })))
const up = (target: Element) => act(() => void target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })))
const drag = (el: HTMLElement, from: [number, number], to: [number, number]) => {
  down(cell(el, ...from))
  move(cell(el, ...to))
  up(cell(el, ...to))
}
/** A keydown; returns whether it was left to the page (not default-prevented). */
const key = (target: Element, k: string, init: KeyboardEventInit = {}): boolean => {
  let passed = true
  act(() => void (passed = target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }))))
  return passed
}
const flush = () => act(async () => {})
const calls = (writeValues: ReturnType<typeof vi.fn>) => writeValues.mock.calls as unknown as [string, { key: string; value: unknown }[]][]
const typeInto = (input: HTMLInputElement, text: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })

describe('⌘Z / ⇧⌘Z over value changes (S41)', () => {
  it('a typed cell: ⌘Z writes the old value back, ⇧⌘Z the new one', async () => {
    const { el, writeValues } = mount()
    act(() => cell(el, 0, 2).focus())
    key(cell(el, 0, 2), 'Enter')
    const input = el.querySelector<HTMLInputElement>('input[aria-label="Edit word"]')!
    typeInto(input, 'new')
    key(input, 'Enter')
    await flush()
    expect(calls(writeValues)).toEqual([[PAGES[0].path, [{ key: 'word', value: 'new' }]]])
    writeValues.mockClear()
    expect(key(cell(el, 1, 2), 'z', { metaKey: true })).toBe(false)
    expect(calls(writeValues)).toEqual([[PAGES[0].path, [{ key: 'word', value: 'w0' }]]])
    key(cell(el, 1, 2), 'z', { metaKey: true, shiftKey: true })
    expect(calls(writeValues)[1]).toEqual([PAGES[0].path, [{ key: 'word', value: 'new' }]])
  })

  it('a bulk change is ONE step: ⌘Z writes each page back once; with nothing left ⌘Z is the page\'s', async () => {
    const { el, writeValues } = mount()
    clip = '7\tx\n8\ty'
    key(cell(el, 0, 1), 'v', { metaKey: true })
    await flush()
    expect(writeValues).toHaveBeenCalledTimes(2)
    writeValues.mockClear()
    key(cell(el, 0, 1), 'z', { metaKey: true })
    await flush()
    expect(calls(writeValues)).toEqual([
      [PAGES[0].path, [{ key: 'num', value: 1 }, { key: 'word', value: 'w0' }]],
      [PAGES[1].path, [{ key: 'num', value: 2 }, { key: 'word', value: 'w1' }]],
    ])
    expect(key(cell(el, 0, 1), 'z', { metaKey: true })).toBe(true)
  })

  it('two quick commits to one cell before the index refreshes (YAZ-4637 T4): ⌘Z steps back through both values', async () => {
    const { el, writeValues } = mount()
    const edit = async (text: string) => {
      act(() => cell(el, 0, 2).focus())
      key(cell(el, 0, 2), 'Enter')
      const input = el.querySelector<HTMLInputElement>('input[aria-label="Edit word"]')!
      typeInto(input, text)
      key(input, 'Enter')
      await flush()
    }
    await edit('new')
    await edit('newer') // the record still says w0
    expect(calls(writeValues).map(([, w]) => w[0].value)).toEqual(['new', 'newer'])
    writeValues.mockClear()
    key(cell(el, 1, 2), 'z', { metaKey: true })
    key(cell(el, 1, 2), 'z', { metaKey: true })
    expect(calls(writeValues).map(([, w]) => w[0].value)).toEqual(['new', 'w0'])
  })

  it('the toast\'s Undo is the ⌘Z step (YAZ-4637 T9e): after it, ⌘Z has nothing of the table\'s and ⇧⌘Z redoes the fill', async () => {
    // Words with no series in them, so the fill copies the first down.
    const words = [page(0, { num: 1, word: 'alpha' }), page(1, { num: 2, word: 'beta' })]
    const { el, writeValues, onNotice } = mount(TABLE, { records: words })
    // The fill handle, alpha down one row: the one bulk gesture with a toast.
    act(() => cell(el, 0, 2).focus())
    down(el.querySelector<HTMLElement>('.view-table__fill-handle')!)
    move(cell(el, 1, 2))
    up(cell(el, 1, 2))
    await flush()
    expect(calls(writeValues)).toEqual([[words[1].path, [{ key: 'word', value: 'alpha' }]]])
    const [message, , type, action] = onNotice.mock.lastCall as [string, string, string, { run: () => void }]
    expect([message, type]).toEqual(['Filled 1 cell', 'undo'])
    writeValues.mockClear()
    act(() => action.run())
    await flush()
    expect(calls(writeValues)).toEqual([[words[1].path, [{ key: 'word', value: 'beta' }]]])
    writeValues.mockClear()
    expect(key(cell(el, 0, 1), 'z', { metaKey: true })).toBe(true) // nothing left: the page's
    expect(writeValues).not.toHaveBeenCalled()
    key(cell(el, 0, 1), 'z', { metaKey: true, shiftKey: true })
    expect(calls(writeValues)).toEqual([[words[1].path, [{ key: 'word', value: 'alpha' }]]])
  })

  it('a step follows its page\'s rename (YAZ-4637 T3): ⌘Z writes the old value to the new path', async () => {
    const { el, writeValues } = mount()
    act(() => cell(el, 0, 2).focus())
    key(cell(el, 0, 2), 'Enter')
    const input = el.querySelector<HTMLInputElement>('input[aria-label="Edit word"]')!
    typeInto(input, 'new')
    key(input, 'Enter')
    await flush()
    writeValues.mockClear()
    renameHistoryPaths(PAGES[0].path, '/vault/f/Renamed.md')
    key(cell(el, 1, 2), 'z', { metaKey: true })
    expect(calls(writeValues)).toEqual([['/vault/f/Renamed.md', [{ key: 'word', value: 'w0' }]]])
  })

  it('⌘Z inside an open cell editor is the editor\'s own', () => {
    const { el, writeValues } = mount()
    key(cell(el, 0, 2), 'Enter')
    const input = el.querySelector<HTMLInputElement>('input[aria-label="Edit word"]')!
    expect(key(input, 'z', { metaKey: true })).toBe(true)
    expect(writeValues).not.toHaveBeenCalled()
  })

  it('the history keeps the last 100 steps', () => {
    const history = valueHistory('/test/page')
    const undo = vi.fn()
    for (let i = 0; i < MAX_STEPS + 5; i++) history.push({ undo })
    while (history.undo());
    expect(undo).toHaveBeenCalledTimes(MAX_STEPS)
  })
})

describe('type to edit, Tab and Enter (S42, S43)', () => {
  it('a letter on a focused cell opens its editor with that letter; not on the Name cell', () => {
    const { el } = mount()
    act(() => cell(el, 1, 2).focus())
    expect(key(cell(el, 1, 2), 'q')).toBe(false)
    expect(el.querySelector<HTMLInputElement>('input[aria-label="Edit word"]')?.value).toBe('q')
    act(() => cell(el, 2, 0).focus())
    key(cell(el, 2, 0), 'q')
    expect(cell(el, 2, 0).querySelector('input')).toBeNull()
  })

  it('Tab and ⇧Tab move right and left; at the edge Tab leaves the table', () => {
    const { el } = mount()
    act(() => cell(el, 0, 0).focus())
    key(cell(el, 0, 0), 'Tab')
    expect(document.activeElement).toBe(cell(el, 0, 1))
    key(cell(el, 0, 1), 'Tab', { shiftKey: true })
    expect(document.activeElement).toBe(cell(el, 0, 0))
    act(() => cell(el, 0, 2).focus())
    expect(key(cell(el, 0, 2), 'Tab')).toBe(true)
  })

  it('Enter that commits an edit moves the focus down a row; Esc does not', () => {
    const { el } = mount()
    act(() => cell(el, 1, 2).focus())
    key(cell(el, 1, 2), 'Enter')
    key(el.querySelector('input[aria-label="Edit word"]')!, 'Enter')
    expect(document.activeElement).toBe(cell(el, 2, 2))
    key(cell(el, 2, 2), 'Enter')
    key(el.querySelector('input[aria-label="Edit word"]')!, 'Escape')
    expect(document.activeElement).toBe(cell(el, 2, 2))
  })

  it('Enter in a list editor that stays open, then a press on another cell: a later focus on the first cell does not jump a row (YAZ-4636 T9d)', () => {
    const { el } = mount(TABLE.replace('      - note.word\n', '      - note.word\n      - note.tag\n'), { records: PAGES.map((n) => ({ ...n, properties: { ...n.properties, tag: ['keep'] } })) })
    act(() => cell(el, 1, 3).focus())
    key(cell(el, 1, 3), 'Enter')
    const input = cell(el, 1, 3).querySelector('input')!
    typeInto(input, 'x')
    key(input, 'Enter')
    // The chip is added and the editor stays open.
    expect(cell(el, 1, 3).querySelector('input')).toBe(input)
    // The press closes the editor, which hands the focus back to its cell: the focus is there or on the pressed cell,
    // never on the row below.
    act(() => cell(el, 0, 1).focus())
    expect(cell(el, 1, 3).querySelector('input')).toBeNull()
    expect([cell(el, 0, 1), cell(el, 1, 3)]).toContain(document.activeElement)
    act(() => cell(el, 1, 3).focus())
    expect(document.activeElement).toBe(cell(el, 1, 3))
  })
})

describe('Delete clears values; the guard rails (S44, S48, S49)', () => {
  it('Delete on a selection writes the empty value once per page, read only and Name skipped; ⌘Z puts them back', async () => {
    const records = PAGES.map((r, i) => (i === 1 ? { ...r, properties: { ...r.properties, readonly: true } } : r))
    const { el, writeValues } = mount(TABLE, { records })
    drag(el, [0, 0], [2, 2])
    key(cell(el, 0, 0), 'Delete')
    await flush()
    expect(calls(writeValues)).toEqual([
      [records[0].path, [{ key: 'num', value: null }, { key: 'word', value: null }]],
      [records[2].path, [{ key: 'num', value: null }, { key: 'word', value: null }]],
    ])
    writeValues.mockClear()
    key(cell(el, 0, 0), 'z', { metaKey: true })
    await flush()
    expect(calls(writeValues).map(([p]) => p)).toEqual([records[0].path, records[2].path])
  })

  it('writes go 8 pages at a time; more than 20 pages say so first', async () => {
    const many = Array.from({ length: 30 }, (_, i) => page(i, { num: i, word: 'x' }))
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const writeValues = vi.fn(() => gate)
    const { el, onNotice } = mount(TABLE, { records: many }, { writeValues })
    down(el.querySelectorAll<HTMLElement>('.view-table thead th')[2], { shiftKey: true })
    key(cell(el, 0, 1), 'Backspace')
    await flush()
    expect(onNotice).toHaveBeenCalledWith('Writing 30 pages…')
    expect(writeValues).toHaveBeenCalledTimes(8)
    release()
    await flush()
    await flush()
    expect(writeValues).toHaveBeenCalledTimes(30)
  })

  it('clearing more than 50 cells asks first; Cancel writes nothing, Clear writes', async () => {
    const many = Array.from({ length: 30 }, (_, i) => page(i, { num: i, word: 'x' }))
    const { el, writeValues } = mount(TABLE, { records: many })
    key(cell(el, 0, 0), 'a', { metaKey: true })
    key(cell(el, 0, 0), 'Delete')
    const sheet = () => document.querySelector('[role="dialog"]')
    expect(sheet()?.textContent).toContain('Clear 60 cells?')
    const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent === label)!
    act(() => button('Cancel').click())
    expect(writeValues).not.toHaveBeenCalled()
    key(cell(el, 0, 0), 'Delete')
    act(() => button('Clear').click())
    await flush()
    await flush()
    expect(writeValues).toHaveBeenCalledTimes(30)
  })

  it('deleting more than 10 pages asks first, also with "Ask before deleting pages" off', () => {
    const many = Array.from({ length: 12 }, (_, i) => page(i, {}))
    const trash = vi.fn(async () => undefined)
    const { el } = mount(TABLE, { records: many, folderPages: { askBeforeDelete: false } as ViewsPaneProps['folderPages'] }, { trash })
    down(gutter(el, 0))
    down(gutter(el, 10), { shiftKey: true })
    act(() => void cell(el, 3, 1).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 })))
    act(() => [...document.querySelectorAll<HTMLButtonElement>('.ctx-menu [role="menuitem"]')].find((b) => b.textContent === 'Delete pages…')!.click())
    expect(trash).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Delete 11 pages?')
  })
})

describe('the selection chip (S46)', () => {
  const chip = (el: ParentNode) => el.querySelector<HTMLElement>('.view-toolbar__selection')!

  it('Count, Sum and Average over numbers, Count alone over text, hidden for one cell; no render', () => {
    const { el } = mount()
    expect(chip(el).hidden).toBe(true)
    drag(el, [0, 1], [3, 1])
    expect(chip(el).hidden).toBe(false)
    expect(chip(el).textContent).toBe('Count 4 · Sum 10 · Average 2.5')
    drag(el, [0, 2], [1, 2])
    expect(chip(el).textContent).toBe('Count 2')
    key(cell(el, 0, 2), 'Escape')
    expect(chip(el).hidden).toBe(true)
    expect(commits).toBe(0)
  })
})

describe('paste limits (S50, S51)', () => {
  const SELECT = `views:
  - type: table
    name: T
    order:
      - file.name
      - note.status
    sort:
      - property: file.name
        direction: ASC
`
  it('a value a Select column does not have skips its cell, and a toast says so; no option is made', async () => {
    const records = PAGES.map((r) => ({ ...r, properties: { status: 'idea' } }))
    const { el, writeValues, onNotice } = mount(SELECT, { records }, { settings: { columns: { status: { kind: 'select', options: ['idea', 'done'] } }, views: [], problems: [] } })
    clip = 'done\nnope\nlater'
    key(cell(el, 0, 1), 'v', { metaKey: true })
    await flush()
    expect(calls(writeValues)).toEqual([[records[0].path, [{ key: 'status', value: 'done' }]]])
    expect(onNotice).toHaveBeenCalledWith('2 cells skipped: not an option')
  })

  it('paste writes only the shown, writable columns: never a hidden one, never the Name', async () => {
    const { el, writeValues } = mount()
    clip = 'Renamed\t9\tz\tspill\tmore'
    key(cell(el, 0, 0), 'v', { metaKey: true })
    await flush()
    // `tag` is a page key the view does not show: the spill past the last column writes nothing.
    expect(calls(writeValues)).toEqual([[PAGES[0].path, [{ key: 'num', value: 9 }, { key: 'word', value: 'z' }]]])
  })
})
