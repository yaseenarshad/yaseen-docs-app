/**
 * "New row below" in the folder table's row and selection right-click (YAZ-4611 D63). ViewsPane is mounted in jsdom
 * with a host whose `create` records the seed and resolves a path; the test then hands the pane the new page, as the
 * index would. The new row's Name cell goes into title edit, the page does not open, and the toast's Undo trashes it.
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
import { dropAllHistories, dropHistoryPaths, renameHistoryPaths } from './valueHistory'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../lib/storage', () => ({ storage: { getViewGroups: () => [], setViewGroups: () => undefined, getSettings: () => undefined, getRoots: () => [] } }))

const page = (name: string, properties: Record<string, unknown>): IndexRecord => ({ ...TEST_RECORDS[4], path: `/vault/f/${name}.md`, basename: name, name: `${name}.md`, title: name, folder: 'f', properties })
const RECORDS = [page('A', { kind: 'post', rank: 1, status: 'todo', area: 'work' }), page('B', { kind: 'post', rank: 5, status: 'todo', area: 'home' }), page('C', { kind: 'post', rank: 9, status: 'done', area: 'work' })]
const NEW = '/vault/f/Untitled.md'

const TABLE = `views:
  - type: table
    name: T
    order:
      - file.name
      - note.rank
      - note.status
    sort:
      - property: note.rank
        direction: ASC
    filters:
      and:
        - 'note.kind == "post"'
`

let root: Root | null = null
beforeEach(() => dropAllHistories())
let container: HTMLElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

function mount(text: string, records: IndexRecord[] = RECORDS) {
  let parsed = parseViews(text)
  let shown = records
  const seeds: NewPageSeed[] = []
  const create = vi.fn(async (seed: NewPageSeed) => {
    seeds.push(seed)
    return NEW
  })
  const trash = vi.fn(async () => undefined)
  const retitle = vi.fn()
  const onNotice = vi.fn()
  const onOpenFile = vi.fn()
  const folder = testFolderHost({ create, trash, retitle, onNotice, vaultRecords: records })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const draw = () =>
    act(() =>
      root?.render(
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
          onOpenFile={onOpenFile}
        />,
      ),
    )
  draw()
  /** The index brings the new page, with its seed. */
  const arrive = (ctime?: number) => {
    shown = [...shown, { ...page('Untitled', seeds.at(-1)!.properties), ...(ctime !== undefined && { ctime }) }]
    folder.vaultRecords = shown
    draw()
  }
  return { el: container, seeds, create, trash, retitle, onNotice, onOpenFile, arrive }
}

const nameCell = (el: ParentNode, title: string) => [...el.querySelectorAll<HTMLElement>('td.view-table__name')].find((td) => td.textContent === title)!
const rightClick = (target: Element) => act(() => void target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 40, clientY: 40 })))
const item = (el: ParentNode, label: string) => [...el.querySelectorAll<HTMLButtonElement>('.ctx-menu [role="menuitem"]')].find((b) => b.textContent === label)!
/** The data rows' titles; a title in edit reads its field. */
const names = (el: ParentNode) => [...el.querySelectorAll<HTMLElement>('tbody td.view-table__name')].map((td) => td.querySelector('input')?.value ?? td.textContent)
const flush = () => act(async () => {})
async function newBelow(el: HTMLElement, title: string) {
  rightClick(nameCell(el, title))
  act(() => item(el, 'New row below').click())
  await flush()
}

