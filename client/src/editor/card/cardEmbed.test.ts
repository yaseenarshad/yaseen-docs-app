/**
 * Card embeds (YAZ-5037 phase 2), against a real page (`createCrepe`) and the real card editor: `![[GEO-140]]` shows
 * the card that ID names, from a card file or from another page, with the locked head; Edit card writes the ORIGINAL
 * file; the ⋯ menu; the missing look; the read once per file version and only near the screen; "Show as embed" on a
 * card pill and the paste chip's "Embed" for a card link.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { CardRecord } from '@shared/cardLine'
import type { IndexRecord } from '@shared/types'
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'
import { createCrepe, getMarkdownForSave, type CreateCrepeOptions } from '../createCrepe'
import { createWikilinkCandidateSource } from '../wikilink/wikilinkPicker'
import { createWikilinkResolveSource, type MutableWikilinkResolveSource } from '../wikilink/wikilinkPlugin'
import { BOARD_EMBED_SYNTAX_CLASS } from '../drawing/boardEmbed'
import { CARD_OPEN, setCardEditorKind, type CardOpenRequest } from './cardBlockView'
import { takeCardLanding } from './cardOpen'
import { act } from 'react'
import { cardEmbedOfDom } from './cardEmbed'
import { loadCardEmbed } from './embedCard'
import { READ_ONLY_EDIT, type ReadOnlyEditEvent } from '../readOnlyEdit'

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
})

async function mount(markdown: string, extra: Partial<CreateCrepeOptions> = {}, cardFile = cardFileText) {
  disk.files.set(CARD_FILE, cardFile)
  disk.files.set(EUROPE, europeText)
  disk.reads.length = 0
  const root = document.createElement('div')
  document.body.appendChild(root)
  const wikilinks = (extra.wikilinks as MutableWikilinkResolveSource | undefined) ?? vault()
  const n = nav()
  const crepe = createCrepe({ root, defaultValue: markdown, wikilinks, boardEmbeds: { root: '/v' }, image: { root: '/v', pagePath: PLAN }, cards: { path: PLAN }, wikilinkNav: n, ...extra })
  await crepe.create()
  mounted.push({ crepe, root })
  const view = crepe.editor.ctx.get(editorViewCtx)
  view.hasFocus = () => true
  await drawn()
  return { crepe, root, view, wikilinks, nav: n }
}

/** The boxes' chunk is there (it loads once): every box the page asked for is drawn. */
const drawn = async () => {
  await loadCardEmbed()
  await Promise.resolve()
}
const boxes = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('.card-embed')]
const hidden = (root: HTMLElement) => [...root.querySelectorAll(`.${BOARD_EMBED_SYNTAX_CLASS}`)].map((el) => el.textContent ?? '').join('')
const press = (el: Element | null | undefined) => el?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }))
const menuLabels = () => [...document.querySelectorAll<HTMLButtonElement>('.ctx-menu__item')].map((b) => b.textContent)
const menuItem = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.ctx-menu__item')].find((b) => b.textContent === label)
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))

