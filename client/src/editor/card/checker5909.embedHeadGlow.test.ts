/**
 * CHECKER (YAZ-5909 round 1, card behaviour): an embed's head marks (YAZ-5913, YAZ-5915) and its outside-change glow
 * (YAZ-5925 D2c), on the harness of cardEmbed.test.ts (a real page, the embed read from an in-memory disk).
 *
 * Card embeds (YAZ-5037 phase 2), against a real page (`createCrepe`) and the real card editor: `![[GEO-140]]` shows
 * the card that ID names, from a card file or from another page, with the locked head; Edit card writes the ORIGINAL
 * file; the ⋯ menu; the missing look; the read once per file version and only near the screen; "Show as embed" on a
 * card pill and the paste chip's "Embed" for a card link.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import type { CardRecord } from '@shared/cardLine'
import type { IndexRecord } from '@shared/types'
import { DEFAULT_REVIEW_SETTINGS, type ReviewSettings } from '@shared/reviews'
import { editorViewCtx } from '@milkdown/kit/core'
import { createCrepe, type CreateCrepeOptions } from '../createCrepe'
import { READ_ONLY_EDIT } from '../readOnlyEdit'
import { createWikilinkResolveSource, type MutableWikilinkResolveSource } from '../wikilink/wikilinkPlugin'
import { setCardEditorKind } from './cardBlockView'
import { loadCardEmbed } from './embedCard'
import { redrawCardHeads } from '../../review/cardHeadMarks'
import { _resetTwinEditors, announceTwinSave } from '../../lib/twinEditors'
import { OUTSIDE_CHANGE_CLASS, OUTSIDE_REMOVED_CLASS } from '../external/outsideChanges'
import { CARD_GLOW_CHECKED_CLASS } from './cardGlow'

/** The vault's files in memory: the card embed reads them (`api.readFile`), the card's writes change them. */
const disk = vi.hoisted(() => ({ files: new Map<string, string>(), reads: [] as string[] }))
vi.mock('../../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../api')>()
  return {
    ...real,
    api: {
      ...real.api,
      readFile: async (path: string) => {
        disk.reads.push(path)
        const content = disk.files.get(path)
        if (content === undefined) throw new real.BridgeRequestError('NOT_FOUND', `no ${path}`)
        return { path, content, mtime: 1 }
      },
    },
  }
})
vi.mock('../../views/writeProperty', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../views/writeProperty')>()),
  transformFile: async (path: string, transform: (content: string) => string) => {
    const next = transform(disk.files.get(path) ?? '')
    disk.files.set(path, next)
    return { mtime: 2, content: next }
  },
}))

beforeAll(() => setCardEditorKind('page'))
afterAll(() => setCardEditorKind('page'))

