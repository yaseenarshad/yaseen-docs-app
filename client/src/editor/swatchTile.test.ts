/**
 * One design language (YAZ-4445): the pop-up toolbar's color tiles take each value from the board toolbar's. The
 * engine compiles its SCSS into its own bundle, so `swatchTile.css` holds a copy of each value; this test reads the
 * engine's source and fails when a copy is no longer the engine's value.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const engine = '../../../engine/packages/excalidraw/'
const colorPicker = read(`${engine}components/ColorPicker/ColorPicker.scss`)
const styles = read(`${engine}css/styles.scss`)
const theme = read(`${engine}css/theme.scss`)
const tiles = read('./swatchTile.css')

/** The first value of `property` after `selector` in `source`. */
function valueAfter(source: string, selector: string, property: string): string {
  const at = source.indexOf(selector)
  if (at < 0) throw new Error(`no ${selector}`)
  const match = new RegExp(`(?:^|[\\s;{])${property.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}:\\s*([^;]+);`).exec(source.slice(at))
  if (match === null) throw new Error(`no ${property} after ${selector}`)
  return match[1].trim()
}
const token = (name: string) => valueAfter(tiles, ':root', name)

describe('the pop-up toolbar tiles are the board toolbar tiles (YAZ-4445)', () => {
  it.each([
    ['--swatch-tile-size', () => valueAfter(colorPicker, '.color-picker__button {', '--size')],
    ['--swatch-tile-radius', () => valueAfter(colorPicker, '.color-picker__button {', '--radius')],
    ['--swatch-tile-outline', () => valueAfter(colorPicker, '&.has-outline', 'box-shadow').replace('inset 0 0 0 1px ', '')],
    ['--swatch-tile-letter-size', () => valueAfter(colorPicker, '.color-picker__letter {', 'font-size')],
    ['--swatch-tile-letter-weight', () => valueAfter(colorPicker, '.color-picker__letter {', 'font-weight')],
    ['--swatch-tile-dark', () => valueAfter(colorPicker, '.color-picker__letter {', 'color')],
    ['--swatch-tile-hover-scale', () => /scale\(([\d.]+)\)/.exec(valueAfter(colorPicker, '&:hover:not(.active):not(.color-picker__button--large)', 'transform'))![1]],
    ['--swatch-tile-gap', () => valueAfter(colorPicker, '.color-picker-container--more {', 'gap')],
    ['--swatch-tile-more-gap', () => valueAfter(colorPicker, '.color-picker-container--more {', 'column-gap')],
    ['--swatch-more-width', () => valueAfter(styles, '.text-toolbar-more {', 'width')],
    ['--swatch-more-size', () => valueAfter(styles, '.text-toolbar-more {', 'font-size')],
    ['--swatch-theme-filter', () => valueAfter(theme, '.theme--dark', '--theme-filter')],
  ])('%s is the engine’s value', (name, engineValue) => {
    expect(token(name)).toBe(engineValue())
  })

  it('a white text tile is the board’s dark tile', () => {
    expect(valueAfter(colorPicker, '.color-picker__button--letter-color.is-canonical-white', 'background-color')).toBe(token('--swatch-tile-dark'))
  })
})
