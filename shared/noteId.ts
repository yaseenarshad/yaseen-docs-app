/**
 * A notecard's permanent identity (YAZ-2293): the frontmatter `id`, minted once and never
 * derived from the file's name or place, so a rename or move by anything keeps every `[[id]]`
 * link and every `also_in` entry pointing at it.
 *
 * 🔒 D2: 12 characters of lowercase Crockford base32 (no `i l o u`) — 60 bits, because nothing
 * can check a fresh id against the other device's. Lowercase because link targets are resolved
 * case-insensitively. Always at least one digit, so no word a person might name a note is an id.
 */
export const NOTE_ID_KEY = 'id'

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'
const NOTE_ID_RE = /^(?=.*\d)[0-9a-hjkmnp-tv-z]{12}$/

/** A frontmatter `id` of any other shape is someone else's value: never an id, never overwritten. */
export const isNoteId = (value: unknown): value is string => typeof value === 'string' && NOTE_ID_RE.test(value)

/**
 * An id out of `draw`'s bytes: asked with nothing for the first 12 or more, then with the bytes
 * it last gave for the next — about 1% of draws are all letters and are drawn again, and so is
 * one that is `taken`.
 */
export function noteIdFrom(draw: (previous?: Uint8Array) => Uint8Array, taken: (id: string) => boolean = () => false): string {
  for (let bytes = draw(); ; bytes = draw(bytes)) {
    const id = Array.from(bytes.subarray(0, 12), (byte) => ALPHABET[byte & 31]).join('')
    if (isNoteId(id) && !taken(id)) return id
  }
}

/** A fresh random id, for a note being created. */
export const mintNoteId = (): string => noteIdFrom(() => crypto.getRandomValues(new Uint8Array(12)))
