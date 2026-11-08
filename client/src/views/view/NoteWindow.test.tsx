/**
 * Open a row in a window (YAZ-4547, 5E D14-D17): the folder table's row menu opens a card over the folder page with an
 * editor on that note. ‹ › step through the table's visible data rows in display order; the pin keeps the card open
 * on an outside click; the card belongs to its tab's folder page. ViewsPane is mounted in jsdom with a stand-in editor
 * (`renderNoteEditor`); the real `Editor` in the card (twins, Properties panel) is proven in `editor/Editor.test.tsx`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IndexRecord } from '@shared/types'
import { type ParsedViews, parseViews } from '../viewSchema'
import { ViewsPane, type ViewsPaneProps } from '../ViewsPane'
import { testFolderHost } from '../testFolderHost'
import { setCellNotePinnedAtStart } from '../../editor/table/cellNoteCard'

vi.mock('../../lib/storage', () => ({ storage: { getViewGroups: () => [], setViewGroups: () => undefined, getSettings: () => undefined, getRoots: () => ['/vault'] } }))

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/** Five notes whose path order (A to E) is not their rank order, so the display order is the one under test. */
const note = (name: string, rank: number, status: string): IndexRecord => ({
  path: `/vault/f/${name}.md`,
  name: `${name}.md`,
  basename: name,
  title: name,
  folder: 'f',
  ext: 'md',
  size: 0,
  ctime: 0,
  mtime: 0,
  properties: { rank, status },
  aliases: [],
  tags: [],
  links: [],
  embeds: [],
})
const RECORDS = [note('A', 3, 'todo'), note('B', 1, 'done'), note('C', 5, 'todo'), note('D', 2, 'done'), note('E', 4, 'todo')]
const path = (name: string) => `/vault/f/${name}.md`

const SORTED = `views:
  - type: table
    name: T
    order:
      - file.name
      - note.rank
    sort:
      - property: note.rank
        direction: ASC
`
const GROUPED = `${SORTED}    groupBy:
      property: note.status
`

let root: Root | null = null
let container: HTMLElement | null = null
let draw: () => void = () => {}

/** The pane inside a tab layer's folder page (`section.editor`), as App mounts it; the stand-in editor names its path. */
function mount(text: string, props: Partial<ViewsPaneProps> = {}, host = testFolderHost({ renderNoteEditor: (p) => <div className="stub-editor">{p}</div> })) {
  let parsed = parseViews(text)
  let records = RECORDS
  const onOpenFile = vi.fn()
  const onChange = vi.fn((next: ParsedViews) => {
    parsed = next
  })
  container = document.createElement('div')
  container.className = 'tabstack__layer'
  document.body.appendChild(container)
  root = createRoot(container)
  draw = () =>
    act(() =>
      root?.render(
        <section className="editor">
          <div className="editor-host">
            <ViewsPane parsed={parsed} onChange={onChange} root="/vault" folderPath="/vault/f" records={records} folder={{ ...host, vaultRecords: RECORDS }} onOpenFile={onOpenFile} {...props} />
          </div>
        </section>,
      ),
    )
  draw()
  const setRecords = (next: IndexRecord[]) => {
    records = next
    draw()
  }
  return { el: container, onOpenFile, setRecords }
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  setCellNotePinnedAtStart(true)
})

const q = <T extends Element>(sel: string): T => {
  const n = document.querySelector<T>(sel)
  if (n === null) throw new Error(`missing ${sel}`)
  return n
}
const card = () => document.querySelector<HTMLElement>('.note-window')
const shownPath = () => card()?.querySelector('.stub-editor')?.textContent ?? null
const count = () => card()?.querySelector('.cell-note-card__count')?.textContent ?? null
const button = (label: string) => q<HTMLButtonElement>(`.note-window [aria-label="${label}"]`)
const menuItems = () => [...document.querySelectorAll<HTMLButtonElement>('.ctx-menu [role="menuitem"]')]

