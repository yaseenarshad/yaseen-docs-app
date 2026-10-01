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
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--bg-hover)' },
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
