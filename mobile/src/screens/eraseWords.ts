import { ANSWERS_STATE, type AnswerBook } from '../answers/outbox'
import type { UnitText } from '../app/unitWord'
import type { VaultStore } from '../store'

/**
 * B7 (decided by Yaseen's delegation, YAZ-5057): "Sign out and erase this phone" deletes nothing on GitHub. The ask
 * says so in plain words: what this phone loses, the answers that are not sent yet (with their count), what stays on
 * GitHub, and how to remove it there.
 */
export function eraseQuestion({ unsent, friends, unit }: { unsent: number; friends: boolean; unit: UnitText }): string {
  const parts = ['Erase this phone?', unit('This phone loses the pages and cards it keeps, your token and its settings.')]
  if (unsent > 0) parts.push(unsent === 1 ? '1 answer is not sent yet and will be lost.' : `${unsent} answers are not sent yet and will be lost.`)
  parts.push('Nothing on GitHub is deleted: your vaults stay there. To delete a vault, delete its repo on GitHub.')
  if (friends) parts.push('Your friends list and your numbers also stay on GitHub, and your friends still see your last numbers. To stop that, remove each friend in the Friends tab first.')
  return parts.join(' ')
}

/** The answers not sent yet in the stored answer lists (3C's `AnswerBook`): one person action (a group) is one answer. */
export function unsentAnswers(books: readonly unknown[]): number {
  let n = 0
  for (const book of books) {
    const b = book as Partial<AnswerBook> | null | undefined
    if (b?.v !== 1 || !Array.isArray(b.waiting)) continue
    n += new Set(b.waiting.map((w) => w.group)).size
  }
  return n
}

/** The answers not sent yet in every vault on this phone (the erase removes them all). */
export async function unsentOnPhone(store: VaultStore, vaults: readonly string[]): Promise<number> {
  const books = await Promise.all(vaults.map((v) => store.getState<unknown>(v, ANSWERS_STATE).catch(() => undefined)))
  return unsentAnswers(books)
}
