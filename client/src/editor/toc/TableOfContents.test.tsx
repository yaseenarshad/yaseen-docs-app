/**
 * The table of contents (YAZ-2700): its five pure rules — `namesShow`, `namesRoom`, `shownRows`,
 * `pathLines`, `railPitch` — and the component, driven through a real `TocChannel` with a stand-in engine
 * (tocPlugin.test.ts proves the engine; this file proves what is drawn and what the mouse and the
 * keyboard do).
 *
 * The component is mounted the way CrepeHost mounts it: a sibling of `.editor-host` inside a
 * `section.editor`. jsdom lays nothing out, so a section is given the width a test wants.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, Profiler } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { TOC_DEFAULT_W, TOC_MAX_W, TOC_MIN_W, type ContentWidth, type TableOfContents as TableOfContentsMode } from '@shared/types'
import appCss from '../../app.css?inline'
import { COLUMN_MAX, foldable, MAX_ROWS, namesRoom, namesShow, NAMES_FLOOR, pathLines, railPitch, shownRows, TableOfContents, TEXT_FLOOR, tocFoldKeys, TOC_WIDTH, unfoldedRows } from './TableOfContents'
import tocCss from './toc.css?inline'
import { createTocChannel, type TocChannel, type TocLevel, type TocRow } from './tocChannel'
import { EDGE_PX } from './tocFrame'
import { outlineFoldKeyStem } from '../outline/outlineFoldKeys'
import { ZOOM_EVENT } from '../zoomRequest'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

describe('namesShow: names or lines', () => {
  it('auto shows the names only when the text column keeps its full width beside them', () => {
    expect(namesShow('auto', 1040 + TOC_WIDTH, 1040)).toBe(true)
    expect(namesShow('auto', 1040 + TOC_WIDTH - 1, 1040)).toBe(false)
    expect(namesShow('auto', 1440 + TOC_WIDTH, 1440)).toBe(true)
    expect(namesShow('auto', 1440 + TOC_WIDTH - 1, 1440)).toBe(false)
  })

  it('auto never shows them at content width full: the text takes all the room there is', () => {
    expect(namesShow('auto', 5000, COLUMN_MAX.full)).toBe(false)
  })

  it('pinned shows them down to the floor, whatever the content width', () => {
    for (const width of ['narrow', 'medium', 'full'] as ContentWidth[]) {
      expect(namesShow('pinned', NAMES_FLOOR, COLUMN_MAX[width])).toBe(true)
      expect(namesShow('pinned', NAMES_FLOOR - 1, COLUMN_MAX[width])).toBe(false)
    }
    // The right panel, 320px wide: lines, pinned or not.
    expect(namesShow('pinned', 320, COLUMN_MAX.narrow)).toBe(false)
    expect(namesShow('auto', 320, COLUMN_MAX.narrow)).toBe(false)
  })

  it('off shows neither look; the component draws nothing at all', () => {
    expect(namesShow('off', 5000, 1040)).toBe(false)
  })

  it('the column widths are app.css\'s --content-max-width values: a width that changes there must change here', () => {
    /** What the `.app` rule for one content width gives the text column: its px, or Infinity for `none`. */
    const columnMax = (selector: string): number => {
      const value = appCss.match(new RegExp(`${selector.replace(/[.[\]]/g, '\\$&')}\\s*\\{[^}]*--content-max-width:\\s*([^;]+);`, 's'))?.[1].trim()
      if (value === undefined) throw new Error(`no --content-max-width in ${selector}`)
      return value === 'none' ? Infinity : Number(value.replace(/px$/, ''))
    }
    expect(COLUMN_MAX).toEqual({
      narrow: columnMax('.app'),
      medium: columnMax(".app[data-content-width='medium']"),
      full: columnMax(".app[data-content-width='full']"),
    })
  })
})

describe('namesRoom: how wide the names column may get (YAZ-2752 D2, D3)', () => {
  it('pinned leaves the text 500px, auto takes the empty margin and no more, and neither goes past 480', () => {
    expect([TOC_MIN_W, TOC_WIDTH, TOC_MAX_W, TEXT_FLOOR]).toEqual([160, TOC_DEFAULT_W, 480, 500])
    // "Pin default" On: the text has 500px at the floor today (700 of note, 200 of names) and never less.
    expect([700, 820, 980, 981, 4000].map((note) => namesRoom('pinned', note, COLUMN_MAX.narrow))).toEqual([200, 320, 480, 480, 480])
    // The content width does not count for pinned names.
    expect(namesRoom('pinned', 900, COLUMN_MAX.full)).toBe(400)
    // "Pin default" Off, a narrow column (1040) and a medium one (1440).
    expect([1240, 1360, 1520, 1521, 4000].map((note) => namesRoom('auto', note, COLUMN_MAX.narrow))).toEqual([200, 320, 480, 480, 480])
    expect([1640, 1760, 1920, 4000].map((note) => namesRoom('auto', note, COLUMN_MAX.medium))).toEqual([200, 320, 480, 480])
    // The note's own scrollbar (11px in the real app) is not margin: a column that took it would narrow the text.
    // Where that leaves less than the 200px `namesShow` gave the names, the column is still 200, as it was before YAZ-2752.
    expect([1240, 1250, 1297, 1531, 1532].map((note) => namesRoom('auto', note, COLUMN_MAX.narrow, 11))).toEqual([200, 200, 246, 480, 480])
    // It does not count for pinned names: they are allowed to narrow the text.
    expect(namesRoom('pinned', 820, COLUMN_MAX.narrow, 11)).toBe(320)
  })

  it('wherever the names show there is room for 200px or more, so the narrowest column always fits', () => {
    for (const columnMax of [COLUMN_MAX.narrow, COLUMN_MAX.medium]) {
      // The first width at which each mode shows the names.
      expect(namesShow('auto', columnMax + TOC_WIDTH, columnMax)).toBe(true)
      expect(namesRoom('auto', columnMax + TOC_WIDTH, columnMax)).toBe(TOC_WIDTH)
      expect(namesShow('pinned', NAMES_FLOOR, columnMax)).toBe(true)
      expect(namesRoom('pinned', NAMES_FLOOR, columnMax)).toBe(TOC_WIDTH)
    }
    expect(TOC_MIN_W).toBeLessThanOrEqual(TOC_WIDTH)
  })
})

describe('shownRows: which rows, and where each stands in the full list', () => {
  const many = (level: TocLevel, count: number, name: string): TocRow[] => Array.from({ length: count }, (_, i) => ({ level, text: `${name} ${i}` }))

  it('200 or fewer: all of H1-H5, each with its own index', () => {
    const all: TocRow[] = [
      { level: 1, text: 'One' },
      { level: 2, text: 'Two' },
      { level: 3, text: 'Three' },
      { level: 4, text: 'Four' },
      { level: 5, text: 'Five' },
    ]
    expect(shownRows(all)).toEqual([
      { level: 1, text: 'One', index: 0 },
      { level: 2, text: 'Two', index: 1 },
      { level: 3, text: 'Three', index: 2 },
      { level: 4, text: 'Four', index: 3 },
      { level: 5, text: 'Five', index: 4 },
    ])
    expect(shownRows([...many(1, 50, 'a'), ...many(2, 50, 'b'), ...many(3, 50, 'c'), ...many(4, 25, 'd'), ...many(5, 25, 'e')])).toHaveLength(MAX_ROWS)
    expect(shownRows([])).toEqual([])
  })

  it('more than 200 of five levels: it drops H5, then H4, then H3, then H2, until 200 or fewer are left (YAZ-3051)', () => {
    const one = many(1, 20, 'one')
    const two = many(2, 40, 'two')
    const three = many(3, 60, 'three')
    const four = many(4, 70, 'four')
    // Levels of the rows a list shows, counted: level → how many.
    const counts = (rows: readonly TocRow[]): Record<number, number> => rows.reduce<Record<number, number>>((n, { level }) => ({ ...n, [level]: (n[level] ?? 0) + 1 }), {})
    // 190 rows of H1-H4 and 11 of H5: H5 goes, the rest stays.
    expect(counts(shownRows([...one, ...two, ...three, ...four, ...many(5, 11, 'five')]))).toEqual({ 1: 20, 2: 40, 3: 60, 4: 70 })
    // H1-H4 alone are 210: H4 goes too.
    expect(counts(shownRows([...one, ...two, ...three, ...four, ...many(4, 20, 'more'), ...many(5, 5, 'five')]))).toEqual({ 1: 20, 2: 40, 3: 60 })
    // H1-H3 alone are 220: H3 goes too.
    expect(counts(shownRows([...one, ...two, ...three, ...many(3, 100, 'more'), ...four, ...many(5, 5, 'five')]))).toEqual({ 1: 20, 2: 40 })
    // H1-H2 alone are 240: H1 only.
    expect(counts(shownRows([...one, ...many(2, 220, 'two'), ...three, ...four, ...many(5, 5, 'five')]))).toEqual({ 1: 20 })
    // The rows keep their document order and their index in the FULL list.
    const mixed = [{ level: 1, text: 'Top' } as TocRow, ...many(5, 201, 'deep'), { level: 4, text: 'Four' } as TocRow]
    expect(shownRows(mixed)).toEqual([
      { level: 1, text: 'Top', index: 0 },
      { level: 4, text: 'Four', index: 202 },
    ])
  })

  it('more than 200: H1-H2, and a row keeps its index in the FULL list', () => {
    const all = [{ level: 1, text: 'One' } as TocRow, ...many(3, 201, 'deep'), { level: 2, text: 'Two' } as TocRow]
    expect(shownRows(all)).toEqual([
      { level: 1, text: 'One', index: 0 },
      { level: 2, text: 'Two', index: 202 },
    ])
  })

  it('H1-H2 still more than 200: H1 only', () => {
    const all = [...many(2, 201, 'two'), { level: 1, text: 'One' } as TocRow, ...many(3, 5, 'three'), { level: 1, text: 'Other' } as TocRow]
    expect(shownRows(all)).toEqual([
      { level: 1, text: 'One', index: 201 },
      { level: 1, text: 'Other', index: 207 },
    ])
  })

  it('never more than 200 rows, even of H1 alone', () => {
    const rows = shownRows(many(1, 250, 'one'))
    expect(rows).toHaveLength(MAX_ROWS)
    expect(rows[MAX_ROWS - 1].index).toBe(MAX_ROWS - 1)
  })
})

describe('pathLines: the level lines from the current row up to its parents (YAZ-2762 D3, D7)', () => {
  /** Rows from their levels alone: the path reads nothing else of a row. */
  const levels = (...of: TocLevel[]): TocRow[] => of.map((level, i) => ({ level, text: `Row ${i}` }))
  // Row:               0  1  2  3  4  5  6  7  8
  const NOTE = levels(1, 2, 3, 3, 2, 3, 1, 3, 2)
  const NONE = NOTE.map(() => '')
  /** The path with row `at` current, the rows that are not on it left out: row → `data-path`. */
  const lit = (rows: readonly TocRow[], at: number): Record<number, string> => Object.fromEntries(pathLines(rows, at).flatMap((path, row) => (path === '' ? [] : [[row, path]])))

  it('a level 1 row has no path; a level 2 row has the line of its level 1 parent down to it, where the level piece goes to the name (`1t`)', () => {
    for (const at of [0, 6]) expect(pathLines(NOTE, at)).toEqual(NONE)
    expect(lit(NOTE, 1)).toEqual({ 1: '1t' })
    // Not the first child: the line of the parent passes the earlier sibling and the rows below it.
    expect(lit(NOTE, 4)).toEqual({ 1: '1', 2: '1', 3: '1', 4: '1t' })
    // The parent is the NEAREST level 1 above: row 6, not row 0. Row 7 between them is two levels in, and the line passes it.
    expect(lit(NOTE, 8)).toEqual({ 7: '1', 8: '1t' })
  })

  it('a level 3 row below a level 2 below a level 1: the first line stops at the level 2 parent (`1t`), the second goes from below that parent to the row (`2`, then `2t`)', () => {
    expect(lit(NOTE, 2)).toEqual({ 1: '1t', 2: '2t' })
    expect(lit(NOTE, 3)).toEqual({ 1: '1t', 2: '2', 3: '2t' })
    // The second level 2 of the part: the first line passes the full first one on its way down.
    expect(lit(NOTE, 5)).toEqual({ 1: '1', 2: '1', 3: '1', 4: '1t', 5: '2t' })
  })

  it('a level 3 row directly below a level 1: the first line down to it and no `t`, because the row is two levels in; the second line stays grey', () => {
    expect(lit(NOTE, 7)).toEqual({ 7: '1' })
    expect(lit(levels(1, 3, 3, 3), 3)).toEqual({ 1: '1', 2: '1', 3: '1' })
  })

  it('a row with no parent above it has no path, and a level 3 below a level 2 with no level 1 has the second line only', () => {
    // A note that starts at level 2 or at level 3, and a flat note of one level.
    for (const rows of [levels(2, 2, 2), levels(3, 3), levels(3, 2, 2), levels(1, 1, 1)]) {
      for (const at of rows.keys()) expect(pathLines(rows, at)).toEqual(rows.map(() => ''))
    }
    // A level 1 BELOW the row is not its parent.
    expect(lit(levels(2, 3, 1), 0)).toEqual({})
    expect(lit(levels(2, 3, 1), 1)).toEqual({ 1: '2t' })
    // One row, and no row: no list is drawn there, and the rule still answers.
    expect(pathLines(levels(2), 0)).toEqual([''])
    expect(pathLines([], 0)).toEqual([])
  })

  it('through levels 3 and 4 down to an H5 row: each line from below its parent to the next row on the path (YAZ-3051)', () => {
    // Row:            0  1  2  3  4
    const DEEP = levels(1, 2, 3, 4, 5)
    expect(lit(DEEP, 4)).toEqual({ 1: '1t', 2: '2t', 3: '3t', 4: '4t' })
    expect(lit(DEEP, 3)).toEqual({ 1: '1t', 2: '2t', 3: '3t' })
    // An H5 below two H4s: the line of the H3 passes the first H4 on its way to the second.
    expect(lit(levels(1, 2, 3, 4, 4, 5), 5)).toEqual({ 1: '1t', 2: '2t', 3: '3', 4: '3t', 5: '4t' })
    // A note that goes from H2 to H4 with no H3: the H4 row gets the line of its H2 and no `t`; an H5 under it gets the line of the H4.
    expect(lit(levels(1, 2, 4, 5), 2)).toEqual({ 1: '1t', 2: '2' })
    expect(lit(levels(1, 2, 4, 5), 3)).toEqual({ 1: '1t', 2: '2', 3: '4t' })
  })

  it('the path stops at the current row and starts below its top parent, for each row of a note', () => {
    for (const at of NOTE.keys()) {
      const path = pathLines(NOTE, at)
      expect(path).toHaveLength(NOTE.length)
      // Rows below the current row are never on the path.
      expect(path.slice(at + 1)).toEqual(NONE.slice(at + 1))
      // A parent row never carries its own line, and no level 1 row is ever on a path.
      NOTE.forEach((row, i) => {
        if (row.level === 1) expect(path[i]).toBe('')
        // A line passes only rows that are further in than it: line 1 at 20px, line 2 at 36px.
        if (path[i] !== '') expect(Number(path[i][0])).toBeLessThan(row.level)
        // The path arrives (`t`) only at the name ONE level in from the line.
        if (path[i].endsWith('t')) expect(row.level).toBe(Number(path[i][0]) + 1)
      })
    }
  })
})

