/**
 * The window's CSS against Crepe's reset, read as text (jsdom computes no imported sheet): the rules that must win do
 * win by specificity, with no `!important`. YAZ-4860: the picture was squashed by `.milkdown .ProseMirror img`.
 * YAZ-4863: a window with no picture shows no rest page and no zoom chip.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { beats, rules, specificity } from '../cssRules'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const windowCss = read('./boardWindow.css')
const reset = read('../../../../node_modules/@milkdown/crepe/lib/theme/common/reset.css')
const appCss = read('../../app.css')

describe('the board window`s CSS', () => {
  it('YAZ-4860: the picture`s `max-width: none` beats Crepe`s `.milkdown .ProseMirror img { max-width: 100% }`, with no !important', () => {
    const crepe = rules(reset, '.milkdown .ProseMirror img').find((r) => /max-width:\s*100%/.test(r.body))!
    const ours = rules(windowCss, '.board-window__img').find((r) => /max-width:\s*none/.test(r.body))!
    expect(specificity(crepe.selector)).toEqual([0, 2, 1])
    expect(beats(specificity(ours.selector), specificity(crepe.selector))).toBe(true)
    expect(ours.body).not.toContain('!important')
  })

  it('YAZ-4863: no rest page and no zoom chip on a window with no picture; that rule beats the hover rules that show them', () => {
    const hide = rules(windowCss, '.board-window--missing').find((r) => r.selector.includes('.board-window__rest') && /display:\s*none/.test(r.body))!
    for (const state of ['loading', 'missing', 'broken', 'empty']) expect(hide.selector).toContain(`.board-window--${state}`)
    expect(hide.selector).toContain('.board-window__zoom')
    const showRest = rules(windowCss, '.board-window--resting').find((r) => r.selector.includes('.board-window__rest') && /display:\s*block/.test(r.body))!
    const showChrome = rules(windowCss, '.board-window:hover').find((r) => r.selector.includes('.board-window__zoom'))!
    for (const show of [showRest, showChrome]) {
      const s = specificity(show.selector)
      const h = specificity(hide.selector)
      // Equal is enough: the hide rule comes later in the file.
      expect(beats(s, h)).toBe(false)
      expect(windowCss.indexOf(hide.selector)).toBeGreaterThan(windowCss.indexOf(show.selector))
    }
  })

  it('YAZ-4905: the file icon`s `::before` keeps its 14px in the 14px icon box: its 6px sidebar margin may not shrink it', () => {
    // The sidebar's icon rules (`app.css`): 14px wide with a 6px right margin, on the Material set and the Line set.
    const sidebar = rules(appCss, '.file-icon--file').filter((r) => r.selector.endsWith('::before') && /margin-right:\s*6px/.test(r.body) && /width:\s*14px/.test(r.body))
    expect(sidebar.length).toBeGreaterThanOrEqual(2)
    // None of them sets `flex`, so the window's rule wins at any weight.
    for (const r of sidebar) expect(r.body).not.toMatch(/\bflex/)
    const ours = rules(windowCss, '.board-window__icon::before').find((r) => /flex:\s*none/.test(r.body))!
    expect(ours).toBeDefined()
    expect(ours.body).not.toContain('!important')
    const box = rules(windowCss, '.board-window__icon').find((r) => r.selector.endsWith('.board-window__icon'))!
    expect(box.body).toMatch(/width:\s*14px/)
  })

  it('YAZ-6354 / YAZ-6350: drawings and diagrams align via --drawing-align-start/end, guard bullet nesting, and honor data-align overrides', () => {
    const framed = rules(windowCss, '.board-embed.inline-drawing').find((r) => /margin-inline:\s*var\(--drawing-align-start,\s*0\)\s*var\(--drawing-align-end,\s*auto\)/.test(r.body))
    expect(framed).toBeDefined()
    expect(framed!.body).not.toContain('!important')

    const unframed = rules(windowCss, '.board-embed > .board-window').find((r) => /margin-inline:\s*var\(--drawing-align-start,\s*0\)\s*var\(--drawing-align-end,\s*auto\)/.test(r.body))
    expect(unframed).toBeDefined()

    const bulletGuard = rules(windowCss, 'li .board-embed:not([data-align])').find((r) => /margin-inline:\s*0 auto/.test(r.body))
    expect(bulletGuard).toBeDefined()
    expect(beats(specificity(bulletGuard!.selector), specificity(framed!.selector))).toBe(true)

    for (const [align, expected] of [
      ['left', /margin-inline:\s*0 auto/],
      ['center', /margin-inline:\s*auto/],
      ['right', /margin-inline:\s*auto 0/],
    ] as const) {
      const override = rules(windowCss, `[data-align='${align}']`).find((r) => expected.test(r.body))
      expect(override).toBeDefined()
      expect(override!.body).not.toContain('!important')
      expect(windowCss.indexOf(override!.selector)).toBeGreaterThan(windowCss.indexOf(framed!.selector))
    }
  })
})
