import { describe, expect, it } from 'vitest'
import type { AnswerBook } from '../answers/outbox'
import { eraseQuestion, unsentAnswers } from './eraseWords'

/**
 * B7 (decided by Yaseen's delegation, YAZ-5057): "Sign out and erase this phone" deletes nothing on GitHub. The ask
 * says so in plain words: what this phone loses, the answers that are not sent (with their count), what stays on
 * GitHub, and how to remove it.
 */
const same = (text: string) => text

describe('the words of the erase ask', () => {
  it('0 answers waiting, no friends', () => {
    expect(eraseQuestion({ unsent: 0, friends: false, unit: same })).toBe(
      'Erase this phone? This phone loses the pages and cards it keeps, your token and its settings. Nothing on GitHub is deleted: your vaults stay there. To delete a vault, delete its repo on GitHub.',
    )
  })

  it('3 answers waiting: their count, and that they will be lost', () => {
    expect(eraseQuestion({ unsent: 3, friends: false, unit: same })).toContain(' 3 answers are not sent yet and will be lost. ')
  })

  it('1 answer waiting', () => {
    expect(eraseQuestion({ unsent: 1, friends: false, unit: same })).toContain(' 1 answer is not sent yet and will be lost. ')
  })

  it('with friends: the friends list and the numbers stay on GitHub, friends still see the last numbers, and the step to stop it', () => {
    const words = eraseQuestion({ unsent: 3, friends: true, unit: same })
    expect(words).toContain('Your friends list and your numbers also stay on GitHub, and your friends still see your last numbers. To stop that, remove each friend in the Friends tab first.')
    expect(words).toContain('3 answers are not sent yet')
  })

  it("the vault's word for page", () => {
    expect(eraseQuestion({ unsent: 0, friends: false, unit: (t) => t.replace('pages', 'docs') })).toContain('the docs and cards it keeps')
  })
})

describe('the answers not sent, from the stored lists of every vault', () => {
  const book = (groups: number[]): AnswerBook => ({
    v: 1,
    next: 99,
    waiting: groups.map((group, i) => ({ seq: i + 1, group, op: { kind: 'next', id: `NC-${group}`, on: false }, path: 'a.md', title: 'T', madeAt: 0 })),
    lost: [],
  })

  it('counts answers (groups), not card actions; adds the vaults; ignores a list it cannot read', () => {
    expect(unsentAnswers([undefined])).toBe(0)
    expect(unsentAnswers([book([1, 1, 2])])).toBe(2)
    expect(unsentAnswers([book([1, 2]), book([5]), [{ id: 'X' }], null])).toBe(3)
  })
})
