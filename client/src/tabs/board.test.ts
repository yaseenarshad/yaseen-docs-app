/**
 * The tab board's arithmetic (YAZ-2648): the islands and their labels, the stack rule, the arrow
 * keys' geometry, and the title a page does not repeat. Pure functions, no DOM.
 */
import { describe, expect, it } from 'vitest'
import { BOARD, boardHeight, buildBoard, islandBox, islandCols, nearest, stackedIslands, withoutTitle, type BoardShape } from './board'

const name = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '')

describe('buildBoard (D7)', () => {
  const tabs = ['/v/Clients/Acme/brief.md', '/v/today.md', '/w/x.md', '/v/Clients/Globex/call.md', '/v/Clients/Acme/notes.md', '/v/Clients/Acme', '/elsewhere/loose.md']

  it('one island per folder that DIRECTLY holds a page, under its vault: the label is the whole path in the vault, the top level is named by the vault, and the pages keep the strip\'s order', () => {
    const board = buildBoard(tabs, ['/v', '/w'], ['Notes', 'Work'], name)
    expect(board.map((vault) => [vault.name, vault.islands.map((island) => [island.label, island.pages.map((page) => page.label)])])).toEqual([
      // The vault's top level first, then its folders by path. A folder tab stands on its PARENT's island.
      ['Notes', [['Notes', ['today']], ['Clients', ['Acme']], ['Clients / Acme', ['brief', 'notes']], ['Clients / Globex', ['call']]]],
      ['Work', [['Work', ['x']]]],
      // A page in no vault of the window comes last, on an island named by its folder.
      ['', [['/elsewhere', ['loose']]]],
    ])
    expect(board[0].islands.map((island) => [island.dir, island.top])).toEqual([['/v', true], ['/v/Clients', false], ['/v/Clients/Acme', false], ['/v/Clients/Globex', false]])
  })

  it('the filter keeps a page whose title or path in the vault holds every term, and an island with no page left is gone', () => {
    const board = buildBoard(tabs, ['/v', '/w'], ['Notes', 'Work'], name, ['acme', 'no'])
    expect(board.map((vault) => vault.islands.map((island) => [island.label, island.pages.map((page) => page.label)]))).toEqual([[['Clients / Acme', ['notes']]]])
  })
})

describe('stackedIslands — the stack rule', () => {
  const shape = (...counts: number[]): BoardShape[] => [{ named: false, islands: counts.map((count, i) => ({ dir: `/v/${i}`, count })) }]
  /** A board exactly as tall as these islands, none of them stacked, at this width. */
  const fits = (s: BoardShape[], w: number) => ({ w, h: boardHeight(s, new Set(), w) })
  const oneRow = islandBox(1, false, 2000).h

  it('a board that fits its area stacks nothing — and neither does an area not measured yet', () => {
    const s = shape(6, 3, 1, 2)
    expect([...stackedIslands(s, fits(s, 900))]).toEqual([])
    expect([...stackedIslands(s, null)]).toEqual([])
    expect([...stackedIslands(s, { w: 0, h: 0 })]).toEqual([])
  })

  it('a board that does not fit stacks the island with the most pages, then the next, and stops as soon as it fits', () => {
    // 5, 8 and 2 pages at 620 wide: two pages side by side at most, so each island takes its own line.
    const s = shape(5, 8, 2)
    const w = 620
    const whole = boardHeight(s, new Set(), w)
    expect([...stackedIslands(s, { w, h: whole })]).toEqual([])
    // One px short: the biggest goes first, and that is enough.
    const afterOne = boardHeight(s, new Set(['/v/1']), w)
    expect([...stackedIslands(s, { w, h: whole - 1 })]).toEqual(['/v/1'])
    expect([...stackedIslands(s, { w, h: afterOne })]).toEqual(['/v/1'])
    expect([...stackedIslands(s, { w, h: afterOne - 1 })]).toEqual(['/v/1', '/v/0'])
  })

  it('an island of three pages or fewer never stacks (R25a), so a board of them scrolls', () => {
    const tiny = { w: 320, h: 10 }
    expect([...stackedIslands(shape(1, 1, 1, 1), { w: 200, h: oneRow })]).toEqual([])
    expect([...stackedIslands(shape(3, 3, 2, 1), tiny)]).toEqual([])
    // Four is the first count that can: the smaller islands beside it stay spread.
    expect([...stackedIslands(shape(3, 4, 2), tiny)]).toEqual(['/v/1'])
  })

  it('one the user spread stays spread; the active tab\'s island goes last', () => {
    const s = shape(5, 4, 3, 2, 1)
    const tiny = { w: 320, h: 10 }
    expect([...stackedIslands(s, tiny)]).toEqual(['/v/0', '/v/1'])
    expect([...stackedIslands(s, tiny, new Set(['/v/0']))]).toEqual(['/v/1'])
    expect([...stackedIslands(s, tiny, new Set(), '/v/0')]).toEqual(['/v/1', '/v/0'])
    // Kept last means: not stacked at all while stacking another is enough.
    const enough = { w: 720, h: boardHeight(s, new Set(['/v/1']), 720) }
    expect(stackedIslands(s, enough).has('/v/0')).toBe(true)
    expect([...stackedIslands(s, enough, new Set(), '/v/0')]).toEqual(['/v/1'])
  })

  it('asked again with its own answer it says the same: the area is not the pages\' to change', () => {
    const s = shape(7, 6, 4, 2, 1)
    const area = { w: 700, h: 420 }
    const first = stackedIslands(s, area)
    expect(first.size).toBeGreaterThan(0)
    expect([...stackedIslands(s, area)]).toEqual([...first])
    // A stack is never bigger than its island spread, so stacking can only shorten this board.
    expect(boardHeight(s, first, area.w)).toBeLessThan(boardHeight(s, new Set(), area.w))
    for (const count of [2, 3, 5, 9]) {
      expect(islandBox(count, true, 700).w).toBeLessThanOrEqual(islandBox(count, false, 700).w)
      expect(islandBox(count, true, 700).h).toBeLessThanOrEqual(islandBox(count, false, 700).h)
    }
  })
})

