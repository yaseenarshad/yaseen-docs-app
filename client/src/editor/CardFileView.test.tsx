/**
 * The card file tab (YAZ-5037 phase 3): a file with `kind: card` shows its card, not a page. The tab takes the file
 * the editor read (no read of its own on open), reads again on each new index version, says what is wrong with a file
 * that is not valid (and deletes nothing), hands a file that lost `kind: card` back to the page view, and writes Edit
 * card's Done by the card's ID on the newest bytes, as the card window does. Against the real card editor.
 */
import { CARD_PREVIEW, type CardPreviewRequest } from './card/cardOpen'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { CommentsOrder, FileResponse, IndexRecord } from '@shared/types'
import { readComments } from '@shared/comments'
import { createWikilinkResolveSource } from './wikilink/wikilinkPlugin'
import { CardFileView } from './CardFileView'
import { cardBlockViewOfDom } from './card/cardBlockView'
import { setCardFormatHints } from './card/cardFormatHint'
import { VaultReadOnly } from '../vault/readOnlyVault'
import { useReviewSettings } from '../review/useReviewSettings'
import { createCardFile } from '../review/newCardFile'
import { cardFileName } from '@shared/cardFileFormat'
import { paintedFindRanges } from './find/cardFind'
import { placeOf } from '../test-placeName'
import { listenTour } from '../course/tourBus'
import { createWikilinkCandidateSource, WIKILINK_PICKER_CLASS } from './wikilink/wikilinkPicker'
import { nameCandidate } from '../links/completion'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const ROOT = '/v'
const PATH = '/v/Geography/capital-of-france-wiki-9.md'
const CARD = '```card\nCapital of {{France}}\n---\nParis\n```\n<!-- card: WIKI-9, title "Capital of France" -->\n'
/** A card file's title is on its card line, as every card's (YAZ-5308); its properties hold only `kind: card`. */
const FILE = `---\nkind: card\n---\n${CARD}`
const disk = vi.hoisted(() => ({ files: new Map<string, string>(), reads: 0, review: { enabled: true } as Record<string, unknown> }))

vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api')>()
  return {
    ...real,
    api: {
      ...real.api,
      // New card (YAZ-5037 phase 4): one ID from the door, then the file made at once.
      mintPageId: vi.fn(async () => 'WIKI-10'),
      createFile: vi.fn(async (req: { path: string; content: string }) => {
        disk.files.set(req.path, req.content)
        return { path: req.path, mtime: 1, size: req.content.length }
      }),
      readFile: vi.fn(async (path: string) => {
        disk.reads++
        const content = disk.files.get(path)
        if (content === undefined) throw new real.BridgeRequestError('NOT_FOUND', 'gone')
        return { path, content, mtime: 1, size: content.length }
      }),
      vaultConfig: { read: vi.fn(async () => disk.review), write: vi.fn(), onChange: vi.fn(() => () => undefined) },
      shell: { openLink: vi.fn() },
      // The vault's property declarations (YAZ-5383: the strip's Properties rows are typed by them): none here.
      properties: { get: vi.fn(async (root: string) => ({ root, version: 1, properties: {} })), onChange: vi.fn(() => () => undefined), setProperty: vi.fn() },
    },
  }
})
/** The convert actions' writes (YAZ-5037 phase 5): their own tests are `review/cardConvert.test.ts`; here, what the tab calls. */
const converts = vi.hoisted(() => ({
  turnIntoPage: vi.fn(async (path: string) => path),
  splitIntoCardFiles: vi.fn(async () => [] as string[]),
  moveIntoCard: vi.fn(async () => undefined),
  makeCardFromText: vi.fn(async () => undefined),
}))
/** The card's place across Edit card and Done (YAZ-5164): jsdom draws no boxes, so the move is recorded; the real one is in pagePlace.test.ts. */
const boxMoves = vi.hoisted(() => [] as Array<{ box: Element; offset: number }>)
vi.mock('../editor/pagePlace', async (importOriginal) => ({ ...(await importOriginal<typeof import('./pagePlace')>()), scrollerOf: (e: Element) => e.closest('[data-card-file-body]'), readSwapPlace: () => ({ offset: 120, text: '', nth: -1, line: 0 }), showSwapPlace: (_s: Element, box: Element, place: { offset: number }) => void boxMoves.push({ box, offset: place.offset }) }))
vi.mock('../review/cardConvert', () => ({ ...converts, convertFailure: (err: unknown) => (err instanceof Error ? err.message : String(err)) }))
vi.mock('../views/writeProperty', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../views/writeProperty')>()),
  transformFile: vi.fn(async (path: string, transform: (content: string) => string) => {
    const next = transform(disk.files.get(path) ?? '')
    disk.files.set(path, next)
    return { mtime: 2, content: next }
  }),
}))

const rec = (path: string, extra: Partial<IndexRecord> = {}): IndexRecord => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const basename = name.replace(/\.md$/, '')
  return { path, name, basename, title: basename, folder: '', ext: 'md', size: 1, ctime: 1, mtime: 1, properties: {}, aliases: [], tags: [], links: [], embeds: [], ...extra }
}
/** The vault's index: the card file, a page that links to the card, two that embed it. */
const records = (mtime: number): IndexRecord[] => [
  rec(PATH, { mtime, kind: 'card', title: 'Capital of France', cards: [{ id: 'WIKI-9', off: false, next: false, reviews: [], title: 'Capital of France' }] }),
  rec('/v/pages.md', { links: ['WIKI-9'] }),
  rec('/v/europe.md', { embeds: ['WIKI-9'] }),
  rec('/v/Places/Europe/trips.md', { folder: 'Places/Europe', embeds: ['wiki-9'] }),
]

/** Publishes the vault's review settings (`useReviewOn` reads them), as the vault's scope does. */
function ReviewScope() {
  useReviewSettings(ROOT, () => undefined)
  return null
}

let root: Root | null = null
let el: HTMLElement
const wikilinks = createWikilinkResolveSource()

beforeEach(() => {
  disk.files.clear()
  disk.reads = 0
  disk.review = { enabled: true }
  wikilinks.update(() => null, records(1), [], true, ['WIKI'])
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  el?.remove()
})

async function mount(content: string, opts: { readOnly?: boolean; review?: boolean; path?: string; allow?: boolean; pane?: boolean; candidates?: ReturnType<typeof createWikilinkCandidateSource>; comments?: CommentsOrder } = {}) {
  const path = opts.path ?? PATH
  disk.files.set(path, content)
  if (opts.review === false) disk.review = { enabled: false }
  const file: FileResponse = { path, content, mtime: 1, size: content.length }
  const onPage = vi.fn()
  const onNotice = vi.fn()
  const onOpenFile = vi.fn()
  const onRetitle = vi.fn()
  const onReread = vi.fn()
  const onChangeCommentsOrder = vi.fn()
  const allowFileAction = vi.fn(async () => opts.allow !== false)
  // `pane`: inside a tab's pane (`section.editor`), where the "Read only" chip hears an edit attempt (YAZ-5141).
  el = document.createElement(opts.pane === true ? 'section' : 'div')
  if (opts.pane === true) el.className = 'editor'
  document.body.append(el)
  root = createRoot(el)
  await act(async () =>
    root?.render(
      <VaultReadOnly.Provider value={{ on: opts.readOnly === true, allowFileAction }}>
        <ReviewScope />
        <CardFileView file={file} root={ROOT} wikilinks={wikilinks} wikilinkCandidates={opts.candidates} onOpenFile={onOpenFile} onNotice={onNotice} onPage={onPage} onRetitle={onRetitle} onReread={onReread} commentsOrder={opts.comments} onChangeCommentsOrder={opts.comments === undefined ? undefined : onChangeCommentsOrder} />
      </VaultReadOnly.Provider>,
    ),
  )
  await vi.waitFor(() => expect(el.querySelector('[data-card-file]')).not.toBeNull())
  return { onPage, onNotice, onOpenFile, onRetitle, onReread, allowFileAction, onChangeCommentsOrder }
}

const notice = () => el.querySelector('.card-file-notice')
const fixes = () => [...el.querySelectorAll('.card-file-notice__actions button')].map((b) => b.textContent)
const fix = (label: string) => act(() => [...el.querySelectorAll<HTMLButtonElement>('.card-file-notice__actions button')].find((b) => b.textContent === label)!.click())
const editButton = () => el.querySelector<HTMLButtonElement>('[data-card-file-edit]')
const key = (target: Element, init: KeyboardEventInit) => act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })))
/** A new version of the card file in the index: the tab reads it again. */
const indexSees = (mtime: number) => act(() => wikilinks.update(() => null, records(mtime), [], true, ['WIKI']))
async function menu(): Promise<string[]> {
  act(() => el.querySelector<HTMLButtonElement>('[data-card-file] [aria-label="More actions"]')!.click())
  await vi.waitFor(() => expect(document.querySelector('[role="menuitem"]')).not.toBeNull())
  return [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent ?? '')
}
const pick = (label: string) => act(() => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent === label)!.click())