/** jsdom has no layout: every box is near the screen as soon as it is watched (the far test has its own observer). */
class NearAtOnce {
  constructor(private readonly cb: IntersectionObserverCallback) {}
  observe(target: Element) {
    queueMicrotask(() => this.cb([{ isIntersecting: true, target } as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver))
  }
  unobserve() {}
  disconnect() {}
}
beforeEach(() => vi.stubGlobal('IntersectionObserver', NearAtOnce))

const CARD_FILE = '/v/cards/capital-of-france-geo-140.md'
const EUROPE = '/v/geo/Europe.md'
const PLAN = '/v/pages/plan.md'

const cardFileText = '---\nkind: card\n---\n```card\nWhat is the capital of **France**?\n---\nParis\n```\n<!-- card: GEO-140, title "Capital of France" -->\n'
const europeText = '# Europe\n\n```card\nWhich is the largest?\n---\nRussia\n```\n<!-- card: GEO-1, title "Largest country?" -->\n\n```card\nWhich is the smallest?\n---\nVatican City\n```\n<!-- card: GEO-2, title "Smallest country?", off -->\n'

const card = (id: string, title: string, over: Partial<CardRecord> = {}): CardRecord => ({ id, off: false, next: false, reviews: [], title, ...over })

function rec(path: string, title: string, over: Partial<IndexRecord> = {}): IndexRecord {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return { path, name, basename: name.replace(/\.md$/, ''), title, folder: path.slice(3, path.lastIndexOf('/')), ext: 'md', size: 1, ctime: 1, mtime: 1, properties: {}, aliases: [], tags: [], links: [], embeds: [], ...over }
}

/** The vault's records; `over` changes the card file's and Europe's. */
function records(over: { cardFile?: Partial<IndexRecord> | null; europe?: Partial<IndexRecord> } = {}): IndexRecord[] {
  return [
    ...(over.cardFile === null ? [] : [rec(CARD_FILE, 'Capital of France', { kind: 'card', cards: [card('GEO-140', 'Capital of France')], ...over.cardFile })]),
    rec(EUROPE, 'Europe, week 3', { cards: [card('GEO-1', 'Largest country?'), card('GEO-2', 'Smallest country?', { off: true })], ...over.europe }),
    rec(PLAN, 'Plan'),
  ]
}

/** The resolver as the app's: a card's ID finds the page it is on (`makeResolver`), a card file's name finds it. */
function update(source: MutableWikilinkResolveSource, list: IndexRecord[]): void {
  const byId = new Map<string, string>()
  for (const r of list) for (const c of r.cards ?? []) if (c.id !== null) byId.set(c.id.toLowerCase(), r.path)
  const resolve = (t: string): string | null => byId.get(t.toLowerCase()) ?? list.find((r) => `cards/${r.basename}` === t || r.basename === t)?.path ?? null
  source.update(resolve, list, [], true, ['GEO'])
}

function vault(list = records()): MutableWikilinkResolveSource {
  const source = createWikilinkResolveSource()
  update(source, list)
  return source
}

const nav = () => ({ root: '/v', createFolder: () => '', openCurrent: vi.fn(), openBackground: vi.fn(), openNewTab: vi.fn(), onNotice: vi.fn() })

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []
afterEach(async () => {
  while (mounted.length > 0) {
    const m = mounted.pop()!
    await m.crepe.destroy()
    m.root.remove()
  }
  document.querySelectorAll('.ctx-menu, .path-paste-chip').forEach((el) => el.remove())
  vi.unstubAllGlobals()
  _resetTwinEditors()
})

async function mount(markdown: string, extra: Partial<CreateCrepeOptions> = {}, cardFile = cardFileText, europe = europeText) {
  disk.files.set(CARD_FILE, cardFile)
  disk.files.set(EUROPE, europe)
  disk.reads.length = 0
  const root = document.createElement('div')
  document.body.appendChild(root)
  const wikilinks = (extra.wikilinks as MutableWikilinkResolveSource | undefined) ?? vault()
  const n = nav()
  const crepe = createCrepe({ root, defaultValue: markdown, wikilinks, boardEmbeds: { root: '/v' }, image: { root: '/v', pagePath: PLAN }, cards: { path: PLAN }, wikilinkNav: n, ...extra })
  await crepe.create()
  mounted.push({ crepe, root })
  await drawn()
  return { crepe, root, wikilinks, nav: n }
}

/** The boxes' chunk is there (it loads once): every box the page asked for is drawn. */
const drawn = async () => {
  await loadCardEmbed()
  await Promise.resolve()
}

const boxes = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('.card-embed')]
const lit = (box: Element) => [...box.querySelectorAll(`.card__body .${OUTSIDE_CHANGE_CLASS}`)].map((el) => el.textContent?.trim())
/** The head as read: the ID, then each quiet mark after it (YAZ-5915). */
const headMarks = (box: Element) => [...box.querySelectorAll('.card__head .card__id, .card__head .card__marks > span')].map((el) => el.textContent)
const withAnswer = (answer: string) => cardFileText.replace('Paris', answer)

