import { describe, expect, it } from 'vitest'
import { cardMenu, type CardMenuMarks, type CardMenuPlace } from '@shared/cardMenu'

/**
 * YAZ-5697 round 2: ONE card menu. Every place's ⋯ is this list; each place shows the rows that fit it, in the same
 * order, with the same words and the same asks. Made-up data.
 */
const NONE: CardMenuMarks = { off: false, next: false, fix: false, notitle: false, reviews: 1 }
const labels = (place: CardMenuPlace) => cardMenu(place).map((group) => group.map((r) => r.label))
const asks = (place: CardMenuPlace) => cardMenu(place).flat().filter((r) => r.ask !== undefined).map((r) => [r.label, r.ask!.question, r.ask!.yes])

describe('one card menu (YAZ-5697 round 2)', () => {
  it('a card in a page, an embed, the card window, a card file, the Inbox: the rows that fit, in ONE order', () => {
    // A card in a page.
    expect(labels({ open: 'card', preview: true, moveOut: true, marks: NONE, upNext: true, copyId: 'DEMO-7', reset: true })).toEqual([
      ['Open card', 'Preview'],
      ['Move to its own file'],
      ['Put at top of Inbox', 'Archive card', 'Fix later', 'Title on the front'],
      ['Copy card ID'],
      ['Reset history'],
    ])
    // A card embed.
    expect(labels({ open: 'card', preview: true, showAsLink: true, putBack: true, marks: NONE, upNext: true, copyId: 'DEMO-7', reset: true })).toEqual([
      ['Open card', 'Preview'],
      ['Show as link', 'Put back into this page'],
      ['Put at top of Inbox', 'Archive card', 'Fix later', 'Title on the front'],
      ['Copy card ID'],
      ['Reset history'],
    ])
    // A card file's tab.
    expect(labels({ preview: true, toPage: true, marks: NONE, upNext: true, copyId: 'DEMO-7', copyLink: true, reset: true })).toEqual([
      ['Preview'],
      ['Turn into a page'],
      ['Put at top of Inbox', 'Archive card', 'Fix later', 'Title on the front'],
      ['Copy card ID', 'Copy card link'],
      ['Reset history'],
    ])
    // The Inbox (Review): no Fix later (YAZ-5430).
    expect(labels({ open: 'card', marks: NONE, upNext: true, fix: false })).toEqual([['Open card'], ['Put at top of Inbox', 'Archive card', 'Title on the front']])
  })

  it('THE ONE ASK RULE: every row that changes the card or its file and that the same row does not take back asks', () => {
    expect(asks({ open: 'card', preview: true, showAsLink: true, moveOut: true, putBack: true, toPage: true, marks: NONE, upNext: true, copyId: 'DEMO-7', reset: true })).toEqual([
      ['Move to its own file', 'Move this card to its own file?', 'Move'],
      ['Put back into this page', 'Put this card back into this page?', 'Put back'],
      ['Turn into a page', 'Turn this card into a page?', 'Turn into a page'],
      ['Archive card', 'Archive this card?', 'Archive'],
      ['Title on the front', 'Hide the title on the front?', 'Hide'],
    ])
    // Archived: Unarchive card does not ask. Title hidden: it asks to show it.
    expect(asks({ marks: { ...NONE, off: true, notitle: true } })).toEqual([['Title on the front', 'Show the title on the front?', 'Show']])
  })

  it('the vault\'s word for a page; the phone\'s Up next; a read-only page\'s rows wait; no marks, no review rows', () => {
    const unit = (t: string) => t.replace('page', 'sheet')
    expect(labels({ open: 'page', toPage: true, marks: null, unit })).toEqual([['Open sheet', 'Open sheet in a new tab'], ['Turn into a sheet']])
    expect(labels({ marks: { ...NONE, next: true }, upNext: true, upNextWord: true })[0][0]).toBe('Remove from Up next')
    expect(cardMenu({ marks: NONE, locked: true, reset: true }).flat().every((r) => r.disabled === true)).toBe(true)
  })
})
