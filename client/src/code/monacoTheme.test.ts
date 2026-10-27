import { describe, expect, it } from 'vitest'
import { buildMonacoTheme, monacoThemeName, readAppTokens, toHex } from './monacoTheme'

describe('toHex (YAZ-3447)', () => {
  it('gives Monaco #rrggbb, or #rrggbbaa when the colour is see-through', () => {
    expect(toHex('rgb(207, 34, 46)')).toBe('#cf222e')
    expect(toHex('rgba(9, 105, 218, 0.18)')).toBe('#0969da2e')
    expect(toHex('rgb(9 105 218 / 50%)')).toBe('#0969da80')
    expect(toHex('rgba(1, 2, 3, 1)')).toBe('#010203')
    expect(toHex('#ABC')).toBe('#aabbcc')
    expect(toHex('#5B6CFF')).toBe('#5b6cff')
  })

  it('answers undefined for what it cannot read, so Monaco keeps its own colour', () => {
    expect(toHex('')).toBeUndefined()
    expect(toHex('color-mix(in srgb, red, blue)')).toBeUndefined()
  })
})

const LIGHT: Record<string, string> = {
  '--bg': 'rgb(255, 255, 255)',
  '--bg-side': 'rgb(246, 246, 247)',
  '--bg-hover': 'rgb(238, 238, 240)',
  '--fg': 'rgb(31, 31, 31)',
  '--fg-muted': 'rgb(122, 122, 122)',
  '--border': 'rgb(228, 228, 231)',
  '--accent': 'rgb(91, 108, 255)',
  '--accent-soft': 'rgb(238, 240, 255)',
  '--danger': 'rgb(214, 69, 69)',
  '--code-keyword': 'rgb(207, 34, 46)',
  '--code-string': 'rgb(10, 48, 105)',
  '--code-number': 'rgb(5, 80, 174)',
  '--code-function': 'rgb(130, 80, 223)',
  '--code-type': 'rgb(149, 56, 0)',
  '--code-key': 'rgb(5, 80, 174)',
  '--code-selection': 'rgba(9, 105, 218, 0.18)',
}

describe('buildMonacoTheme (YAZ-3447)', () => {
  it("takes every colour from the app's tokens: the editor, the widgets (find, suggest, peek) and the code", () => {
    const theme = buildMonacoTheme('light', (name) => LIGHT[name] ?? '')
    expect(theme.base).toBe('vs')
    expect(theme.inherit).toBe(true)
    expect(theme.colors).toMatchObject({
      'editor.background': '#ffffff',
      'editor.foreground': '#1f1f1f',
      'editor.selectionBackground': '#0969da2e',
      'editorLineNumber.foreground': '#7a7a7a',
      focusBorder: '#5b6cff',
      'editorWidget.background': '#f6f6f7',
      'peekView.border': '#5b6cff',
      'peekViewResult.background': '#f6f6f7',
      // The find box (YAZ-3451): its match and its on options in the accent.
      'editor.findMatchBorder': '#5b6cff',
      'inputOption.activeBorder': '#5b6cff',
    })
    expect(theme.colors['editor.findMatchBackground']).toBe(theme.colors['inputOption.activeBackground'])
    expect(theme.rules).toContainEqual({ token: 'keyword', foreground: 'cf222e' })
    expect(theme.rules).toContainEqual({ token: 'string', foreground: '0a3069' })
    expect(theme.rules).toContainEqual({ token: 'comment', foreground: '7a7a7a', fontStyle: 'italic' })
  })

  it('a dark Appearance builds on vs-dark; a token the page lacks leaves Monaco its own colour', () => {
    const theme = buildMonacoTheme('dark', (name) => (name === '--bg' ? 'rgb(30, 30, 30)' : ''))
    expect(theme.base).toBe('vs-dark')
    expect(theme.colors).toHaveProperty('editor.background', '#1e1e1e')
    expect(theme.colors).not.toHaveProperty('editor.foreground')
    expect(theme.rules.every((r) => r.foreground !== undefined)).toBe(true)
    expect(monacoThemeName('dark')).toBe('yaseen-dark')
  })

  // jsdom does not resolve `var()` in a computed colour, so the browser's half is not checked here.
  it('readAppTokens reads every token once, through one probe, and leaves no probe behind', () => {
    const before = document.body.childElementCount
    const read = readAppTokens()
    expect(typeof read('--fg')).toBe('string')
    expect(document.body.childElementCount).toBe(before)
  })
})
