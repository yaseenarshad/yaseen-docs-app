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

  it('YAZ-4949 round 2: each name has room for one line in the 384 px popover ("Grid + centre" is 69.0 px at 11 px in the app)', () => {
    const px = (v: string | undefined) => Number.parseFloat(v ?? 'NaN')
    const box = rule('.explore__arrange')
    const button = rule('.explore__layout')
    const [, padX = '0'] = button['padding']!.split(/\s+/)
    // The popover's width, less its padding and border (border-box), shared by five tracks and four gaps.
    const track = (px(box['width']) - 2 * px(box['padding']) - 2 - 4 * px(rule('.explore__layouts')['gap'])) / 5
    // A button's room for its name: the track, less its side padding and its 1 px border.
    const room = track - 2 * px(padX) - 2
    const widest = (69.0 * px(button['font-size'])) / 11
    expect(room).toBeGreaterThanOrEqual(widest + 1)
  })

  it('the popover has room for the five names on one line at the default width, and never passes the window', () => {
    const box = rule('.explore__arrange')
    expect(Number.parseInt(box['width']!, 10)).toBeGreaterThanOrEqual(380)
    expect(box['max-width']).toBe('calc(100% - 32px)')
  })
})

describe('the folded head of a narrow layer (YAZ-4956)', () => {
  it('a full head is laid out as before: the fold box adds no box of its own, and ⋯ is hidden', () => {
    expect(rule('.explore__fold')['display']).toBe('contents')
    expect(rule('.explore__more')['display']).toBe('none')
  })

  it('folded (YAZ-4986): ⋯ shows; a folded part hides, one by one; the ID never folds; the title keeps a least width', () => {
    expect(rule('.explore__head[data-compact] .explore__more')['display']).toBe('block')
    expect(rule('.explore__head [data-folded]')['display']).toBe('none')
    expect(css).not.toMatch(/\[data-compact\][^{]*\.explore__id[^{]*\{[^}]*display:\s*none/)
    expect(rule('.explore__head > .explore__id,\n.explore__head > .card__id')['flex']).toBe('none')
    expect(rule('.explore__head[data-compact] .explore__title')['min-width']).toBe('48px')
  })

  it('folded: the Read only chip shows again while its "Allow edits?" box is open or it has the keyboard', () => {
    expect(rule('.explore__head .explore__lock[data-folded]:is(:focus-within, :has(.read-only-chip__ask))')['display']).toBe('revert')
  })

  it('YAZ-4964 round 2, item 1: a ⋯ that holds rows of its own (the card window\'s) shows at every width', () => {
    expect(rule('.explore__head .explore__more--always')['display']).toBe('block')
  })
})

describe('YAZ-5974: the page controls on the title row', () => {
  it('the title takes the room left and wraps there; the controls never shrink and stand at the row\'s right, before Properties', () => {
    const title = rule('.page-header:has(> .page-header__controls) > .page-title')
    expect(title['flex']).toBe('1 1 0')
    expect(title['min-width']).toBe('96px')
    const controls = rule('.page-header__controls')
    expect(controls['flex']).toBe('none')
    expect(controls['margin-left']).toBe('auto')
    expect(controls['align-self']).toBe('flex-start')
    // Properties follows the controls with no gap of its own (its `margin-left: auto` would split the room).
    expect(rule('.page-header:has(> .page-header__controls) .frontmatter-panel__header')['margin-left']).toBe('0')
  })

  it('a very narrow layer: the zoom pill shrinks to its % (its − and + go); nothing folds into ⋯', () => {
    expect(css).toMatch(/@container \(max-width: 420px\)\s*\{\s*\.page-header__controls \.document-zoom__step\s*\{\s*display: none;/)
    expect(rule('.page-header:has(> .page-header__controls)')['container-type']).toBe('inline-size')
  })

  it('a card file: the controls on the card\'s top line, right of the folder path', () => {
    expect(rule('.card-file__top')['display']).toBe('flex')
    expect(rule('.card-file__top > .card-file__path')['flex']).toBe('1 1 0')
  })
})
