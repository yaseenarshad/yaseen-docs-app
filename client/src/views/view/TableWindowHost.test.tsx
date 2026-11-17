/**
 * Windowing in a FOLDER PAGE (YAZ-4636 T5 / T6): the wrap takes the table's whole height there (folderView.css), and
 * the tab's scroller moves it. So the window is read off that scroller — its height, and how far the table is past
 * its top — and "New row below" and ⌘F scroll IT. ViewsPane is mounted under a scrolling host as the page mounts it;
 * the host's height, the table's place and the wrap's grown height are what the browser would measure.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IndexRecord } from '@shared/types'
import { type ParsedViews, parseViews } from '../viewSchema'
import { ViewsPane } from '../ViewsPane'
import { testFolderHost } from '../testFolderHost'
import { TEST_RECORDS } from '../testRecords'
import type { NewPageSeed } from '../newPage'
import { FIND_DEBOUNCE_MS } from './viewFind'
import { dropAllHistories } from './valueHistory'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../lib/storage', () => ({ storage: { getViewGroups: () => [], setViewGroups: () => undefined, getSettings: () => undefined, getRoots: () => ['/vault'] } }))

/** Every render of a property cell: a resize must render only the mounted slice (T6). */
const cellRenders = vi.hoisted(() => ({ n: 0 }))
vi.mock('./EditableCell', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./EditableCell')>()
  const Counted = (props: Parameters<typeof mod.EditableCell>[0]) => {
    cellRenders.n++
    return <mod.EditableCell {...props} />
  }
  return { ...mod, EditableCell: Counted }
})

const ROW_H = 28
/** The host shows 20 rows. */
const HOST_H = 20 * ROW_H
/** The toolbar and the tabs above the table, in the host. */
const TABLE_AT = 100
const LINES = 1000

const page = (i: number): IndexRecord => ({ ...TEST_RECORDS[4], path: `/vault/f/n${String(i).padStart(4, '0')}.md`, basename: `n${i}`, name: `n${i}.md`, title: `n${String(i).padStart(4, '0')}`, folder: 'f', properties: { rank: i * 2 } })
const MANY = Array.from({ length: LINES }, (_, i) => page(i))
const TABLE = `views:
  - type: table
    name: T
    order:
      - file.name
      - note.rank
    sort:
      - property: note.rank
        direction: ASC
`

let root: Root | null = null
let host: HTMLElement | null = null
let frames: FrameRequestCallback[] = []

beforeEach(() => {
  dropAllHistories()
  cellRenders.n = 0
  frames = []
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => frames.push(callback))
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  host?.remove()
  host = null
  vi.restoreAllMocks()
})

/**
 * The folder page's shape: a scrolling host (the tab) of `HOST_H` around `.folder-view`, the table `TABLE_AT` px down
 * in it. The wrap is as tall as the table, as the browser lays it out; the table's place follows the host's scroll.
 */
function mount(records = MANY) {
  let parsed = parseViews(TABLE)
  let shown = records
  const seeds: NewPageSeed[] = []
  const create = vi.fn(async (seed: NewPageSeed) => {
    seeds.push(seed)
    return '/vault/f/Untitled.md'
  })
  const folder = testFolderHost({ create, retitle: vi.fn(), onNotice: vi.fn(), vaultRecords: records })
  host = document.createElement('div')
  host.className = 'editor-host'
  host.style.overflowY = 'auto'
  document.body.appendChild(host)
  root = createRoot(host)
  const draw = () =>
    act(() =>
      root?.render(
        <div className="folder-view">
          <ViewsPane
            parsed={parsed}
            onChange={(next: ParsedViews) => {
              parsed = next
              draw()
            }}
            root="/vault"
            folderPath="/vault/f"
            records={shown}
            folder={folder}
            onOpenFile={vi.fn()}
          />
        </div>,
      ),
    )
  draw()
  const el = host
  const wrap = el.querySelector<HTMLElement>('.view-table-wrap')!
  const table = el.querySelector<HTMLElement>('.view-table')!
  /** The table's height: every line, the "+ New" row too, as the spacers keep it whatever is mounted. */
  const tableH = () => (shown.length + 1) * ROW_H
  Object.defineProperty(el, 'clientHeight', { value: HOST_H, configurable: true })
  vi.spyOn(el, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 0, 800, HOST_H))
  Object.defineProperty(wrap, 'clientHeight', { get: tableH, configurable: true })
  vi.spyOn(table, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, TABLE_AT - el.scrollTop, 600, tableH()))
  draw()
  return {
    el,
    wrap,
    seeds,
    draw,
    /** The host scrolls to `top`; its listener's frame runs. */
    scrollTo: (top: number) => {
      el.scrollTop = top
      act(() => void el.dispatchEvent(new Event('scroll')))
      flushFrames()
    },
    /** The index brings the new page, with its seed. */
    arrive: () => {
      shown = [...shown, { ...page(0), path: '/vault/f/Untitled.md', basename: 'Untitled', name: 'Untitled.md', title: 'Untitled', properties: seeds.at(-1)!.properties }]
      draw()
    },
  }
}

