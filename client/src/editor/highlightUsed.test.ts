/**
 * The highlight panel's most used custom colours (YAZ-4348 demo round 2, `highlightUsed.ts`): the count's order, the
 * cap, and the setting's door.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HIGHLIGHT_CUSTOM_COLORS_KEPT, HIGHLIGHT_CUSTOM_COLORS_SHOWN } from '@shared/types'
import { countUse, mostUsedHighlightColors, recordHighlightColorUse, setUsedHighlightColors, setUsedHighlightColorsSaver } from './highlightUsed'

afterEach(() => {
  setUsedHighlightColors([])
  setUsedHighlightColorsSaver(() => {})
})

describe('most used custom highlight colours (YAZ-4348 demo round 2)', () => {
  it('counts a use, keeps the list most used first, and puts the latest first among equals', () => {
    let list = countUse([], '#111111')
    expect(list).toEqual([{ color: '#111111', uses: 1 }])
    list = countUse(list, '#222222')
    expect(list).toEqual([{ color: '#222222', uses: 1 }, { color: '#111111', uses: 1 }])
    list = countUse(list, '#111111')
    expect(list).toEqual([{ color: '#111111', uses: 2 }, { color: '#222222', uses: 1 }])
    list = countUse(list, '#222222')
    expect(list).toEqual([{ color: '#222222', uses: 2 }, { color: '#111111', uses: 2 }])
  })

  it('keeps at most the cap, the least used going; the row shows the first five', () => {
    let list = Array.from({ length: HIGHLIGHT_CUSTOM_COLORS_KEPT }, (_, i) => ({ color: `#0000${i.toString(16).padStart(2, '0')}`, uses: 2 }))
    list = countUse(list, '#ffffff')
    expect(list).toHaveLength(HIGHLIGHT_CUSTOM_COLORS_KEPT)
    expect(list.at(-1)).toEqual({ color: '#ffffff', uses: 1 })
    list = countUse(list, '#eeeeee')
    expect(list.at(-1)).toEqual({ color: '#eeeeee', uses: 1 })
    expect(list.map((c) => c.color)).not.toContain('#ffffff')
    setUsedHighlightColors(list)
    expect(mostUsedHighlightColors()).toEqual(list.slice(0, HIGHLIGHT_CUSTOM_COLORS_SHOWN).map((c) => c.color))
  })

  it('a use lands at once and goes to the setting\'s door', () => {
    const save = vi.fn()
    setUsedHighlightColorsSaver(save)
    recordHighlightColorUse('#3366ff')
    expect(save).toHaveBeenLastCalledWith([{ color: '#3366ff', uses: 1 }])
    expect(mostUsedHighlightColors()).toEqual(['#3366ff'])
  })
})
