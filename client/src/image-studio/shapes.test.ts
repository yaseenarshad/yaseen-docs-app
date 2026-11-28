/**
 * The shapes catalog (YAZ-1818). Pure: the Smart Shapes' half of the engine comes in as a stand-in,
 * so the seven basics, the smart entries, the search and the precomputed tile geometry are
 * all provable with no package loaded and no DOM.
 */
import { describe, expect, it, vi } from 'vitest'
import type { SmartShapeDefinition, SmartShapeId } from '@excalidraw/element'
import type { LocalPoint } from '@excalidraw/math'
import type { StudioItem } from '@shared/types'
import { rankItems } from './rankItems'
import {
  BASIC_SHAPES,
  buildShapeCatalog,
  getShape,
  SHAPE_CATEGORIES,
  SHAPE_CATEGORY_LABELS,
  shapeAliases,
  shapeDirection,
  smartShapeAliases,
  smartShapeCatalog,
  smartShapeCategory,
  smartShapePreview,
  type ShapeCategory,
  type SmartShapeApi,
} from './shapes'

const definition = (over: Partial<SmartShapeDefinition> = {}): SmartShapeDefinition => {
  const kind = over.kind ?? 'filled-arrow'
  return {
    id: 'arrow-right' as SmartShapeId,
    title: 'Arrow right',
    kind,
    category: smartShapeCategory(kind),
    width: 200,
    height: 100,
    closed: true,
    roundness: null,
    defaults: { shaftRatio: 0.5 },
    limits: { shaftRatio: [0.1, 0.9] },
    handles: ['shaft'],
    ...over,
  }
}

/** The three values `@excalidraw/element` would have supplied, as arithmetic we can predict. */
function fakeSmart(definitions: SmartShapeDefinition[] = [definition()]): SmartShapeApi {
  return {
    SMART_SHAPE_DEFINITIONS: definitions,
    generateSmartShapePoints: (_id, width, height) =>
      [
        [0, 0],
        [width, height / 2],
        [0, height],
      ] as unknown as LocalPoint[],
    createSmartShapeMetadata: (id) => ({ version: 1, id, kind: 'filled-arrow', parameters: { shaftRatio: 0.5 } }),
  }
}

describe('the basics, which need no package at all', () => {
  it('is the seven the web app shipped, in its order', () => {
    expect(BASIC_SHAPES.map(({ id }) => id)).toEqual(['rectangle', 'rounded-rectangle', 'circle', 'diamond', 'triangle', 'hexagon', 'star'])
  })

  it('centres a box on the point it is given and gives it the default Architect stroke', () => {
    const [element] = BASIC_SHAPES[0].create(1000, 500) as unknown as [Record<string, unknown>]
    expect(element).toMatchObject({ type: 'rectangle', x: 920, y: 445, width: 160, height: 110, strokeColor: '#1b1b1f', backgroundColor: 'transparent', strokeWidth: 2, roughness: 0 })
    expect(element.customData).toBeUndefined()
  })

  it('gives rectangle and rounded-rectangle distinct basic preview shapes', () => {
    expect(BASIC_SHAPES[0].preview).toEqual({ type: 'basic', shape: 'rectangle' })
    expect(BASIC_SHAPES[1].preview).toEqual({ type: 'basic', shape: 'rounded-rectangle' })
    expect(BASIC_SHAPES.every((shape) => shape.category === 'basic')).toBe(true)
  })

  it('rounds the rounded rectangle and nothing else', () => {
    expect((BASIC_SHAPES[1].create(0, 0)[0] as { roundness?: unknown }).roundness).toEqual({ type: 3 })
    expect((BASIC_SHAPES[0].create(0, 0)[0] as { roundness?: unknown }).roundness).toBeUndefined()
  })

  it('closes a polygon by repeating its first point', () => {
    const line = BASIC_SHAPES[4].create(0, 0)[0] as unknown as { points: [number, number][] }
    expect(line.points[0]).toEqual(line.points[line.points.length - 1])
  })

  it('applies board style, sizeScale, and styleScale to basic boxes and polygons', () => {
    const style = { strokeColor: '#e03131', backgroundColor: '#ffe3e3', fillStyle: 'hachure' as const, strokeWidth: 1.5, roughness: 2, sizeScale: 0.5, styleScale: 2 }
    const [rect] = BASIC_SHAPES[0].create(200, 100, style) as unknown as [Record<string, unknown>]
    expect(rect).toMatchObject({
      type: 'rectangle',
      x: 160,
      y: 72.5,
      width: 80,
      height: 55,
      strokeColor: '#e03131',
      backgroundColor: '#ffe3e3',
      fillStyle: 'hachure',
      strokeWidth: 1.5,
      roughness: 2,
      customData: { styleScale: 2 },
    })

    const [rounded] = BASIC_SHAPES[1].create(200, 100, style) as unknown as [Record<string, unknown>]
    expect(rounded).toMatchObject({ width: 80, height: 55, roundness: { type: 3 }, customData: { styleScale: 2 } })

    const [tri] = BASIC_SHAPES[4].create(200, 100, style) as unknown as [Record<string, unknown> & { points: [number, number][] }]
    expect(tri).toMatchObject({
      type: 'line',
      x: 160,
      y: 65,
      width: 80,
      height: 70,
      strokeColor: '#e03131',
      backgroundColor: '#ffe3e3',
      fillStyle: 'hachure',
      strokeWidth: 1.5,
      roughness: 2,
      customData: { styleScale: 2 },
    })
    expect(tri.points).toEqual([
      [40, 0],
      [80, 70],
      [0, 70],
      [40, 0],
    ])
  })
})

