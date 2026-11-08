/**
 * The group header's right-click menu (YAZ-4604, D55): a right-click on a group header never shows the system menu; it
 * opens the app's menu, whose one item collapses or expands only that group (the chevron's stored key) and whose "New
 * note in this group" is the header's "+". Table, Board, List and Cards, at every level. ViewsPane mounted in jsdom.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IndexRecord } from '@shared/types'
import { parseViews, type ParsedViews } from '../viewSchema'
import { ViewsPane } from '../ViewsPane'
import type { NewNoteSeed } from '../newNote'
import { testFolderHost } from '../testFolderHost'
import { TEST_RECORDS } from '../testRecords'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const { groupStore } = vi.hoisted(() => ({ groupStore: new Map<string, string[]>() }))
vi.mock('../../lib/storage', () => ({
  storage: {
    getViewGroups: vi.fn((root: string, key: string) => groupStore.get(`${root}|${key}`) ?? []),
    setViewGroups: vi.fn((root: string, key: string, collapsed: readonly string[]) => {
      if (collapsed.length === 0) groupStore.delete(`${root}|${key}`)
      else groupStore.set(`${root}|${key}`, [...collapsed])
    }),
  },
}))
vi.mock('../writeProperty', () => ({ writeProperty: vi.fn(), writeProperties: vi.fn() }))

const create = vi.fn<(seed: NewNoteSeed, name?: string) => Promise<string>>()
const SEP = '\u001f'

const viewOf = (type: string) => `views:
  - type: ${type}
    name: V
    order:
      - file.name
    groupBy:
      - property: note.dept
      - property: note.proc
`

const rec = (name: string, properties: Record<string, unknown>): IndexRecord => ({
  ...TEST_RECORDS[0],
  path: `/vault/${name}.md`,
  name: `${name}.md`,
  basename: name,
  title: name,
  properties,
})

const RECORDS: IndexRecord[] = [rec('alpha1', { dept: 'A', proc: 'p1' }), rec('alpha2', { dept: 'A', proc: 'p2' }), rec('beta1', { dept: 'B', proc: 'p1' })]

let root: Root | null = null
let container: HTMLElement | null = null
let draw: () => void = () => {}

function mount(text: string) {
  let parsed = parseViews(text)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  draw = () =>
    act(() =>
      root?.render(
        <ViewsPane
          parsed={parsed}
          onChange={(next: ParsedViews) => {
            parsed = next
          }}
          root="/vault"
          folderPath="/vault/pillars.md"
          records={RECORDS}
          folder={testFolderHost({ create })}
          onOpenFile={vi.fn()}
        />,
      ),
    )
  draw()
  return container
}

beforeEach(() => {
  create.mockReset()
  create.mockResolvedValue('/vault/Untitled.md')
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  groupStore.clear()
  vi.clearAllMocks()
})

/** Every group header with this label, in document order (an inner label repeats under each outer). */
const headersOf = (el: ParentNode, label: string): HTMLElement[] =>
  [...el.querySelectorAll<HTMLElement>('.view-group')].filter((h) => h.querySelector('.view-group__value')?.textContent === label)

/** A real right-click: the press, then the `contextmenu` event. Returns that event. */
function rightClick(target: Element): MouseEvent {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 40, clientY: 50 })
  act(() => {
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 2 }))
    target.dispatchEvent(event)
  })
  draw()
  return event
}

const menu = (): HTMLElement | null => document.querySelector<HTMLElement>('.ctx-menu')
const items = (): string[] => [...document.querySelectorAll('.ctx-menu [role="menuitem"]')].map((b) => b.textContent ?? '')
function pick(name: string): void {
  const item = [...document.querySelectorAll<HTMLElement>('.ctx-menu [role="menuitem"]')].find((b) => b.textContent === name)
  if (item === undefined) throw new Error(`missing item ${name}`)
  act(() => item.click())
  draw()
}
const expanded = (header: HTMLElement): string | null => header.querySelector('.view-group__toggle')?.getAttribute('aria-expanded') ?? null

