/**
 * The Inbox menu's pure rules (YAZ-5415): ONE place for the Mac's cards menu (`CardInboxBar`, `NewCardsPicker`) and
 * the phone's review sheet, so the two read the same session the same way. No DOM, no desktop module: the phone's
 * build takes it. The Mac's files re-export each name, so nothing changes there.
 */
import type { CardFilter, CardReviewSession, NewCardFolder } from './useCardReview'

/**
 * YAZ-5321: the menu offers Up next only while some card of the vault is marked Up next, or while it is the filter
 * on show (its last card answered just now). The other filters always show.
 */
export const showsFilter = (id: CardFilter, session: Pick<CardReviewSession, 'upNext' | 'filter'>): boolean => id !== 'next' || session.upNext || session.filter === 'next'

/** The pick's words: "Spanish", "Spanish, Geography"; empty for All folders. */
export const pickLabel = (picked: readonly Pick<NewCardFolder, 'label'>[]): string => picked.map((f) => f.label).join(', ')

/** Where today's new cards really come from (the coordinator note): the pick, or "All folders" with none or in the fallback. */
export const newCardsFrom = (session: Pick<CardReviewSession, 'newFrom' | 'newFallback'>): string => (session.newFrom.length === 0 || session.newFallback ? 'All folders' : pickLabel(session.newFrom))

/**
 * The New cards row's quiet note (YAZ-5685): "New cards · Spanish" while a folder other than All folders gives today's
 * new cards; empty for All folders and in the fallback (they come from All folders then).
 */
export const newRowNote = (session: Pick<CardReviewSession, 'newFrom' | 'newFallback'>): string => (session.newFrom.length === 0 || session.newFallback ? '' : pickLabel(session.newFrom))

/** `folder` lies under `ancestor` (root-relative paths). */
export const underFolder = (folder: string, ancestor: string): boolean => folder.startsWith(`${ancestor}/`)

/** The pick after a click on `folder`'s box: off when it was ticked, else on, in place of its subfolders. */
export function toggledPick(picked: readonly string[], folder: string): string[] {
  if (picked.includes(folder)) return picked.filter((f) => f !== folder)
  return [...picked.filter((f) => !underFolder(f, folder)), folder]
}

/**
 * A kind's menu count, the Mac's cards menu and the phone's sheet alike (YAZ-5624): Up next reads "today / total"
 * while it has a number a day ("2 / 5", YAZ-5042 round 2), else the count alone. New cards' count stands alone ("10",
 * never "10 / 15": YAZ-5434, Yaseen's pick, the total made the row long). `total` is null when the count stands alone.
 */
export function kindCount(session: Pick<CardReviewSession, 'counts' | 'limited' | 'more'>, kind: 'new' | 'next'): { count: number; total: number | null } {
  const count = session.counts[kind]
  return { count, total: kind === 'next' && session.limited.next ? count + session.more.next : null }
}

/** A kind's count as its row says it: "2 / 5", or "10" alone (`kindCount`). */
export const kindCountText = ({ count, total }: { count: number; total: number | null }): string => (total === null ? String(count) : `${count} / ${total}`)
