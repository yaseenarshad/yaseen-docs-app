/**
 * THE LASER PREFS AGREE WITH THE VENDORED ENGINE (🔒 YAZ-1989 D1). `shared/` may not import the
 * engine, so its laser lists are copies: this pins them — and the defaults — to what the fork
 * actually exports, so an engine bump that changes a swatch fails here instead of every stored
 * colour silently resetting to red at the IPC guard.
 */
import { describe, expect, it } from 'vitest'
import { prefsToAppState } from '@shared/canvasPrefs'
import { DEFAULT_CANVAS_PREFS, FONT_FAMILY_OPTIONS, LASER_COLORS, LASER_SIZES, LASER_TRAIL_MODES } from '@shared/types'

describe('laser canvas prefs vs the vendored engine', () => {
  it('offer exactly the engine’s modes, swatches and sizes', async () => {
    const engine = await import('@excalidraw/excalidraw')
    expect([...LASER_TRAIL_MODES]).toEqual([...engine.LASER_TRAIL_MODES])
    expect([...LASER_COLORS]).toEqual([...engine.LASER_COLORS])
    expect([...LASER_SIZES]).toEqual(Object.keys(engine.LASER_SIZES))
  })

  it('default to the engine’s own defaults', async () => {
    const engine = await import('@excalidraw/excalidraw')
    const { laserTrailMode, laserColor, laserSize } = engine.restoreAppState(null, null)
    expect(prefsToAppState(DEFAULT_CANVAS_PREFS, ['laserTrailMode', 'laserColor', 'laserSize'])).toEqual({ laserTrailMode, laserColor, laserSize })
  })
})

describe('Settings › Canvas "Default font" vs the vendored engine (YAZ-3037)', () => {
  it('offers only fonts the engine has, the default among them', async () => {
    const engine = await import('@excalidraw/excalidraw')
    const known = new Set<number>(Object.values(engine.FONT_FAMILY))
    expect(FONT_FAMILY_OPTIONS.filter(({ id }) => !known.has(id))).toEqual([])
    expect(FONT_FAMILY_OPTIONS.map(({ id }) => id)).toContain(DEFAULT_CANVAS_PREFS.defaultFontFamily)
  })
})
