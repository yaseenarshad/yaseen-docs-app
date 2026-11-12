/**
 * The Arrange popover's CSS, read as text (jsdom lays nothing out). YAZ-4949: the five layout buttons stay inside the
 * popover at every width. A `1fr` track does not go below its content, so "Side by side" and "Grid + centre" pushed
 * Stack 21 px past the border; each track may now shrink to zero, its picture shrinks with it, and its name wraps.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(path.join(__dirname, 'explore.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** The declarations of the rule whose selector is exactly `selector`. */
function rule(selector: string): Record<string, string> {
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1]!.trim() !== selector) continue
    return Object.fromEntries(
      m[2]!
        .split(';')
        .map((d) => d.trim())
        .filter(Boolean)
        .map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()]),
    )
  }
  return {}
}

describe('the Arrange popover (YAZ-4949)', () => {
  it('the five layout tracks may shrink below their content, so the row never grows past the popover', () => {
    expect(rule('.explore__layouts')['grid-template-columns']).toBe('repeat(5, minmax(0, 1fr))')
  })

  it('a layout button, its picture and its name shrink with the track: the name wraps, the picture scales', () => {
    expect(rule('.explore__layout')['min-width']).toBe('0')
    expect(rule('.explore__layout svg')['max-width']).toBe('100%')
    expect(rule('.explore__layout svg')['height']).toBe('auto')
    const name = rule('.explore__layout-name')
    expect(name['white-space']).not.toBe('nowrap')
    expect(name['overflow-wrap']).toBe('anywhere')
    expect(name['text-align']).toBe('center')
  })

  it('the popover has room for the five names on one line at the default width, and never passes the window', () => {
    const box = rule('.explore__arrange')
    expect(Number.parseInt(box['width']!, 10)).toBeGreaterThanOrEqual(380)
    expect(box['max-width']).toBe('calc(100% - 32px)')
  })
})
