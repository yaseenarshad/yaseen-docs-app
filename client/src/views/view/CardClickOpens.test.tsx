/**
 * "Clicking a card opens" (YAZ-5582): a plain click on a Calendar or Board card opens its page in the mini window or a
 * background tab, as Settings › Folder pages says, or as the view's own choice says (Same as Settings · Mini window ·
 * Background tab). ⌘ a background tab, ⌥ the right panel and ⇧ nothing stay as they were, and Enter keeps the table's
 * keys. With a mini window open, a click on another card swaps the page in that same window, and the Properties panel's
 * open state (YAZ-3746 13Q) carries over. ViewsPane is mounted in jsdom with a stand-in editor that reads that memory.
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
import { type CardClick, openCardByClick } from '../../lib/openGesture'
import { cardClickOf } from '../viewDefaults'

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
const RECORDS = [page('A', 'todo', '2026-12-03'), page('B', 'todo', '2026-12-04'), page('C', 'done', '2026-12-08')]
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
const KINDS: Kind[] = ['calendar', 'board']
const withChoice = (text: string, choice: CardClick) => `${text}    clickOpens: ${choice}\n`

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
const windows = () => document.querySelectorAll('.page-window')
const shownPath = () => document.querySelector<HTMLElement>('.page-window .stub-editor')?.dataset.path ?? null
const propertiesShown = () => document.querySelector<HTMLElement>('.page-window .stub-editor')?.dataset.properties ?? null

/** A real click: the mousedown (an unpinned window hears it outside) and then the click, with the modifiers. */
function userClick(el: Element, mods: Partial<Pick<MouseEvent, 'metaKey' | 'altKey' | 'shiftKey' | 'ctrlKey'>> = {}): void {
  act(() => void el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, ...mods })))
  act(() => void el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...mods })))
  draw()
}
function press(el: HTMLElement, key: string, mods: Partial<KeyboardEventInit> = {}): void {
  act(() => void el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...mods })))
  draw()
}

describe('the one click rule (openCardByClick)', () => {
  const run = (mods: Partial<Pick<MouseEvent, 'metaKey' | 'altKey' | 'shiftKey' | 'ctrlKey'>>, choice: CardClick, withWindow = true) => {
    const doors = { onOpenFileRight: vi.fn(), onOpenFileBackground: vi.fn(), onOpenWindow: withWindow ? vi.fn() : undefined }
    const target = openCardByClick({ metaKey: false, altKey: false, shiftKey: false, ctrlKey: false, ...mods }, 'p', choice, doors)
    return { target, calls: [doors.onOpenWindow?.mock.calls.length ?? 0, doors.onOpenFileBackground.mock.calls.length, doors.onOpenFileRight.mock.calls.length] }
  }
  it('plain follows the choice; ⌘ a background tab, ⌥ the right panel, ⇧ and ⌃ nothing, whatever the choice', () => {
    expect(run({}, 'window')).toEqual({ target: 'window', calls: [1, 0, 0] })
    expect(run({}, 'background')).toEqual({ target: 'background', calls: [0, 1, 0] })
    for (const choice of ['window', 'background'] as const) {
      expect(run({ metaKey: true }, choice)).toEqual({ target: 'background', calls: [0, 1, 0] })
      expect(run({ altKey: true }, choice)).toEqual({ target: 'right', calls: [0, 0, 1] })
      expect(run({ shiftKey: true }, choice)).toEqual({ target: null, calls: [0, 0, 0] })
      expect(run({ ctrlKey: true }, choice)).toEqual({ target: null, calls: [0, 0, 0] })
    }
  })
  it('a host with no mini window opens a background tab for Mini window', () => {
    expect(run({}, 'window', false)).toEqual({ target: 'background', calls: [0, 1, 0] })
  })
  it("the view's own choice beats Settings; none follows Settings", () => {
    expect(cardClickOf({}, { cardClickOpens: 'window' })).toBe('window')
    expect(cardClickOf({}, { cardClickOpens: 'background' })).toBe('background')
    expect(cardClickOf({ clickOpens: 'background' }, { cardClickOpens: 'window' })).toBe('background')
    expect(cardClickOf({ clickOpens: 'window' }, { cardClickOpens: 'background' })).toBe('window')
  })
})

