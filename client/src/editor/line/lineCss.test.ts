/**
 * The CSS contract of the dotted and dashed tiles (YAZ-3198 D7). jsdom lays nothing out, so this holds
 * `line.css` to what S73 and S74 say in words; the end-to-end spec measures the real dashed tiles
 * (`desktop/e2e/lineStyle.spec.ts` step 4), and the guided test the look (S75, S76).
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
  it('S73, S74: dashed tiles are 5 × the thickness, a 3× dash; dotted tiles 2 × the thickness, a round dot', () => {
    const dashed = bodyOf(`${HR}[data-line-pattern='dashed'] > hr`)
    expect(dashed).toMatch(/linear-gradient\(to right, var\(--line-color\) 60%, transparent 60%\)/)
    expect(dashed).toMatch(/background-size:\s*calc\(5 \* var\(--line-thickness, 3px\)\) 100%;/)
    const dotted = bodyOf(`${HR}[data-line-pattern='dotted'] > hr`)
    expect(dotted).toMatch(/radial-gradient\(circle closest-side, var\(--line-color\)/)
    expect(dotted).toMatch(/background-size:\s*calc\(2 \* var\(--line-thickness, 3px\)\) 100%;/)
  })

})