describe('YAZ-5913, YAZ-5915: an embed shows the one head (review state, title rule, To fix)', () => {
  it('Review on: "New", the title rule with "(default)", "To fix", in that order; the vault`s Show card titles redraws them; Review off: none', async () => {
    let settings: ReviewSettings = { ...DEFAULT_REVIEW_SETTINGS, enabled: true, titleAt: 'always', titleMark: 'always' }
    // A version of its own: the embeds keep one read per file version across tests (`cardFileText`).
    const list = records({ cardFile: { mtime: 21, cards: [card('GEO-140', 'Capital of France', { fix: true })] } })
    // The file and the index agree: the card line holds `fix`.
    const file = cardFileText.replace('title "Capital of France" -->', 'title "Capital of France", fix -->')
    const { root } = await mount('Plan\n\n![[GEO-140]]\n', { wikilinks: vault(list), cardReviews: { settings: () => settings, deleteReview: vi.fn() } }, file)
    const box = boxes(root)[0]!
    await vi.waitFor(() => expect(headMarks(box)).toEqual(['GEO-140', 'New', 'Title always (default)', 'To fix']))
    // The marks are in the head after "Embedded from" and the ID (one calm line).
    expect(box.querySelector('.card__head')!.firstElementChild?.classList.contains('card-embed__from')).toBe(true)
    settings = { ...settings, titleAt: 'side2' }
    redrawCardHeads()
    expect(headMarks(box)).toEqual(['GEO-140', 'New', 'Title before Side 2 (default)', 'To fix'])
    // YAZ-5965: Only if different (the default): the card follows the vault, so no title mark; Never: none.
    for (const titleMark of ['different', 'never'] as const) {
      settings = { ...settings, titleMark }
      redrawCardHeads()
      expect(headMarks(box)).toEqual(['GEO-140', 'New', 'To fix'])
    }
    settings = { ...settings, enabled: false }
    redrawCardHeads()
    expect(headMarks(box)).toEqual(['GEO-140', 'To fix'])
  })

  it('a card`s own title choice shows with no "(default)"; Never says "Title hidden in review"; Only if different (the default, YAZ-5965) shows these two and not a card that follows the vault', async () => {
    const settings: ReviewSettings = { ...DEFAULT_REVIEW_SETTINGS, enabled: true, titleAt: 'always' }
    const list = records({ cardFile: { mtime: 22, cards: [card('GEO-140', 'Capital of France', { titleAt: 'click' })] }, europe: { mtime: 22, cards: [card('GEO-1', 'Largest country?', { notitle: true }), card('GEO-2', 'Smallest country?', { off: true })] } })
    const file = cardFileText.replace('title "Capital of France" -->', 'title "Capital of France", title-click -->')
    const europe = europeText.replace('title "Largest country?" -->', 'title "Largest country?", notitle -->')
    const { root } = await mount('Plan\n\n![[GEO-140]]\n\n![[GEO-1]]\n\n![[GEO-2]]\n', { wikilinks: vault(list), cardReviews: { settings: () => settings, deleteReview: vi.fn() } }, file, europe)
    const [own, never, archived] = boxes(root)
    // Each embed's head reads its card from the file (the card line is the truth).
    await vi.waitFor(() => expect(headMarks(own!)).toEqual(['GEO-140', 'New', 'Title after first click']))
    await vi.waitFor(() => expect(headMarks(never!)).toEqual(['GEO-1', 'New', 'Title hidden in review']))
    // An archived card says "Archived" in the place of the review state.
    await vi.waitFor(() => expect(headMarks(archived!)).toEqual(['GEO-2', 'Archived']))
  })
})

