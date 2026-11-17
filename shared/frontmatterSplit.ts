/**
 * The frontmatter split and the key fold, with NO imports (YAZ-5509). The friends count worker
 * (`desktop/src/main/friends/countWorker.ts`) needs only these two, and reaching them through
 * `frontmatter.ts` or `propertyKeys.ts` pulled the whole `yaml` library into the worker (about 250 KB).
 * Keep this file free of imports. `frontmatter.ts` and `propertyKeys.ts` re-export from here, so
 * other callers do not change.
 *
 * A frontmatter block is: file starts with `---\n` (or `---\r\n`), followed by
 * any lines (possibly none — `---\n---\n` is the empty block a delete of the
 * last key leaves behind, GRO-2216), terminated by a line that is exactly
 * `---` (or `...`). A byte order mark before the first fence belongs to the block (YAZ-5512 C1): the block is read,
 * a writer keeps the BOM first, and the body is the same as on a page without one.
 */
export interface SplitMarkdown {
  /** The raw frontmatter block including both `---` fences and trailing newline; '' if none. */
  frontmatter: string
  /** Everything after the frontmatter block. */
  body: string
}

/**
 * The EMPTY block is tried FIRST (YAZ-5512 S1). With the "some lines" form first, `---\n---\n` followed later by any
 * `---` line (a thematic break, a card's back) was read as one block all the way to that later line, so every card
 * above it vanished, and a comment was refused or (in the Mac's merge) threw.
 */
const FM_RE = /^(\uFEFF?---\r?\n(?:(?:---|\.\.\.)[ \t]*(?:\r?\n|$)|[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)))/

export function splitFrontmatter(markdown: string): SplitMarkdown {
  const m = FM_RE.exec(markdown)
  if (!m) return { frontmatter: '', body: markdown }
  const frontmatter = m[1]
  return { frontmatter, body: markdown.slice(frontmatter.length) }
}

/** The form two keys are compared in: `Dessert Column`, ` dessert column ` and `DESSERT COLUMN` are one key. */
export const keyFold = (key: string): string => key.trim().toLowerCase()
