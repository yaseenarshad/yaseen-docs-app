/**
 * Checker tests for PR #278 (YAZ-5909), area "page and card layout": behaviours the builders' tests did not pin.
 *  - YAZ-5869: each table of a card keeps its OWN saved look, also in Side 2 and in a quote (the look list follows the
 *    tables in page order, per side).
 *  - YAZ-5874 D3 / YAZ-5914: `card.css` places a card narrower than its column by `--column-start` alone, in a page, a
 *    card file and the card window; the Inbox does not take it.
 *  - YAZ-5906 Q1: the fold variable of a card in a card file, over the real cascade order of `card.css`.
 *  - YAZ-5918: an open side stays open over a full redraw (a new `renderCard`, new elements), per scope.
 *  - YAZ-5874 D4: the card page cog's Default tooltip names a Settings place that exists.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { rules } from '../cssRules'
import { renderCard } from './cardRender'
import { FOLD_SCOPE_ATTR, followCardFold } from './cardFold'
import { SETTINGS_SECTIONS } from '../../settings/registry'

const css = readFileSync(resolve(__dirname, 'card.css'), 'utf8')

afterEach(() => document.body.replaceChildren())

describe('YAZ-5869: every table in a card keeps its own saved look', () => {
  it('a table in Side 1, one in a quote and one in Side 2 each take the comment after them, and only theirs', () => {
    const text = [
      'Front',
      '',
      '| a | b |',
      '|---|---|',
      '| 1 | 2 |',
      '<!-- table: align B2 center -->',
      '',
      '> | q | r |',
      '> |---|---|',
      '> | 3 | 4 |',
      '> <!-- table: fill A2 green -->',
      '---',
      '| x | y |',
      '|---|---|',
      '| 5 | 6 |',
      '<!-- table: color B2 red, merge A1:B1 -->',
    ].join('\n')
    const el = renderCard(text)
    const tables = [...el.querySelectorAll<HTMLTableElement>('.card__table > table')]
    expect(tables).toHaveLength(3)
    const [first, quoted, second] = tables
    // Side 1's first table: its centred cell only.
    expect(first!.rows[1]!.cells[1]!.style.textAlign).toBe('center')
    expect(first!.querySelector('[data-fill], [data-color], [data-merged]')).toBeNull()
    // The quoted table: its own fill, nothing of the first table's.
    expect(quoted!.rows[1]!.cells[0]!.getAttribute('data-fill')).toBe('green')
    expect(quoted!.rows[1]!.cells[1]!.style.textAlign).toBe('')
    // Side 2's table: its colour and its merged header; not Side 1's alignment.
    expect(second!.rows[1]!.cells[1]!.getAttribute('data-color')).toBe('red')
    expect(second!.rows[0]!.cells[0]!.colSpan).toBe(2)
    expect(second!.rows[0]!.cells).toHaveLength(1)
    expect(second!.rows[1]!.cells[1]!.style.textAlign).toBe('')
  })
})

describe('YAZ-5874 D3 / YAZ-5914: a narrower card sits at the page position', () => {
  it('the Card width rule starts the card at `--column-start` (auto: centred) and keeps its right margin auto', () => {
    const rule = rules(css, '.milkdown .card').find((r) => r.body.includes('max-width: calc(var(--card-text-width)'))
    expect(rule?.selector).toMatch(/\.milkdown \.card/)
    expect(rule?.selector).toMatch(/\.explore__body--card > /)
    expect(rule?.selector).toMatch(/\.card-file > \.card-file__page > \*/)
    // Default (no `--column-start` set anywhere) is Centre: auto on both sides.
    expect(rule?.body).toMatch(/margin-inline:\s*var\(--column-start, auto\) auto/)
  })

  it('the Inbox keeps its own place: no rule gives an Inbox card the page position', () => {
    const inbox = readFileSync(resolve(__dirname, '../../review/cardScreens.css'), 'utf8')
    expect(inbox).not.toMatch(/card-inbox[^{]*\{[^}]*--column-start/)
    expect(rules(css, '.card-inbox').some((r) => r.body.includes('--column-start'))).toBe(false)
  })
})

