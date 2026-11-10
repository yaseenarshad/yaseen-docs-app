/**
 * Where you are in a grouped folder table (YAZ-4798): each header's span, the numbers that make a header stick and
 * leave, the lines' places, the thread's marks and "On hover".
 */
import { afterEach, describe, expect, it } from 'vitest'
import { groupLinesHover, groupSpans, groupThread, holdersOf, measureGroupGuides, stuckDistance, windowedGuide, windowedLine } from './groupGuides'

/*
 * 0 A          (level 0)
 * 1   row
 * 2   A.1      (level 1)
 * 3     row
 * 4     row
 * 5   A.2      (level 1)
 * 6     row
 * 7 B          (level 0)
 * 8   row
 */
const TWO_LEVELS = [0, null, 1, null, null, 1, null, 0, null]

describe('groupSpans (YAZ-4798)', () => {
  it('each header spans its group to its last line; the stack that leaves with it reaches the innermost level at that line', () => {
    const { spans, holder } = groupSpans(TWO_LEVELS, 0)
    expect(spans.map(({ at, depth, slot, last, endDepth, parent }) => [at, depth, slot, last, endDepth, parent])).toEqual([
      [0, 0, 0, 6, 1, -1],
      [2, 1, 1, 4, 1, 0],
      [5, 1, 1, 6, 1, 0],
      [7, 0, 0, 8, 0, -1],
    ])
    expect([...holder]).toEqual([-1, 0, 0, 2, 2, 0, 5, -1, 7])
    expect(holdersOf(holder, 6)).toEqual([5, 0])
    expect(holdersOf(holder, 7)).toEqual([])
    expect(holdersOf(holder, -1)).toEqual([])
  })

  it('a collapsed group ends at its header; a group whose last line is a collapsed child leaves with that child alone', () => {
    const { spans } = groupSpans([0, 1, 1, null, 0, 1], 0)
    expect(spans.map((s) => [s.at, s.last, s.endDepth])).toEqual([
      [0, 3, 1],
      [1, 1, 1],
      [2, 3, 1],
      [4, 5, 1],
      [5, 5, 1],
    ])
  })

  it('frozen rows: a header under a frozen header takes the frozen level\'s slot', () => {
    const { spans } = groupSpans(TWO_LEVELS, 2)
    // Lines 0 and 1 are frozen: A shows in the frozen rows, so A.1 and A.2 stick in the first slot, under them.
    expect(spans.map((s) => [s.at, s.slot])).toEqual([[0, 0], [2, 0], [5, 0], [7, 0]])
  })
})

describe('the counted numbers of a windowed table (YAZ-4798)', () => {
  const { spans } = groupSpans(TWO_LEVELS, 0)
  it('lift: how far a header is below its slot; room: how far it moves before its group pushes it out with its stack', () => {
    // A at line 0, its slot the top: it sticks at once, and leaves when its group (7 rows) has 2 rows left (A and A.2).
    expect(windowedGuide(spans[0], 0, 0, 28)).toEqual({ lift: 0, room: 5 * 28 })
    // A.2 at line 5, its slot one row down: it reaches it 4 rows on, and leaves 1 row later.
    expect(windowedGuide(spans[2], 5, 0, 28)).toEqual({ lift: -4 * 28, room: 28 })
    // Lifted above the window to body place 1: the same place on screen, from a place 4 rows higher.
    expect(windowedGuide(spans[2], 1, 0, 28)).toEqual({ lift: 0, room: 5 * 28 })
  })

  it('a line runs from under its chevron to the bottom of its last row', () => {
    expect(windowedLine(spans[0], 28)).toEqual({ top: 14 + 8, height: 7 * 28 - 14 - 8 })
  })
})

