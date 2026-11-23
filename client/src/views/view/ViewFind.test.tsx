/**
 * ⌘F on a folder page (YAZ-4613, D64): the page's find bar over the view's rows, in every view. ViewsPane mounted with
 * react-dom in jsdom; the bar's debounce runs on fake timers, and a mount's marks land in a mutation observer's
 * microtask, so each step awaits `settle`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IndexRecord } from '@shared/types'
import { type ParsedViews, parseViews } from '../viewSchema'
import { ViewsPane, type ViewsPaneProps } from '../ViewsPane'
import { testFolderHost } from '../testFolderHost'
import { TEST_RECORDS } from '../testRecords'
import { FindBar } from '../../editor/find/FindBar'
import { createFindChannel } from '../../editor/find/findChannel'
import { FIND_DEBOUNCE_MS } from './viewFind'

vi.mock('../../lib/storage', () => ({ storage: { getViewGroups: () => [], setViewGroups: () => undefined, getSettings: () => undefined, getRoots: () => ['/vault'] } }))

/** Every render of a property cell: a search must render none (D64: only the marks change). */
const cellRenders = vi.hoisted(() => ({ n: 0 }))
vi.mock('./EditableCell', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./EditableCell')>()
  const Counted = (props: Parameters<typeof mod.EditableCell>[0]) => {
    cellRenders.n++
    return <mod.EditableCell {...props} />
  }
  return { ...mod, EditableCell: Counted }
})

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const rec = (name: string, properties: Record<string, unknown>): IndexRecord => ({
  ...TEST_RECORDS[0],
  path: `/vault/${name}.md`,
  name: `${name}.md`,
  basename: name,
  title: name,
  folder: '',
  properties,
})

const FRUIT = [
  rec('Apple', { status: 'todo', page: 'red fruit' }),
  rec('Banana', { status: 'todo', page: 'yellow' }),
  rec('Cherry', { status: 'done', page: 'red berry' }),
  rec('Date', { status: 'done', page: 'brown' }),
]

const view = (type: string, extra = '') => `views:
  - type: ${type}
    name: V
    order:
      - file.name
      - note.status
      - note.page
${extra}`
const GROUPED = '    groupBy:\n      property: note.status\n'

let root: Root | null = null
let container: HTMLElement | null = null

function mount(text: string, props: Partial<ViewsPaneProps> = {}): HTMLElement {
  let parsed = parseViews(text)
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
          folderPath="/vault"
          records={FRUIT}
          folder={testFolderHost({ vaultRecords: props.records ?? FRUIT })}
          onOpenFile={() => undefined}
          {...props}
        />,
      ),
    )
  draw()
  return container
}

beforeEach(() => {
  vi.useFakeTimers()
  cellRenders.n = 0
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  vi.useRealTimers()
})

/** The debounce, then the mutation observer's microtask. */
async function settle(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(FIND_DEBOUNCE_MS)
    await Promise.resolve()
  })
  await act(async () => await Promise.resolve())
}

const cmdF = (at: Element) => act(() => void at.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', metaKey: true, bubbles: true, cancelable: true })))
const key = (at: Element, k: string, shiftKey = false) => act(() => void at.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true, cancelable: true })))
const input = (el: ParentNode) => el.querySelector<HTMLInputElement>('.find-bar__input')
const count = (el: ParentNode) => el.querySelector('.find-bar__count')?.textContent
const marked = (el: ParentNode) => [...el.querySelectorAll<HTMLElement>('[data-find]')]
const active = (el: ParentNode) => el.querySelector<HTMLElement>('[data-find="active"]')

