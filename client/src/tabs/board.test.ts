/**
 * The tab board's arithmetic (YAZ-2648, YAZ-3343): the islands and their labels, the canvas layout
 * (folder and window layouts, stored places), the drop rule, the arrow keys' geometry, and the title a
 * page does not repeat. Pure functions, no DOM.
 */
import { describe, expect, it } from 'vitest'
import { applyTabCanvasPatch, type CanvasCard, type CanvasFrame } from '@shared/types'
import { arrivalIn, BOARD, buildBoard, CELL, cellKey, colsFor, fieldOf, frameDrop, freeFramePosition, nearestOk, placeCard, dropOutcome, frameAt, islandBox, islandCols, layoutCanvas, nearest, snapPoint, withoutTitle, type FrameInput, type VaultIslands } from './board'

const name = (path: string): string => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '')
/** Tabs by path: with no copies, a tab's id here is its path (YAZ-2940 D1). */
const byPath = (paths: readonly string[]) => paths.map((path) => ({ id: path, path }))

describe('buildBoard (D7)', () => {
  const tabs = ['/v/Clients/Acme/brief.md', '/v/today.md', '/w/x.md', '/v/Clients/Globex/call.md', '/v/Clients/Acme/notes.md', '/v/Clients/Acme', '/elsewhere/loose.md']

  it('one island per folder that DIRECTLY holds a page, under its vault: the label is the whole path in the vault, the top level is named by the vault, and the pages keep the strip\'s order', () => {
    const board = buildBoard(byPath(tabs), ['/v', '/w'], ['Notes', 'Work'], name)
    expect(board.map((vault) => [vault.name, vault.islands.map((island) => [island.label, island.pages.map((page) => page.label)])])).toEqual([
      // The vault's top level first, then its folders by path. A folder tab stands on its PARENT's island.
      ['Notes', [['Notes', ['today']], ['Clients', ['Acme']], ['Clients / Acme', ['brief', 'notes']], ['Clients / Globex', ['call']]]],
      ['Work', [['Work', ['x']]]],
      // A page in no vault of the window comes last, on an island named by its folder.
      ['', [['/elsewhere', ['loose']]]],
    ])
    expect(board[0].islands.map((island) => [island.dir, island.top])).toEqual([['/v', true], ['/v/Clients', false], ['/v/Clients/Acme', false], ['/v/Clients/Globex', false]])
    // S36: three files of one name in three folders are three pages on three islands, each named by its folder.
    const same = buildBoard(byPath(['/v/Clients/Acme/notes.md', '/v/notes.md', '/v/Clients/Globex/notes.md']), ['/v'], ['Notes'], name)
    expect(same[0].islands.map((island) => [island.label, island.pages.map((page) => page.label)])).toEqual([['Notes', ['notes']], ['Clients / Acme', ['notes']], ['Clients / Globex', ['notes']]])
  })

  it('the filter keeps a page whose title or path in the vault holds every term, and an island with no page left is gone', () => {
    const board = buildBoard(byPath(tabs), ['/v', '/w'], ['Notes', 'Work'], name, ['acme', 'no'])
    expect(board.map((vault) => vault.islands.map((island) => [island.label, island.pages.map((page) => page.label)]))).toEqual([[['Clients / Acme', ['notes']]]])
  })

  it('YAZ-2940 D1: two tabs of one file are two pages of its island, each with its own tab id, in the strip\'s order', () => {
    const board = buildBoard([{ id: 't1', path: '/v/a.md' }, { id: 't2', path: '/v/b.md' }, { id: 't3', path: '/v/a.md' }], ['/v'], ['Notes'], name)
    // YAZ-3343 D1, D11: each says which copy of its path it is, and how many the strip has.
    expect(board[0].islands[0].pages).toEqual([
      { id: 't1', path: '/v/a.md', label: 'a', named: false, page: 'a', copy: 0, copies: 2 },
      { id: 't2', path: '/v/b.md', label: 'b', named: false, page: 'b', copy: 0, copies: 1 },
      { id: 't3', path: '/v/a.md', label: 'a', named: false, page: 'a', copy: 1, copies: 2 },
    ])
    // The copies are the strip's, whatever the filter keeps.
    expect(buildBoard([{ id: 't1', path: '/v/a.md', name: 'One' }, { id: 't3', path: '/v/a.md', name: 'Two' }], ['/v'], ['Notes'], name, ['two'])[0].islands[0].pages.map((p) => [p.id, p.copy])).toEqual([['t3', 1]])
  })

  it('YAZ-2949 S12, S13: a named tab is labelled by its display name, and the filter finds it by that name, its page name or its path', () => {
    const tabs = [{ id: 't1', path: '/v/a.md', name: 'Outline' }, { id: 't2', path: '/v/b.md' }]
    expect(buildBoard(tabs, ['/v'], ['Notes'], name)[0].islands[0].pages).toEqual([{ id: 't1', path: '/v/a.md', label: 'Outline', named: true, page: 'a', copy: 0, copies: 1 }, { id: 't2', path: '/v/b.md', label: 'b', named: false, page: 'b', copy: 0, copies: 1 }])
    for (const term of ['outline', 'a', 'a.md']) expect(buildBoard(tabs, ['/v'], ['Notes'], name, [term])[0].islands[0].pages.map((p) => p.id)).toContain('t1')
    expect(buildBoard(tabs, ['/v'], ['Notes'], name, ['outline'])[0].islands[0].pages.map((p) => p.id)).toEqual(['t1'])
  })
})