describe('railPitch: the rail must fit', () => {
  it('10px a line while there is room', () => {
    expect(railPitch(600, 12)).toEqual({ pitch: 10, fits: true })
    expect(railPitch(600, 60)).toEqual({ pitch: 10, fits: true })
  })

  it('tighter when there is not, down to 4px', () => {
    expect(railPitch(600, 100)).toEqual({ pitch: 6, fits: true })
    expect(railPitch(600, 150)).toEqual({ pitch: 4, fits: true })
  })

  it('at 4px and still too long: it does not fit, and the component clips it', () => {
    expect(railPitch(600, 200)).toEqual({ pitch: 4, fits: false })
    expect(railPitch(0, 5)).toEqual({ pitch: 4, fits: false })
  })
})

// ---------- the component ----------

const HEADINGS: TocRow[] = [
  { level: 1, text: 'Part 1' },
  { level: 2, text: 'Section A' },
  { level: 3, text: 'Deep dive' },
  { level: 2, text: 'Section B' },
  { level: 1, text: 'Part 2' },
]

interface Mounted {
  root: Root
  section: HTMLElement
  scroller: HTMLElement
  mountEl: HTMLElement
  channel: TocChannel
  jump: ReturnType<typeof vi.fn>
  current: ReturnType<typeof vi.fn>
  onChangeMode: ReturnType<typeof vi.fn>
  onChangeWidth: ReturnType<typeof vi.fn>
  onReturnFocus: ReturnType<typeof vi.fn>
  onChangeFolds: ReturnType<typeof vi.fn>
  onChangeZoom: ReturnType<typeof vi.fn>
  /** How many times React has committed the table of contents: a render that drew nothing new does not count, and neither does a write to the DOM by hand. */
  commits: () => number
  /** `saved` is the width setting; it stays what it was when left out. */
  render: (mode: TableOfContentsMode, contentWidth?: ContentWidth, saved?: number) => void
}

const mounts: Mounted[] = []

/**
 * CrepeHost's DOM: `section.editor` > `.editor-host` > `.editor-mount`, the table of contents beside
 * the scroller. `width` is the section's; `saved` is the width setting of the names column.
 */
function mount(mode: TableOfContentsMode, headings: readonly TocRow[] = HEADINGS, width = 0, saved = TOC_DEFAULT_W, folds: readonly string[] = [], zoom = 100): Mounted {
  const section = document.createElement('section')
  section.className = 'editor'
  const scroller = document.createElement('div')
  scroller.className = 'editor-host'
  const mountEl = document.createElement('div')
  mountEl.className = 'editor-mount'
  mountEl.tabIndex = -1
  scroller.appendChild(mountEl)
  const slot = document.createElement('div')
  section.append(scroller, slot)
  document.body.appendChild(section)
  Object.defineProperty(section, 'clientWidth', { configurable: true, value: width })

  const channel = createTocChannel()
  const jump = vi.fn()
  const current = vi.fn(() => 0)
  channel.bind({ jump, current, rescan: vi.fn() })
  channel.publish(headings)
  const onChangeMode = vi.fn()
  const onChangeWidth = vi.fn()
  const onReturnFocus = vi.fn()
  const onChangeFolds = vi.fn()
  const onChangeZoom = vi.fn()
  const root = createRoot(slot)
  // One ref for the life of the mount, as CrepeHost's is: a new one per render would run every effect that reads it again.
  const hostRef = { current: mountEl }
  let commits = 0
  let savedNow = saved
  const render = (next: TableOfContentsMode, contentWidth: ContentWidth = 'narrow', nextSaved = savedNow): void => {
    savedNow = nextSaved
    act(() => {
      root.render(
        <Profiler id="toc" onRender={() => void (commits += 1)}>
          <TableOfContents channel={channel} mode={next} contentWidth={contentWidth} onChangeMode={onChangeMode} width={nextSaved} onChangeWidth={onChangeWidth} hostRef={hostRef} onReturnFocus={onReturnFocus} folds={folds} onChangeFolds={onChangeFolds} zoom={zoom} onChangeZoom={onChangeZoom} />
        </Profiler>,
      )
    })
  }
  render(mode)
  const mounted = { root, section, scroller, mountEl, channel, jump, current, onChangeMode, onChangeWidth, onReturnFocus, onChangeFolds, onChangeZoom, commits: () => commits, render }
  mounts.push(mounted)
  return mounted
}

/** The timers and the clock the component reads (`performance.now`), and nothing else: React's own scheduling stays real. */
const fakeClock = (): void => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
}

afterEach(() => {
  vi.useRealTimers()
  for (const m of mounts.splice(0)) {
    act(() => m.root.unmount())
    m.section.remove()
  }
})

const nav = (m: Mounted): HTMLElement | null => m.section.querySelector('nav.toc')
const names = (m: Mounted): HTMLButtonElement[] => [...m.section.querySelectorAll<HTMLButtonElement>('.toc__name')]
const lines = (m: Mounted): HTMLElement[] => [...m.section.querySelectorAll<HTMLElement>('.toc__line')]
const rail = (m: Mounted): HTMLButtonElement => {
  const button = m.section.querySelector<HTMLButtonElement>('.toc__rail')
  if (!button) throw new Error('no rail')
  return button
}
// A closed card stays mounted for its fade-out (`data-leaving`): that one is not an open card.
const card = (m: Mounted): HTMLElement | null => m.section.querySelector('.toc__card:not([data-leaving])')
const click = (el: HTMLElement): void => act(() => el.click())
const buttonNamed = (m: Mounted, name: string): HTMLButtonElement | undefined => [...m.section.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === name)

/** ⌘J as the window capture listener sees it: dispatched from wherever focus stands. */
const pressCmdJ = (target: EventTarget = document.body): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key: 'j', metaKey: true, bubbles: true, cancelable: true })
  act(() => {
    target.dispatchEvent(event)
  })
  return event
}
const keyOn = (el: Element, key: string): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  act(() => {
    el.dispatchEvent(event)
  })
  return event
}
const scrollFrame = async (m: Mounted): Promise<void> => {
  await act(async () => {
    m.scroller.dispatchEvent(new Event('scroll'))
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
  })
}

describe('which notes show one', () => {
  it('renders nothing under two headings', () => {
    expect(nav(mount('auto', []))).toBeNull()
    expect(nav(mount('auto', [HEADINGS[0]]))).toBeNull()
    expect(nav(mount('pinned', [HEADINGS[0]], 1600))).toBeNull()
  })

  it('renders at two headings, as a nav named "Table of contents"', () => {
    const m = mount('auto', HEADINGS.slice(0, 2))
    expect(nav(m)?.getAttribute('aria-label')).toBe('Table of contents')
    expect(lines(m)).toHaveLength(2)
  })

  it('renders nothing when the setting is off, at any width', () => {
    expect(nav(mount('off'))).toBeNull()
    expect(nav(mount('off', HEADINGS, 1600))).toBeNull()
  })

  it('renders nothing while the channel says hidden, and comes back when it does not', () => {
    const m = mount('auto')
    expect(nav(m)).not.toBeNull()
    act(() => m.channel.setHidden(true))
    expect(nav(m)).toBeNull()
    act(() => m.channel.setHidden(false))
    expect(nav(m)).not.toBeNull()
  })

  it('a note whose second heading is typed later gets one then; one that loses it, loses it', () => {
    const m = mount('auto', [HEADINGS[0]])
    expect(nav(m)).toBeNull()
    act(() => m.channel.publish(HEADINGS.slice(0, 2)))
    expect(nav(m)).not.toBeNull()
    act(() => m.channel.publish([HEADINGS[1]]))
    expect(nav(m)).toBeNull()
  })

  it('a setting that goes off takes it away without a remount', () => {
    const m = mount('auto')
    m.render('off')
    expect(nav(m)).toBeNull()
    m.render('auto')
    expect(nav(m)).not.toBeNull()
  })
})

describe('lines: the rail', () => {
  it('a narrow note shows lines — no data-names, no names until the card opens', () => {
    const m = mount('auto', HEADINGS, 320)
    expect(nav(m)?.hasAttribute('data-names')).toBe(false)
    expect(lines(m).map((line) => line.dataset.level)).toEqual(['1', '2', '3', '2', '1'])
    expect(names(m)).toHaveLength(0)
    expect(card(m)).toBeNull()
  })

  it('reading progress: lines above the current one are read, the current one is marked, the rest are neither', async () => {
    const m = mount('auto')
    m.current.mockReturnValue(2)
    await scrollFrame(m)
    expect(lines(m).map((line) => (line.hasAttribute('data-current') ? 'current' : line.hasAttribute('data-read') ? 'read' : 'ahead'))).toEqual(['read', 'read', 'current', 'ahead', 'ahead'])
  })

  it('a click on the rail opens the card with the same names, and its header says what it is', () => {
    const m = mount('auto')
    expect(rail(m).getAttribute('aria-expanded')).toBe('false')
    click(rail(m))
    expect(rail(m).getAttribute('aria-expanded')).toBe('true')
    expect(card(m)?.querySelector('.toc__title')?.textContent).toBe('Table of contents')
    expect(names(m).map((name) => `${name.dataset.level} ${name.textContent}`)).toEqual(['1 Part 1', '2 Section A', '3 Deep dive', '2 Section B', '1 Part 2'])
  })

  it('a second click closes it — once the opening click is behind it', () => {
    fakeClock()
    const m = mount('auto')
    click(rail(m))
    // Right after the open (the mouse opened it on its way to the click): the card stays.
    click(rail(m))
    expect(card(m)).not.toBeNull()
    vi.advanceTimersByTime(400)
    click(rail(m))
    expect(card(m)).toBeNull()
    // It fades out rather than vanishing: the closed card stays 140 ms as `data-leaving`, then it is gone.
    expect(m.section.querySelector('.toc__card[data-leaving]')).not.toBeNull()
    act(() => {
      vi.advanceTimersByTime(140)
    })
    expect(m.section.querySelector('.toc__card')).toBeNull()
  })

  it('the mouse on the rail opens the card; leaving closes it after the grace, not before', () => {
    fakeClock()
    const m = mount('auto')
    const hover = m.section.querySelector<HTMLElement>('.toc__hover')!
    act(() => {
      hover.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    expect(card(m)).not.toBeNull()
    act(() => {
      hover.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }))
    })
    act(() => {
      vi.advanceTimersByTime(199)
    })
    expect(card(m)).not.toBeNull()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(card(m)).toBeNull()
  })

  it('"Pin" sets the mode to pinned — offered only where the names would fit', () => {
    const wide = mount('auto', HEADINGS, 900)
    click(rail(wide))
    const keep = buttonNamed(wide, 'Pin')
    expect(keep).toBeDefined()
    click(keep!)
    expect(wide.onChangeMode).toHaveBeenCalledWith('pinned')

    const narrow = mount('auto', HEADINGS, 320)
    click(rail(narrow))
    expect(card(narrow)).not.toBeNull()
    expect(buttonNamed(narrow, 'Pin')).toBeUndefined()
  })

  it('pinned in a note too narrow for names: lines still, and neither "Pin" nor "Unpin" in the card', () => {
    const m = mount('pinned', HEADINGS, 320)
    expect(nav(m)?.hasAttribute('data-names')).toBe(false)
    click(rail(m))
    expect(buttonNamed(m, 'Pin')).toBeUndefined()
    expect(buttonNamed(m, 'Unpin')).toBeUndefined()
  })
})

