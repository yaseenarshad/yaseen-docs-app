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
import { dropAllHistories } from './valueHistory'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const { groupStore } = vi.hoisted(() => ({ groupStore: new Map<string, string[]>() }))
vi.mock('../../lib/storage', () => ({
  storage: { getSettings: () => undefined,
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
  dropAllHistories()
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
/** The header's own group: "New note in this group", then its toggle. With two levels a second group follows, the level steps (YAZ-3746 13AT). */
const ownItems = (): string[] => [...document.querySelectorAll('.ctx-menu .ctx-menu__group:first-child [role="menuitem"]')].map((b) => b.textContent ?? '')
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
    // The edit first (YAZ-4608 C8); the view has two levels, so the level steps follow (YAZ-3746 13AT).
    expect(items()).toEqual(['New note in this group', 'Collapse this group', 'Collapse one level', 'Expand one level'])
  })

  it('a right-click on the empty part of a table group row opens the same menu (not the system one)', () => {
    const el = mount(viewOf('table'))
    const cell = headersOf(el, 'A')[0].closest<HTMLElement>('td.view-table__group-cell')!
    const event = rightClick(cell)
    expect(event.defaultPrevented).toBe(true)
    expect(ownItems()).toEqual(['New note in this group', 'Collapse this group']) // the edit first (YAZ-4608 C8)
    pick('Collapse this group')
    expect(expanded(headersOf(el, 'A')[0])).toBe('false')
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
    expect(ownItems().at(-1)).toBe('Expand this group')
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
    expect(ownItems()).toEqual(['Collapse this group'])
    expect(items()).not.toContain('New note in this group')
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

describe('a nested Folder group header: Expand all and Collapse all (YAZ-4928)', () => {
  /** The folder page `wiki`: Cloud › AWS › Lambda › Tuning, Cloud › Costs, and Habits, a leaf. */
  const at = (path: string): IndexRecord => {
    const basename = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '')
    return { ...TEST_RECORDS[0], path: `/vault/${path}`, name: `${basename}.md`, basename, title: basename, folder: path.slice(0, path.lastIndexOf('/')), properties: {} }
  }
  const TREE = [at('wiki/cloud/Cloud note.md'), at('wiki/cloud/aws/S3.md'), at('wiki/cloud/aws/lambda/Cold starts.md'), at('wiki/cloud/aws/lambda/tuning/Memory.md'), at('wiki/cloud/costs/Reserved.md'), at('wiki/habits/Reading.md')]
  const folderView = (depth: string) => `views:
  - type: table
    name: V
    order:
      - file.name
    groupBy:
      - property: file.folder
        depth: ${depth}
`
  /** `locked`: a read-only folder page — the host refuses every settings write and every note is read only (YAZ-4939). */
  const onChange = vi.fn()
  const writeValues = vi.fn()
  function mountFolder(text: string, locked = false) {
    let parsed = parseViews(text)
    onChange.mockImplementation((next: ParsedViews) => {
      if (locked) return false
      parsed = next
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const readOnly = locked ? new Set(TREE.map((r) => r.path)) : undefined
    draw = () => act(() => root?.render(<ViewsPane parsed={parsed} onChange={onChange} root="/vault" folderPath="/vault/wiki" records={TREE} readOnly={readOnly} folder={testFolderHost({ create, vaultRecords: TREE, writeValues })} onOpenFile={vi.fn()} />))
    draw()
    return container
  }
  const K = (...dirs: string[]) => dirs.map((d) => `v:${d}`).join(SEP)
  const groupOf = (name: string): string[] => {
    const own = [...document.querySelectorAll<HTMLElement>('.ctx-menu [role="menuitem"]')].find((b) => b.textContent === name)?.closest('.ctx-menu__group')
    return own === null || own === undefined ? [] : [...own.querySelectorAll<HTMLElement>('[role="menuitem"]')].map((b) => `${b.textContent}${b.hasAttribute('disabled') ? ' (off)' : ''}`)
  }

  it('Depth All: the header of a folder with subfolders offers both, in their own group before the level steps; Collapse all shuts every folder group below it and the header stays open', async () => {
    const { storage } = await import('../../lib/storage')
    const pane = mountFolder(folderView('all'))
    expect(headersOf(pane, 'aws')).toHaveLength(1)
    rightClick(headersOf(pane, 'cloud')[0])
    expect(items()).toEqual(['New note in this group', 'Collapse this group', 'Expand all', 'Collapse all', 'Collapse one level', 'Expand one level'])
    expect(groupOf('Expand all')).toEqual(['Expand all (off)', 'Collapse all'])
    pick('Collapse all')
    expect(menu()).toBeNull()
    expect(storage.setViewGroups).toHaveBeenLastCalledWith('/vault', '/vault/wiki::V', [K('wiki/cloud', 'wiki/cloud/aws'), K('wiki/cloud', 'wiki/cloud/aws', 'wiki/cloud/aws/lambda'), K('wiki/cloud', 'wiki/cloud/aws', 'wiki/cloud/aws/lambda', 'wiki/cloud/aws/lambda/tuning'), K('wiki/cloud', 'wiki/cloud/costs')])
    expect(expanded(headersOf(pane, 'cloud')[0])).toBe('true')
    expect(expanded(headersOf(pane, 'aws')[0])).toBe('false')
    expect(expanded(headersOf(pane, 'costs')[0])).toBe('false')
    expect(headersOf(pane, 'lambda')).toHaveLength(0) // folded under aws
    // Back in: Collapse all has nothing left to shut; Expand all opens every group below again.
    rightClick(headersOf(pane, 'cloud')[0])
    expect(groupOf('Expand all')).toEqual(['Expand all', 'Collapse all (off)'])
    pick('Expand all')
    expect(storage.setViewGroups).toHaveBeenLastCalledWith('/vault', '/vault/wiki::V', [])
    expect(headersOf(pane, 'tuning')).toHaveLength(1)
  })

  it('Expand all on a shut header opens the header too; a leaf folder and a Top-folder group offer neither', () => {
    const pane = mountFolder(folderView('all'))
    rightClick(headersOf(pane, 'aws')[0])
    pick('Collapse this group')
    expect(headersOf(pane, 'lambda')).toHaveLength(0)
    rightClick(headersOf(pane, 'aws')[0])
    expect(groupOf('Expand all')).toEqual(['Expand all', 'Collapse all'])
    pick('Expand all')
    expect(expanded(headersOf(pane, 'aws')[0])).toBe('true')
    expect(headersOf(pane, 'tuning')).toHaveLength(1)
    rightClick(headersOf(pane, 'habits')[0])
    expect(items()).not.toContain('Expand all')
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    draw()
    act(() => root?.unmount())
    container?.remove()
    const flat = mountFolder(folderView('1').replace('        depth: 1\n', ''))
    rightClick(headersOf(flat, 'cloud')[0])
    expect(items()).toEqual(['New note in this group', 'Collapse this group'])
  })

  describe('one ⌘Z undoes each, ⇧⌘Z redoes it', () => {
    const ALL_BELOW = [K('wiki/cloud', 'wiki/cloud/aws'), K('wiki/cloud', 'wiki/cloud/aws', 'wiki/cloud/aws/lambda'), K('wiki/cloud', 'wiki/cloud/aws', 'wiki/cloud/aws/lambda', 'wiki/cloud/aws/lambda/tuning'), K('wiki/cloud', 'wiki/cloud/costs')]
    const stored = (): string[] => groupStore.get('/vault|/vault/wiki::V') ?? []
    /** ⌘Z (or ⇧⌘Z) where the keyboard is after the pick. Returns whether the key was taken. */
    function press(shift = false): boolean {
      const at = document.activeElement ?? document.body
      const event = new KeyboardEvent('keydown', { key: shift ? 'Z' : 'z', metaKey: true, shiftKey: shift, bubbles: true, cancelable: true })
      act(() => void at.dispatchEvent(event))
      draw()
      return event.defaultPrevented
    }

    it('Collapse all: the keyboard is on that header after the pick; ⌘Z puts back the groups as they were, ⇧⌘Z shuts them again', () => {
      const pane = mountFolder(folderView('all'))
      rightClick(headersOf(pane, 'cloud')[0])
      pick('Collapse all')
      expect(stored()).toEqual(ALL_BELOW)
      expect(document.activeElement).toBe(headersOf(pane, 'cloud')[0].querySelector('.view-group__toggle'))
      expect(press()).toBe(true)
      expect(stored()).toEqual([])
      expect(headersOf(pane, 'tuning')).toHaveLength(1)
      expect(press(true)).toBe(true)
      expect(stored()).toEqual(ALL_BELOW)
      expect(headersOf(pane, 'lambda')).toHaveLength(0)
      expect(onChange).not.toHaveBeenCalled() // view state only: never the page's settings
    })

    it('Expand all: ⌘Z shuts again exactly the groups that were shut, ⇧⌘Z opens them again', () => {
      const pane = mountFolder(folderView('all'))
      rightClick(headersOf(pane, 'cloud')[0])
      pick('Collapse all')
      rightClick(headersOf(pane, 'cloud')[0])
      pick('Expand all')
      expect(stored()).toEqual([])
      expect(press()).toBe(true)
      expect(stored()).toEqual(ALL_BELOW)
      expect(press(true)).toBe(true)
      expect(stored()).toEqual([])
      // Two picks are two steps: a second ⌘Z takes back the Collapse all too.
      expect(press()).toBe(true)
      expect(press()).toBe(true)
      expect(stored()).toEqual([])
    })

    it('a mixed state comes back exactly; a single group\'s own fold is not a step (today\'s behaviour)', () => {
      const pane = mountFolder(folderView('all'))
      // Shut Costs, Tuning and Habits one by one (Habits is outside Cloud: Expand all on Cloud leaves it shut).
      for (const name of ['costs', 'tuning', 'habits']) {
        rightClick(headersOf(pane, name)[0])
        pick('Collapse this group')
      }
      const mixed = stored()
      expect(mixed).toEqual([K('wiki/cloud', 'wiki/cloud/costs'), K('wiki/cloud', 'wiki/cloud/aws', 'wiki/cloud/aws/lambda', 'wiki/cloud/aws/lambda/tuning'), K('wiki/habits')])
      rightClick(headersOf(pane, 'cloud')[0])
      pick('Expand all')
      expect(stored()).toEqual([K('wiki/habits')])
      expect(press()).toBe(true)
      expect(stored()).toEqual(mixed)
      expect(expanded(headersOf(pane, 'costs')[0])).toBe('false')
      expect(expanded(headersOf(pane, 'aws')[0])).toBe('true')
      // The three single folds made no step: nothing is left to undo, and the key is not taken.
      expect(press()).toBe(false)
      expect(stored()).toEqual(mixed)
    })

    it('in the table, ⌘Z in a cell reaches the same step (the page\'s one history)', () => {
      const pane = mountFolder(folderView('all'))
      rightClick(headersOf(pane, 'cloud')[0])
      pick('Collapse all')
      act(() => pane.querySelector<HTMLElement>('td[data-cell]')!.focus())
      expect(press()).toBe(true)
      expect(stored()).toEqual([])
    })

    it('read only: Collapse all and Expand all still undo and redo, and nothing is written but the view state', () => {
      const pane = mountFolder(folderView('all'), true)
      rightClick(headersOf(pane, 'cloud')[0])
      pick('Collapse all')
      expect(stored()).toEqual(ALL_BELOW)
      rightClick(headersOf(pane, 'cloud')[0])
      pick('Expand all')
      expect(press()).toBe(true)
      expect(stored()).toEqual(ALL_BELOW)
      expect(press()).toBe(true)
      expect(stored()).toEqual([])
      expect(press(true)).toBe(true)
      expect(stored()).toEqual(ALL_BELOW)
      expect(onChange).not.toHaveBeenCalled()
      expect(writeValues).not.toHaveBeenCalled()
      expect(create).not.toHaveBeenCalled()
    })
  })
})