describe('islandCols / islandBox — the sizes the stylesheet is given', () => {
  it('about as wide as tall (YAZ-3343 D29: ceil(√(n × 1.6)), 8 at most), and never more than the board is wide', () => {
    expect([1, 2, 3, 4, 5, 7].map((count) => islandCols(count, 2000))).toEqual([1, 2, 3, 3, 3, 4])
    expect([1, 2, 19, 40, 100].map(colsFor)).toEqual([1, 2, 6, 8, 8])
    expect(islandCols(7, 500)).toBe(2)
    expect(islandCols(7, 100)).toBe(1)
    const { pageW, pageH, pageGap, islandPad, labelH } = BOARD
    expect(islandBox(5, 2000)).toEqual({ w: 3 * pageW + 2 * pageGap + 2 * islandPad, h: labelH + 2 * pageH + pageGap + 2 * islandPad })
  })
})

describe('layoutCanvas — where every card stands (YAZ-3343 D1, D8)', () => {
  const { pageW, pageH, pageGap, islandPad, labelH, islandGap, framePad, frameLabelH, frameGap } = BOARD
  const one = (win: string, paths: readonly string[], roots = ['/v'], names = ['Notes']): FrameInput => ({
    win,
    vaults: buildBoard(paths.map((path) => ({ id: win === 'me' ? path : `${win}\n${path}\n0`, path })), roots, names, name).map((vault: VaultIslands) => ({ ...vault, named: roots.length > 1 && vault.at < roots.length })),
  })
  const at = (plan: ReturnType<typeof layoutCanvas>, id: string) => {
    const card = plan.cards.get(id)
    return card === undefined ? undefined : [card.x, card.y, card.moved]
  }
  const me = one('me', ['/v/a.md', '/v/b.md', '/v/Docs/c.md', '/v/Docs/d.md', '/v/Docs/e.md', '/v/Docs/f.md'])

  it('folder layout: the groups side by side from the origin, each card in its group\'s grid, and wrapping at the viewport width', () => {
    const wide = layoutCanvas([me], { by: 'folder', wrapW: 2000, stored: [] })
    const top = { x: islandPad, y: islandPad + labelH }
    expect(at(wide, '/v/a.md')).toEqual([top.x, top.y, false])
    expect(at(wide, '/v/b.md')).toEqual([top.x + pageW + pageGap, top.y, false])
    // Docs: four cards as three and one, the group right of the first one.
    const docsX = islandBox(2, 2000).w + islandGap
    expect(at(wide, '/v/Docs/c.md')).toEqual([docsX + islandPad, top.y, false])
    expect(at(wide, '/v/Docs/f.md')).toEqual([docsX + islandPad, top.y + pageH + pageGap, false])
    expect(wide.groups.map((g) => [g.island.label, g.x, g.y, g.w, g.h])).toEqual([
      ['Notes', 0, 0, islandBox(2, 2000).w, islandBox(2, 2000).h],
      ['Docs', docsX, 0, islandBox(4, 2000).w, islandBox(4, 2000).h],
    ])
    expect(wide.frames).toEqual([])
    // Too narrow for both: Docs wraps under the first group.
    const narrow = layoutCanvas([me], { by: 'folder', wrapW: islandBox(2, 2000).w + 100, stored: [] })
    expect(narrow.groups[1]).toMatchObject({ x: 0, y: islandBox(2, 2000).h + islandGap })
  })

  it('a stored place wins: the card stands where it was put, its slot stays empty, and its group\'s box takes it in; another layout\'s places are not this one\'s', () => {
    const stored: CanvasCard[] = [
      { win: 'me', path: '/v/a.md', copy: 0, by: 'folder', x: 900, y: 700 },
      // The window layout's own place for b, and a place for another window: neither moves a card here.
      { win: 'me', path: '/v/b.md', copy: 0, by: 'window', x: 5, y: 5 },
      { win: 'w2', path: '/v/b.md', copy: 0, by: 'folder', x: 5, y: 5 },
    ]
    const plan = layoutCanvas([me], { by: 'folder', wrapW: 2000, stored })
    expect(at(plan, '/v/a.md')).toEqual([900, 700, true])
    // b keeps its own slot: nothing closes up (D16, "no reshuffle").
    expect(at(plan, '/v/b.md')).toEqual([islandPad + pageW + pageGap, islandPad + labelH, false])
    const notes = plan.groups[0]
    expect([notes.x, notes.y]).toEqual([islandPad + pageW + pageGap - islandPad, 0])
    expect([notes.x + notes.w, notes.y + notes.h]).toEqual([900 + pageW + islandPad, 700 + pageH + islandPad])
    const docs = plan.groups.find((g) => g.island.label === 'Docs')!
    expect(plan.bounds.x + plan.bounds.w).toBe(Math.max(900 + pageW + islandPad, docs.x + docs.w))
  })

  it('S16, D16 "no reshuffle": moving one card never moves another card or group, in either layout', () => {
    const other = one('w2', ['/w/x.md', '/w/y.md'], ['/w'], ['Work'])
    for (const by of ['folder', 'window'] as const) {
      const windows = by === 'folder' ? [me] : [me, other]
      const free = layoutCanvas(windows, { by, wrapW: 3000, stored: [] })
      for (const moved of [...free.cards.keys()]) {
        const info = moved.includes('\n') ? { win: 'w2', path: moved.split('\n')[1] } : { win: 'me', path: moved }
        // Far down in its own column: the drop's rule keeps its frame (or group) clear of the others (D28).
        const own = by === 'window' ? free.frames.find((f) => f.win === info.win)!.x : free.groups.find((g) => g.island.pages.some((p) => p.id === moved))!.x
        const to = { x: own + (by === 'window' ? framePad : islandPad), y: free.bounds.y + free.bounds.h + 500 }
        const plan = layoutCanvas(windows, { by, wrapW: 3000, stored: [{ ...info, copy: 0, by, ...to }] })
        for (const [id, card] of free.cards) if (id !== moved) expect([id, plan.cards.get(id)]).toEqual([id, card])
        expect(plan.cards.get(moved)).toMatchObject({ ...to, moved: true })
        // Every frame keeps its place (a moved card may only widen its own frame's box).
        for (const f of plan.frames) expect([f.win, f.x <= free.frames.find((g) => g.win === f.win)!.x]).toEqual([f.win, true])
      }
    }
  })

  it('window layout: one frame per window, this one first, holding its cards DIRECTLY in one grid in folder order (no folder boxes, no vault names); frames flow and wrap; an empty window still has a frame', () => {
    const other = one('w2', ['/w/x.md'])
    const empty: FrameInput = { win: 'w3', vaults: [] }
    const wrapW = 1400
    const plan = layoutCanvas([me, other, empty], { by: 'window', wrapW, stored: [] })
    expect([plan.groups, plan.vaults]).toEqual([[], []])
    expect(plan.frames.map((f) => f.win)).toEqual(['me', 'w2', 'w3'])
    const [mine, second, third] = plan.frames
    const slot = (i: number) => [framePad + (i % colsFor(6)) * (pageW + pageGap), frameLabelH + framePad + Math.floor(i / colsFor(6)) * (pageH + pageGap), false]
    // Folder order: the vault's top level (a, b), then Docs (c..f) — four columns, so f wraps to the next row.
    expect(plan.order.slice(0, 6)).toEqual(['/v/a.md', '/v/b.md', '/v/Docs/c.md', '/v/Docs/d.md', '/v/Docs/e.md', '/v/Docs/f.md'])
    plan.order.slice(0, 6).forEach((id, i) => expect([id, at(plan, id)]).toEqual([id, slot(i)]))
    expect([mine.x, mine.y, mine.w, mine.h]).toEqual([0, frameLabelH, 4 * pageW + 3 * pageGap + 2 * framePad, 2 * pageH + pageGap + 2 * framePad])
    expect(second.x).toBe(mine.x + mine.w + frameGap)
    expect(at(plan, 'w2\n/w/x.md\n0')).toEqual([second.x + framePad, frameLabelH + framePad, false])
    expect([second.w, third.w, third.h]).toEqual([pageW + 2 * framePad, pageW + 2 * framePad, pageH + 2 * framePad])
    // The third frame wraps under the first two.
    expect([third.x, third.y]).toEqual([0, frameLabelH + mine.h + frameGap + frameLabelH])
    // A moved card of w2 widens w2's frame round it, from its card.
    const moved = layoutCanvas([me, other], { by: 'window', wrapW, stored: [{ win: 'w2', path: '/w/x.md', copy: 0, by: 'window', x: 3000, y: 50 }] })
    const w2 = moved.frames[1]
    expect([w2.x, w2.x + w2.w]).toEqual([3000 - framePad, 3000 + pageW + framePad])
    void islandPad
    void labelH
  })

  it('S25, D16, "the window pane is getting bigger and bigger": a frame or a group dragged twice keeps its size, and its box moves by exactly the sum of the drags, in both layouts', () => {
    const other = one('w2', ['/w/x.md', '/w/y.md'], ['/w'], ['Work'])
    const two = one('me', ['/v/a.md', '/w/b.md', '/w/Docs/c.md'], ['/v', '/w'], ['Notes', 'Work'])
    /** What the board stores on a drop: each carried card at its place + the move. */
    const drag = (stored: CanvasCard[], plan: ReturnType<typeof layoutCanvas>, ids: readonly string[], by: 'folder' | 'window', dx: number, dy: number): CanvasCard[] => {
      const keep = stored.filter((c) => !ids.some((id) => (id.includes('\n') ? id.split('\n')[1] : id) === c.path))
      return [...keep, ...ids.map((id) => ({ win: id.includes('\n') ? id.split('\n')[0] : 'me', path: id.includes('\n') ? id.split('\n')[1] : id, copy: 0, by, x: plan.cards.get(id)!.x + dx, y: plan.cards.get(id)!.y + dy }))]
    }
    // A whole frame: its box, its vault names and its groups follow.
    const windows = [two, other]
    let stored: CanvasCard[] = []
    let plan = layoutCanvas(windows, { by: 'window', wrapW: 1400, stored })
    const box = (p: typeof plan) => p.frames.find((f) => f.win === 'me')!
    const first = box(plan)
    const mine = [...plan.cards.keys()].filter((id) => !id.includes('\n'))
    for (let i = 0; i < 2; i++) {
      stored = drag(stored, plan, mine, 'window', 300, 200)
      plan = layoutCanvas(windows, { by: 'window', wrapW: 1400, stored })
    }
    expect([box(plan).x, box(plan).y, box(plan).w, box(plan).h]).toEqual([first.x + 600, first.y + 400, first.w, first.h])
    // A folder group (the folder layout: a frame has no groups): same size, moved by the sum; its vault's name follows.
    for (const by of ['folder'] as const) {
      const wins = [two]
      let s2: CanvasCard[] = []
      let p2 = layoutCanvas(wins, { by, wrapW: 1400, stored: s2 })
      const docs = () => p2.groups.find((g) => g.island.label === 'Notes')!
      const start = docs()
      const label = () => p2.vaults.find((v) => v.name === 'Notes')!
      const labelStart = label()
      const ids = start.island.pages.map((page) => page.id)
      for (let i = 0; i < 2; i++) {
        s2 = drag(s2, p2, ids, by, 300, 200)
        p2 = layoutCanvas(wins, { by, wrapW: 1400, stored: s2 })
      }
      expect([docs().x, docs().y, docs().w, docs().h]).toEqual([start.x + 600, start.y + 400, start.w, start.h])
      expect([label().x, label().y]).toEqual([labelStart.x + 600, labelStart.y + 400])
    }
  })

  it('two or more vaults: each vault\'s name above its groups', () => {
    const plan = layoutCanvas([one('me', ['/v/a.md', '/w/b.md'], ['/v', '/w'], ['Notes', 'Work'])], { by: 'folder', wrapW: 2000, stored: [] })
    expect(plan.vaults.map((v) => [v.name, v.y])).toEqual([['Notes', 0], ['Work', BOARD.vaultH + islandBox(1, 2000).h + islandGap]])
  })
})