describe('the embed and its head (Q4, locked)', () => {
  it('`![[GEO-140]]` of a card file and `![[GEO-2]]` of a page each show the card under its head; the text stays, hidden', async () => {
    const markdown = 'Plan\n\n![[GEO-140]]\n\n![[GEO-2]]\n'
    const { crepe, root } = await mount(markdown)
    const [file, inPage] = boxes(root)
    expect(boxes(root)).toHaveLength(2)
    expect(hidden(root)).toBe('![[GEO-140]]![[GEO-2]]')
    // ↗, "Embedded from "<name>" · GEO-140", Edit card, ⋯ — the name is the card's title for a card file.
    expect(file!.querySelector('.card-embed__from')?.textContent).toBe('↗Embedded from "Capital of France"')
    expect(file!.querySelector('.card__id')?.textContent).toBe('GEO-140')
    expect([...file!.querySelectorAll('.card__head button')].map((b) => b.textContent)).toEqual(['↗Embedded from "Capital of France"', 'GEO-140', 'Edit card', '⋯'])
    // A card in a page: the page's title; an archived card says so, as the page's card does.
    expect(inPage!.querySelector('.card-embed__from')?.textContent).toBe('↗Embedded from "Europe, week 3"')
    expect(inPage!.querySelector('.card__state')?.textContent).toBe('Archived')
    expect(inPage!.classList.contains('card--off')).toBe(true)
    // The card itself: the page card's own render, read from where the card lives.
    await vi.waitFor(() => expect(file!.querySelector('.card__body')?.textContent).toContain('What is the capital of France?'))
    expect(file!.querySelector('.card__body strong')?.textContent).toBe('France')
    expect(file!.querySelector('.card__body')?.textContent).toContain('Paris')
    await vi.waitFor(() => expect(inPage!.querySelector('.card__body')?.textContent).toContain('Vatican City'))
    expect(inPage!.querySelector('.card__body')?.textContent).not.toContain('Russia')
    expect(getMarkdownForSave(crepe)).toBe(markdown)
  })

  it('YAZ-5164 part 3: a card in a page shows its title first in the head (the page title`s component), and its card never repeats it; a click renames it in its page', async () => {
    const flag = globalThis as unknown as Record<string, unknown>
    flag.IS_REACT_ACT_ENVIRONMENT = true
    onTestFinished(() => void delete flag.IS_REACT_ACT_ENVIRONMENT)
    const { root } = await mount('![[GEO-140]]\n\n![[GEO-1]]\n')
    // The boxes, as drawn now (the page draws its widgets again as the index lands).
    const inPage = () => boxes(root)[1]!
    await vi.waitFor(() => expect(inPage().querySelector('.card__head .card__title .page-title__text')?.textContent).toBe('Largest country?'))
    await vi.waitFor(() => expect(inPage().querySelector('.card__body')?.textContent).toContain('Russia'))
    expect(inPage().querySelector('.card__body')?.textContent).not.toContain('Largest country?')
    // A card file's title is the head's name already: no second title.
    expect(boxes(root)[0]!.querySelector<HTMLElement>('.card__title')?.hidden).toBe(true)
    press(inPage().querySelector('.card__title .page-title__text'))
    act(() => inPage().querySelector<HTMLElement>('.card__title .page-title__text')!.click())
    const field = inPage().querySelector<HTMLTextAreaElement>('.card__title .page-title__input')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, 'Biggest country?')
      field.blur()
    })
    await vi.waitFor(() => expect(disk.files.get(EUROPE)).toContain('```card\nWhich is the largest?\n---\nRussia\n```\n<!-- card: GEO-1, title "Biggest country?" -->'))
  })

  it('a click on the name opens the original: the card file\'s tab, or the page landed on the card', async () => {
    const { root, nav } = await mount('![[GEO-140]]\n\n![[GEO-2]]\n')
    const [file, inPage] = boxes(root)
    press(file!.querySelector('.card-embed__from'))
    expect(nav.openNewTab).toHaveBeenLastCalledWith(CARD_FILE)
    press(inPage!.querySelector('.card-embed__from'))
    expect(nav.openNewTab).toHaveBeenLastCalledWith(EUROPE)
    expect(takeCardLanding(EUROPE, 'GEO-2')).toBe(true)
  })

  it('missing: "Missing card · GEO-404" in the embed; the pill keeps its own look; a card that goes turns its embed missing', async () => {
    const { root, wikilinks } = await mount('![[GEO-404]]\n\n[[GEO-404]]\n\n![[GEO-140]]\n')
    const [missing, file] = boxes(root)
    expect(missing!.textContent).toBe('Missing card · GEO-404')
    expect(missing!.classList.contains('card-embed--missing')).toBe(true)
    expect(root.querySelector('.wikilink--unresolved')?.textContent).toContain('Missing page')
    expect(file!.querySelector('.card__id')?.textContent).toBe('GEO-140')
    update(wikilinks, records({ cardFile: null }))
    expect(boxes(root).map((b) => b.textContent)).toEqual(['Missing card · GEO-404', 'Missing card · GEO-140'])
  })

  it('a page link, a board name and an ID before the index lands stay as they were', async () => {
    const source = createWikilinkResolveSource()
    const { root } = await mount('![[Plan]]\n\n![[GEO-140]]\n', { wikilinks: source })
    expect(boxes(root)).toHaveLength(0)
    expect(root.textContent).toContain('![[GEO-140]]')
    update(source, records())
    await drawn()
    expect(boxes(root)).toHaveLength(1)
    expect(root.textContent).toContain('![[Plan]]')
  })
})

