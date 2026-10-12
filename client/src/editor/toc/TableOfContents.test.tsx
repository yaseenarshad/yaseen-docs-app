/**
 * The table of contents (YAZ-2700): its three pure rules — `namesShow`, `shownHeadings`,
 * `railPitch` — and the component, driven through a real `TocChannel` with a stand-in engine
 * (tocPlugin.test.ts proves the engine; this file proves what is drawn and what the mouse and the
 * keyboard do).
 *
 * The component is mounted the way CrepeHost mounts it: a sibling of `.editor-host` inside a
 * `section.editor`. jsdom lays nothing out, so a section is given the width a test wants.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ContentWidth, TableOfContents as TableOfContentsMode } from '@shared/types'
import { COLUMN_MAX, MAX_ROWS, namesShow, NAMES_FLOOR, railPitch, shownHeadings, TableOfContents, TOC_WIDTH } from './TableOfContents'
import { createTocChannel, type TocChannel, type TocHeading } from './tocChannel'

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
    // The right panel, 320px wide: lines, kept open or not.
    expect(namesShow('pinned', 320, COLUMN_MAX.narrow)).toBe(false)
    expect(namesShow('auto', 320, COLUMN_MAX.narrow)).toBe(false)
  })

  it('off shows neither look; the component draws nothing at all', () => {
    expect(namesShow('off', 5000, 1040)).toBe(false)
  })

  it('the column widths are app.css\'s --content-max-width values', () => {
    expect(COLUMN_MAX).toEqual({ narrow: 1040, medium: 1440, full: Infinity })
    expect(TOC_WIDTH).toBe(200)
    expect(NAMES_FLOOR).toBe(700)
  })
})

describe('shownHeadings: which rows, and where each stands in the full list', () => {
  const many = (level: 1 | 2 | 3, count: number, name: string): TocHeading[] => Array.from({ length: count }, (_, i) => ({ level, text: `${name} ${i}` }))

  it('200 or fewer: all of H1-H3, each with its own index', () => {
    const all: TocHeading[] = [
      { level: 1, text: 'One' },
      { level: 2, text: 'Two' },
      { level: 3, text: 'Three' },
    ]
    expect(shownHeadings(all)).toEqual([
      { level: 1, text: 'One', index: 0 },
      { level: 2, text: 'Two', index: 1 },
      { level: 3, text: 'Three', index: 2 },
    ])
    expect(shownHeadings([...many(1, 50, 'a'), ...many(2, 50, 'b'), ...many(3, 100, 'c')])).toHaveLength(MAX_ROWS)
    expect(shownHeadings([])).toEqual([])
  })

  it('more than 200: H1-H2, and a row keeps its index in the FULL list', () => {
    const all = [{ level: 1, text: 'One' } as TocHeading, ...many(3, 201, 'deep'), { level: 2, text: 'Two' } as TocHeading]
    expect(shownHeadings(all)).toEqual([
      { level: 1, text: 'One', index: 0 },
      { level: 2, text: 'Two', index: 202 },
    ])
  })

  it('H1-H2 still more than 200: H1 only', () => {
    const all = [...many(2, 201, 'two'), { level: 1, text: 'One' } as TocHeading, ...many(3, 5, 'three'), { level: 1, text: 'Other' } as TocHeading]
    expect(shownHeadings(all)).toEqual([
      { level: 1, text: 'One', index: 201 },
      { level: 1, text: 'Other', index: 207 },
    ])
  })

  it('never more than 200 rows, even of H1 alone', () => {
    const rows = shownHeadings(many(1, 250, 'one'))
    expect(rows).toHaveLength(MAX_ROWS)
    expect(rows[MAX_ROWS - 1].index).toBe(MAX_ROWS - 1)
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

const HEADINGS: TocHeading[] = [
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
  onReturnFocus: ReturnType<typeof vi.fn>
  render: (mode: TableOfContentsMode, contentWidth?: ContentWidth) => void
}

const mounts: Mounted[] = []

/** CrepeHost's DOM: `section.editor` > `.editor-host` > `.editor-mount`, the table of contents beside the scroller. */
function mount(mode: TableOfContentsMode, headings: readonly TocHeading[] = HEADINGS, width = 0): Mounted {
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
  const onReturnFocus = vi.fn()
  const root = createRoot(slot)
  const render = (next: TableOfContentsMode, contentWidth: ContentWidth = 'narrow'): void =>
    act(() => {
      root.render(<TableOfContents channel={channel} mode={next} contentWidth={contentWidth} onChangeMode={onChangeMode} hostRef={{ current: mountEl }} onReturnFocus={onReturnFocus} />)
    })
  render(mode)
  const mounted = { root, section, scroller, mountEl, channel, jump, current, onChangeMode, onReturnFocus, render }
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

  it('kept open in a note too narrow for names: lines still, and nothing to keep open', () => {
    const m = mount('pinned', HEADINGS, 320)
    expect(nav(m)?.hasAttribute('data-names')).toBe(false)
    click(rail(m))
    expect(buttonNamed(m, 'Pin')).toBeUndefined()
    expect(buttonNamed(m, 'Unpin')).toBeUndefined()
  })
})

