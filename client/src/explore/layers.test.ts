/** The explore stack's model (YAZ-2571): the layer list, its cap, the top note, and where each layer stands. */
import { describe, expect, it } from 'vitest'
import { exploreRecents, MAX_EXPLORE_RECENTS, moveExploreRecent, rememberExploreRecent, resetExploreRecents } from './exploreRecents'
import { EDGE_GAP, LAYER_STEP, layerPlace, MAX_LAYERS, newLayerId, NOTE_WIDTH, panelWidth, pushLayer, SEARCH_WIDTH, topNote, type ExploreLayer } from './layers'

const search = (): ExploreLayer => ({ id: newLayerId(), kind: 'search' })
const note = (path: string): ExploreLayer => ({ id: newLayerId(), kind: 'note', path, mode: 'read', wide: false })

describe('the layer list', () => {
  it('pushes on top, 12 at most: a 13th is refused and the list stays', () => {
    let layers: ExploreLayer[] = []
    for (let i = 0; i < MAX_LAYERS; i++) layers = pushLayer(layers, i % 2 === 0 ? search() : note(`/v/${i}.md`))!
    expect(layers).toHaveLength(12)
    expect(pushLayer(layers, search())).toBeNull()
    expect(new Set(layers.map((l) => l.id)).size).toBe(12)
  })

  it('the top note is the note layer nearest the top: what ⌘↵ opens; none with searches alone', () => {
    const a = note('/v/a.md')
    const b = note('/v/b.md')
    expect(topNote([search(), a, search(), b, search()])).toBe(b)
    expect(topNote([search(), a, search()])).toBe(a)
    expect(topNote([search()])).toBeNull()
    expect(topNote([])).toBeNull()
  })
})

describe('where a layer stands (Mochi\'s offsets, clamped to the window)', () => {
  it('each layer 15 px right of the one below, the first one 15 px lower too, the rest at that height', () => {
    const w = 1400
    const base = Math.floor((w - SEARCH_WIDTH) / 2)
    expect(layerPlace('search', 0, w)).toEqual({ left: base, top: 0, width: SEARCH_WIDTH })
    expect(layerPlace('search', 1, w)).toEqual({ left: base + LAYER_STEP, top: LAYER_STEP, width: SEARCH_WIDTH })
    expect(layerPlace('search', 4, w)).toEqual({ left: base + 4 * LAYER_STEP, top: LAYER_STEP, width: SEARCH_WIDTH })
    expect(layerPlace('note', 2, w).width).toBe(NOTE_WIDTH)
    expect(layerPlace('note', 2, w).left).toBe(Math.floor((w - NOTE_WIDTH) / 2) + 2 * LAYER_STEP)
  })

  it('a narrow window: the panel shrinks to leave the edge gap, and the offset stops 8 px before the right edge', () => {
    const w = 600
    expect(panelWidth('note', w)).toBe(w - 2 * EDGE_GAP)
    const deep = layerPlace('note', 11, w)
    expect(deep.left + deep.width).toBeLessThanOrEqual(w - 8)
    expect(deep.left).toBeGreaterThan(layerPlace('note', 0, w).left)
    // Tighter still: no room, so every layer stands at the same left, never off screen.
    const tiny = layerPlace('search', 11, 300)
    expect(tiny.left + tiny.width).toBeLessThanOrEqual(300)
    expect(tiny.width).toBe(240)
  })
})

describe('the recent notes', () => {
  it('newest first, one entry per note, 20 at most; a rename moves one, a delete drops it', () => {
    resetExploreRecents()
    for (let i = 0; i < 25; i++) rememberExploreRecent(`/v/n${i}.md`)
    rememberExploreRecent('/v/n10.md')
    const list = exploreRecents()
    expect(list).toHaveLength(MAX_EXPLORE_RECENTS)
    expect(list[0]).toBe('/v/n10.md')
    expect(list.filter((p) => p === '/v/n10.md')).toHaveLength(1)
    moveExploreRecent('/v/n10.md', '/v/sub/n10.md')
    expect(exploreRecents()[0]).toBe('/v/sub/n10.md')
    moveExploreRecent('/v/sub', null)
    expect(exploreRecents()).not.toContain('/v/sub/n10.md')
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
