/**
 * YAZ-5904: folded card sides. `renderCard` with `fold` (hidden sides, the rule's words, its toggle and keys), the
 * surfaces that may fold (a page's card reads `--card-sides-fold`; the Inbox's `CardBody` never asks), ⌘F opening a
 * folded side, the copy, and `card.css`'s choice of value (the page's key, Explore's own setting).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { createCrepe } from '../createCrepe'
import { rules } from '../cssRules'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { scrollToRange } from '../find/cardFind'
import { createWikilinkResolveSource } from '../wikilink/wikilinkPlugin'
import { createViewOnlyLinkSource } from '../wikilink/viewOnlyLinkSource'
import { CardBody } from '../../review/cardParts'
import type { ExploreVault } from '../../explore/ExplorePage'
import { FOLD_SCOPE_ATTR, foldAt, foldLabel, followCardFold, setCardFold, tellCardFoldChange } from './cardFold'
import { copyWithoutHidden, renderCard } from './cardRender'
import { cardLookOf, cardLookSettings, cardLookStyle, sanitizeCardLook } from '@shared/cardLook'
import { CARD_SIDES_KEY, readCardSides, writeCardSides } from '@shared/pageSwitches'
;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const LONG = 'Front {{one}}\n---\nBack {{two}}\nline two\n\nline three\n---\nSide three {{three}}'

const rulesOf = (el: Element) => [...el.querySelectorAll<HTMLElement>('.card__rule')]
const sidesOf = (el: Element) => [...el.querySelectorAll<HTMLElement>('.card__side')]

const mounted: Array<() => Promise<void> | void> = []
afterEach(async () => {
  while (mounted.length > 0) await mounted.pop()!()
  document.body.replaceChildren()
})

describe('renderCard with `fold` (YAZ-5904 D2)', () => {
  it('Side 2 and after start hidden; each rule is a button that says its side, with no line count (Q3)', () => {
    const el = renderCard(LONG, { fold: true })
    expect(sidesOf(el).map((s) => s.hidden)).toEqual([false, true, true])
    expect(rulesOf(el).map((r) => [r.getAttribute('role'), r.tabIndex, r.getAttribute('aria-expanded'), r.dataset.fold, r.getAttribute('aria-label')])).toEqual([
      ['button', 0, 'false', 'Side 2', 'Side 2'],
      ['button', 0, 'false', 'Side 3', 'Side 3'],
    ])
    // The words are the rule's attribute: no text for a copy or ⌘F to read.
    expect(rulesOf(el).map((r) => r.textContent)).toEqual(['', ''])
    // Every side is drawn: the hidden words keep their numbers over the card.
    expect([...el.querySelectorAll('[data-hidden]')].map((h) => h.getAttribute('data-hidden'))).toEqual(['0', '1', '2'])
  })

  it('without `fold` (the Inbox, Preview, Review): every side shows and the rules are separators', () => {
    const el = renderCard(LONG)
    expect(sidesOf(el).map((s) => s.hidden)).toEqual([false, false, false])
    expect(rulesOf(el).map((r) => [r.getAttribute('role'), r.hasAttribute('data-fold'), r.hasAttribute('tabindex')])).toEqual([
      ['separator', false, false],
      ['separator', false, false],
    ])
    // The Inbox's steps are untouched by the fold.
    expect(sidesOf(renderCard(LONG, { sides: 1, fold: true }))).toHaveLength(1)
  })

  it('a click opens that side only; again folds it. Enter and Space do the same; other keys do not', () => {
    const el = renderCard(LONG, { fold: true })
    document.body.append(el)
    const [two, three] = rulesOf(el)
    two.click()
    expect([two.getAttribute('aria-expanded'), ...sidesOf(el).map((s) => s.hidden)]).toEqual(['true', false, false, true])
    two.click()
    expect(sidesOf(el).map((s) => s.hidden)).toEqual([false, true, true])
    const key = (target: HTMLElement, k: string) => {
      const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })
      target.dispatchEvent(event)
      return event.defaultPrevented
    }
    expect(key(three, 'Enter')).toBe(true)
    expect([three.getAttribute('aria-expanded'), sidesOf(el)[2].hidden]).toEqual(['true', false])
    expect(key(three, ' ')).toBe(true)
    expect(sidesOf(el)[2].hidden).toBe(true)
    expect(key(three, 'a')).toBe(false)
    expect(sidesOf(el)[2].hidden).toBe(true)
  })

  it('a one-side card folds nothing; unfolding gives the separators back; the same value again keeps an open side open', () => {
    const one = renderCard('Only a front', { fold: true })
    expect([rulesOf(one).length, sidesOf(one).map((s) => s.hidden)]).toEqual([0, [false]])
    const el = renderCard(LONG, { fold: true })
    rulesOf(el)[0].click()
    setCardFold(el, true)
    expect(sidesOf(el).map((s) => s.hidden)).toEqual([false, false, true])
    setCardFold(el, false)
    expect(sidesOf(el).map((s) => s.hidden)).toEqual([false, false, false])
    expect(rulesOf(el).map((r) => [r.getAttribute('role'), r.hasAttribute('aria-expanded'), r.hasAttribute('tabindex'), r.hasAttribute('data-fold')])).toEqual([
      ['separator', false, false, false],
      ['separator', false, false, false],
    ])
    expect(foldLabel(2)).toBe('Side 2')
    expect(sidesOf(el).some((s) => s.hasAttribute('data-lines'))).toBe(false)
  })

  it('⌘F: a match in a folded side opens that side', () => {
    const el = renderCard(LONG, { fold: true })
    document.body.append(el)
    const text = sidesOf(el)[2].querySelector('p')!.firstChild!
    const range = document.createRange()
    range.setStart(text, 0)
    range.setEnd(text, 4)
    scrollToRange(range)
    expect(sidesOf(el).map((s) => s.hidden)).toEqual([false, true, false])
    expect(rulesOf(el)[1].getAttribute('aria-expanded')).toBe('true')
  })

  it('a copy over the card copies only what shows: never a folded side', () => {
    const el = renderCard(LONG, { fold: true })
    document.body.append(el)
    const range = document.createRange()
    range.selectNodeContents(el)
    document.getSelection()!.removeAllRanges()
    document.getSelection()!.addRange(range)
    const data = new Map<string, string>()
    const event = new Event('copy', { bubbles: true, cancelable: true }) as ClipboardEvent
    Object.defineProperty(event, 'clipboardData', { value: { setData: (type: string, value: string) => data.set(type, value) } })
    Object.defineProperty(event, 'currentTarget', { value: el })
    copyWithoutHidden(event)
    expect(data.get('text/plain')).toContain('Front')
    expect(data.get('text/plain')).not.toMatch(/Back|Side three/)
  })
})

describe('opened sides stay open while the page is open (YAZ-5918)', () => {
  /** A page's scope (a tab's editor mount, a card page, the phone's page) with one card in it, folded. */
  const draw = (scope: HTMLElement, id: string | null, text = LONG): HTMLElement => {
    const card = document.createElement('div')
    if (id !== null) card.dataset.cardId = id
    card.append(renderCard(text, { fold: false }))
    scope.replaceChildren(card)
    followCardFold(card.firstElementChild)
    return card
  }
  const pageScope = (path: string): HTMLElement => {
    const scope = document.createElement('div')
    scope.setAttribute(FOLD_SCOPE_ATTR, path)
    scope.style.setProperty('--card-sides-fold', 'on')
    document.body.append(scope)
    return scope
  }

  it('a redraw of the card (an outside save, its text, a setting) keeps the side the reader opened; the others fold', () => {
    const scope = pageScope('/v/Page.md')
    let card = draw(scope, 'WIKI-7')
    rulesOf(card)[1].click()
    expect(sidesOf(card).map((s) => s.hidden)).toEqual([false, true, false])
    card = draw(scope, 'WIKI-7', LONG.replace('Back', 'Back, edited by an agent'))
    expect(sidesOf(card).map((s) => s.hidden)).toEqual([false, true, false])
    expect(rulesOf(card).map((r) => r.getAttribute('aria-expanded'))).toEqual(['false', 'true'])
    // Folded again by the reader: it stays folded at the next redraw.
    rulesOf(card)[1].click()
    card = draw(scope, 'WIKI-7')
    expect(sidesOf(card).map((s) => s.hidden)).toEqual([false, true, true])
    // A setting turned to Show all, then back to Fold: the side opened before is still open.
    rulesOf(card)[0].click()
    setCardFold(card.firstElementChild!, false)
    followCardFold(card.firstElementChild)
    expect(sidesOf(card).map((s) => s.hidden)).toEqual([false, false, true])
  })

  it('by the card: another card, a card with no ID by its place; ⌘F\'s open is kept too', () => {
    const scope = pageScope('/v/Page.md')
    rulesOf(draw(scope, 'WIKI-7'))[0].click()
    expect(sidesOf(draw(scope, 'WIKI-8')).map((s) => s.hidden)).toEqual([false, true, true])
    rulesOf(draw(scope, null))[1].click()
    expect(sidesOf(draw(scope, null)).map((s) => s.hidden)).toEqual([false, true, false])
    const card = draw(scope, 'WIKI-9')
    const range = document.createRange()
    range.selectNodeContents(sidesOf(card)[1])
    scrollToRange(range)
    expect(sidesOf(draw(scope, 'WIKI-9')).map((s) => s.hidden)).toEqual([false, false, true])
  })

  it('a new scope (the tab closed, the page opened again), another page in the scope, or no scope starts from the setting; nothing is stored', () => {
    const scope = pageScope('/v/Page.md')
    rulesOf(draw(scope, 'WIKI-7'))[0].click()
    expect(sidesOf(draw(pageScope('/v/Page.md'), 'WIKI-7')).map((s) => s.hidden)).toEqual([false, true, true])
    scope.setAttribute(FOLD_SCOPE_ATTR, '/v/Other.md')
    expect(sidesOf(draw(scope, 'WIKI-7')).map((s) => s.hidden)).toEqual([false, true, true])
    const loose = document.createElement('div')
    loose.style.setProperty('--card-sides-fold', 'on')
    document.body.append(loose)
    rulesOf(draw(loose, 'WIKI-7'))[0].click()
    expect(sidesOf(draw(loose, 'WIKI-7')).map((s) => s.hidden)).toEqual([false, true, true])
    expect(localStorage.length).toBe(0)
  })
})

