/**
 * The vault's people file (YAZ-4615 D1): `<root>/.yaseendocs/people.json`, one CARD per person who
 * comments in the vault, so a teammate who syncs it sees each comment's name and picture. A comment
 * holds only the handle (`by`); the card holds the rest, so a new picture reaches every old comment.
 *
 * The app writes it, nobody edits it: your card goes in on your first comment in a vault, and is
 * updated when your profile changes. GitHub sync merges it card by card (`mergePeopleFile`): the
 * card with the newer `updated` wins. Pure: no fs, no React.
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

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A picture from a synced file is only a small data URL: never a remote address (a tracking pixel) nor megabytes. */
const isPicture = (v: unknown): boolean => v === null || (typeof v === 'string' && v.startsWith('data:image/') && v.length <= PROFILE_PICTURE_MAX)

const isCard = (v: unknown): v is PersonCard => isRecord(v) && typeof v.name === 'string' && isPicture(v.picture) && typeof v.updated === 'string'

/** The file's value as the app reads it: cards that are not cards are dropped; anything that is not the shape is none. */
export function parsePeople(value: unknown): PeopleConfig {
  if (!isRecord(value) || !isRecord(value.people)) return EMPTY_PEOPLE
  const people: Record<string, PersonCard> = {}
  for (const [handle, card] of Object.entries(value.people)) if (isCard(card)) people[handle] = { name: card.name, picture: card.picture, updated: card.updated }
  return { version: 1, people }
}

/** Your card as the profile says it, stamped `now`. */
export const cardOf = (profile: CommentProfile, now: string): PersonCard => ({ name: profile.name, picture: profile.picture, updated: now })

/** Whether the file's card for this profile already says what the profile says (the stamp aside). */
export const cardMatches = (card: PersonCard | undefined, profile: CommentProfile): boolean =>
  card !== undefined && card.name === profile.name && card.picture === profile.picture

/** The file with your card set; null when it already matches, so the caller writes nothing. */
export function withCard(config: PeopleConfig, profile: CommentProfile, now: string): PeopleConfig | null {
  if (cardMatches(config.people[profile.handle], profile)) return null
  return { version: 1, people: { ...config.people, [profile.handle]: cardOf(profile, now) } }
}

/** Newer `updated` wins; equal stamps keep `a` (the caller passes the side that wins ties first). */
const newer = (a: PersonCard | undefined, b: PersonCard | undefined): PersonCard | undefined => {
  if (a === undefined) return b
  if (b === undefined) return a
  return Date.parse(b.updated) > Date.parse(a.updated) ? b : a
}

/**
 * Sync's merge of two versions of the file (resolve.ts), or null when a side is not valid JSON —
 * then the pass stops as it does for any file it cannot settle. Per handle: a card only one side
 * changed keeps that change; a card both changed keeps the NEWER `updated` (a Mac with a wrong clock
 * can win a tie it should lose — the cost of no server). A card is never deleted by the app.
 */
export function mergePeopleFile(base: string | null, theirs: string, mine: string): string | null {
  const parse = (text: string): PeopleConfig | null => {
    try {
      return parsePeople(JSON.parse(text))
    } catch {
      return null
    }
  }
  const [b, t, m] = [base === null ? EMPTY_PEOPLE : parse(base), parse(theirs), parse(mine)]
  if (b === null || t === null || m === null) return null
  const people: Record<string, PersonCard> = {}
  for (const h of new Set([...Object.keys(t.people), ...Object.keys(m.people)])) {
    const [was, their, my] = [b.people[h], t.people[h], m.people[h]]
    const same = (x: PersonCard | undefined, y: PersonCard | undefined) => JSON.stringify(x) === JSON.stringify(y)
    const pick = same(my, was) ? their : same(their, was) ? my : newer(their, my)
    if (pick !== undefined) people[h] = pick
  }
  return `${JSON.stringify({ version: 1, people }, null, 2)}\n`
}