describe('a scroll of the note', () => {
  const wheel = (m: Mounted, init: WheelEventInit = { deltaY: 40 }): void =>
    act(() => {
      m.scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true, ...init }))
    })

  it('a turn of the wheel over the note opens no card, in lines mode and in names mode; the current line still moves (YAZ-2886)', async () => {
    const m = mount('auto')
    wheel(m, { deltaY: 400 })
    m.current.mockReturnValue(3)
    await scrollFrame(m)
    expect(card(m)).toBeNull()
    expect(rail(m).getAttribute('aria-expanded')).toBe('false')
    expect(lines(m).findIndex((line) => line.hasAttribute('data-current'))).toBe(3)
    const wide = mount('auto', HEADINGS, 1300)
    wheel(wide, { deltaY: 400 })
    expect(card(wide)).toBeNull()
  })

  it('a scroll with no wheel — typing at the bottom of the window, a jump — opens nothing', async () => {
    const m = mount('auto')
    await scrollFrame(m)
    expect(card(m)).toBeNull()
  })

  describe('the path follows the wheel: data-reading on the nav (YAZ-2762 D8)', () => {
    const reading = (m: Mounted): boolean => nav(m)!.hasAttribute('data-reading')
    /** A mount starts ONE timer of its own, the 140 ms a closed card stays for its fade. Past it, each timer that is left is the wheel's. */
    const mountAtRest = (...args: Parameters<typeof mount>): Mounted => {
      const m = mount(...args)
      act(() => {
        vi.advanceTimersByTime(140)
      })
      expect(vi.getTimerCount()).toBe(0)
      return m
    }

    it('a turn of the wheel over the note sets it at once and renders nothing; ONE timer serves the burst; it goes 1500 ms after the LAST turn, and the next turn sets it again', () => {
      fakeClock()
      const m = mountAtRest('pinned', HEADINGS, 900)
      expect(reading(m)).toBe(false)
      const commits = m.commits()
      wheel(m)
      expect(reading(m)).toBe(true)
      // The turns continue, down and up: each one only stamps the time.
      for (let turn = 0; turn < 5; turn++) {
        act(() => {
          vi.advanceTimersByTime(200)
        })
        wheel(m, { deltaY: turn % 2 === 0 ? 3 : -3 })
      }
      expect(vi.getTimerCount()).toBe(1)
      // 1000 ms after the first turn, the last: the first turn's 1500 ms are over at 500 ms from here.
      act(() => {
        vi.advanceTimersByTime(1499)
      })
      expect(reading(m)).toBe(true)
      act(() => {
        vi.advanceTimersByTime(1)
      })
      expect(reading(m)).toBe(false)
      expect(vi.getTimerCount()).toBe(0)
      // The attribute is written on the element: not one render from the first turn to the end of the linger.
      expect(m.commits()).toBe(commits)
      wheel(m, { deltaY: -40 })
      expect(reading(m)).toBe(true)
      act(() => {
        vi.advanceTimersByTime(1500)
      })
      expect(reading(m)).toBe(false)
    })

    it('above the rail a turn of the wheel sets the path and opens no card; the path goes 1500 ms after the last turn', () => {
      fakeClock()
      const m = mount('auto')
      wheel(m)
      expect([reading(m), card(m) !== null]).toEqual([true, false])
      act(() => {
        vi.advanceTimersByTime(1499)
      })
      expect(reading(m)).toBe(true)
      act(() => {
        vi.advanceTimersByTime(1)
      })
      expect([reading(m), card(m) !== null]).toEqual([false, false])
    })

    it('a sideways turn, a pinch, a scroll with no wheel, a key and a press do not set it — and do not keep it', async () => {
      fakeClock()
      const m = mountAtRest('pinned', HEADINGS, 900)
      const notReading = async (): Promise<void> => {
        wheel(m, { deltaX: 40, deltaY: 0 })
        wheel(m, { deltaY: 40, ctrlKey: true })
        // Typing at the bottom of the window and a jump scroll the note; Page Down and a drag of the scrollbar are a key and a press.
        await scrollFrame(m)
        keyOn(m.scroller, 'PageDown')
        act(() => {
          m.scroller.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
        })
      }
      await notReading()
      expect(reading(m)).toBe(false)
      expect(vi.getTimerCount()).toBe(0)

      wheel(m)
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      await notReading()
      act(() => {
        vi.advanceTimersByTime(499)
      })
      expect(reading(m)).toBe(true)
      act(() => {
        vi.advanceTimersByTime(1)
      })
      expect(reading(m)).toBe(false)
    })

    it('a wheel over the table of contents that moves the NOTE sets it by the same rule — beside the list, and on a list that fits — and one that scrolls the list itself does not', () => {
      fakeClock()
      const m = mountAtRest('pinned', HEADINGS, 900)
      const wheelOver = (el: Element, init: WheelEventInit = { deltaY: 40 }): void =>
        act(() => {
          el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, ...init }))
        })
      const list = m.section.querySelector<HTMLElement>('.toc__names')!
      const unpin = buttonNamed(m, 'Unpin')!
      // A list longer than its box keeps the wheel and the note stays: the mouse is on the list, and toc.css's hover rule shows the lines there.
      Object.defineProperties(list, { scrollHeight: { configurable: true, value: 900 }, clientHeight: { configurable: true, value: 300 } })
      wheelOver(names(m)[1])
      // A sideways turn and a pinch move nothing, here as over the note.
      wheelOver(unpin, { deltaX: 40, deltaY: 0 })
      wheelOver(unpin, { deltaY: 40, ctrlKey: true })
      expect([m.scroller.scrollTop, reading(m), vi.getTimerCount()]).toEqual([0, false, 0])
      // Beside the list there is no list to scroll: the note moves, and the scroller hears no wheel of its own.
      const commits = m.commits()
      wheelOver(unpin)
      expect([m.scroller.scrollTop, reading(m), vi.getTimerCount()]).toEqual([40, true, 1])
      // A list that fits lets the note move too. It is the same burst: the one timer, 1500 ms after the LAST turn.
      Object.defineProperties(list, { scrollHeight: { configurable: true, value: 300 } })
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      wheelOver(names(m)[1])
      expect([m.scroller.scrollTop, vi.getTimerCount()]).toEqual([80, 1])
      act(() => {
        vi.advanceTimersByTime(1499)
      })
      expect(reading(m)).toBe(true)
      act(() => {
        vi.advanceTimersByTime(1)
      })
      expect([reading(m), vi.getTimerCount(), m.commits()]).toEqual([false, 0, commits])
    })

    it('a table of contents that goes away while the path shows clears its timer and its attribute — a bullet zoom, the setting off, the editor closed — and comes back with no attribute; names that give way to the rail keep both to the end of the linger', () => {
      fakeClock()
      const zoomed = mountAtRest('pinned', HEADINGS, 900)
      wheel(zoomed)
      const gone = nav(zoomed)!
      expect(gone.hasAttribute('data-reading')).toBe(true)
      act(() => zoomed.channel.setHidden(true))
      expect(vi.getTimerCount()).toBe(0)
      // The cleanup kept the element itself: React's ref to it is empty by then.
      expect([gone.isConnected, gone.hasAttribute('data-reading')]).toEqual([false, false])
      act(() => zoomed.channel.setHidden(false))
      expect(reading(zoomed)).toBe(false)
      // The listener is a new one, and it works: a turn sets the attribute again.
      wheel(zoomed)
      expect(reading(zoomed)).toBe(true)
      zoomed.render('off')
      expect(vi.getTimerCount()).toBe(0)
      zoomed.render('pinned')
      expect(reading(zoomed)).toBe(false)

      // The names give way to the rail — "Unpin" here; a window that gets narrow does the same. The nav and
      // its listener stay, so the timer still takes the attribute away, and it opens no card on its way.
      const unpinned = mountAtRest('pinned', HEADINGS, 900)
      wheel(unpinned)
      const kept = nav(unpinned)
      unpinned.render('auto')
      expect([nav(unpinned) === kept, kept?.hasAttribute('data-names'), reading(unpinned), vi.getTimerCount()]).toEqual([true, false, true, 1])
      act(() => {
        vi.advanceTimersByTime(1500)
      })
      expect([reading(unpinned), card(unpinned) !== null, vi.getTimerCount()]).toEqual([false, false, 0])

      const closed = mountAtRest('auto')
      wheel(closed)
      expect([reading(closed), card(closed) !== null]).toEqual([true, false])
      act(() => closed.root.unmount())
      // The ONE timer of the path is gone: a clock that runs on has nothing to do.
      expect(vi.getTimerCount()).toBe(0)
      expect(() => vi.advanceTimersByTime(5000)).not.toThrow()
    })
  })
})

describe('the wheel over the table of contents moves ONE thing', () => {
  const wheelOver = (el: Element, init: WheelEventInit = { deltaY: 30 }): void =>
    act(() => {
      el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, ...init }))
    })

  it('a list that fits lets the note scroll, by the wheel’s own distance; a list longer than its box keeps the wheel, and the note stays', () => {
    const m = mount('pinned', HEADINGS, 900)
    const list = m.section.querySelector<HTMLElement>('.toc__names')!
    wheelOver(names(m)[1])
    expect(m.scroller.scrollTop).toBe(30)
    // A mouse wheel that counts in lines: 16px a line.
    wheelOver(names(m)[1], { deltaY: 3, deltaMode: 1 })
    expect(m.scroller.scrollTop).toBe(78)
    // A sideways turn and a pinch move nothing.
    wheelOver(names(m)[1], { deltaX: 30, deltaY: 0 })
    wheelOver(names(m)[1], { deltaY: 30, ctrlKey: true })
    expect(m.scroller.scrollTop).toBe(78)
    Object.defineProperties(list, { scrollHeight: { configurable: true, value: 900 }, clientHeight: { configurable: true, value: 300 } })
    wheelOver(names(m)[1])
    wheelOver(names(m)[4], { deltaY: -30 })
    expect(m.scroller.scrollTop).toBe(78)
    // Beside the list — "Unpin", the column's own padding — there is no list to scroll: the note moves.
    wheelOver(buttonNamed(m, 'Unpin')!)
    expect(m.scroller.scrollTop).toBe(108)
  })

  it('the note’s own move by that wheel lets go of a jump’s hold, as a wheel over the note does', async () => {
    const m = mount('pinned', HEADINGS, 900)
    m.current.mockReturnValue(4)
    click(names(m)[3])
    await scrollFrame(m)
    expect(names(m)[3].getAttribute('aria-current')).toBe('true')
    wheelOver(names(m)[3])
    await scrollFrame(m)
    expect(names(m)[4].getAttribute('aria-current')).toBe('true')
  })
})

describe('names: the column', () => {
  it('auto with room for the text column and the names: data-names, the names at once, no button', () => {
    const m = mount('auto', HEADINGS, 1040 + TOC_WIDTH)
    expect(nav(m)?.hasAttribute('data-names')).toBe(true)
    expect(names(m).map((name) => name.textContent)).toEqual(['Part 1', 'Section A', 'Deep dive', 'Section B', 'Part 2'])
    expect(lines(m)).toHaveLength(0)
    expect(m.section.querySelector('.toc__pin:not(.toc__pin--all)')).toBeNull()
  })

  it('auto one pixel short of that: lines', () => {
    expect(nav(mount('auto', HEADINGS, 1040 + TOC_WIDTH - 1))?.hasAttribute('data-names')).toBe(false)
  })

  it('auto reads the content width setting: a medium column needs 1640px, a full one never gets names', () => {
    const m = mount('auto', HEADINGS, 1500)
    expect(nav(m)?.hasAttribute('data-names')).toBe(true)
    m.render('auto', 'medium')
    expect(nav(m)?.hasAttribute('data-names')).toBe(false)
    m.render('auto', 'full')
    expect(nav(m)?.hasAttribute('data-names')).toBe(false)
  })

  it('pinned shows "Unpin", which sets the mode back to auto', () => {
    const m = mount('pinned', HEADINGS, 900)
    expect(nav(m)?.hasAttribute('data-names')).toBe(true)
    const stop = buttonNamed(m, 'Unpin')
    expect(stop).toBeDefined()
    click(stop!)
    expect(m.onChangeMode).toHaveBeenCalledWith('auto')
  })

  it('only the current name is marked, and it follows the scroll', async () => {
    const m = mount('pinned', HEADINGS, 900)
    expect(names(m).map((name) => name.getAttribute('aria-current'))).toEqual(['true', null, null, null, null])
    m.current.mockReturnValue(3)
    await scrollFrame(m)
    expect(names(m).map((name) => name.getAttribute('aria-current'))).toEqual([null, null, null, 'true', null])
    // No read / unread shading on names.
    expect(m.section.querySelector('.toc__name[data-read]')).toBeNull()
  })

  it('a scroll inside one section sets no state: the spy is asked, nothing is drawn again', async () => {
    const m = mount('pinned', HEADINGS, 900)
    m.current.mockReturnValue(1)
    await scrollFrame(m)
    const before = names(m)[1]
    const asked = m.current.mock.calls.length
    await scrollFrame(m)
    expect(m.current.mock.calls.length).toBe(asked + 1)
    expect(names(m)[1]).toBe(before)
    expect(names(m)[1].getAttribute('aria-current')).toBe('true')
  })

  it('the spy is asked about the shown rows by their index in the full list', async () => {
    const deep: TocRow[] = Array.from({ length: 201 }, (_, i) => ({ level: 3, text: `Deep ${i}` }))
    const m = mount('pinned', [HEADINGS[0], ...deep, HEADINGS[4]], 900)
    await scrollFrame(m)
    expect(m.current).toHaveBeenLastCalledWith([0, 202], m.scroller)
  })

  it('"Unpin" and "Pin" are offered only where they change what the reader sees, each with its pin and its tooltip', () => {
    // "Pin default" On, and "Pin default" Off would give the names here too: nothing to unpin.
    const roomy = mount('pinned', HEADINGS, 1040 + TOC_WIDTH)
    expect(nav(roomy)?.hasAttribute('data-names')).toBe(true)
    expect(buttonNamed(roomy, 'Unpin')).toBeUndefined()
    // The same window with a medium column: the names stand only because of "Pin default" On.
    roomy.render('pinned', 'medium')
    expect(buttonNamed(roomy, 'Unpin')).toBeDefined()
    // One pixel short of room, and a full-width column at any width: "Pin default" Off would give lines.
    const tight = mount('pinned', HEADINGS, 1040 + TOC_WIDTH - 1)
    const unpin = buttonNamed(tight, 'Unpin')
    expect(unpin?.title).toBe('Unpin: go back to the small lines')
    expect(unpin?.querySelector('svg')).not.toBeNull()
    const full = mount('pinned', HEADINGS, 4000)
    full.render('pinned', 'full')
    expect(buttonNamed(full, 'Unpin')).toBeDefined()

    // "Pin", in the card: from the 700px the names need, and not one under.
    const floor = mount('auto', HEADINGS, NAMES_FLOOR)
    click(rail(floor))
    const pin = buttonNamed(floor, 'Pin')
    expect(pin?.title).toBe('Pin: keep the table of contents open beside the note')
    expect(pin?.querySelector('svg')).not.toBeNull()
    const under = mount('auto', HEADINGS, NAMES_FLOOR - 1)
    click(rail(under))
    expect(buttonNamed(under, 'Pin')).toBeUndefined()
  })

  it('one tab stop, on the current name; a name shows its full text as a tooltip only where the column cut it', async () => {
    const m = mount('pinned', HEADINGS, 900)
    m.current.mockReturnValue(3)
    await scrollFrame(m)
    expect(names(m).map((name) => name.tabIndex)).toEqual([-1, -1, -1, 0, -1])
    const [cut, whole] = names(m)
    Object.defineProperties(cut, { scrollWidth: { value: 260 }, clientWidth: { value: 180 } })
    Object.defineProperties(whole, { scrollWidth: { value: 120 }, clientWidth: { value: 180 } })
    act(() => {
      cut.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      whole.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    })
    expect([cut.title, whole.title]).toEqual(['Part 1', ''])
  })
})

