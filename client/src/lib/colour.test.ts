/**
 * The one colour maths (YAZ-4366): the helpers, and the values each user of them gave before they shared it. A
 * change here that moves any of these numbers changes a saved shade, a wash or a copied fill.
 */
import { describe, expect, it } from 'vitest'
import '../editor/createCrepe'
import { fromHsv, toHsv } from '../editor/highlightColourBox'
import { shadesOf } from '../editor/highlightPanel'
import { customWash } from '../editor/marks/highlight'
import { hexOfRgb, rgbOf, solidHex, toHex } from './colour'

describe('the helpers', () => {
  it('rgbOf and hexOfRgb go both ways; hexOfRgb rounds and keeps each channel in 0 to 255', () => {
    expect(rgbOf('#ff8800')).toEqual([255, 136, 0])
    expect(rgbOf('#123ABC')).toEqual([18, 58, 188])
    expect(hexOfRgb([255, 136, 0])).toBe('#ff8800')
    expect(hexOfRgb([17.5, 57.49, 188.2])).toBe('#1239bc')
    expect(hexOfRgb([-3, 300, 0])).toBe('#00ff00')
  })

  it('solidHex reads what a browser gives and drops the alpha; anything else is null', () => {
    expect(solidHex('rgb(0, 255, 0)')).toBe('#00ff00')
    expect(solidHex('rgba(255, 136, 0, 0.4)')).toBe('#ff8800')
    expect(solidHex('#FF8800')).toBe('#ff8800')
    expect(solidHex('#f80')).toBe('#ff8800')
    expect(solidHex('#ff880066')).toBe('#ff8800')
    expect(solidHex('red')).toBeNull()
    expect(solidHex('')).toBeNull()
    expect(toHex('rgba(255, 136, 0, 0.4)')).toBe('#ff880066')
  })
})

describe('the values from before the move (pinned)', () => {
  it('the Shades row', () => {
    expect(shadesOf('#ff9628')).toEqual(['#ffcb94', '#ffb05e', '#ff9628', '#cc7820', '#995a18'])
    expect(shadesOf('#123abc')).toEqual(['#899dde', '#4d6bcd', '#123abc', '#0e2e96', '#0b2371'])
    expect(shadesOf('#ffd500')).toEqual(['#ffea80', '#ffe040', '#ffd500', '#ccaa00', '#998000'])
  })

  it('a custom colour\'s wash', () => {
    expect(customWash('#ff8800')).toBe('rgba(255, 136, 0, 0.4)')
  })

  it('the colour box\'s HSV', () => {
    expect(toHsv('#123abc')).toEqual({ h: 225.88235294117646, s: 0.9042553191489362, v: 0.7372549019607844 })
    expect(toHsv('#ff9628')).toEqual({ h: 30.697674418604652, s: 0.8431372549019608, v: 1 })
    expect([
      fromHsv({ h: 200, s: 0.4, v: 0.6 }),
      fromHsv({ h: 0, s: 0, v: 1 }),
      fromHsv({ h: 359.9, s: 1, v: 1 }),
      fromHsv({ h: 77.7, s: 0.33, v: 0.21 }),
    ]).toEqual(['#5c8599', '#ffffff', '#ff0000', '#303624'])
  })
})
