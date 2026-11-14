/**
 * LINKS TO A PAGE CARD (YAZ-5030, D7 of YAZ-4948): `[[DEMO-127]]` names the card whose line holds that ID. Against a
 * real editor (`createCrepe`): the pill shows the card's title and ID with the card icon; a plain click opens the card
 * window (the one open hook, `mdapp:card-open`), in an editable page too; ⌘-click opens the card's page in a
 * background tab, landed on the card. The `[[` picker lists cards after pages, by title and by ID. A card's text draws
 * the same pill. A card that is gone shows the missing look. The file keeps `[[DEMO-127]]`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import type { IndexRecord } from '@shared/types'
import { cardLinkCandidates, linkCandidates } from '../../links/completion'
import { linkResolver } from '../../links/folderLinks'
import { createCrepe, getMarkdownForSave, cardLook } from '../createCrepe'
import { CARD_OPEN, takeCardLanding, type CardOpenRequest } from '../card/cardOpen'
import { renderCard } from '../card/cardRender'
import { rowsFor } from './wikilinkPicker'
import { WIKILINK_CARD_CLASS, createWikilinkResolveSource, linksAsShown } from './wikilinkPlugin'

const rec = (path: string, extra: Partial<IndexRecord> = {}): IndexRecord => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const basename = name.replace(/\.md$/, '')
  return { path, name, basename, title: basename, folder: '', ext: 'md', size: 1, ctime: 1, mtime: 1, properties: {}, aliases: [], tags: [], links: [], embeds: [], ...extra }
}

const VERBS = '/vault/verbs.md'
const RECORDS: IndexRecord[] = [
  rec('/vault/Estar pages.md', { id: 'DEMO-3' }),
  rec(VERBS, { id: 'DEMO-1', cards: [{ id: 'DEMO-126', off: false, next: false, reviews: [], title: 'Ser' }, { id: 'DEMO-127', off: false, next: false, reviews: [], title: 'Estar', notitle: true }] }),
  // An OLD card: no `notitle`, a title all the same.
  rec('/vault/old.md', { id: 'DEMO-2', cards: [{ id: 'DEMO-40', off: false, next: false, reviews: [], title: 'Old card' }] }),
]

function source(records = RECORDS) {
  const s = createWikilinkResolveSource()
  s.update(linkResolver(records, '/vault', [], [], ['DEMO']), records, [], true, ['DEMO'])
  return s
}

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []
afterEach(async () => {
  while (mounted.length > 0) {
    const m = mounted.pop()!
    await m.crepe.destroy()
    m.root.remove()
  }
})

async function mount(markdown: string, wikilinks = source()) {
  const nav = { root: '/vault', createFolder: () => '', openCurrent: vi.fn(), openBackground: vi.fn(), onNotice: vi.fn() }
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown, wikilinks, wikilinkNav: nav })
  await crepe.create()
  mounted.push({ crepe, root })
  return { crepe, root, nav }
}

const mousedown = (el: Element, init: MouseEventInit = {}) => el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, ...init }))

describe('a card link in a page (YAZ-5030)', () => {
  it('`[[DEMO-127]]` in any case is a card pill: the card`s title and its ID, with the card icon; the file keeps the link', async () => {
    const { crepe, root } = await mount('See [[demo-127]] and [[DEMO-40]] and [[DEMO-3]].\n')
    const cards = [...root.querySelectorAll<HTMLElement>(`.${WIKILINK_CARD_CLASS}`)]
    expect(cards.map((c) => c.textContent)).toEqual(['EstarDEMO-127', 'Old cardDEMO-40'])
    expect(cards[0].querySelector('.wikilink__card-id')?.textContent).toBe('DEMO-127')
    expect(cards[0].classList.contains('wikilink--unresolved')).toBe(false)
    // A page's ID stays a page pill, by its title.
    expect([...root.querySelectorAll('.wikilink')].some((s) => s.textContent === 'Estar pages')).toBe(true)
    expect(getMarkdownForSave(crepe)).toBe('See [[demo-127]] and [[DEMO-40]] and [[DEMO-3]].\n')
  })

  it('a card that is gone shows the missing look; a vault without IDs has no card links', async () => {
    const gone = await mount('[[DEMO-999]]\n')
    expect(gone.root.querySelector(`.${WIKILINK_CARD_CLASS}`)).toBeNull()
    expect(gone.root.querySelector('.wikilink--unresolved')?.textContent).toContain('DEMO-999')
    const noIds = createWikilinkResolveSource()
    noIds.update(linkResolver(RECORDS, '/vault', [], [], []), RECORDS, [], false, [])
    const plain = await mount('[[DEMO-127]]\n', noIds)
    expect(plain.root.querySelector(`.${WIKILINK_CARD_CLASS}`)).toBeNull()
  })

  it('a plain click opens the card window (one open hook, in an editable page); ⌘-click opens the page in a background tab, landed on the card', async () => {
    const { root, nav } = await mount('Go [[DEMO-127]] now\n')
    const asks: CardOpenRequest[] = []
    const onOpen = (e: Event) => asks.push((e as CustomEvent<CardOpenRequest>).detail)
    document.addEventListener(CARD_OPEN, onOpen)
    try {
      const pill = root.querySelector(`.${WIKILINK_CARD_CLASS}`)!
      // A real single click (`detail` 1).
      expect(mousedown(pill, { detail: 1 })).toBe(false)
      expect(asks).toEqual([{ path: VERBS, cardId: 'DEMO-127', index: 1 }])
      expect(nav.openCurrent).not.toHaveBeenCalled()
      // The default ⌘-click: a background tab of the card's page, and the page's card of that ID lands.
      mousedown(root.querySelector(`.${WIKILINK_CARD_CLASS}`)!, { metaKey: true, detail: 1 })
      expect(nav.openBackground).toHaveBeenCalledExactlyOnceWith(VERBS)
      expect(asks).toHaveLength(1)
      expect(takeCardLanding(VERBS, 'demo-127')).toBe(true)
      expect(takeCardLanding(VERBS, 'DEMO-127')).toBe(false)
    } finally {
      document.removeEventListener(CARD_OPEN, onOpen)
    }
  })

  it('a card in a card file (YAZ-5037): a click opens the card window as any card; ⌘-click opens the card file`s own tab, with no landing to ask', async () => {
    const CARD_FILE = '/vault/capital-of-france-demo-140.md'
    const records = [...RECORDS, rec(CARD_FILE, { kind: 'card', title: 'Capital of France', cards: [{ id: 'DEMO-140', off: false, next: false, reviews: [], title: 'Capital of France' }] })]
    const { root, nav } = await mount('Go [[DEMO-140]] now\n', source(records))
    const asks: CardOpenRequest[] = []
    const onOpen = (e: Event) => asks.push((e as CustomEvent<CardOpenRequest>).detail)
    document.addEventListener(CARD_OPEN, onOpen)
    try {
      mousedown(root.querySelector(`.${WIKILINK_CARD_CLASS}`)!, { detail: 1 })
      expect(asks).toEqual([{ path: CARD_FILE, cardId: 'DEMO-140', index: 0 }])
      mousedown(root.querySelector(`.${WIKILINK_CARD_CLASS}`)!, { metaKey: true, detail: 1 })
      expect(nav.openBackground).toHaveBeenCalledExactlyOnceWith(CARD_FILE)
      expect(asks).toHaveLength(1)
      // The tab is the card's file: there is no page to land in, so nothing waits for a card view to take it.
      expect(takeCardLanding(CARD_FILE, 'DEMO-140')).toBe(false)
    } finally {
      document.removeEventListener(CARD_OPEN, onOpen)
    }
  })

  it('a copy, a tab label and other plain text read the card`s title (with its ID for a copy that leaves the app)', () => {
    const s = source()
    expect(linksAsShown('Learn [[DEMO-127]]', s)).toBe('Learn Estar')
    expect(linksAsShown('Learn [[DEMO-127]]', s, undefined, true)).toBe('Learn Estar (DEMO-127)')
  })
})

describe('the `[[` picker lists cards (YAZ-5030)', () => {
  const candidates = [...linkCandidates(RECORDS), ...cardLinkCandidates(RECORDS)]

  it('by title, after the pages of the same rank, with the card icon mark; a card row inserts the card`s ID', () => {
    const rows = rowsFor('estar', candidates, ['DEMO'])
    // An exact title: the card (tier 0) first; a page that only starts with it (tier 1) after.
    expect(rows.map((r) => [r.label, r.insert, r.card === true])).toEqual([
      ['Estar', 'DEMO-127', true],
      ['Estar pages', 'DEMO-3', false],
      // No PAGE is named so: Create stays last.
      ['estar', 'estar', false],
    ])
    // Same rank: the page first. `es` starts both names.
    const same = rowsFor('es', candidates, ['DEMO'])
    expect(same.filter((r) => !r.create).map((r) => r.label)).toEqual(['Estar pages', 'Estar'])
  })

  it('by ID: `[[127` (number only) and `[[demo-127` find the card, read `DEMO-127 — Estar`', () => {
    expect(rowsFor('127', candidates, ['DEMO'])[0]).toMatchObject({ label: 'DEMO-127 — Estar', insert: 'DEMO-127', card: true })
    expect(rowsFor('demo-127', candidates, ['DEMO'])[0]).toMatchObject({ insert: 'DEMO-127', card: true })
  })

  it('a card titled as typed is no page of that name: Create still makes the page', () => {
    const rows = rowsFor('Ser', candidates, ['DEMO'])
    expect(rows[0]).toMatchObject({ insert: 'DEMO-126', card: true })
    expect(rows.at(-1)).toMatchObject({ create: true, label: 'Ser' })
  })
})

describe('a card link inside a card (YAZ-5030, `renderCard`)', () => {
  it('draws the card pill: title, ID, card icon class; the raw link rides on it for the click', () => {
    const el = renderCard('Compare with [[DEMO-126]]', {}, cardLook(source(), undefined))
    const pill = el.querySelector<HTMLElement>(`.${WIKILINK_CARD_CLASS}`)!
    expect(pill.textContent).toBe('SerDEMO-126')
    expect(pill.getAttribute('data-card-link')).toBe('DEMO-126')
  })
})
