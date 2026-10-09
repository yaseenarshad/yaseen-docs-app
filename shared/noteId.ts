/**
 * A note's permanent identity (YAZ-2293): the frontmatter `id`, given once and never
 * derived from the file's name or place, so a rename or move by anything keeps every `[[id]]`
 * link and every `also_in` entry pointing at it.
 *
 * 🔒 YAZ-2677 D3: an ID is the vault's letters, a hyphen and a number — `YAZ-12` — and the NUMBER
 * is the real ID: the next one of the vault, given by the one door in the main process
 * (`vaultIndex/mint.ts`). Read in any case, written and indexed with capital letters (R1, R2).
 *
 * 🔒 The OLD shape (YAZ-2293 D2) is still an ID and is never written again (R3): 12 characters of
 * lowercase Crockford base32 (no `i l o u`), always at least one digit, so no word a person might
 * name a note is one. It has no letters and no number, and is an ID of whatever vault holds it.
 */
export const NOTE_ID_KEY = 'id'

const OLD_ID_RE = /^(?=.*\d)[0-9a-hjkmnp-tv-z]{12}$/
/** 15 digits at most: every such number is one JavaScript counts exactly, so the next one is never wrong. */
const NUMBER_ID_RE = /^([A-Za-z]{2,5})-([1-9]\d{0,14})$/

/** An old ID (R3): the 12-character shape. "Give old IDs numbers" gives each one a number (🔒 D6). */
export const isOldId = (value: unknown): value is string => typeof value === 'string' && OLD_ID_RE.test(value)

/** A number ID of ANY vault, in any case (R1). Whether it is one of THIS vault is `vaultNoteId`'s to say. */
export const isNumberId = (value: unknown): value is string => typeof value === 'string' && NUMBER_ID_RE.test(value)

/**
 * An ID by its shape alone, old or number. A frontmatter `id` of any other shape is another tool's:
 * never an id, and the app writes its own over it (YAZ-2420 🔒 D30). Where the vault is known, ask
 * `vaultNoteId`: other `LETTERS-NUMBER` text is a name there (R5, R6).
 */
export const isNoteId = (value: unknown): value is string => isOldId(value) || isNumberId(value)

/** `letters` and `number` as the app writes an ID (R2). */
export const numberId = (letters: string, number: number): string => `${letters}-${number}`

/** `id` as the app writes and indexes it (R2): a number ID with capital letters, an old ID as it is. */
export function canonicalNoteId(id: string): string {
  const dash = id.indexOf('-')
  return dash === -1 ? id : id.slice(0, dash).toUpperCase() + id.slice(dash)
}

/** The number of a number ID; undefined for an old ID and for anything that is no ID (S20: an old ID never counts). */
export function noteIdNumber(value: unknown): number | undefined {
  const m = typeof value === 'string' ? NUMBER_ID_RE.exec(value) : null
  return m === null ? undefined : Number(m[2])
}

/**
 * The ID of THIS vault that `value` is (R5), as the app writes it; undefined when it is none.
 * `letters` are the vault's ID letters in capitals, the current ones first and then each it had
 * before (`was`, R9). A number ID with the current letters is itself; one with letters of before
 * reads with the current ones — a number is used one time in a vault, whatever the letters (R4);
 * one with any other letters is a name, or another tool's `id` (R6, R7). An old ID is an ID of
 * every vault (R3).
 */
export function vaultNoteId(value: unknown, letters: readonly string[]): string | undefined {
  if (typeof value !== 'string') return undefined
  const m = NUMBER_ID_RE.exec(value)
  if (m === null) return OLD_ID_RE.test(value) ? value : undefined
  return letters.includes(m[1].toUpperCase()) ? `${letters[0]}-${m[2]}` : undefined
}

/** Is `value` an ID the door of this vault could have given: a number ID as written, with the CURRENT letters? */
export const isVaultNumberId = (value: unknown, letters: readonly string[]): value is string =>
  isNumberId(value) && letters.length > 0 && value.startsWith(`${letters[0]}-`)

