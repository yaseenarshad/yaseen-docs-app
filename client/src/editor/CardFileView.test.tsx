/**
 * The card file tab (YAZ-5037 phase 3): a file with `kind: card` shows its card, not a page. The tab takes the file
 * the editor read (no read of its own on open), reads again on each new index version, says what is wrong with a file
 * that is not valid (and deletes nothing), hands a file that lost `kind: card` back to the page view, and writes Edit
 * card's Done by the card's ID on the newest bytes, as the card window does. Against the real card editor.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { FileResponse, IndexRecord } from '@shared/types'
import { createWikilinkResolveSource } from './wikilink/wikilinkPlugin'
import { CardFileView } from './CardFileView'
import { noteCardViewOfDom } from './noteCard/noteCardView'
import { VaultReadOnly } from '../vault/readOnlyVault'
import { useReviewSettings } from '../review/useReviewSettings'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const ROOT = '/v'
const PATH = '/v/Geography/capital-of-france-wiki-9.md'
const CARD = '```card\nCapital of {{France}}\n---\nParis\n```\n<!-- card: WIKI-9 -->\n'
const FILE = `---\nkind: card\n---\n${CARD}`
const disk = vi.hoisted(() => ({ files: new Map<string, string>(), reads: 0, review: { enabled: true } as Record<string, unknown> }))

vi.mock('../api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../api')>()
  return {
    ...real,
    api: {
      ...real.api,
      readFile: vi.fn(async (path: string) => {
        disk.reads++
        const content = disk.files.get(path)
        if (content === undefined) throw new real.BridgeRequestError('NOT_FOUND', 'gone')
        return { path, content, mtime: 1, size: content.length }
      }),
      vaultConfig: { read: vi.fn(async () => disk.review), write: vi.fn(), onChange: vi.fn(() => () => undefined) },
      shell: { openLink: vi.fn() },
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
  rec(PATH, { mtime, kind: 'card', cards: [{ id: 'WIKI-9', off: false, next: false, reviews: [], title: 'Capital of France' }] }),
  rec('/v/notes.md', { links: ['WIKI-9'] }),
  rec('/v/europe.md', { embeds: ['WIKI-9'] }),
  rec('/v/trips.md', { embeds: ['wiki-9'] }),
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

async function mount(content: string, opts: { readOnly?: boolean; review?: boolean; allow?: boolean } = {}) {
  disk.files.set(PATH, content)
  if (opts.review === false) disk.review = { enabled: false }
  const file: FileResponse = { path: PATH, content, mtime: 1, size: content.length }
  const onPage = vi.fn()
  const onNotice = vi.fn()
  const onOpenFile = vi.fn()
  const onReread = vi.fn()
  const allowFileAction = vi.fn(async () => opts.allow !== false)
  el = document.createElement('div')
  document.body.append(el)
  root = createRoot(el)
  await act(async () =>
    root?.render(
      <VaultReadOnly.Provider value={{ on: opts.readOnly === true, allowFileAction }}>
        <ReviewScope />
        <CardFileView file={file} root={ROOT} wikilinks={wikilinks} onOpenFile={onOpenFile} onNotice={onNotice} onPage={onPage} onReread={onReread} />
      </VaultReadOnly.Provider>,
    ),
  )
  await vi.waitFor(() => expect(el.querySelector('[data-card-file]')).not.toBeNull())
  return { onPage, onNotice, onOpenFile, onReread, allowFileAction }
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
  it('shows the path, the title, the ID, the state, the card, "Linked mentions (1)" and "Embedded in (2)"; no notice; no read of its own on open', async () => {
    await mount(FILE)
    expect(disk.reads).toBe(0)
    expect(el.querySelector('.card-file__path')?.textContent).toBe('Geography')
    expect(el.querySelector('.card-file__title')?.textContent).toBe('Capital of France')
    expect(el.querySelector('[data-card-file] .note-card__id')?.textContent).toBe('WIKI-9')
    await vi.waitFor(() => expect(el.querySelector('.card-file__state')?.textContent).toBe('New'))
    expect(el.querySelector('.note-card-screen')?.textContent).toContain('Paris')
    expect(notice()).toBeNull()
    expect(el.querySelector('.note-card-backlinks .backlinks__title')?.textContent).toBe('Linked mentions (1)')
    expect(el.querySelector('.card-file__embeds .backlinks__title')?.textContent).toBe('Embedded in (2)')
    expect(el.querySelector('.card-file__embeds')?.textContent).toContain('europe')
    // The tab is the card's own page: none of the card window's words for a separate page.
    expect(el.textContent).not.toContain('Open page')
  })

  it('⋯: Put at top of Inbox, Archive card, Title on the front, Copy card ID, Copy card link — no Open page, no Open as page; Copy card link copies [[ID]]', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    await mount(FILE)
    await vi.waitFor(() => expect(el.querySelector('.card-file__state')?.textContent).toBe('New'))
    const rows = await menu()
    expect(rows).toEqual(['Put at top of Inbox', 'Archive card', 'Title on the front', 'Copy card ID', 'Copy card link', 'Turn into a page'])
    pick('Copy card link')
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('[[WIKI-9]]'))
  })

  it('Archive card writes `off` on the card line; the head then says "Archived"', async () => {
    await mount(FILE)
    await menu()
    pick('Archive card')
    await vi.waitFor(() => expect(disk.files.get(PATH)).toBe(FILE.replace('<!-- card: WIKI-9 -->', '<!-- card: WIKI-9, off -->')))
    await vi.waitFor(() => expect(el.querySelector('.card-file__state')?.textContent).toBe('Archived'))
  })

  it('with the vault`s Review off nothing asks you to review it: no due state, no Inbox row, no Reviews', async () => {
    const reviewed = FILE.replace('<!-- card: WIKI-9 -->', '<!-- card: WIKI-9, 2026-11-01T09:00Z good -->')
    await mount(reviewed, { review: false })
    // Give the settings their read: they stay off.
    await act(async () => undefined)
    expect(el.querySelector('.card-file__state')).toBeNull()
    expect(el.querySelector('.note-card-reviews')).toBeNull()
    expect(el.textContent).not.toContain('Due')
    const rows = await menu()
    expect(rows).not.toContain('Put at top of Inbox')
    expect(rows).toContain('Archive card')
  })

  it('with Review on, a reviewed card says when it is due, and its history shows', async () => {
    await mount(FILE.replace('<!-- card: WIKI-9 -->', '<!-- card: WIKI-9, 2026-11-01T09:00Z good -->'))
    await vi.waitFor(() => expect(el.querySelector('.card-file__state')?.textContent).toMatch(/^Due /))
    expect(el.querySelector('.note-card-reviews .backlinks__title')?.textContent).toBe('1 Review')
  })
})

describe('the notices of a card file that is not valid (nothing deleted)', () => {
  it('2+ cards: "This card file holds 3 cards.", the first card under it, and "Split into 3 card files"', async () => {
    const many = `${FILE}\n\`\`\`card\nSecond\n\`\`\`\n<!-- card: WIKI-10 -->\n\n\`\`\`card\nThird\n\`\`\`\n<!-- card: WIKI-11 -->\n`
    await mount(many)
    expect(notice()?.querySelector('.card-file-notice__text')?.textContent).toBe('This card file holds 3 cards.')
    expect(fixes()).toEqual(['Split into 3 card files'])
    expect(el.querySelector('.note-card-screen')?.textContent).toContain('Paris')
    expect(el.querySelector('.note-card-screen')?.textContent).not.toContain('Second')
  })

  it('text outside the card: "This card file has text outside the card.", that text shown below, muted', async () => {
    await mount(`---\nkind: card\n---\nA note above.\n\n${CARD}\nA note below.\n`)
    expect(notice()?.querySelector('.card-file-notice__text')?.textContent).toBe('This card file has text outside the card.')
    expect(fixes()).toEqual(['Move into the card'])
    expect(el.querySelector('.card-file__outside')?.textContent).toContain('A note above.')
    expect(el.querySelector('.card-file__outside')?.textContent).toContain('A note below.')
    expect(el.querySelector('.note-card-screen')?.textContent).toContain('Paris')
  })

  it('no card: "This card file has no card.", its text shown muted, no Edit card', async () => {
    await mount('---\nkind: card\n---\nJust some words.\n')
    expect(notice()?.querySelector('.card-file-notice__text')?.textContent).toBe('This card file has no card.')
    expect(fixes()).toEqual(['Make a card from the text', 'Turn into a page'])
    expect(el.querySelector('.card-file__outside')?.textContent).toContain('Just some words.')
    expect(el.querySelector('.note-card-screen')).toBeNull()
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
  await vi.waitFor(() => expect(el.querySelector('[data-explore-card-edit] .note-card__editor .ProseMirror')).not.toBeNull())
  const dom = el.querySelector<HTMLElement>('[data-explore-card-edit] .note-card__editor .ProseMirror')!
  await vi.waitFor(() => expect(dom.textContent).toContain('Paris'))
  return dom
}

describe('Edit card in the tab (the card editor, YAZ-5026)', () => {
  it('Edit card (or E) opens the card editor; ⌘↵ is Done: the card`s text lands by its ID, the rest of the file the same', async () => {
    await mount(FILE)
    act(() => editButton()!.click())
    const dom = await cardEditor()
    const view = noteCardViewOfDom(dom.closest('.note-card'))!.cardEditor!.view()!
    act(() => view.dispatch(view.state.tr.insertText(' (Seine)', view.state.doc.content.size - 1)))
    key(dom, { key: 'Enter', metaKey: true })
    await vi.waitFor(() => expect(disk.files.get(PATH)).toBe(FILE.replace('Paris\n```', 'Paris (Seine)\n```')))
    await vi.waitFor(() => expect(el.querySelector('[data-explore-card-edit]')).toBeNull())
    await vi.waitFor(() => expect(el.querySelector('.note-card-screen')?.textContent).toContain('Paris (Seine)'))
  })

  it('an outside change to the same card while you edit: the editor stays; Done writes your text by the card`s ID on the NEWEST bytes (the card window`s rule: the outside change to the rest of the file stays, yours wins in the card)', async () => {
    const { onPage } = await mount(FILE)
    key(el.querySelector('[data-card-file-body]')!, { key: 'e' })
    const dom = await cardEditor()
    // An agent writes the same card's text and a property, and reviews it.
    const outside = `---\nkind: card\ntags: geo\n---\n${CARD.replace('Paris', 'Paris!').replace('<!-- card: WIKI-9 -->', '<!-- card: WIKI-9, 2026-11-01T09:00Z good -->')}`
    disk.files.set(PATH, outside)
    indexSees(2)
    await act(async () => undefined)
    expect(el.querySelector('[data-explore-card-edit] .note-card__editor .ProseMirror')).toBe(dom)
    const view = noteCardViewOfDom(dom.closest('.note-card'))!.cardEditor!.view()!
    act(() => view.dispatch(view.state.tr.insertText(' (Seine)', view.state.doc.content.size - 1)))
    key(dom, { key: 'Enter', metaKey: true })
    await vi.waitFor(() => expect(disk.files.get(PATH)).toBe(outside.replace('Paris!\n```', 'Paris (Seine)\n```')))
    expect(onPage).not.toHaveBeenCalled()
  })

  it('a read-only vault: no Edit card, and E does nothing', async () => {
    await mount(FILE, { readOnly: true })
    expect(editButton()).toBeNull()
    key(el.querySelector('[data-card-file-body]')!, { key: 'e' })
    expect(el.querySelector('[data-explore-card-edit]')).toBeNull()
  })

  it('a `readonly: true` card file: no Edit card; ⋯ still writes (archive, as reviews do)', async () => {
    const locked = FILE.replace('kind: card\n', 'kind: card\nreadonly: true\n')
    await mount(locked)
    expect(editButton()).toBeNull()
    key(el.querySelector('[data-card-file-body]')!, { key: 'e' })
    expect(el.querySelector('[data-explore-card-edit]')).toBeNull()
    await menu()
    pick('Archive card')
    await vi.waitFor(() => expect(disk.files.get(PATH)).toContain('<!-- card: WIKI-9, off -->'))
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
