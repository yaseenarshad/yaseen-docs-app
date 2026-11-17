/** The explore stack's model (YAZ-2571): the layer list, its cap, the top page, and where each layer stands. */
import { describe, expect, it } from 'vitest'
import { exploreRecents, MAX_EXPLORE_RECENTS, moveExploreRecent, rememberExploreRecent, resetExploreRecents } from './exploreRecents'
import { EDGE_GAP, frontOrder, LAYER_STEP, layerBoxes, layerPlace, MAX_LAYERS, MIN_BOX_HEIGHT, MIN_BOX_WIDTH, newLayerId, PAGE_WIDTH, panelWidth, pushLayer, raiseLayer, savedLayerBox, saveLayerBox, SEARCH_WIDTH, layerKindOf, stepCount, stepPlace, stepResult, topPage, type ExploreLayer, type LayerBox } from './layers'

const search = (): ExploreLayer => ({ id: newLayerId(), kind: 'search' })
const page = (path: string): ExploreLayer => ({ id: newLayerId(), kind: 'page', path, mode: 'read' })

describe('the layer list', () => {
  it('pushes on top, 12 at most: a 13th is refused and the list stays', () => {
    let layers: ExploreLayer[] = []
    for (let i = 0; i < MAX_LAYERS; i++) layers = pushLayer(layers, i % 2 === 0 ? search() : page(`/v/${i}.md`))!
    expect(layers).toHaveLength(12)
    expect(pushLayer(layers, search())).toBeNull()
    expect(new Set(layers.map((l) => l.id)).size).toBe(12)
  })

  it('the top page is the page layer nearest the top: what ⌘↵ opens; none with searches alone', () => {
    const a = page('/v/a.md')
    const b = page('/v/b.md')
    expect(topPage([search(), a, search(), b, search()])).toBe(b)
    expect(topPage([search(), a, search()])).toBe(a)
    expect(topPage([search()])).toBeNull()
    expect(topPage([])).toBeNull()
    // YAZ-4943: a board layer is opened in a tab by ⌘↵ too.
    const board: ExploreLayer = { id: newLayerId(), kind: 'board', path: '/v/d.drawio' }
    expect(topPage([search(), a, board, search()])).toBe(board)
  })

  it('YAZ-4943: a page opens as a page layer, a drawing or a diagram as a board layer; anything else in a tab', () => {
    expect(['/v/a.md', '/v/b.excalidraw', '/v/C.DRAWIO', '/v/folder', '/v/p.pdf', '/v/x.png'].map(layerKindOf)).toEqual(['page', 'board', 'board', null, null, null])
  })
})

describe('layers act like windows (round 6): the front order', () => {
  it('with no raise the front order is the list; a raise puts one layer in front and the others keep their order', () => {
    const [s, a, s2, b] = [search(), page('/v/a.md'), search(), page('/v/b.md')]
    const list = [s, a, s2, b]
    expect(frontOrder(list, [])).toEqual(list)
    const order = raiseLayer(list, [], a.id)
    expect(frontOrder(list, order)).toEqual([s, s2, b, a])
    // Raised again: the search goes to the front, the rest keep their order.
    expect(frontOrder(list, raiseLayer(list, order, s.id))).toEqual([s2, b, a, s])
    // The front one raised: no change.
    expect(raiseLayer(list, order, a.id)).toEqual(order)
  })

  it('a layer opened after a raise goes in front; a closed layer leaves the order; an unknown id changes nothing', () => {
    const [s, a, b] = [search(), page('/v/a.md'), page('/v/b.md')]
    const order = raiseLayer([s, a, b], [], s.id)
    const c = page('/v/c.md')
    expect(frontOrder([s, a, b, c], order)).toEqual([a, b, s, c])
    expect(frontOrder([a, b, c], order)).toEqual([a, b, c])
    expect(raiseLayer([s, a, b], order, 999)).toEqual(order)
  })
})