function click(el: Element): void {
  act(() => (el as HTMLElement).click())
  draw()
}
function rightClick(el: Element): void {
  act(() => void el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 })))
  draw()
}
function mouseDown(el: Element): void {
  act(() => void el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })))
}
/** The name cell of the row that shows `title`. */
const rowCell = (title: string): HTMLElement => [...document.querySelectorAll<HTMLElement>('.view-table__name')].find((c) => c.textContent === title)!
/** Open the card on `title` through the row menu. */
function openOn(title: string): void {
  rightClick(rowCell(title))
  click(menuItems().find((item) => item.textContent === 'Open in a window')!)
}
const currentRows = () => [...document.querySelectorAll('tr.view-table__row--current .view-table__name')].map((c) => c.textContent)

describe('Open in a window (YAZ-4547)', () => {
  it('the row menu item, after "Open in right panel", opens the card on that note; the table marks its row', () => {
    mount(SORTED, {}, testFolderHost({ openRight: vi.fn(), renderNoteEditor: (p) => <div className="stub-editor">{p}</div> }))
    rightClick(rowCell('D'))
    expect(menuItems().map((item) => item.textContent).slice(-2)).toEqual(['Open in right panel', 'Open in a window'])
    click(menuItems().find((item) => item.textContent === 'Open in a window')!)

    expect(card()).not.toBeNull()
    expect(shownPath()).toBe(path('D'))
    expect(card()!.querySelector('.cell-note-card__title')?.textContent).toBe('D')
    // D has rank 2: second in the display order.
    expect(count()).toBe('2 of 5')
    expect(currentRows()).toEqual(['D'])
    // The card renders in the tab's folder page, beside its scroller (not inside the zoomed views).
    expect(card()!.parentElement).toBe(q('section.editor'))
  })

  it('a host with no note editor offers no "Open in a window"', () => {
    mount(SORTED, {}, testFolderHost())
    rightClick(rowCell('A'))
    expect(menuItems().map((item) => item.textContent)).not.toContain('Open in a window')
  })

  it('‹ › follow the display order and are disabled at the ends', () => {
    mount(SORTED)
    openOn('B')
    expect(button('Previous row').disabled).toBe(true)
    const seen = [shownPath()]
    for (let i = 0; i < 4; i++) {
      click(button('Next row'))
      seen.push(shownPath())
    }
    expect(seen).toEqual(['B', 'D', 'A', 'E', 'C'].map(path))
    expect(count()).toBe('5 of 5')
    expect(button('Next row').disabled).toBe(true)
    expect(button('Previous row').disabled).toBe(false)
    expect(currentRows()).toEqual(['C'])
    click(button('Previous row'))
    expect(shownPath()).toBe(path('E'))
    expect(currentRows()).toEqual(['E'])
  })

  it('skip the rows of a collapsed group', () => {
    mount(GROUPED)
    // Collapse "done" (B, D): the visible data rows are A, E, C.
    click([...document.querySelectorAll<HTMLButtonElement>('.view-group__toggle')].find((b) => b.getAttribute('aria-label')?.includes('done'))!)
    openOn('A')
    expect(count()).toBe('1 of 3')
    click(button('Next row'))
    click(button('Next row'))
    expect(shownPath()).toBe(path('C'))
    expect(button('Next row').disabled).toBe(true)
  })

  it('Cmd+Alt+Down and Cmd+Alt+Up step; the order is read at each step', () => {
    const { setRecords } = mount(SORTED)
    openOn('B')
    act(() => void card()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', metaKey: true, altKey: true, bubbles: true, cancelable: true })))
    expect(shownPath()).toBe(path('D'))
    act(() => void card()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', code: 'ArrowUp', metaKey: true, altKey: true, bubbles: true, cancelable: true })))
    expect(shownPath()).toBe(path('B'))
    click(button('Next row'))
    // D leaves the list: the card stays on it, and › goes to the row now at its place.
    setRecords(RECORDS.filter((r) => r.path !== path('D')))
    expect(shownPath()).toBe(path('D'))
    click(button('Next row'))
    expect(shownPath()).toBe(path('A'))
    expect(count()).toBe('2 of 4')
  })

  it('a pinned card stays on an outside click; an unpinned card closes', () => {
    mount(SORTED)
    openOn('A')
    // The setting "Keep cell notes open (pinned)" is on by default: the card starts pinned.
    expect(button('Unpin window').getAttribute('aria-pressed')).toBe('true')
    mouseDown(rowCell('C'))
    draw()
    expect(card()).not.toBeNull()
    mouseDown(card()!.querySelector('.stub-editor')!)
    click(button('Unpin window'))
    expect(button('Pin window').getAttribute('aria-pressed')).toBe('false')
    // A click in the card does not close it.
    mouseDown(card()!.querySelector('.stub-editor')!)
    draw()
    expect(card()).not.toBeNull()
    mouseDown(document.body)
    draw()
    expect(card()).toBeNull()
    expect(currentRows()).toEqual([])
  })

  it('the pin starts from the setting, and Esc closes an unpinned card', () => {
    setCellNotePinnedAtStart(false)
    mount(SORTED)
    openOn('A')
    expect(button('Pin window').getAttribute('aria-pressed')).toBe('false')
    act(() => void card()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    draw()
    expect(card()).toBeNull()
  })

  it('× closes the card, and "Open in tab" opens the note', () => {
    const { onOpenFile } = mount(SORTED)
    openOn('A')
    click(button('Open in tab'))
    expect(onOpenFile).toHaveBeenCalledExactlyOnceWith(path('A'))
    openOn('A')
    click(button('Close window'))
    expect(card()).toBeNull()
  })

  it('after a tab switch and back, the card is still open on the same note', () => {
    setCellNotePinnedAtStart(false)
    const { el } = mount(SORTED)
    openOn('B')
    click(button('Next row'))
    // Another tab shows: this layer hides. A click in the other tab is no click outside THIS card.
    act(() => el.classList.add('tabstack__layer--hidden'))
    mouseDown(document.body)
    draw()
    act(() => el.classList.remove('tabstack__layer--hidden'))
    draw()
    expect(card()).not.toBeNull()
    expect(shownPath()).toBe(path('D'))
    expect(currentRows()).toEqual(['D'])
  })

  describe('the place, the size and the pin are remembered for the tab', () => {
    beforeEach(() => {
      vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200)
      vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800)
    })
    afterEach(() => vi.restoreAllMocks())

    it('a drag of the head moves the card, a reopen keeps the place and the pin, and a double click resets it', () => {
      mount(SORTED)
      openOn('A')
      // The default: 480px wide, at the right of the folder page.
      expect(card()!.style.width).toBe('480px')
      expect(card()!.style.left).toBe(`${1200 - 480 - 12}px`)
      const head = q<HTMLElement>('.note-window__head')
      act(() => {
        head.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: 900, clientY: 30 }))
        window.dispatchEvent(new MouseEvent('mousemove', { clientX: 600, clientY: 130 }))
        window.dispatchEvent(new MouseEvent('mouseup', { clientX: 600, clientY: 130 }))
      })
      expect(card()!.style.left).toBe(`${1200 - 480 - 12 - 300}px`)
      expect(card()!.style.top).toBe('112px')
      // A resize from the east grip: the width, never under 240.
      act(() => {
        q('.note-window [data-grip="e"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: 0, clientY: 0 }))
        window.dispatchEvent(new MouseEvent('mousemove', { clientX: -400, clientY: 0 }))
        window.dispatchEvent(new MouseEvent('mouseup', { clientX: -400, clientY: 0 }))
      })
      expect(card()!.style.width).toBe('240px')
      click(button('Unpin window'))
      click(button('Close window'))
      openOn('C')
      expect(card()!.style.left).toBe(`${1200 - 480 - 12 - 300}px`)
      expect(card()!.style.width).toBe('240px')
      expect(button('Pin window').getAttribute('aria-pressed')).toBe('false')
      act(() => void q('.note-window__head').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
      expect(card()!.style.width).toBe('480px')
      expect(card()!.style.left).toBe(`${1200 - 480 - 12}px`)
    })
  })
})