describe('the card file tab (YAZ-5037 phase 3)', () => {
  it('shows the path, the title, the ID, the state, the card, and the strip`s parts "Linked mentions 1" and "Embedded in 2" (YAZ-5382); no notice; no read of its own on open', async () => {
    await mount(FILE)
    expect(disk.reads).toBe(0)
    expect(el.querySelector('.card-file__path')?.textContent).toBe('Geography')
    // YAZ-5402: the folder icon before the folder's name, the kind and the path in its tooltip.
    expect(placeOf(el.querySelector('.card-file__path'))).toEqual({ kind: 'folder', icon: 'folder', title: 'Folder: Geography' })
    // The title shows one time (YAZ-5044): the big title is the file's `title`; the card holds only its sides.
    expect(el.querySelector('.card-file .card > .card-band .page-title__text')?.textContent).toBe('Capital of France')
    expect(el.querySelector('[data-card-file] .card__id')?.textContent).toBe('WIKI-9')
    await vi.waitFor(() => expect(el.querySelector('.card-file__state')?.textContent).toBe('New'))
    expect(el.querySelector('.card-screen')?.textContent).toContain('Paris')
    expect(notice()).toBeNull()
    const part = (name: string) => el.querySelector<HTMLButtonElement>(`.card-reviews__toggle[data-part="${name}"]`)
    expect(part('links')?.textContent).toBe('Linked mentions1')
    expect(part('embeds')?.textContent).toBe('Embedded in2')
    expect(el.querySelector('.card-backlinks__list')).toBeNull()
    act(() => part('embeds')!.click())
    expect(el.querySelector('.card-backlinks__list')?.textContent).toContain('europe')
    // YAZ-5402: a page's folder in the strip, its last name with the folder icon; the whole path in its tooltip. A page at the vault's top names none.
    expect([...el.querySelectorAll('.card-backlinks__folder')].map(placeOf)).toEqual([{ kind: 'folder', icon: 'folder', title: 'Folder: Places / Europe' }])
    expect(el.querySelector('.card-backlinks__folder')?.textContent).toBe('Europe')
    expect(part('embeds')?.getAttribute('aria-expanded')).toBe('true')
    // The tab is the card's own page: none of the card window's words for a separate page.
    expect(el.textContent).not.toContain('Open page')
  })

  it('⋯: Put at top of Inbox, Archive card, Fix later, Title on the front, Copy card ID, Copy card link — no Open page, no Open as page; Copy card link copies [[ID]]', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    await mount(FILE)
    await vi.waitFor(() => expect(el.querySelector('.card-file__state')?.textContent).toBe('New'))
    const rows = await menu()
    expect(rows).toEqual(['Preview', 'Put at top of Inbox', 'Archive card', 'Fix later', 'Title on the front', 'Copy card ID', 'Copy card link', 'Turn into a page'])
    pick('Copy card link')
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('[[WIKI-9]]'))
  })

  it('Archive card writes `off` on the card line; the head then says "Archived"', async () => {
    await mount(FILE)
    await menu()
    pick('Archive card')
    await vi.waitFor(() => expect(disk.files.get(PATH)).toBe(FILE.replace('<!-- card: WIKI-9, title "Capital of France" -->', '<!-- card: WIKI-9, title "Capital of France", off -->')))
    await vi.waitFor(() => expect(el.querySelector('.card-file__state')?.textContent).toBe('Archived'))
  })

  it('YAZ-5097: Fix later writes `fix` on the card line; the head then says "To fix"; Remove Fix later takes it off', async () => {
    await mount(FILE)
    await menu()
    pick('Fix later')
    // YAZ-5309: `fix` goes after the ID and the title.
    await vi.waitFor(() => expect(disk.files.get(PATH)).toBe(FILE.replace('<!-- card: WIKI-9, title "Capital of France" -->', '<!-- card: WIKI-9, title "Capital of France", fix -->')))
    await vi.waitFor(() => expect(el.querySelector('.card__head .card__fix')?.textContent).toBe('To fix'))
    expect(await menu()).toContain('Remove Fix later')
    pick('Remove Fix later')
    await vi.waitFor(() => expect(disk.files.get(PATH)).toBe(FILE))
    await vi.waitFor(() => expect(el.querySelector('.card__head .card__fix')).toBeNull())
  })

  it('with the vault`s Review off nothing asks you to review it: no due state, no Inbox row, no Reviews', async () => {
    const reviewed = FILE.replace('<!-- card: WIKI-9, title "Capital of France" -->', '<!-- card: WIKI-9, title "Capital of France", 2026-11-01T09:00Z good -->')
    await mount(reviewed, { review: false })
    // Give the settings their read: they stay off.
    await act(async () => undefined)
    expect(el.querySelector('.card-file__state')).toBeNull()
    expect(el.querySelector('.card-reviews')).toBeNull()
    expect(el.textContent).not.toContain('Due')
    const rows = await menu()
    expect(rows).not.toContain('Put at top of Inbox')
    expect(rows).toContain('Archive card')
  })

  it('with Review on, a reviewed card says when it is due, and its history shows', async () => {
    await mount(FILE.replace('<!-- card: WIKI-9, title "Capital of France" -->', '<!-- card: WIKI-9, title "Capital of France", 2026-11-01T09:00Z good -->'))
    await vi.waitFor(() => expect(el.querySelector('.card-file__state')?.textContent).toMatch(/^Due /))
    expect(el.querySelector('.card-reviews .backlinks__title')?.textContent).toBe('1 Review')
  })

  it('YAZ-5383: the top-right properties button opens the strip`s Properties part (the page panel`s rows, the card`s own); a second click closes it', async () => {
    await mount(FILE.replace('<!-- card: WIKI-9, title "Capital of France" -->', '<!-- card: WIKI-9, title "Capital of France", tags "europe" "capitals", level "A2" -->'))
    const button = () => el.querySelector<HTMLButtonElement>('.card-file__properties')!
    await vi.waitFor(() => expect(button()).not.toBeNull())
    expect(button().getAttribute('aria-label')).toBe('Properties (2)')
    expect(el.querySelector('.frontmatter-panel--card')).toBeNull()
    act(() => button().click())
    await vi.waitFor(() => expect(el.querySelector('.card-reviews--strip .frontmatter-panel--card')).not.toBeNull())
    expect(el.querySelector('.card-reviews__toggle[data-part="properties"]')?.getAttribute('aria-expanded')).toBe('true')
    expect([...el.querySelectorAll<HTMLElement>('.frontmatter-panel--card .frontmatter-panel__row')].map((r) => r.dataset.key)).toEqual(['tags', 'level'])
    act(() => button().click())
    expect(el.querySelector('.frontmatter-panel--card')).toBeNull()
  })

  it('YAZ-5105 round 2: Reviews is a strip right under the card (as Mochi), closed until clicked; YAZ-5382: Linked mentions and Embedded in are its parts, no sections under it', async () => {
    await mount(FILE.replace('<!-- card: WIKI-9, title "Capital of France" -->', '<!-- card: WIKI-9, title "Capital of France", 2026-11-01T09:00Z good -->'))
    await vi.waitFor(() => expect(el.querySelector('.card-reviews')).not.toBeNull())
    const strip = el.querySelector('.card-reviews')!
    expect(strip.classList.contains('card-reviews--strip')).toBe(true)
    expect(strip.previousElementSibling?.classList.contains('card-screen')).toBe(true)
    expect([...strip.querySelectorAll<HTMLElement>('.card-reviews__toggle')].map((b) => b.dataset.part)).toEqual(['reviews', 'properties', 'links', 'embeds'])
    expect(el.querySelector('section.card-backlinks')).toBeNull()
    const toggle = strip.querySelector<HTMLButtonElement>('.card-reviews__toggle')!
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(strip.querySelector('.card-reviews__table')).toBeNull()
    act(() => toggle.click())
    expect(strip.querySelector('.card-reviews__table')).not.toBeNull()
    act(() => toggle.click())
    expect(strip.querySelector('.card-reviews__table')).toBeNull()
  })
})

