/**
 * The Undo toast after a move (YAZ-4541 S6): a board drag, a calendar drag and a "No date" drop each
 * say "Moved to <value>" through the host's notice, with the app's Undo button (`fades: true`). Undo
 * writes the old value back through the same optimistic write. A failed move shows no toast.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IndexRecord } from '@shared/types'
import { parseViews } from '../viewSchema'
import { ViewsPane, type ViewsPaneProps } from '../ViewsPane'
import { testFolderHost } from '../testFolderHost'
import { TEST_RECORDS } from '../testRecords'

vi.mock('../../lib/storage', () => ({ storage: { getViewGroups: () => [], setViewGroups: () => undefined, getSettings: () => undefined, getRoots: () => ['/vault'] } }))
vi.mock('../writeProperty', () => ({ writeProperty: vi.fn(), writeProperties: vi.fn() }))
import { writeProperty } from '../writeProperty'

const write = vi.mocked(writeProperty)

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const BOARD = `views:
  - type: board
    name: B
    order:
      - file.name
    groupBy:
      property: note.status
`
const CALENDAR = `views:
  - type: calendar
    name: C
`
const AGENTIC = '/vault/Content Pillars/1. Agentic Agency/Agentic Agency.md'

const rec = (name: string, properties: Record<string, unknown>): IndexRecord => ({ ...TEST_RECORDS[0], path: `/vault/${name}.md`, name: `${name}.md`, basename: name, title: name, properties })

let root: Root | null = null
let container: HTMLElement | null = null
let draw: () => void = () => {}

function mount(text: string, records: IndexRecord[], props: Partial<ViewsPaneProps> = {}) {
  const onNotice = vi.fn()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const parsed = parseViews(text)
  draw = () =>
    act(() =>
      root?.render(<ViewsPane parsed={parsed} onChange={() => undefined} root="/vault" folderPath="/vault/Tasks" records={records} folder={testFolderHost({ onNotice })} onOpenFile={() => undefined} {...props} />),
    )
  draw()
  return { el: container, onNotice }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 11, 10, 12, 0))
  write.mockReset()
  write.mockResolvedValue({ mtime: 1 })
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  vi.useRealTimers()
})

function q<T extends Element>(el: ParentNode, sel: string): T {
  const n = el.querySelector<T>(sel)
  if (n === null) throw new Error(`missing ${sel}`)
  return n
}
function fire(el: Element, type: string): void {
  act(() => void el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true })))
  draw()
}
async function flush(): Promise<void> {
  await act(async () => {})
  draw()
}
const boardCard = (el: ParentNode, title: string) =>
  [...el.querySelectorAll<HTMLElement>('.view-board__title')].find((b) => b.textContent === title)!.closest<HTMLElement>('.view-board__card')!
const boardCol = (el: ParentNode, label: string) => [...el.querySelectorAll<HTMLElement>('.view-board__col')].find((c) => q(c, '.view-group__value').textContent === label)!
const calCard = (el: ParentNode, title: string) =>
  [...el.querySelectorAll<HTMLElement>('.view-cal__card')].find((c) => c.querySelector('.view-cal__card-title')?.textContent === title)!

/** The toast's action as the host got it: label, fades, and its `run`. */
const actionOf = (onNotice: ReturnType<typeof vi.fn>) => onNotice.mock.calls[0][3] as { label: string; run: () => void; fades?: true }

describe('the move toast (YAZ-4541 S6)', () => {
  it('a board drag says "Moved to <value> · Undo", and Undo writes the old value back', async () => {
    const { el, onNotice } = mount(BOARD, TEST_RECORDS)
    fire(boardCard(el, 'Agentic Agency'), 'dragstart')
    fire(boardCol(el, 'drafting'), 'drop')
    expect(onNotice).not.toHaveBeenCalled() // only after the write succeeds
    await flush()
    expect(onNotice).toHaveBeenCalledExactlyOnceWith('Moved to drafting', 'info', 'undo', expect.objectContaining({ label: 'Undo', fades: true }))
    act(() => actionOf(onNotice).run())
    draw()
    expect(write).toHaveBeenLastCalledWith(AGENTIC, 'status', 'idea')
    // the undo shows at once, the same optimistic way
    expect([...boardCol(el, 'idea').querySelectorAll('.view-board__title')].map((t) => t.textContent)).toContain('Agentic Agency')
    await flush()
    expect(onNotice).toHaveBeenCalledTimes(1) // the undo itself says nothing
  })

  it('a drop on "No value" says so', async () => {
    const records = [rec('One', { status: 'idea' }), rec('Two', {})]
    const { el, onNotice } = mount(BOARD, records)
    fire(boardCard(el, 'One'), 'dragstart')
    fire(boardCol(el, 'No value'), 'drop')
    await flush()
    expect(onNotice.mock.calls[0][0]).toBe('Moved to No value')
    act(() => actionOf(onNotice).run())
    expect(write).toHaveBeenLastCalledWith('/vault/One.md', 'status', 'idea')
  })

  it('a calendar drag says the day, and Undo puts the old value back, time and all', async () => {
    const { el, onNotice } = mount(CALENDAR, [rec('Timed', { due: '2026-12-04 10:30' })])
    fire(calCard(el, 'Timed'), 'dragstart')
    fire(q(el, '[data-day="2026-12-09"]'), 'dragover')
    fire(q(el, '[data-day="2026-12-09"]'), 'drop')
    await flush()
    expect(onNotice).toHaveBeenCalledExactlyOnceWith('Moved to Dec 9, 2026', 'info', 'undo', expect.objectContaining({ label: 'Undo', fades: true }))
    act(() => actionOf(onNotice).run())
    expect(write).toHaveBeenLastCalledWith('/vault/Timed.md', 'due', '2026-12-04 10:30')
  })

  it('a "No date" drop says "Moved to No date", and Undo gives the date back', async () => {
    const { el, onNotice } = mount(CALENDAR, [rec('Bare', { due: '2026-12-03' })])
    fire(calCard(el, 'Bare'), 'dragstart')
    fire(q(el, '.view-cal__tray'), 'dragover')
    fire(q(el, '.view-cal__tray'), 'drop')
    await flush()
    expect(onNotice.mock.calls[0][0]).toBe('Moved to No date')
    act(() => actionOf(onNotice).run())
    expect(write).toHaveBeenLastCalledWith('/vault/Bare.md', 'due', '2026-12-03')
  })

  it('a failed move shows no toast', async () => {
    write.mockRejectedValueOnce(new Error('disk full'))
    const { el, onNotice } = mount(BOARD, TEST_RECORDS)
    fire(boardCard(el, 'Agentic Agency'), 'dragstart')
    fire(boardCol(el, 'drafting'), 'drop')
    await flush()
    expect(onNotice).not.toHaveBeenCalled()
  })
})
