import { describe, expect, it } from 'vitest'
import { cardMenu, type CardMenuMarks, type CardMenuPlace } from '@shared/cardMenu'
import { ARCHIVE_TWICE, tapWords } from '@shared/cardAsks'

/**
 * YAZ-5697 round 2: ONE card menu. Every place's ⋯ is this list; each place shows the rows that fit it, in the same
 * order, with the same words and the same asks. Made-up data.
 */
const NONE: CardMenuMarks = { off: false, next: false, fix: false, notitle: false, reviews: 1 }
const labels = (place: CardMenuPlace) => cardMenu(place).map((group) => group.map((r) => r.label))
const twice = (place: CardMenuPlace) => cardMenu(place).flat().filter((r) => r.twice !== undefined).map((r) => [r.label, r.twice!.words, r.twice!.danger === true])
const asks = (place: CardMenuPlace) => cardMenu(place).flat().filter((r) => r.ask !== undefined).map((r) => [r.label, r.ask!.question, r.ask!.yes])

describe('one card menu (YAZ-5697 round 2)', () => {
  it('a card in a page, an embed, the card window, a card file, the Inbox: the rows that fit, in ONE order', () => {
    // A card in a page.
    expect(labels({ open: 'card', preview: true, moveOut: true, marks: NONE, upNext: true, copyId: 'DEMO-7', reset: true })).toEqual([
      ['Open card', 'Preview'],
      ['Move to its own file'],
      ['Move to Up next', 'Archive card', 'Fix later', 'Title in review'],
      ['Copy card ID'],
      ['Reset history'],
    ])
    // A card embed.
    expect(labels({ open: 'card', preview: true, showAsLink: true, putBack: true, marks: NONE, upNext: true, copyId: 'DEMO-7', reset: true })).toEqual([
      ['Open card', 'Preview'],
      ['Show as link', 'Put back into this page'],
      ['Move to Up next', 'Archive card', 'Fix later', 'Title in review'],
      ['Copy card ID'],
      ['Reset history'],
    ])
    // A card file's tab.
    expect(labels({ preview: true, toPage: true, marks: NONE, upNext: true, copyId: 'DEMO-7', copyLink: true, reset: true })).toEqual([
      ['Preview'],
      ['Turn into a page'],
      ['Move to Up next', 'Archive card', 'Fix later', 'Title in review'],
      ['Copy card ID', 'Copy card link'],
      ['Reset history'],
    ])
    // The Inbox (Review): no Fix later (YAZ-5430).
    expect(labels({ open: 'card', marks: NONE, upNext: true, fix: false })).toEqual([['Open card'], ['Move to Up next', 'Archive card', 'Title in review']])
  })

  it('THE ASK RULES: the file rows ask in place (Cancel first); the review rows run on a second click (YAZ-5966)', () => {
    expect(asks({ open: 'card', preview: true, showAsLink: true, moveOut: true, putBack: true, toPage: true, marks: NONE, upNext: true, copyId: 'DEMO-7', reset: true })).toEqual([
      ['Move to its own file', 'Move this card to its own file?', 'Move'],
      ['Put back into this page', 'Put this card back into this page?', 'Put back'],
      ['Turn into a page', 'Turn this card into a page?', 'Turn into a page'],
    ])
    // YAZ-5966: Archive card and Move to Up next / Remove from Up next say "Click again to …"; Fix later, Unarchive do not.
    expect(twice({ marks: NONE, upNext: true })).toEqual([
      ['Move to Up next', 'Click again to move to Up next', false],
      ['Archive card', 'Click again to archive', true],
    ])
    expect(twice({ marks: { ...NONE, next: true, off: true, fix: true }, upNext: true })).toEqual([['Remove from Up next', 'Click again to remove from Up next', true]])
    // Title in review ›: each choice but the one now runs on a second click; the one now (✓) does nothing.
    const title = cardMenu({ marks: { ...NONE, off: true, notitle: true } }).flat().find((r) => r.action === 'title')!
    expect([title.label, title.hint, title.twice]).toEqual(['Title in review', 'Never', undefined])
    expect(title.children!.map((c) => [c.label, c.checked, c.twice?.words ?? null, c.ask ?? null])).toEqual([
      ['Default', false, 'Click again to use the default', null],
      ['Never', true, null, null],
      ['Always', false, 'Click again to always show the title', null],
      ['After the first click', false, 'Click again to show the title after a click', null],
      ['Before Side 2', false, 'Click again to show the title before Side 2', null],
    ])
    // YAZ-5696 round 2: with the vault's Show card titles, Default says what it means now ("Default (On)" of the table
    // menu); the row has the eye's help (`help`).
    const known = cardMenu({ marks: NONE, titleGlobal: 'side2' }).flat().find((r) => r.action === 'title')!
    // Round 3: the row's word is short ("Default", "After first click"); the list keeps "Default (Before Side 2)".
    expect([known.hint, known.children![0].label, 'help' in known]).toEqual(['Default', 'Default (Before Side 2)', false])
    const click = cardMenu({ marks: { ...NONE, titleAt: 'click' }, titleGlobal: 'always' }).flat().find((r) => r.action === 'title')!
    expect(click.hint).toBe('After first click')
    // The phone says "Tap again to …".
    expect(tapWords(ARCHIVE_TWICE)).toBe('Tap again to archive')
  })

  it('the vault\'s word for a page; one Up next word; a read-only page\'s rows wait; no marks, no review rows', () => {
    const unit = (t: string) => t.replace('page', 'sheet')
    expect(labels({ open: 'page', toPage: true, marks: null, unit })).toEqual([['Open sheet', 'Open sheet in a new tab'], ['Turn into a sheet']])
    // YAZ-5697 (Yaseen): one word on the Mac and the phone, "Move to Up next" / "Remove from Up next", the old Inbox words gone.
    expect(labels({ marks: { ...NONE, next: true }, upNext: true })[0][0]).toBe('Remove from Up next')
    expect(cardMenu({ marks: NONE, locked: true, reset: true }).flat().every((r) => r.disabled === true)).toBe(true)
  })
})