/**
 * YAZ-5392 (Yaseen, YAZ-5308 Q46: "model the exact same UI on the cards page itself … Just one place where the title
 * lives for the card"): the tab shows the card as a page does. Above it the folder path only; no big page title. The
 * card: its top bar (ID, state, Edit card, ⋯), the title band (a click renames the card and its file through App's
 * door), the sides.
 */
describe('YAZ-5392: one title spot, the card as a page shows it', () => {
  it('the path above the card and no big title; in the card: the top bar, then the title band, then the sides', async () => {
    await mount(FILE)
    expect(el.querySelector('.card-file__path')?.textContent).toBe('Geography')
    expect(el.querySelector('.card-file__title-row')).toBeNull()
    expect(el.querySelectorAll('.card-file .page-title')).toHaveLength(1)
    const card = el.querySelector<HTMLElement>('.card-file__page > .card')!
    expect([...card.children].map((c) => c.classList[0])).toEqual(['card__head', 'card-band', 'card__body'])
    const head = card.querySelector('.card__head')!
    expect(head.querySelector('.card__id')?.textContent).toBe('WIKI-9')
    expect(head.querySelector('.card__edit')?.textContent).toBe('Edit card')
    expect(head.querySelector('.card__more')?.textContent).toBe('⋯')
    await vi.waitFor(() => expect(head.querySelector('.card__state')?.textContent).toBe('New'))
    expect(card.querySelector('.card-band .page-title__text')?.textContent).toBe('Capital of France')
    expect(card.querySelector('.card__body')?.textContent).toContain('Paris')
  })

  it('a click on the band`s title renames through the title edit door (the card line`s title and the file`s name)', async () => {
    const { onRetitle } = await mount(FILE)
    act(() => el.querySelector<HTMLElement>('.card-band .page-title__text')!.click())
    const field = el.querySelector<HTMLTextAreaElement>('.card-band .page-title__input')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, 'Capital of Spain')
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    key(field, { key: 'Enter' })
    expect(onRetitle).toHaveBeenCalledExactlyOnceWith(PATH, 'Capital of Spain', 'file')
  })

  it('Edit card: the band shows the title (no field: the band renames, read), the sides are the editor`s', async () => {
    await mount(FILE)
    act(() => editButton()!.click())
    await vi.waitFor(() => expect(el.querySelector('[data-explore-card-edit]')).not.toBeNull())
    await vi.waitFor(() => expect(el.querySelector<HTMLTextAreaElement>('[data-explore-card-edit] .card-band__field')?.value).toBe('Capital of France'))
    expect(el.querySelector<HTMLTextAreaElement>('[data-explore-card-edit] .card-band__field')?.readOnly).toBe(true)
  })
})

describe('the notices of a card file that is not valid (nothing deleted)', () => {
  it('2+ cards: "This card file holds 3 cards.", the first card under it, and "Split into 3 card files"', async () => {
    const many = `${FILE}\n\`\`\`card\nSecond\n\`\`\`\n<!-- card: WIKI-10 -->\n\n\`\`\`card\nThird\n\`\`\`\n<!-- card: WIKI-11 -->\n`
    await mount(many)
    expect(notice()?.querySelector('.card-file-notice__text')?.textContent).toBe('This card file holds 3 cards.')
    expect(fixes()).toEqual(['Split into 3 card files'])
    expect(el.querySelector('.card-screen')?.textContent).toContain('Paris')
    expect(el.querySelector('.card-screen')?.textContent).not.toContain('Second')
  })

  it('text outside the card: "This card file has text outside the card.", that text shown below, muted', async () => {
    await mount(`---\nkind: card\n---\nA page above.\n\n${CARD}\nA page below.\n`)
    expect(notice()?.querySelector('.card-file-notice__text')?.textContent).toBe('This card file has text outside the card.')
    expect(fixes()).toEqual(['Move into the card'])
    expect(el.querySelector('.card-file__outside')?.textContent).toContain('A page above.')
    expect(el.querySelector('.card-file__outside')?.textContent).toContain('A page below.')
    expect(el.querySelector('.card-screen')?.textContent).toContain('Paris')
  })

  it('no card: "This card file has no card.", its text shown muted, no Edit card', async () => {
    await mount('---\nkind: card\n---\nJust some words.\n')
    expect(notice()?.querySelector('.card-file-notice__text')?.textContent).toBe('This card file has no card.')
    expect(fixes()).toEqual(['Make a card from the text', 'Turn into a page'])
    expect(el.querySelector('.card-file__outside')?.textContent).toContain('Just some words.')
    expect(el.querySelector('.card-screen')).toBeNull()
    expect(editButton()).toBeNull()
  })
})

describe('when the file changes on disk', () => {
  it('reads again on each new index version: a second card gives the notice, never the page', async () => {
    const { onPage } = await mount(FILE)
    disk.files.set(PATH, `${FILE}\n\`\`\`card\nSecond\n\`\`\`\n<!-- card: WIKI-10 -->\n`)
    indexSees(2)
    await vi.waitFor(() => expect(notice()?.querySelector('.card-file-notice__text')?.textContent).toBe('This card file holds 2 cards.'))
    expect(onPage).not.toHaveBeenCalled()
    // The same version again reads nothing.
    const reads = disk.reads
    indexSees(2)
    expect(disk.reads).toBe(reads)
  })

  it('`kind: card` removed: the tab hands the file it read to the page view', async () => {
    const { onPage } = await mount(FILE)
    disk.files.set(PATH, `---\ntags: geo\n---\n${CARD}`)
    indexSees(2)
    await vi.waitFor(() => expect(onPage).toHaveBeenCalledTimes(1))
    expect((onPage.mock.calls[0][0] as FileResponse).content).toBe(`---\ntags: geo\n---\n${CARD}`)
  })
})

/** The card editor in the tab, once it holds the card's text (YAZ-5026). */
const cardEditor = async () => {
  await vi.waitFor(() => expect(el.querySelector('[data-explore-card-edit] .card__editor .ProseMirror')).not.toBeNull())
  const dom = el.querySelector<HTMLElement>('[data-explore-card-edit] .card__editor .ProseMirror')!
  await vi.waitFor(() => expect(dom.textContent).toContain('Paris'))
  return dom
}

