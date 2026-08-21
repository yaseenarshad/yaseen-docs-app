import { parse } from 'yaml'

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