describe('the smart shapes, which need the element package', () => {
  it('renders the basics alone until it lands, then grows by the definitions', () => {
    expect(buildShapeCatalog(null)).toHaveLength(BASIC_SHAPES.length)
    expect(buildShapeCatalog(fakeSmart())).toHaveLength(BASIC_SHAPES.length + 1)
  })

  it('never names the twelve itself — whatever the engine defines is what the tab shows', () => {
    const catalog = smartShapeCatalog(fakeSmart([definition({ id: 'brace-left' as SmartShapeId, title: 'Brace left', kind: 'brace', closed: false })]))
    expect(catalog).toHaveLength(1)
    expect(catalog[0]).toMatchObject({ id: 'smart:brace-left', title: 'Brace left', kind: 'brace', category: 'brackets', direction: 'left' })
  })

  it('inserts ONE line carrying the engine metadata — a real smart shape, not a drawing of one', () => {
    const smart = fakeSmart()
    const [element] = smartShapeCatalog(smart)[0].create(500, 400) as unknown as [Record<string, unknown>]
    expect(element).toMatchObject({ type: 'line', x: 400, y: 350, width: 200, height: 100, backgroundColor: '#1b1b1f', roughness: 0 })
    expect(element.customData).toEqual({ yasinSmartShape: { version: 1, id: 'arrow-right', kind: 'filled-arrow', parameters: { shaftRatio: 0.5 } } })
  })

  it('applies board style and zoom scale to closed and open smart shapes', () => {
    const closed = smartShapeCatalog(fakeSmart())[0]
    // Transparent canvas background keeps closed smart shapes visibly filled with strokeColor.
    const [filledByStroke] = closed.create(500, 400, {
      strokeColor: '#1971c2',
      backgroundColor: 'transparent',
      fillStyle: 'cross-hatch',
      strokeWidth: 1,
      roughness: 0,
      sizeScale: 0.5,
      styleScale: 2,
    }) as unknown as [Record<string, unknown> & { points: [number, number][] }]
    expect(filledByStroke).toMatchObject({
      x: 450,
      y: 375,
      width: 100,
      height: 50,
      strokeColor: '#1971c2',
      backgroundColor: '#1971c2',
      fillStyle: 'cross-hatch',
      strokeWidth: 1,
      roughness: 0,
      customData: {
        yasinSmartShape: { version: 1, id: 'arrow-right', kind: 'filled-arrow', parameters: { shaftRatio: 0.5 } },
        styleScale: 2,
      },
    })
    expect(filledByStroke.points).toEqual([
      [0, 0],
      [100, 25],
      [0, 50],
    ])

    // Explicit non-transparent fill color is respected on closed smart shapes.
    const [explicitFill] = closed.create(0, 0, { strokeColor: '#1971c2', backgroundColor: '#a5d8ff' }) as unknown as [Record<string, unknown>]
    expect(explicitFill.backgroundColor).toBe('#a5d8ff')

    // Open smart shapes stay transparent even when the board has an active fill color.
    const open = smartShapeCatalog(fakeSmart([definition({ id: 'brace-left' as SmartShapeId, kind: 'brace', closed: false })]))[0]
    const [openEl] = open.create(0, 0, { strokeColor: '#1971c2', backgroundColor: '#a5d8ff' }) as unknown as [Record<string, unknown>]
    expect(openEl.backgroundColor).toBe('transparent')
  })

  it('leaves an open shape unfilled', () => {
    const [element] = smartShapeCatalog(fakeSmart([definition({ closed: false })]))[0].create(0, 0) as unknown as [Record<string, unknown>]
    expect(element.backgroundColor).toBe('transparent')
  })

  it('precomputes the tile polygon once, with an 8 % padded viewBox', () => {
    const preview = smartShapePreview(fakeSmart(), definition())
    expect(preview).toMatchObject({ type: 'smart', closed: true, points: '0,0 200,50 0,100' })
    // width 200, height 100 → padding = 200 * 0.08 = 16
    expect(preview.viewBox).toBe('-16 -16 232 132')
  })

  it('builds the preview once per catalog build, not once per render', () => {
    const smart = fakeSmart()
    const generate = vi.spyOn(smart, 'generateSmartShapePoints')
    const catalog = smartShapeCatalog(smart)
    expect(generate).toHaveBeenCalledTimes(1)
    expect(catalog[0].preview.type).toBe('smart')
  })

  it('reads a direction out of the id, and only out of the end of it', () => {
    expect(shapeDirection('arrow-right')).toBe('right')
    expect(shapeDirection('callout-rounded')).toBeUndefined()
    expect(shapeDirection('right-arrow')).toBeUndefined()
  })

  it('has a category and non-empty aliases for every one of the 32 smart kinds', () => {
    const expectedCategories: Record<string, ShapeCategory> = {
      'filled-arrow': 'arrows',
      'curved-arrow': 'arrows',
      'u-turn-arrow': 'arrows',
      'double-arrow': 'arrows',
      'circle-arrow': 'arrows',
      'bent-arrow': 'arrows',
      'pentagon-arrow': 'arrows',
      'notched-arrow': 'arrows',
      chevron: 'arrows',
      brace: 'brackets',
      bracket: 'brackets',
      parenthesis: 'brackets',
      callout: 'callouts',
      cloud: 'callouts',
      'note-fold': 'callouts',
      document: 'callouts',
      pill: 'basic',
      'right-triangle': 'basic',
      pentagon: 'basic',
      octagon: 'basic',
      parallelogram: 'basic',
      trapezoid: 'basic',
      plus: 'basic',
      'star-4': 'basic',
      starburst: 'basic',
      heart: 'basic',
      semicircle: 'basic',
      bookmark: 'banners',
      tag: 'banners',
      shield: 'banners',
      ribbon: 'banners',
      cylinder: 'banners',
    }
    expect(SHAPE_CATEGORIES).toEqual(['basic', 'arrows', 'brackets', 'callouts', 'banners'])
    expect(SHAPE_CATEGORY_LABELS).toEqual({
      basic: 'Basic',
      arrows: 'Arrows',
      brackets: 'Brackets & Braces',
      callouts: 'Callouts',
      banners: 'Banners & Flow',
    })
    expect(Object.keys(expectedCategories)).toHaveLength(32)
    for (const [kind, category] of Object.entries(expectedCategories)) {
      expect(smartShapeCategory(kind), kind).toBe(category)
      expect(smartShapeAliases(kind).length, kind).toBeGreaterThan(0)
    }
  })

  it('prefers definition.category when the engine provides it, falling back to smartShapeCategory', () => {
    const withCategory = { ...definition({ kind: 'filled-arrow' }), category: 'banners' as ShapeCategory } as SmartShapeDefinition
    const withoutCategory = { ...definition({ kind: 'callout' }), category: undefined as unknown as ShapeCategory } as SmartShapeDefinition
    expect(smartShapeCatalog(fakeSmart([withCategory]))[0].category).toBe('banners')
    expect(smartShapeCatalog(fakeSmart([withoutCategory]))[0].category).toBe('callouts')
  })
})

