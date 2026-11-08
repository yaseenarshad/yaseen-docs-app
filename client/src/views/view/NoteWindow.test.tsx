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
import { MAX_OPEN_WINDOWS, dropAllNoteWindows, dropNoteWindowsAt, keepNoteWindow, noteWindowKey, noteWindowMemory, openNoteWindow, renameNoteWindows } from './NoteWindow'

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
  dropAllNoteWindows()
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
    // The page actions end with the two pane opens; the table's Fill items (YAZ-4536) follow in their own group.
    const labels = menuItems().map((item) => item.textContent)
    expect(labels.slice(labels.indexOf('Open in right panel'), labels.indexOf('Open in right panel') + 2)).toEqual(['Open in right panel', 'Open in a window'])
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

  it('a folder page that unmounts and mounts again (a tab that sleeps) shows its card again on the same note', () => {
    mount(SORTED)
    openOn('B')
    click(button('Next row'))
    click(button('Unpin window'))
    act(() => root?.unmount())
    container?.remove()
    expect(card()).toBeNull()
    mount(SORTED)
    expect(shownPath()).toBe(path('D'))
    expect(count()).toBe('2 of 5')
    expect(currentRows()).toEqual(['D'])
    expect(button('Pin window').getAttribute('aria-pressed')).toBe('false')
    // A closed card is gone for good: its entry goes with it.
    click(button('Close window'))
    act(() => root?.unmount())
    container?.remove()
    mount(SORTED)
    expect(card()).toBeNull()
  })

  it('the card belongs to its view tab: another view shows none, and the card is back on its own tab', () => {
    mount(`${SORTED}  - type: table\n    name: U\n`)
    openOn('C')
    click([...document.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent === 'U')!)
    expect(card()).toBeNull()
    click([...document.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent === 'T')!)
    expect(shownPath()).toBe(path('C'))
  })

  it('the open cards are bounded: at most MAX_OPEN_WINDOWS, the oldest open out', () => {
    for (let i = 0; i <= MAX_OPEN_WINDOWS; i++) keepNoteWindow(noteWindowKey('t1', `/vault/p${i}`, 'T'), noteWindowMemory(`/vault/p${i}/n.md`))
    expect(openNoteWindow(noteWindowKey('t1', '/vault/p0', 'T'))).toBeUndefined()
    expect(openNoteWindow(noteWindowKey('t1', '/vault/p1', 'T'))?.path).toBe('/vault/p1/n.md')
    expect(openNoteWindow(noteWindowKey('t1', `/vault/p${MAX_OPEN_WINDOWS}`, 'T'))).toBeDefined()
  })

  it('two app tabs on one folder page each have their own card; closing one leaves the other (YAZ-4544, D17)', () => {
    const host = testFolderHost({ renderNoteEditor: (p) => <div className="stub-editor">{p}</div> })
    const pane = (tabId: string) => (
      <section className="editor" data-tab={tabId}>
        <ViewsPane parsed={parseViews(SORTED)} onChange={vi.fn()} root="/vault" folderPath="/vault/f" tabId={tabId} records={RECORDS} folder={{ ...host, vaultRecords: RECORDS }} onOpenFile={vi.fn()} />
      </section>
    )
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    draw = () => act(() => root?.render(<>{pane('t1')}{pane('t2')}</>))
    draw()
    const inTab = (tabId: string) => q<HTMLElement>(`[data-tab="${tabId}"]`)
    const cardIn = (tabId: string) => inTab(tabId).querySelector('.note-window')
    const openIn = (tabId: string, title: string) => {
      rightClick([...inTab(tabId).querySelectorAll<HTMLElement>('.view-table__name')].find((c) => c.textContent === title)!)
      click(menuItems().find((item) => item.textContent === 'Open in a window')!)
    }
    openIn('t1', 'A')
    expect(cardIn('t1')?.querySelector('.stub-editor')?.textContent).toBe(path('A'))
    expect(cardIn('t2')).toBeNull()
    openIn('t2', 'C')
    expect(cardIn('t1')?.querySelector('.stub-editor')?.textContent).toBe(path('A'))
    expect(cardIn('t2')?.querySelector('.stub-editor')?.textContent).toBe(path('C'))
    click(cardIn('t1')!.querySelector('[aria-label="Close window"]')!)
    expect(cardIn('t1')).toBeNull()
    expect(cardIn('t2')?.querySelector('.stub-editor')?.textContent).toBe(path('C'))
    // The right panel's folder page (no tab) is its own place too.
    expect(openNoteWindow(noteWindowKey(undefined, '/vault/f', 'T'))).toBeUndefined()
  })

  it('a retitle in the table\'s Name cell moves the card to the new path; a delete closes it (YAZ-4544)', () => {
    // The host stands in for App: main renames the file, and App's `file:renamed` calls `renameNoteWindows`.
    let setRecords: (next: IndexRecord[]) => void = () => {}
    const retitle = vi.fn((from: string, title: string) => {
      const to = `/vault/f/${title}.md`
      act(() => renameNoteWindows(from, to))
      setRecords(RECORDS.map((r) => (r.path === from ? { ...r, path: to, name: `${title}.md`, basename: title, title } : r)))
    })
    ;({ setRecords } = mount(SORTED, {}, testFolderHost({ retitle, renderNoteEditor: (p) => <div className="stub-editor">{p}</div> })))
    openOn('D')
    const cell = rowCell('D')
    act(() => {
      cell.click()
      cell.click()
      cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })
    draw()
    const input = q<HTMLInputElement>('.view-table__name input')
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'Dee')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => void input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })))
    draw()
    expect(retitle).toHaveBeenCalledExactlyOnceWith(path('D'), 'Dee')
    expect(shownPath()).toBe(path('Dee'))
    expect(card()!.querySelector('.cell-note-card__title')?.textContent).toBe('Dee')
    expect(count()).toBe('2 of 5')
    expect(currentRows()).toEqual(['Dee'])
    // A rename of the folder above it moves the card too.
    act(() => renameNoteWindows('/vault/f', '/vault/g'))
    expect(shownPath()).toBe('/vault/g/Dee.md')
    act(() => dropNoteWindowsAt('/vault/g/Dee.md'))
    draw()
    expect(card()).toBeNull()
    expect(openNoteWindow(noteWindowKey(undefined, '/vault/f', 'T'))).toBeUndefined()
  })

  it('a rename or a delete reaches a card whose tab sleeps: it shows again on the new path, or not at all (YAZ-4544)', () => {
    mount(SORTED)
    openOn('B')
    act(() => root?.unmount())
    container?.remove()
    renameNoteWindows(path('B'), path('Bee'))
    mount(SORTED)
    expect(shownPath()).toBe(path('Bee'))
    act(() => root?.unmount())
    container?.remove()
    dropNoteWindowsAt('/vault/f')
    mount(SORTED)
    expect(card()).toBeNull()
  })

  describe('the place, the size and the pin are remembered for the tab', () => {
    beforeEach(() => {
      vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200)
      vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800)
    })
    afterEach(() => vi.restoreAllMocks())

    it('a drag or a resize reads the folder page\'s size once, at the start: a mouse move reads no layout (YAZ-4544)', () => {
      mount(SORTED)
      openOn('A')
      const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200)
      const height = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800)
      for (const start of [q('.note-window__head'), q('.note-window [data-grip="se"]')]) {
        act(() => void start.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: 900, clientY: 30 })))
        const reads = width.mock.calls.length + height.mock.calls.length
        act(() => {
          for (let i = 1; i <= 20; i++) window.dispatchEvent(new MouseEvent('mousemove', { clientX: 900 - i * 5, clientY: 30 + i * 5 }))
        })
        expect(width.mock.calls.length + height.mock.calls.length).toBe(reads)
        act(() => void window.dispatchEvent(new MouseEvent('mouseup')))
      }
      expect(card()!.style.width).not.toBe('480px')
    })

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

