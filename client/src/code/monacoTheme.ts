/**
 * Monaco in the app's colours (YAZ-3447, D1). Monaco sets its colours in JavaScript, as hex, so the
 * CSS-only swap `editor/codeTheme.ts` uses cannot reach it. This builds Monaco's theme from the
 * app.css tokens as they are applied NOW (`--fg`, `--bg`, `--accent`, the `--code-*` palette, …),
 * once per Appearance change: `yaseen-light` on Monaco's `vs`, `yaseen-dark` on `vs-dark`. The find
 * box, the suggest list, the hover and the peek box are Monaco's widgets, so they take these colours too.
 */
import type { editor } from 'monaco-editor'

export type AppTheme = 'light' | 'dark'

/** The Monaco theme name for an Appearance. */
export const monacoThemeName = (theme: AppTheme): string => `yaseen-${theme}`

/** An app.css token as a colour the browser resolved; `''` when it has none. */
export type ReadToken = (name: string) => string

/**
 * `rgb(…)` / `rgba(…)` / `#rgb` / `#rrggbb(aa)` as Monaco's `#rrggbb` or `#rrggbbaa`; `undefined` for
 * anything else (Monaco then keeps its own colour for that key, never a broken one).
 */
export function toHex(color: string): string | undefined {
  const c = color.trim()
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(c)
  if (short !== null) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase()
  if (/^#([0-9a-f]{6}|[0-9a-f]{8})$/i.test(c)) return c.toLowerCase()
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(c)
  if (rgb === null) return undefined
  const byte = (v: number): string => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')
  const hex = `#${byte(Number(rgb[1]))}${byte(Number(rgb[2]))}${byte(Number(rgb[3]))}`
  if (rgb[4] === undefined) return hex
  const alpha = rgb[4].endsWith('%') ? Number(rgb[4].slice(0, -1)) / 100 : Number(rgb[4])
  return alpha >= 1 ? hex : `${hex}${byte(alpha * 255)}`
}

/**
 * Reads each token through a probe element's computed `color`, so whatever app.css says (hex,
 * `rgba()`, a `var()` of a `var()`) comes back resolved by the browser.
 */
export function readAppTokens(doc: Document = document): ReadToken {
  const probe = doc.createElement('span')
  probe.style.display = 'none'
  doc.body.appendChild(probe)
  const cache = new Map<string, string>()
  const read: ReadToken = (name) => {
    let value = cache.get(name)
    if (value === undefined) {
      probe.style.color = ''
      probe.style.color = `var(${name})`
      value = getComputedStyle(probe).color
      cache.set(name, value)
    }
    return value
  }
  // Read every token now, then drop the probe: the caller holds the answers, not the element.
  for (const name of TOKENS) read(name)
  probe.remove()
  return read
}

const TOKENS = ['--bg', '--bg-side', '--bg-hover', '--fg', '--fg-muted', '--border', '--accent', '--accent-soft', '--danger', '--code-keyword', '--code-string', '--code-number', '--code-function', '--code-type', '--code-key', '--code-selection'] as const

/** The Monaco theme for `theme`, from the tokens `read` gives. Pure: the tests hand it a table. */
export function buildMonacoTheme(theme: AppTheme, read: ReadToken): editor.IStandaloneThemeData {
  const hex = (name: string): string | undefined => toHex(read(name))
  /** A token rule's colour has no `#` in Monaco. */
  const fg = (name: string): string | undefined => hex(name)?.slice(1, 7)
  const rule = (token: string, name: string, fontStyle?: string): editor.ITokenThemeRule => ({ token, foreground: fg(name), ...(fontStyle === undefined ? {} : { fontStyle }) })
  const colors: Record<string, string | undefined> = {
    'editor.background': hex('--bg'),
    'editor.foreground': hex('--fg'),
    'editorCursor.foreground': hex('--fg'),
    'editor.selectionBackground': hex('--code-selection'),
    'editor.inactiveSelectionBackground': hex('--code-selection'),
    'editor.lineHighlightBackground': hex('--bg-hover'),
    'editor.lineHighlightBorder': hex('--bg-hover'),
    'editorLineNumber.foreground': hex('--fg-muted'),
    'editorLineNumber.activeForeground': hex('--fg'),
    'editorGutter.background': hex('--bg'),
    'editorIndentGuide.background1': hex('--border'),
    'editorWhitespace.foreground': hex('--border'),
    'editorBracketMatch.border': hex('--accent'),
    'editorBracketHighlight.foreground1': hex('--code-function'),
    'editorBracketHighlight.foreground2': hex('--code-type'),
    'editorBracketHighlight.foreground3': hex('--code-number'),
    'editorStickyScroll.background': hex('--bg'),
    'editorStickyScroll.border': hex('--border'),
    focusBorder: hex('--accent'),
    'editorWidget.background': hex('--bg-side'),
    'editorWidget.foreground': hex('--fg'),
    'editorWidget.border': hex('--border'),
    'editorHoverWidget.background': hex('--bg-side'),
    'editorHoverWidget.border': hex('--border'),
    'editorSuggestWidget.background': hex('--bg-side'),
    'editorSuggestWidget.border': hex('--border'),
    'editorSuggestWidget.selectedBackground': hex('--accent-soft'),
    'editorSuggestWidget.highlightForeground': hex('--accent'),
    'input.background': hex('--bg'),
    'input.foreground': hex('--fg'),
    'input.border': hex('--border'),
    'inputOption.activeBorder': hex('--accent'),
    'list.hoverBackground': hex('--bg-hover'),
    'list.activeSelectionBackground': hex('--accent-soft'),
    'list.activeSelectionForeground': hex('--fg'),
    'list.highlightForeground': hex('--accent'),
    // The find box (YAZ-3451, D7 amended): the active match, the other matches, the "in selection" range, and the on state of Aa / ab / .* .
    'editor.findMatchBackground': hex('--accent-soft'),
    'editor.findMatchBorder': hex('--accent'),
    'editor.findMatchHighlightBackground': hex('--code-selection'),
    'editor.findRangeHighlightBackground': hex('--bg-hover'),
    'inputOption.activeBackground': hex('--accent-soft'),
    'inputOption.activeForeground': hex('--fg'),
    'inputValidation.errorBorder': hex('--danger'),
    'editorWidget.resizeBorder': hex('--border'),
    'peekView.border': hex('--accent'),
    'peekViewTitle.background': hex('--bg-side'),
    'peekViewTitleLabel.foreground': hex('--fg'),
    'peekViewTitleDescription.foreground': hex('--fg-muted'),
    'peekViewEditor.background': hex('--bg'),
    'peekViewEditorGutter.background': hex('--bg'),
    'peekViewResult.background': hex('--bg-side'),
    'peekViewResult.selectionBackground': hex('--accent-soft'),
    'editorError.foreground': hex('--danger'),
    'scrollbar.shadow': '#00000000',
  }
  return {
    base: theme === 'dark' ? 'vs-dark' : 'vs',
    inherit: true,
    // The same token-to-colour map as the note code blocks (`editor/codeTheme.ts`), in Monaco's token names.
    rules: [
      rule('', '--fg'),
      rule('keyword', '--code-keyword'),
      rule('string', '--code-string'),
      rule('regexp', '--code-string'),
      rule('number', '--code-number'),
      rule('type', '--code-type'),
      rule('type.identifier', '--code-type'),
      rule('tag', '--code-type'),
      rule('attribute.name', '--code-key'),
      rule('string.key.json', '--code-key'),
      rule('key', '--code-key'),
      rule('predefined', '--code-function'),
      rule('annotation', '--code-function'),
      rule('comment', '--fg-muted', 'italic'),
      rule('invalid', '--danger'),
    ].filter((r) => r.foreground !== undefined),
    colors: Object.fromEntries(Object.entries(colors).filter((e): e is [string, string] => e[1] !== undefined)),
  }
}
