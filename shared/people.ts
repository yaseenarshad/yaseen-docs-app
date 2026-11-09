/**
 * The vault's people file (YAZ-4615 D1): `<root>/.yaseendocs/people.json`, one CARD per person who
 * comments in the vault, so a teammate who syncs it sees each comment's name and picture. A comment
 * holds only the handle (`by`); the card holds the rest, so a new picture reaches every old comment.
 *
 * The app writes it, nobody edits it: your card goes in on your first comment in a vault, and is
 * updated when your profile changes. GitHub sync merges it card by card (`mergePeopleFile`): the
 * card with the newer `updated` wins. The writes work on the file as it is (`withCard`, the merge):
 * a card this version cannot read — a newer app's shape — is kept as it is, never dropped.
 *
 * Size: one card per person who commented; a picture is at most `PROFILE_PICTURE_MAX` (a 96 px WebP
 * is a few KB). The app shows at most `PEOPLE_MAX` cards; the rest show initials. Pure: no fs, no React.
 */
import { PROFILE_PICTURE_MAX, type CommentProfile } from './types'

export const PEOPLE_FILE = 'people.json'

export interface PersonCard {
  name: string
  /** A small WebP data URL, or null for initials. */
  picture: string | null
  /** ISO UTC; the newer card wins a merge. */
  updated: string
}

export interface PeopleConfig {
  version: 1
  people: Record<string, PersonCard>
}

export const EMPTY_PEOPLE: PeopleConfig = { version: 1, people: {} }

/** The cards the app reads; a vault with more shows initials for the rest (a limit on what grows). */
export const PEOPLE_MAX = 1000

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A picture from a synced file is only a small data URL: never a remote address (a tracking pixel) nor megabytes. */
const isPicture = (v: unknown): boolean => v === null || (typeof v === 'string' && v.startsWith('data:image/') && v.length <= PROFILE_PICTURE_MAX)

const isCard = (v: unknown): v is PersonCard => isRecord(v) && typeof v.name === 'string' && isPicture(v.picture) && typeof v.updated === 'string'

/** The file's value as the app reads it: cards that are not cards are dropped; anything that is not the shape is none. */
export function parsePeople(value: unknown): PeopleConfig {
  if (!isRecord(value) || !isRecord(value.people)) return EMPTY_PEOPLE
  const people: Record<string, PersonCard> = {}
  let n = 0
  for (const [handle, card] of Object.entries(value.people)) {
    if (n >= PEOPLE_MAX) break
    if (isCard(card)) (people[handle] = { name: card.name, picture: card.picture, updated: card.updated }), (n += 1)
  }
  return { version: 1, people }
}

/** Every entry of the file as it is, readable or not: what a write builds on. */
const rawPeople = (value: unknown): Record<string, unknown> => (isRecord(value) && isRecord(value.people) ? value.people : {})

/** Your card as the profile says it, stamped `now`. */
export const cardOf = (profile: CommentProfile, now: string): PersonCard => ({ name: profile.name, picture: profile.picture, updated: now })

/** Whether the file's card for this profile already says what the profile says (the stamp aside). */
export const cardMatches = (card: PersonCard | undefined, profile: CommentProfile): boolean =>
  card !== undefined && card.name === profile.name && card.picture === profile.picture

/**
 * The file (its value as read) with your card set, every other entry kept as it is; null when your
 * card already matches, so the caller writes nothing.
 */
export function withCard(file: unknown, profile: CommentProfile, now: string): PeopleConfig | null {
  const mine = parsePeople({ people: { [profile.handle]: rawPeople(file)[profile.handle] } }).people[profile.handle]
  if (cardMatches(mine, profile)) return null
  return { version: 1, people: { ...(rawPeople(file) as Record<string, PersonCard>), [profile.handle]: cardOf(profile, now) } }
}

const stamp = (card: unknown): number => (isRecord(card) && typeof card.updated === 'string' ? Date.parse(card.updated) : Number.NaN)

/** Newer `updated` wins; equal or unreadable stamps keep `a` (the caller passes the side that wins ties first). */
const newer = (a: unknown, b: unknown): unknown => {
  if (a === undefined) return b
  if (b === undefined) return a
  return stamp(b) > stamp(a) ? b : a
}

/**
 * Sync's merge of two versions of the file (resolve.ts), or null when a side is not valid JSON —
 * then the pass stops as it does for any file it cannot settle. Per handle: a card only one side
 * changed keeps that change; a card both changed keeps the NEWER `updated` (a Mac with a wrong clock
 * can win a tie it should lose — the cost of no server). A card is never deleted by the app.
 */
export function mergePeopleFile(base: string | null, theirs: string, mine: string): string | null {
  const parse = (text: string): Record<string, unknown> | null => {
    try {
      return rawPeople(JSON.parse(text))
    } catch {
      return null
    }
  }
  const [b, t, m] = [base === null ? {} : parse(base), parse(theirs), parse(mine)]
  if (b === null || t === null || m === null) return null
  const people: Record<string, unknown> = {}
  for (const h of new Set([...Object.keys(t), ...Object.keys(m)])) {
    const [was, their, my] = [b[h], t[h], m[h]]
    const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y)
    const pick = same(my, was) ? their : same(their, was) ? my : newer(their, my)
    if (pick !== undefined) people[h] = pick
  }
  return `${JSON.stringify({ version: 1, people }, null, 2)}\n`
}