describe('islandCols / islandBox — the sizes the stylesheet is given', () => {
  it('three pages side by side at most, four as two and two, and never more than the board is wide; a pile is one page high', () => {
    expect([1, 2, 3, 4, 5, 7].map((count) => islandCols(count, 2000))).toEqual([1, 2, 3, 2, 3, 3])
    expect(islandCols(7, 500)).toBe(2)
    expect(islandCols(7, 100)).toBe(1)
    const { pageW, pageH, pageGap, islandPad, labelH, fanX } = BOARD
    expect(islandBox(5, false, 2000)).toEqual({ w: 3 * pageW + 2 * pageGap + 2 * islandPad, h: labelH + 2 * pageH + pageGap + 2 * islandPad })
    expect(islandBox(5, true, 2000)).toEqual({ w: pageW + fanX + 2 * islandPad, h: labelH + pageH + 2 * islandPad })
  })
})

describe('nearest — where an arrow goes', () => {
  // Two lines of pages: a b c on the first — c far to the right, on another island — and d e under a b.
  const box = (left: number, top: number) => ({ left, top, width: 132, height: 176 })
  const [a, b, c, d, e] = [0, 1, 2, 3, 4]
  const boxes = [box(0, 0), box(142, 0), box(700, 0), box(0, 240), box(142, 240)]

  it('→ and ← stay on the line while it has a page that way; ↓ and ↑ take the page right above or below; an edge is the end', () => {
    expect(nearest(boxes, a, 'right')).toBe(b)
    // The next page on the line wins over a nearer one on the line below.
    expect(nearest(boxes, b, 'right')).toBe(c)
    expect(nearest(boxes, c, 'left')).toBe(b)
    expect(nearest(boxes, a, 'down')).toBe(d)
    expect(nearest(boxes, e, 'up')).toBe(b)
    expect(nearest(boxes, a, 'left')).toBe(-1)
    expect(nearest(boxes, a, 'up')).toBe(-1)
    // Nothing right below c: the nearest page that way at all.
    expect(nearest(boxes, c, 'down')).toBe(e)
    // The line below ends before c's column: → from its last page goes up to c rather than nowhere.
    expect(nearest(boxes, e, 'right')).toBe(c)
  })
})

describe('withoutTitle', () => {
  it('drops a first line that only repeats the title — trimmed, any case — and nothing else', () => {
    expect(withoutTitle('2026-10-08\nStandup at ten', '2026-10-08')).toBe('Standup at ten')
    expect(withoutTitle('  weekly Review \nNext', 'Weekly review')).toBe('Next')
    expect(withoutTitle('Weekly review', 'Weekly review')).toBe('')
    expect(withoutTitle('Weekly review of the pipeline\nNext', 'Weekly review')).toBe('Weekly review of the pipeline\nNext')
    expect(withoutTitle('', 'Weekly review')).toBe('')
  })
})