describe('Open in a window in every folder view (YAZ-4547 D24)', () => {
  /** Grouped by status, sorted by name: A todo, B done, C todo, D done, E todo, so the groups' order is not the rows' order. */
  const grouped = (type: string) => `views:
  - type: ${type}
    name: V
    order:
      - file.name
    sort:
      - property: file.name
        direction: ASC
    groupBy:
      property: note.status
`
  const host = () => testFolderHost({ openRight: vi.fn(), renderNoteEditor: (p) => <div className="stub-editor">{p}</div> })
  const ITEM: Record<string, string> = { board: '.view-board__card', list: '.view-list__item', cards: '.view-card', calendar: '.view-cal__card' }
  const items = (type: string) => [...document.querySelectorAll<HTMLElement>(ITEM[type])]
  const itemOf = (type: string, p: string) => items(type).find((i) => i.dataset.hoverItem === p)!
  const marked = () => [...document.querySelectorAll<HTMLElement>('.view-item--current')].map((i) => i.dataset.hoverItem)
  function openItem(type: string, p: string): void {
    rightClick(itemOf(type, p))
    const labels = menuItems().map((item) => item.textContent)
    expect(labels[labels.indexOf('Open in right panel') + 1]).toBe('Open in a window')
    click(menuItems().find((item) => item.textContent === 'Open in a window')!)
  }
  /** Every note the card shows from where it opened to the end, by ›. */
  function walk(): (string | null)[] {
    const seen = [shownPath()]
    while (!button('Next row').disabled) {
      click(button('Next row'))
      seen.push(shownPath())
    }
    return seen
  }

  for (const type of ['board', 'list', 'cards']) {
    it(`${type}: the item opens the card, ‹ › follow the order shown through the groups, and the current item is marked`, () => {
      mount(grouped(type), {}, host())
      const shown = items(type).map((i) => i.dataset.hoverItem!)
      // Board: column by column, top to bottom; List and Cards: the order shown, through the groups.
      expect(shown).toHaveLength(5)
      expect(shown).not.toEqual(['A', 'B', 'C', 'D', 'E'].map(path))
      openItem(type, shown[0])
      expect(shownPath()).toBe(shown[0])
      expect(marked()).toEqual([shown[0]])
      expect(button('Previous row').disabled).toBe(true)
      expect(walk()).toEqual(shown)
      expect(count()).toBe('5 of 5')
      expect(marked()).toEqual([shown[4]])
      click(button('Previous row'))
      expect(marked()).toEqual([shown[3]])
      click(button('Close window'))
      expect(marked()).toEqual([])
    })
  }

  it('list: the items of a collapsed group are skipped', () => {
    mount(grouped('list'), {}, host())
    click([...document.querySelectorAll<HTMLButtonElement>('.view-group__toggle')].find((b) => b.getAttribute('aria-label')?.includes('done'))!)
    openItem('list', path('A'))
    expect(walk()).toEqual(['A', 'C', 'E'].map(path))
  })

  it('back on the Board tab from the Table tab, › steps through the board\'s order (the table leaves the link alone)', () => {
    mount(`views:
  - type: table
    name: T
${grouped('board').split('\n').slice(1).join('\n').replace('name: V', 'name: B')}`, {}, host())
    const tab = (name: string) => click([...document.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent === name)!)
    tab('B')
    const shown = items('board').map((i) => i.dataset.hoverItem!)
    openItem('board', shown[0])
    // Away to the table and back: the board's card shows again. A › with no render of the board reads its order.
    tab('T')
    // The tab click alone (no second render): the commit that unmounts the table is the last thing that ran.
    act(() => [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent === 'B')!.click())
    expect(shownPath()).toBe(shown[0])
    act(() => button('Next row').click())
    expect(shownPath()).toBe(shown[1])
    expect(marked()).toEqual([shown[1]])
  })

  describe('calendar', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date(2026, 11, 10, 12, 0))
    })
    afterEach(() => vi.useRealTimers())
    const dated = (name: string, due?: string): IndexRecord => ({ ...note(name, 0, 'todo'), properties: due === undefined ? {} : { due } })
    // Dec 3 has a bare date before a timed one in row order: the timed card comes first within the day.
    const CAL = [dated('A', '2026-12-03'), dated('B', '2026-12-03 09:00'), dated('C', '2026-12-01'), dated('D'), dated('E', '2026-12-09 14:00')]
    const CALENDAR = `views:
  - type: calendar
    name: V
`

    it('a card opens the window; ‹ › go day by day across the month, timed cards first, then "No date"; the current card is marked', () => {
      const { setRecords } = mount(CALENDAR, {}, host())
      setRecords(CAL)
      openItem('calendar', path('C'))
      expect(marked()).toEqual([path('C')])
      expect(walk()).toEqual(['C', 'B', 'A', 'E', 'D'].map(path))
      expect(marked()).toEqual([path('D')])
    })

    it('in Week, ‹ › go through the week on screen', () => {
      const { setRecords } = mount(`${CALENDAR}    calendarScale: week\n`, {}, host())
      setRecords(CAL)
      openItem('calendar', path('E'))
      expect(count()).toBe('1 of 2')
      expect(walk()).toEqual(['E', 'D'].map(path))
    })
  })
})
