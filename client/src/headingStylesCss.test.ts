import { describe, expect, it } from 'vitest'
import appCss from './app.css?inline'
import bulletsCss from './editor/outline/bullets.css?inline'
import sectionIndentCss from './editor/outline/sectionIndent.css?inline'

/** The em scale and the weight of 1.0.14: every variable falls back to them, so `{}` is pixel-identical. */
const LEVELS = [
  { n: 1, em: '1.802em', scale: '1.802', weight: '700' },
  { n: 2, em: '1.602em', scale: '1.602', weight: '600' },
  { n: 3, em: '1.424em', scale: '1.424', weight: '600' },
  { n: 4, em: '1.266em', scale: '1.266', weight: '600' },
  { n: 5, em: '1.125em', scale: '1.125', weight: '600' },
  { n: 6, em: '1em', scale: '1', weight: '600' },
] as const

/** The body of the rule whose WHOLE selector is `selector` (not the last line of a selector list). */
const ruleBody = (css: string, selector: string): string | undefined => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return css.match(new RegExp(`(?:^|(?<!,)\\n)${escaped}\\s*\\{([^}]*)\\}`, 's'))?.[1]
}

describe('heading styles CSS contract (YAZ-3049 D2, D7)', () => {
  it('each h1-h6 rule reads its five variables, with the look of 1.0.14 as each fallback', () => {
    for (const { n, em, weight } of LEVELS) {
      const rule = ruleBody(appCss, `.editor-instance .milkdown .ProseMirror h${n}`)
      expect(rule, `h${n}`).toBeDefined()
      expect(rule).toMatch(new RegExp(`font-size:\\s*var\\(--h${n}-size,\\s*${em.replace('.', '\\.')}\\);`))
      expect(rule).toMatch(new RegExp(`font-weight:\\s*var\\(--h${n}-weight,\\s*${weight}\\);`))
      expect(rule).toMatch(new RegExp(`text-decoration:\\s*var\\(--h${n}-decoration,\\s*none\\);`))
      // The wash is clipped to the padding box: Section indent's indent is a border.
      expect(rule).toMatch(new RegExp(`background:\\s*var\\(--h${n}-bg,\\s*none\\) padding-box;`))
      expect(rule).toMatch(new RegExp(`width:\\s*var\\(--h${n}-width,\\s*auto\\);`))
      expect(rule).toMatch(new RegExp(`box-shadow:\\s*0 0 0 3px var\\(--h${n}-bg,\\s*transparent\\);`))
    }
    const shared = appCss.match(/\.editor-instance \.milkdown \.ProseMirror h6 \{([^}]*)\}/s)?.[1]
    expect(shared).toMatch(/max-width:\s*100%;/)
    expect(shared).toMatch(/border-radius:\s*4px;/)
  })

  it('a heading in a section has no 3px shadow: it would start one indent left of the words', () => {
    expect(ruleBody(sectionIndentCss, '.editor-instance .milkdown > .ProseMirror > :is(h1, h2, h3, h4, h5, h6)[data-sd]')).toMatch(/box-shadow:\s*none;/)
  })

  it('the page title keeps its own look (D9): no heading variable in its rule', () => {
    const title = ruleBody(appCss, '.page-title__text')
    expect(title).toMatch(/font-size:\s*1\.802em;/)
    expect(title).not.toMatch(/--h\d-/)
  })

  it('each heading-first bullet row sizes its label from the same --hN-size, with the same em scale as fallback', () => {
    for (const { n, scale } of LEVELS) {
      const rule = ruleBody(bulletsCss, `.editor-instance .milkdown .milkdown-list-item-block > li.list-item:has(> .children > .content-dom > h${n}:is(:first-child, .outline-toggle + *))`)
      expect(rule, `h${n}`).toMatch(
        new RegExp(`--list-label-height:\\s*calc\\(var\\(--h${n}-size,\\s*calc\\(var\\(--crepe-base-font-size\\) \\* ${scale.replace('.', '\\.')}\\)\\) \\* 1\\.3 \\+ 2 \\* var\\(--edit-block-gap, 4px\\)\\);`),
      )
    }
  })
})