describe('Edit card in the tab (the card editor, YAZ-5026)', () => {
  it('Edit card (or E) opens the card editor; ⌘↵ is Done: the card`s text lands by its ID, the rest of the file the same', async () => {
    await mount(FILE)
    act(() => editButton()!.click())
    const dom = await cardEditor()
    const view = cardBlockViewOfDom(dom.closest('.card'))!.cardEditor!.view()!
    act(() => view.dispatch(view.state.tr.insertText(' (Seine)', view.state.doc.content.size - 1)))
    key(dom, { key: 'Enter', metaKey: true })
    await vi.waitFor(() => expect(disk.files.get(PATH)).toBe(FILE.replace('Paris\n```', 'Paris (Seine)\n```')))
    await vi.waitFor(() => expect(el.querySelector('[data-explore-card-edit]')).toBeNull())
    await vi.waitFor(() => expect(el.querySelector('.card-screen')?.textContent).toContain('Paris (Seine)'))
  })

  it('YAZ-5647 item 5: Done on an edited card marked Fix later keeps the mark (only a hand clears it); Done with no change writes nothing', async () => {
    const marked = FILE.replace('<!-- card: WIKI-9 -->', '<!-- card: WIKI-9, fix -->')
    await mount(marked)
    act(() => editButton()!.click())
    let dom = await cardEditor()
    key(dom, { key: 'Enter', metaKey: true })
    await vi.waitFor(() => expect(el.querySelector('[data-explore-card-edit]')).toBeNull())
    expect(disk.files.get(PATH)).toBe(marked)
    act(() => editButton()!.click())
    dom = await cardEditor()
    const view = cardBlockViewOfDom(dom.closest('.card'))!.cardEditor!.view()!
    act(() => view.dispatch(view.state.tr.insertText(' (Seine)', view.state.doc.content.size - 1)))
    key(dom, { key: 'Enter', metaKey: true })
    await vi.waitFor(() => expect(disk.files.get(PATH)).toBe(marked.replace('Paris\n```', 'Paris (Seine)\n```')))
  })

  it('YAZ-5164: Edit card and Done keep the card where it is on screen: its box is put back at the spot it had, the editor\'s card on the way in, the read card on the way out', async () => {
    await mount(FILE)
    boxMoves.length = 0
    act(() => editButton()!.click())
    const dom = await cardEditor()
    await vi.waitFor(() => expect(boxMoves.some((m) => m.box === dom.closest('.card'))).toBe(true))
    expect(boxMoves.every((m) => m.offset === 120)).toBe(true)
    boxMoves.length = 0
    key(dom, { key: 'Enter', metaKey: true })
    await vi.waitFor(() => expect(el.querySelector('[data-explore-card-edit]')).toBeNull())
    await vi.waitFor(() => expect(boxMoves.some((m) => m.box === el.querySelector('.card-screen'))).toBe(true))
  })

  it('an outside change to the same card while you edit: the editor stays; Done writes your text by the card`s ID on the NEWEST bytes (the card window`s rule: the outside change to the rest of the file stays, yours wins in the card)', async () => {
    const { onPage } = await mount(FILE)
    key(el.querySelector('[data-card-file-body]')!, { key: 'e' })
    const dom = await cardEditor()
    // An agent writes the same card's text and a property, and reviews it.
    const outside = `---\nkind: card\ntags: geo\n---\n${CARD.replace('Paris', 'Paris!').replace('<!-- card: WIKI-9, title "Capital of France" -->', '<!-- card: WIKI-9, title "Capital of France", 2026-11-01T09:00Z good -->')}`
    disk.files.set(PATH, outside)
    indexSees(2)
    await act(async () => undefined)
    expect(el.querySelector('[data-explore-card-edit] .card__editor .ProseMirror')).toBe(dom)
    const view = cardBlockViewOfDom(dom.closest('.card'))!.cardEditor!.view()!
    act(() => view.dispatch(view.state.tr.insertText(' (Seine)', view.state.doc.content.size - 1)))
    key(dom, { key: 'Enter', metaKey: true })
    await vi.waitFor(() => expect(disk.files.get(PATH)).toBe(outside.replace('Paris!\n```', 'Paris (Seine)\n```')))
    expect(onPage).not.toHaveBeenCalled()
  })

  it('a read-only vault: Edit card shows, but E (or the button) edits nothing until "Allow edits" (YAZ-5145 round 2: it asks first)', async () => {
    await mount(FILE, { readOnly: true })
    expect(editButton()).not.toBeNull()
    key(el.querySelector('[data-card-file-body]')!, { key: 'e' })
    act(() => editButton()!.click())
    expect(el.querySelector('[data-explore-card-edit]')).toBeNull()
  })

  it('a `readonly: true` card file: E edits nothing until "Allow edits"; ⋯ still writes (archive, as reviews do)', async () => {
    const locked = FILE.replace('kind: card\n', 'kind: card\nreadonly: true\n')
    await mount(locked)
    key(el.querySelector('[data-card-file-body]')!, { key: 'e' })
    expect(el.querySelector('[data-explore-card-edit]')).toBeNull()
    await menu()
    pick('Archive card')
    await vi.waitFor(() => expect(disk.files.get(PATH)).toContain('<!-- card: WIKI-9, title "Capital of France", off -->'))
  })
})

/**
 * THE TOP BAR (YAZ-5102): a card file's tab has a page's bar, from the same `StatusChips` — the cog, the zoom, the
 * "Read only" chip while the vault or the file is read only, Sync and Saved. The chip turns Read only off as on a page:
 * a time choice unlocks this tab (the vault's lock stays in its file), "Turn Read only off" writes the file's own switch.
 */
describe('the guided tour hears the card file tab (YAZ-5123)', () => {
  it('open, Edit card (click or E) and Done each fire their event once, with the path; the marks are on the real controls', async () => {
    const heard: Array<[string, string | undefined]> = []
    const stop = listenTour((name, detail) => heard.push([name, detail]))
    try {
      await mount(FILE)
      expect(heard).toEqual([['card-file-open', PATH]])
      expect(editButton()!.dataset.tour).toBe('card-edit')
      expect(el.querySelector('[data-card-file] .card__more')!.getAttribute('data-tour')).toBe('card-menu')
      act(() => editButton()!.click())
      const dom = await cardEditor()
      expect(el.querySelector('[data-explore-card-edit]')!.getAttribute('data-tour')).toBe('card-editor')
      expect(el.querySelector<HTMLElement>('[data-explore-card-edit] .card__edit')!.dataset.tour).toBe('card-done')
      expect(heard.map(([n]) => n)).toEqual(['card-file-open', 'card-edit-open'])
      key(dom, { key: 'Enter', metaKey: true })
      await vi.waitFor(() => expect(el.querySelector('[data-explore-card-edit]')).toBeNull())
      expect(heard).toEqual([['card-file-open', PATH], ['card-edit-open', PATH], ['card-edit-done', PATH]])
      key(el.querySelector('[data-card-file-body]')!, { key: 'e' })
      expect(heard.at(-1)).toEqual(['card-edit-open', PATH])
      expect(heard).toHaveLength(4)
    } finally {
      stop()
    }
  })

  it('the ⋯ rows Archive card and Copy card link are marks of the tour; once archived, the same row Unarchive card is (YAZ-5330); Put at top of Inbox is not', async () => {
    await mount(FILE)
    await menu()
    const tours = () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"][data-tour]')].map((item) => [item.textContent, item.dataset.tour])
    expect(tours()).toEqual([
      ['Archive card', 'card-menu-archive'],
      ['Copy card link', 'card-copy-link'],
    ])
    pick('Archive card')
    await vi.waitFor(() => expect(el.querySelector('.card-file__state')?.textContent).toBe('Archived'))
    await vi.waitFor(() => expect(document.querySelector('[role="menuitem"]')).toBeNull())
    await menu()
    expect(tours()).toEqual([
      ['Unarchive card', 'card-menu-unarchive'],
      ['Copy card link', 'card-copy-link'],
    ])
    pick('Unarchive card')
    await vi.waitFor(() => expect(disk.files.get(PATH)).toBe(FILE))
  })
})

describe('Preview a card from its file (YAZ-5152)', () => {
  it('P and ⋯ › Preview ask for the preview with the card as the Inbox reads it (its title off the card line); no write', async () => {
    await mount(FILE)
    const asks: CardPreviewRequest[] = []
    const listen = (e: Event) => asks.push((e as CustomEvent<CardPreviewRequest>).detail)
    document.addEventListener(CARD_PREVIEW, listen)
    key(el.querySelector('[data-card-file-body]')!, { key: 'p' })
    expect(asks).toHaveLength(1)
    expect(asks[0]).toMatchObject({ path: PATH, id: 'WIKI-9', notitle: false })
    expect([asks[0].title, asks[0].text]).toEqual(['Capital of France', 'Capital of {{France}}\n---\nParis'])
    await menu()
    pick('Preview')
    expect(asks).toHaveLength(2)
    expect(disk.files.get(PATH)).toBe(FILE)
    document.removeEventListener(CARD_PREVIEW, listen)
  })
})

