/** Where the hover preview panel goes (YAZ-1800): a pure rule of the sidebar's right edge and the window. */
import { describe, expect, it } from 'vitest'
import { belowPlacement, boardPreviewPlacement } from './previewPlacement'

describe('boardPreviewPlacement', () => {
  it('sits a gap right of the sidebar, a little over half the room wide, vertically centred', () => {
    // usable = 1440 - 260 - 16 = 1164 → width 669; height = min(630, max(220, 455)) = 455.
    expect(boardPreviewPlacement(260, 1440, 900)).toEqual({ left: 276, top: 223, width: 669, height: 455 })
  })

  it('never gets shorter than 220 px, nor taller than 70% of the window', () => {
    // usable = 600 - 260 - 16 = 324 → width 186; height = min(350, max(220, 126)) = 220.
    expect(boardPreviewPlacement(260, 600, 500)).toEqual({ left: 276, top: 140, width: 186, height: 220 })
    // A short window: height = min(round(300 * 0.7), …) = 210, top clamps to the gap.
    expect(boardPreviewPlacement(260, 1440, 300)).toMatchObject({ height: 210, top: 45 })
  })

  it('renders nothing when the window leaves no room beside the sidebar', () => {
    expect(boardPreviewPlacement(260, 280, 800)).toBeNull()
  })

  it('YAZ-3075 D2, C15: a note takes the same place and width, 70% of the window tall', () => {
    // height = round(900 * 0.7) = 630; top = (900 - 630) / 2 = 135.
    expect(boardPreviewPlacement(260, 1440, 900, 'note')).toEqual({ left: 276, top: 135, width: 669, height: 630 })
    expect(boardPreviewPlacement(260, 280, 800, 'note')).toBeNull()
  })
})

describe('belowPlacement (YAZ-3403 D11: a tab of the tab strip)', () => {
  // A 1440 × 900 window: the size beside a card, 520 wide; a board is min(630, max(220, 354)) = 354 tall.
  const tab = { left: 300, top: 0, right: 460, bottom: 36 }

  it('S21: sits half a gap under the tab, from its left edge, at the size it takes beside a card', () => {
    expect(belowPlacement(tab, 1440, 900)).toEqual({ left: 300, top: 44, width: 520, height: 354 })
  })

  it('S16: a tab near the right edge keeps the panel inside the window', () => {
    // 1440 - 16 - 520 = 904.
    expect(belowPlacement({ ...tab, left: 1300, right: 1420 }, 1440, 900)).toMatchObject({ left: 904, top: 44 })
  })

  it('is no taller than the room below the box, and null with no room at all', () => {
    // A note is 630 tall; under a box at 500 the room is 900 - 16 - 508 = 376.
    expect(belowPlacement({ ...tab, top: 470, bottom: 500 }, 1440, 900, 'note')).toEqual({ left: 300, top: 508, width: 520, height: 376 })
    expect(belowPlacement({ ...tab, top: 850, bottom: 880 }, 1440, 900)).toBeNull()
    expect(belowPlacement(tab, 0, 900)).toBeNull()
  })
})
