import { Compartment } from '@codemirror/state'
import { lineNumbers, ViewPlugin, type EditorView } from '@codemirror/view'

/** On a code block the line-number plugin gave an inner line to: the file line of its FIRST code line. */
export const CODE_LINE_ATTR = 'data-line-code'

const gutter = new Compartment()
/** The first line each CodeMirror counts from now. One that is not here shows its own 1, 2, 3. */
const shown = new WeakMap<EditorView, number>()

/**
 * Makes one code block's own gutter count in lines of the file (YAZ-2643, D8), or gives it back its
 * 1, 2, 3: whatever its block's `data-line-code` says now. It dispatches only when that changed,
 * and then effects only: no change of the text and none of the selection, so nothing goes to ProseMirror.
 */
export function syncCodeLines(cm: EditorView): void {
  const attr = cm.dom.closest('.milkdown-code-block')?.getAttribute(CODE_LINE_ATTR)
  const first = attr == null ? undefined : Number(attr)
  if (shown.get(cm) === first) return
  if (first === undefined) shown.delete(cm)
  else shown.set(cm, first)
  // Crepe's own `lineNumbers()` sets no formatter, so this one merges with it and the gutter is drawn again.
  cm.dispatch({ effects: gutter.reconfigure(first === undefined ? [] : lineNumbers({ formatNumber: (line) => String(line + first - 1) })) })
}

/**
 * For every code block's CodeMirror (`createCrepe`). Crepe makes a CodeMirror when its block comes
 * near the window and drops it 5 s after the block left, so a new one asks for its lines itself:
 * one microtask after it is made, when it is in its block. Nothing here runs on a keystroke.
 */
export const codeLines = [
  gutter.of([]),
  ViewPlugin.define((cm) => {
    queueMicrotask(() => syncCodeLines(cm))
    return {}
  }),
]