describe('YAZ-5105 round 4: the Reviews strip in an embed, the same strip as the Inbox and the page card', () => {
  const LINE = '<!-- card: GEO-140, 2026-11-01T09:00Z good, 2026-11-06T09:00Z again 12s -->'
  it('a card with reviews shows THE strip (`CardReviews`) under its text, with its facts; a click opens the table; the delete writes the original; no door: no strip', async () => {
    const deleteReview = vi.fn(async () => {})
    const settings = () => DEFAULT_REVIEW_SETTINGS
    const { root } = await mount('Plan\n\n![[GEO-140]]\n', { cardReviews: { settings, deleteReview }, wikilinks: vault(records({ cardFile: { mtime: 51 } })) }, cardFileText.replace('<!-- card: GEO-140, title "Capital of France" -->', LINE))
    const box = boxes(root)[0]!
    await vi.waitFor(() => expect(box.querySelector('.card-reviews .backlinks__title')?.textContent).toBe('2 Reviews'))
    const strip = box.querySelector('.card-reviews')!
    expect(strip.classList.contains('card-reviews--strip')).toBe(true)
    expect(strip.parentElement?.previousElementSibling?.classList.contains('card__body')).toBe(true)
    expect(box.querySelector('.card-reviews__facts')?.textContent).toMatch(/^Due /)
    ;(box.querySelector('.card-reviews__toggle') as HTMLButtonElement).click()
    await vi.waitFor(() => expect(box.querySelectorAll('.card-reviews__table tbody tr')).toHaveLength(3))
    // A press in the strip never selects the embed; the delete asks, then writes the ORIGINAL through the vault's door.
    box.querySelectorAll<HTMLButtonElement>('.card-reviews__delete')[1].click()
    await vi.waitFor(() => expect(document.querySelector('.confirm')).not.toBeNull())
    ;[...document.querySelectorAll<HTMLButtonElement>('.confirm button')].find((b) => b.textContent === 'Remove review')!.click()
    await vi.waitFor(() => expect(deleteReview).toHaveBeenCalledWith(CARD_FILE, 'GEO-140', { at: '2026-11-06T09:00Z', rating: 'again', seconds: 12 }))
    const plain = await mount('Plan\n\n![[GEO-140]]\n')
    await tick(10)
    expect(boxes(plain.root)[0]!.querySelector('.card-reviews')).toBeNull()
  })
})