describe('YAZ-5925 D2c: an outside change of an embedded card lights its words; own writes never glow', () => {
  it('an outside write lights the changed word and marks the removed one; Checked in the head clears it', async () => {
    const { root, wikilinks } = await mount('Plan\n\n![[GEO-140]]\n')
    const box = boxes(root)[0]!
    await vi.waitFor(() => expect(box.querySelector('.card__body')?.textContent).toContain('Paris'))
    const checked = () => box.querySelector<HTMLButtonElement>(`.${CARD_GLOW_CHECKED_CLASS}`)!
    expect(checked().hidden).toBe(true)
    expect(lit(box)).toEqual([])
    // A plain write from outside: the file has new bytes, the index has a new version of it.
    disk.files.set(CARD_FILE, withAnswer('Paris on the Seine'))
    update(wikilinks, records({ cardFile: { mtime: 25 } }))
    await vi.waitFor(() => expect(lit(box)).toEqual(['on the Seine']))
    expect(checked().hidden).toBe(false)
    checked().click()
    await vi.waitFor(() => expect(lit(box)).toEqual([]))
    expect(checked().hidden).toBe(true)
    // Removed words: a red mark, no lit word.
    disk.files.set(CARD_FILE, withAnswer('Paris'))
    update(wikilinks, records({ cardFile: { mtime: 26 } }))
    await vi.waitFor(() => expect(box.querySelectorAll(`.card__body .${OUTSIDE_REMOVED_CLASS}`)).toHaveLength(1))
    expect(lit(box)).toEqual([])
  })

  it("the app's own save of the card's file (announced) never glows", async () => {
    const { root, wikilinks } = await mount('Plan\n\n![[GEO-140]]\n')
    const box = boxes(root)[0]!
    await vi.waitFor(() => expect(box.querySelector('.card__body')?.textContent).toContain('Paris'))
    // This window saved the file (its card page's Done, say) at mtime 27; the index then reports that version.
    announceTwinSave(CARD_FILE, 27)
    disk.files.set(CARD_FILE, withAnswer('Paris, the capital'))
    update(wikilinks, records({ cardFile: { mtime: 27 } }))
    await vi.waitFor(() => expect(box.querySelector('.card__body')?.textContent).toContain('Paris, the capital'))
    expect(lit(box)).toEqual([])
    expect(box.querySelector<HTMLButtonElement>(`.${CARD_GLOW_CHECKED_CLASS}`)!.hidden).toBe(true)
  })
})

describe('YAZ-5896 D1, D2 in an embed (a card shown in a page by `![[ID]]`)', () => {
  // YAZ-5939 (fixed): an embed ended every press on its text with preventDefault (the embed selected whole), and a
  // double-click in a Read only page asked "Allow edits" instead of selecting the word. Now it follows the page card.
  it('a press on the embed`s text leaves the browser free to select; a double-click in a Read only page asks nothing', async () => {
    const { root, crepe } = await mount('Plan\n\n![[GEO-140]]\n')
    const view = crepe.editor.ctx.get(editorViewCtx)
    const box = boxes(root)[0]!
    await vi.waitFor(() => expect(box.querySelector('.card__body')?.textContent).toContain('Paris'))
    view.setProps({ editable: () => false })
    const text = box.querySelector('.card__body p')!
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, detail: 1 })
    text.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(false)
    const asked: Event[] = []
    root.addEventListener(READ_ONLY_EDIT, (e) => asked.push(e))
    const dbl = new MouseEvent('dblclick', { bubbles: true, cancelable: true, button: 0, detail: 2 })
    text.dispatchEvent(dbl)
    expect(asked).toHaveLength(0)
    expect(dbl.defaultPrevented).toBe(false)
    // YAZ-5964: in a page you can edit too, a double-click selects the word; only Edit card edits.
    view.setProps({ editable: () => true })
    const again = new MouseEvent('dblclick', { bubbles: true, cancelable: true, button: 0, detail: 2 })
    text.dispatchEvent(again)
    expect(again.defaultPrevented).toBe(false)
    await new Promise((done) => setTimeout(done, 20))
    expect(box.querySelector('.card--editing')).toBeNull()
  })

  it('YAZ-5939: a click on the embed`s text with no drag selects the embed whole; a drag of 10 px does not', async () => {
    const { root, crepe } = await mount('Plan\n\n![[GEO-140]]\n')
    const view = crepe.editor.ctx.get(editorViewCtx)
    const box = boxes(root)[0]!
    await vi.waitFor(() => expect(box.querySelector('.card__body')?.textContent).toContain('Paris'))
    const text = box.querySelector('.card__body p')!
    const embedText = () => view.state.doc.textBetween(view.state.selection.from, view.state.selection.to)
    // A drag: the press and the release 10 px apart. The page's selection stays where it was.
    text.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, detail: 1, clientX: 10, clientY: 10 }))
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, clientX: 20, clientY: 10 }))
    await new Promise((done) => setTimeout(done, 5))
    expect(embedText()).not.toBe('![[GEO-140]]')
    // A click: the same place.
    text.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, detail: 1, clientX: 10, clientY: 10 }))
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, clientX: 11, clientY: 10 }))
    await vi.waitFor(() => expect(embedText()).toBe('![[GEO-140]]'))
  })
})