describe('the grid ("Snap to grid", YAZ-3343 D26): a frame\'s own, at any origin', () => {
  // A frame dragged by a non-cell amount: its grid starts wherever its cards are.
  const o = { x: 137, y: -41 }

  it('snaps a top-left to the nearest cell of that grid; a taken cell sends the card to the nearest free one; white space is fine', () => {
    expect(snapPoint({ x: o.x + CELL.w * 2 + 40, y: o.y + CELL.h * 3 - 30 }, o)).toEqual({ x: o.x + CELL.w * 2, y: o.y + CELL.h * 3 })
    expect(snapPoint({ x: o.x - 200, y: o.y }, o)).toEqual({ x: o.x - CELL.w, y: o.y })
    const target = { x: o.x + CELL.w, y: o.y + CELL.h }
    const taken = new Set<string>()
    const freeCell = () => nearestOk(target, CELL, (p) => !taken.has(cellKey(p, o)))
    expect(freeCell()).toEqual(target)
    // Taken: the nearest free cell — up or down first (a cell is wider than tall).
    taken.add(cellKey(target, o))
    expect(freeCell()).toEqual({ x: target.x, y: target.y - CELL.h })
    taken.add(cellKey({ x: target.x, y: target.y - CELL.h }, o))
    expect(freeCell()).toEqual({ x: target.x, y: target.y + CELL.h })
  })

  it('a frame\'s auto slots are one cell apart: they are on the grid of any one of them', () => {
    const me = { win: 'me', vaults: buildBoard(byPath(['/v/a.md', '/v/b.md', '/v/Docs/c.md', '/v/Docs/d.md', '/v/Docs/e.md']), ['/v'], ['Notes'], name).map((v) => ({ ...v, named: false })) }
    const plan = layoutCanvas([me], { by: 'window', wrapW: 1400, stored: [] })
    const first = plan.cards.get('/v/a.md')!
    for (const card of plan.cards.values()) expect(snapPoint(card, first)).toEqual({ x: card.x, y: card.y })
  })
})

