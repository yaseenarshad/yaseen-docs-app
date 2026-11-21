/**
 * Where you are in a grouped folder table (YAZ-4798): the table marks for Sticky group headers, Group lines and Line
 * style, from the view's own choice or Settings › Folder pages; an ungrouped table has none; a click on a stuck header
 * scrolls back to its group; and the View tab's three rows with their ↺ back to Settings. ViewsPane mounted with
 * react-dom in jsdom (no layout: the measuring itself is `groupGuides.test.ts`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_FOLDER_PAGES, type FolderPagesSettings, type IndexRecord } from '@shared/types'
import { type ParsedViews, type ViewDef, type ViewSet, parseViews } from '../viewSchema'
import { ViewsPane, type ViewsPaneProps } from '../ViewsPane'
import { ViewDefaults, withDefaults } from '../viewDefaults'
import { testFolderHost } from '../testFolderHost'
import { TEST_RECORDS } from '../testRecords'
import { GroupGuideSettings } from './TableLookSettings'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../lib/storage', () => ({ storage: { getViewGroups: () => [], setViewGroups: () => undefined } }))

const rec = (name: string, properties: Record<string, unknown>): IndexRecord => ({ ...TEST_RECORDS[0], path: `/vault/${name}.md`, name: `${name}.md`, basename: name, title: name, properties })
const RECORDS = [rec('a1', { layer: 'A', sub: 'x' }), rec('a2', { layer: 'A', sub: 'y' }), rec('b1', { layer: 'B', sub: 'x' })]

const table = (extra = '', groupBy = '    groupBy:\n      - property: note.layer\n      - property: note.sub\n') => `views:\n  - type: table\n    name: T\n    order:\n      - file.name\n${groupBy}${extra}`

let root: Root | null = null
let container: HTMLElement | null = null

function mount(text: string, props: Partial<ViewsPaneProps> = {}, host: HTMLElement = document.body) {
  const parsed: ParsedViews = parseViews(text)
  container = document.createElement('div')
  host.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<ViewsPane parsed={parsed} onChange={vi.fn()} root="/vault" folderPath="/vault/Page" records={RECORDS} folder={testFolderHost()} onOpenFile={vi.fn()} {...props} />))
  return container.querySelector<HTMLTableElement>('table.view-table')!
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.replaceChildren()
})

const marks = (t: HTMLElement) => [t.getAttribute('data-sticky-groups'), t.getAttribute('data-group-lines'), t.getAttribute('data-group-line-style')]

describe('the table marks (YAZ-4798)', () => {
  it('Settings by default: sticky headers on, lines on hover, plain; one line per open group, every line numbered', () => {
    const t = mount(table())
    expect(marks(t)).toEqual(['', 'hover', null])
    // A, A.x, A.y, B, B.x: five open groups, five lines, each at its header's level.
    const lines = [...t.querySelectorAll<HTMLElement>('caption.view-table__guides > .view-table__lines > i')]
    expect(lines.map((l) => l.style.getPropertyValue('--depth'))).toEqual(['0', '1', '1', '0', '1'])
    const rows = [...t.tBodies[0].rows]
    expect(rows.map((r) => r.dataset.line)).toEqual(rows.map((_, j) => String(j)))
    expect(lines.map((l) => rows[Number(l.dataset.seg)].classList.contains('view-table__group'))).toEqual([true, true, true, true, true])
  })

  it('the view’s own choices win: lines always with the thread; sticky off; all off draws nothing', () => {
    expect(marks(mount(table('    groupLines: always\n    groupLineStyle: thread\n')))).toEqual(['', 'always', 'thread'])
    act(() => root?.unmount())
    expect(marks(mount(table('    stickyGroups: false\n')))).toEqual([null, 'hover', null])
    act(() => root?.unmount())
    const off = mount(table('    stickyGroups: false\n    groupLines: off\n    groupLineStyle: thread\n'))
    expect(marks(off)).toEqual([null, null, null])
    expect(off.querySelector('caption')).toBeNull()
    expect(off.querySelector('tbody tr[data-line]')).toBeNull()
  })

  it('Settings › Folder pages says otherwise: a view with no key follows it', () => {
    const fp: FolderPagesSettings = { ...DEFAULT_FOLDER_PAGES, stickyGroups: false, groupLines: 'always', groupLineStyle: 'thread' }
    expect(marks(mount(table(), { folderPages: fp }))).toEqual([null, 'always', 'thread'])
  })

  it('an ungrouped table is unchanged: no marks, no lines, no line numbers', () => {
    const t = mount(table('', ''))
    expect(marks(t)).toEqual([null, null, null])
    expect(t.querySelector('caption')).toBeNull()
    expect(t.querySelector('tbody tr[data-line]')).toBeNull()
  })

  it('a click on a stuck header scrolls back to its group; a click on its toggle or a header in its place does not', () => {
    const scroller = document.createElement('div')
    scroller.style.overflowY = 'auto'
    document.body.append(scroller)
    let scrollTop = 500
    Object.defineProperty(scroller, 'scrollTop', { get: () => scrollTop, set: (v: number) => (scrollTop = v), configurable: true })
    const t = mount(table(), {}, scroller)
    const wrap = t.closest<HTMLElement>('.view-table-wrap')!
    const header = t.querySelector<HTMLTableRowElement>('tbody tr.view-table__group[data-line="0"]')!
    wrap.style.setProperty('--view-table-header-y', '100px')
    header.style.setProperty('--view-group-lift', '-30px')
    act(() => header.cells[0].click())
    expect(scrollTop).toBe(430)
    // In its own place (header-y + lift below 0): nothing.
    header.style.setProperty('--view-group-lift', '-200px')
    act(() => header.cells[0].click())
    expect(scrollTop).toBe(430)
    // Its toggle folds the group, and does not scroll.
    header.style.setProperty('--view-group-lift', '-30px')
    act(() => header.querySelector<HTMLElement>('.view-group__toggle')!.click())
    expect(scrollTop).toBe(430)
  })
})

describe('View › Groups (YAZ-4798)', () => {
  const draw = (own: ViewDef, defaults = DEFAULT_FOLDER_PAGES) => {
    const def: ViewSet = { views: [structuredClone(own)] }
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const render = () => root?.render(<ViewDefaults.Provider value={defaults}><GroupGuideSettings view={withDefaults(def.views[0], defaults)} own={def.views[0]} viewIndex={0} onUpdate={onUpdate as never} /></ViewDefaults.Provider>)
    // Each write draws the view again, as ViewsPane does.
    const onUpdate = (fn: (d: ViewSet) => void) => {
      fn(def)
      render()
    }
    act(() => render())
    return { el: container, def }
  }
  const pressed = (el: HTMLElement, label: string) => el.querySelector(`[aria-label="${label}"] [aria-pressed="true"]`)?.textContent
  const press = (el: HTMLElement, label: string, text: string) => act(() => [...el.querySelectorAll<HTMLButtonElement>(`[aria-label="${label}"] button`)].find((b) => b.textContent === text)!.click())

  it('shows Settings’ values with no ↺; a choice becomes the view’s own, and Settings’ value removes it', () => {
    const { el, def } = draw({ type: 'table', name: 'T' })
    expect(el.querySelector<HTMLInputElement>('[aria-label="Sticky group headers"]')!.checked).toBe(true)
    expect(pressed(el, 'Group lines')).toBe('On hover')
    expect(pressed(el, 'Group line style')).toBe('Lines')
    expect(el.querySelector('.view-from-settings--reset')).toBeNull()
    press(el, 'Group lines', 'On')
    press(el, 'Group line style', 'Thread')
    act(() => el.querySelector<HTMLInputElement>('[aria-label="Sticky group headers"]')!.click())
    expect(def.views[0]).toMatchObject({ groupLines: 'always', groupLineStyle: 'thread', stickyGroups: false })
    press(el, 'Group lines', 'On hover')
    expect(def.views[0].groupLines).toBeUndefined()
  })

  it('a view’s own value shows with the ↺, which hands it back to Settings', () => {
    const { el, def } = draw({ type: 'table', name: 'T', groupLines: 'off' })
    expect(pressed(el, 'Group lines')).toBe('Off')
    const resets = el.querySelectorAll<HTMLButtonElement>('.view-from-settings--reset')
    expect(resets).toHaveLength(1)
    act(() => resets[0].click())
    expect(def.views[0].groupLines).toBeUndefined()
  })
})
