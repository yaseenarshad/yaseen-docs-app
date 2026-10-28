/**
 * A JUMP FROM THE CODE OUTLINE (YAZ-3486 S8, S9), as a note's table of contents jumps (`tocPlugin.ts`):
 *  1. Every fold that hides the symbol opens, and so does the symbol's own fold: the reader asked
 *     for what is under it.
 *  2. The cursor goes to the symbol's name, and the code has the focus.
 *  3. The code GLIDES there: one eased move of `GLIDE_MS` (`tocMotion.ts`), the same for a symbol two
 *     lines away and one at the far end; a symbol further than `GLIDE_SCREENS` windows away starts the
 *     move that far from it. The symbol lands `LANDING_PX` below the top, and below the sticky scroll
 *     lines of its parents. The reader's own wheel, press or key stops the glide where it is.
 *  4. One flash on the symbol's line. Under "Reduce Motion" the code lands at once, with no flash.
 *
 * Folds: Monaco has no public "open the folds around line n". The folding controller's model is the
 * one internal door `codeFolds.ts` already uses; when it is missing, nothing opens and nothing throws.
 */
import { FLASH_MS, GLIDE_MS, GLIDE_SCREENS, glideEase, LANDING_PX, reducedMotion } from '../../editor/toc/tocMotion'

const FOLDING = 'editor.contrib.folding'
/** Monaco's `ScrollType.Immediate`: a glide moves the code itself, frame by frame. */
const IMMEDIATE = 1
/** Monaco shows at most this many sticky scroll lines by default (`stickyScroll.maxLineCount`). */
const STICKY_MOST = 5

/** The part of Monaco's folding model a jump uses (internal API, see the module doc). */
interface FoldRegionsLike {
  length: number
  getStartLineNumber(index: number): number
  getEndLineNumber(index: number): number
  isCollapsed(index: number): boolean
  toRegion(index: number): unknown
}
interface FoldingModelLike {
  regions: FoldRegionsLike
  toggleCollapseState(regions: unknown[]): void
}

/** What a jump needs of the editor: public Monaco API, plus `getContribution` for the folds. */
export interface JumpEditorLike {
  getContribution(id: string): unknown
  setSelection(range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }): void
  focus(): void
  getTopForLineNumber(lineNumber: number): number
  getScrollTop(): number
  setScrollTop(top: number, scrollType?: number): void
  getScrollHeight(): number
  getLayoutInfo(): { height: number }
  getDomNode(): HTMLElement | null
  createDecorationsCollection(decorations: { range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }; options: { isWholeLine: boolean; className: string } }[]): { clear(): void }
}

export interface JumpTarget {
  line: number
  column: number
  /** How many parents the symbol has: the sticky scroll lines it lands below. */
  depth: number
}

/** The glide under way in each editor: a new jump stops the last one where it is. */
const gliding = new WeakMap<JumpEditorLike, () => void>()

/** Every collapsed fold that hides `line`, and the one that starts on it. */
function foldsInTheWay(folding: FoldingModelLike, line: number): unknown[] {
  const { regions } = folding
  const out: unknown[] = []
  for (let i = 0; i < regions.length; i++) {
    if (!regions.isCollapsed(i)) continue
    const start = regions.getStartLineNumber(i)
    if (start <= line && line <= regions.getEndLineNumber(i)) out.push(regions.toRegion(i))
  }
  return out
}

/** Opens the folds in the way, then lands. Resolves once the cursor is placed (the glide runs on). */
export async function jumpTo(editor: JumpEditorLike, target: JumpTarget, lineHeight: number): Promise<void> {
  gliding.get(editor)?.()
  const controller = editor.getContribution(FOLDING) as { getFoldingModel?: () => Promise<FoldingModelLike | null> | null } | null
  try {
    const folding = (await controller?.getFoldingModel?.()) ?? null
    if (folding !== null) {
      const open = foldsInTheWay(folding, target.line)
      if (open.length > 0) folding.toggleCollapseState(open)
    }
  } catch {
    // No folding model (a file too big to fold): nothing to open.
  }
  const at = { startLineNumber: target.line, startColumn: target.column, endLineNumber: target.line, endColumn: target.column }
  editor.setSelection(at)
  editor.focus()
  glide(editor, target, lineHeight)
}

function glide(editor: JumpEditorLike, target: JumpTarget, lineHeight: number): void {
  const height = editor.getLayoutInfo().height
  const landing = LANDING_PX + Math.min(target.depth, STICKY_MOST) * lineHeight
  const to = Math.max(0, Math.min(editor.getTopForLineNumber(target.line) - landing, editor.getScrollHeight() - height))
  const land = (): void => {
    editor.setScrollTop(to, IMMEDIATE)
    flash(editor, target.line)
  }
  if (reducedMotion() || typeof requestAnimationFrame !== 'function') {
    editor.setScrollTop(to, IMMEDIATE)
    return
  }
  const far = GLIDE_SCREENS * height
  if (Math.abs(to - editor.getScrollTop()) > far) editor.setScrollTop(to - Math.sign(to - editor.getScrollTop()) * far, IMMEDIATE)
  const from = editor.getScrollTop()
  const started = performance.now()
  const dom = editor.getDomNode()
  let frame = 0
  const stop = (): void => {
    cancelAnimationFrame(frame)
    dom?.removeEventListener('wheel', stop)
    dom?.removeEventListener('pointerdown', stop)
    dom?.removeEventListener('keydown', stop)
    if (gliding.get(editor) === stop) gliding.delete(editor)
  }
  // Timed by `performance.now()`, the clock `started` read: a frame's own timestamp may count from another origin.
  const step = (): void => {
    const t = Math.min(1, (performance.now() - started) / GLIDE_MS)
    editor.setScrollTop(from + (to - from) * glideEase(t), IMMEDIATE)
    if (t < 1) {
      frame = requestAnimationFrame(step)
      return
    }
    stop()
    land()
  }
  dom?.addEventListener('wheel', stop, { passive: true })
  dom?.addEventListener('pointerdown', stop, { passive: true })
  dom?.addEventListener('keydown', stop)
  gliding.set(editor, stop)
  frame = requestAnimationFrame(step)
}

/** One flash of the line, the note's colours (`outline.css`, `.code-outline-flash`). */
function flash(editor: JumpEditorLike, line: number): void {
  const flashed = editor.createDecorationsCollection([{ range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 }, options: { isWholeLine: true, className: 'code-outline-flash' } }])
  setTimeout(() => flashed.clear(), FLASH_MS)
}
