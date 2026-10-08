/**
 * The CSS contract of the number column (YAZ-2643, D4). jsdom lays nothing out, so this holds the
 * rules to what the cases say in words; where a number sits on a real page is a hand-walk check.
 */
import { describe, expect, it } from 'vitest'
import appCss from '../../app.css?inline'

/** Every `selector { body }` whose selector names a numbered block. */
const rules = [...appCss.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(([, selector, body]) => ({ selectors: selector.split(',').map((s) => s.trim()), body }))
  .filter(({ selectors }) => selectors.some((s) => s.includes('[data-line]')))

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
    expect(number).toMatch(/right:\s*calc\(100cqw \+ 22px\);/)
    expect(number).toMatch(/color:\s*var\(--fg-muted\);/)
    expect(number).toMatch(/font:\s*11px \/ var\(--line-box\) var\(--crepe-font-code\);/)
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
  it('the menu, its rows, its divider and the cog’s focus ring are the zoom menu’s own rules, shared (D3)', () => {
    expect(appCss).toMatch(/\.document-zoom__menu,\s*\.page-settings__menu\s*\{/)
    expect(appCss).toMatch(/\.document-zoom__divider,\s*\.page-settings__divider\s*\{/)
    expect(appCss).toMatch(/\.document-zoom__presets button,\s*\.page-settings__menu button\s*\{/)
    expect(appCss).toMatch(/\.document-zoom__presets button\[aria-pressed="true"\],\s*\.page-settings__menu button\[aria-checked="true"\]\s*\{/)
    expect(appCss).toMatch(/\.document-zoom__step:focus-visible,\s*\.page-settings__trigger:focus-visible\s*\{/)
  })
})