describe('YAZ-5906 Q1: which fold value a card page takes, in the cascade order of card.css', () => {
  // The fold rules of card.css, in file order, as [selector, value]: the later rule of equal weight wins.
  const foldRules = rules(css, '.card')
    .filter((r) => /--card-sides-fold:\s*[^;]+;/.test(r.body))
    .map((r) => [r.selector, r.body.match(/--card-sides-fold:\s*([^;]+);/)![1]!.trim()] as const)

  /** The value the last matching fold rule gives `card` (all the fold rules weigh two classes or less, in order). */
  const valueFor = (card: Element): string | undefined => {
    let value: string | undefined
    let best = -1
    for (const [selector, v] of foldRules)
      for (const one of selector.split(',').map((s) => s.trim())) {
        if (!card.matches(one)) continue
        const weight = (one.match(/[.[]/g) ?? []).length
        if (weight >= best) {
          best = weight
          value = v
        }
      }
    return value
  }

  const cardIn = (html: string): Element => {
    document.body.innerHTML = html
    return document.querySelector('.card')!
  }

  it('a card page with no key takes Card sides on card pages; its own key wins; Explore takes its own setting over both', () => {
    expect(valueFor(cardIn('<div class="milkdown"><div class="card"></div></div>'))).toBe('var(--card-sides-fold-pages, off)')
    expect(valueFor(cardIn('<div class="card-file" data-card-file><div class="card"></div></div>'))).toBe('var(--card-sides-fold-card-pages, off)')
    expect(valueFor(cardIn('<div class="card-file" data-card-file data-card-sides="show"><div class="card"></div></div>'))).toBe('off')
    expect(valueFor(cardIn('<div class="card-file" data-card-file data-card-sides="fold"><div class="card"></div></div>'))).toBe('on')
    expect(valueFor(cardIn('<div class="explore__layer"><div class="card-file" data-card-file data-card-sides="fold"><div class="card"></div></div></div>'))).toBe('var(--card-sides-fold-explore, off)')
  })
})

describe('YAZ-5918: open sides stay open over a full redraw', () => {
  const LONG = 'Front\n---\nBack\n---\nThird'
  const scope = (path: string): HTMLElement => {
    const el = document.createElement('div')
    el.setAttribute(FOLD_SCOPE_ATTR, path)
    el.style.setProperty('--card-sides-fold', 'on')
    document.body.append(el)
    return el
  }
  /** A fresh draw of the card in `host` with ID `id`: new elements every time, as a redraw makes. */
  const draw = (host: HTMLElement, id: string, text = LONG): HTMLElement => {
    host.querySelector(`[data-card-id="${id}"]`)?.remove()
    const card = document.createElement('div')
    card.className = 'card'
    card.dataset.cardId = id
    const sides = renderCard(text)
    card.append(sides)
    host.append(card)
    followCardFold(sides)
    return card
  }
  const hidden = (card: Element) => [...card.querySelectorAll<HTMLElement>('.card__side')].map((s) => s.hidden)

  it('two tabs on the same page each keep their own open sides; the card ID is matched in any case', () => {
    const tabA = scope('/v/Page.md')
    const tabB = scope('/v/Page.md')
    draw(tabA, 'WIKI-7').querySelectorAll<HTMLElement>('.card__rule')[1]!.click()
    expect(hidden(draw(tabA, 'WIKI-7'))).toEqual([false, true, false])
    expect(hidden(draw(tabB, 'WIKI-7'))).toEqual([false, true, true])
    // The same card written `wiki-7` after an agent's edit is still the same card.
    expect(hidden(draw(tabA, 'wiki-7'))).toEqual([false, true, false])
  })

  it('a side the reader opened stays open when the card gains a new last side (the side numbers stay)', () => {
    const tab = scope('/v/Page.md')
    draw(tab, 'WIKI-8').querySelectorAll<HTMLElement>('.card__rule')[0]!.click()
    expect(hidden(draw(tab, 'WIKI-8', `${LONG}\n---\nFourth`))).toEqual([false, false, true, true])
  })
})

describe('YAZ-5874 D4: the card page cog names a real Settings place', () => {
  // YAZ-5932 (fixed): the Default said "Settings › Review › Card width", a place Settings does not have. Card width is
  // in Settings › Cards › Card look.
  it('the Default tooltip of Card width is the path of the Card width row in Settings', () => {
    const source = readFileSync(resolve(__dirname, '../CardFileView.tsx'), 'utf8')
    const named = source.match(/pageWidthSettings="([^"]+)"/)?.[1]
    let real: string | undefined
    for (const section of SETTINGS_SECTIONS)
      for (const group of section.groups)
        for (const item of group.items) if (item.id === 'cardWidth') real = `${section.title} › ${typeof group.title === 'string' ? group.title : ''} › ${item.label as string}`
    expect(real).toBe('Cards › Card look › Card width')
    expect(named).toBe(real)
  })
})