describe('the top bar of a card file (YAZ-5102)', () => {
  const bar = () => el.querySelector<HTMLElement>('.status-chips')
  const chip = () => el.querySelector<HTMLButtonElement>('.read-only-chip__button')
  const askButton = (label: string) => act(() => [...el.querySelectorAll<HTMLButtonElement>('.read-only-chip__ask button')].find((b) => b.textContent === label)!.click())
  const cogRows = () => {
    act(() => el.querySelector<HTMLButtonElement>('.status-chips [aria-label="Page settings"]')!.click())
    return [...document.querySelectorAll('.page-settings__menu button, .page-settings__menu p')].map((b) => b.textContent ?? '')
  }

  it('shows the cog, the zoom, Saved; no Read only chip on a card file that is not read only', async () => {
    await mount(FILE)
    expect(bar()).not.toBeNull()
    expect(bar()!.querySelector('.page-settings')).not.toBeNull()
    expect(bar()!.querySelector('.document-zoom')).not.toBeNull()
    expect(bar()!.querySelector('.save-indicator')?.textContent).toBe('Saved')
    expect(chip()).toBeNull()
  })

  it('a read-only vault: the Read only chip shows; "Until I close this tab" unlocks the tab, and Edit card works', async () => {
    await mount(FILE, { readOnly: true })
    expect(chip()?.textContent).toContain('Read only')
    act(() => chip()!.click())
    // The vault's lock is the vault's: no "Turn Read only off" here, as on a page.
    expect([...el.querySelectorAll('.read-only-chip__ask button')].map((b) => b.textContent)).not.toContain('Turn Read only off')
    askButton('Until I close this tab')
    expect(editButton()).not.toBeNull()
    act(() => editButton()!.click())
    const dom = await cardEditor()
    const view = cardBlockViewOfDom(dom.closest('.card'))!.cardEditor!.view()!
    act(() => view.dispatch(view.state.tr.insertText(' (Seine)', view.state.doc.content.size - 1)))
    key(dom, { key: 'Enter', metaKey: true })
    await vi.waitFor(() => expect(disk.files.get(PATH)).toBe(FILE.replace('Paris\n```', 'Paris (Seine)\n```')))
  })

  it('YAZ-5141: a click on the title of a locked card file shows the chip`s card ("This card is Read only. Press Enter to allow edits."); Enter asks; a choice unlocks and the title edits at once', async () => {
    const { onRetitle } = await mount(FILE, { readOnly: true, pane: true })
    const title = el.querySelector<HTMLElement>('.card-file .card > .card-band .page-title__text')!
    act(() => title.click())
    expect(el.querySelector('.read-only-message__card')?.textContent).toBe('This card is Read only.Press Enter to allow edits.')
    expect(document.activeElement).toBe(title)
    // The same Enter as the body's: the "Allow edits?" box.
    key(title, { key: 'Enter' })
    expect(el.querySelector('.read-only-chip__ask p')?.textContent).toBe('Allow edits?')
    askButton('Allow edits for 1 minute')
    // YAZ-5145 round 2: the click's rename runs once the tab is unlocked, with no second click.
    await vi.waitFor(() => expect(el.querySelector('.card-file .card > .card-band .page-title__input')).not.toBeNull())
    const field = el.querySelector<HTMLTextAreaElement>('.card-file .card > .card-band .page-title__input')
    expect(document.activeElement).toBe(field)
    field!.value = 'Capital of Italy'
    key(field!, { key: 'Enter' })
    expect(onRetitle).toHaveBeenCalledExactlyOnceWith(PATH, 'Capital of Italy', 'file')
  })

  it('YAZ-5145 round 2: E in a locked tab shows the chip`s card; Enter, then "Allow edits": Edit card opens at once, with no second E', async () => {
    await mount(FILE, { readOnly: true, pane: true })
    const body = el.querySelector<HTMLElement>('[data-card-file-body]')!
    act(() => body.focus())
    key(body, { key: 'e' })
    expect(el.querySelector('.read-only-message__card')?.textContent).toBe('This card is Read only.Press Enter to allow edits.')
    expect(el.querySelector('[data-explore-card-edit]')).toBeNull()
    key(body, { key: 'Enter' })
    askButton('Allow edits for 1 minute')
    await cardEditor()
  })

  it('YAZ-5145 round 2: the Edit card button in a locked tab, then Cancel: nothing opens, and a later unlock opens nothing either', async () => {
    await mount(FILE, { readOnly: true, pane: true })
    act(() => editButton()!.click())
    expect(el.querySelector('.read-only-message__card')).not.toBeNull()
    act(() => chip()!.click())
    askButton('Cancel')
    act(() => chip()!.click())
    askButton('Until I close this tab')
    await new Promise((r) => setTimeout(r, 20))
    expect(el.querySelector('[data-explore-card-edit]')).toBeNull()
  })

  it('Lock now locks the tab again: no Edit card', async () => {
    await mount(FILE, { readOnly: true })
    act(() => chip()!.click())
    askButton('Until I close this tab')
    expect(editButton()).not.toBeNull()
    act(() => el.querySelector<HTMLButtonElement>('.read-only-chip__lock')!.click())
    // Locked again: Edit card asks first once more (YAZ-5145 round 2), it does not edit.
    await vi.waitFor(() => expect(el.querySelector('.read-only-chip__button')?.textContent).toContain('Read only'))
    act(() => editButton()!.click())
    expect(el.querySelector('[data-explore-card-edit]')).toBeNull()
  })

  it('a `readonly: true` card file: "Turn Read only off" writes the file`s switch off; the chip goes and Edit card shows', async () => {
    const locked = FILE.replace('kind: card\n', 'kind: card\nreadonly: true\n')
    await mount(locked)
    act(() => chip()!.click())
    askButton('Turn Read only off')
    await vi.waitFor(() => expect(disk.files.get(PATH)).toBe(FILE))
    await vi.waitFor(() => expect(chip()).toBeNull())
    expect(editButton()).not.toBeNull()
  })

  it('the cog: Read only (it writes the file`s switch) and the counts; none of a page`s rows', async () => {
    await mount(FILE)
    const rows = cogRows()
    expect(rows[0]).toContain('Read only')
    for (const pageRow of ['Line numbers', 'Section indent', 'Guide lines', 'Folding', 'Bullet threading', 'Heading levels', 'Table of contents', 'Turn into a card file']) expect(rows.join('|')).not.toContain(pageRow)
    expect(rows.some((r) => / words$/.test(r))).toBe(true)
    act(() => [...document.querySelectorAll<HTMLButtonElement>('.page-settings__menu button')].find((b) => b.textContent?.startsWith('Read only'))!.click())
    await vi.waitFor(() => expect(disk.files.get(PATH)).toContain('readonly: true'))
    await vi.waitFor(() => expect(chip()).not.toBeNull())
    // Locked: Edit card asks first (YAZ-5145 round 2), it does not edit.
    act(() => editButton()!.click())
    expect(el.querySelector('[data-explore-card-edit]')).toBeNull()
  })

  it('the zoom: Zoom in sizes the card up, as a page`s text', async () => {
    await mount(FILE)
    act(() => bar()!.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')!.click())
    expect(el.querySelector<HTMLElement>('[data-card-file]')!.style.getPropertyValue('--document-zoom')).toBe('1.25')
  })
})

/**
 * NEW CARD (YAZ-5037 phase 4, YAZ-5101, YAZ-5044): the sidebar's name box gives the title; the file holds it in `title`
 * and is named after it; the card starts empty, and its tab opens in Edit card on it, one time only.
 */
describe('a new card file (YAZ-5037 phase 4, YAZ-5044)', () => {
  it('the typed name is `title`; the file is named after it; the card is empty and opens in Edit card; Done writes the card and renames nothing', async () => {
    const heard: Array<[string, string | undefined]> = []
    const stop = listenTour((name, detail) => heard.push([name, detail]))
    const made = await createCardFile('/v/Geography', 'Capital of France')
    stop()
    expect(made).toBe(`/v/Geography/${cardFileName('Capital of France', 'WIKI-10')}`)
    // The guided tour (YAZ-5123) hears the new card file once, with its path.
    expect(heard).toEqual([['card-file-created', made]])
    expect(disk.files.get(made)).toBe('---\nkind: card\n---\n```card\n\n```\n<!-- card: WIKI-10, title "Capital of France" -->\n')
    const { onRetitle } = await mount(disk.files.get(made)!, { path: made })
    await vi.waitFor(() => expect(el.querySelector('[data-explore-card-edit] .card__editor .ProseMirror')).not.toBeNull())
    const dom = el.querySelector<HTMLElement>('[data-explore-card-edit] .card__editor .ProseMirror')!
    const view = cardBlockViewOfDom(dom.closest('.card'))!.cardEditor!.view()!
    act(() => view.dispatch(view.state.tr.insertText('Which city?\n---\nParis', 1)))
    key(dom, { key: 'Enter', metaKey: true })
    await vi.waitFor(() => expect(disk.files.get(made)).toContain('Paris'))
    expect(disk.files.get(made)).toMatch(/^---\nkind: card\n---\n[\s\S]*<!-- card: WIKI-10, title "Capital of France" -->\n$/)
    await vi.waitFor(() => expect(el.querySelector('[data-explore-card-edit]')).toBeNull())
    expect(onRetitle).not.toHaveBeenCalled()
    // Opened again, it is a card file like any other: shown, not in Edit card.
    act(() => root?.unmount())
    await mount(disk.files.get(made)!, { path: made })
    expect(el.querySelector('[data-explore-card-edit]')).toBeNull()
    expect(editButton()).not.toBeNull()
  })

  it('YAZ-5114: the new card file shows the format hint under the key row; the first text removes it; an old card file never shows it', async () => {
    setCardFormatHints({ on: true, byVault: new Map([['/v', { folder: '/v/Card skill/formats', formats: ['acronym', 'book', 'comparison', 'concept'] }]]) })
    try {
      const made = await createCardFile('/v/Geography', 'la biblioteca')
      await mount(disk.files.get(made)!, { path: made })
      await vi.waitFor(() => expect(el.querySelector('[data-explore-card-edit] .card__formats')).not.toBeNull())
      expect(el.querySelector('[data-explore-card-edit] .card__formats')!.textContent).toBe('Formats in your card skill: acronym · book · comparison · 1 more. Learn the formats')
      const dom = el.querySelector<HTMLElement>('[data-explore-card-edit] .card__editor .ProseMirror')!
      const view = cardBlockViewOfDom(dom.closest('.card'))!.cardEditor!.view()!
      act(() => view.dispatch(view.state.tr.insertText('El libro', 1)))
      expect(el.querySelector('.card__formats')).toBeNull()
      act(() => root?.unmount())
      await mount(FILE)
      act(() => editButton()!.click())
      await cardEditor()
      expect(el.querySelector('.card__formats')).toBeNull()
    } finally {
      setCardFormatHints({ byVault: new Map() })
    }
  })

  it('a Done in Edit card never renames: the card`s text is its sides, not its title', async () => {
    const { onRetitle } = await mount(FILE)
    act(() => editButton()!.click())
    const dom = await cardEditor()
    const view = cardBlockViewOfDom(dom.closest('.card'))!.cardEditor!.view()!
    act(() => view.dispatch(view.state.tr.insertText('The ', 1)))
    key(dom, { key: 'Enter', metaKey: true })
    await vi.waitFor(() => expect(disk.files.get(PATH)).toContain('The Capital of {{France}}'))
    await vi.waitFor(() => expect(el.querySelector('[data-explore-card-edit]')).toBeNull())
    expect(onRetitle).not.toHaveBeenCalled()
  })
})

/** YAZ-5104: the big title of a card file tab is a page's title: click, type, Enter renames; Esc goes back; read only blocks it. */
describe('click the title to change it, as on a page (YAZ-5104)', () => {
  const title = () => el.querySelector<HTMLElement>('.card-file .card > .card-band .page-title__text')
  const field = () => el.querySelector<HTMLTextAreaElement>('.card-file .card > .card-band .page-title__input')
  const type = (text: string) =>
    act(() => {
      const box = field()!
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box, text)
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })

  it('a click opens the field on the title; Enter hands the new title to the title edit door (it writes `title` and renames the file)', async () => {
    const { onRetitle } = await mount(FILE)
    act(() => title()!.click())
    expect(field()?.value).toBe('Capital of France')
    type('Capital of Spain')
    key(field()!, { key: 'Enter' })
    expect(onRetitle).toHaveBeenCalledExactlyOnceWith(PATH, 'Capital of Spain', 'file')
    expect(field()).toBeNull()
  })

  it('Esc goes back: nothing is renamed; typing in the field never opens Edit card', async () => {
    const { onRetitle } = await mount(FILE)
    act(() => title()!.click())
    key(field()!, { key: 'e' })
    expect(el.querySelector('[data-explore-card-edit]')).toBeNull()
    type('Something else')
    key(field()!, { key: 'Escape' })
    expect(field()).toBeNull()
    expect(onRetitle).not.toHaveBeenCalled()
    expect(title()?.textContent).toBe('Capital of France')
  })

  it('read only, as on a page: a read-only vault or a `readonly: true` file does not open the field', async () => {
    const { onRetitle } = await mount(FILE, { readOnly: true })
    act(() => title()!.click())
    expect(field()).toBeNull()
    act(() => root?.unmount())
    await mount(FILE.replace('kind: card\n', 'kind: card\nreadonly: true\n'))
    act(() => title()!.click())
    expect(field()).toBeNull()
    expect(onRetitle).not.toHaveBeenCalled()
  })
})

