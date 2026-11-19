// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'
import { renderPiece, type PageLook } from './pageRender'

/**
 * YAZ-5437: a card in a page shows its title as the Mac's read card does (`cardBlockView.ts`, `cardTitle.ts`): the head
 * (ID, then the marks every card head has, YAZ-5915: "New" or "Archived", the title rule), then the title band off the card line (YAZ-5308); no title: no band.
 */
const look: PageLook = {
  link: (inner) => ({ label: inner, open: null }),
  embed: (inner) => ({ kind: 'text', text: inner }),
  asset: () => null,
  card: (text) => {
    const el = document.createElement('div')
    el.textContent = text
    return el
  },
  review: DEFAULT_REVIEW_SETTINGS,
}
const block = (text: string, line: string | null) => `\`\`\`card\n${text}\n\`\`\`${line === null ? '' : `\n<!-- card: ${line} -->`}`

function cards(md: string) {
  const root = document.createElement('div')
  root.append(renderPiece(md, look))
  return [...root.querySelectorAll('.page-card')].map((c) => ({
    head: c.querySelector('.card__head')?.textContent ?? null,
    band: c.querySelector('.card-band')?.textContent ?? null,
    body: c.querySelector('.card__body')?.textContent,
    order: [...c.children].map((el) => el.className),
  }))
}

describe('a card in a page shows its title (YAZ-5437)', () => {
  it('three cards: a title, no title, a title with notitle and off', () => {
    const md = [
      block('Which is the longest river?\n---\nThe Nile', 'NC-1, title "Longest river"'),
      block('Capital of Peru?\n---\nLima', 'NC-2'),
      block('Highest peak?\n---\nEverest', 'NC-3, title "Highest \\"peak\\"", notitle, off'),
    ].join('\n\nWords between.\n\n')
    const got = cards(md)
    expect(got.map((c) => c.band)).toEqual(['Longest river', null, 'Highest "peak"'])
    expect(got.map((c) => c.head)).toEqual(['NC-1NewTitle always (default)', 'NC-2NewTitle always (default)', 'NC-3ArchivedTitle hidden in review'])
    // The Mac's order: head, band, body. The title is never in the body.
    expect(got[0].order).toEqual(['card__head', 'card-band', 'card__body'])
    expect(got[0].body).not.toContain('Longest river')
  })

  it('a card with no card line: no band; with Review on its head has the marks only (YAZ-5915)', () => {
    expect(cards(block('Just a card', null))).toEqual([{ head: 'NewTitle always (default)', band: null, body: 'Just a card', order: ['card__head', 'card__body'] }])
  })

  it('a title the card line holds is text, never markup', () => {
    const [card] = cards(block('Q', 'NC-4, title "<img src=x onerror=alert(1)>"'))
    expect(card.band).toBe('<img src=x onerror=alert(1)>')
  })
})
