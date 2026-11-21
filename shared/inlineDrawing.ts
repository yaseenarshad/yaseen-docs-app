/**
 * INLINE EXCALIDRAW DRAWINGS IN `.md` (YAZ-5040): pure parsing, formatting, and conversion between
 * an inline ```` ```excalidraw ```` block and a standalone `.excalidraw` embed `![[Name.excalidraw|…]]`.
 *
 * FORMAT ON DISK:
 *   ```excalidraw
 *   {"type":"excalidraw","version":2,"source":"yaseen-docs","elements":[...],"appState":{},"files":{}}
 *   ```
 *   <!-- drawing: 640x360 view=0,0,1 locked -->
 *
 * - Compact single-line JSON keeps `.md` files small and agent-readable.
 * - Pasted images always live in `<vault>/assets/` (`files: {}`), never base64 inside `.md`.
 * - The optional `<!-- drawing: … -->` line right under the closing fence stores `EmbedOptions`
 *   (`shared/embedOptions.ts`), so moving a drawing out to its own `.excalidraw` file keeps the
 *   exact window size, pan/zoom view, and lock state.
 * - Pure: no DOM, no Node, no engine import.
 */
import { EMPTY_SCENE, stripEmbeddedScene } from './drawingAssets'
import { formatEmbedOptions, newEmbed, parseEmbedOptions, type EmbedOptions } from './embedOptions'
import { closesFence, fenceOf, lineKinds } from './fences'
import { isRecord } from './guards'
import { inLineEnds, lineEnds } from './lineEnds'
import { splitFrontmatter } from './frontmatter'

/** The fence language of an inline Excalidraw drawing. */
export const DRAWING_LANGUAGE = 'excalidraw'

/** Soft size nudge threshold (150 KiB of compact scene JSON): warn and offer "Move to its own file". */
export const INLINE_DRAWING_WARN_BYTES = 150 * 1024

/** Compact empty Excalidraw scene for a new inline drawing block. */
export const EMPTY_INLINE_SCENE_JSON = JSON.stringify(EMPTY_SCENE)

/** Default drawing option line for a newly inserted inline drawing (starts locked, matching `newEmbed`). */
export const NEW_INLINE_DRAWING_LINE = '<!-- drawing: locked -->'

const DRAWING_LINE_RE = /^<!--\s*drawing:\s*(.*?)\s*-->$/
const TITLE_PREFIX_RE = /^title\s+"((?:\\.|[^"\\])*)"(?:\s*,\s*|\s*$)/

const EMPTY_EMBED_OPTIONS: EmbedOptions = { width: null, height: null, view: null, locked: false, page: null, rest: [] }

