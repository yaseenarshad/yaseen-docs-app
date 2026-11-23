/**
 * Column type icons (YAZ-4779 demo: "add icon for column types?"): each table header shows its column's type icon
 * before its name, its words in the hover box ("Number", "File field", "Formula"). Settings › Folder pages › Column
 * type icons (ViewsPane's `folderPages`) is on by default; a view can say otherwise (`columnTypeIcons`). Tables only. ViewsPane in jsdom.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_FOLDER_PAGES } from '@shared/types'
import { parseViews } from '../viewSchema'
import { ViewsPane } from '../ViewsPane'
import { testFolderHost } from '../testFolderHost'
import { TEST_RECORDS } from '../testRecords'
import type { FolderSettings } from '../folderSettings'

vi.mock('../../lib/storage', () => ({ storage: { getViewGroups: () => [], setViewGroups: () => undefined, getSettings: () => undefined } }))
;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  vi.useRealTimers()
})

const SETTINGS: FolderSettings = { columns: { priority: { kind: 'number' }, status: { kind: 'select', options: ['idea'] } }, formulas: { double: 'priority * 2' }, views: [], problems: [] }
function mount(yaml: string, fp = DEFAULT_FOLDER_PAGES) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() =>
    root!.render(
      <ViewsPane parsed={parseViews(yaml)} onChange={vi.fn()} root="/vault" folderPath="/vault/pillars.md" records={TEST_RECORDS} folder={testFolderHost({ settings: SETTINGS })} onOpenFile={vi.fn()} folderPages={fp} />,
    ),
  )
  return container
}
const view = (type = 'table', extra = '') => `views:\n  - type: ${type}\n    name: V\n    order:\n      - file.name\n      - note.priority\n      - note.status\n      - formula.double\n${extra}`
const icons = (el: ParentNode) => [...el.querySelectorAll<HTMLElement>('.view-table thead .view-table__type-icon')]

describe('YAZ-4779 demo: a type icon before each header name', () => {
  it('YAZ-4779 demo: on by default: one icon per header, before the name', () => {
    const el = mount(view())
    const heads = [...el.querySelectorAll<HTMLElement>('.view-table thead th:not(.view-table__gutter)')]
    expect(icons(el)).toHaveLength(4)
    for (const th of heads.slice(0, 4)) {
      const icon = th.querySelector('.view-table__type-icon')!
      expect(icon).not.toBeNull()
      expect(icon.querySelector('svg')).not.toBeNull()
    }
  })

  it('YAZ-4779 demo: hovering an icon names the type: File field, Number, Select, Formula', () => {
    vi.useFakeTimers()
    const el = mount(view())
    const words = icons(el).map((icon) => {
      act(() => void icon.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body })))
      act(() => void vi.advanceTimersByTime(400))
      const text = document.querySelector('.hover-tip[role="tooltip"]')?.textContent
      act(() => void icon.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })))
      return text
    })
    expect(words).toEqual(['File field', 'Number', 'Select', 'Formula'])
  })

  it('YAZ-4779 demo: the view own `columnTypeIcons: false` hides them; Settings off hides them in a view with no key', () => {
    expect(icons(mount(view('table', '    columnTypeIcons: false\n')))).toHaveLength(0)
    act(() => root!.unmount())
    container!.remove()
    expect(icons(mount(view(), { ...DEFAULT_FOLDER_PAGES, columnTypeIcons: false }))).toHaveLength(0)
    act(() => root!.unmount())
    container!.remove()
    expect(icons(mount(view('table', '    columnTypeIcons: true\n'), { ...DEFAULT_FOLDER_PAGES, columnTypeIcons: false }))).toHaveLength(4)
  })

  it('YAZ-4779 demo: Settings has it on by default', () => {
    expect(DEFAULT_FOLDER_PAGES.columnTypeIcons).toBe(true)
  })
})
