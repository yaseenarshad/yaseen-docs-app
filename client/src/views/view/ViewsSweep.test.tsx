/**
 * The folder pages, views and calendar sweep (YAZ-5648, fixes 1, 2, 3, 10): the Calendar and Board card clicks share
 * one rule (YAZ-5582), Rolling's mini window steps through every dated card between its ends, and Hide weekends puts
 * the month name on the first shown day. ViewsPane is mounted in jsdom with a stand-in editor.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, useContext, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_FOLDER_PAGES, type FolderPagesSettings, type IndexRecord } from '@shared/types'
import { type ParsedViews, parseViews, serializeViews } from '../viewSchema'
import { ViewsPane, type ViewsPaneProps } from '../ViewsPane'
import { testFolderHost } from '../testFolderHost'
import { setCellNotePinnedAtStart } from '../../editor/table/cellNoteCard'
import { PropertiesOpenMemory } from '../../editor/FrontmatterPanel'
import { DocumentZoom, useKeptZoom } from '../../editor/DocumentZoom'
import { dropAllPageWindows } from './PageWindow'
import { openWindowOn } from '../../lib/osVerbs'

vi.mock('../../lib/osVerbs', async (load) => ({ ...(await load<typeof import('../../lib/osVerbs')>()), openWindowOn: vi.fn() }))
vi.mock('../../lib/storage', () => ({ storage: { getViewGroups: () => [], setViewGroups: () => undefined, getSettings: () => undefined, getRoots: () => ['/vault'] } }))

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const page = (name: string, status: string, due: string): IndexRecord => ({
  path: `/vault/f/${name}.md`,
  name: `${name}.md`,
  basename: name,
  title: name,
  folder: 'f',
  ext: 'md',
  size: 0,
  ctime: 0,
  mtime: 0,
  properties: { status, due },
  aliases: [],
  tags: [],
  links: [],
  embeds: [],
})
let RECORDS = [page('A', 'todo', '2026-12-03'), page('B', 'todo', '2026-12-04'), page('C', 'done', '2026-12-08')]
const path = (name: string) => `/vault/f/${name}.md`

const CALENDAR = `views:
  - type: calendar
    name: C
`
const BOARD = `views:
  - type: board
    name: B
    order:
      - file.name
    groupBy:
      property: note.status
`
const VIEWS = { calendar: CALENDAR, board: BOARD } as const
type Kind = keyof typeof VIEWS

/** The stand-in editor: its path, and a Properties toggle on the card's memory, as `FrontmatterPanel` uses it. */
function StubEditor({ p }: { p: string }) {
  const memory = useContext(PropertiesOpenMemory)
  const [open, setOpen] = useState(memory?.current ?? false)
  // The page zoom on the hook the real editors use (YAZ-5607).
  const [zoom, setZoom] = useKeptZoom(100)
  return (
    <div className="stub-editor" data-path={p} data-properties={open ? 'open' : 'closed'} data-zoom={zoom}>
      <DocumentZoom value={zoom} onChange={setZoom} />
      <button
        type="button"
        className="stub-properties"
        onClick={() => {
          if (memory !== null) memory.current = !open
          setOpen(!open)
        }}
      />
    </div>
  )
}

let root: Root | null = null
let container: HTMLElement | null = null
let draw: () => void = () => {}

function mount(kind: Kind, { text = VIEWS[kind], settings = {}, props = {} }: { text?: string; settings?: Partial<FolderPagesSettings>; props?: Partial<ViewsPaneProps> } = {}) {
  let parsed = parseViews(text)
  const onOpenFile = vi.fn()
  const openBackground = vi.fn()
  const openRight = vi.fn()
  const onChange = vi.fn((next: ParsedViews) => {
    parsed = next
    draw()
  })
  const host = testFolderHost({ renderPageEditor: (p) => <StubEditor p={p} />, openBackground, openRight })
  container = document.createElement('div')
  container.className = 'tabstack__layer'
  document.body.appendChild(container)
  root = createRoot(container)
  draw = () =>
    act(() =>
      root?.render(
        <section className="editor">
          <div className="editor-host">
            <ViewsPane parsed={parsed} onChange={onChange} root="/vault" folderPath="/vault/f" records={RECORDS} folder={{ ...host, vaultRecords: RECORDS }} onOpenFile={onOpenFile} folderPages={{ ...DEFAULT_FOLDER_PAGES, ...settings }} {...props} />
          </div>
        </section>,
      ),
    )
  draw()
  return { el: container, onOpenFile, openBackground, openRight, yaml: () => serializeViews(parsed) }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 11, 10, 12, 0))
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  setCellNotePinnedAtStart(true)
  dropAllPageWindows()
  localStorage.clear()
  vi.useRealTimers()
})