describe('speed: read only near the screen, one time per file version', () => {
  // The reads are shared by every page (one per file version): each test has versions of its own.
  it('two embeds of one page read it once; the same version reads nothing more; a new version reads once more', async () => {
    const { root, wikilinks } = await mount('![[GEO-1]]\n\n![[GEO-2]]\n', { wikilinks: vault(records({ europe: { mtime: 10 } })) })
    await vi.waitFor(() => expect(boxes(root)[1]!.querySelector('.card__body')?.textContent).toContain('Vatican City'))
    expect(disk.reads.filter((p) => p === EUROPE)).toHaveLength(1)
    update(wikilinks, records({ europe: { mtime: 10 } }))
    await tick()
    expect(disk.reads.filter((p) => p === EUROPE)).toHaveLength(1)
    disk.files.set(EUROPE, europeText.replace('Russia', 'Russia (17 million km²)'))
    update(wikilinks, records({ europe: { mtime: 11 } }))
    await vi.waitFor(() => expect(boxes(root)[0]!.querySelector('.card__body')?.textContent).toContain('17 million'))
    expect(disk.reads.filter((p) => p === EUROPE)).toHaveLength(2)
  })

  it('an embed far from the screen reads nothing until it comes near', async () => {
    const observers: Array<{ cb: IntersectionObserverCallback; targets: Element[] }> = []
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        targets: Element[] = []
        constructor(cb: IntersectionObserverCallback) {
          observers.push({ cb, targets: this.targets })
        }
        observe(el: Element) {
          this.targets.push(el)
        }
        disconnect() {}
        unobserve() {}
      },
    )
    const { root } = await mount('![[GEO-140]]\n', { wikilinks: vault(records({ cardFile: { mtime: 20 } })) })
    await tick()
    expect(disk.reads).toEqual([])
    // The head shows at once: the index knows the name and the ID.
    expect(boxes(root)[0]!.querySelector('.card__id')?.textContent).toBe('GEO-140')
    const seen = observers.find((o) => o.targets.length > 0)!
    seen.cb([{ isIntersecting: true, target: seen.targets[0]! } as unknown as IntersectionObserverEntry], {} as IntersectionObserver)
    await vi.waitFor(() => expect(boxes(root)[0]!.querySelector('.card__body')?.textContent).toContain('Paris'))
    expect(disk.reads).toEqual([CARD_FILE])
  })
})

describe('Edit card writes the original', () => {
  it('the card editor opens in the embed; Done writes the card file (one transformFile), and the page keeps its `![[GEO-140]]`', async () => {
    const markdown = 'Plan\n\n![[GEO-140]]\n'
    const { crepe, root } = await mount(markdown)
    const box = boxes(root)[0]!
    await vi.waitFor(() => expect(box.querySelector('.card__body')?.textContent).toContain('Paris'))
    press(box.querySelector('.card__edit'))
    const handle = cardEmbedOfDom(box)!
    await handle.cardEditor!.ready
    expect(box.classList.contains('card--editing')).toBe(true)
    expect(box.querySelector('.card__edit')?.textContent).toContain('Done')
    const inner = handle.cardEditor!.view()!
    inner.dispatch(inner.state.tr.insertText(' Since 508.', inner.state.doc.content.size - 1))
    press(box.querySelector('.card__edit'))
    await vi.waitFor(() => expect(disk.files.get(CARD_FILE)).toContain('Paris Since 508.'))
    expect(disk.files.get(CARD_FILE)).toBe(cardFileText.replace('Paris', 'Paris Since 508.'))
    expect(handle.cardEditor).toBeNull()
    expect(box.querySelector('.card__body')?.textContent).toContain('Since 508.')
    expect(getMarkdownForSave(crepe)).toBe(markdown)
  })

  it('Done with no change writes nothing; a read-only page asks first, then opens Edit card', async () => {
    const { root, view } = await mount('![[GEO-140]]\n')
    const box = boxes(root)[0]!
    await vi.waitFor(() => expect(box.querySelector('.card__body')?.textContent).toContain('Paris'))
    press(box.querySelector('.card__edit'))
    await cardEmbedOfDom(box)!.cardEditor!.ready
    press(box.querySelector('.card__edit'))
    await tick()
    expect(disk.files.get(CARD_FILE)).toBe(cardFileText)
    view.setProps({ editable: () => false })
    // YAZ-5145 round 2: read only, Edit card is an edit attempt that carries itself; "Allow edits" then opens it.
    const told: ReadOnlyEditEvent[] = []
    root.addEventListener(READ_ONLY_EDIT, (e) => told.push(e as ReadOnlyEditEvent))
    press(box.querySelector('.card__edit'))
    expect(cardEmbedOfDom(box)!.cardEditor).toBeNull()
    expect(told.map((e) => e.detail)).toEqual(['card'])
    view.setProps({ editable: () => true })
    told[0].resume?.()
    expect(cardEmbedOfDom(box)!.cardEditor).not.toBeNull()
  })
})