/**
 * What a search text holds that can be an ID (🔒 D9), read ONE time for a query: the answer tests
 * one note's `id` (as the index holds it) with no parsing left to do, and is null when the text can
 * hold none, so a search by title costs nothing more. `was` are the letters the note's vault had before.
 *
 * `12`, `YAZ-12`, `yaz-12`, `yaz12` and `yaz 12` all hold `YAZ-12`, and an ID is held whole: none
 * holds `YAZ-1` or `YAZ-120`. A bare number is the WHOLE text, and finds that number whatever the
 * letters; an ID with its letters is held anywhere in the text — a link, a file name, a whole path
 * (YAZ-2420 🔒 D32) — where letters that end a longer word are not an ID's. An old ID is held
 * anywhere in the text, as it always was.
 */
export function holdsId(text: string): ((id: string, was?: readonly string[]) => boolean) | null {
  const lower = text.toLowerCase()
  const trimmed = lower.trim()
  const bare = /^[1-9]\d{0,14}$/.test(trimmed) ? trimmed : undefined
  /** The digits of each ID in the text, to the letters it is written with there. */
  const written = new Map<string, string[]>()
  for (const m of lower.matchAll(/(?<![a-z0-9])([a-z]{2,5})[- ]?([1-9]\d{0,14})(?![a-z0-9])/g)) written.set(m[2], [...(written.get(m[2]) ?? []), m[1].toUpperCase()])
  const old = /[0-9a-hjkmnp-tv-z]{12}/.test(lower)
  if (bare === undefined && written.size === 0 && !old) return null
  return (id, was) => {
    const dash = id.indexOf('-')
    if (dash === -1) return old && lower.includes(id)
    const digits = id.slice(dash + 1)
    if (digits === bare) return true
    const letters = written.get(digits)
    return letters !== undefined && letters.some((typed) => id.startsWith(`${typed}-`) || was?.includes(typed) === true)
  }
}

/**
 * The letters of a vault that has none in its `IDS_FILE` (R11): the first three letters A to Z of
 * its folder's name, in capitals, and `DOC` when the name has fewer than two.
 */
export function defaultIdLetters(vaultName: string): string {
  const letters = vaultName.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3)
  return letters.length < 2 ? 'DOC' : letters
}

/** A vault's ID letters (YAZ-2677): 2 to 5 of A to Z, in any case. */
export const isIdLetters = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z]{2,5}$/.test(value)

/**
 * The ID letters in a parsed `IDS_FILE` (R9), in capitals: `letters`, then each entry of `was` —
 * the list `vaultNoteId` reads an ID with. `saved` is false when the file holds no valid `letters`
 * and the default of the vault's folder name stands in (R11): the door saves it with the first number.
 */
export function idLettersOf(config: unknown, vaultName: string): { letters: string[]; saved: boolean } {
  const { letters: held, was } = (config ?? {}) as { letters?: unknown; was?: unknown }
  const saved = isIdLetters(held)
  const letters = [saved ? held.toUpperCase() : defaultIdLetters(vaultName)]
  for (const entry of Array.isArray(was) ? was : []) {
    const before = isIdLetters(entry) ? entry.toUpperCase() : undefined
    if (before !== undefined && !letters.includes(before)) letters.push(before)
  }
  return { letters, saved }
}

/** The vault config file holding a vault's answer to "do this vault's notes get IDs?" (YAZ-2523 🔒 V1). */
export const IDS_FILE = 'ids.json'

/** The answer in a parsed `IDS_FILE`: its `enabled` boolean. Anything else, a missing file too, is not answered. */
export function idsAnswer(config: unknown): boolean | undefined {
  const enabled = (config as { enabled?: unknown } | null | undefined)?.enabled
  return typeof enabled === 'boolean' ? enabled : undefined
}
