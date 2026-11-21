/**
 * An inline drawing's `<!-- drawing: … -->` line in the editor (YAZ-5040): the `code_block` node's
 * `drawingLine` attribute, joined on load and written right under the closing fence by `codeWidth.ts`.
 */
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { Code, RootContent } from 'mdast'
import { cleanDrawingLine, DRAWING_LANGUAGE, drawingTitleOf, parseDrawingLine } from '@shared/inlineDrawing'
import type { EmbedOptions } from '@shared/embedOptions'

export { cleanDrawingLine, DRAWING_LANGUAGE, drawingTitleOf }

/** On the inline drawing's `<pre>` (copy and paste inside the app): the drawing option line's text. */
export const DRAWING_LINE_ATTR = 'data-drawing-line'

/** Is `node` an inline Excalidraw drawing: a `code_block` with language `excalidraw`? */
export const isInlineDrawingNode = (node: ProseNode | null | undefined): boolean =>
  node?.type.name === 'code_block' && node.attrs.language === DRAWING_LANGUAGE

/** Is the mdast `block` an inline drawing fence: ```` ```excalidraw ```` with nothing after the language? */
export const isInlineDrawingCode = (block: RootContent): boolean =>
  block.type === 'code' && block.lang === DRAWING_LANGUAGE && !(block as Code).meta

/** Parsed `EmbedOptions` from an inline drawing node's `drawingLine` attribute, or null. */
export function drawingOptionsOf(node: ProseNode): EmbedOptions | null {
  const text = cleanDrawingLine(node.attrs.drawingLine)
  return text === null ? null : parseDrawingLine(text)
}
