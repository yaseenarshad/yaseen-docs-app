import { describe, expect, it } from 'vitest'
import tableCss from './table.css?inline'

/** Every rule of a sheet, comments gone: its selectors, one by one, and its body. */
const rulesOf = (css: string): { selectors: string[]; body: string }[] =>
  [...css.replace(/\/\*.*?\*\//gs, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selectors: selector.split(',').map((one) => one.trim()), body }))

describe('the head buttons of a calendar\'s All notes (YAZ-4412)', () => {
  it('Copy all has the frame of Now and Only filled: the editor\'s prefix, so Crepe\'s button reset does not win', () => {
    const frame = (name: string) => rulesOf(tableCss).find(({ selectors }) => selectors.includes(`.milkdown .ProseMirror .cell-note-all-head ${name}`))
    for (const name of ['.cell-note-all-head__now', '.cell-note-all-head__filled', '.cell-note-card__copy']) {
      const rule = frame(name)
      expect(rule, name).toBeDefined()
      expect(rule!.body).toMatch(/padding:\s*0 8px/)
      expect(rule!.body).toMatch(/background:\s*var\(--bg\)/)
    }
  })
})
