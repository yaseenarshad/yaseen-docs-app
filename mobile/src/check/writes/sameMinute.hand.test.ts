// YAZ-5620 (review audit items 4 and 23): the phone answers a card twice in one minute (✕, ✕: it came straight back)
// while the Mac changes that card line. After the Mac's merge both ✕ stay, and the phone's Undo of the second one
// (`unreview` nth 2) finds it and takes back only it.
import { describe, expect, it } from 'vitest'
import { cardRecords } from '@shared/cardLine'
import { applyOps } from '../../answers/ops'
import { macMerge } from './macMerge.testing'

const base = '```card\nQ\n```\n<!-- card: NC-1, 2026-10-01T08:00Z good -->\n'
const x = (seconds: number) => ({ at: '2026-11-15T15:39Z', rating: 'again' as const, seconds })

describe('YAZ-5620 same-minute ✕ ✕ from the phone', () => {
  const phone = applyOps(base, [{ kind: 'review', id: 'NC-1', review: x(4) }, { kind: 'review', id: 'NC-1', review: x(3), nth: 2 }]).content
  // The Mac answers the same card in the same minute (✓) on its side: a clash on the card line.
  const mac = base.replace('good -->', 'good, 2026-11-15T15:39Z good 2s -->')

  it.each([
    ['the phone is the remote side', () => macMerge(base, phone, mac)],
    ['the phone is the local side', () => macMerge(base, mac, phone)],
  ])('both ✕ and the Mac ✓ stay after the merge (%s), and a merge of the merge changes nothing', (_, merge) => {
    const out = merge()
    expect(out.copy).toBeUndefined()
    expect(cardRecords(out.text)[0].reviews.map((r) => (r.seconds === undefined ? r.rating : `${r.rating} ${r.seconds}`))).toEqual(expect.arrayContaining(['good', 'again 4', 'again 3', 'good 2']))
    expect(cardRecords(out.text)[0].reviews).toHaveLength(4)
    expect(macMerge(base, out.text, out.text).text).toBe(out.text)
  })

  it('the phone sends the same two ✕ again after the merge (a lost reply): nothing changes', () => {
    const out = macMerge(base, mac, phone)
    const again = applyOps(out.text, [{ kind: 'review', id: 'NC-1', review: x(4) }, { kind: 'review', id: 'NC-1', review: x(3), nth: 2 }])
    expect(again.content).toBe(out.text)
  })

  it.each([
    ['the phone is the remote side', () => macMerge(base, phone, mac)],
    ['the phone is the local side', () => macMerge(base, mac, phone)],
  ])('Undo of the second ✕ after the merge (%s) removes it, and only it', (_, merge) => {
    const out = merge()
    const undone = applyOps(out.text, [{ kind: 'unreview', id: 'NC-1', at: '2026-11-15T15:39Z', rating: 'again', nth: 2 }])
    expect(undone.lost).toEqual([])
    // It found the copy: the line changed (before YAZ-5620 the merge kept one ✕, and the undo found no 2nd copy).
    expect(undone.content).not.toBe(out.text)
    const left = cardRecords(undone.content)[0].reviews
    expect(left.filter((r) => r.rating === 'again').map((r) => r.seconds)).toEqual([4])
    expect(left).toHaveLength(3)
  })
})