const cardOf = (kind: Kind, title: string): HTMLElement => {
  const sel = kind === 'calendar' ? '.view-cal__card' : '.view-board__card'
  const found = [...document.querySelectorAll<HTMLElement>(sel)].find((c) => c.textContent?.includes(title))
  if (found === undefined) throw new Error(`no card ${title}`)
  return found
}
const shownPath = () => document.querySelector<HTMLElement>('.page-window .stub-editor')?.dataset.path ?? null

/** A real click: the mousedown (an unpinned window hears it outside) and then the click, with the modifiers. */
function userClick(el: Element, mods: Partial<Pick<MouseEvent, 'metaKey' | 'altKey' | 'shiftKey' | 'ctrlKey'>> = {}): void {
  act(() => void el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, ...mods })))
  act(() => void el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...mods })))
  draw()
}

describe('views sweep (YAZ-5648)', () => {
  it('#1: ⇧⌘-click on a Calendar card opens a new window, as on a Board card (YAZ-5582 "one rule")', () => {
    for (const kind of ['board', 'calendar'] as Kind[]) {
      vi.mocked(openWindowOn).mockClear()
      const { openBackground } = mount(kind)
      userClick(cardOf(kind, 'A'), { shiftKey: true, metaKey: true })
      expect({ kind, windows: vi.mocked(openWindowOn).mock.calls.length, background: openBackground.mock.calls.length }).toEqual({ kind, windows: 1, background: 0 })
      act(() => root?.unmount())
      container?.remove()
    }
  })

  it('#2: Rolling × mini window: › and ‹ step through every dated card between the ends, not only the drawn weeks, and the window moves to its week', () => {
    const saved = RECORDS
    RECORDS = [page('Near', 'todo', '2026-12-15'), page('Far', 'todo', '2027-08-02'), { ...page('Undated', 'todo', ''), properties: { status: 'todo' } }]
    const count = () => document.querySelector('.page-window .cell-note-card__count')?.textContent
    try {
      mount('calendar', { text: `${CALENDAR}    calendarScale: rolling\n`, settings: { cardClickOpens: 'window' } })
      expect(document.querySelector('[data-week="2027-08-02"]')).toBeNull()
      userClick(cardOf('calendar', 'Near'))
      expect([shownPath(), count()]).toEqual([path('Near'), '1 of 3'])
      userClick(document.querySelector('.page-window [aria-label="Next row"]')!)
      expect([shownPath(), count()]).toEqual([path('Far'), '2 of 3'])
      // Far's week is drawn now, its card marked as the one the window shows.
      expect(cardOf('calendar', 'Far').classList.contains('view-item--current')).toBe(true)
      userClick(document.querySelector('.page-window [aria-label="Next row"]')!)
      expect([shownPath(), count()]).toEqual([path('Undated'), '3 of 3'])
      userClick(document.querySelector('.page-window [aria-label="Previous row"]')!)
      userClick(document.querySelector('.page-window [aria-label="Previous row"]')!)
      expect([shownPath(), count()]).toEqual([path('Near'), '1 of 3'])
      expect(cardOf('calendar', 'Near').classList.contains('view-item--current')).toBe(true)
    } finally {
      RECORDS = saved
    }
  })

  it('#3: Hide weekends: the month name goes on the first SHOWN day of each month (YAZ-5648 #3: Nov 2026 starts on a Sunday)', () => {
    // Rolling draws 13 weeks from the week of today: Oct 5 2026 – Jan 3 2027.
    vi.setSystemTime(new Date(2026, 9, 5, 12, 0))
    mount('calendar', { text: `${CALENDAR}    calendarScale: rolling\n    hideWeekends: true\n` })
    const firsts = [...document.querySelectorAll('.view-cal__date--first')].map((m) => m.textContent)
    expect(firsts).toEqual(['Nov 2', 'Dec 1', 'Jan 1'])
  })

  it('#10: Board: a click on a card TITLE selects the card too (YAZ-5582 "body or title"), so the arrows walk on from it, and opens it once', () => {
    const { openBackground } = mount('board')
    userClick(cardOf('board', 'A').querySelector('.view-board__title')!)
    expect(document.activeElement).toBe(cardOf('board', 'A'))
    expect(openBackground.mock.calls).toEqual([[path('A')]])
  })
})
