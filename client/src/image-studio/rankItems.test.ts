/** The Add tab's one ranking (YAZ-4157 D4): a taught word, then the app matcher's tier, then uses, then the last use. */
import { describe, expect, it } from 'vitest'
import type { StudioItem, UsedMediaItem } from '@shared/types'
import { rankItems } from './rankItems'

const item = (key: string, title: string): StudioItem => ({ itemKey: key, provider: 'iconify', providerId: key, kind: 'icon', title })
const used = (it: StudioItem, over: Partial<UsedMediaItem> = {}): [string, UsedMediaItem] => [it.itemKey, { ...it, updatedAt: 1, count: 1, words: [], ...over }]
const none = () => []
const keys = (items: StudioItem[]) => items.map((i) => i.itemKey)

const rocket = item('rocket', 'Rocket')
const rocketShip = item('ship', 'Rocket ship')
const launch = item('launch', 'Launch pad')
const cloud = item('cloud', 'Cloud')

describe('rankItems', () => {
  it('an empty text keeps the input order and every item', () => {
    expect(keys(rankItems([cloud, rocket], new Map(), '  ', none))).toEqual(['cloud', 'rocket'])
  })

  it('orders by the app matcher`s tier: the same name, then a name that starts with it, then one that holds it', () => {
    const pad = item('pad', 'Pad rocket')
    expect(keys(rankItems([pad, rocketShip, rocket, cloud], new Map(), 'rocket', none))).toEqual(['rocket', 'ship', 'pad'])
  })

  it('a word the user taught it comes first, before a better name match (the Emoji app`s learned pick)', () => {
    const map = new Map([used(launch, { words: ['rocket'] })])
    expect(keys(rankItems([rocket, launch], map, 'Rocket', none))).toEqual(['launch', 'rocket'])
  })

  it('a taught word that only HOLDS the text is a match, not a taught pick', () => {
    const map = new Map([used(launch, { words: ['rocketry'] })])
    expect(keys(rankItems([launch, rocket], map, 'rocket', none))).toEqual(['rocket', 'launch'])
  })

  it('within a tier, more uses first, then the newer use, then the input order', () => {
    const a = item('a', 'Star one')
    const b = item('b', 'Star two')
    const c = item('c', 'Star three')
    const d = item('d', 'Star four')
    const map = new Map([used(b, { count: 5, updatedAt: 1 }), used(c, { count: 5, updatedAt: 9 })])
    expect(keys(rankItems([a, b, c, d], map, 'star', none))).toEqual(['c', 'b', 'a', 'd'])
  })

  it('matches an alias, and every word across the names', () => {
    const box = item('box', 'Rounded rectangle')
    const aliases = (i: StudioItem) => (i === box ? ['box'] : [])
    expect(keys(rankItems([cloud, box], new Map(), 'box', aliases))).toEqual(['box'])
    expect(keys(rankItems([cloud, box], new Map(), 'rounded box', aliases))).toEqual(['box'])
    expect(keys(rankItems([cloud, box], new Map(), 'rounded star', aliases))).toEqual([])
  })

  // A tripwire, not a benchmark: the bound leaves room for a slow CI runner (a key press must never wait on this).
  it('ranks a full library and the Hand-drawn index fast: 5,000 items with words in under 50 ms (the old 20 ms for 2,000, per item)', () => {
    const items = Array.from({ length: 5000 }, (_, i) => item(`k${i}`, `Icon number ${i}`))
    const map = new Map(items.slice(0, 500).map((it, i) => used(it, { count: i, words: ['alpha', 'beta', `w${i}`] })))
    rankItems(items, map, 'icon 1', none)
    const start = performance.now()
    for (let i = 0; i < 10; i++) rankItems(items, map, 'icon 12', none)
    const each = (performance.now() - start) / 10
    expect(each).toBeLessThan(50)
  })
})