describe('who folds (YAZ-5904 D1, D3)', () => {
  it('the card look: three fields in card-look.json (pages, card pages, Explore), Show all by default, written only when they differ', () => {
    expect(cardLookSettings({})).toMatchObject({ cardSidesFold: false, cardSidesFoldCardPages: false, cardSidesFoldExplore: false })
    expect(sanitizeCardLook({ sidesFold: true, sidesFoldExplore: 'yes' })).toEqual({ sidesFold: true })
    expect(cardLookOf({ cardSidesFold: false, cardSidesFoldExplore: true })).toEqual({ sidesFoldExplore: true })
    expect(cardLookSettings(sanitizeCardLook({ sidesFold: true }))).toMatchObject({ cardSidesFold: true, cardSidesFoldExplore: false })
    expect(cardLookStyle({ sidesFold: true })).toMatchObject({ '--card-sides-fold-pages': 'on', '--card-sides-fold-card-pages': 'initial', '--card-sides-fold-explore': 'initial' })
    expect(cardLookStyle({ sidesFoldCardPages: true })).toMatchObject({ '--card-sides-fold-pages': 'initial', '--card-sides-fold-card-pages': 'on' })
    expect(cardLookStyle({})).toMatchObject({ '--card-sides-fold-pages': 'initial', '--card-sides-fold-card-pages': 'initial', '--card-sides-fold-explore': 'initial' })
    expect(cardLookOf({ cardSidesFoldCardPages: true })).toEqual({ sidesFoldCardPages: true })
  })

  it('the page key: `card-sides: fold | show`; Default removes it; any other value is none', () => {
    const page = '---\ntitle: A\n---\nText\n'
    const folded = writeCardSides(page, 'fold')
    expect(folded).toBe('---\ntitle: A\ncard-sides: fold\n---\nText\n')
    expect(readCardSides(folded)).toBe('fold')
    expect(writeCardSides(folded, 'fold')).toBe(folded)
    expect(readCardSides(writeCardSides(folded, 'show'))).toBe('show')
    expect(writeCardSides(folded, null)).toBe(page)
    expect([readCardSides(page), readCardSides(`---\n${CARD_SIDES_KEY}: closed\n---\n`), readCardSides('no frontmatter')]).toEqual([null, null, null])
  })

  it('`card.css`: each card takes the pages\' value; a page\'s `card-sides` wins; in Explore, Explore\'s value, also over the page\'s key', () => {
    const css = readFileSync(resolve(__dirname, 'card.css'), 'utf8')
    const value = (selector: string) => rules(css, selector).find((r) => r.selector === selector && r.body.includes('--card-sides-fold:'))?.body.match(/--card-sides-fold:\s*([^;]+);/)?.[1].trim()
    expect(value('.card')).toBe('var(--card-sides-fold-pages, off)')
    // Q1: a card page (the Mac's card file tab, the phone's card view of a card file) takes Card sides on card pages.
    expect(value('[data-card-file] .card,\n.card[data-card-file]')).toBe('var(--card-sides-fold-card-pages, off)')
    expect(css.indexOf('[data-card-file] .card')).toBeLessThan(css.indexOf("[data-card-sides='fold'] .card"))
    expect(value("[data-card-sides='fold'] .card,\n.card[data-card-sides='fold']")).toBe('on')
    expect(value("[data-card-sides='show'] .card,\n.card[data-card-sides='show']")).toBe('off')
    const explore = rules(css, '.explore__layer [data-card-sides] .card').find((r) => r.body.includes('--card-sides-fold'))
    expect(explore?.selector).toMatch(/\.explore__layer \.card,\s*\.explore__layer \[data-card-sides\] \.card/)
    expect(explore?.body).toMatch(/--card-sides-fold:\s*var\(--card-sides-fold-explore, off\)/)
  })

  it('Q2: on the phone the folded line is a 44 px tap target across the card; the Mac keeps its slim line', () => {
    const phone = readFileSync(resolve(__dirname, '../../../../mobile/src/page/reader.css'), 'utf8')
    const tap = rules(phone, '.card__rule[data-fold]::after')[0]
    expect(tap?.selector).toBe('.reader .card .card__rule[data-fold]::after')
    expect(tap?.body).toMatch(/height:\s*44px/)
    expect(tap?.body).toMatch(/left:\s*0;[\s\S]*right:\s*0/)
    const mac = readFileSync(resolve(__dirname, 'card.css'), 'utf8')
    expect(rules(mac, '.card__rule[data-fold]::after')).toEqual([])
  })

  it('`foldAt`: only a card in the document, under `--card-sides-fold: on`', () => {
    const host = document.createElement('div')
    const el = renderCard(LONG)
    host.append(el)
    expect(foldAt(el)).toBe(false)
    host.style.setProperty('--card-sides-fold', 'on')
    expect(foldAt(el)).toBe(false)
    document.body.append(host)
    expect(foldAt(el)).toBe(true)
    host.style.setProperty('--card-sides-fold', 'off')
    expect(foldAt(el)).toBe(false)
  })
})

