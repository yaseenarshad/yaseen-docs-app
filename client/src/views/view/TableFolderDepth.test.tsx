/**
 * A Folder level's Depth in a Table (YAZ-4918): ViewsPane mounted with react-dom in jsdom on the page `stages`, over
 * pages one to six folders down. With Depth All the subfolders' groups nest inside their folder's group on ONE view
 * level: a header's `--depth` is its place in the tree, a row's one more, and neither goes past four steps. A nested
 * header keeps a Folder group's parts: its count, its collapse (whole branch), its ↗, and its "+" born in that folder.
 * The `#` gutter restarts in every section. Full path is one flat header per folder, named by its path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IndexRecord } from '@shared/types'
import { parseViews, type ParsedViews } from '../viewSchema'
import { ViewsPane } from '../ViewsPane'
import type { NewPageSeed } from '../newPage'
import { testFolderHost } from '../testFolderHost'
import { groupPathKeyOf } from './GroupHeader'
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

const VIEW = (level: string) => `views:
  - type: table
    name: T
    order:
      - file.name
    groupBy:
      - property: file.folder
${level}`

const at = (path: string): IndexRecord => {
  const basename = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '')
  const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
  return { ...TEST_RECORDS[0], path: `/vault/${path}`, name: `${basename}.md`, basename, title: basename, folder, properties: {} }
}
/** The page `stages`: pages one to six folders down, so the tree's deepest header sits five steps in. */
const RECORDS = [
  at('stages/Lead Gen.md'),
  at('stages/archive/Old.md'),
  at('stages/archive/2019/Older.md'),
  at('stages/archive/2019/q1/Deep.md'),
  at('stages/archive/2019/q1/jan/Deeper.md'),
  at('stages/archive/2019/q1/jan/w1/Deepest.md'),
  at('stages/active/Now.md'),
]
const FOLDERS = [
  { ...at('stages/.folder.md'), title: 'Stages' },
  { ...at('stages/archive/.folder.md'), title: 'Archive' },
  { ...at('stages/archive/2019/q1/.folder.md'), title: 'Q1' },
]

const create = vi.fn<(seed: NewPageSeed, name?: string) => Promise<string>>()
const openFolderPage = vi.fn()

let root: Root | null = null
let container: HTMLElement | null = null

function mount(text: string) {
  let parsed = parseViews(text)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() =>
    root?.render(
      <ViewsPane
        parsed={parsed}
        onChange={(next: ParsedViews) => {
          parsed = next
        }}
        root="/vault"
        folderPath="/vault/stages"
        records={RECORDS}
        folder={testFolderHost({ create, vaultRecords: RECORDS, vaultFolders: FOLDERS, openFolderPage })}
        onOpenFile={vi.fn()}
      />,
    ),
  )
  return container
}

/** Each header as `label@depth`, in table order. */
const headers = (el: ParentNode) =>
  [...el.querySelectorAll<HTMLElement>('.view-table__group-cell')].map((cell) => `${cell.querySelector('.view-group__value')!.textContent}@${cell.style.getPropertyValue('--depth')}`)
/** Each data row as `name@depth#n`. */
const rows = (el: ParentNode) =>
  [...el.querySelectorAll<HTMLElement>('td.view-table__name')].map((cell) => `${cell.textContent}@${cell.style.getPropertyValue('--depth')}#${cell.parentElement!.querySelector('.view-table__gutter')!.textContent}`)
const byLabel = <T extends HTMLElement>(el: ParentNode, label: string): T => {
  const n = el.querySelector<T>(`[aria-label="${label}"]`)
  if (!n) throw new Error(`no [aria-label="${label}"]`)
  return n
}

beforeEach(() => {
  groupStore.clear()
  create.mockReset()
  create.mockResolvedValue('/vault/stages/Untitled.md')
  openFolderPage.mockReset()
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

describe('a Table grouped by Folder with a Depth (YAZ-4918)', () => {
  it('Depth All: the subfolders nest inside their folder, a header at its tree depth, a row one deeper, never past four steps; a folder\'s own pages come first; the # restarts per section', () => {
    const el = mount(VIEW('        depth: all\n'))
    expect(headers(el)).toEqual(['Stages@0', 'active@0', 'Archive@0', '2019@1', 'Q1@2', 'jan@3', 'w1@4'])
    expect(rows(el)).toEqual(['Lead Gen@1#1', 'Now@1#1', 'Old@1#1', 'Older@2#1', 'Deep@3#1', 'Deeper@4#1', 'Deepest@4#1'])
    // Each header counts its whole branch.
    expect([...el.querySelectorAll('.view-group__count')].map((c) => c.textContent)).toEqual(['1', '1', '5', '4', '3', '2', '1'])
  })

  it('Depth 2 stops after the first subfolder: the deeper pages roll up into it, and the next folder page opens from its header', () => {
    const el = mount(VIEW('        depth: 2\n'))
    expect(headers(el)).toEqual(['Stages@0', 'active@0', 'Archive@0', '2019@1'])
    expect(rows(el)).toEqual(['Lead Gen@1#1', 'Now@1#1', 'Old@1#1', 'Older@2#1', 'Deep@2#2', 'Deeper@2#3', 'Deepest@2#4'])
    act(() => byLabel(el, 'Open folder page 2019').click())
    expect(openFolderPage).toHaveBeenCalledWith('/vault/stages/archive/2019')
  })

  it('a nested header\'s "+" is born in THAT folder, and collapsing a folder hides its whole branch, remembered by the folder\'s path', () => {
    const el = mount(VIEW('        depth: all\n'))
    act(() => byLabel(el, 'New page in group Q1').click())
    expect(create.mock.calls[0]).toEqual([{ properties: {}, folder: 'stages/archive/2019/q1' }, undefined])

    act(() => byLabel(el, 'Toggle group 2019').click())
    expect(headers(el)).toEqual(['Stages@0', 'active@0', 'Archive@0', '2019@1'])
    expect(rows(el)).toEqual(['Lead Gen@1#1', 'Now@1#1', 'Old@1#1'])
    expect([...groupStore.values()][0]).toEqual([groupPathKeyOf(['stages/archive', 'stages/archive/2019'])])
  })

  it('Full path: one flat header per folder, named by its path from the page with " › ", every row one step in', () => {
    const el = mount(VIEW('        depth: all\n        layout: path\n'))
    expect(headers(el)).toEqual(['Stages@0', 'active@0', 'Archive@0', 'Archive › 2019@0', 'Archive › 2019 › Q1@0', 'Archive › 2019 › Q1 › jan@0', 'Archive › 2019 › Q1 › jan › w1@0'])
    expect(rows(el).every((r) => r.includes('@1#1'))).toBe(true)
  })

  it('"Folder (All), then Status": the Status groups sit inside each deepest folder, on the next view level', () => {
    const el = mount(VIEW('        depth: all\n      - property: note.status\n'))
    // Every page here has no status: each deepest folder gets one "No value" group; a folder with subfolders keeps its own pages direct.
    expect(headers(el)).toEqual(['Stages@0', 'No value@1', 'active@0', 'No value@1', 'Archive@0', '2019@1', 'Q1@2', 'jan@3', 'w1@4', 'No value@4'])
    expect(rows(el)).toEqual(['Lead Gen@2#1', 'Now@2#1', 'Old@1#1', 'Older@2#1', 'Deep@3#1', 'Deeper@4#1', 'Deepest@4#1'])
  })
})