describe('the convert actions (YAZ-5037 phase 5)', () => {
  beforeEach(() => Object.values(converts).forEach((fn) => fn.mockClear()))
  const many = `${FILE}\n\`\`\`card\nSecond\n\`\`\`\n<!-- card: WIKI-10 -->\n`

  it('Split and Make a card from the text run their action on this file', async () => {
    await mount(many)
    fix('Split into 2 card files')
    await vi.waitFor(() => expect(converts.splitIntoCardFiles).toHaveBeenCalledWith(PATH))
    act(() => root?.unmount())
    await mount('---\nkind: card\n---\nJust some words.\n')
    fix('Make a card from the text')
    await vi.waitFor(() => expect(converts.makeCardFromText).toHaveBeenCalledWith(PATH))
  })

  it('Turn into a page reads the file again, with no "no longer a card file" notice', async () => {
    const { onReread, onPage } = await mount(FILE)
    await menu()
    pick('Turn into a page')
    await vi.waitFor(() => expect(onReread).toHaveBeenCalled())
    expect(converts.turnIntoPage).toHaveBeenCalledWith(PATH)
    // The index's next version reads a page now: this tab's own doing reads again, never the notice.
    disk.files.set(PATH, '---\ntitle: Capital of France\n---\n' + CARD)
    indexSees(5)
    await vi.waitFor(() => expect(onReread).toHaveBeenCalledTimes(2))
    expect(onPage).not.toHaveBeenCalled()
  })

  it('a read-only vault asks first: Cancel runs nothing', async () => {
    const { allowFileAction } = await mount(`---\nkind: card\n---\nAbove.\n\n${CARD}`, { readOnly: true, allow: false })
    fix('Move into the card')
    await vi.waitFor(() => expect(allowFileAction).toHaveBeenCalledWith(ROOT))
    await act(async () => undefined)
    expect(converts.moveIntoCard).not.toHaveBeenCalled()
  })

  it('a failure says why in one notice', async () => {
    converts.moveIntoCard.mockRejectedValueOnce(new Error('the disk refused the change. Nothing changed.'))
    const { onNotice } = await mount(`---\nkind: card\n---\nAbove.\n\n${CARD}`)
    fix('Move into the card')
    await vi.waitFor(() => expect(onNotice).toHaveBeenCalledWith("Can't move the text into the card: the disk refused the change. Nothing changed."))
  })

  it('a `readonly: true` card file, or a vault with no IDs: no convert action', async () => {
    await mount(many.replace('kind: card', 'kind: card\nreadonly: true'))
    expect(fixes()).toEqual([])
    expect(await menu()).not.toContain('Turn into a page')
    act(() => root?.unmount())
    act(() => wikilinks.update(() => null, records(1), [], false, []))
    await mount(many)
    expect(fixes()).toEqual([])
  })
})