describe('no overlap and a viewport-shaped layout (YAZ-3343 D28, D29)', () => {
  const win = (id: string, n: number): FrameInput => ({ win: id, vaults: buildBoard(Array.from({ length: n }, (_, i) => ({ id: `${id}\n/v/n${i}.md\n0`, path: `/v/n${i}.md` })), ['/v'], ['Notes'], name).map((v) => ({ ...v, named: false })) })

  it('freeFramePosition: a frame dropped on another goes to the nearest spot clear of it by the gap; a clear one stays', () => {
    const other = { x: 0, y: 0, w: 400, h: 300 }
    expect(freeFramePosition({ x: 500, y: 0, w: 200, h: 100 }, [other], 24)).toEqual({ x: 500, y: 0 })
    // Mostly over its right edge: right of it, the gap kept.
    expect(freeFramePosition({ x: 300, y: 50, w: 200, h: 100 }, [other], 24)).toEqual({ x: 424, y: 50 })
    // Over its foot: under it.
    expect(freeFramePosition({ x: 100, y: 250, w: 200, h: 100 }, [other], 24)).toEqual({ x: 100, y: 324 })
  })

  it('nearestOk: the card\'s rule — the nearest lattice point that keeps its frame clear', () => {
    const ok = (p: { x: number; y: number }) => p.x >= 460
    expect(nearestOk({ x: 0, y: 0 }, CELL, ok)).toEqual({ x: 2 * CELL.w, y: 0 })
    expect(nearestOk({ x: 0, y: 0 }, CELL, () => false, 2)).toBeNull()
  })

  it('the auto frames pack to the viewport\'s shape — wider than tall on a wide screen, with a better fit than the old one-row-at-a-time stack — and the same input lays out the same', () => {
    const wins = [win('a', 19), win('b', 7), win('c', 3), win('d', 12)]
    const aspect = 1600 / 900
    const plan = layoutCanvas(wins, { by: 'window', wrapW: 1500, stored: [], aspect })
    const ratio = plan.bounds.w / plan.bounds.h
    expect(ratio).toBeGreaterThan(aspect * 0.6)
    expect(ratio).toBeLessThan(aspect * 1.6)
    const fit = (p: typeof plan) => Math.min(1600 / p.bounds.w, 900 / p.bounds.h)
    // The old rule: four columns, rows wrapped at the viewport's width.
    const old = layoutCanvas(wins, { by: 'window', wrapW: 1500, stored: [] })
    expect(fit(plan)).toBeGreaterThan(fit(old) * 0.999)
    expect(layoutCanvas(wins, { by: 'window', wrapW: 1500, stored: [], aspect })).toEqual(plan)
    // No two frames crowd each other.
    const boxes = plan.frames.map((f) => ({ x: f.x, y: f.y - BOARD.frameLabelH, w: f.w, h: f.h + BOARD.frameLabelH }))
    for (const [i, a] of boxes.entries()) for (const b of boxes.slice(i + 1)) expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true)
  })

  it('a frame the user placed stands where it is, and an auto frame that would land on it takes the next free spot', () => {
    const wins = [win('a', 2), win('b', 2)]
    const free = layoutCanvas(wins, { by: 'window', wrapW: 5000, stored: [] })
    const b0 = free.frames[1]
    // a's cards all placed right where b would go.
    const stored: CanvasCard[] = ['/v/n0.md', '/v/n1.md'].map((path, i) => ({ win: 'a', path, copy: 0, by: 'window', x: b0.x + BOARD.framePad + i * CELL.w, y: b0.y + BOARD.framePad }))
    const plan = layoutCanvas(wins, { by: 'window', wrapW: 5000, stored })
    const [a, b] = plan.frames
    expect([a.x, a.y]).toEqual([b0.x, b0.y])
    expect(a.x + a.w <= b.x - BOARD.apart || b.x + b.w <= a.x - BOARD.apart || a.y + a.h <= b.y - BOARD.frameLabelH - BOARD.apart || b.y + b.h <= a.y - BOARD.frameLabelH - BOARD.apart).toBe(true)
  })
})

