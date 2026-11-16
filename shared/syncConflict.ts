/**
 * SYNC CONFLICT COPIES (YAZ-5056). GitHub AutoSync keeps both sides of a conflict: the file at its own path holds the
 * remote's version, and the local one is kept beside it as `<name> (conflict <host>, <YYYY-MM-DD>[ <n>])<ext>`
 * (`freeCopyName` in AutoSync's `git/resolve.ts`). The Docs app's own GitHub sync names its copy the same way with no
 * host, `<name> (conflict, <YYYY-MM-DD>[ <n>])<ext>` (`freeCopyName` in `desktop/src/main/git/resolve.ts`, YAZ-5089).
 * Both hold the same IDs. Such a copy never keeps an ID that another
 * file holds: the file at its own path does, so links keep opening it and a card keeps its history there. A space sorts
 * before a dot, so the copy comes FIRST in path order; this rule goes before every "first in path order". Pure.
 */

/** `<anything> (conflict[ <host>], <YYYY-MM-DD>[ <n>])` and an optional extension, at the end of a path. */
const CONFLICT_COPY_RE = / \(conflict(?: [^()/\\]+)?, \d{4}-\d{2}-\d{2}(?: \d+)?\)(?:\.[^./\\]+)?$/

/** Is the file at `p` (a path or a file name) a sync conflict copy, by its name? */
export const isSyncConflictCopy = (p: string): boolean => CONFLICT_COPY_RE.test(p)
