/**
 * INLINE EXCALIDRAW MERGE FOR TWO-MAC GIT SYNC (YAZ-6142): runs right beside `uniteCardLines`
 * (`shared/cardMerge.ts`) before `.md` line-merge during a Git rebase.
 *
 * When two Macs both edit the same ```` ```excalidraw ```` block inside a `.md` page (e.g. Mac A
 * adds a rectangle, Mac B adds an arrow), git's line merge sees the same single-line JSON changed
 * two ways and would otherwise create a conflict copy of the entire page.
 *
 * `uniteInlineDrawings` runs `mergeBoards` (`shared/boardMerge.ts`) shape-by-shape on the
 * base/theirs/mine scene JSON, compacts the merged scene (`files: {}`), 3-way merges the optional
 * `<!-- drawing: … -->` line, and writes the identical merged block into both `theirs` and `mine`
 * so the subsequent `.md` line merge succeeds cleanly with zero conflict markers and zero conflict
 * copy.
 *
 * Pure and never-throwing: malformed JSON or mismatched block counts fall back gracefully to the
 * original `[theirs, mine]` so sync never aborts.
 */
import { mergeBoards } from './boardMerge'
import { splitFrontmatter } from './frontmatter'
import {
  compactInlineScene,
  drawingTitleOf,
  findInlineDrawings,
  formatDrawingLine,
  inlineDrawingBlock,
  parseDrawingLine,
  type InlineDrawingBlock,
} from './inlineDrawing'
import { lineEnds } from './lineEnds'

function indentLines(block: string, indent: string): string {
  if (indent === '') return block
  return block
    .split('\n')
    .map((l) => (l === '' ? '' : `${indent}${l}`))
    .join('\n')
}

/** 3-way merge of `<!-- drawing: … -->`: one side's change wins; on a clash, title merges 3-way and theirs' options win. */
function mergeDrawingLine(base: string | null, theirs: string | null, mine: string | null): string | null {
  if (theirs === mine) return theirs
  if (theirs === base) return mine
  if (mine === base) return theirs
  const baseTitle = drawingTitleOf(base)
  const theirTitle = drawingTitleOf(theirs)
  const myTitle = drawingTitleOf(mine)
  const title = theirTitle === myTitle ? theirTitle : theirTitle === baseTitle ? myTitle : theirTitle
  const baseOpts = base === null ? null : parseDrawingLine(base)
  const theirOpts = theirs === null ? null : parseDrawingLine(theirs)
  const myOpts = mine === null ? null : parseDrawingLine(mine)
  const sameOpts = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  const opts = sameOpts(theirOpts, baseOpts) ? myOpts : theirOpts
  return formatDrawingLine(opts, title)
}

function rewriteBlocks(
  content: string,
  blocks: readonly InlineDrawingBlock[],
  replacements: ReadonlyMap<number, { json: string; drawingLine: string | null }>,
): string {
  const { text, back } = lineEnds(content)
  const { frontmatter, body } = splitFrontmatter(text)
  const lines = body.split('\n')
  // Splice from bottom to top so earlier line indices stay valid.
  for (let i = blocks.length - 1; i >= 0; i--) {
    const rep = replacements.get(i)
    if (rep === undefined) continue
    const block = blocks[i]!
    const rendered = indentLines(inlineDrawingBlock(rep.json, rep.drawingLine), block.indent)
    const end = block.lineAt ?? block.close
    lines.splice(block.open, end - block.open + 1, rendered)
  }
  return back(frontmatter + lines.join('\n'))
}

/**
 * Unites conflicting inline ```` ```excalidraw ```` blocks in `theirs` and `mine` against `base`
 * using shape-by-shape `mergeBoards`. Returns `[theirs, mine]` with each merged block identical on
 * both sides, or the original `[theirs, mine]` on any parse failure or error (never throws).
 */
export function uniteInlineDrawings(base: string | null, theirs: string, mine: string): [string, string] {
  if (base === null) return [theirs, mine]
  try {
    const baseBlocks = findInlineDrawings(splitFrontmatter(lineEnds(base).text).body)
    const theirBlocks = findInlineDrawings(splitFrontmatter(lineEnds(theirs).text).body)
    const myBlocks = findInlineDrawings(splitFrontmatter(lineEnds(mine).text).body)
    if (baseBlocks.length === 0 || baseBlocks.length !== theirBlocks.length || baseBlocks.length !== myBlocks.length) {
      return [theirs, mine]
    }

    const replacements = new Map<number, { json: string; drawingLine: string | null }>()
    for (let i = 0; i < baseBlocks.length; i++) {
      const b = baseBlocks[i]!
      const t = theirBlocks[i]!
      const m = myBlocks[i]!
      const bJson = b.json.trim()
      const tJson = t.json.trim()
      const mJson = m.json.trim()
      const jsonDiffers = tJson !== mJson
      const lineDiffers = t.drawingLine !== m.drawingLine
      if (!jsonDiffers && !lineDiffers) continue

      let mergedJson: string
      if (!jsonDiffers) {
        mergedJson = tJson
      } else if (tJson === bJson) {
        mergedJson = mJson
      } else if (mJson === bJson) {
        mergedJson = tJson
      } else {
        const merged = mergeBoards(bJson, tJson, mJson)
        if (merged === null) continue
        mergedJson = compactInlineScene(merged.json).json
      }

      const mergedLine = mergeDrawingLine(b.drawingLine, t.drawingLine, m.drawingLine)
      replacements.set(i, { json: mergedJson, drawingLine: mergedLine })
    }

    if (replacements.size === 0) return [theirs, mine]
    return [rewriteBlocks(theirs, theirBlocks, replacements), rewriteBlocks(mine, myBlocks, replacements)]
  } catch {
    return [theirs, mine]
  }
}
