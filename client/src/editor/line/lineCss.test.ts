/**
 * The CSS contract of the line's look (YAZ-3164 D4 / D6 / D7). jsdom lays nothing out, so this holds
 * `line.css` to what the cases say in words; the look itself is a guided-test check (S73–S76) and the
 * height is measured end to end (`desktop/e2e/lineStyle.spec.ts`).
 */
import { describe, expect, it } from 'vitest'
import lineCss from './line.css?inline'

const css = lineCss.replace(/\/\*[\s\S]*?\*\//g, '')
const bodyOf = (selector: string): string => {
  const rule = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(([, sel]) => sel.split(',').map((s) => s.trim()).includes(selector))
  if (rule === undefined) throw new Error(`no rule for ${selector}`)
  return rule[2]
}
const HR = '.milkdown .ProseMirror .line-view'

describe('line CSS contract', () => {
  it('S75: one colour, a share of the text colour, for every pattern; the defaults are 50% and 3px', () => {
    const line = bodyOf(`${HR} > hr`)
    expect(line).toMatch(/--line-color:\s*color-mix\(in srgb, var\(--crepe-color-on-background\) var\(--line-darkness, 50%\), transparent\);/)
    expect(line).toMatch(/height:\s*calc\(12px \+ var\(--line-thickness, 3px\)\);/)
    expect(line).toMatch(/background-color:\s*var\(--line-color\);/)
  })

  it('S76: a pattern repeats on the content box only, inside the line’s own width', () => {
    const pattern = bodyOf(`${HR}[data-line-pattern] > hr`)
    expect(pattern).toMatch(/background-color:\s*transparent;/)
    expect(pattern).toMatch(/background-origin:\s*content-box;/)
    expect(pattern).toMatch(/background-repeat:\s*repeat-x;/)
  })

  it('S73: dashed is a 3× thickness dash and a 2× thickness gap', () => {
    const dashed = bodyOf(`${HR}[data-line-pattern='dashed'] > hr`)
    expect(dashed).toMatch(/linear-gradient\(to right, var\(--line-color\) 60%, transparent 60%\)/)
    expect(dashed).toMatch(/background-size:\s*calc\(5 \* var\(--line-thickness, 3px\)\) 100%;/)
  })

  it('S74: dotted is a round dot as wide as the thickness, and a gap as wide', () => {
    const dotted = bodyOf(`${HR}[data-line-pattern='dotted'] > hr`)
    expect(dotted).toMatch(/radial-gradient\(circle closest-side, var\(--line-color\)/)
    expect(dotted).toMatch(/background-size:\s*calc\(2 \* var\(--line-thickness, 3px\)\) 100%;/)
  })
})
