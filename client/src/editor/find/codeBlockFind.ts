/**
 * ⌘F inside a note's code blocks (YAZ-4787 demo: "how come Command F doesn't work if I have a code block"). Find always
 * counted a code block's text (it is a ProseMirror textblock), but a code block is a CodeMirror editor that draws its own
 * text, so ProseMirror's inline decorations never showed there and the active match could not be scrolled to.
 *
 * `codeBlockFind` goes in every code block's CodeMirror extensions (`createCrepe.ts`): a field of mark decorations with
 * find's own classes, so the same CSS paints them. `paintCodeBlocks` hands each block its matches after every find
 * change (an effects-only CodeMirror transaction: no text changes, nothing goes back to ProseMirror), and
 * `scrollCodeMatch` centres the active match through CodeMirror, which draws only the lines on screen.
 */
import { StateEffect, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView as CodeMirrorView } from '@codemirror/view'
import type { EditorView } from '@milkdown/kit/prose/view'

const MATCH = 'find-match'
const ACTIVE = 'find-match--active'

interface CodeMark {
  from: number
  to: number
  active: boolean
}

const setMarks = StateEffect.define<readonly CodeMark[]>()

const marks = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (set, tr) => {
    for (const effect of tr.effects) {
      if (!effect.is(setMarks)) continue
      const length = tr.state.doc.length
      const ranges = effect.value.filter((m) => m.from < m.to && m.to <= length).map((m) => Decoration.mark({ class: m.active ? `${MATCH} ${ACTIVE}` : MATCH }).range(m.from, m.to))
      return Decoration.set(ranges, true)
    }
    return tr.docChanged ? set.map(tr.changes) : set
  },
  provide: (field) => CodeMirrorView.decorations.from(field),
})

/** The CodeMirror extension: every code block carries it, empty until a search paints it. */
export const codeBlockFind = marks

/** The code block holding `pos`, as its content start and its CodeMirror view; null outside a code block. */
function codeBlockAt(view: EditorView, pos: number): { start: number; cm: CodeMirrorView } | null {
  if (pos < 0 || pos > view.state.doc.content.size) return null
  const $pos = view.state.doc.resolve(pos)
  if ($pos.parent.type.spec.code !== true || $pos.depth === 0) return null
  const dom = view.nodeDOM($pos.before())
  const content = dom instanceof Element ? dom.querySelector<HTMLElement>('.cm-content') : null
  const cm = content === null ? null : CodeMirrorView.findFromDOM(content)
  return cm === null ? null : { start: $pos.start(), cm }
}

/**
 * Paints `matches` in the code blocks that hold them, the one at `activeIndex` as the active match, and clears the
 * blocks `painted` held before. Returns the blocks painted now, for the next call.
 */
export function paintCodeBlocks(view: EditorView, matches: readonly { from: number; to: number }[], activeIndex: number, painted: ReadonlySet<CodeMirrorView>): Set<CodeMirrorView> {
  const byBlock = new Map<CodeMirrorView, CodeMark[]>()
  matches.forEach((match, index) => {
    const block = codeBlockAt(view, match.from)
    if (block === null) return
    const list = byBlock.get(block.cm) ?? []
    list.push({ from: match.from - block.start, to: match.to - block.start, active: index === activeIndex })
    byBlock.set(block.cm, list)
  })
  for (const cm of painted) if (!byBlock.has(cm) && cm.dom.isConnected) cm.dispatch({ effects: setMarks.of([]) })
  for (const [cm, list] of byBlock) cm.dispatch({ effects: setMarks.of(list) })
  return new Set(byBlock.keys())
}

/** Centres a match inside a code block through CodeMirror; false when `match` is not in one. */
export function scrollCodeMatch(view: EditorView, match: { from: number }): boolean {
  const block = codeBlockAt(view, match.from)
  if (block === null) return false
  block.cm.dispatch({ effects: CodeMirrorView.scrollIntoView(match.from - block.start, { y: 'center' }) })
  return true
}