describe('where a layer stands (Mochi\'s offsets, clamped to the window)', () => {
  it('each layer 15 px right of the one below, the first one 15 px lower too, the rest at that height', () => {
    const w = 1400
    const base = Math.floor((w - SEARCH_WIDTH) / 2)
    expect(layerPlace('search', 0, w)).toEqual({ left: base, top: 0, width: SEARCH_WIDTH })
    expect(layerPlace('search', 1, w)).toEqual({ left: base + LAYER_STEP, top: LAYER_STEP, width: SEARCH_WIDTH })
    expect(layerPlace('search', 4, w)).toEqual({ left: base + 4 * LAYER_STEP, top: LAYER_STEP, width: SEARCH_WIDTH })
    expect(layerPlace('page', 2, w).width).toBe(PAGE_WIDTH)
    expect(layerPlace('page', 2, w).left).toBe(Math.floor((w - PAGE_WIDTH) / 2) + 2 * LAYER_STEP)
  })

  it('a narrow window: the panel shrinks to leave the edge gap, and the offset stops 8 px before the right edge', () => {
    const w = 600
    expect(panelWidth('page', w)).toBe(w - 2 * EDGE_GAP)
    const deep = layerPlace('page', 11, w)
    expect(deep.left + deep.width).toBeLessThanOrEqual(w - 8)
    expect(deep.left).toBeGreaterThan(layerPlace('page', 0, w).left)
    // Tighter still: no room, so every layer stands at the same left, never off screen.
    const tiny = layerPlace('search', 11, 300)
    expect(tiny.left + tiny.width).toBeLessThanOrEqual(300)
    expect(tiny.width).toBe(240)
  })
})

describe('‹ › through the search (round 3)', () => {
  const rows = [{ path: '/v/a.md' }, { path: '/v/folder' }, { path: '/v/b.md' }, { path: '/v/c.md' }, { path: '/v/draw.excalidraw' }, { path: '/v/p.pdf' }]

  it('steps to the next page or board row in the search\'s order (YAZ-4943: boards too), a folder or another file skipped; null at either end', () => {
    expect(stepResult(rows, 0, '/v/a.md', 1)).toEqual({ at: 2, path: '/v/b.md' })
    expect(stepResult(rows, 2, '/v/b.md', 1)).toEqual({ at: 3, path: '/v/c.md' })
    expect(stepResult(rows, 3, '/v/c.md', 1)).toEqual({ at: 4, path: '/v/draw.excalidraw' })
    expect(stepResult(rows, 4, '/v/draw.excalidraw', 1)).toBeNull()
    expect(stepResult(rows, 4, '/v/draw.excalidraw', -1)).toEqual({ at: 3, path: '/v/c.md' })
    expect(stepResult(rows, 3, '/v/c.md', -1)).toEqual({ at: 2, path: '/v/b.md' })
    expect(stepResult(rows, 2, '/v/b.md', -1)).toEqual({ at: 0, path: '/v/a.md' })
    expect(stepResult(rows, 0, '/v/a.md', -1)).toBeNull()
    expect(stepPlace(rows, 2, '/v/b.md')).toBe(2)
  })

  it('n/m counts only the rows ‹ › step to (YAZ-2571 nit): a folder or another file is not counted', () => {
    expect(stepCount(rows)).toBe(4)
    expect(rows.filter((r) => layerKindOf(r.path) !== null).map((r) => stepPlace(rows, rows.indexOf(r), r.path))).toEqual([1, 2, 3, 4])
    // A search whose first row is a folder: its first page is 1/m, not 2/m.
    const folderFirst = [{ path: '/v/cloud' }, { path: '/v/cloud.md' }, { path: '/v/b.md' }]
    expect(`${stepPlace(folderFirst, 1, '/v/cloud.md')}/${stepCount(folderFirst)}`).toBe('1/2')
  })

  it('a page no longer at its place is found again; one gone from the rows steps from its last place', () => {
    expect(stepResult(rows, 0, '/v/b.md', 1)).toEqual({ at: 3, path: '/v/c.md' })
    expect(stepPlace(rows, 0, '/v/b.md')).toBe(2)
    const without = rows.filter((r) => r.path !== '/v/b.md')
    expect(stepResult(without, 2, '/v/b.md', 1)).toEqual({ at: 2, path: '/v/c.md' })
    expect(stepResult(without, 2, '/v/b.md', -1)).toEqual({ at: 0, path: '/v/a.md' })
    expect(stepPlace(without, 2, '/v/b.md')).toBe(0)
  })
})

