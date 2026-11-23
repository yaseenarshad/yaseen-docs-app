import { describe, expect, it } from 'vitest'
import { sanitizeElements } from './sanitizeScene'

type El = Record<string, unknown> & { id: string }

const el = (id: string, over: Partial<El> = {}): El => ({
  id,
  type: 'rectangle',
  x: 0,
  y: 0,
  index: 'a0',
  version: 1,
  versionNonce: 10,
  updated: 1000,
  isDeleted: false,
  ...over,
})

describe('sanitizeElements (YAZ-4279 item 5)', () => {
  it('returns clean elements untouched with repaired === 0', () => {
    const a = el('a', { index: 'a0' })
    const b = el('b', { index: 'a1', type: 'text', text: 'hello', originalText: 'hello' })
    const res = sanitizeElements([a, b])
    expect(res.repaired).toBe(0)
    expect(res.elements).toHaveLength(2)
    expect(res.elements[0]).toBe(a)
    expect(res.elements[1]).toBe(b)
  })

  it('repairs duplicate IDs by keeping the first and renaming duplicates without colliding with existing IDs', () => {
    const a1 = el('a', { index: 'a0', x: 1 })
    const a2 = el('a', { index: 'a1', x: 2 })
    const aDup1 = el('a-dup-1', { index: 'a2', x: 3 })
    const a3 = el('a', { index: 'a3', x: 4 })
    const res = sanitizeElements([a1, a2, aDup1, a3])
    expect(res.elements.map((e) => e.id)).toEqual(['a', 'a-dup-2', 'a-dup-1', 'a-dup-3'])
    expect(res.elements.map((e) => e.x)).toEqual([1, 2, 3, 4])
    expect(res.repaired).toBe(2)
    // Input objects are not mutated
    expect(a2.id).toBe('a')
  })

  it('repairs missing, duplicate, or non-monotonic indices into strictly increasing lexicographical order', () => {
    // Missing index
    const missing = sanitizeElements([el('a', { index: undefined }), el('b', { index: 'a1' })])
    expect(missing.repaired).toBeGreaterThan(0)
    expect(typeof missing.elements[0].index).toBe('string')
    expect((missing.elements[0].index as string) < (missing.elements[1].index as string)).toBe(true)

    // Duplicate index
    const dup = sanitizeElements([el('a', { index: 'a0' }), el('b', { index: 'a0' }), el('c', { index: 'a1' })])
    expect(dup.repaired).toBeGreaterThan(0)
    expect((dup.elements[0].index as string) < (dup.elements[1].index as string)).toBe(true)
    expect((dup.elements[1].index as string) < (dup.elements[2].index as string)).toBe(true)

    // Non-monotonic index
    const nonMono = sanitizeElements([el('a', { index: 'a5' }), el('b', { index: 'a2' }), el('c', { index: 'a3' })])
    expect(nonMono.repaired).toBeGreaterThan(0)
    expect((nonMono.elements[0].index as string) < (nonMono.elements[1].index as string)).toBe(true)
    expect((nonMono.elements[1].index as string) < (nonMono.elements[2].index as string)).toBe(true)

    // Large count (> 62 to verify multi-digit base62 rollover)
    const many = Array.from({ length: 100 }, (_, i) => el(`e${i}`, { index: undefined }))
    const res = sanitizeElements(many)
    for (let i = 1; i < res.elements.length; i++) {
      expect((res.elements[i - 1].index as string) < (res.elements[i].index as string)).toBe(true)
    }
  })

  it('clears broken containerId and frameId pointing to missing, deleted, or self elements', () => {
    const aliveBox = el('box', { index: 'a0' })
    const deadBox = el('dead-box', { index: 'a1', isDeleted: true })
    const aliveFrame = el('frame', { index: 'a2', type: 'frame' })
    const deadFrame = el('dead-frame', { index: 'a3', type: 'frame', isDeleted: true })
    const okText = el('ok', { index: 'a4', type: 'text', text: 'ok', originalText: 'ok', containerId: 'box', frameId: 'frame' })
    const badText = el('bad', { index: 'a5', type: 'text', text: 'bad', originalText: 'bad', containerId: 'dead-box', frameId: 'missing-frame' })
    const badText2 = el('bad2', { index: 'a6', type: 'text', text: 'bad2', originalText: 'bad2', containerId: 'missing-box', frameId: 'dead-frame' })
    const selfRef = el('self', { index: 'a7', containerId: 'self', frameId: 'self' })

    const res = sanitizeElements([aliveBox, deadBox, aliveFrame, deadFrame, okText, badText, badText2, selfRef])
    const byId = new Map(res.elements.map((e) => [e.id, e]))
    expect(byId.get('ok')?.containerId).toBe('box')
    expect(byId.get('ok')?.frameId).toBe('frame')
    expect(byId.get('bad')?.containerId).toBeNull()
    expect(byId.get('bad')?.frameId).toBeNull()
    expect(byId.get('bad2')?.containerId).toBeNull()
    expect(byId.get('bad2')?.frameId).toBeNull()
    expect(byId.get('self')?.containerId).toBeNull()
    expect(byId.get('self')?.frameId).toBeNull()
    expect(res.repaired).toBe(6)
  })

  it('filters broken and duplicate entries from boundElements', () => {
    const arrow = el('arr', { index: 'a0', type: 'arrow' })
    const deadArrow = el('dead-arr', { index: 'a1', type: 'arrow', isDeleted: true })
    const box = el('box', {
      index: 'a2',
      boundElements: [
        { id: 'arr', type: 'arrow' },
        { id: 'arr', type: 'arrow' },
        { id: 'dead-arr', type: 'arrow' },
        { id: 'missing', type: 'text' },
        { id: 'box', type: 'arrow' },
      ],
    })
    const allBadBox = el('box2', {
      index: 'a3',
      boundElements: [{ id: 'missing', type: 'arrow' }],
    })

    const res = sanitizeElements([arrow, deadArrow, box, allBadBox])
    const byId = new Map(res.elements.map((e) => [e.id, e]))
    expect(byId.get('box')?.boundElements).toEqual([{ id: 'arr', type: 'arrow' }])
    expect(byId.get('box2')?.boundElements).toBeNull()
    expect(res.repaired).toBe(2)
  })

  it('fills missing or null originalText from text on text elements', () => {
    const t1 = el('t1', { index: 'a0', type: 'text', text: 'Hello' })
    const t2 = el('t2', { index: 'a1', type: 'text', text: 'World', originalText: null })
    const t3 = el('t3', { index: 'a2', type: 'text', text: 'Keep', originalText: 'Original' })
    const res = sanitizeElements([t1, t2, t3])
    expect(res.elements[0].originalText).toBe('Hello')
    expect(res.elements[1].originalText).toBe('World')
    expect(res.elements[2].originalText).toBe('Original')
    expect(res.repaired).toBe(2)
  })

  it('drops deleted elements when stripDeleted is true', () => {
    const a = el('a', { index: 'a0' })
    const b = el('b', { index: 'a1', isDeleted: true })
    const c = el('c', { index: 'a2' })
    const res = sanitizeElements([a, b, c], { stripDeleted: true })
    expect(res.elements.map((e) => e.id)).toEqual(['a', 'c'])
    expect(res.repaired).toBe(0)
  })

  it('bumps version, versionNonce, and updated when bumpVersions is true without mutating inputs', () => {
    const a = el('a', { index: 'a0', version: 4, versionNonce: 123, updated: 500 })
    const res = sanitizeElements([a], { bumpVersions: true })
    expect(res.elements[0]).not.toBe(a)
    expect(res.elements[0].version).toBe(5)
    expect(typeof res.elements[0].versionNonce).toBe('number')
    expect((res.elements[0].updated as number) >= 1000).toBe(true)
    expect(res.repaired).toBe(0)
    // Input untouched
    expect(a.version).toBe(4)
  })

  it('drops malformed non-object or missing-id entries and counts them as repaired', () => {
    const a = el('a', { index: 'a0' })
    const res = sanitizeElements([null, 'bad', { type: 'rectangle' }, { id: '' }, a])
    expect(res.elements).toEqual([a])
    expect(res.repaired).toBe(4)
  })
})
