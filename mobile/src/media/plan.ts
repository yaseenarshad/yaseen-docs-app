import { makeAssetResolver } from '@shared/assetLookup'
import { pageCards } from '@shared/cardLine'
import { cardDueAt, cardPlan, isCardDue, NOTHING_ADDED, type CardsAddedToday } from '@shared/cardSchedule'
import type { ReviewSettings } from '@shared/reviews'
import { MAX_FILE_BYTES, type IndexRecord } from '@shared/types'
import { MEDIA_AHEAD_DAYS } from '../sync/plan'
import { cardMediaPaths } from './refs'

/**
 * THE FILES THE NEXT DAYS NEED (YAZ-5074 3D, decision 6): the pictures and sounds of the cards due today or within
 * `MEDIA_AHEAD_DAYS`, plus the new cards that today's limit lets in. The due rule is the Mac's own (`cardPlan`,
 * `cardDueAt`, `isCardDue` in `shared/cardSchedule.ts`, 2A): no second copy.
 */

/**
 * The largest file that downloads AHEAD (10 MB). The nearest rule: the desktop's own size limit for a file
 * (`MAX_FILE_BYTES`, row F7). A larger picture or sound downloads only when it shows (`MediaAhead.show`), as October's
 * rule C1 does for all media. Decision 6's budget is "a few MB" for the whole window, so one file over 10 MB is not "ahead".
 */
export const MEDIA_AHEAD_MAX_BYTES = MAX_FILE_BYTES

/** The two day numbers that stay on this phone (decision 9): they widen today's Up next and new cards. */
export interface DayNumbers {
  upNextTaken?: readonly string[]
  added?: CardsAddedToday
}

export interface AheadCard {
  /** The file that HOLDS the card (a page or a card file), not a page that embeds it. */
  path: string
  /** Its place among the file's cards. */
  index: number
  id: string
}

export interface AheadOptions extends DayNumbers {
  /** The vault's ID letters (`ids.json`), for the order of new cards, as the Mac's queue. */
  letters?: readonly string[]
  /** Default `MEDIA_AHEAD_DAYS`. */
  days?: number
}

/** `now` moved on `days` local calendar days (a day with a clock change is still one day). */
function laterDay(now: number, days: number): number {
  const d = new Date(now)
  d.setDate(d.getDate() + days)
  return d.getTime()
}

/**
 * The cards of the window: today's queue (Up next, due, and the new cards up to the day limit: `cardPlan`), then each
 * card in review that is due before local midnight at the end of the day `days` days from today. Due in 7 days is in;
 * in 8 days is out. The window moves at local midnight. Each card once, by holder and place.
 */
export function cardsAhead(records: Readonly<Record<string, IndexRecord>>, settings: ReviewSettings, now: number, options: AheadOptions = {}): AheadCard[] {
  if (!settings.enabled) return []
  const pages = Object.values(records)
  const out: AheadCard[] = []
  const seen = new Set<string>()
  const add = (path: string, index: number, id: string) => {
    const key = `${path}\n${index}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ path, index, id })
  }
  for (const c of cardPlan(pages, settings, now, '', undefined, options.letters, options.upNextTaken ?? [], options.added ?? NOTHING_ADDED).queue) add(c.path, c.index, c.id)
  const horizon = laterDay(now, options.days ?? MEDIA_AHEAD_DAYS)
  for (const r of pages) {
    r.cards?.forEach((card, index) => {
      if (card.off || card.id === null || card.reviews.length === 0) return
      // `isCardDue` at the window's last day: due before its local midnight. A new card's due is NaN: never here.
      if (isCardDue(cardDueAt(card.reviews, settings), horizon)) add(r.path, index, card.id)
    })
  }
  return out
}

export interface AheadInput extends AheadOptions {
  /** The open vault's index (`PhoneIndex.records`). */
  records: Readonly<Record<string, IndexRecord>>
  /** The stored text of a page or card file, or null when it is not stored. */
  read: (path: string) => Promise<string | null>
  /** Every file of the vault at the checkpoint, with its size in bytes when known (the tree's `size`). Unknown: too large. */
  sizes: ReadonlyMap<string, number | undefined>
  settings: ReviewSettings
  now: number
  /** Called after each holder file: gives the UI thread back (3B's shared slicer). */
  slice?: () => Promise<void>
  /** Default `MEDIA_AHEAD_MAX_BYTES`. */
  maxBytes?: number
}

export interface AheadPlan {
  /** The files to keep on the phone, in path order, each once. */
  wanted: string[]
  /** Files the window needs that are over `maxBytes`: they download when they show. */
  tooLarge: string[]
  /** The cards of the window. */
  cards: number
}

/**
 * The files of the window: for each card, its holder's stored text, the card's block (checked by its ID: a stale index
 * or a file not stored yet is skipped), its pictures and sounds (`cardMediaPaths`, from the holder's folder).
 */
export async function aheadPlan(input: AheadInput): Promise<AheadPlan> {
  // The due date of each card first, a file at a time with a slice after each: the shared due cache (keyed by the
  // settings object and the review log) then answers `cardPlan` at once. Without this, `cardPlan` replayed 1,000
  // cards' reviews in one go (measured: 20 to 27 ms on a Mac, more on a phone).
  if (input.settings.enabled)
    for (const r of Object.values(input.records)) {
      if (r.cards === undefined || r.cards.length === 0) continue
      for (const card of r.cards) if (card.reviews.length > 0) cardDueAt(card.reviews, input.settings)
      await input.slice?.()
    }
  const cards = cardsAhead(input.records, input.settings, input.now, input)
  await input.slice?.()
  const resolve = makeAssetResolver([...input.sizes.keys()])
  await input.slice?.()
  const maxBytes = input.maxBytes ?? MEDIA_AHEAD_MAX_BYTES
  const byHolder = new Map<string, AheadCard[]>()
  for (const c of cards) byHolder.set(c.path, [...(byHolder.get(c.path) ?? []), c])
  const wanted = new Set<string>()
  const tooLarge = new Set<string>()
  for (const [holder, list] of byHolder) {
    const text = await input.read(holder)
    if (text !== null) {
      const blocks = pageCards(text)
      for (const c of list) {
        const block = blocks[c.index]
        if (block === undefined) continue
        const id = block.line.parts.find((p) => p.kind === 'id')
        if (id === undefined || id.kind !== 'id' || id.id.toLowerCase() !== c.id.toLowerCase()) continue
        for (const path of cardMediaPaths(block.text, holder, resolve)) {
          // An unknown size counts as too large (YAZ-5187): never a large file ahead by mistake; it downloads when it shows.
          const size = input.sizes.get(path)
          if (size === undefined || size > maxBytes) tooLarge.add(path)
          else wanted.add(path)
        }
        // After each card: reading a card's Markdown is the plan's one real cost (measured: up to ~5 ms a card).
        await input.slice?.()
      }
    }
    await input.slice?.()
  }
  return { wanted: [...wanted].sort(), tooLarge: [...tooLarge].sort(), cards: cards.length }
}
