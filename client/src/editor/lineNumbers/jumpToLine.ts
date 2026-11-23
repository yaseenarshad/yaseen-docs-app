import { editorViewCtx } from '@milkdown/kit/core'
import { Selection } from '@milkdown/kit/prose/state'
import type { Crepe } from '../crepe'
import { fileLines } from './fileLines'
import { requestBlockLines } from './lineNumbers'

const LINE_CONTAINERS = new Set(['bullet_list', 'ordered_list', 'list_item', 'blockquote', 'footnote_definition', 'cell_note'])
const LINE_LEAVES = new Set(['paragraph', 'heading', 'code_block', 'hr', 'table'])

/** Jump the ProseMirror selection and scroller to the leaf block covering 1-based disk `line` (YAZ-4502). */
export async function jumpViewToLine(
  crepe: Crepe,
  frontmatter: string,
  body: string,
  line: number,
  scroller: HTMLElement | null | undefined,
  isCurrent: () => boolean,
): Promise<void> {
  if (!('editor' in crepe) || crepe.editor === undefined) return
  const { text, toFileLine } = fileLines(frontmatter, body)
  let targetIndex = 0
  if (typeof Worker !== 'undefined') {
    const blocks = await requestBlockLines(text).catch(() => null)
    if (!isCurrent() || blocks === null || blocks.lines.length === 0) return
    targetIndex = blocks.lines.length - 1
    for (let i = 0; i < blocks.lines.length; i++) {
      if (line <= toFileLine(blocks.ends[i])) {
        targetIndex = i
        break
      }
    }
  } else {
    const diskLines = text.split(/\r\n|\r|\n/)
    let blockIdx = -1
    let inBlock = false
    for (let i = 0; i < diskLines.length; i++) {
      const nonEmpty = diskLines[i].trim() !== ''
      if (nonEmpty && !inBlock) {
        blockIdx++
        inBlock = true
      } else if (!nonEmpty) {
        inBlock = false
      }
      if (toFileLine(i + 1) >= line && blockIdx >= 0) {
        targetIndex = blockIdx
        break
      }
      if (blockIdx >= 0) targetIndex = blockIdx
    }
  }
  const view = crepe.editor.ctx.get(editorViewCtx)
  let index = 0
  let targetPos: number | null = null
  let lastLeafPos: number | null = null
  view.state.doc.descendants((node, pos) => {
    if (targetPos !== null) return false
    if (LINE_CONTAINERS.has(node.type.name)) return true
    if (LINE_LEAVES.has(node.type.name)) {
      lastLeafPos = pos
      if (index === targetIndex) targetPos = pos
      index++
    }
    return false
  })
  const pos = targetPos ?? lastLeafPos
  if (pos === null) return
  const resolved = view.state.doc.resolve(Math.min(pos + 1, view.state.doc.content.size))
  view.dispatch(view.state.tr.setSelection(Selection.near(resolved)).scrollIntoView())
  const dom = view.nodeDOM(pos)
  if (dom instanceof HTMLElement && scroller) {
    const rect = dom.getBoundingClientRect()
    const box = scroller.getBoundingClientRect()
    if (box.height > 0) scroller.scrollTop += rect.top - box.top - box.height / 3
    else dom.scrollIntoView?.({ block: 'center' })
  }
}
