export const WIKI_LINK = /^\[\[([^\]|]+)(?:\|([^\]]*))?\]\]$/

/** `[[x]]` → `x`, otherwise unchanged. */
export function stripBrackets(s: string): string {
  const m = WIKI_LINK.exec(s)
  return m ? m[1] : s
}