describe('measureGroupGuides (YAZ-4798)', () => {
  afterEach(() => document.body.replaceChildren())

  it('writes each header row\'s lift and room and each line\'s top and height from the rows\' offsets; frozen headers get no lift', () => {
    const table = document.createElement('table')
    table.innerHTML = `<caption><div class="view-table__lines">${[0, 2, 5].map((at) => `<i data-seg="${at}"></i>`).join('')}</div></caption><thead><tr><th></th></tr></thead><tbody>${TWO_LEVELS.slice(0, 7).map((_, j) => `<tr data-line="${j}"><td></td></tr>`).join('')}</tbody>`
    document.body.append(table)
    const place = (el: HTMLElement, top: number, height: number) => {
      Object.defineProperty(el, 'offsetTop', { value: top })
      Object.defineProperty(el, 'offsetHeight', { value: height })
    }
    place(table.tHead!, 0, 30)
    // Row 3 wraps: 50px tall.
    let top = 30
    for (const tr of table.tBodies[0].rows) {
      const h = tr.dataset.line === '3' ? 50 : 28
      place(tr, top, h)
      top += h
    }
    const { spans } = groupSpans(TWO_LEVELS.slice(0, 7), 1)
    expect(measureGroupGuides(table, spans, 1, 28)).toBe(true)
    const rows = table.tBodies[0].rows
    expect(rows[0].style.getPropertyValue('--view-group-lift')).toBe('')
    // A is frozen (row 0), so A.1 takes the first slot, under the frozen row: 58. It stands at 86.
    expect(rows[2].style.getPropertyValue('--view-group-lift')).toBe('-28px')
    // Its group ends at row 4's bottom, 164 + 28 = 192 (row 3 is 50px); one row stacks at its end.
    expect(rows[2].style.getPropertyValue('--view-group-room')).toBe(`${192 - 28 - 86}px`)
    // A's line: from under its chevron (30 + 14 + 8) to row 6's bottom (220 + 28).
    const line = table.querySelector<HTMLElement>('[data-seg="0"]')!
    expect(line.style.getPropertyValue('--view-line-top')).toBe('52px')
    expect(line.style.getPropertyValue('--view-line-h')).toBe('196px')
  })

  it('writes nothing when the rows are not the lines in order (a windowed table)', () => {
    const table = document.createElement('table')
    table.innerHTML = '<tbody><tr class="view-table__spacer"><td></td></tr><tr data-line="0"><td></td></tr></tbody>'
    expect(measureGroupGuides(table, groupSpans([0], 0).spans, 0, 28)).toBe(false)
    expect(table.querySelector<HTMLElement>('[data-line="0"]')!.style.getPropertyValue('--view-group-lift')).toBe('')
  })
})

describe('the pointer (YAZ-4798)', () => {
  afterEach(() => document.body.replaceChildren())

  const build = () => {
    const table = document.createElement('table')
    table.innerHTML = `<caption><div class="view-table__lines">${[0, 2, 5, 7].map((at) => `<i data-seg="${at}"></i>`).join('')}</div></caption><tbody>${TWO_LEVELS.map((_, j) => `<tr data-line="${j}"><td>${j}</td></tr>`).join('')}</tbody>`
    document.body.append(table)
    return table
  }
  const marked = (table: HTMLElement) => [...table.querySelectorAll('[data-on-path]')].map((el) => (el instanceof HTMLTableRowElement ? `row ${el.dataset.line}` : `line ${(el as HTMLElement).dataset.seg}`))

  it('Thread: the headers and lines of the groups that hold the row under the pointer, and only those; leaving clears them', () => {
    const table = build()
    const { holder } = groupSpans(TWO_LEVELS, 0)
    const stop = groupThread(table, () => holder)
    const over = (j: number) => table.querySelector(`tr[data-line="${j}"] td`)!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    over(6)
    expect(marked(table).sort()).toEqual(['line 0', 'line 5', 'row 0', 'row 5'])
    over(3)
    expect(marked(table).sort()).toEqual(['line 0', 'line 2', 'row 0', 'row 2'])
    // A header's path is the groups above it.
    over(2)
    expect(marked(table).sort()).toEqual(['line 0', 'row 0'])
    table.dispatchEvent(new MouseEvent('mouseleave'))
    expect(marked(table)).toEqual([])
    over(8)
    stop()
    expect(marked(table)).toEqual([])
  })

  it('On hover: data-mouse-in on the lines\' box only, while the pointer is over the table', () => {
    const table = build()
    const stop = groupLinesHover(table)
    const box = table.querySelector('.view-table__lines')!
    table.dispatchEvent(new MouseEvent('mouseenter'))
    expect(box.hasAttribute('data-mouse-in')).toBe(true)
    expect(table.hasAttribute('data-mouse-in')).toBe(false)
    table.dispatchEvent(new MouseEvent('mouseleave'))
    expect(box.hasAttribute('data-mouse-in')).toBe(false)
    table.dispatchEvent(new MouseEvent('mouseenter'))
    stop()
    expect(box.hasAttribute('data-mouse-in')).toBe(false)
  })

  it('stuckDistance: the header\'s offset now (header-y + lift), 0 when it is in its own place', () => {
    const wrap = document.createElement('div')
    const tr = document.createElement('tr')
    wrap.style.setProperty('--view-table-header-y', '100px')
    tr.style.setProperty('--view-group-lift', '-40px')
    expect(stuckDistance(wrap, tr)).toBe(60)
    tr.style.setProperty('--view-group-lift', '-140px')
    expect(stuckDistance(wrap, tr)).toBe(0)
    expect(stuckDistance(wrap, document.createElement('tr'))).toBe(0)
  })
})
