/**
 * YAZ-4445: the pop-up toolbar's text colors are the board toolbar's (`actionProperties.tsx`
 * `TEXT_TOOLBAR_COLOR_PICKS`, `TEXT_TOOLBAR_MORE_COLORS`: the palette's stroke shade), with the board's names.
 */
import { describe, expect, it } from 'vitest'
import { COLOR_PALETTE, DEFAULT_ELEMENT_STROKE_COLOR_INDEX } from '@excalidraw/common'
import { TEXT_BOX_COLORS, TEXT_BOX_MORE_COLORS } from './textColorPanel'

const stroke = (name: 'red' | 'blue' | 'green' | 'orange' | 'violet' | 'gray') => COLOR_PALETTE[name][DEFAULT_ELEMENT_STROKE_COLOR_INDEX]

describe('the text colors of a text box (YAZ-4445)', () => {
  it('the three tiles and the ▾ are the board toolbar’s colors, in its order', () => {
    expect(TEXT_BOX_COLORS.map((c) => c.color)).toEqual([COLOR_PALETTE.black, stroke('red'), stroke('blue')])
    expect(TEXT_BOX_MORE_COLORS.map((c) => c.color)).toEqual([stroke('green'), COLOR_PALETTE.white, stroke('orange'), stroke('violet'), stroke('gray')])
  })

  it('each is named as on the board: "Text red"', () => {
    expect([...TEXT_BOX_COLORS, ...TEXT_BOX_MORE_COLORS].map((c) => c.name)).toEqual([
      'Text black', 'Text red', 'Text blue', 'Text green', 'Text white', 'Text orange', 'Text violet', 'Text gray',
    ])
  })
})
