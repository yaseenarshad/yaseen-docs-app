/**
 * The Inbox menu's pure rules (YAZ-5415): ONE place for the Mac's cards menu (`CardInboxBar`, `NewCardsPicker`) and
 * the phone's review sheet, so the two read the same session the same way. No DOM, no desktop module: the phone's
 * build takes it. The Mac's files re-export each name, so nothing changes there.
 */
import type { CardRating } from '@shared/cardLine'
import type { CardFilter, CardReviewSession, NewCardFolder } from './useCardReview'

/**
 * YAZ-5321: the menu offers Up next only while some card of the vault is marked Up next, or while it is the filter
 * on show (its last card answered just now). The other filters always show.
 */
export const showsFilter = (id: CardFilter, session: Pick<CardReviewSession, 'upNext' | 'filter'>): boolean => id !== 'next' || session.upNext || session.filter === 'next'

/** The bar's parts (YAZ-5020): each run of the same answer as one part, so a long session draws a few boxes, not one per card. */
export function progressRuns(answered: readonly CardRating[]): { missed: boolean; count: number }[] {
  const runs: { missed: boolean; count: number }[] = []
  for (const rating of answered) {
    const missed = rating === 'again'
    const last = runs.at(-1)
    if (last !== undefined && last.missed === missed) last.count++
    else runs.push({ missed, count: 1 })
  }
  return runs
}

/** The pick's words: "Spanish", "Spanish, Geography"; empty for All folders. */
export const pickLabel = (picked: readonly Pick<NewCardFolder, 'label'>[]): string => picked.map((f) => f.label).join(', ')

/** Where today's new cards really come from (the coordinator note): the pick, or "All folders" with none or in the fallback. */
export const newCardsFrom = (session: Pick<CardReviewSession, 'newFrom' | 'newFallback'>): string => (session.newFrom.length === 0 || session.newFallback ? 'All folders' : pickLabel(session.newFrom))

/** `folder` lies under `ancestor` (root-relative paths). */
export const underFolder = (folder: string, ancestor: string): boolean => folder.startsWith(`${ancestor}/`)

/** The pick after a click on `folder`'s box: off when it was ticked, else on, in place of its subfolders. */
export function toggledPick(picked: readonly string[], folder: string): string[] {
  if (picked.includes(folder)) return picked.filter((f) => f !== folder)
  return [...picked.filter((f) => !underFolder(f, folder)), folder]
}

/**
 * A kind's menu count (YAZ-5042 round 2): "today / total" while the kind has a number a day ("10 / 48"), else the
 * count alone. `total` is null with no limit.
 */
export function kindCount(session: Pick<CardReviewSession, 'counts' | 'limited' | 'more'>, kind: 'new' | 'next'): { count: number; total: number | null } {
  const count = session.counts[kind]
  return { count, total: session.limited[kind] ? count + session.more[kind] : null }
}
