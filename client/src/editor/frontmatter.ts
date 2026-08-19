/**
 * Frontmatter handling rule (locked in GRO-1961):
 * Crepe/remark does not understand a leading YAML `---` block — it would render
 * it as a thematic break + paragraph and re-serialise it lossy. So the client
 * strips the leading frontmatter block BEFORE loading markdown into Crepe and
 * re-prepends it byte-identically on save.
 *
 * A frontmatter block is: file starts with `---\n` (or `---\r\n`), followed by
 * any lines, terminated by a line that is exactly `---` (or `...`).
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

export function joinFrontmatter(frontmatter: string, body: string): string {
  return frontmatter + body
}
