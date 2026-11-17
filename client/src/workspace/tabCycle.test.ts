import { describe, expect, it } from 'vitest'
import { cycleStop } from './tabCycle'

// ⌃Tab / ⌃⇧Tab (rule 9, YAZ-5373): the next or previous tab in the strip as it shows, wrapping around — the Inbox tab is one
// of them, where it stands, and ⌃Tab from it goes to the tab right after it, never to the one after the page tab behind it.
describe('cycleStop', () => {
  const abcd = ['a', 'b', 'c', 'd']
  const tab = (id: string) => ({ tab: id })
  const INBOX = { inbox: true } as const

  it('page tabs alone: next and previous in order, wrapping both ways', () => {
    expect(cycleStop(abcd, 'b', false, null, 1)).toEqual(tab('c'))
    expect(cycleStop(abcd, 'd', false, null, 1)).toEqual(tab('a'))
    expect(cycleStop(abcd, 'a', false, null, -1)).toEqual(tab('d'))
  })

  it('from the Inbox tab: the tab right after it, the tab right before it — whichever page tab is behind it', () => {
    // The strip: a b [Inbox] c d, the Inbox on show over d (the page tab that was active).
    const inbox = { at: 2, front: true }
    expect(cycleStop(abcd, 'd', false, inbox, 1)).toEqual(tab('c'))
    expect(cycleStop(abcd, 'd', false, inbox, -1)).toEqual(tab('b'))
    // ⌘↵ opened the card's page right after the Inbox (YAZ-5023): ⌃Tab goes there.
    expect(cycleStop(['a', 'b', 'card', 'c', 'd'], 'a', false, inbox, 1)).toEqual(tab('card'))
  })

  it('the Inbox tab is a stop of the cycle from its neighbours, and wraps at either end', () => {
    expect(cycleStop(abcd, 'b', false, { at: 2, front: false }, 1)).toEqual(INBOX)
    expect(cycleStop(abcd, 'c', false, { at: 2, front: false }, -1)).toEqual(INBOX)
    expect(cycleStop(abcd, 'd', false, { at: 4, front: false }, 1)).toEqual(INBOX)
    expect(cycleStop(abcd, 'a', false, { at: 4, front: false }, -1)).toEqual(INBOX)
    expect(cycleStop(abcd, 'b', false, { at: 4, front: true }, 1)).toEqual(tab('a'))
    expect(cycleStop(abcd, 'b', false, { at: 0, front: true }, -1)).toEqual(tab('d'))
    // The Inbox alone with one page tab: they take turns.
    expect(cycleStop(['a'], 'a', false, { at: 1, front: true }, 1)).toEqual(tab('a'))
    expect(cycleStop(['a'], 'a', false, { at: 1, front: false }, 1)).toEqual(INBOX)
  })

  it('from the blank tab, which stands last: on to the first tab, back to the last', () => {
    expect(cycleStop(['a', 'b'], 'b', true, null, 1)).toEqual(tab('a'))
    expect(cycleStop(['a', 'b'], 'b', true, null, -1)).toEqual(tab('b'))
  })

  it('nowhere to go: fewer than two stops, or no active tab', () => {
    expect(cycleStop(['a'], 'a', false, null, 1)).toBeNull()
    expect(cycleStop([], null, false, null, -1)).toBeNull()
    expect(cycleStop([], null, false, { at: 0, front: true }, 1)).toBeNull()
    expect(cycleStop(abcd, null, false, null, 1)).toBeNull()
  })
})
