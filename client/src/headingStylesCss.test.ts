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
  it('each h1-h6 rule reads its three variables, with the look of 1.0.14 as each fallback, and stays full width', () => {
    for (const { n, em, weight } of LEVELS) {
      const rule = ruleBody(appCss, `.editor-instance .milkdown .ProseMirror h${n}`)
      expect(rule, `h${n}`).toBeDefined()
      expect(rule).toMatch(new RegExp(`font-size:\\s*var\\(--h${n}-size,\\s*${em.replace('.', '\\.')}\\);`))
      expect(rule).toMatch(new RegExp(`font-weight:\\s*var\\(--h${n}-weight,\\s*${weight}\\);`))
      expect(rule).toMatch(new RegExp(`text-decoration:\\s*var\\(--h${n}-decoration,\\s*none\\);`))
      // The wash goes to the heading's text spans; the heading box keeps its full width, so a click right of the words lands in it (YAZ-3049).
      expect(rule).toMatch(new RegExp(`--heading-bg:\\s*var\\(--h${n}-bg,\\s*none\\);`))
      expect(rule).not.toMatch(/width|background|box-shadow/)
    }
    const shared = appCss.match(/\.editor-instance \.milkdown \.ProseMirror h6 \{([^}]*)\}/s)?.[1]
    expect(shared).not.toMatch(/width|border-radius/)
    expect(appCss).not.toMatch(/--h\d-width/)
  })

  it('the wash is on the heading text (headingText.ts), one per line, and its edge takes no room', () => {
    const span = ruleBody(appCss, '.milkdown .ProseMirror .heading-text')
    expect(span).toMatch(/background:\s*var\(--heading-bg,\s*none\);/)
    // Top and bottom: at most half the room between two lines (1.3 line height), so the washes of a wrapped heading never overlap.
    expect(span).toMatch(/padding-top:\s*0\.05em;/)
    expect(span).toMatch(/padding-bottom:\s*0\.05em;/)
    expect(span).toMatch(/-webkit-box-decoration-break:\s*clone;/)
    expect(span).toMatch(/(?<!-)box-decoration-break:\s*clone;/)
    // Only the first and the last span draw the side edges, and a negative margin takes each back.
    const first = ruleBody(appCss, '.milkdown .ProseMirror .heading-text--first:not(.heading-text--first ~ .heading-text--first)')
    expect(first).toMatch(/padding-left:\s*3px;/)
    expect(first).toMatch(/margin-left:\s*-3px;/)
    const last = ruleBody(appCss, '.milkdown .ProseMirror .heading-text--last:not(:has(~ .heading-text--last))')
    expect(last).toMatch(/padding-right:\s*3px;/)
    expect(last).toMatch(/margin-right:\s*-3px;/)
    // No ring: two spans side by side would lay their see-through edges one over the other.
    expect(appCss).not.toMatch(/box-shadow:\s*0 0 0 3px var\(--h\d-bg/)
  })

  it('the editor\'s base size is the vault\'s Text size, 16px when none is set; the headings with no size and the bullet rows follow it (YAZ-3067 D14, D17)', () => {
    // `--text-size` comes from the page layer (App.tsx); with no file there is none, and the base stays 16px as before.
    expect(appCss).toMatch(/\.editor-instance \.milkdown \{[^}]*--crepe-base-font-size:\s*var\(--text-size, 16px\);/s)
    expect(appCss).not.toMatch(/--crepe-base-font-size:\s*16px/)
    // A heading with no size of its own is in em of that base (the first test), and a bullet's label row reads the base too.
    expect(bulletsCss).toMatch(/--list-label-height:\s*calc\(var\(--crepe-base-font-size\) \* var\(--edit-line-height, 1\.5\)/)
  })

  it('every heading level has 3 × gap above and 1 × gap below, and the section lines cross both (YAZ-3794)', () => {
    for (const { n } of LEVELS) {
      expect(ruleBody(appCss, `.editor-instance .milkdown .ProseMirror h${n}`), `h${n}`).toMatch(
        /margin:\s*calc\(var\(--edit-block-gap, 4px\) \* 3\) 0 var\(--edit-block-gap, 4px\);/,
      )
    }
    // Inside a bullet a heading is an outline row: no margin at all.
    expect(appCss).toMatch(/\.ProseMirror li h6 \{\s*margin:\s*0;/)
    expect(ruleBody(sectionIndentCss, '.editor-instance .milkdown > .ProseMirror > :is(h2, h3, h4, h5, h6)[data-sd]')).toMatch(
      /border-image-outset:\s*calc\(var\(--edit-block-gap, 4px\) \* 3\) 0 var\(--edit-block-gap, 4px\);/,
    )
  })

  it('a heading in a section needs no rule of its own: the wash starts at the words', () => {
    expect(sectionIndentCss).not.toMatch(/:is\(h1, h2, h3, h4, h5, h6\)\[data-sd\]/)
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
