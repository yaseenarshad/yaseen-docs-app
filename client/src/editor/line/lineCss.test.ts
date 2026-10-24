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
    expect(dashed).toMatch(/background-size:\s*calc\(5 \* var\(--line-thick\)\) 100%;/)
    const dotted = bodyOf(`${HR}[data-line-pattern='dotted'] > hr`)
    expect(dotted).toMatch(/radial-gradient\(circle closest-side, var\(--line-color\)/)
    expect(dotted).toMatch(/background-size:\s*calc\(2 \* var\(--line-thick\)\) 100%;/)
  })


  it('YAZ-3208 D8: a line with no value of its own falls back to the vault’s default line, then to the app’s 50% and 3px', () => {
    const line = bodyOf(`${HR} > hr`)
    expect(line).toMatch(/--line-thick:\s*var\(--line-thickness, var\(--line-default-thickness, 3px\)\);/)
    expect(line).toMatch(/var\(--line-darkness, var\(--line-default-darkness, 50%\)\)/)
  })

  it('YAZ-3208 D8: the default pattern applies only to a line with no pattern of its own, through a style query', () => {
    for (const pattern of ['dashed', 'dotted']) {
      const query = new RegExp(`@container style\\(--line-default-pattern: ${pattern}\\)\\s*\\{\\s*\\.milkdown \\.ProseMirror \\.line-view:not\\(\\[data-line-pattern\\]\\) > hr\\s*\\{`)
      expect(css).toMatch(query)
    }
  })
})
