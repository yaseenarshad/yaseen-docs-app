/**
 * A note's file name (YAZ-2420 🔒 D3): `<kebab-title>-<id>.md`, built from the note's `title` and
 * `id` and never typed. The title is free text in the frontmatter; the name is the part of it a
 * path can carry on any disk, shell or URL, and the id is what keeps two notes with one title apart.
 */

/** The frontmatter key a note's (and, in its `.folder.md`, a folder's) title is stored under (🔒 D2). */
export const TITLE_KEY = 'title'

/**
 * A record's title (🔒 D14): its frontmatter `title`, trimmed — a number is the text someone wrote
 * without quotes — else `fallback`, the file's name without its extension or a folder's own name.
 */
export function titleOf(properties: Record<string, unknown>, fallback: string): string {
  const value = properties[TITLE_KEY]
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : ''
  return text === '' ? fallback : text
}

/** Short enough that the name fits a disk's 255-byte limit in any script, with the id and extension. */
const MAX_KEBAB = 60

/**
 * `title` as a path can carry it: lowercase, accents dropped, every run of anything that is not a
 * letter or a digit one hyphen, none at either end. Empty when the title has no letter or digit.
 * The underscores a title STARTS with are kept in front: they hold a note at the top of a list
 * sorted by name, and the sidebar sorts by file name (🔒 D15). This is also a folder's name
 * (🔒 D6), which carries no id.
 */
export function kebabTitle(title: string): string {
  const kebab = title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
  if (kebab === '') return ''
  const lead = title.trimStart().replace(/[^_][\s\S]*$/, '')
  if (kebab.length <= MAX_KEBAB) return lead + kebab
  // One character past the limit is read too: a hyphen there means the cut falls between words.
  const end = kebab.lastIndexOf('-', MAX_KEBAB)
  return lead + kebab.slice(0, end === -1 ? MAX_KEBAB : end)
}

/** The file name of the note titled `title` whose id is `id`; the id alone when the title has no letter or digit. */
export function noteFileName(title: string, id: string): string {
  const kebab = kebabTitle(title)
  return `${kebab === '' ? '' : `${kebab}-`}${id}.md`
}