describe('the ⋯ menu', () => {
  it('Open card, Show as link, Archive card, Copy card ID; each does its one thing, on the original', async () => {
    const { crepe, root } = await mount('Plan ![[GEO-140]] end\n')
    const box = boxes(root)[0]!
    press(box.querySelector('.card__more'))
    expect(menuLabels()).toEqual(['Open card', 'Preview', 'Show as link', 'Archive card', 'Copy card ID'])
    // Open card: the card window, through the one open hook.
    const opened: CardOpenRequest[] = []
    const listen = (e: Event) => opened.push((e as CustomEvent<CardOpenRequest>).detail)
    document.addEventListener(CARD_OPEN, listen)
    menuItem('Open card')!.click()
    document.removeEventListener(CARD_OPEN, listen)
    expect(opened).toEqual([{ path: CARD_FILE, cardId: 'GEO-140', index: 0 }])
    // Archive card: the card line of the card file.
    press(box.querySelector('.card__more'))
    menuItem('Archive card')!.click()
    await vi.waitFor(() => expect(disk.files.get(CARD_FILE)).toContain('<!-- card: GEO-140, title "Capital of France", off -->'))
    // Show as link: the embed becomes the card's link, in the page.
    press(box.querySelector('.card__more'))
    menuItem('Show as link')!.click()
    expect(getMarkdownForSave(crepe)).toBe('Plan [[GEO-140]] end\n')
    expect(boxes(root)).toHaveLength(0)
  })

  it('an archived card says Unarchive card; a read-only page has no Show as link', async () => {
    const { root, view } = await mount('![[GEO-2]]\n')
    view.setProps({ editable: () => false })
    press(boxes(root)[0]!.querySelector('.card__more'))
    expect(menuLabels()).toEqual(['Open card', 'Preview', 'Unarchive card', 'Copy card ID'])
  })
})

describe('making an embed: "Show as embed" on a card pill, and the paste chip\'s "Embed"', () => {
  it('a card pill\'s menu has "Show as embed": the embed by its ID, with no view options; a missing ID\'s has none', async () => {
    const { crepe, view } = await mount('x [[GEO-140]] y [[GEO-404]]\n')
    const [pill, missing] = [...view.dom.querySelectorAll<HTMLElement>('.wikilink')].filter((el) => el.textContent !== '')
    missing!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    expect(menuLabels()).not.toContain('Show as embed')
    document.querySelectorAll('.ctx-menu').forEach((el) => el.remove())
    pill!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    menuItem('Show as embed')!.click()
    expect(getMarkdownForSave(crepe)).toBe('x ![[GEO-140]] y [[GEO-404]]\n')
  })

  it('paste a card file\'s path: the chip offers "Embed", which writes the card\'s ID embed', async () => {
    const candidates = createWikilinkCandidateSource()
    candidates.update([{ name: 'Capital of France', insert: 'cards/capital-of-france-geo-140', label: 'Capital of France', path: CARD_FILE }])
    const { crepe, view, root } = await mount('Next:\n', { pathPaste: { root: '/v', pagePath: PLAN, candidates } })
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.doc.content.size - 1)))
    const event = { clipboardData: { getData: (type: string) => (type === 'text/plain' ? CARD_FILE : '') }, preventDefault() {} } as unknown as ClipboardEvent
    view.pasteText(CARD_FILE, event)
    expect(getMarkdownForSave(crepe)).toBe('Next:[[cards/capital-of-france-geo-140]]\n')
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('.path-paste-chip button')]
    expect(buttons.map((b) => b.textContent)).toEqual(['Keep as path', 'Embed'])
    buttons[1]!.click()
    expect(getMarkdownForSave(crepe)).toBe('Next:![[GEO-140]]\n')
    await drawn()
    expect(boxes(root)).toHaveLength(1)
  })

  it('a page\'s path: no "Embed"', async () => {
    const candidates = createWikilinkCandidateSource()
    candidates.update([{ name: 'Europe', insert: 'Europe', label: 'Europe', path: EUROPE }])
    const { view } = await mount('Next:\n', { pathPaste: { root: '/v', pagePath: PLAN, candidates } })
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.doc.content.size - 1)))
    const event = { clipboardData: { getData: (type: string) => (type === 'text/plain' ? EUROPE : '') }, preventDefault() {} } as unknown as ClipboardEvent
    view.pasteText(EUROPE, event)
    expect([...document.querySelectorAll<HTMLButtonElement>('.path-paste-chip button')].map((b) => b.textContent)).toEqual(['Keep as path'])
  })
})

