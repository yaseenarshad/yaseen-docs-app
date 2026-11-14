import { ANSWERS_STATE, type AnswerBook } from '../answers/outbox'
import type { UnitText } from '../app/unitWord'
import { loadQueue } from '../friends/removeQueue'
import type { VaultStore } from '../store'

/**
 * B7 (decided by Yaseen's delegation, YAZ-5057): "Sign out and erase this phone" deletes nothing on GitHub. The ask
 * says so in plain words: what this phone loses, the answers that are not sent yet (with their count), what stays on
 * GitHub, and how to remove it there.
 */
export function eraseQuestion({ unsent, friends, removes, unit }: { unsent: number; friends: boolean; removes: number; unit: UnitText }): string[] {
  // The loss first (YAZ-5344): what cannot come back, then this phone, then GitHub. One idea in each sentence.
  const first = ['Erase this phone?']
  if (unsent === 1) first.push('1 answer is not sent yet. It will be lost.')
  else if (unsent > 1) first.push(`${unsent} answers are not sent yet. They will be lost.`)
  // YAZ-5343: a friends remove that waits on the phone is lost too, and then the friend still reads the numbers.
  if (removes === 1) first.push('1 remove in Friends is not done yet. If you erase now, that friend or group can still see your numbers.')
  else if (removes > 1) first.push(`${removes} removes in Friends are not done yet. If you erase now, those friends or groups can still see your numbers.`)
  const parts = [first.join(' '), unit('This phone loses the pages and cards it keeps. It also loses your tokens and its settings.'), 'Nothing on GitHub is deleted. Your vaults stay there. To delete a vault, delete its repo on GitHub.']
  // YAZ-5342: a group reads the numbers too. The Mac can go on sending them, so "your numbers", not "your last numbers".
  if (friends) parts.push('Your friends list and your numbers stay on GitHub. Your friends and groups can still see your numbers. To stop that, remove each friend and leave each group in the Friends tab first.')
  return parts
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

/** YAZ-5343: the friends removes that wait on the phone (no signal, or GitHub's limit): the erase would drop them. */
export async function waitingRemoves(store: VaultStore): Promise<number> {
  return (await loadQueue(store).catch(() => [])).length
}
