import { describe, expect, it } from 'vitest'
import type { AnswerBook } from '../answers/outbox'
import { eraseQuestion, unsentAnswers } from './eraseWords'

/**
 * B7 (decided by Yaseen's delegation, YAZ-5057): "Sign out and erase this phone" deletes nothing on GitHub. The ask
 * says so in plain words. Round 4 (YAZ-5342 … YAZ-5344): the loss first; short sentences, one idea each; a break
 * between "this phone" and "GitHub"; groups; a friends remove that is not done yet.
 */
const same = (text: string) => text
const ask = (o: Partial<Parameters<typeof eraseQuestion>[0]> = {}) => eraseQuestion({ unsent: 0, friends: false, removes: 0, unit: same, ...o })

describe('the words of the erase ask', () => {
  it('nothing waits, no friends: three short parts, this phone first, then GitHub', () => {
    expect(ask()).toEqual([
      'Erase this phone?',
      'This phone loses the pages and cards it keeps. It also loses your tokens and its settings.',
      'Nothing on GitHub is deleted. Your vaults stay there. To delete a vault, delete its repo on GitHub.',
    ])
  })

  it('the loss comes first: 3 answers, and 1 answer', () => {
    expect(ask({ unsent: 3 })[0]).toBe('Erase this phone? 3 answers are not sent yet. They will be lost.')
    expect(ask({ unsent: 1 })[0]).toBe('Erase this phone? 1 answer is not sent yet. It will be lost.')
  })

  it('YAZ-5342: with friends or groups, what stays on GitHub and the step for both', () => {
    expect(ask({ friends: true }).at(-1)).toBe(
      'Your friends list and your numbers stay on GitHub. Your friends and groups can still see your numbers. To stop that, remove each friend and leave each group in the Friends tab first.',
    )
  })

  it('YAZ-5343: a remove that is not done yet is named, with who can still see the numbers and the safe way', () => {
    expect(ask({ friends: true, removes: 1 })[0]).toBe('Erase this phone? 1 remove in Friends is not done yet. If you erase now, that friend or group can still see your numbers.')
    expect(ask({ friends: true, removes: 2, unsent: 3 })[0]).toBe(
      'Erase this phone? 3 answers are not sent yet. They will be lost. 2 removes in Friends are not done yet. If you erase now, those friends or groups can still see your numbers.',
    )
  })

  it('YAZ-5344: each sentence has 20 words at most; no "your token" or "your last numbers"', () => {
    const all = ask({ friends: true, removes: 2, unsent: 3 }).join(' ')
    for (const sentence of all.split(/(?<=[.?])\s+/)) expect([sentence, sentence.split(/\s+/).length <= 20]).toEqual([sentence, true])
    expect(all).not.toMatch(/your token\b|last numbers/)
  })

  it("the vault's word for page", () => {
    expect(eraseQuestion({ unsent: 0, friends: false, removes: 0, unit: (t) => t.replace('pages', 'docs') })[1]).toContain('the docs and cards it keeps')
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