describe('group header right-click (YAZ-4604, D55)', () => {
  it('the system menu never shows: the event is default-prevented and the app menu opens', () => {
    const el = mount(viewOf('table'))
    const event = rightClick(headersOf(el, 'A')[0].querySelector('.view-group__value')!)
    expect(event.defaultPrevented).toBe(true)
    expect(menu()).not.toBeNull()
    expect(items()).toEqual(['Collapse this group', 'New note in this group'])
  })

  it('the item collapses only that inner group, stores its key, and then reads "Expand this group"', async () => {
    const { storage } = await import('../../lib/storage')
    const el = mount(viewOf('table'))
    rightClick(headersOf(el, 'p1')[1]) // B's p1
    pick('Collapse this group')
    expect(menu()).toBeNull()
    expect(storage.setViewGroups).toHaveBeenLastCalledWith('/vault', '/vault/pillars.md::V', [`v:B${SEP}v:p1`])
    expect(expanded(headersOf(el, 'p1')[1])).toBe('false')
    expect(expanded(headersOf(el, 'p1')[0])).toBe('true') // A's p1 untouched
    expect(expanded(headersOf(el, 'B')[0])).toBe('true')

    rightClick(headersOf(el, 'p1')[1])
    expect(items()[0]).toBe('Expand this group')
    pick('Expand this group')
    expect(storage.setViewGroups).toHaveBeenLastCalledWith('/vault', '/vault/pillars.md::V', [])
    expect(expanded(headersOf(el, 'p1')[1])).toBe('true')
  })

  it('"New note in this group" seeds that group, as its "+" does', () => {
    const el = mount(viewOf('table'))
    rightClick(headersOf(el, 'p1')[1]) // B's p1
    pick('New note in this group')
    expect(menu()).toBeNull()
    expect(create.mock.calls[0][0].properties).toEqual({ proc: 'p1', dept: 'B' })
  })

  it('a level without a "+" offers no New note item', () => {
    const el = mount(`formulas:\n  top: dept\n${viewOf('table').replace('- property: note.dept', '- property: formula.top')}`)
    const outer = el.querySelector<HTMLElement>('.view-group')!
    expect(outer.querySelector('.view-group__new')).toBeNull()
    rightClick(outer)
    expect(items()).toEqual(['Collapse this group'])
  })

  it('Esc and a press outside close it', () => {
    const el = mount(viewOf('table'))
    rightClick(headersOf(el, 'A')[0])
    expect(menu()).not.toBeNull()
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    draw()
    expect(menu()).toBeNull()
    rightClick(headersOf(el, 'A')[0])
    expect(menu()).not.toBeNull()
    act(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    draw()
    expect(menu()).toBeNull()
  })

  it('in the table, it opens no row menu and keeps the selection', () => {
    const el = mount(viewOf('table'))
    // ⇧-click from the focused first cell to the third selects a range (YAZ-4593).
    act(() => el.querySelector<HTMLElement>('td[data-cell="0:0"]')!.focus())
    act(() => el.querySelector('td[data-cell="2:0"]')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, shiftKey: true })))
    const selectedBefore = [...el.querySelectorAll('td[data-selected]')].length
    expect(selectedBefore).toBeGreaterThan(0)
    rightClick(headersOf(el, 'A')[0])
    expect(document.querySelectorAll('.ctx-menu')).toHaveLength(1)
    expect(items()).not.toContain('Copy path')
    expect([...el.querySelectorAll('td[data-selected]')].length).toBe(selectedBefore)
  })

  it.each(['board', 'list', 'cards'])('works in %s at both levels', async (type) => {
    const { storage } = await import('../../lib/storage')
    const el = mount(viewOf(type))
    const outer = headersOf(el, 'A')[0]
    const event = rightClick(outer)
    expect(event.defaultPrevented).toBe(true)
    pick('Collapse this group')
    expect(storage.setViewGroups).toHaveBeenLastCalledWith('/vault', '/vault/pillars.md::V', ['v:A'])
    expect(expanded(headersOf(el, 'A')[0])).toBe('false')

    rightClick(headersOf(el, 'p1').at(-1)!) // B's p1
    pick('Collapse this group')
    expect(storage.setViewGroups).toHaveBeenLastCalledWith('/vault', '/vault/pillars.md::V', ['v:A', `v:B${SEP}v:p1`])

    rightClick(headersOf(el, 'B')[0])
    pick('New note in this group')
    expect(create.mock.calls[0][0].properties).toEqual({ dept: 'B' })
  })
})