describe('THE NO-OVERLAP RULE in the layout (YAZ-3343 D28, S26, S56): frames and groups never overlap, whatever is stored', () => {
  const win = (id: string, n: number): FrameInput => ({ win: id, vaults: buildBoard(Array.from({ length: n }, (_, i) => ({ id: `${id}\n/v/n${i}.md\n0`, path: `/v/n${i}.md` })), ['/v'], ['Notes'], name).map((v) => ({ ...v, named: false })) })
  /** A window of one vault whose folders are the groups of the folder layout. */
  const folders = (paths: readonly string[]): FrameInput => ({ win: 'me', vaults: buildBoard(byPath(paths), ['/v'], ['Notes'], name).map((v) => ({ ...v, named: false })) })
  /** Every frame (its label row in) or group of the plan. */
  const boxes = (plan: ReturnType<typeof layoutCanvas>): { key: string; x: number; y: number; w: number; h: number }[] =>
    plan.frames.length > 0 ? plan.frames.map((f) => ({ key: f.win, x: f.x, y: f.y - BOARD.frameLabelH, w: f.w, h: f.h + BOARD.frameLabelH })) : plan.groups.map((g) => ({ key: g.key, x: g.x, y: g.y, w: g.w, h: g.h }))
  const overlapping = (plan: ReturnType<typeof layoutCanvas>): string[][] => {
    const all = boxes(plan)
    return all.flatMap((a, i) => all.slice(i + 1).filter((b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h).map((b) => [a.key, b.key]))
  }
  const card = (w: string, i: number, x: number, y: number, by: 'window' | 'folder' = 'window'): CanvasCard => ({ win: w, path: `/v/n${i}.md`, copy: 0, by, x, y })
  /** The canvas after the plan's repair is stored, by the shared rule. */
  const repaired = (plan: ReturnType<typeof layoutCanvas>, cards: CanvasCard[], frames: CanvasFrame[], wins: readonly string[]) => applyTabCanvasPatch({ allWindows: true, snap: true, cards, frames }, plan.repair ?? {}, new Set(wins))

  it('window layout: an AUTO frame keeps clear of a frame with only SOME cards placed — the placed card is part of that frame', () => {
    const wins = [win('a', 2), win('b', 2)]
    const free = layoutCanvas(wins, { by: 'window', wrapW: 5000, stored: [] })
    const b0 = free.frames[1]
    // One of a's two cards placed on b's first slot: a's frame now reaches over b's spot.
    const plan = layoutCanvas(wins, { by: 'window', wrapW: 5000, stored: [card('a', 1, b0.x + BOARD.framePad, b0.y + BOARD.framePad)] })
    expect(overlapping(plan)).toEqual([])
    // a stands as the user left it: b gave way.
    expect(plan.cards.get('a\n/v/n1.md\n0')).toMatchObject({ x: b0.x + BOARD.framePad, y: b0.y + BOARD.framePad, moved: true })
    expect(plan.cards.get('a\n/v/n0.md\n0')).toMatchObject({ x: free.cards.get('a\n/v/n0.md\n0')!.x, y: free.cards.get('a\n/v/n0.md\n0')!.y })
  })

  it('window layout: a frame dragged away (its cards and its place stored) moves no other frame — its spot in the flow stays empty (D16)', () => {
    const wins = [win('a', 2), win('b', 3), win('c', 1)]
    const free = layoutCanvas(wins, { by: 'window', wrapW: 5000, stored: [] })
    const a = free.frames[0]
    const dy = 2000
    const stored = [0, 1].map((i) => card('a', i, free.cards.get(`a\n/v/n${i}.md\n0`)!.x, free.cards.get(`a\n/v/n${i}.md\n0`)!.y + dy))
    const plan = layoutCanvas(wins, { by: 'window', wrapW: 5000, stored, anchors: new Map([['a', { x: a.x, y: a.y - BOARD.frameLabelH + dy }]]) })
    expect(plan.frames.slice(1)).toEqual(free.frames.slice(1))
    expect(plan.frames[0]).toMatchObject({ x: a.x, y: a.y + dy })
    expect(plan.repair).toBeNull()
  })

  it('window layout: two STORED frames that overlap (an old file) — the later one moves clear, and the plan says what to store; stored, the next layout is the same and stores nothing', () => {
    const wins = [win('a', 2), win('b', 2)]
    const cards = [card('a', 0, 0, 0), card('a', 1, CELL.w, 0), card('b', 0, 100, 40), card('b', 1, 100 + CELL.w, 40)]
    const plan = layoutCanvas(wins, { by: 'window', wrapW: 5000, stored: cards })
    expect(overlapping(plan)).toEqual([])
    // a, the earlier, stays.
    expect(plan.cards.get('a\n/v/n0.md\n0')).toMatchObject({ x: 0, y: 0 })
    const b = plan.cards.get('b\n/v/n0.md\n0')!
    expect(plan.repair?.set?.map((c) => [c.win, c.path, c.x, c.y])).toEqual([['b', '/v/n0.md', b.x, b.y], ['b', '/v/n1.md', b.x + CELL.w, b.y]])
    const next = repaired(plan, cards, [], ['a', 'b'])
    const again = layoutCanvas(wins, { by: 'window', wrapW: 5000, stored: next.cards, anchors: new Map((next.frames ?? []).map((f) => [f.win, f])) })
    expect([again.cards, again.frames, again.repair]).toEqual([plan.cards, plan.frames, null])
  })

  it('window layout: a frame that GROWS by a tab that arrived while the board was closed never covers the frame under it', () => {
    const wins = [win('a', 3), win('b', 2)]
    // a: its three cards in one row, its place stored; b right under it, the gap kept.
    const a = [0, 1, 2].map((i) => card('a', i, BOARD.framePad + i * CELL.w, BOARD.frameLabelH + BOARD.framePad))
    const bTop = BOARD.frameLabelH + BOARD.pageH + 2 * BOARD.framePad + BOARD.apart
    const b = [0, 1].map((i) => card('b', i, BOARD.framePad + i * CELL.w, bTop + BOARD.frameLabelH + BOARD.framePad))
    const anchors = new Map([['a', { x: 0, y: 0 }], ['b', { x: 0, y: bTop }]])
    const before = layoutCanvas(wins, { by: 'window', wrapW: 5000, stored: [...a, ...b], anchors })
    expect([overlapping(before), before.repair]).toEqual([[], null])
    // A fourth tab opens in a: its slot is a new row, and a reaches down over b.
    const grown = [win('a', 4), win('b', 2)]
    const plan = layoutCanvas(grown, { by: 'window', wrapW: 5000, stored: [...a, ...b], anchors })
    expect(overlapping(plan)).toEqual([])
    expect(plan.cards.get('a\n/v/n3.md\n0')).toMatchObject({ x: BOARD.framePad, y: BOARD.frameLabelH + BOARD.framePad + CELL.h, moved: false })
    // b, the later frame, moved clear; its cards and its place are stored where it stands now.
    const bf = plan.frames[1]
    expect(plan.repair?.setFrames).toEqual([{ win: 'b', x: bf.x, y: bf.y - BOARD.frameLabelH }])
  })

  it('folder layout: an AUTO group keeps clear of a group whose card was placed over its spot', () => {
    const me = folders(['/v/a.md', '/v/b.md', '/v/Docs/c.md', '/v/Docs/d.md'])
    const free = layoutCanvas([me], { by: 'folder', wrapW: 5000, stored: [] })
    const docs = free.groups[1]
    const plan = layoutCanvas([me], { by: 'folder', wrapW: 5000, stored: [{ win: 'me', path: '/v/b.md', copy: 0, by: 'folder', x: docs.x + BOARD.islandPad, y: docs.y + BOARD.islandPad + BOARD.labelH }] })
    expect(overlapping(plan)).toEqual([])
    expect(plan.cards.get('/v/b.md')).toMatchObject({ x: docs.x + BOARD.islandPad, moved: true })
  })

  it('folder layout: two STORED groups that overlap — the later moves clear, all its cards stored; the next layout stores nothing', () => {
    const me = folders(['/v/a.md', '/v/Docs/c.md'])
    const cards: CanvasCard[] = [{ win: 'me', path: '/v/a.md', copy: 0, by: 'folder', x: 0, y: 0 }, { win: 'me', path: '/v/Docs/c.md', copy: 0, by: 'folder', x: 50, y: 20 }]
    const plan = layoutCanvas([me], { by: 'folder', wrapW: 5000, stored: cards })
    expect(overlapping(plan)).toEqual([])
    const c = plan.cards.get('/v/Docs/c.md')!
    expect(plan.repair?.set).toEqual([{ win: 'me', path: '/v/Docs/c.md', copy: 0, by: 'folder', x: c.x, y: c.y }])
    const again = layoutCanvas([me], { by: 'folder', wrapW: 5000, stored: repaired(plan, cards, [], ['me']).cards })
    expect([again.cards, again.repair]).toEqual([plan.cards, null])
  })
})

describe('the placement rules of a drop (YAZ-3343 D26, D28, D30)', () => {
  const win = (id: string, n: number): FrameInput => ({ win: id, vaults: buildBoard(Array.from({ length: n }, (_, i) => ({ id: `${id}\n/v/n${i}.md\n0`, path: `/v/n${i}.md` })), ['/v'], ['Notes'], name).map((v) => ({ ...v, named: false })) })
  // a: three cards in a row; b right of it, the gap kept.
  const plan = layoutCanvas([win('a', 3), win('b', 1)], { by: 'window', wrapW: 5000, stored: [] })
  const where = (id: string) => plan.cards.get(id)
  const at = (i: number) => plan.cards.get(`a\n/v/n${i}.md\n0`)!
  const b = plan.frames[1]

  it('S14, S15, S28: a card goes to the nearest FREE cell of its frame\'s grid, never to a cell that makes its frame reach another; Snap off, where it was let go', () => {
    const field = fieldOf(plan, 'window', 'a', new Set([`a\n/v/n0.md\n0`]), where)
    // Let go a little off n1's cell: n1 holds it, so the nearest free cell — above it (a cell is wider than tall).
    expect(placeCard(field, { x: at(1).x + 30, y: at(1).y + 10 }, true)).toEqual({ x: at(1).x, y: at(1).y - CELL.h })
    // Let go on b's frame: the nearest cell that keeps a clear of b, left of b by the gap at least.
    const put = placeCard(field, { x: b.x + 20, y: at(0).y }, true)
    expect(put.x + BOARD.pageW + BOARD.framePad + BOARD.apart).toBeLessThanOrEqual(b.x)
    expect(field.taken.has(cellKey(put, field.origin))).toBe(false)
    // Snap off, in the open: where it was let go.
    expect(placeCard(field, { x: at(0).x + 7, y: at(0).y + 300 }, false)).toEqual({ x: at(0).x + 7, y: at(0).y + 300 })
  })

  it('S41, S51, S36: a card ARRIVES inside its frame — the frame frozen first, then the first free cell or a new row; a copy right of its source', () => {
    const set = arrivalIn(plan, 'a', { path: '/v/x.md', copy: 0 }, { where })
    expect(set.slice(0, 3)).toEqual([0, 1, 2].map((i) => ({ win: 'a', path: `/v/n${i}.md`, copy: 0, by: 'window', x: at(i).x, y: at(i).y })))
    // The row is full: a new row at its foot.
    expect(set[3]).toEqual({ win: 'a', path: '/v/x.md', copy: 0, by: 'window', x: at(0).x, y: at(0).y + CELL.h })
    // Next to its source: right of n0 is taken, so below it.
    expect(arrivalIn(plan, 'a', { path: '/v/n0.md', copy: 1 }, { where, near: at(0) }).at(-1)).toMatchObject({ x: at(0).x, y: at(0).y + CELL.h })
    // In a frame with a hole, the hole.
    const holed = layoutCanvas([win('a', 3), win('b', 1)], { by: 'window', wrapW: 5000, stored: [{ win: 'a', path: '/v/n1.md', copy: 0, by: 'window', x: at(1).x, y: at(1).y + CELL.h }] })
    expect(arrivalIn(holed, 'a', { path: '/v/x.md', copy: 0 }, { where: (id) => holed.cards.get(id) })).toEqual([{ win: 'a', path: '/v/x.md', copy: 0, by: 'window', x: at(1).x, y: at(1).y }])
  })

  it('S26: a frame dropped on another goes to the nearest spot clear of it; dropped in the open it stays where it was let go', () => {
    expect(frameDrop(plan, 'window', 'a', 0, 900)).toEqual({ dx: 0, dy: 900 })
    const move = frameDrop(plan, 'window', 'a', b.x - plan.frames[0].x, 0)
    const a = plan.frames[0]
    const moved = { x: a.x + move.dx, y: a.y + move.dy }
    expect(moved.x + a.w + BOARD.apart <= b.x || b.x + b.w + BOARD.apart <= moved.x || moved.y + a.h + BOARD.apart <= b.y - BOARD.frameLabelH || b.y + b.h + BOARD.apart <= moved.y - BOARD.frameLabelH).toBe(true)
  })
})

describe('dropOutcome — the drop rule (YAZ-3343 D13)', () => {
  const frames = [
    { win: 'me', x: 0, y: 30, w: 500, h: 400 },
    { win: 'w2', x: 540, y: 30, w: 300, h: 400 },
  ]
  const rootsOf = (win: string) => ({ me: ['/v'], w2: ['/w'] })[win]

  it('inside another window\'s frame the tab goes there; in its own frame or on empty canvas it is placed; with the switch off it is always placed', () => {
    expect(dropOutcome({ from: 'w2', path: '/v/a.md', at: { x: 100, y: 100 }, frames, framed: true, rootsOf: () => ['/v', '/w'] })).toEqual({ kind: 'move', to: 'me' })
    expect(dropOutcome({ from: 'me', path: '/v/a.md', at: { x: 100, y: 100 }, frames, framed: true, rootsOf })).toEqual({ kind: 'place' })
    expect(dropOutcome({ from: 'me', path: '/v/a.md', at: { x: 2000, y: 100 }, frames, framed: true, rootsOf })).toEqual({ kind: 'place' })
    expect(dropOutcome({ from: 'me', path: '/w/b.md', at: { x: 600, y: 100 }, frames, framed: false, rootsOf })).toEqual({ kind: 'place' })
    // A frame's label row is the frame's too.
    expect(frameAt(frames, 600, 10)).toBe('w2')
    expect(frameAt(frames, 600, -10)).toBeNull()
  })

  it('refuses a window that shows no vault of the page: the card slides back', () => {
    expect(dropOutcome({ from: 'me', path: '/v/a.md', at: { x: 600, y: 100 }, frames, framed: true, rootsOf })).toEqual({ kind: 'refuse', to: 'w2' })
    expect(dropOutcome({ from: 'me', path: '/w/x.md', at: { x: 600, y: 100 }, frames, framed: true, rootsOf })).toEqual({ kind: 'move', to: 'w2' })
    // A window the board knows nothing of shows nothing.
    expect(dropOutcome({ from: 'me', path: '/w/x.md', at: { x: 600, y: 100 }, frames, framed: true, rootsOf: () => undefined })).toEqual({ kind: 'refuse', to: 'w2' })
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
