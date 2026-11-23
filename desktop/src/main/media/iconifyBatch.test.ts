/**
 * The Iconify tile pictures in batches (YAZ-4157 demo 6G): the SVG built from a set's data, and the one request per
 * icon set that the tiles of one page share.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BATCH_WAIT_MS, createIconifyBatcher, iconSvg, MAX_BATCH_ICONS, type IconifySetData } from './iconifyBatch'

const set: IconifySetData = {
  prefix: 'noto',
  width: 128,
  height: 128,
  icons: { rocket: { body: '<path d="M1 1"/>' }, wide: { body: '<g/>', width: 256 }, turned: { body: '<g/>', rotate: 1 } },
  aliases: { ship: { parent: 'rocket' }, tall: { parent: 'rocket', height: 200 }, flipped: { parent: 'rocket', hFlip: true }, loop: { parent: 'loop' } },
}

describe('iconSvg', () => {
  it('builds the SVG the .svg endpoint would answer: the set`s box, the icon`s own box over it', () => {
    expect(iconSvg(set, 'rocket')).toBe('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1em" height="1em" viewBox="0 0 128 128"><path d="M1 1"/></svg>')
    expect(iconSvg(set, 'wide')).toContain('viewBox="0 0 256 128"')
    expect(iconSvg({ icons: { dot: { body: '<g/>' } } }, 'dot')).toContain('viewBox="0 0 16 16"')
  })

  it('follows an alias to its parent; the alias`s own box wins', () => {
    expect(iconSvg(set, 'ship')).toContain('<path d="M1 1"/>')
    expect(iconSvg(set, 'tall')).toContain('viewBox="0 0 128 200"')
  })

  it('is null for a missing icon, a rotated or flipped one, and an alias loop: the caller fetches that SVG on its own', () => {
    expect(iconSvg(set, 'nope')).toBeNull()
    expect(iconSvg(set, 'turned')).toBeNull()
    expect(iconSvg(set, 'flipped')).toBeNull()
    expect(iconSvg(set, 'loop')).toBeNull()
  })

  it('builds a turned or flipped icon itself when asked (a downloaded pack, YAZ-4359), as Iconify`s own iconToSVG does', () => {
    const square = { width: 24, height: 24, icons: { arrow: { body: '<path d="A"/>' }, wide: { body: '<path d="W"/>', width: 32 } }, aliases: { down: { parent: 'arrow', rotate: 1 }, left: { parent: 'arrow', hFlip: true }, both: { parent: 'left', vFlip: true }, side: { parent: 'wide', rotate: 1 } } }
    expect(iconSvg(square, 'down', { transforms: true })).toContain('<g transform="rotate(90 12 12)"><path d="A"/></g>')
    expect(iconSvg(square, 'left', { transforms: true })).toContain('<g transform="translate(24 0) scale(-1 1)"><path d="A"/></g>')
    // Two flips are a half turn.
    expect(iconSvg(square, 'both', { transforms: true })).toContain('<g transform="rotate(180 12 12)">')
    // A quarter turn swaps the box's sides.
    expect(iconSvg(square, 'side', { transforms: true })).toContain('viewBox="0 0 24 32"')
    expect(iconSvg(square, 'arrow', { transforms: true })).toBe(iconSvg(square, 'arrow'))
  })
})

describe('createIconifyBatcher', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('one request per icon set for the tiles asked within the wait', async () => {
    const fetchSet = vi.fn(async () => set)
    const batch = createIconifyBatcher(fetchSet)
    const asked = [batch.svg('noto:rocket'), batch.svg('noto:ship'), batch.svg('noto:rocket'), batch.svg('mdi:nail')]
    await vi.advanceTimersByTimeAsync(BATCH_WAIT_MS)
    const [rocket, ship, again] = await Promise.all(asked.slice(0, 3))
    expect(fetchSet).toHaveBeenCalledTimes(2)
    expect(fetchSet).toHaveBeenCalledWith('noto', ['rocket', 'ship'])
    expect(fetchSet).toHaveBeenCalledWith('mdi', ['nail'])
    expect(rocket).toContain('<path d="M1 1"/>')
    expect(again).toBe(rocket)
    expect(ship).toBe(rocket)
    await expect(asked[3]).resolves.toBeNull()
  })

  it(`a set with ${MAX_BATCH_ICONS} icons waiting is asked at once`, async () => {
    const fetchSet = vi.fn(async () => set)
    const batch = createIconifyBatcher(fetchSet)
    for (let i = 0; i < MAX_BATCH_ICONS; i++) void batch.svg(`noto:i${i}`)
    expect(fetchSet).toHaveBeenCalledTimes(1)
    void batch.svg('noto:next')
    await vi.advanceTimersByTimeAsync(BATCH_WAIT_MS)
    expect(fetchSet).toHaveBeenCalledTimes(2)
    expect(fetchSet).toHaveBeenLastCalledWith('noto', ['next'])
  })

  it('a failed request fails every tile that waited on it', async () => {
    const batch = createIconifyBatcher(async () => {
      throw new Error('busy')
    })
    const both = Promise.allSettled([batch.svg('noto:rocket'), batch.svg('noto:ship')])
    await vi.advanceTimersByTimeAsync(BATCH_WAIT_MS)
    expect((await both).map((r) => r.status)).toEqual(['rejected', 'rejected'])
  })
})
