/**
 * The Inbox zoom's CSS, read as text (jsdom lays nothing out). YAZ-5372 Decision (Yaseen: "Yes, do it"): the Inbox zoom
 * scales the whole card as page zoom scales a page — the SAME rule (app.css, `--document-zoom` and CSS `zoom`), on the
 * card's frame: its text, title band, sides, pictures and spacing; and the card's width grows with it, capped by the
 * window. The Inbox bar, the row above the card and the buttons stay their size.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => readFileSync(path.join(__dirname, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const cards = read('cardScreens.css')
const app = read('../app.css')

/** Every rule of `css`: its selectors and its declarations. */
const rules = (css: string) =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: m[1]!.split(',').map((s) => s.trim()),
    decls: Object.fromEntries(
      m[2]!
        .split(';')
        .map((d) => d.trim())
        .filter(Boolean)
        .map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()]),
    ),
  }))

describe('the Inbox zoom on the whole card (YAZ-5372)', () => {
  it("the card's frame is zoomed by page zoom's own rule in app.css, and there is no second zoom", () => {
    const pageRule = rules(app).find((r) => r.selectors.includes('.editor-instance .milkdown > .ProseMirror') && r.decls['zoom'] !== undefined)!
    expect(pageRule.decls['zoom']).toBe('var(--document-zoom, 1)')
    expect(pageRule.selectors).toContain('.card-inbox__panel')
    expect(cards).not.toContain('--inbox-zoom')
    expect(rules(cards).filter((r) => r.decls['zoom'] !== undefined)).toEqual([])
  })

  it("the card's width grows with the zoom, capped by the window", () => {
    const column = rules(cards).find((r) => r.selectors.includes('.card-inbox__column') && r.decls['width'] !== undefined)!
    expect(column.decls['width']).toBe('min(calc((var(--card-text-width) + 2 * var(--inbox-card-pad, 28px)) * var(--document-zoom, 1)), 100%)')
  })
})

/** The declarations of the rule whose selector list is exactly `selector` (the last such rule wins, as in CSS). */
const decls = (css: string, selector: string) =>
  rules(css)
    .filter((r) => r.selectors.length === 1 && r.selectors[0] === selector)
    .reduce<Record<string, string>>((all, r) => ({ ...all, ...r.decls }), {})

describe('the block under the card stays at the bottom of the screen (YAZ-5431, as Mochi)', () => {
  it('the column fills the Inbox\'s height and the dock (buttons, last line, keys) sits at its bottom: a short card leaves the room above it', () => {
    expect(decls(cards, '.card-inbox__column')['flex']).toBe('1 0 auto')
    expect(decls(cards, '.card-inbox__dock')['margin-top']).toBe('auto')
  })

  it('a long card: the same dock is sticky at the very same bottom edge, so it never moves between a short and a long card', () => {
    const dock = decls(cards, '.card-inbox__dock')
    expect(dock['position']).toBe('sticky')
    // The view has no bottom padding: the short card's dock (end of the filled column) and the long card's (stuck) share the view's bottom edge.
    expect(dock['bottom']).toBe('0')
    expect(decls(cards, '.card-inbox')['padding']).toBe('0 16px')
  })
})

describe('the last answer\'s line is quiet for every answer (YAZ-5433)', () => {
  it('a Forgot line is the same grey as a Remembered one: only its small ✕ mark is red, as the ✓ is green; its Undo too stays grey', () => {
    const all = rules(cards)
    // Nothing colours the line itself (its text, its Undo) by the answer.
    const byRating = all.filter((r) => r.selectors.some((s) => /^\.card-inbox__last\[data-rating='[a-z]+'\]$/.test(s)) && r.decls['color'] !== undefined)
    expect(byRating).toEqual([])
    expect(all.some((r) => r.selectors.some((s) => /\.card-inbox__last\[data-rating='again'\] \.card-inbox__last-(text|undo)/.test(s)))).toBe(false)
    // The mark keeps its colour: red for Forgot / Again.
    const mark = all.find((r) => r.selectors.includes(".card-inbox__last[data-rating='again'] .card-inbox__last-mark"))
    expect(mark?.decls['color']).toBe('var(--danger)')
  })
})

/**
 * YAZ-5689 (Yaseen: "should we make it behind one icon click?"): YAZ-5686's hover fade is gone with the controls it
 * hid; the row's right end is the count and ONE quiet icon, "View", which wears a small accent dot while the zoom is
 * not 100%. And YAZ-5687 gap 4: a top-level page's crumb was cut to "T…" with room to spare (a 60% cap of a shrink-to-fit
 * row); the crumb takes the room it has, the folders give way first, then the page's name.
 */
describe('the top row`s View icon and the breadcrumb (YAZ-5689)', () => {
  const all = rules(cards)
  it('no rule left for the old tools or their fade', () => {
    expect(all.filter((r) => r.selectors.some((s) => s.includes('.card-inbox__tools')))).toEqual([])
  })

  it('the View icon: a quiet button; away from 100% a small accent dot', () => {
    expect(decls(cards, '.card-inbox__view')).toMatchObject({ background: 'none', color: 'var(--fg-muted)' })
    const dot = decls(cards, '.card-inbox__view[data-zoomed]::after')
    expect(dot).toMatchObject({ background: 'var(--accent)', 'border-radius': '50%' })
  })

  it('the crumb: no percentage cap on the page part; YAZ-5713: the folders never shrink (they fold from the start, `usePlaceFold`), the page`s name does', () => {
    const page = decls(cards, ".card-inbox__path-part[data-kind='page']")
    expect(page['max-width']).toBeUndefined()
    expect(decls(cards, '.card-inbox__path-item')['flex']).toBe('none')
    expect(decls(cards, ".card-inbox__path-item[data-kind='page']")['flex']).toBe('0 1 auto')
    // The box is as wide as its room, not its content: the fold reads that width.
    expect(decls(cards, '.card-inbox__path-box')['flex']).toBe('1 1 0')
    expect(decls(cards, '.card-inbox__path')['flex']).toBe('1 1 0')
  })
})

describe('the answer buttons are neutral (YAZ-5716, Yaseen: no colour on remembered or forgotten)', () => {
  it('no red, amber or green on ✕ ~ ✓ ⇈ at rest: the glyph is the button\'s own text colour; the hover and the end ring stay', () => {
    const answerRules = rules(cards).filter((r) => r.selectors.some((s) => /\.card-inbox__answer\b|\.card-inbox__answer-icon/.test(s)))
    expect(answerRules.length).toBeGreaterThan(0)
    for (const r of answerRules) expect(r.decls.color ?? '').not.toMatch(/--danger|--warn|--ok/)
    expect(answerRules.some((r) => r.selectors.some((s) => /data-rating/.test(s)))).toBe(false)
    expect(cards).toMatch(/\.card-inbox__answers \.card-inbox__answer:hover \{[^}]*background:/)
  })
})