const flushFrames = () => act(() => void frames.splice(0).forEach((frame) => frame(0)))
/** The data rows' indices, in DOM order. */
const mountedRows = (el: ParentNode) => [...el.querySelectorAll<HTMLElement>('td[data-cell$=":0"]')].map((td) => Number(td.dataset.cell!.split(':')[0]))
/** The data row at the top of the host's viewport, from the host's scroll and the table's place. */
const rowAtTop = (el: HTMLElement) => Math.max(0, Math.floor((el.scrollTop - TABLE_AT) / ROW_H))
const rightClick = (target: Element) => act(() => void target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 40, clientY: 40 })))
const item = (el: ParentNode, label: string) => [...el.querySelectorAll<HTMLButtonElement>('.ctx-menu [role="menuitem"]')].find((b) => b.textContent === label)!
const nameCell = (el: ParentNode, title: string) => [...el.querySelectorAll<HTMLElement>('td.view-table__name')].find((td) => td.textContent === title)!
const flush = () => act(async () => {})

describe('windowing against the tab scroller (YAZ-4636 T6)', () => {
  it('COUNT: 1000 lines in a 20-row host mount about a viewport plus the overscan, not every row', () => {
    const { el } = mount()
    const rows = mountedRows(el)
    expect(rows.length).toBeGreaterThan(20)
    expect(rows.length).toBeLessThanOrEqual(20 + 2 * 10 + 2)
    expect(rows[0]).toBe(0)
  })

  it('COUNT: a column resize renders the mounted slice only, never all 1000 rows', () => {
    const { el } = mount()
    cellRenders.n = 0
    const grip = el.querySelector<HTMLElement>('.view-table__resize')!
    act(() => void grip.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 100 })))
    act(() => void window.dispatchEvent(new MouseEvent('mousemove', { clientX: 130 })))
    act(() => void window.dispatchEvent(new MouseEvent('mouseup', { clientX: 130 })))
    expect(cellRenders.n).toBeLessThanOrEqual(2 * (20 + 2 * 10 + 2))
  })

  it('the host\'s scroll moves the window: the rows under its viewport mount, the top ones unmount', () => {
    const { el, scrollTo } = mount()
    scrollTo(TABLE_AT + 500 * ROW_H)
    const rows = mountedRows(el)
    expect(rows).not.toContain(0)
    expect(rows).toContain(500)
    expect(rows).toContain(510)
    expect(rows.length).toBeLessThanOrEqual(20 + 2 * 10 + 2)
    expect(el.scrollTop).toBe(TABLE_AT + 500 * ROW_H)
  })
})

describe('scrolling to a line in a folder page (YAZ-4636 T5)', () => {
  it('"New row below" on line 900 scrolls the HOST to the new row, and the rows at the top of its viewport are mounted', async () => {
    const { el, wrap, scrollTo, arrive } = mount()
    scrollTo(TABLE_AT + 900 * ROW_H)
    expect(nameCell(el, 'n0900')).toBeDefined()
    rightClick(nameCell(el, 'n0900'))
    act(() => item(el, 'New row below').click())
    await flush()
    scrollTo(0)
    expect(mountedRows(el)[0]).toBe(0)
    arrive()
    // The new row ties with n0900 on rank: its line is near 900, and the host scrolled there.
    expect(el.scrollTop).toBeGreaterThan(TABLE_AT + 880 * ROW_H)
    expect(wrap.scrollTop).toBe(0)
    expect(mountedRows(el)).toContain(rowAtTop(el))
    expect(el.querySelector<HTMLInputElement>('input[aria-label="Edit title"]')).not.toBeNull()
  })

  it('⌘F jumps to an unmounted match: the host scrolls to its line, and the match mounts marked', async () => {
    vi.useFakeTimers()
    try {
      const { el } = mount()
      expect(nameCell(el, 'n0950')).toBeUndefined()
      const start = el.querySelector<HTMLElement>('td[data-cell]')!
      act(() => start.focus())
      act(() => void start.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', metaKey: true, bubbles: true, cancelable: true })))
      const box = el.querySelector<HTMLInputElement>('.find-bar__input')!
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(box, 'n0950')
        box.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await act(async () => {
        vi.advanceTimersByTime(FIND_DEBOUNCE_MS)
        await Promise.resolve()
      })
      await act(async () => await Promise.resolve())
      expect(el.scrollTop).toBeGreaterThan(TABLE_AT + 930 * ROW_H)
      expect(mountedRows(el)).toContain(rowAtTop(el))
      expect(el.querySelector<HTMLElement>('[data-find="active"]')?.textContent).toBe('n0950')
    } finally {
      vi.useRealTimers()
    }
  })
})