describe('the surfaces (YAZ-5904 D3)', () => {
  async function mountPage(markdown: string, host: HTMLElement): Promise<Crepe> {
    const root = document.createElement('div')
    host.append(root)
    const wikilinks = createWikilinkResolveSource()
    wikilinks.update(() => null, [], [], true, ['WIKI'])
    const crepe = createCrepe({ root, defaultValue: markdown, image: { root: '/v', pagePath: '/v/Page.md' }, wikilinks })
    await crepe.create()
    crepe.editor.action((ctx) => (ctx.get(editorViewCtx).hasFocus = () => true))
    mounted.push(async () => void (await crepe.destroy()))
    return crepe
  }

  it('a card in a page folds as its page\'s `card-sides` says (`card.css`), again on each change; a press on the rule does not select the card', async () => {
    // The page's own key on its mount (`card.css`, which the card view loads): Fold.
    const host = document.createElement('div')
    host.dataset.cardSides = 'fold'
    document.body.append(host)
    const crepe = await mountPage('```card\n' + LONG + '\n```\n', host)
    await Promise.resolve()
    const card = host.querySelector<HTMLElement>('.card')!
    expect(sidesOf(card).map((s) => s.hidden)).toEqual([false, true, true])
    const rule = rulesOf(card)[0]
    rule.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
    rule.click()
    expect(card.classList.contains('ProseMirror-selectednode')).toBe(false)
    expect(crepe.editor.action((ctx) => ctx.get(editorViewCtx).state.selection.constructor.name)).not.toBe('NodeSelection')
    expect(sidesOf(card)[1].hidden).toBe(false)
    host.dataset.cardSides = 'show'
    tellCardFoldChange()
    expect(sidesOf(card).map((s) => s.hidden)).toEqual([false, false, false])
  })

  it('YAZ-5918: a side opened in a page stays open when the card\'s text changes from outside (a redraw)', async () => {
    const host = document.createElement('div')
    host.dataset.cardSides = 'fold'
    host.setAttribute(FOLD_SCOPE_ATTR, '/v/Page.md')
    document.body.append(host)
    const crepe = await mountPage('```card\n' + LONG + '\n```\n', host)
    await Promise.resolve()
    const card = () => host.querySelector<HTMLElement>('.card')!
    rulesOf(card())[0].click()
    const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx))
    let end = -1
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === 'code_block') end = pos + node.nodeSize - 1
    })
    view.dispatch(view.state.tr.insertText(' more', end))
    await Promise.resolve()
    expect(sidesOf(card()).at(-1)!.textContent).toContain('more')
    expect(sidesOf(card()).map((s) => s.hidden)).toEqual([false, false, true])
  })

  it('`CardBody`: the Inbox (no `fold`) never folds, even where the look says fold; a card page (`fold`) does', () => {
    const host = document.createElement('div')
    host.style.setProperty('--card-sides-fold', 'on')
    document.body.append(host)
    const vault: ExploreVault = { root: '/v', wikilinks: createWikilinkResolveSource(), wikilinkCandidates: { candidates: [], subscribe: () => () => undefined }, viewOnlyLinks: createViewOnlyLinkSource() }
    const doors = { openLayer: () => undefined, openTab: () => undefined, onNotice: () => undefined }
    const root = createRoot(host)
    mounted.push(() => act(() => root.unmount()))
    act(() => root.render(<div><CardBody text={LONG} path="/v/Page.md" vault={vault} doors={doors} /></div>))
    expect(sidesOf(host).map((s) => s.hidden)).toEqual([false, false, false])
    act(() => root.render(<div><CardBody text={LONG} path="/v/Page.md" vault={vault} doors={doors} fold /></div>))
    expect(sidesOf(host).map((s) => s.hidden)).toEqual([false, true, true])
  })
})
