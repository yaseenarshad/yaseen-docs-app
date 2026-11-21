/**
 * Code block colours that follow Appearance (YAZ-2270). Crepe's default One Dark is built for a
 * dark background, but light mode draws code blocks on #f7f7f7, where its grey text sat at ~2:1.
 * Every colour here is an app.css variable (:root + [data-theme='dark']), so flipping Appearance
 * re-colours code live — the same CSS-only swap as crepeTheme.ts.
 */
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'

/** Only what CodeMirror's light defaults get wrong on the dark block. */
const chrome = EditorView.theme({
  '&': { color: 'var(--fg)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--fg)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'var(--code-selection)',
  },
  // YAZ-5837: CodeMirror draws the selection BEHIND the text (z-index -2), and the focused line's band below is a
  // background ON the line, so it hid a selection on the caret's line. The layer goes above the lines; the colour is
  // see-through (app.css `--code-selection`), so text, syntax colours and code marks show through it. The caret's
  // own layer stays on top (CodeMirror sets each layer's z-index inline, 150 for the caret, hence the `!important`).
  '.cm-selectionLayer': { zIndex: '1 !important' },
  // Only the block being edited marks its line; at rest a block is plain.
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'transparent' },
  '&.cm-focused .cm-activeLine, &.cm-focused .cm-activeLineGutter': { backgroundColor: 'var(--bg-hover)' },
  '.cm-tooltip': { backgroundColor: 'var(--bg)', color: 'var(--fg)', border: '1px solid var(--border)' },
})

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier], color: 'var(--code-keyword)' },
  { tag: [t.string, t.regexp], color: 'var(--code-string)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--code-number)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--code-function)' },
  { tag: [t.typeName, t.className, t.tagName], color: 'var(--code-type)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--code-key)' },
  { tag: t.heading, color: 'var(--code-key)', fontWeight: 'bold' },
  { tag: [t.comment, t.meta, t.processingInstruction, t.contentSeparator], color: 'var(--fg-muted)' },
  { tag: [t.link, t.url], color: 'var(--accent)' },
  { tag: t.invalid, color: 'var(--danger)' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
])

export const codeTheme = [chrome, syntaxHighlighting(highlight)]
