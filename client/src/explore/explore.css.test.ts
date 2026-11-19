/**
 * The Arrange popover's CSS, read as text (jsdom lays nothing out). YAZ-4949: the five layout buttons stay inside the
 * popover at every width. A `1fr` track does not go below its content, so "Side by side" and "Grid + centre" pushed
 * Stack 21 px past the border; each track may now shrink to zero, its picture shrinks with it, and its name wraps.
 */
import { readdirSync, readFileSync } from 'node:fs'
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
    const controls = rule('.page-header__controls')
    expect(controls['flex']).toBe('none')
    expect(controls['margin-left']).toBe('auto')
    // At the row's top (`start`: the writing mode's top, also in the reversed wrap of YAZ-5981).
    expect(controls['align-self']).toBe('start')
    // Properties follows the controls with no gap of its own (its `margin-left: auto` would split the room).
    expect(rule('.page-header:has(> .page-header__controls) .frontmatter-panel__header')['margin-left']).toBe('0')
  })

  /**
   * YAZ-5981: in a window 330–380 px wide (Tile › Three in an 1100 px window: 351 px) the title, the controls and
   * Properties wrapped one by one, so Properties alone fell to the left of a second line and the title kept 100–130 px.
   * The row now fills from the RIGHT (`row-reverse`): Properties first, then the controls, then the title; a line that
   * has no room for the next one starts a new line ABOVE it (`wrap-reverse`). So the controls and Properties stay one
   * group at the right, and the title, when it does not keep its least width beside them, takes a line of its own on
   * top. The open Properties body comes first, on the bottom line. The DOM order (title, controls, Properties, body) is
   * the order you read and Tab, as before.
   */
  const header = rule('.page-header:has(> .page-header__controls)')
  const title = rule('.page-header:has(> .page-header__controls) > .page-title')
  const props = rule('.page-header:has(> .page-header__controls) .frontmatter-panel__header')
  const body = rule('.page-header:has(> .page-header__controls) .frontmatter-panel__body')
  const order = (r: Record<string, string>) => Number(r['order'] ?? '0')
  /** The title's least width in px: `min(140px, 100%)` is 140 px in any row wider than that (every Explore layer). */
  const least = () => Number(/^min\((\d+(?:\.\d+)?)px, 100%\)$/.exec(title['min-width'] ?? '')?.[1] ?? 'NaN')

  it('YAZ-5981: the row fills from the right and wraps upward; the order is body, Properties, controls, title', () => {
    expect(header['flex-direction']).toBe('row-reverse')
    expect(header['flex-wrap']).toBe('wrap-reverse')
    // Each part at its line's top, as the title's first line (the old `baseline` / `flex-start` mean the bottom here).
    expect(header['align-items']).toBe('start')
    expect(props['align-self']).toBe('start')
    expect(order(body)).toBeLessThan(order(props))
    expect(order(props)).toBeLessThan(order(rule('.page-header:has(> .page-header__controls) > .page-header__controls')))
    expect(order(rule('.page-header:has(> .page-header__controls) > .page-header__controls'))).toBeLessThan(order(title))
  })

  /**
   * The row's lines, as flexbox breaks them (each item at its hypothetical width, the least width for the title; the
   * gap between items), in the CSS's `order` and fill direction. Widths measured in the app at page zoom 100%, a
   * ≤ 420 px layer (the zoom pill is its % alone): controls 110 px, Properties 48 px; the row is the layer less 96 px.
   */
  function lines(layer: number): string[][] {
    const px = (v: string | undefined) => Number.parseFloat(v ?? '0')
    const items = [
      { name: 'properties', width: 48, order: order(props) },
      { name: 'controls', width: 110, order: order(rule('.page-header:has(> .page-header__controls) > .page-header__controls')) },
      { name: 'title', width: least(), order: order(title) },
    ].sort((a, b) => a.order - b.order)
    const room = layer - 2 - 96
    const out: string[][] = []
    let used = Infinity
    for (const item of items) {
      if (used + px(header['column-gap']) + item.width > room) {
        out.push([])
        used = -px(header['column-gap'])
      }
      out.at(-1)!.push(item.name)
      used += px(header['column-gap']) + item.width
    }
    // `row-reverse`: each line reads right to left; `wrap-reverse`: the first line is the bottom one.
    return out.map((line) => line.reverse()).reverse()
  }

  it('YAZ-5981: at 340, 351 and 380 px the title has its own line on top; the controls and Properties stay together under it, Properties at the right', () => {
    for (const width of [340, 351, 380]) expect(lines(width), `${width} px`).toEqual([['title'], ['controls', 'properties']])
    // 300 px as before; at 420 px the title keeps its least width beside the two, on one line.
    expect(lines(300)).toEqual([['title'], ['controls', 'properties']])
    expect(lines(420)).toEqual([['title', 'controls', 'properties']])
  })

  it('YAZ-5981: the title\'s least width beside the controls is a readable one (more than the 96 px that squeezed it to 3 lines)', () => {
    // `min(…, 100%)`: in a row narrower than the least width the title takes the row, and never passes it.
    expect(title['min-width']).toMatch(/^min\(\d+px, 100%\)$/)
    expect(least()).toBeGreaterThanOrEqual(136)
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

describe('YAZ-5977: Search size zooms the search window alone', () => {
  /** Every rule in the client's CSS that reads `--explore-size`, as `[file, selector, declarations]`. */
  const uses = readdirSync(path.join(__dirname, '..'), { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.css'))
    .flatMap((file) => {
      const text = readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
      return [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[2]!.includes('--explore-size')).map((m) => [file, m[1]!.trim(), m[2]!.trim()])
    })

  it('one rule in the client reads it: the zoom in explore.css', () => {
    expect(uses).toEqual([[path.join('explore', 'explore.css'), '.explore__layer--search > :not(.explore__grip, .explore__head)', 'zoom: var(--explore-size, 1);']])
  })

  /** A layer as `ExploreStack` draws it: its kind's class, then its parts (a file window's head is its top bar), then its 8 grips. */
  function layer(kind: 'search' | 'page' | 'board' | 'card'): HTMLElement {
    const el = document.createElement('div')
    el.className = `explore__layer explore__layer--${kind} explore__layer--in`
    const parts = kind === 'search' ? ['explore__grab', 'explore-search'] : ['explore__head', 'explore__body']
    for (const name of [...parts, ...Array.from({ length: 8 }, () => 'explore__grip')]) el.appendChild(document.createElement('div')).className = name
    return el
  }

  it('it zooms the search\'s parts, never its grips; in a page, board or card window it zooms nothing: not the top bar, not the body', () => {
    const selector = uses[0]![1]
    const zoomed = (kind: Parameters<typeof layer>[0]) => [...layer(kind).children].filter((child) => child.matches(selector)).map((child) => child.className)
    expect(zoomed('search')).toEqual(['explore__grab', 'explore-search'])
    for (const kind of ['page', 'board', 'card'] as const) expect(zoomed(kind)).toEqual([])
  })
})