describe('the path in the names: data-path follows the current row (YAZ-2762 D3, D4)', () => {
  /** `data-path` of each name, '' where the row has no attribute at all. */
  const paths = (m: Mounted): string[] => names(m).map((name) => name.getAttribute('data-path') ?? '')
  const goTo = async (m: Mounted, row: number): Promise<void> => {
    m.current.mockReturnValue(row)
    await scrollFrame(m)
  }

  it('each name on the path says which line passes it, the others carry no attribute; the path moves with the scroll and stops at the current row', async () => {
    // Part 1 › Section A › Deep dive, then Section B, then Part 2.
    const m = mount('pinned', HEADINGS, 900)
    expect(paths(m)).toEqual(['', '', '', '', ''])
    // toc.css selects `[data-path^='1']`: a row off the path must have NO attribute, not an empty one.
    expect(m.section.querySelectorAll('.toc__name[data-path]')).toHaveLength(0)
    await goTo(m, 1)
    expect(paths(m)).toEqual(['', '1t', '', '', ''])
    await goTo(m, 2)
    expect(paths(m)).toEqual(['', '1t', '2t', '', ''])
    // The second level 2: the line of Part 1 passes the first one and its row.
    await goTo(m, 3)
    expect(paths(m)).toEqual(['', '1', '1', '1t', ''])
    // The marker and the accent name show a level 1 row; it has no path, and the old one is gone.
    await goTo(m, 4)
    expect(paths(m)).toEqual(['', '', '', '', ''])
    expect(names(m).map((name) => name.getAttribute('aria-current'))).toEqual([null, null, null, null, 'true'])
    // The level of each row is still there for the tones and the grey lines.
    expect(names(m).map((name) => name.dataset.level)).toEqual(['1', '2', '3', '2', '1'])
  })

  it('a click on a name moves the path at once and holds it through the jump\'s own scroll; a scroll inside one section draws nothing again', async () => {
    const m = mount('pinned', HEADINGS, 900)
    // The spy would say the last row: the note hit its bottom before "Deep dive" reached the top.
    m.current.mockReturnValue(4)
    click(names(m)[2])
    expect(paths(m)).toEqual(['', '1t', '2t', '', ''])
    await scrollFrame(m)
    expect(paths(m)).toEqual(['', '1t', '2t', '', ''])
    const commits = m.commits()
    await scrollFrame(m)
    expect(m.commits()).toBe(commits)
  })

  it('the card has the same path as the column, and a note of more than 200 rows counts it on the rows it SHOWS', async () => {
    const inCard = mount('auto')
    await goTo(inCard, 2)
    click(rail(inCard))
    expect(card(inCard)).not.toBeNull()
    expect(paths(inCard)).toEqual(['', '1t', '2t', '', ''])

    // 201 level 3 rows are left out (levels 1 and 2 show): "Far" stands directly below "Part 1" in the list.
    const deep: TocRow[] = Array.from({ length: 201 }, (_, i) => ({ level: 3, text: `Deep ${i}` }))
    const long = mount('pinned', [HEADINGS[0], ...deep, { level: 2, text: 'Far' }, HEADINGS[4]], 900)
    await goTo(long, 1)
    expect(names(long).map((name) => name.textContent)).toEqual(['Part 1', 'Far', 'Part 2'])
    expect(paths(long)).toEqual(['', '1t', ''])
  })
})

describe('the edge of the names column: a drag sets its width (YAZ-2752)', () => {
  const edge = (m: Mounted): HTMLElement | null => m.section.querySelector<HTMLElement>('.toc__resize')
  /** The column's width as toc.css reads it: the variable on `section.editor`, or '' when the component set none. */
  const widthOf = (m: Mounted): string => m.section.style.getPropertyValue('--toc-width')
  const press = (m: Mounted, clientX: number): MouseEvent => {
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX })
    act(() => {
      edge(m)!.dispatchEvent(event)
    })
    return event
  }
  /** A mouse move anywhere in the window. `clientX` is set by hand: a real mouse reports fractions of a px, jsdom's event would cut them. */
  const moveTo = (clientX: number): void => {
    const event = new MouseEvent('mousemove')
    Object.defineProperty(event, 'clientX', { value: clientX })
    act(() => {
      window.dispatchEvent(event)
    })
  }
  const release = (): void =>
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup'))
    })

  afterEach(() => {
    // A drag a failed test left open must not hold the next test's mouse.
    release()
    vi.unstubAllGlobals()
  })

  it('the edge is there wherever the names are, in both modes, and nowhere else; it takes the mouse and never the keyboard', () => {
    for (const m of [mount('pinned', HEADINGS, 900), mount('auto', HEADINGS, 1040 + TOC_WIDTH)]) {
      expect(nav(m)?.hasAttribute('data-names')).toBe(true)
      expect(edge(m)).not.toBeNull()
      expect(nav(m)?.firstElementChild).toBe(edge(m))
      expect(edge(m)?.getAttribute('aria-hidden')).toBe('true')
      expect([edge(m)?.tagName, edge(m)?.hasAttribute('tabindex')]).toEqual(['DIV', false])
      // The wheel on it is the wheel on the column beside the list: the note moves.
      act(() => {
        edge(m)!.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 30 }))
      })
      expect(m.scroller.scrollTop).toBe(30)
      // ⌘J and the arrows walk the names as before: the edge is not one of them.
      act(() => m.mountEl.focus())
      pressCmdJ(m.mountEl)
      expect(document.activeElement).toBe(names(m)[0])
      keyOn(names(m)[0], 'ArrowUp')
      expect(document.activeElement).toBe(names(m)[0])
    }
    // The small lines and their card have none, pinned or not; and no table of contents, no edge.
    for (const m of [mount('auto', HEADINGS, 1040 + TOC_WIDTH - 1), mount('pinned', HEADINGS, NAMES_FLOOR - 1)]) {
      click(rail(m))
      expect(card(m)).not.toBeNull()
      expect(edge(m)).toBeNull()
      expect(widthOf(m)).toBe('')
    }
    expect(edge(mount('off', HEADINGS, 1600))).toBeNull()
    expect(edge(mount('pinned', [HEADINGS[0]], 1600))).toBeNull()
  })

  it('the column shows the saved width, or the room when that is less — and the saved width never decides whether the names show', () => {
    // jsdom's ResizeObserver never reports; this one keeps what it was given, and `resize` runs it as a resized window would.
    const heard: Array<() => void> = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          heard.push(callback)
        }
        observe(): void {}
        disconnect(): void {}
      },
    )
    const resize = (m: Mounted, width: number): void => {
      Object.defineProperty(m.section, 'clientWidth', { configurable: true, value: width })
      act(() => heard.forEach((callback) => callback()))
    }

    // "Pin default" On at its floor: 200px of room. The saved 320 comes back as the window grows, and stops there.
    const pinned = mount('pinned', HEADINGS, NAMES_FLOOR, 320)
    expect(widthOf(pinned)).toBe('200px')
    resize(pinned, 760)
    expect(widthOf(pinned)).toBe('260px')
    resize(pinned, 2000)
    expect(widthOf(pinned)).toBe('320px')
    // Under the floor the lines show, and the variable is gone with the names.
    resize(pinned, NAMES_FLOOR - 1)
    expect(nav(pinned)?.hasAttribute('data-names')).toBe(false)
    expect(widthOf(pinned)).toBe('')

    // "Pin default" Off: the column stops at the empty margin, so the text is never narrower.
    const auto = mount('auto', HEADINGS, 1360, 400)
    expect(widthOf(auto)).toBe('320px')
    resize(auto, 1520)
    expect(widthOf(auto)).toBe('400px')
    // The same window, pinned: the room is the one of "Pin default" On.
    resize(auto, 1360)
    auto.render('pinned')
    expect(widthOf(auto)).toBe('400px')
    auto.render('off')
    expect(widthOf(auto)).toBe('')

    // A saved 160 still needs 200px of margin before the names show; then the column is 160px.
    const slim = mount('auto', HEADINGS, 1040 + TOC_WIDTH - 1, 160)
    expect(nav(slim)?.hasAttribute('data-names')).toBe(false)
    resize(slim, 1040 + TOC_WIDTH)
    expect(nav(slim)?.hasAttribute('data-names')).toBe(true)
    expect(widthOf(slim)).toBe('160px')
    // And a saved 480 does not take the names away from a note that has 200px of margin.
    const wide = mount('auto', HEADINGS, 1040 + TOC_WIDTH, 480)
    expect(nav(wide)?.hasAttribute('data-names')).toBe(true)
    expect(widthOf(wide)).toBe('200px')

    // Showing less than the saved width is not a change of the setting.
    for (const m of [pinned, auto, slim, wide]) expect(m.onChangeWidth).not.toHaveBeenCalled()
  })

  it('a drag: each move writes --toc-width on the section and React renders nothing; left is wider; the release saves one whole number', () => {
    // 1400px pinned: 900px over what the text keeps, so the limit is the 480 of the setting.
    const m = mount('pinned', HEADINGS, 1400)
    expect(widthOf(m)).toBe('200px')
    expect(press(m, 1000).defaultPrevented).toBe(true)
    expect(document.body.style.cursor).toBe('col-resize')
    // YAZ-3719 1A: no frame takes the mouse while the edge is held (a diagram in the next pane).
    expect(document.body.classList.contains('drag-held')).toBe(true)
    expect(edge(m)?.hasAttribute('data-active')).toBe(true)

    const commits = m.commits()
    const asked = m.current.mock.calls.length
    const drawn = [nav(m), edge(m), ...names(m)]
    moveTo(940)
    expect(widthOf(m)).toBe('260px')
    moveTo(1010)
    expect(widthOf(m)).toBe('190px')
    // A mouse between two px: the width is a whole one.
    moveTo(899.6)
    expect(widthOf(m)).toBe('300px')
    moveTo(879.5)
    expect(widthOf(m)).toBe('321px')
    // Four moves: not one render, not one read of the scroll spy, nothing saved yet.
    expect(m.commits()).toBe(commits)
    expect([nav(m), edge(m), ...names(m)]).toEqual(drawn)
    expect(m.current.mock.calls.length).toBe(asked)
    expect(m.onChangeWidth).not.toHaveBeenCalled()

    release()
    expect(m.onChangeWidth).toHaveBeenCalledExactlyOnceWith(321)
    expect(document.body.style.cursor).toBe('')
    expect(document.body.classList.contains('drag-held')).toBe(false)
    expect(edge(m)?.hasAttribute('data-active')).toBe(false)
    // Until the setting comes back the variable keeps the drag's last width, so the column does not jump.
    expect(widthOf(m)).toBe('321px')
    expect(m.commits()).toBe(commits)
    // The drag is over: the mouse moves nothing now, and a second release saves nothing.
    moveTo(500)
    release()
    expect(widthOf(m)).toBe('321px')
    expect(m.onChangeWidth).toHaveBeenCalledTimes(1)

    // The setting comes back as the prop. NOW React renders (the count above is a live one), the
    // width is there already, and the scroll spy reads once: the text flowed, so every row moved.
    m.render('pinned', 'narrow', 321)
    expect(m.commits()).toBeGreaterThan(commits)
    expect(widthOf(m)).toBe('321px')
    expect(m.current.mock.calls.length).toBe(asked + 1)
    m.render('pinned', 'narrow', 321)
    expect(m.current.mock.calls.length).toBe(asked + 1)
  })

  it('a drag stops at 160 and at 480, at the empty margin with "Pin default" Off, and at 500px of text with "Pin default" On — it never unpins or closes the column', () => {
    /** Drag the edge as far as the mouse goes each way; what the column is at each end, and what the release saved. */
    const dragBothWays = (m: Mounted): { widest: string; narrowest: string } => {
      press(m, 1000)
      moveTo(-5000)
      const widest = widthOf(m)
      moveTo(5000)
      const narrowest = widthOf(m)
      release()
      return { widest, narrowest }
    }
    const wide = mount('pinned', HEADINGS, 1400)
    expect(dragBothWays(wide)).toEqual({ widest: '480px', narrowest: '160px' })
    expect(wide.onChangeWidth).toHaveBeenCalledExactlyOnceWith(160)
    // Far to the right is narrow, not gone: "Unpin" is the way to close the column.
    expect(nav(wide)?.hasAttribute('data-names')).toBe(true)
    expect(wide.onChangeMode).not.toHaveBeenCalled()

    // 900px pinned: the text keeps 500, so the names stop at 400.
    expect(dragBothWays(mount('pinned', HEADINGS, 900))).toEqual({ widest: '400px', narrowest: '160px' })
    // 1360px with a 1040px column: 320px of margin, and the names take no more than that.
    expect(dragBothWays(mount('auto', HEADINGS, 1360))).toEqual({ widest: '320px', narrowest: '160px' })
    // At the first width that shows names at all, the margin is the 200 they start with.
    expect(dragBothWays(mount('auto', HEADINGS, 1040 + TOC_WIDTH))).toEqual({ widest: '200px', narrowest: '160px' })

    // Saved 400 in a note with room for 320: the drag starts from the 320 it shows, and saves where it ends.
    const cut = mount('auto', HEADINGS, 1360, 400)
    press(cut, 1000)
    moveTo(1020)
    expect(widthOf(cut)).toBe('300px')
    release()
    expect(cut.onChangeWidth).toHaveBeenCalledExactlyOnceWith(300)
  })

  it('a release that changed nothing saves nothing: a press alone, a double-click, a trip out and back — and a right press starts no drag', () => {
    // Saved 400, shown 320: a click on the edge must not make the 320 the saved width.
    const m = mount('auto', HEADINGS, 1360, 400)
    press(m, 1000)
    release()
    act(() => {
      edge(m)!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
    })
    press(m, 1000)
    moveTo(1040)
    expect(widthOf(m)).toBe('280px')
    moveTo(1000)
    release()
    expect(widthOf(m)).toBe('320px')
    expect(m.onChangeWidth).not.toHaveBeenCalled()
    expect(document.body.style.cursor).toBe('')
    // A right press starts no drag: the system's menu opens on it, and the release may never reach the window.
    act(() => {
      edge(m)!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 1000, button: 2 }))
    })
    moveTo(900)
    expect(widthOf(m)).toBe('320px')
    expect(document.body.style.cursor).toBe('')
  })

  it('names that go away under a drag end it — the editor closes, a bullet zooms: the listeners go, the cursor comes back, nothing is saved', () => {
    const closed = mount('pinned', HEADINGS, 1400)
    press(closed, 1000)
    moveTo(900)
    expect(widthOf(closed)).toBe('300px')
    act(() => closed.root.unmount())
    expect(document.body.style.cursor).toBe('')
    expect(widthOf(closed)).toBe('')
    // A listener left on the window would write the variable again here, and save on the release.
    moveTo(800)
    release()
    expect(widthOf(closed)).toBe('')
    expect(closed.onChangeWidth).not.toHaveBeenCalled()

    const zoomed = mount('pinned', HEADINGS, 1400)
    press(zoomed, 1000)
    moveTo(900)
    act(() => zoomed.channel.setHidden(true))
    expect(document.body.style.cursor).toBe('')
    moveTo(800)
    release()
    expect(widthOf(zoomed)).toBe('')
    expect(zoomed.onChangeWidth).not.toHaveBeenCalled()
    // Back from the zoom: the saved width, not the abandoned drag's.
    act(() => zoomed.channel.setHidden(false))
    expect(widthOf(zoomed)).toBe('200px')
  })
})

