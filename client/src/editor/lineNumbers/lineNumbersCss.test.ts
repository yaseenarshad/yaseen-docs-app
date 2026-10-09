/**
 * The CSS contract of the number column (YAZ-2643, D4, D7 and D9). jsdom lays nothing out, so this
 * holds the rules to what the cases say in words; where a number sits on a real page is a hand-walk check.
 */
import { describe, expect, it } from 'vitest'
import appCss from '../../app.css?inline'

/** Every `selector { body }` whose selector names a numbered block. */
const rules = [...appCss.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(([, selector, body]) => ({ selectors: selector.split(',').map((s) => s.trim()), body }))
  .filter(({ selectors }) => selectors.some((s) => /\[data-line(-end)?\]/.test(s)))

const bodyOf = (selector: string): string => {
  const rule = rules.filter(({ selectors }) => selectors.includes(selector))
  if (rule.length === 0) throw new Error(`no rule for ${selector}`)
  return rule.map(({ body }) => body).join('\n')
}

const ON = '.editor-host[data-line-numbers] .ProseMirror'

describe('line numbers CSS contract', () => {
  it('every rule applies only while the switch is on, and only inside the note body (S51, S55)', () => {
    expect(rules.length).toBeGreaterThan(0)
    for (const { selectors } of rules) for (const selector of selectors) expect(selector.startsWith(`${ON} `), selector).toBe(true)
    expect(appCss).toMatch(/\.editor-host\[data-line-numbers\] \.editor-instance \.milkdown > \.ProseMirror\s*\{\s*container-type:\s*inline-size;\s*\}/)
  })

  it('draws the number from the attribute, small, grey and monospace, in ONE column (S49, S50)', () => {
    const number = bodyOf(`${ON} [data-line]::after`)
    expect(number).toMatch(/content:\s*attr\(data-line\);/)
    expect(number).toMatch(/right:\s*calc\(100cqw \+ 52px \/ var\(--document-zoom, 1\)\);/)
    expect(number).toMatch(/white-space:\s*nowrap;/)
    expect(number).toMatch(/color:\s*var\(--fg-muted\);/)
    expect(number).toMatch(/font:\s*calc\(11px \/ var\(--document-zoom, 1\)\) \/ var\(--line-box\) var\(--crepe-font-code\);/)
  })

  it('a block that ends on a later line draws its range, `8–10`, on the SAME pseudo-element, from the two attributes; a table on its `::before` (D7, S72)', () => {
    const range = rules.filter(({ selectors }) => selectors.some((selector) => selector.includes('[data-line-end]')))
    expect(range.map(({ selectors }) => selectors)).toEqual([[`${ON} [data-line-end]::after`, `${ON} .milkdown-table-block[data-line-end]::before`]])
    expect(range[0].body.trim()).toBe("content: attr(data-line) '–' attr(data-line-end);")
    // Under the rule that draws the start, so that it wins at the same weight; a table's `::after` stays empty.
    const css = appCss.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css.indexOf(`${ON} [data-line-end]::after`)).toBeGreaterThan(css.indexOf(`${ON} [data-line]::after`))
    expect(bodyOf(`${ON} .milkdown-table-block[data-line]::after`)).toMatch(/content:\s*none;/)
  })

  it('the numbers have a lane of their own: the scroller gets 64px of left padding while they show, and only then (D9, S51)', () => {
    expect(appCss).toMatch(/\.editor-host\[data-line-numbers\]\s*\{\s*padding-left:\s*64px;\s*\}/)
    // Nothing else sets the scroller's left padding: with the numbers off the page is where it was.
    const scroller = appCss.match(/\.editor-host\s*\{([^}]*)\}/s)![1].replace(/\/\*[\s\S]*?\*\//g, '')
    expect(scroller).not.toMatch(/padding(-left|-inline(-start)?)?:/)
    expect(scroller).toMatch(/padding-bottom:\s*64px;/)
    expect(appCss.match(/\.editor-host[^{}]*\{[^{}]*padding-left:/g)).toHaveLength(1)
    // The lane: the 48px margin and the 64px of padding are 112px left of the column, and the number ends 52px
    // left of it. So the lane is 60px wide, left of the drag handle's box, which ends 49px left of the column.
    const [, gap] = bodyOf(`${ON} [data-line]::after`).match(/right:\s*calc\(100cqw \+ (\d+)px/)!
    expect(48 + 64 - Number(gap)).toBe(60)
    expect(Number(gap)).toBeGreaterThan(49)
  })

  it('divides the number’s size and its gap by the document zoom, and nothing else: 11px and 52px on screen at every zoom (S53)', () => {
    const zoomed = rules.filter(({ body }) => body.includes('--document-zoom'))
    expect(zoomed.map(({ selectors }) => selectors)).toEqual([[`${ON} [data-line]::after`, `${ON} .milkdown-table-block[data-line]::before`]])
    expect(zoomed[0].body.match(/\/ var\(--document-zoom, 1\)/g)).toHaveLength(2)
    // The zoom the two lengths undo is the one on the note body itself.
    expect(appCss).toMatch(/\.editor-instance \.milkdown > \.ProseMirror\s*\{\s*zoom:\s*var\(--document-zoom, 1\);\s*\}/)
  })

  it('takes the number out of the flow, out of selection and out of the pointer’s way (S51, S54)', () => {
    const number = bodyOf(`${ON} [data-line]::after`)
    expect(number).toMatch(/position:\s*absolute;/)
    expect(number).toMatch(/user-select:\s*none;/)
    expect(number).toMatch(/pointer-events:\s*none;/)
  })

  it('a rule and a code block do not clip their number; a table keeps its clip and is never positioned', () => {
    expect(bodyOf(`${ON} hr[data-line]`)).toMatch(/overflow:\s*visible;/)
    expect(bodyOf(`${ON} .milkdown-code-block[data-line]`)).toMatch(/overflow:\s*visible;/)
    const table = bodyOf(`${ON} .milkdown-table-block[data-line]`)
    expect(table).toMatch(/position:\s*static;/)
    expect(table).not.toMatch(/overflow/)
    expect(bodyOf(`${ON} .milkdown-table-block[data-line]::after`)).toMatch(/content:\s*none;/)
    expect(bodyOf(`${ON} .milkdown-table-block[data-line]::before`)).toMatch(/top:\s*auto;/)
  })
})

describe('page settings CSS contract', () => {
  it('the menu, its rows, its divider and the cog’s hover and focus ring are the zoom menu’s own rules, shared (D3)', () => {
    expect(appCss).toMatch(/\.document-zoom__menu,\s*\.page-settings__menu\s*\{/)
    expect(appCss).toMatch(/\.document-zoom__divider,\s*\.page-settings__divider\s*\{/)
    expect(appCss).toMatch(/\.document-zoom__presets button,\s*\.page-settings__menu button\s*\{/)
    expect(appCss).toMatch(/\.document-zoom__presets button\[aria-pressed="true"\],\s*\.page-settings__menu button\[aria-pressed="true"\]\s*\{/)
    expect(appCss).toMatch(/\.document-zoom__step:hover:enabled,\s*\.page-settings__trigger:hover,\s*\.page-settings__trigger\[aria-expanded="true"\]\s*\{/)
    expect(appCss.match(/\.page-settings__trigger:hover/g)).toHaveLength(1)
    expect(appCss).toMatch(/\.document-zoom__step:focus-visible,\s*\.page-settings__trigger:focus-visible\s*\{/)
  })
})
