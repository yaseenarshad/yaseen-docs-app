import { type Document, isMap, parse, parseDocument } from 'yaml'

/**
 * Frontmatter handling rule (locked in GRO-1961):
 * Crepe/remark does not understand a leading YAML `---` block — it would render
 * it as a thematic break + paragraph and re-serialise it lossy. So the client
 * strips the leading frontmatter block BEFORE loading markdown into Crepe and
 * re-prepends it byte-identically on save (`frontmatter + body`).
 *
 * A frontmatter block is: file starts with `---\n` (or `---\r\n`), followed by
 * any lines, terminated by a line that is exactly `---` (or `...`).
 *
 * Shared with the server's Bases index (GRO-2127), which parses the block via `parseFrontmatter`.
 */
export interface SplitMarkdown {
  /** The raw frontmatter block including both `---` fences and trailing newline; '' if none. */
  frontmatter: string
  /** Everything after the frontmatter block. */
  body: string
}

const FM_RE = /^(---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$))/

export function splitFrontmatter(markdown: string): SplitMarkdown {
  const m = FM_RE.exec(markdown)
  if (!m) return { frontmatter: '', body: markdown }
  const frontmatter = m[1]
  return { frontmatter, body: markdown.slice(frontmatter.length) }
}

const OPEN_FENCE_RE = /^---[ \t]*\r?\n/
const CLOSE_FENCE_RE = /(?:^|\r?\n)(?:---|\.\.\.)[ \t]*(?:\r?\n)?$/

/**
 * Parses a `splitFrontmatter().frontmatter` block (fences included) with yaml's default core
 * schema, so dates stay strings and only the 1.2 core scalars (null/bool/int/float) are typed.
 * Non-map documents and YAML errors yield `{}` plus a one-line `error` (GRO-2127).
 */
export function parseFrontmatter(frontmatter: string): { properties: Record<string, unknown>; error?: string } {
  const yaml = frontmatter.replace(OPEN_FENCE_RE, '').replace(CLOSE_FENCE_RE, '')
  let value: unknown
  try {
    value = parse(yaml, { prettyErrors: false })
  } catch (err) {
    return { properties: {}, error: err instanceof Error ? err.message : String(err) }
  }
  if (value === null || value === undefined) return { properties: {} }
  if (typeof value !== 'object' || Array.isArray(value)) return { properties: {}, error: 'frontmatter is not a map' }
  return { properties: value as Record<string, unknown> }
}

/** Thrown instead of writing when a note's frontmatter is not valid YAML, or is not a map (GRO-2141). */
export class FrontmatterWriteError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FrontmatterWriteError'
  }
}

/**
 * `---\n---\n`: the empty block left behind when the last key is deleted. `FM_RE` needs a
 * line between the fences, so it does not match — recognised here so a second write lands
 * inside the block instead of prepending another one (GRO-2141).
 */
const EMPTY_BLOCK_RE = /^---[ \t]*\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/
/** Captures the closing fence so `...` survives a rewrite. */
const TERMINATOR_RE = /(?:^|\r?\n)(---|\.\.\.)[ \t]*(?:\r?\n)?$/

/** Same options as `serializeBase`: no folding, no `[ 1, 2 ]` padding. */
const YAML_OUT = { lineWidth: 0, flowCollectionPadding: false } as const

/**
 * Set (or delete, when `value === undefined`) ONE frontmatter key in a whole file's
 * content, touching nothing else: comments, key order, quoting style and the body
 * are preserved byte-for-byte (GRO-2141, ruling D4).
 *
 * Values go in as YAML natively (strings, numbers, booleans, null, arrays, plain objects);
 * a `Date` is out of scope — callers pass ISO strings.
 */
export function setFrontmatterProperty(content: string, key: string, value: unknown): string {
  const { frontmatter, body } = splitBlock(content)

  if (frontmatter === '') {
    if (value === undefined) return content
    const doc = parseDocument('')
    doc.setIn([key], value)
    return `---\n${doc.toString(YAML_OUT)}---\n${body}`
  }

  const eol = frontmatter.includes('\r\n') ? '\r\n' : '\n'
  const terminator = TERMINATOR_RE.exec(frontmatter)?.[1] ?? '---'
  const trailingEol = /\r?\n$/.test(frontmatter) ? eol : ''

  const doc = parseDocument(frontmatter.replace(OPEN_FENCE_RE, '').replace(CLOSE_FENCE_RE, ''))
  const err = doc.errors[0]
  if (err) throw new FrontmatterWriteError(`frontmatter is not valid YAML: ${err.message}`)
  if (doc.contents !== null && !isMap(doc.contents)) throw new FrontmatterWriteError('frontmatter is not a map')

  if (value === undefined) {
    if (!doc.hasIn([key])) return content
    doc.deleteIn([key])
  } else {
    doc.setIn([key], value)
  }

  const yaml = serializeInner(doc)
  return `---${eol}${eol === '\r\n' ? yaml.replace(/\n/g, '\r\n') : yaml}${terminator}${trailingEol}${body}`
}

/** `splitFrontmatter`, plus the empty `---\n---\n` block it does not recognise. */
function splitBlock(content: string): SplitMarkdown {
  const split = splitFrontmatter(content)
  if (split.frontmatter !== '') return split
  const m = EMPTY_BLOCK_RE.exec(content)
  if (!m) return split
  return { frontmatter: m[0], body: content.slice(m[0].length) }
}

/** An emptied map serialises as `{}`; we want the block to just be empty instead. */
function serializeInner(doc: Document): string {
  if (isMap(doc.contents) && doc.contents.items.length === 0) return ''
  return doc.toString(YAML_OUT)
}