describe('where the reader is: the marker, and a long list in step with the note (D5)', () => {
  const ROW = 24
  /**
   * jsdom lays nothing out, so the names get what toc.css would give them: each `ROW` px tall, one
   * under the other, in a list whose box is `boxHeight` px. Returns the undo.
   */
  const layOutNames = (boxHeight: number): (() => void) => {
    const keys = ['offsetTop', 'offsetHeight', 'scrollHeight', 'clientHeight'] as const
    const before = keys.map((key) => Object.getOwnPropertyDescriptor(HTMLElement.prototype, key))
    const rowsOf = (list: Element): Element[] => [...list.querySelectorAll('.toc__name')]
    const isName = (el: Element): boolean => el.classList.contains('toc__name')
    const isList = (el: Element): boolean => el.classList.contains('toc__names')
    const laidOut: Record<(typeof keys)[number], (el: HTMLElement) => number> = {
      offsetTop: (el) => (isName(el) ? rowsOf(el.parentElement!).indexOf(el) * ROW : 0),
      offsetHeight: (el) => (isName(el) ? ROW : 0),
      scrollHeight: (el) => (isList(el) ? rowsOf(el).length * ROW : 0),
      clientHeight: (el) => (isList(el) ? Math.min(boxHeight, rowsOf(el).length * ROW) : 0),
    }
    for (const key of keys) {
      Object.defineProperty(HTMLElement.prototype, key, {
        configurable: true,
        get(this: HTMLElement) {
          return laidOut[key](this)
        },
      })
    }
    return () =>
      keys.forEach((key, i) => {
        const was = before[i]
        if (was === undefined) delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key]
        else Object.defineProperty(HTMLElement.prototype, key, was)
      })
  }
  const TEN: TocRow[] = Array.from({ length: 10 }, (_, i) => ({ level: 1, text: `Part ${i}` }))
  const list = (m: Mounted): HTMLElement => m.section.querySelector<HTMLElement>('.toc__names')!
  const marker = (m: Mounted): HTMLElement => m.section.querySelector<HTMLElement>('.toc__marker')!
  const goTo = async (m: Mounted, row: number): Promise<void> => {
    m.current.mockReturnValue(row)
    await scrollFrame(m)
  }

  it('the marker stands on the current name, and slides only after its first placement', async () => {
    const undo = layOutNames(1000)
    try {
      const m = mount('pinned', TEN, 900)
      expect(marker(m).getAttribute('aria-hidden')).toBe('true')
      expect([marker(m).style.transform, marker(m).style.height]).toEqual(['translateY(0px)', '24px'])
      // toc.css gives the slide to `[data-placed]` alone, and the attribute comes after the first placement.
      expect(marker(m).hasAttribute('data-placed')).toBe(true)
      expect(tocCss).toMatch(/\.toc__marker\[data-placed\]\s*\{[^}]*transition:\s*transform/s)
      expect(tocCss.match(/\.toc__marker\s*\{([^}]*)\}/s)?.[1]).not.toMatch(/transition/)
      await goTo(m, 6)
      expect(marker(m).style.transform).toBe('translateY(144px)')
      // A list that fits its box has nowhere to go and no edge to fade.
      expect(list(m).scrollTop).toBe(0)
      expect([list(m).hasAttribute('data-above'), list(m).hasAttribute('data-below')]).toEqual([false, false])
    } finally {
      undo()
    }
  })

  it('a list longer than its box moves with the note like a scrollbar’s thumb: the first name at the top, the last at the bottom, in step between — and fades at the edge that has more', async () => {
    // Ten names of 24px in a box of 120px: 120px of travel.
    const undo = layOutNames(120)
    const scrollTo = vi.fn()
    Object.assign(HTMLElement.prototype, { scrollTo })
    try {
      const m = mount('pinned', TEN, 900)
      // The first placement does not glide.
      expect(scrollTo).not.toHaveBeenCalled()
      expect(list(m).scrollTop).toBe(0)
      expect([list(m).hasAttribute('data-above'), list(m).hasAttribute('data-below')]).toEqual([false, true])
      await goTo(m, 9)
      expect(scrollTo).toHaveBeenLastCalledWith({ top: 120, behavior: 'smooth' })
      expect(scrollTo.mock.contexts.at(-1)).toBe(list(m))
      await goTo(m, 3)
      // A third of the way down the list (72 of 216px), a third of the travel.
      expect(scrollTo).toHaveBeenLastCalledWith({ top: 40, behavior: 'smooth' })
      await goTo(m, 0)
      expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'smooth' })
      expect(scrollTo).toHaveBeenCalledTimes(3)
      // The list's own scroll sets the fades: at its end there is more above and nothing below.
      list(m).scrollTop = 120
      act(() => {
        list(m).dispatchEvent(new Event('scroll'))
      })
      expect([list(m).hasAttribute('data-above'), list(m).hasAttribute('data-below')]).toEqual([true, false])
    } finally {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollTo
      undo()
    }
  })

  it('a click on a name, or a fold, moves only the marker: the list holds still until the note moves again (YAZ-3939, demo 5C)', async () => {
    // Ten names of 24px in a box of 120px, three of them parents.
    const undo = layOutNames(120)
    const scrollTo = vi.fn()
    Object.assign(HTMLElement.prototype, { scrollTo })
    try {
      const NESTED: TocRow[] = ['A', 'a1', 'a2', 'B', 'b1', 'b2', 'C', 'c1', 'c2', 'D'].map((text) => ({ level: text.length === 1 ? 1 : 2, text }))
      const m = mount('pinned', NESTED, 900)
      // The row the reader is in, in the full list: the spy answers the last shown row at or above it.
      let reading = 4
      m.current.mockImplementation((indices: number[]) => indices.filter((i) => i <= reading).length - 1)
      await scrollFrame(m)
      expect(scrollTo).toHaveBeenCalledTimes(1)
      // A click on "c2": the marker goes there, the list stays.
      click(names(m)[8])
      reading = 8
      expect(marker(m).style.transform).toBe('translateY(192px)')
      expect(scrollTo).toHaveBeenCalledTimes(1)
      // A fold of "C" makes the list shorter: "C" is current, and the list stays.
      click(names(m)[6].querySelector<HTMLElement>('.toc__fold')!)
      expect(names(m).map((name) => name.textContent)).toEqual(['A', 'a1', 'a2', 'B', 'b1', 'b2', 'C', 'D'])
      expect(names(m)[6].getAttribute('aria-current')).toBe('true')
      expect(scrollTo).toHaveBeenCalledTimes(1)
      // The reader moves the note: the list follows again.
      reading = 1
      await scrollFrame(m)
      expect(scrollTo).toHaveBeenCalledTimes(2)
      // A click on the current name renders nothing and holds nothing: the next move of the note still follows.
      click(names(m)[1])
      act(() => {
        m.scroller.dispatchEvent(new Event('pointerdown'))
      })
      reading = 5
      await scrollFrame(m)
      expect(scrollTo).toHaveBeenCalledTimes(3)
    } finally {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollTo
      undo()
    }
  })

  it('an unfold into the section the reader is in, by the arrow or by "Expand all", holds the list still too: the marker goes to that row at once (YAZ-4048)', async () => {
    const undo = layOutNames(120)
    const scrollTo = vi.fn()
    Object.assign(HTMLElement.prototype, { scrollTo })
    try {
      const NESTED: TocRow[] = ['A', 'a1', 'a2', 'B', 'b1', 'b2', 'C', 'c1', 'c2', 'D'].map((text) => ({ level: text.length === 1 ? 1 : 2, text }))
      const m = mount('pinned', NESTED, 900)
      // The reader is in "c2" (index 8). The spy answers the last shown row at or above it.
      const reading = 8
      m.current.mockImplementation((indices: number[]) => indices.filter((i) => i <= reading).length - 1)
      await scrollFrame(m)
      const before = scrollTo.mock.calls.length
      const arrowOfC = (): HTMLElement => names(m)[6].querySelector<HTMLElement>('.toc__fold')!
      // Fold "C": "C" is current, the list holds.
      click(arrowOfC())
      expect(names(m)[6].getAttribute('aria-current')).toBe('true')
      expect(scrollTo).toHaveBeenCalledTimes(before)
      // Open "C" again with its arrow. The note did not move: "c2" is current, and the list holds.
      click(arrowOfC())
      expect(names(m).map((name) => name.textContent)).toEqual(['A', 'a1', 'a2', 'B', 'b1', 'b2', 'C', 'c1', 'c2', 'D'])
      expect(names(m)[8].getAttribute('aria-current')).toBe('true')
      expect(scrollTo).toHaveBeenCalledTimes(before)
      // The same with "Collapse all", then "Expand all".
      const foldAll = m.section.querySelector<HTMLButtonElement>('.toc__pin--all')!
      click(foldAll)
      expect(names(m).map((name) => name.textContent)).toEqual(['A', 'B', 'C', 'D'])
      expect(names(m)[2].getAttribute('aria-current')).toBe('true')
      click(foldAll)
      expect(names(m)[8].getAttribute('aria-current')).toBe('true')
      expect(scrollTo).toHaveBeenCalledTimes(before)
    } finally {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollTo
      undo()
    }
  })

  it('under "Reduce Motion" the long list is placed in step, never glided, and toc.css stops every transition of the table of contents', async () => {
    const undo = layOutNames(120)
    const scrollTo = vi.fn()
    Object.assign(HTMLElement.prototype, { scrollTo })
    ;(window as unknown as Record<string, unknown>).matchMedia = (query: string) => ({ matches: query.includes('prefers-reduced-motion') })
    try {
      const m = mount('pinned', TEN, 900)
      await goTo(m, 9)
      expect(list(m).scrollTop).toBe(120)
      await goTo(m, 3)
      expect(list(m).scrollTop).toBe(40)
      expect(scrollTo).not.toHaveBeenCalled()
      const reduced = tocCss.match(/@media \(prefers-reduced-motion: reduce\)\s*\{(.*)\}\s*$/s)?.[1] ?? ''
      expect(reduced).toMatch(/\.toc\[data-names\],\s*\.toc__card\s*\{\s*animation:\s*none;/)
      expect(reduced).toMatch(/\.toc__card,\s*\.toc__line,\s*\.toc__name,\s*\.toc__names,\s*\.toc__pin,\s*\.toc__fold,\s*\.toc__fold > svg,\s*\.toc__zoom,\s*\.toc__marker\[data-placed\]\s*\{\s*transition:\s*none;/)
      // Every rule of the sheet that eases is one of those nine.
      const eased = [...tocCss.replace(/@media.*$/s, '').matchAll(/([^{}]+)\{[^{}]*transition:/g)].map(([, selector]) => selector.replace(/\/\*.*?\*\//gs, '').trim())
      expect(eased).toEqual(['.toc__names', '.toc__name', '.toc__fold', '.toc__fold > svg', '.toc__marker[data-placed]', '.toc__pin', '.toc__zoom', '.toc__line', '.toc__card'])
    } finally {
      delete (window as unknown as Record<string, unknown>).matchMedia
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollTo
      undo()
    }
  })

  it('a rail too long for the window is clipped and keeps the same step: the current line as far down it as it is down the list', async () => {
    const m = mount('auto')
    const track = m.section.querySelector<HTMLElement>('.toc__track')!
    Object.defineProperties(track, { scrollHeight: { value: 800 }, clientHeight: { value: 200 } })
    await goTo(m, 2)
    expect(track.scrollTop).toBe(300)
    await goTo(m, 4)
    expect(track.scrollTop).toBe(600)
    await goTo(m, 0)
    expect(track.scrollTop).toBe(0)
  })
})

describe('the stylesheet the component counts on (toc.css, app.css)', () => {
  /** The body of the rule whose WHOLE selector is `selector`: it starts the sheet, or follows a rule or a comment. */
  const rule = (css: string, selector: string): string => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const body = css.match(new RegExp(`(?:^|\\}|\\*/)\\s*${escaped}\\s*\\{([^}]*)\\}`, 's'))?.[1]
    if (body === undefined) throw new Error(`no rule for ${selector}`)
    return body
  }
  const zIndex = (body: string): number => Number(body.match(/z-index:\s*(\d+);/)?.[1])

  it('stands on a layer above the note and BELOW the status chips, whose menus open over its corner', () => {
    const toc = zIndex(rule(tocCss, '.toc'))
    const chips = zIndex(rule(appCss, '.status-chips'))
    expect(toc).toBeGreaterThan(0)
    expect(toc).toBeLessThan(chips)
  })

  it('ONE scrollbar, the note’s: a list shows none and keeps the wheel at its ends; no card follows the note (YAZ-2886); the names take their 200px from the scroller', () => {
    const list = rule(tocCss, '.toc__names')
    expect(list).toMatch(/overflow-y:\s*auto;/)
    expect(list).toMatch(/scrollbar-width:\s*none;/)
    expect(list).toMatch(/overscroll-behavior:\s*contain;/)
    expect(tocCss).not.toContain('data-follow')
    // `namesShow` counts with TOC_WIDTH: the scroller pads by it, the find bar moves by it, the column stands left of the note's scrollbar.
    expect(tocCss).toMatch(new RegExp(`--toc-width:\\s*${TOC_WIDTH}px;`))
    expect(rule(tocCss, '.editor:has(> .toc[data-names]) > .editor-host')).toMatch(/padding-right:\s*var\(--toc-width/)
    expect(rule(tocCss, '.editor:has(> .toc[data-names]) > .find-bar-dock--note')).toMatch(/right:\s*var\(--toc-width/)
    const column = rule(tocCss, '.toc[data-names]')
    expect(column).toMatch(/right:\s*var\(--toc-gutter/)
    expect(column).toMatch(/width:\s*var\(--toc-width\);/)
    // "Room" is counted by the component, never by a container query: a container would trap the full-window drawing and image dialogs.
    expect(tocCss).not.toMatch(/@container|container-type/)
  })

  it('the drag edge (YAZ-2752) is a 6px strip from top to bottom with the names\' hairline inside it, the accent wash under the mouse and during a drag', () => {
    const strip = rule(tocCss, '.toc__resize')
    const px = (body: string, property: string): number => Number(body.match(new RegExp(`(?:^|[;\\s])${property}:\\s*(-?\\d+)(?:px)?;`))?.[1])
    expect(strip).toMatch(/position:\s*absolute;/)
    expect(strip).toMatch(/cursor:\s*col-resize;/)
    expect([px(strip, 'top'), px(strip, 'bottom'), px(strip, 'width')]).toEqual([0, 0, 6])
    // The hairline is the names' 1px left border, at the column's left padding.
    const hairline = Number(rule(tocCss, '.toc[data-names]').match(/padding:\s*\d+px \d+px \d+px (\d+)px;/)?.[1])
    expect(rule(tocCss, '.toc__name')).toMatch(/border-left:\s*1px solid/)
    expect(px(strip, 'left')).toBeLessThanOrEqual(hairline)
    expect(px(strip, 'left') + px(strip, 'width')).toBeGreaterThanOrEqual(hairline + 1)
    // Over the names, whose list is a layer of its own (its fade is a mask).
    expect(zIndex(strip)).toBeGreaterThan(0)
    expect(tocCss).toMatch(/\.toc__resize:hover,\s*\.toc__resize\[data-active\]\s*\{\s*background:\s*var\(--accent-soft\);\s*\}/)
  })

  it('the row under the mouse is the soft accent, the current one stays the accent; the current line is 5px longer; the card is 440px tall at most', () => {
    expect(rule(tocCss, '.toc__name:hover')).toMatch(/background-color:\s*var\(--accent-soft\);/)
    // One rule keeps the current name the accent under the mouse too: three parts outweigh `.toc__name:hover`.
    expect(rule(tocCss, ".toc__names .toc__name[aria-current='true']")).toMatch(/color:\s*var\(--accent\);/)
    expect(tocCss).not.toMatch(/\.toc__name\[aria-current='true'\]:hover/)
    expect(rule(tocCss, '.toc__line[data-current]')).toMatch(/width:\s*calc\(var\(--toc-w\) \+ 5px\);/)
    // The rail: 18 / 12 / 7 px for level 1 / 2 / 3, and the H4 and H5 lines are 7 px like level 3 (YAZ-3051 D8).
    expect(rule(tocCss, '.toc__line')).toMatch(/--toc-w:\s*18px;/)
    expect(rule(tocCss, ".toc__line[data-level='2']")).toMatch(/--toc-w:\s*12px;/)
    expect(rule(tocCss, ".toc__line[data-level='3'],\n.toc__line[data-level='4'],\n.toc__line[data-level='5']")).toMatch(/--toc-w:\s*7px;/)
    expect(rule(tocCss, '.toc__card')).toMatch(/max-height:\s*min\([^;]*440px\);/)
  })

  describe('the hierarchy of the names (YAZ-2762)', () => {
    /** What a rule declares, comments left out: property → value. */
    const declared = (body: string): Record<string, string> =>
      Object.fromEntries(
        body
          .replace(/\/\*.*?\*\//gs, '')
          .split(';')
          .map((line) => line.trim())
          .filter((line) => line !== '')
          .map((line) => [line.slice(0, line.indexOf(':')).trim(), line.slice(line.indexOf(':') + 1).trim().replace(/\s+/g, ' ')]),
      )
    const of = (selector: string): Record<string, string> => declared(rule(tocCss, selector))
    /** Each rule of the sheet outside `@media`, comments left out: [selector, body]. */
    const rules = (): Array<[string, string]> => [...tocCss.replace(/\/\*.*?\*\//gs, '').replace(/@media.*$/s, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => [selector.trim().replace(/\s+/g, ' '), body])
    /** Where a rule stands in the sheet: of two rules of the same weight, the later one wins. */
    const place = (selector: string): number => rules().findIndex(([found]) => found === selector)
    const GATE = [".app[data-toc-lines='always'] .toc__names", ".app[data-toc-lines='hover'] .toc__names:hover", ".app[data-toc-lines='hover'] .toc__names:focus-within"]
    const READING = ".app[data-toc-lines='hover'] .toc[data-reading] .toc__names"

    it('a tone for each level, made from the two text tokens and always on: --fg at weight 500, a mix of the two, --fg-muted (D1)', () => {
      expect(of(".toc__name[data-level='1']")).toEqual({ 'font-weight': '500', color: 'var(--fg)' })
      expect(of(".toc__name[data-level='2']").color).toBe('color-mix(in srgb, var(--fg) 55%, var(--fg-muted))')
      // Level 3 is the tone of the list itself, as before: its rule sets no colour of its own. Levels 4 and 5 share it (YAZ-3051 D8).
      expect(of('.toc__name').color).toBe('var(--fg-muted)')
      for (const level of [3, 4, 5]) expect(of(`.toc__name[data-level='${level}']`)).not.toHaveProperty('color')
      // The setting does not reach a tone: each rule that reads `data-toc-lines` sets the two line colours and nothing more.
      const gated = rules().filter(([selector]) => selector.includes('data-toc-lines'))
      expect(gated.map(([selector]) => selector)).toEqual([GATE.join(', '), READING])
      for (const [, body] of gated) expect(Object.keys(declared(body)).filter((property) => property !== '--toc-rest' && property !== '--toc-path')).toEqual([])
      // The current name outweighs the tone on each level (tested above). The name under the mouse has the weight of a
      // level rule, so it wins by its place alone: after the last of them.
      expect(of('.toc__name:hover').color).toBe('var(--fg)')
      expect(place('.toc__name:hover')).toBeGreaterThan(place(".toc__name[data-level='5']"))
    })

    it('the level lines are backgrounds of the row: 1px at 20, 36, 52 and 68px, the 13px level piece at mid-row, the path over the piece and the piece over the grey lines — and clear until a level asks for them (D2, D7; YAZ-3051 D8)', () => {
      const row = of('.toc__name')
      // The layers in paint order, the first on top: [the colour it reads, where and how big].
      const layers = [...row.background.matchAll(/linear-gradient\(var\((--toc-[\w-]+)\), var\(\1\)\) (.*?) no-repeat/g)].map(([, colour, box]) => [colour, box])
      // The level piece is BELOW the path: the line of a path that only passes a level 2 name crosses the grey piece whole.
      expect(layers).toEqual([
        ['--toc-p1', '20px 0 / 1px var(--toc-p1-h)'],
        ['--toc-p2', '36px 0 / 1px 100%'],
        ['--toc-p3', '52px 0 / 1px 100%'],
        ['--toc-p4', '68px 0 / 1px 100%'],
        ['--toc-piece', '20px 50% / 13px 1px'],
        ['--toc-l1', '20px 0 / 1px 100%'],
        ['--toc-l2', '36px 0 / 1px 100%'],
        ['--toc-l3', '52px 0 / 1px 100%'],
        ['--toc-l4', '68px 0 / 1px 100%'],
      ])
      // Nine gradients and nothing else in the shorthand: no colour, so the wash under the mouse can be one.
      expect(row.background.split('no-repeat')).toHaveLength(layers.length + 1)
      // Each property a layer reads has its default on the row itself, and draws nothing: a clear colour, the full height.
      const read = [...row.background.matchAll(/var\((--toc-[\w-]+)\)/g)].map(([, property]) => property)
      for (const property of read) expect([property, row[property]]).toEqual([property, property === '--toc-p1-h' ? '100%' : 'transparent'])
      // Level 1: no line. Level 2: the first line and the level piece. Level 3 and deeper: a line for each level above it, and no level piece.
      const lines = (level: number): Record<string, string> => Object.fromEntries(Object.entries(of(`.toc__name[data-level='${level}']`)).filter(([property]) => property.startsWith('--toc-') && property !== '--toc-indent'))
      expect(lines(1)).toEqual({})
      expect(lines(2)).toEqual({ '--toc-l1': 'var(--toc-rest)', '--toc-piece': 'var(--toc-rest)' })
      expect(lines(3)).toEqual({ '--toc-l1': 'var(--toc-rest)', '--toc-l2': 'var(--toc-rest)' })
      expect(lines(4)).toEqual({ '--toc-l1': 'var(--toc-rest)', '--toc-l2': 'var(--toc-rest)', '--toc-l3': 'var(--toc-rest)' })
      expect(lines(5)).toEqual({ '--toc-l1': 'var(--toc-rest)', '--toc-l2': 'var(--toc-rest)', '--toc-l3': 'var(--toc-rest)', '--toc-l4': 'var(--toc-rest)' })
      // A line stands below the left edge of its parent level: 20px for the first, then 16px for each level, the left padding of the row (YAZ-3939 D3, demo 5A).
      expect(row.padding).toBe('4px 8px 4px var(--toc-indent)')
      expect([1, 2, 3, 4, 5].map((level) => (level === 1 ? row : of(`.toc__name[data-level='${level}']`))['--toc-indent'])).toEqual(['20px', '36px', '52px', '68px', '84px'])
      // The wash under the mouse is a COLOUR behind the lines: the shorthand would take them away. No rule of a name but the first sets it.
      expect(of('.toc__name:hover')).toEqual({ color: 'var(--fg)', 'background-color': 'var(--accent-soft)' })
      expect(rules().filter(([selector, body]) => /\.toc__name(?![\w-])/.test(selector) && 'background' in declared(body)).map(([selector]) => selector)).toEqual(['.toc__name'])
    })

    it('the path is the accent on the line that `data-path` names; on a `1t` row the first line stops at mid-row and the level piece is the accent; `2t`, `3t` and `4t` have no rule of their own (D3, D7; YAZ-3051 D8)', () => {
      expect(of(".toc__name[data-path^='1']")).toEqual({ '--toc-p1': 'var(--toc-path)' })
      expect(of(".toc__name[data-path^='2']")).toEqual({ '--toc-p2': 'var(--toc-path)' })
      expect(of(".toc__name[data-path^='3']")).toEqual({ '--toc-p3': 'var(--toc-path)' })
      expect(of(".toc__name[data-path^='4']")).toEqual({ '--toc-p4': 'var(--toc-path)' })
      // Half the row and half the 1px piece: the line ends on the lower edge of the piece, with no gap and no stub.
      expect(of(".toc__name[data-path='1t']")).toEqual({ '--toc-piece': 'var(--toc-path)', '--toc-p1-h': 'calc(50% + 0.5px)' })
      // The piece is grey by the level 2 rule, which has the same weight: the accent wins by its place alone.
      expect(place(".toc__name[data-path='1t']")).toBeGreaterThan(place(".toc__name[data-level='2']"))
      // These five are each rule that reads the attribute: a name of level 3 or deeper has no level piece, so `2t`, `3t` and `4t` are drawn as `2`, `3` and `4`.
      expect(rules().map(([selector]) => selector).filter((selector) => selector.includes('data-path'))).toEqual([
        ".toc__name[data-path^='1']",
        ".toc__name[data-path^='2']",
        ".toc__name[data-path^='3']",
        ".toc__name[data-path^='4']",
        ".toc__name[data-path='1t']",
      ])
      // The path never has a colour of its own: it is clear wherever `--toc-path` is.
      expect(rules().filter(([, body]) => /--toc-(p1|p2|p3|p4|piece):\s*var\(--accent\)/.test(body))).toEqual([])
    })

    it('`data-toc-lines` on `.app` says when the lines show: always, or while the mouse or the keyboard is in the list; a turn of the wheel shows the PATH only; `off` has no rule; the two colours fade in 160 ms (D5, D8)', () => {
      // Registered as colours, clear by default: that is what lets them fade, and what "Never" and "at rest" are.
      for (const colour of ['--toc-rest', '--toc-path']) expect(of(`@property ${colour}`)).toEqual({ syntax: "'<color>'", inherits: 'true', 'initial-value': 'transparent' })
      expect(of(GATE.join(',\n'))).toEqual({ '--toc-rest': 'var(--border)', '--toc-path': 'var(--accent)' })
      // The grey lines wait for the mouse: the rule of the wheel sets the path's colour and no other.
      expect(of(READING)).toEqual({ '--toc-path': 'var(--accent)' })
      expect(tocCss).not.toMatch(/data-toc-lines='off'/)
      // No other rule gives the two a colour: with "Never", and at rest with "On hover", each line is clear.
      const coloured = rules().filter(([, body]) => /--toc-(rest|path):/.test(body))
      expect(coloured.map(([selector]) => selector)).toEqual([GATE.join(', '), READING])
      // "In the list" is the list alone, not the column: the mouse on "Unpin" or on the drag edge does not show the lines.
      for (const selector of GATE.slice(1)) expect(selector).toMatch(/ \.toc__names:(hover|focus-within)$/)
      expect(of('.toc__names').transition).toBe('--toc-rest 160ms ease, --toc-path 160ms ease')
      // A name eases its own colour and its wash, never the lines: a path that moves to a new row does not fade between rows.
      expect(of('.toc__name').transition).toBe('color 80ms ease, background-color 80ms ease')
    })
  })
})

describe('click = jump', () => {
  it('a click on a name calls jump with the index in the FULL list, not the row', () => {
    const deep: TocRow[] = Array.from({ length: 201 }, (_, i) => ({ level: 3, text: `Deep ${i}` }))
    const m = mount('pinned', [HEADINGS[0], ...deep, { level: 2, text: 'Far' }, HEADINGS[4]], 900)
    expect(names(m).map((name) => name.textContent)).toEqual(['Part 1', 'Far', 'Part 2'])
    click(names(m)[1])
    expect(m.jump).toHaveBeenCalledTimes(1)
    expect(m.jump).toHaveBeenCalledWith(202)
  })

  it('in the names column the names stay after a jump', () => {
    const m = mount('pinned', HEADINGS, 900)
    click(names(m)[3])
    expect(m.jump).toHaveBeenCalledWith(3)
    expect(names(m)).toHaveLength(5)
  })

  it('from the card, the card closes after the jump', () => {
    const m = mount('auto')
    click(rail(m))
    click(names(m)[2])
    expect(m.jump).toHaveBeenCalledWith(2)
    expect(card(m)).toBeNull()
  })

  it('the heading jumped to is current at once and stays so through the jump\'s own scroll, until the reader moves the note', async () => {
    const m = mount('pinned', HEADINGS, 900)
    // The spy would say the last heading: the note hit its bottom before "Section B" reached the top.
    m.current.mockReturnValue(4)
    click(names(m)[3])
    expect(names(m)[3].getAttribute('aria-current')).toBe('true')
    await scrollFrame(m)
    expect(names(m)[3].getAttribute('aria-current')).toBe('true')
    act(() => {
      m.scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 40 }))
    })
    await scrollFrame(m)
    expect(names(m)[4].getAttribute('aria-current')).toBe('true')
  })
})

describe('⌘J', () => {
  it('names mode: focuses the current name and consumes the key', async () => {
    const m = mount('pinned', HEADINGS, 900)
    m.current.mockReturnValue(2)
    await scrollFrame(m)
    act(() => m.mountEl.focus())
    const event = pressCmdJ(m.mountEl)
    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(names(m)[2])
  })

  it('lines mode: opens the card, focuses the current name, and the card stays while focus is inside', () => {
    fakeClock()
    const m = mount('auto')
    act(() => m.mountEl.focus())
    pressCmdJ(m.mountEl)
    expect(card(m)).not.toBeNull()
    expect(document.activeElement).toBe(names(m)[0])
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(card(m)).not.toBeNull()
  })

  it('↑ ↓ Home End move between the names, and stop at the ends', () => {
    const m = mount('pinned', HEADINGS, 900)
    act(() => m.mountEl.focus())
    pressCmdJ(m.mountEl)
    expect(keyOn(names(m)[0], 'ArrowDown').defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(names(m)[1])
    keyOn(names(m)[1], 'ArrowDown')
    expect(document.activeElement).toBe(names(m)[2])
    keyOn(names(m)[2], 'ArrowUp')
    expect(document.activeElement).toBe(names(m)[1])
    keyOn(names(m)[1], 'End')
    expect(document.activeElement).toBe(names(m)[4])
    keyOn(names(m)[4], 'ArrowDown')
    expect(document.activeElement).toBe(names(m)[4])
    keyOn(names(m)[4], 'Home')
    expect(document.activeElement).toBe(names(m)[0])
    keyOn(names(m)[0], 'ArrowUp')
    expect(document.activeElement).toBe(names(m)[0])
  })

  it('Esc closes the card and hands the caret back to the note', () => {
    const m = mount('auto')
    act(() => m.mountEl.focus())
    pressCmdJ(m.mountEl)
    const event = keyOn(names(m)[0], 'Escape')
    expect(event.defaultPrevented).toBe(true)
    expect(card(m)).toBeNull()
    expect(m.onReturnFocus).toHaveBeenCalledTimes(1)
  })

  it('Esc in the names column hands the caret back too; the names stay', () => {
    const m = mount('pinned', HEADINGS, 900)
    act(() => m.mountEl.focus())
    pressCmdJ(m.mountEl)
    keyOn(names(m)[0], 'Escape')
    expect(m.onReturnFocus).toHaveBeenCalledTimes(1)
    expect(names(m)).toHaveLength(5)
  })

  it('⌘J again, from inside, does what Esc does', () => {
    const m = mount('auto')
    act(() => m.mountEl.focus())
    pressCmdJ(m.mountEl)
    const event = pressCmdJ(names(m)[0])
    expect(event.defaultPrevented).toBe(true)
    expect(card(m)).toBeNull()
    expect(m.onReturnFocus).toHaveBeenCalledTimes(1)
  })

  it('a note that shows no table of contents does not claim the key', () => {
    const none = mount('auto', [HEADINGS[0]])
    act(() => none.mountEl.focus())
    expect(pressCmdJ(none.mountEl).defaultPrevented).toBe(false)
    const off = mount('off')
    act(() => off.mountEl.focus())
    expect(pressCmdJ(off.mountEl).defaultPrevented).toBe(false)
  })

  it('two editors: the one focus stands in claims, the other declines', () => {
    const first = mount('auto')
    const second = mount('auto')
    act(() => second.mountEl.focus())
    pressCmdJ(second.mountEl)
    expect(card(second)).not.toBeNull()
    expect(card(first)).toBeNull()
  })

  it('focus inside no editor at all: the first visible one in document order claims', () => {
    const first = mount('auto')
    const second = mount('auto')
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    try {
      act(() => outside.focus())
      const event = pressCmdJ(outside)
      expect(event.defaultPrevented).toBe(true)
      expect(card(first)).not.toBeNull()
      expect(card(second)).toBeNull()
    } finally {
      outside.remove()
    }
  })

  it('a hidden editor never claims: with the first one hidden, the second answers', () => {
    const first = mount('auto')
    const second = mount('auto')
    // jsdom has no checkVisibility; the app's hidden layers answer false to it.
    first.section.checkVisibility = () => false
    second.section.checkVisibility = () => true
    const event = pressCmdJ(document.body)
    expect(event.defaultPrevented).toBe(true)
    expect(card(first)).toBeNull()
    expect(card(second)).not.toBeNull()
  })

  it('other chords are left alone: ⌘⇧J, plain J', () => {
    const m = mount('auto')
    act(() => m.mountEl.focus())
    const shifted = new KeyboardEvent('keydown', { key: 'j', metaKey: true, shiftKey: true, bubbles: true, cancelable: true })
    const plain = new KeyboardEvent('keydown', { key: 'j', bubbles: true, cancelable: true })
    act(() => {
      m.mountEl.dispatchEvent(shifted)
      m.mountEl.dispatchEvent(plain)
    })
    expect(shifted.defaultPrevented).toBe(false)
    expect(plain.defaultPrevented).toBe(false)
    expect(card(m)).toBeNull()
  })
})

describe('folds (YAZ-3939)', () => {
  // Overview › Goals; Design › Data model › Keys, Design › Limits; Rollout.
  const TREE: TocRow[] = [
    { level: 1, text: 'Overview' },
    { level: 2, text: 'Goals' },
    { level: 1, text: 'Design' },
    { level: 2, text: 'Data model' },
    { level: 3, text: 'Keys' },
    { level: 2, text: 'Limits' },
    { level: 1, text: 'Rollout' },
  ]
  const keys = tocFoldKeys(TREE)
  /** The saved key of a row: level, the hashed text, the occurrence. */
  const key = (level: number, text: string, n = 0): string => `${level}:${outlineFoldKeyStem(text)}#${n}`
  const texts = (rows: readonly TocRow[]): string[] => rows.map(({ text }) => text)
  const shownTexts = (m: Mounted): string[] => names(m).map((name) => name.textContent ?? '')
  const arrow = (m: Mounted, text: string): HTMLElement => {
    const el = names(m).find((name) => name.textContent === text)?.querySelector<HTMLElement>('.toc__fold')
    if (!el) throw new Error(`no arrow on ${text}`)
    return el
  }
  const foldAll = (m: Mounted): HTMLButtonElement => {
    const el = m.section.querySelector<HTMLButtonElement>('.toc__pin--all')
    if (!el) throw new Error('no fold-all button')
    return el
  }

  it('D1: a fold key is the level, the text and which row of the two it is: the note\'s heading fold rule', () => {
    expect(tocFoldKeys([{ level: 1, text: 'Notes' }, { level: 2, text: 'Notes' }, { level: 1, text: 'Notes' }])).toEqual([key(1, 'Notes'), key(2, 'Notes'), key(1, 'Notes', 1)])
    // The text is hashed, as the note's own fold keys are: a long bullet makes a short key.
    const [long] = tocFoldKeys([{ level: 1, text: 'x'.repeat(5000) }])
    expect(long.length).toBeLessThan(40)
  })

  it('D2: only a row with a deeper row next folds, and a fold hides each deeper row down to the next of its level or higher', () => {
    const rows = shownRows(TREE)
    expect([...foldable(rows)]).toEqual([0, 2, 3])
    expect(texts(unfoldedRows(rows, keys, new Set()))).toEqual(texts(TREE))
    expect(texts(unfoldedRows(rows, keys, new Set([keys[2]])))).toEqual(['Overview', 'Goals', 'Design', 'Rollout'])
    expect(texts(unfoldedRows(rows, keys, new Set([keys[3]])))).toEqual(['Overview', 'Goals', 'Design', 'Data model', 'Limits', 'Rollout'])
    // A fold inside a fold: opening the outer one shows the inner one still folded.
    expect(texts(unfoldedRows(rows, keys, new Set([keys[2], keys[3]])))).toEqual(['Overview', 'Goals', 'Design', 'Rollout'])
    // A row with nothing under it hides nothing, even with a saved fold.
    expect(texts(unfoldedRows(rows, keys, new Set([keys[6]])))).toEqual(texts(TREE))
  })

  it('D3: an arrow on each row with rows under it only; a click on it folds and never jumps; a click on the name jumps', () => {
    const m = mount('pinned', TREE, 900)
    expect(names(m).filter((name) => name.querySelector('.toc__fold') !== null).map((name) => name.textContent)).toEqual(['Overview', 'Design', 'Data model'])
    expect(names(m).map((name) => name.getAttribute('aria-expanded'))).toEqual(['true', null, 'true', 'true', null, null, null])
    click(arrow(m, 'Design'))
    expect(shownTexts(m)).toEqual(['Overview', 'Goals', 'Design', 'Rollout'])
    expect(names(m)[2].dataset.fold).toBe('closed')
    expect(names(m)[2].getAttribute('aria-expanded')).toBe('false')
    expect(m.jump).not.toHaveBeenCalled()
    // D2: the note never folds; the fold is saved for this note.
    expect(m.onChangeFolds).toHaveBeenLastCalledWith([key(1, 'Design')])
    click(arrow(m, 'Design'))
    expect(shownTexts(m)).toEqual(texts(TREE))
    expect(m.onChangeFolds).toHaveBeenLastCalledWith([])
    click(names(m)[6])
    expect(m.jump).toHaveBeenCalledWith(6)
  })

  it('D5: a folded row is current while the reader is in its section, at once and from the spy; the rail shows the same rows', async () => {
    const m = mount('pinned', TREE, 900)
    // The engine's rule: the last of the rows asked about that starts above the reader, who is in "Keys".
    m.current.mockImplementation((indices: readonly number[]) => indices.filter((index) => index <= 4).length - 1)
    await scrollFrame(m)
    expect(names(m)[4].getAttribute('aria-current')).toBe('true')
    click(arrow(m, 'Design'))
    expect(names(m)[2].getAttribute('aria-current')).toBe('true')
    // The spy is asked about the rows on show only.
    await scrollFrame(m)
    expect(m.current).toHaveBeenLastCalledWith([0, 1, 2, 6], m.scroller)
    expect(names(m)[2].getAttribute('aria-current')).toBe('true')
    // The lines look follows the list.
    m.render('auto')
    expect(lines(m)).toHaveLength(4)
  })

  it('D5: a fold never hides the table of contents itself, even when one row is left', () => {
    const m = mount('pinned', [{ level: 1, text: 'All' }, { level: 2, text: 'One' }, { level: 2, text: 'Two' }], 900)
    click(arrow(m, 'All'))
    expect(nav(m)).not.toBeNull()
    expect(shownTexts(m)).toEqual(['All'])
  })

  it('D6: → opens the focused name, ← folds it, and ← on a folded name or one with nothing under it goes to its parent', () => {
    const m = mount('pinned', TREE, 900)
    const press = (i: number, key: string): KeyboardEvent => {
      act(() => names(m)[i].focus())
      return keyOn(names(m)[i], key)
    }
    expect(press(4, 'ArrowLeft').defaultPrevented).toBe(true) // "Keys": nothing under it
    expect(document.activeElement?.textContent).toBe('Data model')
    press(3, 'ArrowLeft')
    expect(shownTexts(m)).toEqual(['Overview', 'Goals', 'Design', 'Data model', 'Limits', 'Rollout'])
    expect(document.activeElement?.textContent).toBe('Data model')
    press(3, 'ArrowLeft') // folded: up to its parent
    expect(document.activeElement?.textContent).toBe('Design')
    press(2, 'ArrowLeft')
    expect(shownTexts(m)).toEqual(['Overview', 'Goals', 'Design', 'Rollout'])
    press(2, 'ArrowRight')
    expect(shownTexts(m)).toEqual(['Overview', 'Goals', 'Design', 'Data model', 'Limits', 'Rollout'])
    press(3, 'ArrowRight')
    expect(shownTexts(m)).toEqual(texts(TREE))
    // → on a row with nothing under it, and ← on a top row with nothing under it, do nothing.
    press(6, 'ArrowRight')
    press(6, 'ArrowLeft')
    expect(shownTexts(m)).toEqual(texts(TREE))
    expect(document.activeElement?.textContent).toBe('Rollout')
    expect(m.jump).not.toHaveBeenCalled()
  })

  it('D1: the saved folds come back on the next mount, and a saved key whose row is gone is not written again', () => {
    const m = mount('pinned', TREE, 900, TOC_DEFAULT_W, [key(1, 'Design'), key(2, 'Renamed')])
    expect(shownTexts(m)).toEqual(['Overview', 'Goals', 'Design', 'Rollout'])
    click(arrow(m, 'Overview'))
    expect(m.onChangeFolds).toHaveBeenLastCalledWith([key(1, 'Overview'), key(1, 'Design')])
  })

  it('D4: one toggle with the icon and the words of every fold-all button: Collapse all, then Expand all', () => {
    const m = mount('pinned', TREE, 900)
    const button = foldAll(m)
    expect(button.closest('.toc__tools')).not.toBeNull()
    expect(button.getAttribute('aria-label')).toBe('Collapse all')
    expect(button.title).toBe('Collapse all')
    const collapseIcon = button.innerHTML
    click(button)
    expect(shownTexts(m)).toEqual(['Overview', 'Design', 'Rollout'])
    expect(m.onChangeFolds).toHaveBeenLastCalledWith([key(1, 'Overview'), key(1, 'Design'), key(2, 'Data model')])
    expect(foldAll(m).getAttribute('aria-label')).toBe('Expand all')
    expect(foldAll(m).innerHTML).not.toBe(collapseIcon)
    click(foldAll(m))
    expect(shownTexts(m)).toEqual(texts(TREE))
    // One row opened again after Collapse all: something is open, so the next click collapses.
    click(foldAll(m))
    click(arrow(m, 'Design'))
    expect(foldAll(m).getAttribute('aria-label')).toBe('Collapse all')
    expect(m.jump).not.toHaveBeenCalled()
  })

  it('D4: in a pinned column too narrow for auto, "Unpin", the zoom and the fold-all button share the top row, "Unpin" first', () => {
    const m = mount('pinned', TREE, 1040 + TOC_WIDTH - 1)
    const tools = m.section.querySelector('.toc__tools')
    expect([...(tools?.querySelectorAll('button') ?? [])].map((el) => el.getAttribute('aria-label') ?? el.textContent)).toEqual(['Unpin', 'Zoom the table of contents out', '100%', 'Zoom the table of contents in', 'Collapse all'])
  })

  /**
   * jsdom lays nothing out: the nav is 800px tall, and the rail centers a card of 24px per name and 40px more
   * (its offset parent is the nav). Returns the undo.
   */
  const layOutCard = (): (() => void) => {
    const keys = ['offsetTop', 'offsetHeight', 'clientHeight'] as const
    const before = keys.map((key) => Object.getOwnPropertyDescriptor(HTMLElement.prototype, key))
    const height = (el: HTMLElement): number => el.querySelectorAll('.toc__name').length * 24 + 40
    const laidOut: Record<(typeof keys)[number], (el: HTMLElement) => number> = {
      offsetTop: (el) => (el.matches('.toc__card') ? (800 - height(el)) / 2 : 0),
      offsetHeight: (el) => (el.matches('.toc__card') ? height(el) : 0),
      clientHeight: (el) => (el.matches('nav.toc') ? 800 : 0),
    }
    for (const key of keys) Object.defineProperty(HTMLElement.prototype, key, { configurable: true, get(this: HTMLElement) { return laidOut[key](this) } })
    return () =>
      keys.forEach((key, i) => {
        const was = before[i]
        if (was === undefined) delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key]
        else Object.defineProperty(HTMLElement.prototype, key, was)
      })
  }

  it('the card keeps its top while it is open: Collapse all, an unfold and Expand all change its height at its bottom, inside the box (YAZ-4050)', () => {
    const undo = layOutCard()
    try {
      // Five parents with two names each: 15 names, a card of 400px at 200px.
      const FIFTEEN: TocRow[] = ['A', 'B', 'C', 'D', 'E'].flatMap((p) => [{ level: 1 as TocLevel, text: p }, { level: 2 as TocLevel, text: `${p}1` }, { level: 2 as TocLevel, text: `${p}2` }])
      const m = mount('auto', FIFTEEN, NAMES_FLOOR)
      click(rail(m))
      const shift = (): string => m.section.querySelector<HTMLElement>('.toc__card')!.style.getPropertyValue('--toc-card-shift')
      // Its first place is the centered one.
      expect(shift()).toBe('')
      // Collapse all: 5 names, 160px, centered at 320px; moved back up to 200px.
      click(foldAll(m))
      expect(names(m)).toHaveLength(5)
      expect(shift()).toBe('-120px')
      // Open "A": 7 names, 208px, centered at 296px; back to 200px.
      click(names(m)[0].querySelector<HTMLElement>('.toc__fold')!)
      expect(shift()).toBe('-96px')
      // "A" is open, so the button collapses all again; then it expands all: 400px, centered at 200px again.
      click(foldAll(m))
      expect(shift()).toBe('-120px')
      click(foldAll(m))
      expect(names(m)).toHaveLength(15)
      expect(shift()).toBe('')
      expect(tocCss.match(/\.toc__card\s*\{([^}]*)\}/s)?.[1]).toMatch(/translate:\s*0 var\(--toc-card-shift, 0px\);/)
    } finally {
      undo()
    }
  })

  it('a card that opens short and then grows keeps its top until the bottom of the box stops it (YAZ-4050)', () => {
    const undo = layOutCard()
    try {
      // 25 names in five parents; all folded: 5 names, a card of 160px at 320px.
      const BIG: TocRow[] = ['A', 'B', 'C', 'D', 'E'].flatMap((p) => [{ level: 1 as TocLevel, text: p }, ...[1, 2, 3, 4].map((n) => ({ level: 2 as TocLevel, text: `${p}${n}` }))])
      const folds = tocFoldKeys(BIG).filter((_, i) => i % 5 === 0)
      const m = mount('auto', BIG, NAMES_FLOOR, TOC_DEFAULT_W, folds)
      click(rail(m))
      expect(names(m)).toHaveLength(5)
      // Expand all: 640px. Its top stays at 320px only down to the box's bottom edge.
      click(foldAll(m))
      const shift = m.section.querySelector<HTMLElement>('.toc__card')!.style.getPropertyValue('--toc-card-shift')
      expect(shift).toBe(`${800 - EDGE_PX - 640 - 80}px`)
    } finally {
      undo()
    }
  })

  it('a card opened again while it fades out keeps its top too: the old shift goes on the new open (YAZ-4075)', () => {
    fakeClock()
    const undo = layOutCard()
    try {
      const FIFTEEN: TocRow[] = ['A', 'B', 'C', 'D', 'E'].flatMap((p) => [{ level: 1 as TocLevel, text: p }, { level: 2 as TocLevel, text: `${p}1` }, { level: 2 as TocLevel, text: `${p}2` }])
      const m = mount('auto', FIFTEEN, NAMES_FLOOR)
      click(rail(m))
      // Collapse all: 5 names, 160px; the card is held at its first top, 200px.
      click(foldAll(m))
      const el = (): HTMLElement => m.section.querySelector<HTMLElement>('.toc__card')!
      const top = (): number => el().offsetTop + (parseFloat(el().style.getPropertyValue('--toc-card-shift')) || 0)
      expect(top()).toBe(200)
      // Close the card. It fades out for 140 ms. Open it again before the fade ends: the same element.
      act(() => {
        vi.advanceTimersByTime(400)
      })
      click(rail(m))
      expect(m.section.querySelector('.toc__card[data-leaving]')).not.toBeNull()
      act(() => {
        vi.advanceTimersByTime(50)
      })
      click(rail(m))
      expect(m.section.querySelector('.toc__card[data-leaving]')).toBeNull()
      const opened = top()
      // Open "A": the card grows. Its top stays where it opened.
      click(names(m)[0].querySelector<HTMLElement>('.toc__fold')!)
      expect(top()).toBe(opened)
    } finally {
      undo()
    }
  })

  it('D4: with no row that can fold, the button stays, dimmed, and says "Nothing to fold"; the card has the button too', () => {
    const flat = mount('pinned', [{ level: 2, text: 'A' }, { level: 2, text: 'B' }], 900)
    expect(foldAll(flat).getAttribute('aria-label')).toBe('Nothing to fold')
    expect(foldAll(flat).disabled).toBe(true)
    const lined = mount('auto', TREE, NAMES_FLOOR)
    expect(lined.section.querySelector('.toc__pin--all')).toBeNull() // the rail has none
    click(rail(lined))
    const inCard = foldAll(lined)
    expect(inCard.closest('.toc__header')).not.toBeNull()
    click(inCard)
    expect(shownTexts(lined)).toEqual(['Overview', 'Design', 'Rollout'])
  })
})

describe('the stylesheet of the folds (YAZ-3939 D3, D4)', () => {
  const rules = (): Array<[string, string]> => [...tocCss.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/gs, '').replace(/\/\*.*?\*\//gs, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => [selector.trim().replace(/\s+/g, ' '), body])
  const body = (selector: string): string => rules().find(([sel]) => sel === selector)?.[1] ?? ''
  const at = (selector: string): number => rules().findIndex(([sel]) => sel === selector)

  it('the arrow is hidden until the mouse or the focus is in the list, or the row is folded; a folded row turns it right', () => {
    expect(body('.toc__fold')).toMatch(/opacity:\s*0;/)
    expect(body('.toc__names:hover .toc__fold, .toc__names:focus-within .toc__fold, .toc__name[data-fold=\'closed\'] .toc__fold')).toMatch(/opacity:\s*1;/)
    expect(body('.toc__name[data-fold=\'closed\'] .toc__fold > svg')).toMatch(/transform:\s*rotate\(-90deg\);/)
    // In the last 16px of the indent, between the level line and the name (demo 5A): the name never moves.
    expect(body('.toc__fold')).toMatch(/left:\s*calc\(var\(--toc-indent\) - 16px\);/)
    expect(body('.toc__fold')).toMatch(/width:\s*16px;/)
  })

  it('where the arrow shows, the level piece goes: the rule stands after the `1t` rule, which has the same weight', () => {
    const hide = ".toc__names:hover .toc__name[data-fold], .toc__names:focus-within .toc__name[data-fold], .toc__name[data-fold='closed']"
    expect(body(hide)).toMatch(/--toc-piece:\s*transparent;/)
    expect(at(hide)).toBeGreaterThan(at(".toc__name[data-path='1t']"))
  })

  it('the fold-all button dims with no hover when there is nothing to fold', () => {
    expect(body('.toc__pin--all:disabled, .toc__pin--all:disabled:hover')).toMatch(/opacity:\s*0\.35;[\s\S]*background:\s*none;/)
  })
})

describe('the zoom of the names (YAZ-3939 D7–D10, demo 5B)', () => {
  const PARENTS: TocRow[] = [
    { level: 1, text: 'Overview' },
    { level: 2, text: 'Goals' },
    { level: 1, text: 'Rollout' },
  ]
  const zoomButton = (m: Mounted, label: string): HTMLButtonElement => {
    const el = m.section.querySelector<HTMLButtonElement>(`.toc__zoom button[aria-label^="${label}"]`)
    if (!el) throw new Error(`no zoom button "${label}"`)
    return el
  }
  const zoomEvent = (target: Element, step: -1 | 0 | 1): CustomEvent => {
    const event = new CustomEvent(ZOOM_EVENT, { detail: step, bubbles: true, cancelable: true })
    act(() => {
      target.dispatchEvent(event)
    })
    return event
  }

  it('D10: the zoom is a variable on the nav that only the names read', () => {
    const m = mount('pinned', PARENTS, 900, TOC_DEFAULT_W, [], 150)
    expect(nav(m)?.style.getPropertyValue('--toc-zoom')).toBe('1.5')
    const names = tocCss.match(/\.toc__names\s*\{([^}]*)\}/s)?.[1] ?? ''
    expect(names).toMatch(/zoom:\s*var\(--toc-zoom, 1\);/)
    // No other rule zooms: the header, the rail and the card keep their size.
    expect([...tocCss.matchAll(/(^|[;{\s])zoom:/g)]).toHaveLength(1)
  })

  it('D7: the header has the sidebar\'s "− 100% +" before the fold-all button; − and + walk the steps, the percent goes back to 100%', () => {
    const m = mount('pinned', PARENTS, 900, TOC_DEFAULT_W, [], 125)
    const ends = m.section.querySelector('.toc__tools .toc__ends')
    expect([...(ends?.querySelectorAll('button') ?? [])].map((el) => el.getAttribute('aria-label') ?? el.textContent)).toEqual(['Zoom the table of contents out', '125%', 'Zoom the table of contents in', 'Collapse all'])
    click(zoomButton(m, 'Zoom the table of contents in'))
    expect(m.onChangeZoom).toHaveBeenLastCalledWith(150)
    click(zoomButton(m, 'Zoom the table of contents out'))
    expect(m.onChangeZoom).toHaveBeenLastCalledWith(100)
    click(buttonNamed(m, '125%')!)
    expect(m.onChangeZoom).toHaveBeenLastCalledWith(100)
  })

  it('D7: with "Unpin" in a narrow column, and in the card, the zoom is an icon that opens a box; Esc and a click outside close it, and Esc there leaves the table of contents open', () => {
    const narrow = mount('pinned', PARENTS, 1040 + TOC_WIDTH - 1, TOC_MIN_W)
    expect(narrow.section.querySelector('.toc__zoom .zoom-stepper')).toBeNull()
    const icon = zoomButton(narrow, 'Table of contents zoom')
    expect(icon.getAttribute('aria-label')).toBe('Table of contents zoom: 100%')
    expect(icon.getAttribute('aria-expanded')).toBe('false')
    click(icon)
    expect(icon.getAttribute('aria-expanded')).toBe('true')
    const box = narrow.section.querySelector<HTMLElement>('.toc__zoom-box')!
    click(zoomButton(narrow, 'Zoom the table of contents in'))
    expect(narrow.onChangeZoom).toHaveBeenLastCalledWith(125)
    keyOn(box.querySelector('button')!, 'Escape')
    expect(narrow.section.querySelector('.toc__zoom-box')).toBeNull()
    expect(narrow.onReturnFocus).not.toHaveBeenCalled()
    click(icon)
    act(() => {
      narrow.mountEl.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    })
    expect(narrow.section.querySelector('.toc__zoom-box')).toBeNull()
    // Without "Unpin" the same width has room for "− 100% +".
    const roomy = mount('pinned', PARENTS, 1040 + TOC_WIDTH + 200, TOC_MIN_W)
    expect(roomy.section.querySelector('.toc__zoom .zoom-stepper')).not.toBeNull()
    // The card is narrow: the icon, in its header.
    const lined = mount('auto', PARENTS, NAMES_FLOOR)
    click(rail(lined))
    expect(zoomButton(lined, 'Table of contents zoom').closest('.toc__header')).not.toBeNull()
  })

  it('D8: ⌘+ / ⌘− / ⌘0 with the focus in the table of contents zoom the names and never reach the note; with the focus in the note they are not claimed', () => {
    const m = mount('pinned', PARENTS, 900, TOC_DEFAULT_W, [], 100)
    const noteListener = vi.fn()
    m.section.addEventListener(ZOOM_EVENT, noteListener)
    names(m)[0].focus()
    expect(zoomEvent(names(m)[0], 1).defaultPrevented).toBe(true)
    expect(m.onChangeZoom).toHaveBeenLastCalledWith(125)
    zoomEvent(names(m)[0], -1)
    expect(m.onChangeZoom).toHaveBeenLastCalledWith(90)
    zoomEvent(names(m)[0], 0)
    expect(m.onChangeZoom).toHaveBeenLastCalledWith(100)
    expect(noteListener).not.toHaveBeenCalled()
    m.mountEl.focus()
    expect(zoomEvent(m.mountEl, 1).defaultPrevented).toBe(false)
    expect(noteListener).toHaveBeenCalledTimes(1)
    expect(m.onChangeZoom).toHaveBeenCalledTimes(3)
  })

  it('D7: the zoom shows while the mouse or the focus is in the table of contents, and while its box is open', () => {
    const body = (selector: string): string => [...tocCss.replace(/\/\*.*?\*\//gs, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(([, sel]) => sel.trim().replace(/\s+/g, ' ') === selector)?.[2] ?? ''
    expect(body('.toc__zoom')).toMatch(/opacity:\s*0;/)
    expect(body('.toc:hover .toc__zoom, .toc:focus-within .toc__zoom, .toc__zoom[data-open]')).toMatch(/opacity:\s*1;/)
  })
})

describe('clean-up', () => {
  it('an unmounted table of contents answers no ⌘J and no wheel', () => {
    const m = mount('auto')
    act(() => m.root.unmount())
    expect(pressCmdJ(document.body).defaultPrevented).toBe(false)
    expect(() => m.scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: 40 }))).not.toThrow()
    // afterEach unmounts again; a second unmount of a root is a no-op.
  })
})
