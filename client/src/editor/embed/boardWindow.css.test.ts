/**
 * The window's CSS against Crepe's reset, read as text (jsdom computes no imported sheet): the rules that must win do
 * win by specificity, with no `!important`. YAZ-4860: the picture was squashed by `.milkdown .ProseMirror img`.
 * YAZ-4863: a window with no picture shows no rest note and no zoom chip.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const windowCss = read('./boardWindow.css')
const reset = read('../../../../node_modules/@milkdown/crepe/lib/theme/common/reset.css')

/** Every rule of `css` whose selector holds `part`, with its body (comments out). */
function rules(css: string, part: string): Array<{ selector: string; body: string }> {
  const out: Array<{ selector: string; body: string }> = []
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1]!.trim()
    if (selector.includes(part)) out.push({ selector, body: m[2]! })
  }
  return out
}

/** The specificity of one simple selector of this file's kind: classes, pseudo-classes, elements; `:is()` its most specific argument. */
function specificity(selector: string): [number, number, number] {
  let rest = selector
  const total: [number, number, number] = [0, 0, 0]
  const add = (s: [number, number, number]) => s.forEach((v, i) => (total[i] += v))
  // `:is(a, b)` and `:not(a)`: the most specific argument (no nesting in this file).
  rest = rest.replace(/:(?:is|not)\(([^()]*)\)/g, (_m, args: string) => {
    const best = args.split(',').map((a) => specificity(a.trim())).sort((x, y) => y[0] - x[0] || y[1] - x[1] || y[2] - x[2])[0]!
    add(best)
    return ' '
  })
  total[0] += (rest.match(/#[\w-]+/g) ?? []).length
  total[1] += (rest.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) ?? []).length
  total[2] += (rest.replace(/\.[\w-]+|\[[^\]]*\]|:[\w-]+|#[\w-]+/g, ' ').match(/(^|[\s>+~])[a-z][\w-]*/gi) ?? []).length
  return total
}

const beats = (a: [number, number, number], b: [number, number, number]) => a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] > b[2])))

describe('the board window`s CSS', () => {
  it('YAZ-4860: the picture`s `max-width: none` beats Crepe`s `.milkdown .ProseMirror img { max-width: 100% }`, with no !important', () => {
    const crepe = rules(reset, '.milkdown .ProseMirror img').find((r) => /max-width:\s*100%/.test(r.body))!
    const ours = rules(windowCss, '.board-window__img').find((r) => /max-width:\s*none/.test(r.body))!
    expect(specificity(crepe.selector)).toEqual([0, 2, 1])
    expect(beats(specificity(ours.selector), specificity(crepe.selector))).toBe(true)
    expect(ours.body).not.toContain('!important')
  })

  it('YAZ-4863: no rest note and no zoom chip on a window with no picture; that rule beats the hover rules that show them', () => {
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
})
