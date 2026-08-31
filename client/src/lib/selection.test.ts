/**
 * Pure multi-select reducer (YAZ-1336, 🔒 D1): the sidebar's selection is a path-keyed
 * `ReadonlySet<string>` — toggle-accumulate is the ONLY building gesture (🔒 D2 amended:
 * Yasin ruled toggle, range is out of v1). Reference-equality bailouts matter: Sidebar
 * feeds this to React state, so a no-op action must return the SAME set to skip a render.
 */
import { describe, expect, it } from 'vitest'
import { EMPTY_SELECTION, selectionReducer } from './selection'

const toggle = (sel: ReadonlySet<string>, path: string) => selectionReducer(sel, { type: 'toggle', path })

describe('selectionReducer (YAZ-1336)', () => {
  it('toggle adds an absent path and removes a present one', () => {
    const one = toggle(EMPTY_SELECTION, '/v/a.md')
    expect([...one]).toEqual(['/v/a.md'])
    const two = toggle(one, '/v/b.md')
    expect([...two].sort()).toEqual(['/v/a.md', '/v/b.md'])
    const back = toggle(two, '/v/a.md')
    expect([...back]).toEqual(['/v/b.md'])
  })

  it('toggle never mutates the previous set (and never the shared empty set)', () => {
    const one = toggle(EMPTY_SELECTION, '/v/a.md')
    toggle(one, '/v/b.md')
    toggle(one, '/v/a.md')
    expect([...one]).toEqual(['/v/a.md'])
    expect(EMPTY_SELECTION.size).toBe(0)
  })

  it('clear empties the selection and bails out by reference when already empty', () => {
    const two = toggle(toggle(EMPTY_SELECTION, '/v/a.md'), '/v/b.md')
    const cleared = selectionReducer(two, { type: 'clear' })
    expect(cleared.size).toBe(0)
    expect(selectionReducer(cleared, { type: 'clear' })).toBe(cleared)
  })

  it('prune drops paths that stopped existing and bails out by reference when nothing changed', () => {
    const two = toggle(toggle(EMPTY_SELECTION, '/v/a.md'), '/v/b.md')
    expect(selectionReducer(two, { type: 'prune', exists: () => true })).toBe(two)
    const pruned = selectionReducer(two, { type: 'prune', exists: (p) => p === '/v/b.md' })
    expect([...pruned]).toEqual(['/v/b.md'])
  })
})