function type(el: HTMLInputElement, value: string): void {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** Focus a cell of the table, press ⌘F there, type `query`, and let the search run. */
async function find(el: HTMLElement, query: string, from: string = 'td[data-cell], [data-hover-item]'): Promise<HTMLInputElement> {
  const start = el.querySelector<HTMLElement>(from)!
  if (start.tabIndex < 0) start.tabIndex = -1
  act(() => start.focus())
  cmdF(start)
  const box = input(el)!
  type(box, query)
  await settle()
  return box
}

describe('⌘F on a folder page (YAZ-4613)', () => {
  it('⌘F in the view opens the find bar, focused, and the bar counts the matching cells', async () => {
    const el = mount(view('table'))
    expect(input(el)).toBeNull()
    const box = await find(el, 'red')
    expect(document.activeElement).toBe(box)
    // Apple's and Cherry's Page cells.
    expect(count(el)).toBe('1 of 2')
  })

  it('marks the mounted matching cells, the current one active', async () => {
    const el = mount(view('table'))
    await find(el, 'red')
    expect(marked(el).map((td) => td.textContent)).toEqual(['red fruit', 'red berry'])
    expect(active(el)?.textContent).toBe('red fruit')
  })

  it('Enter and ↓ go to the next match, ⇧Enter and ↑ to the previous one, wrapping at both ends', async () => {
    const el = mount(view('table'))
    const box = await find(el, 'red')
    key(box, 'Enter')
    expect(count(el)).toBe('2 of 2')
    expect(active(el)?.textContent).toBe('red berry')
    key(box, 'ArrowDown')
    expect(count(el)).toBe('1 of 2')
    key(box, 'ArrowUp')
    expect(count(el)).toBe('2 of 2')
    key(box, 'Enter', true)
    expect(count(el)).toBe('1 of 2')
    expect(active(el)?.textContent).toBe('red fruit')
  })

  it('matches the text the cell shows, link titles and the title included', async () => {
    const el = mount(view('table'))
    await find(el, 'cherry')
    expect(count(el)).toBe('1 of 1')
    expect(active(el)?.classList.contains('view-table__name')).toBe(true)
  })

  it('jumps in a windowed table: the match far below mounts and is marked', async () => {
    const many = Array.from({ length: 600 }, (_, i) => rec(`n${String(i).padStart(3, '0')}`, {}))
    const el = mount('views:\n  - type: table\n    name: T\n', { records: many })
    expect(el.textContent).not.toContain('n599')
    await find(el, 'n599')
    expect(count(el)).toBe('1 of 1')
    expect(active(el)?.textContent).toBe('n599')
  })

  it('counts a match in a collapsed group, and the jump to it opens the group', async () => {
    const el = mount(view('table', GROUPED))
    act(() => el.querySelector<HTMLElement>('[aria-label="Toggle group done"]')!.click())
    expect(el.textContent).not.toContain('Cherry')
    await find(el, 'berry')
    expect(count(el)).toBe('1 of 1')
    expect(el.querySelector('[aria-label="Toggle group done"]')?.getAttribute('aria-expanded')).toBe('true')
    expect(active(el)?.textContent).toBe('red berry')
  })

  it.each(['board', 'list', 'cards'])('%s: marks the matching cards by their shown fields', async (type) => {
    const el = mount(view(type, type === 'board' ? GROUPED : ''))
    await find(el, 'red')
    expect(count(el)).toBe('1 of 2')
    expect(marked(el).every((item) => item.tagName === 'LI')).toBe(true)
    expect(marked(el).map((item) => item.dataset.hoverItem).sort()).toEqual(['/vault/Apple.md', '/vault/Cherry.md'])
    // The first match is the first one shown: a board reads column by column.
    expect(active(el)).toBe(marked(el)[0])
  })

  it('calendar: matches the titles of the cards on screen', async () => {
    // One date makes `when` the date column; the rest wait in the "No date" tray.
    const cal = [rec('Old', { when: '2001-01-01' }), ...FRUIT]
    const el = mount('views:\n  - type: calendar\n    name: C\n', { records: cal })
    await find(el, 'e')
    // Apple, Cherry and Date in the tray; "Old" is in another month, off screen.
    expect(count(el)).toBe('1 of 3')
    expect(marked(el).map((item) => item.dataset.hoverItem)).toEqual(['/vault/Apple.md', '/vault/Cherry.md', '/vault/Date.md'])
  })

  it('Esc closes the bar, clears the marks and puts the focus on the current match', async () => {
    const el = mount(view('table'))
    const box = await find(el, 'red')
    key(box, 'Enter')
    key(box, 'Escape')
    expect(input(el)).toBeNull()
    expect(marked(el)).toEqual([])
    expect(document.activeElement?.textContent).toBe('red berry')
  })

  it('the search box still filters the rows, and find reads the rows it leaves', async () => {
    const el = mount(view('table'))
    act(() => el.querySelector<HTMLElement>('[aria-label="Search"]')!.click())
    const search = el.querySelector<HTMLInputElement>('[aria-label="Search rows"]')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(search, 'cherry')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(el.querySelectorAll('tbody td.view-table__name')).toHaveLength(1)
    // ⌘F from the search box opens find; the search keeps its text.
    await find(el, 'red', '[aria-label="Search rows"]')
    expect(count(el)).toBe('1 of 1')
    expect(search.value).toBe('cherry')
  })

  it('a search renders no cell: typing and stepping only mark the DOM', async () => {
    const el = mount(view('table'))
    // The counter sees the table's cells: 4 pages × Status and Page.
    expect(cellRenders.n).toBe(8)
    cellRenders.n = 0
    const box = await find(el, 'r')
    type(box, 're')
    type(box, 'red')
    await settle()
    key(box, 'Enter')
    expect(count(el)).toBe('2 of 2')
    expect(cellRenders.n).toBe(0)
  })

  it('⌘F in the views beats the find of a page showing beside them, which still answers from its own page', async () => {
    const el = mount(view('table'))
    // A page in the right panel: its own `page` bar, its editor shown.
    const page = document.createElement('div')
    page.innerHTML = '<div class="editor-mount"><div class="ProseMirror" tabindex="0"></div></div>'
    document.body.appendChild(page)
    const channel = createFindChannel()
    const pageRoot = createRoot(document.body.appendChild(document.createElement('div')))
    act(() => pageRoot.render(<FindBar channel={channel} scope="page" hostRef={{ current: page }} />))
    await find(el, 'red')
    expect(count(el)).toBe('1 of 2')
    expect(channel.getState().open).toBe(false)
    const editor = page.querySelector<HTMLElement>('.ProseMirror')!
    act(() => editor.focus())
    cmdF(editor)
    expect(channel.getState().open).toBe(true)
    act(() => pageRoot.unmount())
    page.remove()
  })
})
