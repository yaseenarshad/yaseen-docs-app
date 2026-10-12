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
import appCss from '../../app.css?inline'
import { COLUMN_MAX, MAX_ROWS, namesShow, NAMES_FLOOR, railPitch, shownHeadings, TableOfContents, TOC_WIDTH } from './TableOfContents'
import tocCss from './toc.css?inline'
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
    // The right panel, 320px wide: lines, pinned or not.
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

  it('a nudge of the trackpad opens nothing: the wheel must travel 40px in ONE burst, and two turns more than 300 ms apart are two bursts', () => {
    fakeClock()
    const m = mount('auto')
    wheel(m, { deltaY: 39 })
    expect(card(m)).toBeNull()
    // The burst is over: its 39px do not count toward the next one.
    vi.advanceTimersByTime(301)
    wheel(m, { deltaY: 39 })
    expect(card(m)).toBeNull()
    // The same burst, 100 ms on, and upward: travel counts both ways.
    vi.advanceTimersByTime(100)
    wheel(m, { deltaY: -1 })
    expect(card(m)).not.toBeNull()
  })

  describe('a card the wheel opened FOLLOWS the note', () => {
    const hover = (m: Mounted): HTMLElement => m.section.querySelector<HTMLElement>('.toc__hover')!
    /** A list longer than its box: toc.css would let the wheel scroll it. */
    const makeLong = (m: Mounted): void => {
      Object.defineProperties(m.section.querySelector('.toc__names')!, { scrollHeight: { configurable: true, value: 900 }, clientHeight: { configurable: true, value: 300 } })
    }
    const wheelOver = (el: Element, deltaY = 30): void =>
      act(() => {
        el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY }))
      })
    /** A mouse move as the browser reports it; `by` 0 is the re-hit-test after the card appeared under a mouse at rest. */
    const mouseMove = (el: Element, by: number): void =>
      act(() => {
        el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, movementX: by, screenX: by }))
      })

    it('the wheel over it still moves the NOTE, though its list is long; a real move of the mouse on it ends that, and then the list keeps the wheel', () => {
      const m = mount('auto')
      wheel(m)
      expect(hover(m).hasAttribute('data-follow')).toBe(true)
      makeLong(m)
      wheelOver(names(m)[1])
      expect(m.scroller.scrollTop).toBe(30)
      // The card came up under a mouse that did not move: no move, so it still follows.
      mouseMove(hover(m), 0)
      expect(hover(m).hasAttribute('data-follow')).toBe(true)
      wheelOver(names(m)[1])
      expect(m.scroller.scrollTop).toBe(60)
      // Now the reader means the card.
      mouseMove(hover(m), 2)
      expect(hover(m).hasAttribute('data-follow')).toBe(false)
      wheelOver(names(m)[1])
      expect(m.scroller.scrollTop).toBe(60)
    })

    it('a card the reader opened by hand does not follow — the mouse, a click, ⌘J — and one opened by hand after a wheel has stopped following', () => {
      fakeClock()
      const byClick = mount('auto')
      click(rail(byClick))
      expect(hover(byClick).hasAttribute('data-follow')).toBe(false)
      const byKey = mount('auto')
      act(() => byKey.mountEl.focus())
      pressCmdJ(byKey.mountEl)
      expect(hover(byKey).hasAttribute('data-follow')).toBe(false)

      const m = mount('auto')
      wheel(m)
      expect(hover(m).hasAttribute('data-follow')).toBe(true)
      // It closes 1.5 s after the turn; the mouse on the rail opens it again, and this time the reader asked for it.
      act(() => {
        vi.advanceTimersByTime(1500)
      })
      expect(card(m)).toBeNull()
      act(() => {
        hover(m).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      })
      expect(card(m)).not.toBeNull()
      expect(hover(m).hasAttribute('data-follow')).toBe(false)
      makeLong(m)
      wheelOver(names(m)[1])
      expect(m.scroller.scrollTop).toBe(0)
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

  it('"Unpin" and "Pin" are offered only where they change what the reader sees, each with its pin and its tooltip', () => {
    // Always, and "When there is room" would give the names here too: nothing to unpin.
    const roomy = mount('pinned', HEADINGS, 1040 + TOC_WIDTH)
    expect(nav(roomy)?.hasAttribute('data-names')).toBe(true)
    expect(buttonNamed(roomy, 'Unpin')).toBeUndefined()
    // The same window with a medium column: the names stand only because of "Always".
    roomy.render('pinned', 'medium')
    expect(buttonNamed(roomy, 'Unpin')).toBeDefined()
    // One pixel short of room, and a full-width column at any width: "When there is room" would give lines.
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
  const TEN: TocHeading[] = Array.from({ length: 10 }, (_, i) => ({ level: 1, text: `Part ${i}` }))
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

  it('ONE scrollbar, the note’s: a list shows none, keeps the wheel at its ends, and does not scroll by itself while its card follows; the names take their 200px from the scroller', () => {
    const list = rule(tocCss, '.toc__names')
    expect(list).toMatch(/overflow-y:\s*auto;/)
    expect(list).toMatch(/scrollbar-width:\s*none;/)
    expect(list).toMatch(/overscroll-behavior:\s*contain;/)
    expect(rule(tocCss, '.toc__hover[data-follow] .toc__names')).toMatch(/overflow-y:\s*hidden;/)
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

  it('the row under the mouse is the soft accent, the current one stays the accent; the current line is 5px longer; the card is 440px tall at most', () => {
    expect(rule(tocCss, '.toc__name:hover')).toMatch(/background:\s*var\(--accent-soft\);/)
    expect(rule(tocCss, ".toc__name[aria-current='true']:hover")).toMatch(/color:\s*var\(--accent\);/)
    expect(rule(tocCss, '.toc__line[data-current]')).toMatch(/width:\s*calc\(var\(--toc-w\) \+ 5px\);/)
    expect(rule(tocCss, '.toc__card')).toMatch(/max-height:\s*min\([^;]*440px\);/)
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