describe('layers that move like a cell note (round 3)', () => {
  const W = 1400
  const H = 900
  const margin = Math.round(H * 0.1)

  it('with nothing moved, each layer stands at its stack place under the 10vh margin, no height of its own', () => {
    const list = [search(), page('/v/a.md'), search()]
    const boxes = layerBoxes(list, new Map(), W, H)
    list.forEach((layer, i) => {
      const base = layerPlace(layer.kind, i, W)
      expect(boxes[i]).toEqual({ x: base.left, y: margin + base.top, width: base.width, height: null })
    })
  })

  it('a moved layer stands in its own box, and the layers above it open next to it, wherever it is now', () => {
    const list = [search(), page('/v/a.md'), page('/v/b.md')]
    const moved = new Map<number, LayerBox>([[list[0].id, { x: 300, y: 50, width: 560, height: 300 }]])
    const boxes = layerBoxes(list, moved, W, H)
    expect(boxes[0]).toEqual({ x: 300, y: 50, width: 560, height: 300 })
    const base0 = layerPlace('search', 0, W)
    const base1 = layerPlace('page', 1, W)
    // The page's home is its stack place shifted by the search's move from ITS stack place.
    expect(boxes[1]).toEqual({ x: base1.left + (300 - base0.left), y: margin + base1.top + (50 - margin), width: PAGE_WIDTH, height: null })
    // The second page follows the first page's place, which follows the search's.
    const base2 = layerPlace('page', 2, W)
    expect(boxes[2].x).toBe(base2.left + (300 - base0.left))
    expect(boxes[2].y).toBe(margin + base2.top + (50 - margin))
    // A layer moved on its own shifts the ones above it by its own move too.
    moved.set(list[1].id, { x: 600, y: 100, width: PAGE_WIDTH, height: null })
    const again = layerBoxes(list, moved, W, H)
    expect(again[2].x).toBe(base2.left + (600 - base1.left))
  })

  it('every box fits the window: the size cut to it, the corner kept on screen, never smaller than the least size', () => {
    const list = [page('/v/a.md')]
    const moved = new Map<number, LayerBox>([[list[0].id, { x: 2000, y: -30, width: 3000, height: 5000 }]])
    expect(layerBoxes(list, moved, W, H)[0]).toEqual({ x: W - W, y: 0, width: W, height: H })
    moved.set(list[0].id, { x: 1300, y: 880, width: 10, height: 10 })
    expect(layerBoxes(list, moved, W, H)[0]).toEqual({ x: W - MIN_BOX_WIDTH, y: H - MIN_BOX_HEIGHT, width: MIN_BOX_WIDTH, height: MIN_BOX_HEIGHT })
  })

  it('the first layer\'s box is kept per kind in localStorage; a bad or missing value reads as none', () => {
    saveLayerBox('search', { x: 10, y: 20, width: 500, height: null })
    expect(savedLayerBox('search')).toEqual({ x: 10, y: 20, width: 500, height: null })
    expect(savedLayerBox('page')).toBeNull()
    localStorage.setItem('explore:box:page', '{"x":"no"}')
    expect(savedLayerBox('page')).toBeNull()
    saveLayerBox('search', null)
    expect(savedLayerBox('search')).toBeNull()
    localStorage.removeItem('explore:box:page')
  })
})

describe('the recent pages', () => {
  it('newest first, one entry per page, 100 at most (YAZ-4945: kept, across vaults); a rename moves one, a delete drops it', () => {
    resetExploreRecents()
    for (let i = 0; i < 105; i++) rememberExploreRecent(`/v/n${i}.md`)
    rememberExploreRecent('/v/n10.md')
    const list = exploreRecents().map((e) => e.path)
    expect(list).toHaveLength(MAX_EXPLORE_RECENTS)
    expect(list[0]).toBe('/v/n10.md')
    expect(list.filter((p) => p === '/v/n10.md')).toHaveLength(1)
    moveExploreRecent('/v/n10.md', '/v/sub/n10.md')
    expect(exploreRecents()[0].path).toBe('/v/sub/n10.md')
    moveExploreRecent('/v/sub', null)
    expect(exploreRecents().map((e) => e.path)).not.toContain('/v/sub/n10.md')
    expect(exploreRecents()).toHaveLength(MAX_EXPLORE_RECENTS - 1)
    resetExploreRecents()
  })
})

describe('"Clicking a link" (YAZ-4936)', () => {
  it('reads the vault file, the default for anything else', async () => {
    const { sanitizeLinkClick } = await import('./linkClick')
    expect(sanitizeLinkClick({ click: 'explore' })).toEqual({ click: 'explore' })
    expect(sanitizeLinkClick({ click: 'open' })).toEqual({ click: 'open' })
    expect(sanitizeLinkClick({ click: 'x' })).toEqual({ click: 'open' })
    expect(sanitizeLinkClick(null)).toEqual({ click: 'open' })
    expect(sanitizeLinkClick('explore')).toEqual({ click: 'open' })
  })
})
