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