describe('⌘F in a card file tab (YAZ-5378 part 2): the page\'s find bar, over the card as it shows', () => {
  const pressCmdF = (target: EventTarget) => act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', metaKey: true, bubbles: true, cancelable: true })))
  const type = (input: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    act(() => {
      setter.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  const count = () => el.querySelector('.find-bar__count')?.textContent

  it('⌘F opens the bar; it counts the title and the sides (hidden words too), steps, and Esc closes it and clears the paint', async () => {
    await mount(FILE, { pane: true })
    const body = el.querySelector<HTMLElement>('[data-card-file]')!
    act(() => body.focus())
    pressCmdF(body)
    const input = el.querySelector<HTMLInputElement>('.find-bar__input')
    expect(input).not.toBeNull()
    expect(document.activeElement).toBe(input)
    // "Capital of France" (the title), "Capital of {{France}}" (side 1).
    type(input!, 'france')
    expect(count()).toBe('1 of 2')
    expect(paintedFindRanges().map((r) => r.active)).toEqual([true, false])
    act(() => input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })))
    expect(count()).toBe('2 of 2')
    type(input!, 'paris')
    expect(count()).toBe('1 of 1')
    // Its Markdown is not its text.
    type(input!, '{{')
    expect(count()).toBe('0 of 0')
    act(() => input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect(el.querySelector('.find-bar')).toBeNull()
    expect(paintedFindRanges()).toEqual([])
  })
})

describe('[[ in Edit card on a card file (YAZ-5185)', () => {
  it('lists the vault\'s pages and cards, as in a page, not only "Create"', async () => {
    const candidates = createWikilinkCandidateSource()
    candidates.update([{ ...nameCandidate('Europe'), path: `${ROOT}/Europe.md` }, { name: 'Estar', insert: 'WIKI-12', label: 'Estar', lower: 'estar', card: true }])
    await mount(FILE, { candidates })
    act(() => editButton()!.click())
    const dom = await cardEditor()
    const view = cardBlockViewOfDom(dom.closest('.card'))!.cardEditor!.view()!
    act(() => view.dispatch(view.state.tr.insertText('[[', view.state.doc.content.size - 1)))
    act(() => view.dispatch(view.state.tr.insertText('e')))
    const rows = () => [...document.querySelectorAll(`.${WIKILINK_PICKER_CLASS} [role="option"]`)].map((o) => o.textContent ?? '')
    await vi.waitFor(() => expect(rows()).toContain('Europe'))
    expect(rows().some((r) => r.includes('Estar'))).toBe(true)
    // YAZ-5407: each row has its icon, as in a page's picker: the page row the sidebar's file icon, the card row the card icon.
    const option = (label: string) => [...document.querySelectorAll<HTMLElement>(`.${WIKILINK_PICKER_CLASS} [role="option"]`)].find((o) => o.textContent?.includes(label))!
    expect(option('Europe').querySelector('.file-icon')).not.toBeNull()
    expect(option('Estar').querySelector('.wikilink-picker__card-icon')).not.toBeNull()
    expect(option('Estar').dataset.card).toBe('true')
    document.querySelectorAll(`.${WIKILINK_PICKER_CLASS}`).forEach((p) => p.remove())
  })
})

/**
 * YAZ-5466: comments on a card file, the same as pages. The page's one `CommentsSection` under the card and its strip;
 * the file's front matter `comments` is its store (decision D: the file's, beside `kind: card`). Every comment write
 * keeps the card block and its card line byte for byte, and every card write keeps the comments. Comments are not
 * edits (Q56): while the tab is Read only, every comment write goes through with no "Allow edits?" and the tab stays locked.
 */
describe('comments on a card file (YAZ-5466)', () => {
  const ENTRIES =
    'comments:\n  - id: aaaaaaaa\n    n: 1\n    at: 2026-11-14T10:00:00Z\n    body: Is Paris right?\n  - id: bbbbbbbb\n    n: 2\n    at: 2026-11-14T11:00:00Z\n    body: Check the spelling\n'
  const WITH = `---\nkind: card\n${ENTRIES}---\n${CARD}`
  const cardPart = (content: string) => content.slice(content.indexOf('```card'))
  const block = () => el.querySelector<HTMLElement>('.card-file > section.comments')
  const open = () => {
    const header = block()!.querySelector<HTMLButtonElement>('button.comments__header')!
    if (header.getAttribute('aria-expanded') !== 'true') act(() => header.click())
  }
  const composer = () => block()!.querySelector<HTMLElement>(':scope > .comments__composer')!
  const textarea = (scope: ParentNode) => scope.querySelector<HTMLTextAreaElement>('textarea.comments__textarea')!
  const setValue = (field: HTMLTextAreaElement, value: string) =>
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, value)
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
  const submit = (scope: ParentNode) => act(() => scope.querySelector<HTMLButtonElement>('button.btn--primary')!.click())
  const items = () => [...block()!.querySelectorAll<HTMLElement>('article.comments__item')]
  const itemSaying = (text: string) => items().find((a) => a.textContent?.includes(text))!
  const action = (article: HTMLElement, label: string) => act(() => [...article.querySelectorAll<HTMLButtonElement>('.comments__action')].find((b) => b.textContent === label)!.click())
  const settle = () => act(async () => await new Promise((r) => setTimeout(r, 0)))
  const onDisk = () => disk.files.get(PATH)!
  const chip = () => el.querySelector<HTMLButtonElement>('.read-only-chip__button')
  const asks = () => el.querySelector('.read-only-chip__ask p')?.textContent ?? null
  const answer = (label: string) => act(() => [...el.querySelectorAll<HTMLButtonElement>('.read-only-chip__ask button')].find((b) => b.textContent === label)!.click())

  it('the block sits under the card and its strip, where a page has it: the page`s own component, its header "Comments (2)"', async () => {
    await mount(WITH, { comments: 'oldest' })
    expect(block()).not.toBeNull()
    // After the card and after its strip; the last thing in the tab's scroller.
    for (const before of ['.card-screen', '.card-reviews--strip']) expect(el.querySelector(before)!.compareDocumentPosition(block()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(block()!.nextElementSibling).toBeNull()
    // Round 3 (Yaseen: "not to the left and looking exactly like pages"): a page's shape, scroller › column, then the
    // comments in their own page column (`Editor`: `.editor-host` › `.editor-instance`, then `.comments`). Never inside
    // the card's column, where Card width capped it and centred it.
    expect(block()!.parentElement!.matches('.card-file[data-card-file-body]')).toBe(true)
    expect(block()!.previousElementSibling!.matches('.card-file__page')).toBe(true)
    expect(el.querySelector('.card-file__page section.comments')).toBeNull()
    expect(block()!.querySelector('.comments__title')?.textContent).toBe('Comments (2)')
    expect(items().map((a) => a.querySelector('.comments__summary')?.textContent)).toEqual(['Is Paris right?', 'Check the spelling'])
    // Not in the card itself, nor in the strip.
    expect(el.querySelector('.card section.comments, .card-reviews section.comments')).toBeNull()
  })

  it('no order setting handed down: no block (a card shown anywhere else has no comments)', async () => {
    await mount(WITH)
    expect(el.querySelector('section.comments')).toBeNull()
  })

  it('write: the comment goes in the front matter after `kind: card`; the card block and line stay byte for byte', async () => {
    await mount(FILE, { comments: 'oldest' })
    open()
    setValue(textarea(composer()), 'First, on a card')
    submit(composer())
    await settle()
    expect(onDisk().startsWith('---\nkind: card\ncomments:\n')).toBe(true)
    expect(cardPart(onDisk())).toBe(CARD)
    expect(readComments(onDisk()).map((c) => c.body)).toEqual(['First, on a card'])
    expect(items()).toHaveLength(1)
  })

  it('reply, edit your own, resolve (the Resolved group), reopen, delete (confirm): each keeps the card part byte for byte', async () => {
    await mount(WITH, { comments: 'oldest' })
    open()
    // Reply.
    action(itemSaying('Is Paris right?'), 'Reply')
    const reply = block()!.querySelector<HTMLElement>('.comments__replies .comments__composer')!
    setValue(textarea(reply), 'Yes, Paris.')
    submit(reply)
    await settle()
    expect(readComments(onDisk()).find((c) => c.body === 'Yes, Paris.')?.reply_to).toBe('aaaaaaaa')
    expect(cardPart(onDisk())).toBe(CARD)
    // Edit.
    action(itemSaying('Check the spelling'), 'Edit')
    const edit = itemSaying('Check the spelling').querySelector<HTMLElement>('.comments__composer')!
    setValue(textarea(edit), 'Check the spelling again')
    submit(edit)
    await settle()
    expect(readComments(onDisk()).find((c) => c.id === 'bbbbbbbb')?.body).toBe('Check the spelling again')
    expect(cardPart(onDisk())).toBe(CARD)
    // Resolve: the thread goes to the Resolved group.
    action(itemSaying('Check the spelling again'), 'Resolve')
    await settle()
    expect(readComments(onDisk()).find((c) => c.id === 'bbbbbbbb')?.resolved).toBeDefined()
    expect(cardPart(onDisk())).toBe(CARD)
    await act(async () => await new Promise((r) => setTimeout(r, 0)))
    // Reopen it from the group.
    act(() => block()!.querySelector<HTMLButtonElement>('.comments__resolved-link')?.click())
    await vi.waitFor(() => expect(block()!.querySelector('.comments__list--resolved')).not.toBeNull())
    action(block()!.querySelector<HTMLElement>('.comments__list--resolved article.comments__item')!, 'Reopen')
    await settle()
    expect(readComments(onDisk()).find((c) => c.id === 'bbbbbbbb')?.resolved).toBeUndefined()
    // Delete, after the sheet's confirm: the thread and its reply go.
    action(itemSaying('Is Paris right?'), 'Delete')
    act(() => [...document.querySelectorAll<HTMLButtonElement>('.confirm__btn')].find((b) => b.textContent?.trim() === 'Delete')!.click())
    await settle()
    expect(readComments(onDisk()).map((c) => c.id)).toEqual(['bbbbbbbb'])
    expect(cardPart(onDisk())).toBe(CARD)
    expect(onDisk().startsWith('---\nkind: card\ncomments:\n')).toBe(true)
  })

  it('the order setting: the header toggle writes it through the door; "newest" reads the stream backwards', async () => {
    const { onChangeCommentsOrder } = await mount(WITH, { comments: 'oldest' })
    open()
    act(() => [...block()!.querySelectorAll<HTMLButtonElement>('button.comments__tool')].find((b) => b.textContent === 'Oldest first')!.click())
    expect(onChangeCommentsOrder).toHaveBeenCalledWith('newest')
    act(() => root?.unmount())
    el.remove()
    await mount(WITH, { comments: 'newest' })
    expect(items().map((a) => a.querySelector('.comments__summary')?.textContent)).toEqual(['Check the spelling', 'Is Paris right?'])
  })

  it('Edit card and Done keep the comments byte for byte', async () => {
    await mount(WITH, { comments: 'oldest' })
    act(() => editButton()!.click())
    const dom = await cardEditor()
    const view = cardBlockViewOfDom(dom.closest('.card'))!.cardEditor!.view()!
    act(() => view.dispatch(view.state.tr.insertText(' (Seine)', view.state.doc.content.size - 1)))
    key(dom, { key: 'Enter', metaKey: true })
    await vi.waitFor(() => expect(onDisk()).toBe(WITH.replace('Paris\n```', 'Paris (Seine)\n```')))
  })

  it('⋯ › Archive card and Fix later keep the comments byte for byte', async () => {
    await mount(WITH, { comments: 'oldest' })
    await menu()
    pick('Archive card')
    await vi.waitFor(() => expect(onDisk()).toBe(WITH.replace('title "Capital of France" -->', 'title "Capital of France", off -->')))
    await menu()
    pick('Fix later')
    await vi.waitFor(() => expect(onDisk()).toContain(`---\nkind: card\n${ENTRIES}---\n`))
    expect(onDisk()).toContain(', fix')
  })

  it('`comments` is never a card property: the strip`s Properties lists only the card line`s', async () => {
    await mount(WITH.replace('title "Capital of France" -->', 'title "Capital of France", level "A2" -->'), { comments: 'oldest' })
    const button = () => el.querySelector<HTMLButtonElement>('.card-file__properties')!
    await vi.waitFor(() => expect(button()).not.toBeNull())
    expect(button().getAttribute('aria-label')).toBe('Properties (1)')
    act(() => button().click())
    await vi.waitFor(() => expect(el.querySelector('.card-reviews--strip .frontmatter-panel--card')).not.toBeNull())
    expect([...el.querySelectorAll<HTMLElement>('.frontmatter-panel--card .frontmatter-panel__row')].map((r) => r.dataset.key)).toEqual(['level'])
  })

  it('a write lands on the NEWEST bytes: an outside change to the card line made after the tab opened stays', async () => {
    await mount(WITH, { comments: 'oldest' })
    open()
    disk.files.set(PATH, WITH.replace('title "Capital of France" -->', 'title "Capital of France", next -->'))
    setValue(textarea(composer()), 'After an outside change')
    submit(composer())
    await settle()
    expect(onDisk()).toContain('title "Capital of France", next -->')
    expect(readComments(onDisk()).map((c) => c.body)).toEqual(['Is Paris right?', 'Check the spelling', 'After an outside change'])
  })

  it('a broken `comments` block: the one line that says why, no composer, nothing overwritten', async () => {
    const broken = `---\nkind: card\ncomments: my own notes\n---\n${CARD}`
    await mount(broken, { comments: 'oldest' })
    open()
    expect(block()!.querySelector('.comments__notice')?.textContent).toContain("isn't a comment list")
    expect(block()!.querySelector('.comments__composer')).toBeNull()
    expect(onDisk()).toBe(broken)
  })

  it('a Windows (CRLF) card file: a comment keeps its line ends and its card part', async () => {
    const crlf = WITH.replace(/\n/g, '\r\n')
    await mount(crlf, { comments: 'oldest' })
    open()
    setValue(textarea(composer()), 'From Windows')
    submit(composer())
    await settle()
    expect(onDisk().replace(/\r\n/g, '')).not.toContain('\n')
    expect(cardPart(onDisk())).toBe(CARD.replace(/\n/g, '\r\n'))
  })

  /** Q56 (Yaseen): comments are not edits. Read only never asks for one; the tab stays locked; the card part never moves. */
  describe('Read only: comment writes never ask "Allow edits?" (Q56)', () => {
    const stillLocked = () => {
      expect(asks()).toBeNull()
      // The chip reads "Read only" only while locked; an unlocked tab reads its time ("Editing …").
      expect(chip()?.textContent).toContain('Read only')
    }

    it('a read-only vault: Comment writes at once with no ask; the tab stays locked; the card part byte for byte', async () => {
      await mount(WITH, { comments: 'oldest', readOnly: true, pane: true })
      open()
      stillLocked()
      setValue(textarea(composer()), 'Written while locked')
      submit(composer())
      expect(asks()).toBeNull()
      await vi.waitFor(() => expect(readComments(onDisk()).map((c) => c.body)).toContain('Written while locked'))
      await vi.waitFor(() => expect(textarea(composer()).value).toBe(''))
      expect(cardPart(onDisk())).toBe(CARD)
      stillLocked()
      // The card itself is still guarded: Edit card shows the chip's "This card is Read only." and opens no editor.
      act(() => editButton()!.click())
      expect(el.querySelector('.read-only-message__card')?.textContent).toBe('This card is Read only.Press Enter to allow edits.')
      expect(el.querySelector('[data-explore-card-edit]')).toBeNull()
    })

    it('a read-only vault: reply, edit your own, resolve, reopen, delete: none asks; each keeps the card part byte for byte; the tab stays locked', async () => {
      await mount(WITH, { comments: 'oldest', readOnly: true, pane: true })
      open()
      // Reply.
      action(itemSaying('Is Paris right?'), 'Reply')
      expect(asks()).toBeNull()
      const reply = block()!.querySelector<HTMLElement>('.comments__replies .comments__composer')!
      setValue(textarea(reply), 'Yes, Paris.')
      submit(reply)
      await settle()
      expect(readComments(onDisk()).find((c) => c.body === 'Yes, Paris.')?.reply_to).toBe('aaaaaaaa')
      expect(cardPart(onDisk())).toBe(CARD)
      stillLocked()
      // Edit.
      action(itemSaying('Check the spelling'), 'Edit')
      expect(asks()).toBeNull()
      const edit = itemSaying('Check the spelling').querySelector<HTMLElement>('.comments__composer')!
      setValue(textarea(edit), 'Check the spelling again')
      submit(edit)
      await settle()
      expect(readComments(onDisk()).find((c) => c.id === 'bbbbbbbb')?.body).toBe('Check the spelling again')
      expect(cardPart(onDisk())).toBe(CARD)
      stillLocked()
      // Resolve.
      action(itemSaying('Check the spelling again'), 'Resolve')
      expect(asks()).toBeNull()
      await settle()
      expect(readComments(onDisk()).find((c) => c.id === 'bbbbbbbb')?.resolved).toBeDefined()
      expect(cardPart(onDisk())).toBe(CARD)
      await settle()
      // Reopen from the Resolved group.
      act(() => block()!.querySelector<HTMLButtonElement>('.comments__resolved-link')?.click())
      await vi.waitFor(() => expect(block()!.querySelector('.comments__list--resolved')).not.toBeNull())
      action(block()!.querySelector<HTMLElement>('.comments__list--resolved article.comments__item')!, 'Reopen')
      expect(asks()).toBeNull()
      await settle()
      expect(readComments(onDisk()).find((c) => c.id === 'bbbbbbbb')?.resolved).toBeUndefined()
      expect(cardPart(onDisk())).toBe(CARD)
      // Delete, after the sheet's own confirm (that sheet is the delete's, not Read only's).
      action(itemSaying('Is Paris right?'), 'Delete')
      expect(asks()).toBeNull()
      act(() => [...document.querySelectorAll<HTMLButtonElement>('.confirm__btn')].find((b) => b.textContent?.trim() === 'Delete')!.click())
      await settle()
      expect(readComments(onDisk()).map((c) => c.id)).toEqual(['bbbbbbbb'])
      expect(cardPart(onDisk())).toBe(CARD)
      expect(onDisk().startsWith('---\nkind: card\ncomments:\n')).toBe(true)
      stillLocked()
    })

    it('a read-only vault: typing in a comment field types (nothing is held back) and asks nothing', async () => {
      await mount(WITH, { comments: 'oldest', readOnly: true, pane: true })
      open()
      const field = textarea(composer())
      const event = new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: 'x' })
      act(() => void field.dispatchEvent(event))
      expect(event.defaultPrevented).toBe(false)
      stillLocked()
    })

    it('a `readonly: true` card file: a comment writes at once with no ask; `readonly: true` stays; the tab stays locked', async () => {
      const locked = WITH.replace('kind: card\n', 'kind: card\nreadonly: true\n')
      await mount(locked, { comments: 'oldest', pane: true })
      open()
      stillLocked()
      setValue(textarea(composer()), 'On a locked file')
      submit(composer())
      expect(asks()).toBeNull()
      await vi.waitFor(() => expect(readComments(onDisk()).map((c) => c.body)).toContain('On a locked file'))
      expect(onDisk()).toContain('readonly: true')
      expect(cardPart(onDisk())).toBe(CARD)
      stillLocked()
    })
  })
})
