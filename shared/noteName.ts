/**
 * A note's file name (YAZ-2420 🔒 D3): `<kebab-title>-<id>.md`, built from the note's `title` and
 * `id` and never typed. The title is free text in the frontmatter; the name is the part of it a
 * path can carry on any disk, shell or URL, and the id is what keeps two notes with one title apart.
 */

/** Short enough that the name fits a disk's 255-byte limit in any script, with the id and extension. */
const MAX_KEBAB = 60

/**
 * `title` as a path can carry it: lowercase, accents dropped, every run of anything that is not a
 * letter or a digit one hyphen, none at either end. Empty when the title has no letter or digit.
 * This is also a folder's name (🔒 D6), which carries no id.
 */
export function kebabTitle(title: string): string {
  const kebab = title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
  if (kebab.length <= MAX_KEBAB) return kebab
  // One character past the limit is read too: a hyphen there means the cut falls between words.
  const end = kebab.lastIndexOf('-', MAX_KEBAB)
  return kebab.slice(0, end === -1 ? MAX_KEBAB : end)
}

/** The file name of the note titled `title` whose id is `id`; the id alone when the title has no letter or digit. */
export function noteFileName(title: string, id: string): string {
  const kebab = kebabTitle(title)
  return `${kebab === '' ? '' : `${kebab}-`}${id}.md`
}