describe('New row below (YAZ-4611 D63)', () => {
  it('the seed has the filter value, the row\'s sort value and its group values at every level', async () => {
    const { el, seeds } = mount(`${TABLE}    groupBy:
      property: note.status
`)
    await newBelow(el, 'B')
    expect(seeds).toHaveLength(1)
    // `area` is no sort, group or filter column: it stays empty.
    expect(seeds[0].properties).toEqual({ kind: 'post', rank: 5, status: 'todo' })
  })

  it('two group levels seed both values', async () => {
    const { el, seeds } = mount(`${TABLE}    groupBy:
      - property: note.status
      - property: note.area
`)
    await newBelow(el, 'B')
    expect(seeds[0].properties).toMatchObject({ status: 'todo', area: 'home', rank: 5 })
  })

  it('under a sort the new row shows right after the anchor, its Name cell in title edit; the page does not open', async () => {
    const { el, arrive, onOpenFile } = mount(TABLE)
    await newBelow(el, 'B')
    arrive()
    expect(names(el)).toEqual(['A', 'B', 'Untitled', 'C'])
    const input = el.querySelector<HTMLInputElement>('input[aria-label="Edit title"]')!
    expect(input.closest('td')).toBe(el.querySelectorAll('td.view-table__name')[2])
    expect(onOpenFile).not.toHaveBeenCalled()
  })

  it('Enter retitles the page; Esc keeps "Untitled"', async () => {
    const a = mount(TABLE)
    await newBelow(a.el, 'B')
    a.arrive()
    const input = a.el.querySelector<HTMLInputElement>('input[aria-label="Edit title"]')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Plan')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => void input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })))
    expect(a.retitle).toHaveBeenCalledExactlyOnceWith(NEW, 'Plan')
    act(() => root?.unmount())

    const b = mount(TABLE)
    await newBelow(b.el, 'A')
    b.arrive()
    const field = b.el.querySelector<HTMLInputElement>('input[aria-label="Edit title"]')!
    act(() => void field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect(b.el.querySelector('input[aria-label="Edit title"]')).toBeNull()
    expect(b.retitle).not.toHaveBeenCalled()
  })

  it('the toast\'s Undo moves the new page to the Trash', async () => {
    const { el, onNotice, trash } = mount(TABLE)
    await newBelow(el, 'B')
    const [message, , type, action] = onNotice.mock.lastCall as [string, string, string, { run: () => void }]
    expect([message, type]).toEqual(['Added a row', 'undo'])
    act(() => action.run())
    expect(trash).toHaveBeenCalledExactlyOnceWith([NEW])
  })

  it('the Undo follows the page\'s rename (YAZ-4637 T3): a retitle in a vault without ids renames the file, and Undo trashes THAT file', async () => {
    const { el, onNotice, trash } = mount(TABLE)
    await newBelow(el, 'B')
    renameHistoryPaths(NEW, '/vault/f/My title.md')
    const [, , , action] = onNotice.mock.lastCall as [string, string, string, { run: () => void }]
    act(() => action.run())
    expect(trash).toHaveBeenCalledExactlyOnceWith(['/vault/f/My title.md'])
  })

  it('the Undo trashes only the page it created (T3): nothing once that page was deleted, and nothing when a newer file stands at its path', async () => {
    const a = mount(TABLE)
    await newBelow(a.el, 'B')
    dropHistoryPaths(NEW)
    act(() => (a.onNotice.mock.lastCall as [string, string, string, { run: () => void }])[3].run())
    expect(a.trash).not.toHaveBeenCalled()
    act(() => root?.unmount())
    // A file born long after the row: not the one the Undo made.
    const b = mount(TABLE)
    await newBelow(b.el, 'B')
    b.arrive(Date.now() + 120_000)
    act(() => (b.onNotice.mock.lastCall as [string, string, string, { run: () => void }])[3].run())
    expect(b.trash).not.toHaveBeenCalled()
    expect(b.onNotice.mock.lastCall![0]).toContain("Can't undo")
  })

  it('⌘Z on the table trashes it too: one step of the page\'s history (YAZ-4612 S41)', async () => {
    const { el, trash } = mount(TABLE)
    await newBelow(el, 'B')
    const td = nameCell(el, 'A')
    act(() => void td.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, bubbles: true, cancelable: true })))
    expect(trash).toHaveBeenCalledExactlyOnceWith([NEW])
  })

  it('the selection menu offers it, on the last selected row', async () => {
    const { el, seeds } = mount(TABLE)
    const down = (target: Element, init: MouseEventInit = {}) => act(() => void target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, ...init })))
    const gutterOf = (title: string) => nameCell(el, title).parentElement!.querySelector('td.view-table__gutter')!
    down(gutterOf('A'))
    down(gutterOf('C'), { shiftKey: true })
    rightClick(nameCell(el, 'B'))
    act(() => item(el, 'New row below').click())
    await flush()
    expect(seeds[0].properties).toMatchObject({ rank: 9 })
  })

  it('a windowed table (600 pages) scrolls to the new row and puts its Name cell in edit', async () => {
    const many = Array.from({ length: 600 }, (_, i) => page(`n${String(i).padStart(3, '0')}`, { rank: i * 2 }))
    const { el, arrive } = mount(TABLE.replace(`    filters:
      and:
        - 'note.kind == "post"'
`, ''), many)
    const wrap = el.querySelector<HTMLElement>('.view-table-wrap')!
    act(() => {
      wrap.scrollTop = 300 * 28
      wrap.dispatchEvent(new Event('scroll', { bubbles: true }))
    })
    await newBelow(el, 'n300')
    act(() => {
      wrap.scrollTop = 0
      wrap.dispatchEvent(new Event('scroll', { bubbles: true }))
    })
    expect(el.querySelector('td.view-table__name')?.textContent).toBe('n000')
    // The new page has n300's rank: its line is near 300, which the scroll mounts.
    arrive()
    expect(wrap.scrollTop).toBeGreaterThan(280 * 28)
    const input = el.querySelector<HTMLInputElement>('input[aria-label="Edit title"]')!
    // It ties with n300 on rank, so the view's own order puts it beside n300 (D63: the sort decides).
    const tr = input.closest('tr')!
    expect([tr.previousElementSibling, tr.nextElementSibling].map((row) => row?.querySelector('.view-table__name')?.textContent)).toContain('n300')
  })
})
