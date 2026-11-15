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
 * `---` (or `...`).
 */
export interface SplitMarkdown {
  /** The raw frontmatter block including both `---` fences and trailing newline; '' if none. */
  frontmatter: string
  /** Everything after the frontmatter block. */
  body: string
}

const FM_RE = /^(---\r?\n(?:[\s\S]*?\r?\n)?(?:---|\.\.\.)[ \t]*(?:\r?\n|$))/

export function splitFrontmatter(markdown: string): SplitMarkdown {
  const m = FM_RE.exec(markdown)
  if (!m) return { frontmatter: '', body: markdown }
  const frontmatter = m[1]
  return { frontmatter, body: markdown.slice(frontmatter.length) }
}

/** The form two keys are compared in: `Dessert Column`, ` dessert column ` and `DESSERT COLUMN` are one key. */
export const keyFold = (key: string): string => key.trim().toLowerCase()