describe('searching the catalog (through the Add tab`s one ranking, YAZ-4157 D4)', () => {
  const catalog = buildShapeCatalog(fakeSmart())
  const items: StudioItem[] = catalog.map((shape) => ({ itemKey: `shape:${shape.id}`, provider: 'shape', providerId: shape.id, kind: 'shape', title: shape.title }))
  const byKey = new Map(catalog.map((shape) => [`shape:${shape.id}`, shape]))
  const find = (query: string) => rankItems(items, new Map(), query, (item) => shapeAliases(byKey.get(item.itemKey)!)).map((item) => item.providerId)

  it('answers with everything for an empty query', () => {
    expect(find('   ')).toHaveLength(catalog.length)
  })

  it('matches on the title, an alias, the kind and the direction', () => {
    expect(find('square')[0]).toBe('rectangle')
    expect(find('decision')).toEqual(['diamond'])
    expect(find('pointer')).toEqual(['smart:arrow-right'])
    expect(find('right')[0]).toBe('smart:arrow-right')
  })

  it('needs EVERY word to match, not any of them — across the names, too', () => {
    expect(find('rounded box')).toHaveLength(1)
    expect(find('rounded star')).toHaveLength(0)
  })

  it('ignores case, and answers nothing for a word no shape has', () => {
    expect(find('HEXAGON')).toEqual(['hexagon'])
    expect(find('dodecahedron')).toHaveLength(0)
  })

  it('the aliases of a shape are its id, kind, direction and alias words', () => {
    expect(shapeAliases(getShape(catalog, 'smart:arrow-right')!)).toEqual(expect.arrayContaining(['smart:arrow-right', 'right', 'pointer']))
  })

  it('finds a shape by id, and answers undefined for one that is not there', () => {
    expect(getShape(catalog, 'smart:arrow-right')?.title).toBe('Arrow right')
    expect(getShape(catalog, 'smart:nothing')).toBeUndefined()
    // The Smart Shapes are not in the catalog until the package lands — a click on one is a no-op,
    // never a crash. `ImageStudio` turns that into "That shape is not available yet."
    expect(getShape(buildShapeCatalog(null), 'smart:arrow-right')).toBeUndefined()
  })
})