describe.each(KINDS)('%s: Clicking a card opens', (kind) => {
  it('the default (Settings › Background tab): a plain click opens a background tab, no mini window', () => {
    const { openBackground, onOpenFile } = mount(kind)
    userClick(cardOf(kind, 'A'))
    expect(openBackground).toHaveBeenCalledExactlyOnceWith(path('A'))
    expect(windows()).toHaveLength(0)
    expect(onOpenFile).not.toHaveBeenCalled()
  })

  it('Settings › Mini window: a plain click opens the mini window on the page, no tab', () => {
    const { openBackground, onOpenFile } = mount(kind, { settings: { cardClickOpens: 'window' } })
    userClick(cardOf(kind, 'A'))
    expect(windows()).toHaveLength(1)
    expect(shownPath()).toBe(path('A'))
    expect(openBackground).not.toHaveBeenCalled()
    expect(onOpenFile).not.toHaveBeenCalled()
  })

  it("the view's own Background tab beats Settings › Mini window, and its own Mini window beats Settings › Background tab", () => {
    const tab = mount(kind, { text: withChoice(VIEWS[kind], 'background'), settings: { cardClickOpens: 'window' } })
    userClick(cardOf(kind, 'A'))
    expect(tab.openBackground).toHaveBeenCalledExactlyOnceWith(path('A'))
    expect(windows()).toHaveLength(0)
    act(() => root?.unmount())
    container?.remove()

    const win = mount(kind, { text: withChoice(VIEWS[kind], 'window'), settings: { cardClickOpens: 'background' } })
    userClick(cardOf(kind, 'B'))
    expect(shownPath()).toBe(path('B'))
    expect(win.openBackground).not.toHaveBeenCalled()
  })

  it('the modifiers keep their meaning under either choice: ⌘ a background tab, ⌥ the right panel, ⇧ nothing; ⇧↩ the mini window, ↩ this tab', () => {
    for (const choice of ['window', 'background'] as const) {
      const { openBackground, openRight, onOpenFile } = mount(kind, { settings: { cardClickOpens: choice } })
      userClick(cardOf(kind, 'A'), { metaKey: true })
      expect(openBackground).toHaveBeenCalledExactlyOnceWith(path('A'))
      userClick(cardOf(kind, 'A'), { altKey: true })
      expect(openRight).toHaveBeenCalledExactlyOnceWith(path('A'))
      userClick(cardOf(kind, 'A'), { shiftKey: true })
      expect(windows()).toHaveLength(0)
      expect(openBackground).toHaveBeenCalledOnce()
      const card = cardOf(kind, 'B')
      act(() => card.focus())
      press(card, 'Enter')
      expect(onOpenFile).toHaveBeenCalledExactlyOnceWith(path('B'))
      press(cardOf(kind, 'B'), 'Enter', { shiftKey: true })
      expect(shownPath()).toBe(path('B'))
      act(() => root?.unmount())
      container?.remove()
      dropAllPageWindows()
    }
  })

  it.each([true, false])('Mini window, pinned %s: a click on another card swaps the page in the SAME window, and the Properties panel stays as it was', (pinned) => {
    setCellNotePinnedAtStart(pinned)
    const { openBackground } = mount(kind, { settings: { cardClickOpens: 'window' } })
    userClick(cardOf(kind, 'A'))
    expect(shownPath()).toBe(path('A'))
    expect(propertiesShown()).toBe('closed')
    const box = document.querySelector<HTMLElement>('.page-window')!.style.cssText
    // Open the Properties panel in the window, then click around the cards.
    act(() => document.querySelector<HTMLElement>('.page-window .stub-properties')!.click())
    expect(propertiesShown()).toBe('open')
    userClick(cardOf(kind, 'B'))
    expect(windows()).toHaveLength(1)
    expect(shownPath()).toBe(path('B'))
    expect(propertiesShown()).toBe('open')
    expect(document.querySelector<HTMLElement>('.page-window')!.style.cssText).toBe(box)
    userClick(cardOf(kind, 'C'))
    expect(windows()).toHaveLength(1)
    expect(shownPath()).toBe(path('C'))
    expect(propertiesShown()).toBe('open')
    // Closed again in C: the next card starts closed.
    act(() => document.querySelector<HTMLElement>('.page-window .stub-properties')!.click())
    userClick(cardOf(kind, 'A'))
    expect(shownPath()).toBe(path('A'))
    expect(propertiesShown()).toBe('closed')
    expect(openBackground).not.toHaveBeenCalled()
  })

  it('Mini window: a click on another card swaps the page in at the same page zoom (YAZ-5607)', () => {
    mount(kind, { settings: { cardClickOpens: 'window' } })
    const zoomShown = () => document.querySelector<HTMLElement>('.page-window .stub-editor')?.dataset.zoom ?? null
    const zoomOut = () => act(() => document.querySelector<HTMLElement>('.page-window [aria-label="Zoom out"]')!.click())
    userClick(cardOf(kind, 'A'))
    expect(zoomShown()).toBe('100')
    zoomOut()
    zoomOut()
    expect(zoomShown()).toBe('75')
    userClick(cardOf(kind, 'B'))
    expect(shownPath()).toBe(path('B'))
    expect(zoomShown()).toBe('75')
    // The Properties panel's memory is its own: still closed.
    expect(propertiesShown()).toBe('closed')
    userClick(cardOf(kind, 'C'))
    expect(zoomShown()).toBe('75')
  })

  it('Read only pages open the same way (a click reads, it writes nothing)', () => {
    const { openBackground, yaml } = mount(kind, { settings: { cardClickOpens: 'window' }, props: { readOnly: new Set([path('A')]) } })
    const before = yaml()
    userClick(cardOf(kind, 'A'))
    expect(shownPath()).toBe(path('A'))
    expect(openBackground).not.toHaveBeenCalled()
    expect(yaml()).toBe(before)
  })

  it("the view's settings row writes clickOpens: Same as Settings removes it", () => {
    const { yaml } = mount(kind)
    act(() => document.querySelector<HTMLElement>('.view-toolbar [aria-label="Columns and view"]')!.click())
    draw()
    act(() => document.querySelector<HTMLElement>('.view-popover--properties .view-menu__tab[data-tab="view"]')!.click())
    draw()
    const group = document.querySelector<HTMLElement>('[role="group"][aria-label="Clicking a card opens"]')
    expect(group).not.toBeNull()
    const choose = (text: string) => {
      act(() => [...group!.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === text)!.click())
    }
    expect([...group!.querySelectorAll('button')].map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([
      ['Same as Settings', 'true'],
      ['Mini window', 'false'],
      ['Background tab', 'false'],
    ])
    choose('Mini window')
    expect(yaml()).toContain('clickOpens: window')
    const again = () => document.querySelector<HTMLElement>('[role="group"][aria-label="Clicking a card opens"]')!
    act(() => [...again().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Background tab')!.click())
    expect(yaml()).toContain('clickOpens: background')
    act(() => [...again().querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Same as Settings')!.click())
    expect(yaml()).not.toContain('clickOpens')
  })
})
