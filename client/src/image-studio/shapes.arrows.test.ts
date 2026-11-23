/**
 * The four arrows along a centre line (YAZ-4356) in the Shapes catalog, built from the REAL
 * `@excalidraw/element` (the stand-in of `shapes.test.ts` cannot tell whether the engine's own
 * shapes reach the tiles). The engine's geometry and handle tests are
 * `engine/packages/element/tests/smartShape.test.ts`.
 */
import { describe, expect, it } from 'vitest'
import type { StudioItem } from '@shared/types'
import { rankItems } from './rankItems'
import { buildShapeCatalog, shapeAliases, type ShapeCatalogItem, type SmartShapeApi } from './shapes'

const NEW_ARROWS = [
  ['smart:curved-arrow', 'Curved arrow'],
  ['smart:u-turn-arrow', 'U-turn arrow'],
  ['smart:double-arrow', 'Double arrow'],
  ['smart:circle-arrow', 'Circle arrow'],
] as const

async function realCatalog(): Promise<ShapeCatalogItem[]> {
  return buildShapeCatalog((await import('@excalidraw/element')) as unknown as SmartShapeApi)
}

describe('the Shapes catalog with the engine`s new arrows', () => {
  it('lists the four new arrows right after the four filled arrows', async () => {
    const ids = (await realCatalog()).map(({ id }) => id)
    const start = ids.indexOf('smart:arrow-down') + 1
    expect(ids.slice(start, start + 4)).toEqual(NEW_ARROWS.map(([id]) => id))
  })

  it('gives each one a filled tile drawn from its own outline', async () => {
    const catalog = await realCatalog()
    for (const [id, title] of NEW_ARROWS) {
      const shape = catalog.find((item) => item.id === id)!
      expect(shape.title).toBe(title)
      expect(shape.preview.type).toBe('smart')
      if (shape.preview.type !== 'smart') continue
      expect(shape.preview.closed).toBe(true)
      const points = shape.preview.points.split(' ').map((pair) => pair.split(',').map(Number))
      expect(points.length, id).toBeGreaterThan(10)
      expect(points.flat().every(Number.isFinite), id).toBe(true)
      expect(points.at(-1), id).toEqual(points[0])
      // The viewBox is the outline's box plus 8 % of its longer side on each edge.
      const [, , width, height] = shape.preview.viewBox.split(' ').map(Number)
      const xs = points.map(([x]) => x)
      const ys = points.map(([, y]) => y)
      const longer = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
      expect(width, id).toBeCloseTo(Math.max(...xs) - Math.min(...xs) + longer * 0.16, 6)
      expect(height, id).toBeCloseTo(Math.max(...ys) - Math.min(...ys) + longer * 0.16, 6)
    }
  })

  it('inserts each one as a filled smart shape that carries its parameters', async () => {
    const catalog = await realCatalog()
    for (const [id] of NEW_ARROWS) {
      const [element] = catalog.find((item) => item.id === id)!.create(0, 0) as unknown as [
        { type: string; backgroundColor: string; points: number[][]; customData: { yasinSmartShape: { id: string; kind: string; parameters: Record<string, number> } } },
      ]
      expect(element.type).toBe('line')
      expect(element.backgroundColor).toBe('#1b1b1f')
      expect(element.points.at(-1)).toEqual(element.points[0])
      expect(element.customData.yasinSmartShape.id).toBe(id.slice('smart:'.length))
      expect(element.customData.yasinSmartShape.kind).toBe(id.slice('smart:'.length))
      expect(Object.keys(element.customData.yasinSmartShape.parameters).length).toBeGreaterThan(0)
    }
  })

  it('finds each one by the words people use for it', async () => {
    const catalog = await realCatalog()
    const items: StudioItem[] = catalog.map((shape) => ({ itemKey: `shape:${shape.id}`, provider: 'shape', providerId: shape.id, kind: 'shape', title: shape.title }))
    const byKey = new Map(catalog.map((shape) => [`shape:${shape.id}`, shape]))
    const find = (query: string) => rankItems(items, new Map(), query, (item) => shapeAliases(byKey.get(item.itemKey)!)).map((item) => item.providerId)
    expect(find('curved')[0]).toBe('smart:curved-arrow')
    expect(find('u turn')[0]).toBe('smart:u-turn-arrow')
    expect(find('two way')[0]).toBe('smart:double-arrow')
    expect(find('refresh')[0]).toBe('smart:circle-arrow')
    expect(find('arrow')).toEqual(expect.arrayContaining(NEW_ARROWS.map(([id]) => id)))
  })
})