describe('the convert rows (YAZ-5037 phase 5): Move to its own file, Put back into this page', () => {
  const door = () => ({ canMove: vi.fn(() => true), move: vi.fn(), putBack: vi.fn() })
  const pageCard = (id: string, text: string) => `\`\`\`card\n${text}\n\`\`\`\n<!-- card: ${id} -->\n`

  it('a card file\'s embed alone on its line has "Put back into this page", after Show as link; the door gets the card, the embed\'s text and its place', async () => {
    const convert = door()
    const { root } = await mount('Intro.\n\n![[GEO-140]]\n\nMid ![[GEO-140]] text.\n\n- Item\n\n  ![[GEO-140]]\n', { cards: { path: PLAN, convert } })
    const [lone, inline, inList] = boxes(root)
    press(lone!.querySelector('.card__more'))
    expect(menuLabels()).toEqual(['Open card', 'Preview', 'Show as link', 'Put back into this page', 'Archive card', 'Copy card ID'])
    menuItem('Put back into this page')!.click()
    expect(convert.putBack).toHaveBeenCalledWith({ id: 'GEO-140', path: CARD_FILE }, 'GEO-140', 0)
    // With words around it: no card block can go there.
    press(inline!.querySelector('.card__more'))
    expect(menuLabels()).not.toContain('Put back into this page')
    document.querySelectorAll('.ctx-menu').forEach((el) => el.remove())
    // An indented line under a list item: the second lone embed of that text.
    press(inList!.querySelector('.card__more'))
    menuItem('Put back into this page')!.click()
    expect(convert.putBack).toHaveBeenLastCalledWith({ id: 'GEO-140', path: CARD_FILE }, 'GEO-140', 1)
  })

  it('a card that lives in a page, or a page with no convert door: no "Put back into this page"', async () => {
    const { root } = await mount('![[GEO-1]]\n', { cards: { path: PLAN, convert: door() } })
    press(boxes(root)[0]!.querySelector('.card__more'))
    expect(menuLabels()).not.toContain('Put back into this page')
    document.querySelectorAll('.ctx-menu').forEach((el) => el.remove())
    const other = await mount('![[GEO-140]]\n')
    press(boxes(other.root)[0]!.querySelector('.card__more'))
    expect(menuLabels()).not.toContain('Put back into this page')
  })

  it('a page card with an ID has "Move to its own file" while the door allows it (Review on); one with no ID has none', async () => {
    const convert = door()
    const { root } = await mount(`# Plan\n\n${pageCard('GEO-1', 'Largest country?')}\n${pageCard('GEO-2', 'Smallest country?')}\n\`\`\`card\nNo ID yet\n\`\`\`\n`, { cards: { path: PLAN, convert } })
    const cards = [...root.querySelectorAll<HTMLElement>('.card:not(.card-embed)')]
    press(cards[1]!.querySelector('.card__more'))
    expect(menuLabels().slice(0, 3)).toEqual(['Open card', 'Preview', 'Move to its own file'])
    menuItem('Move to its own file')!.click()
    expect(convert.move).toHaveBeenCalledWith('GEO-2', 1)
    press(cards[2]!.querySelector('.card__more'))
    expect(menuLabels()).not.toContain('Move to its own file')
    document.querySelectorAll('.ctx-menu').forEach((el) => el.remove())
    convert.canMove.mockReturnValue(false)
    press(cards[0]!.querySelector('.card__more'))
    expect(menuLabels()).not.toContain('Move to its own file')
  })
})