const unescapeTitle = (raw: string): string => raw.replace(/\\(["\\])/g, '$1')
const escapeTitle = (raw: string): string =>
  raw
    .replace(/[\r\n]+/g, ' ')
    .replace(/-->/g, '')
    .trim()
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')

/** Extracts the unescaped inline drawing title from `<!-- drawing: title "…", … -->`, or `''`. */
export function drawingTitleOf(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return ''
  const m = DRAWING_LINE_RE.exec(raw.trim())
  if (m === null) return ''
  const tm = TITLE_PREFIX_RE.exec(m[1]!)
  return tm === null ? '' : unescapeTitle(tm[1]!)
}

/** Parses `<!-- drawing: … -->` into `EmbedOptions` (stripping any leading `title "…"`), or null if invalid. */
export function parseDrawingLine(raw: string): EmbedOptions | null {
  const m = DRAWING_LINE_RE.exec(raw.trim())
  if (m === null || m[1] === '') return null
  const body = m[1]!
  const tm = TITLE_PREFIX_RE.exec(body)
  if (tm !== null) {
    const rest = body.slice(tm[0].length).trim()
    return rest === '' ? { ...EMPTY_EMBED_OPTIONS, rest: [] } : parseEmbedOptions(rest)
  }
  return parseEmbedOptions(body)
}

/** Formats `EmbedOptions` and optional `title` as `<!-- drawing: … -->`, or null when neither is set. */
export function formatDrawingLine(options: EmbedOptions | null, title?: string): string | null {
  const escaped = title === undefined ? '' : escapeTitle(title)
  const text = options === null ? '' : formatEmbedOptions(options)
  if (escaped === '' && text === '') return null
  if (escaped === '') return `<!-- drawing: ${text} -->`
  if (text === '') return `<!-- drawing: title "${escaped}" -->`
  return `<!-- drawing: title "${escaped}", ${text} -->`
}

/** Sets or clears `title "…"` on a `<!-- drawing: … -->` line while preserving all `EmbedOptions`. */
export function withDrawingTitle(raw: string | null | undefined, title: string): string | null {
  const opts = typeof raw === 'string' ? parseDrawingLine(raw) : null
  return formatDrawingLine(opts, title)
}

/** Validates a raw drawing option comment string (single-line `<!-- drawing: … -->`); returns trimmed string or null. */
export function cleanDrawingLine(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === '' || /[\r\n]/.test(trimmed)) return null
  return parseDrawingLine(trimmed) === null ? null : trimmed
}

/**
 * Strips any embedded `files` map and compacts a scene object into a single-line JSON string for `.md`.
 * Throws if `sceneText` is not a valid JSON object with an `elements` array.
 */
export function compactInlineScene(sceneText: string): { json: string; embeddedCount: number } {
  const parsed: unknown = JSON.parse(sceneText)
  if (!isRecord(parsed) || !Array.isArray(parsed.elements)) throw new Error('not an Excalidraw scene')
  const { lean, embedded } = stripEmbeddedScene(parsed)
  return { json: JSON.stringify(lean), embeddedCount: Object.keys(embedded).length }
}

/** Picks a backtick fence longer than any backtick run inside `body` so JSON strings never break the fence. */
export function safeFenceFor(body: string): string {
  let max = 2
  for (const m of body.matchAll(/`{3,}/g)) {
    if (m[0].length > max) max = m[0].length
  }
  return '`'.repeat(max + 1)
}

/** Builds a fenced ```` ```excalidraw ```` block with an optional `<!-- drawing: … -->` line right under it. */
export function inlineDrawingBlock(sceneJson: string, drawingLine?: string | null): string {
  const body = sceneJson.trim()
  const fence = safeFenceFor(body)
  const line = cleanDrawingLine(drawingLine)
  const block = `${fence}${DRAWING_LANGUAGE}\n${body}\n${fence}`
  return line === null ? block : `${block}\n${line}`
}

/** Indents every line of `block` by `indent`. */
function indentLines(block: string, indent: string): string {
  if (indent === '') return block
  return block
    .split('\n')
    .map((l) => (l === '' ? '' : `${indent}${l}`))
    .join('\n')
}

export interface InlineDrawingBlock {
  /** Line index of the opening fence in `body`. */
  open: number
  /** Line index of the closing fence in `body`. */
  close: number
  /** Line index of the `<!-- drawing: … -->` comment right under `close`, or null if absent. */
  lineAt: number | null
  /** Leading whitespace of the opening fence. */
  indent: string
  /** Raw JSON text inside the fence. */
  json: string
  /** Trimmed `<!-- drawing: … -->` text, or null. */
  drawingLine: string | null
}

const DRAWING_FENCE_RE = /^([ \t]*)(`{3,}|~{3,})[ \t]*excalidraw[ \t]*\r?$/

/** Finds all top-level ```` ```excalidraw ```` blocks in a Markdown body (skipping nested fences). */
export function findInlineDrawings(body: string): InlineDrawingBlock[] {
  const lines = body.split('\n')
  const out: InlineDrawingBlock[] = []
  let outerFence: string | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (outerFence !== null) {
      if (closesFence(line, outerFence)) outerFence = null
      continue
    }
    const dm = DRAWING_FENCE_RE.exec(line)
    if (dm !== null) {
      const indent = dm[1]!
      const fence = dm[2]!
      let close = lines.length - 1
      for (let j = i + 1; j < lines.length; j++) {
        if (closesFence(lines[j]!, fence)) {
          close = j
          break
        }
      }
      const json = lines.slice(i + 1, close).join('\n')
      const nextLine = lines[close + 1]
      const cleaned = nextLine !== undefined ? cleanDrawingLine(nextLine) : null
      const lineAt = cleaned !== null ? close + 1 : null
      out.push({ open: i, close, lineAt, indent, json, drawingLine: cleaned })
      i = lineAt ?? close
      continue
    }
    const f = fenceOf(line)
    if (f !== null) outerFence = f
  }
  return out
}

/**
 * MOVE TO ITS OWN FILE: replaces the `index`-th inline drawing block (0-based) in `content` with
 * `![[<target>|<options>]]` at the block's indent, keeping window size, view, and lock state.
 */
export function moveInlineDrawingOut(content: string, index: number, target: string): { page: string; json: string } {
  const { text, back } = lineEnds(content)
  const { frontmatter, body } = splitFrontmatter(text)
  const blocks = findInlineDrawings(body)
  const block = blocks[index]
  if (block === undefined) throw new Error(`inline drawing #${index} not found`)
  const options = block.drawingLine === null ? null : parseDrawingLine(block.drawingLine)
  const formatted = options === null ? '' : formatEmbedOptions(options)
  const embed = formatted === '' ? newEmbed(target) : `![[${target}|${formatted}]]`
  const lines = body.split('\n')
  const end = block.lineAt ?? block.close
  lines.splice(block.open, end - block.open + 1, `${block.indent}${embed}`)
  return { page: back(frontmatter + lines.join('\n')), json: block.json }
}

/**
 * Finds the line index of the `nth` lone embed `![[inner]]` (0-based) in `body`, outside code blocks.
 */
export function drawingEmbedLine(body: string, inner: string, nth: number): number {
  const wanted = `![[${inner}]]`
  const lines = body.split('\n')
  const kinds = lineKinds(lines)
  let seen = 0
  for (let i = 0; i < lines.length; i++) {
    if (kinds[i] !== 'text' || lines[i]!.trim() !== wanted) continue
    if (seen++ === nth) return i
  }
  return -1
}

/**
 * PUT BACK INTO THIS PAGE: replaces the `nth` lone embed `![[inner]]` in `page` with an inline
 * ```` ```excalidraw ```` block (compact JSON, `files: {}`) + `<!-- drawing: … -->` at the embed's indent.
 */
export function putDrawingBack(
  page: string,
  inner: string,
  nth: number,
  sceneText: string,
  optionsText: string | null,
  title?: string,
): string {
  const { json } = compactInlineScene(sceneText)
  const parsedOpts = optionsText === null ? null : parseEmbedOptions(optionsText)
  const drawingLine = formatDrawingLine(parsedOpts, title)
  const block = inlineDrawingBlock(json, drawingLine)
  return inLineEnds(page, (text) => {
    const { frontmatter, body } = splitFrontmatter(text)
    const at = drawingEmbedLine(body, inner, nth)
    if (at === -1) throw new Error('the drawing embed is no longer on its own line in this page')
    const lines = body.split('\n')
    const indent = /^[ \t]*/.exec(lines[at]!)![0]
    lines[at] = indentLines(block, indent)
    return frontmatter + lines.join('\n')
  })
}

/** UTF-8 byte length of a string (browser + Node safe, no Buffer dependency). */
export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).byteLength
}
