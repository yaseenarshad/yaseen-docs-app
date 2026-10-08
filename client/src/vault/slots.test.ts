/**
 * The slot of a vault (YAZ-2602 D1): `App` holds one scope per slot, so a vault that stays in the
 * window must stay in its slot, whatever the other vaults do.
 */
import { describe, expect, it } from 'vitest'
import { MAX_WINDOW_ROOTS } from '@shared/types'
import { EMPTY_SLOTS, assignSlots, renameSlots } from './slots'

const rest = (n: number): null[] => Array.from({ length: MAX_WINDOW_ROOTS - n }, () => null)

describe('assignSlots', () => {
  it('there are MAX_WINDOW_ROOTS slots, all free in a window with no vault', () => {
    expect(EMPTY_SLOTS).toEqual(rest(0))
    expect(assignSlots(EMPTY_SLOTS, [])).toBe(EMPTY_SLOTS)
  })

  it('a window with one vault uses the first slot', () => {
    expect(assignSlots(EMPTY_SLOTS, ['/v'])).toEqual(['/v', ...rest(1)])
  })

  it('an added vault takes the first free slot, and the others do not move', () => {
    const two = assignSlots(EMPTY_SLOTS, ['/v', '/w'])
    expect(two).toEqual(['/v', '/w', ...rest(2)])
    expect(assignSlots(two, ['/v', '/w', '/x'])).toEqual(['/v', '/w', '/x', ...rest(3)])
  })

  it('a removed vault frees its slot, and the others do not move: vault 3 stays in slot 3', () => {
    const three = assignSlots(EMPTY_SLOTS, ['/v', '/w', '/x'])
    expect(assignSlots(three, ['/w', '/x'])).toEqual([null, '/w', '/x', ...rest(3)])
    expect(assignSlots(three, ['/v', '/x'])).toEqual(['/v', null, '/x', ...rest(3)])
  })

  it('the next vault added takes the slot that was freed', () => {
    const holed = assignSlots(assignSlots(EMPTY_SLOTS, ['/v', '/w', '/x']), ['/v', '/x'])
    expect(assignSlots(holed, ['/v', '/x', '/y'])).toEqual(['/v', '/y', '/x', ...rest(3)])
  })

  it('the order of the vaults in the window does not move a slot', () => {
    const two = assignSlots(EMPTY_SLOTS, ['/v', '/w'])
    expect(assignSlots(two, ['/w', '/v'])).toBe(two)
  })

  it('the same vaults give the same list back, so a render that changed no vault changes no slot', () => {
    const two = assignSlots(EMPTY_SLOTS, ['/v', '/w'])
    expect(assignSlots(two, ['/v', '/w'])).toBe(two)
  })

  it('a window that changes to one other vault ("Open in this window", S61) frees every slot but that vault\'s', () => {
    const two = assignSlots(EMPTY_SLOTS, ['/v', '/w'])
    expect(assignSlots(two, ['/z'])).toEqual(['/z', ...rest(1)])
  })

  it('holds no more vaults than it has slots', () => {
    const many = Array.from({ length: MAX_WINDOW_ROOTS + 2 }, (_, i) => `/v${i}`)
    expect(assignSlots(EMPTY_SLOTS, many)).toEqual(many.slice(0, MAX_WINDOW_ROOTS))
  })
})

describe('renameSlots', () => {
  const three = assignSlots(EMPTY_SLOTS, ['/v', '/home/w', '/x'])

  it('a vault whose folder was renamed keeps its slot under the new path', () => {
    const renamed = renameSlots(three, '/home/w', '/home/w2')
    expect(renamed).toEqual(['/v', '/home/w2', '/x', ...rest(3)])
    expect(assignSlots(renamed, ['/v', '/home/w2', '/x'])).toBe(renamed)
  })

  it('a vault under a renamed folder follows it, by segment', () => {
    expect(renameSlots(three, '/home', '/users')).toEqual(['/v', '/users/w', '/x', ...rest(3)])
    expect(renameSlots(three, '/ho', '/zz')).toBe(three)
  })

  it('a rename that holds no vault changes nothing', () => {
    expect(renameSlots(three, '/v/notes', '/v/pages')).toBe(three)
  })
})
