/**
 * N8 (sweep1): the words typed in a page's comment box and not sent yet, by the page's path (phone memory only). The
 * box keeps them here as they are typed; the page reads them when the Mac deletes it, so it can stay open with them
 * and not drop them. In its own module so the page reads it without the comments' chunk.
 */
const drafts = new Map<string, string>()

/** The box of `path` holds `words` (blank: none). */
export function keepDraft(path: string, words: string): void {
  if (words.trim() === '') drafts.delete(path)
  else drafts.set(path, words)
}

/** Does the box of `path` hold words not sent? */
export const hasUnsentDraft = (path: string): boolean => drafts.has(path)