describe('names while you scroll', () => {
  const wheel = (m: Mounted, init: WheelEventInit = { deltaY: 40 }): void =>
    act(() => {
      m.scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true, ...init }))
    })

  it('a turn of the wheel over the note opens the card; it closes 1500 ms after the LAST one', () => {
    fakeClock()
    const m = mount('auto')
    wheel(m)
    expect(card(m)).not.toBeNull()
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    wheel(m)
    act(() => {
      vi.advanceTimersByTime(1499)
    })
    expect(card(m)).not.toBeNull()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(card(m)).toBeNull()
  })

  it('it stays while the keyboard is inside it', () => {
    fakeClock()
    const m = mount('auto')
    wheel(m)
    act(() => names(m)[0].focus())
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(card(m)).not.toBeNull()
  })

  it('a scroll with no wheel — typing at the bottom of the window, a jump — opens nothing', async () => {
    const m = mount('auto')
    await scrollFrame(m)
    expect(card(m)).toBeNull()
  })

  it('a sideways turn and a pinch open nothing', () => {
    const m = mount('auto')
    wheel(m, { deltaX: 40, deltaY: 0 })
    wheel(m, { deltaY: 40, ctrlKey: true })
    expect(card(m)).toBeNull()
  })

  it('in names mode the wheel opens no card: the names are there already', () => {
    const m = mount('auto', HEADINGS, 1300)
    wheel(m)
    expect(card(m)).toBeNull()
  })
})

describe('names: the column', () => {
  it('auto with room for the text column and the names: data-names, the names at once, no button', () => {
    const m = mount('auto', HEADINGS, 1040 + TOC_WIDTH)
    expect(nav(m)?.hasAttribute('data-names')).toBe(true)
    expect(names(m).map((name) => name.textContent)).toEqual(['Part 1', 'Section A', 'Deep dive', 'Section B', 'Part 2'])
    expect(lines(m)).toHaveLength(0)
    expect(m.section.querySelector('.toc__keep')).toBeNull()
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
    const deep: TocHeading[] = Array.from({ length: 201 }, (_, i) => ({ level: 3, text: `Deep ${i}` }))
    const m = mount('pinned', [HEADINGS[0], ...deep, HEADINGS[4]], 900)
    await scrollFrame(m)
    expect(m.current).toHaveBeenLastCalledWith([0, 202], m.scroller)
  })
})

describe('click = jump', () => {
  it('a click on a name calls jump with the index in the FULL list, not the row', () => {
    const deep: TocHeading[] = Array.from({ length: 201 }, (_, i) => ({ level: 3, text: `Deep ${i}` }))
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

describe('clean-up', () => {
  it('an unmounted table of contents answers no ⌘J and no wheel', () => {
    const m = mount('auto')
    act(() => m.root.unmount())
    expect(pressCmdJ(document.body).defaultPrevented).toBe(false)
    expect(() => m.scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: 40 }))).not.toThrow()
    // afterEach unmounts again; a second unmount of a root is a no-op.
  })
})
