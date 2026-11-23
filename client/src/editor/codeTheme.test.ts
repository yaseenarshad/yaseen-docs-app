/**
 * A mouse selection in a code block shows (YAZ-5837): CodeMirror draws the selection in a layer BEHIND the text, and
 * the focused line's band (`.cm-activeLine`) is a background ON the line, so an opaque band hid the selection on the
 * caret's line; in dark mode the colour was also near the block's own. The code theme lifts the selection layer above
 * the line band, and the colour is see-through in both themes, so the text, the syntax colours and the marks show
 * through it.
 */
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import appCss from '../app.css?inline'
import { codeTheme } from './codeTheme'

/** Every CSS rule CodeMirror put in the document, as text. */
const cmRules = (): string =>
  [...document.styleSheets]
    .flatMap((sheet) => [...sheet.cssRules])
    .map((rule) => rule.cssText)
    .concat([...document.querySelectorAll('style')].map((style) => style.textContent ?? ''))
    .join('\n')

/** The alpha of an `rgba(…)` value, 1 for anything else. */
const alphaOf = (value: string): number => Number(/rgba\([^)]*,\s*([\d.]+)\)/.exec(value)?.[1] ?? 1)

describe('the selection in a code block (YAZ-5837)', () => {
  it('draws above the focused line band, in a see-through colour in light and dark', () => {
    const view = new EditorView({ state: EditorState.create({ doc: 'const a = 1', extensions: codeTheme }), parent: document.body })
    // CodeMirror sets each layer's z-index inline (the selection's -2), so only an `!important` rule wins.
    const layer = /\.cm-selectionLayer[^{]*\{[^}]*z-index:\s*(-?\d+)\s*!important/.exec(cmRules())
    expect(layer, 'the code theme lifts the selection layer, over the inline z-index').not.toBeNull()
    expect(Number(layer![1])).toBeGreaterThan(0)
    expect(Number(layer![1])).toBeLessThan(149)
    view.destroy()
    const values = [...appCss.matchAll(/--code-selection:\s*([^;]+);/g)].map((m) => m[1].trim())
    expect(values).toHaveLength(2)
    for (const value of values) expect(alphaOf(value)).toBeLessThan(0.5)
  })
})
