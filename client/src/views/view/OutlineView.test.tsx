/**
 * The folder page's OUTLINE view (YAZ-903 — 🔒 D4 of YAZ-818 as YAZ-867 amended it). Mounted
 * through the REAL host (`FolderPageContents` → `ViewsPane`), the same harness 5.1's tests use, so
 * the routing — `type: outline` INSIDE the folder-page mode and nowhere else — is proven by the
 * editor appearing at all, and every write travels the real door it will travel in the app.
 *
 * `OutlineEditor` itself is STUBBED here (a real Crepe instance in jsdom is slow, and the lock, the
 * seeding and the debounce are pinned next door in `OutlineEditor.test.tsx`): the stub renders the
 * markdown it was handed and hands back the `onChange` a debounced edit would call.
 *
 * Pinned here: the seed is `view.outline`, or the [D5] `order` frozen into a document when there is
 * none; one edit is ONE settings write that stores the document AND retires `order`; a link line
 * that appeared tags its page (never this folder page itself); a link line that vanished only asks,
 * through the sheet, one page at a time — Confirm un-tags, Cancel keeps the belonging and is never
 * asked again; and a member the document does not name still shows, in the appended section, with
 * its glyph, its count and its own ×.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IndexRecord } from '@shared/types'
import { resolverFor } from '../engine'
import { createWikilinkResolveSource, type MutableWikilinkResolveSource } from '../../editor/wikilink/wikilinkPlugin'
import { parseViews } from '../viewSchema'
import { ViewsPane } from '../ViewsPane'
import { FolderPageContents } from '../FolderPageContents'
import { folderPageSettings } from '../folderPageSettings'
import { removeMemberMessage } from './ConfirmRemoveMember'
import type { OutlineEditorProps } from './OutlineEditor'

vi.mock('../writeProperty', () => ({ writeProperty: vi.fn() }))
vi.mock('../../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api')>()),
  api: { readFile: vi.fn(), createDir: vi.fn(), createFile: vi.fn() },
}))
/** The editor, stubbed: what it was seeded with, and the door a debounced edit comes back through. */
const editor = vi.hoisted(() => ({ props: null as OutlineEditorProps | null }))
vi.mock('./OutlineEditor', () => ({
  OutlineEditor: (props: OutlineEditorProps) => {
    editor.props = props
    return <pre className="outline-doc">{props.markdown}</pre>
  },
}))

import { api, BridgeRequestError } from '../../api'
import { writeProperty } from '../writeProperty'

const write = vi.mocked(writeProperty)
const readFile = vi.mocked(api.readFile)
const createDir = vi.mocked(api.createDir)
const createFile = vi.mocked(api.createFile)

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

// ---------- the vault ----------

const rec = (path: string, properties: Record<string, unknown> = {}): IndexRecord => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const rel = path.slice('/vault/'.length)
  return {
    path,
    name,
    basename: name.replace(/\.md$/, ''),
    folder: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '',
    ext: 'md',
    size: 0,
    ctime: 0,
    mtime: 1,
    properties,
    aliases: [],
    tags: [],
    links: [],
    embeds: [],
  }
}

const FUNNELS = '/vault/Funnel Stages.md'
const LEAD = '/vault/stages/Lead Gen.md'
const NURTURE = '/vault/stages/Nurture.md'
const SALES = '/vault/stages/Sales.md'
const OTHER = '/vault/Other.md'
const KPIS = '/vault/KPIs.md'

const OUTLINE = { type: 'outline', name: 'Outline' }
const TABLE = { type: 'table', name: 'Table', order: ['file.name'] }
const SETTINGS = { columns: {}, folder: 'stages', views: [OUTLINE, TABLE] }

/**
 * The folder page, three members (one of them ALSO in a second folder page, so the remove sheet
 * has something to name), a second folder page nobody here belongs to, and one loose page.
 */
function vault(settings: unknown = SETTINGS): IndexRecord[] {
  return [
    rec(FUNNELS, { folder_page: true, folder_page_settings: settings }),
    rec(KPIS, { folder_page: true }),
    rec(OTHER, { title: 'not a member' }),
    rec(LEAD, { folder_pages: ['[[Funnel Stages]]'] }),
    rec(NURTURE, { folder_pages: ['[[Funnel Stages]]', '[[KPIs]]'], note: 'keep me' }),
    rec(SALES, { folder_pages: ['[[Funnel Stages]]'] }),
  ]
}

/** `Alpha` is a folder page holding two pages, and belongs to this one — the glyph + count row. */
function nested(): IndexRecord[] {
  return [
    rec(FUNNELS, { folder_page: true, folder_page_settings: { views: [{ ...OUTLINE, outline: '- nothing yet' }, TABLE] } }),
    rec('/vault/Alpha.md', { folder_page: true, folder_pages: ['[[Funnel Stages]]'] }),
    rec('/vault/One.md', { folder_pages: ['[[Alpha]]'] }),
    rec('/vault/Two.md', { folder_pages: ['[[Alpha]]'] }),
  ]
}

// ---------- harness (FolderPageContents.test.tsx's, verbatim) ----------

let root: Root | null = null
let container: HTMLElement | null = null
let source: MutableWikilinkResolveSource
const onOpenFile = vi.fn()
const onOpenFileBackground = vi.fn()

function feed(records: IndexRecord[]): void {
  const resolve = resolverFor(records, '/vault')
  act(() => source.update((target) => resolve(target)?.record.path ?? null, records))
}

function mount(path = FUNNELS, records: IndexRecord[] = vault()): HTMLElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() =>
    root?.render(
      <FolderPageContents path={path} root="/vault" source={source} onOpenFile={onOpenFile} onOpenFileBackground={onOpenFileBackground} />,
    ),
  )
  feed(records)
  return container
}

beforeEach(() => {
  source = createWikilinkResolveSource()
  editor.props = null
  write.mockResolvedValue({ mtime: 2 })
  readFile.mockRejectedValue(new BridgeRequestError('NOT_FOUND', 'path does not exist')) // no template
  createDir.mockResolvedValue({ path: '/vault/stages' })
  createFile.mockResolvedValue({ path: '', mtime: 1, size: 0 })
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  vi.resetAllMocks()
})

// ---------- DOM helpers ----------

function q<T extends Element>(el: ParentNode, sel: string): T {
  const n = el.querySelector<T>(sel)
  if (n === null) throw new Error(`missing ${sel}`)
  return n
}

const all = <T extends Element>(el: ParentNode, sel: string): T[] => [...el.querySelectorAll<T>(sel)]
const texts = (el: ParentNode, sel: string): string[] => all(el, sel).map((n) => n.textContent ?? '')
/** The APPENDED members — everything the document does not name. */
const rowNames = (el: ParentNode): string[] => texts(el, '.view-outline__link')
const rowFor = (el: ParentNode, path: string): HTMLElement => q<HTMLElement>(el, `[data-outline-row="${path}"]`)
const byLabel = <T extends HTMLElement>(el: ParentNode, label: string): T => q<T>(el, `[aria-label="${label}"]`)
/** The document the editor was seeded with. */
const doc = (el: ParentNode): string => q(el, '.outline-doc').textContent ?? ''
/** One committed edit — what the editor's debounce hands back. */
const edit = (markdown: string): void => act(() => editor.props?.onChange(markdown))
const settingsWrites = () => write.mock.calls.filter((c) => c[1] === 'folder_page_settings')
const memberWrites = () => write.mock.calls.filter((c) => c[1] === 'folder_pages')
const sheetButton = (label: string): HTMLElement => all<HTMLElement>(document.body, '.confirm__btn').find((b) => b.textContent === label)!

function click(el: Element, init: MouseEventInit = {}): void {
  act(() => void el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init })))
}

async function flush(): Promise<void> {
  await act(async () => {})
}

// ---------- routing ----------

describe('the outline is the folder page’s skin — and only ever hers', () => {
  it('a folder page’s `type: outline` view renders the EDITOR, not the placeholder rows', () => {
    const el = mount()
    expect(el.querySelector('.view-outline')).not.toBeNull()
    expect(el.querySelector('.outline-doc')).not.toBeNull()
    expect(el.querySelector('.view-row__link')).toBeNull() // the old unknown-view placeholder
    expect(texts(el, '.view-tab__btn')).toEqual(['Outline', 'Table', 'Board'])
  })

  it('a null `thisFile` keeps the placeholder rows — there is no folder page to be an outline of', () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() =>
      root?.render(
        <ViewsPane
          parsed={parseViews('views:\n  - type: outline\n    name: Outline\n')}
          onChange={vi.fn()}
          root="/vault"
          thisFile={null}
          records={[rec(LEAD)]}
          folderPage={{ settings: folderPageSettings(rec(FUNNELS, { folder_page: true })), vaultRecords: vault(), create: () => Promise.reject(new Error('no')), setColumns: () => {} }}
          onOpenFile={onOpenFile}
        />,
      ),
    )
    expect(container.querySelector('.view-outline')).toBeNull()
    expect(texts(container, '.view-row__link')).toEqual(['Lead Gen.md'])
  })

  it('the Properties menu and search are not offered while it shows — a document has no columns and no rows to filter', () => {
    const el = mount()
    expect(el.querySelector('[aria-label="Properties"]')).toBeNull()
    expect(el.querySelector('[aria-label="Search"]')).toBeNull()
    const tab = all<HTMLElement>(el, '.view-tab__btn').find((b) => b.textContent === 'Table')!
    click(tab)
    expect(el.querySelector('[aria-label="Properties"]')).not.toBeNull() // the table keeps both
    expect(el.querySelector('[aria-label="Search"]')).not.toBeNull()
  })

  it('the editor is handed the window’s link feed, and a nav whose identity survives a re-render', () => {
    const el = mount()
    const first = editor.props
    expect(el.querySelector('.view-outline-editor')).toBeNull() // the stub stands in its place
    feed([...vault(), rec('/vault/Late.md')])
    // A new snapshot re-renders the block; a NEW nav object would remount the editor and eat the caret.
    expect(editor.props?.nav).toBe(first?.nav)
    expect(editor.props?.nav?.openCurrent).toBe(onOpenFile)
    expect(editor.props?.nav?.openBackground).toBe(onOpenFileBackground)
    expect(editor.props?.wikilinks).toBe(source)
  })
})

// ---------- the seed (🔒 D2 + the lazy migration) ----------

describe('the document is seeded once, from the card', () => {
  it('a stored `outline` is the document, verbatim', () => {
    const stored = '- [[Sales]]\n    - a note about it\n- free text'
    expect(doc(mount(FUNNELS, vault({ ...SETTINGS, views: [{ ...OUTLINE, outline: stored }, TABLE] })))).toBe(stored)
  })

  it('no `outline` migrates the [D5] `order`: its entries first, every unlisted member behind them', () => {
    const el = mount(FUNNELS, vault({ ...SETTINGS, views: [{ ...OUTLINE, order: ['[[Sales]]'] }, TABLE] }))
    expect(doc(el)).toBe('- [[Sales]]\n- [[Lead Gen]]\n- [[Nurture]]')
  })

  it('no order at all is every member, alphabetical — the arrangement `orderedMembers` gave', () => {
    expect(doc(mount())).toBe('- [[Lead Gen]]\n- [[Nurture]]\n- [[Sales]]')
  })

  it('a stale `order` entry rides along as the text it is, and the member still appears once', () => {
    const el = mount(FUNNELS, vault({ ...SETTINGS, views: [{ ...OUTLINE, order: ['[[Gone]]', '[[Nurture]]'] }, TABLE] }))
    expect(doc(el)).toBe('- [[Gone]]\n- [[Nurture]]\n- [[Lead Gen]]\n- [[Sales]]')
  })

  it('an empty stored document stays empty — the members ride the appended section instead', () => {
    const el = mount(FUNNELS, vault({ ...SETTINGS, views: [{ ...OUTLINE, outline: '' }, TABLE] }))
    expect(doc(el)).toBe('')
    expect(rowNames(el)).toEqual(['Lead Gen', 'Nurture', 'Sales'])
  })
})

// ---------- the commit (ONE settings write, and `order` retires) ----------

describe('an edit stores the document and retires the order', () => {
  it('the document lands on the FIRST outline view and takes `order` with it — ONE write', async () => {
    const el = mount(FUNNELS, vault({ ...SETTINGS, views: [{ ...OUTLINE, order: ['[[Sales]]'] }, TABLE] }))
    edit('- [[Sales]]\n- [[Lead Gen]]')
    await flush()

    expect(settingsWrites()).toHaveLength(1)
    const [path, , value] = settingsWrites()[0]
    expect(path).toBe(FUNNELS) // the FOLDER PAGE's card
    expect(value).toEqual({
      folder: 'stages',
      // The injected Board (YAZ-935) rides along in the write, harmlessly.
      views: [{ type: 'outline', name: 'Outline', outline: '- [[Sales]]\n- [[Lead Gen]]' }, TABLE, { type: 'board', name: 'Board' }],
    })
    expect(el.querySelector('.view-view__error')).toBeNull()
  })

  it('free text is just text: it stores, and it tags nobody', async () => {
    mount()
    edit('- [[Lead Gen]]\n- [[Nurture]]\n- [[Sales]]\n- read [[Other]] some day')
    await flush()
    expect(settingsWrites()).toHaveLength(1)
    expect(memberWrites()).toEqual([]) // a link INSIDE prose is not a link line (🔒 the click rule)
  })
})

// ---------- tagging (🔒 E1: a link line IS the belonging) ----------

describe('a link line that appears tags its page, at once', () => {
  it('the entry lands on the TARGET’s own card, preserving what was already there', async () => {
    mount()
    edit('- [[Lead Gen]]\n- [[Nurture]]\n- [[Sales]]\n- [[Other]]')
    await flush()
    expect(memberWrites()).toEqual([[OTHER, 'folder_pages', ['[[Funnel Stages]]']]])

    write.mockClear()
    mount(FUNNELS, vault().map((r) => (r.path === OTHER ? rec(OTHER, { folder_pages: ['[[KPIs]]'] }) : r)))
    edit('- [[Lead Gen]]\n- [[Nurture]]\n- [[Sales]]\n- [[Other]]')
    await flush()
    expect(memberWrites()).toEqual([[OTHER, 'folder_pages', ['[[KPIs]]', '[[Funnel Stages]]']]])
  })

  it('the folder page can not become its own member', async () => {
    mount()
    edit('- [[Funnel Stages]]\n- [[Lead Gen]]\n- [[Nurture]]\n- [[Sales]]')
    await flush()
    expect(memberWrites()).toEqual([])
  })

  it('a page that already belongs is not written at all — tagging is idempotent through the resolver', async () => {
    mount(FUNNELS, vault({ ...SETTINGS, views: [{ ...OUTLINE, outline: '' }, TABLE] }))
    edit('- [[lead gen]]') // a different SPELLING of a member: the resolver already counts it
    await flush()
    expect(memberWrites()).toEqual([])
  })

  it('a failed belonging write is reported in place and never takes the block down', async () => {
    write.mockRejectedValue(new Error('read-only vault'))
    const el = mount()
    edit('- [[Lead Gen]]\n- [[Nurture]]\n- [[Sales]]\n- [[Other]]')
    await flush()
    expect(q(el, '[role="alert"]').textContent).toContain('read-only vault')
  })
})

// ---------- un-tagging (🔒 sheet-gated, and cancel KEEPS) ----------

describe('the confirm copy is a pure function', () => {
  it('names where the page still lives', () => {
    expect(removeMemberMessage('Lead Gen', 'Funnel Stages', ['KPIs', 'Roadmap'])).toBe(
      "Remove 'Lead Gen' from 'Funnel Stages'? The page is not deleted — its file stays put. It remains in: KPIs, Roadmap.",
    )
  })

  it('names Uncategorized when this was its last folder page', () => {
    expect(removeMemberMessage('Lead Gen', 'Funnel Stages', [])).toBe(
      "Remove 'Lead Gen' from 'Funnel Stages'? The page is not deleted — its file stays put. It has no other folder pages, so it moves to Uncategorized.",
    )
  })
})

describe('a link line that vanishes only ASKS', () => {
  it('the sheet opens and nothing is un-tagged on the edit itself', async () => {
    mount()
    edit('- [[Lead Gen]]\n- [[Sales]]') // Nurture dropped
    await flush()
    expect(q(document.body, '[role="dialog"]').textContent).toContain('It remains in: KPIs.')
    expect(memberWrites()).toEqual([])
  })

  it('Confirm removes ONLY this folder page’s entry, on the member’s own card', async () => {
    mount()
    edit('- [[Lead Gen]]\n- [[Sales]]')
    click(sheetButton('Remove'))
    await flush()
    expect(memberWrites()).toEqual([[NURTURE, 'folder_pages', ['[[KPIs]]']]])
  })

  it('an entry that merely SPELLS the folder page is not a link, and is left alone', async () => {
    mount(FUNNELS, vault().map((r) => (r.path === LEAD ? rec(LEAD, { folder_pages: ['Funnel Stages', '[[Funnel Stages]]'] }) : r)))
    edit('- [[Nurture]]\n- [[Sales]]')
    click(sheetButton('Remove'))
    await flush()
    expect(memberWrites()).toEqual([[LEAD, 'folder_pages', ['Funnel Stages']]])
  })

  it('CANCEL KEEPS THE BELONGING — and the next edit does not ask again', async () => {
    const el = mount()
    edit('- [[Lead Gen]]\n- [[Sales]]')
    click(sheetButton('Cancel'))
    await flush()
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    expect(memberWrites()).toEqual([])
    // Still a member: its card was never touched, so it shows in the appended section.
    expect(rowNames(el)).toEqual(['Nurture'])

    // The document ADVANCED past the cancelled question: typing on does not re-open the sheet.
    edit('- [[Lead Gen]]\n- [[Sales]]\n- and now some prose')
    await flush()
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    expect(memberWrites()).toEqual([])
  })

  it('two pages dropped in ONE edit are asked one sheet at a time, in document order', async () => {
    mount()
    edit('- [[Sales]]') // Lead Gen and Nurture both gone
    expect(q(document.body, '[role="dialog"]').textContent).toContain("Remove 'Lead Gen'")
    click(sheetButton('Remove'))
    await flush()
    expect(q(document.body, '[role="dialog"]').textContent).toContain("Remove 'Nurture'")
    click(sheetButton('Cancel'))
    await flush()
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    expect(memberWrites()).toEqual([[LEAD, 'folder_pages', []]])
  })
})

// ---------- the appended section (tagged elsewhere still shows) ----------

describe('a member the document does not name still shows', () => {
  it('the rows are alphabetical, and only the members the document leaves out', () => {
    const el = mount(FUNNELS, vault({ ...SETTINGS, views: [{ ...OUTLINE, outline: '- [[Sales]]' }, TABLE] }))
    expect(rowNames(el)).toEqual(['Lead Gen', 'Nurture'])
    expect(el.textContent).not.toContain('Other') // never a member, never a row
  })

  it('a member that arrives on the next snapshot lands here — the document is not rewritten under the user', () => {
    const el = mount(FUNNELS, vault({ ...SETTINGS, views: [{ ...OUTLINE, outline: '- [[Sales]]' }, TABLE] }))
    feed([...vault({ ...SETTINGS, views: [{ ...OUTLINE, outline: '- [[Sales]]' }, TABLE] }), rec('/vault/stages/Expansion.md', { folder_pages: ['[[Funnel Stages]]'] })])
    expect(rowNames(el)).toEqual(['Expansion', 'Lead Gen', 'Nurture'])
    expect(doc(el)).toBe('- [[Sales]]')
  })

  it('a row that becomes a link line leaves the section on the next edit', async () => {
    const el = mount(FUNNELS, vault({ ...SETTINGS, views: [{ ...OUTLINE, outline: '- [[Sales]]' }, TABLE] }))
    edit('- [[Sales]]\n- [[Nurture]]')
    await flush()
    expect(rowNames(el)).toEqual(['Lead Gen'])
  })

  it('the glyph and the direct-member count ride folder-page rows ONLY', () => {
    const el = mount(FUNNELS, nested())
    expect(rowNames(el)).toEqual(['Alpha'])
    expect(texts(el, '.view-outline__count')).toEqual(['2'])

    const plain = mount(FUNNELS, vault({ ...SETTINGS, views: [{ ...OUTLINE, outline: '' }, TABLE] }))
    expect(plain.querySelector('.view-outline__glyph')).toBeNull()
    expect(plain.querySelector('.view-outline__count')).toBeNull()
  })

  it('a row opens its page — the standard two handlers', () => {
    const el = mount(FUNNELS, vault({ ...SETTINGS, views: [{ ...OUTLINE, outline: '' }, TABLE] }))
    click(q(rowFor(el, LEAD), '.view-outline__link'))
    expect(onOpenFile).toHaveBeenCalledExactlyOnceWith(LEAD)
    expect(onOpenFileBackground).not.toHaveBeenCalled()

    click(q(rowFor(el, SALES), '.view-outline__link'), { metaKey: true })
    expect(onOpenFileBackground).toHaveBeenCalledExactlyOnceWith(SALES)
    expect(onOpenFile).toHaveBeenCalledTimes(1)
  })

  it('the × opens the same sheet, and only Confirm writes', async () => {
    const el = mount(FUNNELS, vault({ ...SETTINGS, views: [{ ...OUTLINE, outline: '' }, TABLE] }))
    click(byLabel(el, 'Remove Nurture from Funnel Stages'))
    expect(q(document.body, '[role="dialog"]').textContent).toContain('It remains in: KPIs.')
    expect(write).not.toHaveBeenCalled()

    click(sheetButton('Remove'))
    await flush()
    expect(memberWrites()).toEqual([[NURTURE, 'folder_pages', ['[[KPIs]]']]])
  })
})

// ---------- sync from folder (YAZ-953) ----------

/**
 * The toolbar's button opens the sheet the OUTLINE owns, and approving appends through `commit` —
 * the one door — so the very pass that stores the document tags every newly-linked note. The
 * vault root is the folder used here on purpose: its notes (`KPIs`, `Other`) are not members yet,
 * so the tagging is visible, and the folder page itself is never offered among them.
 */
describe('sync from folder appends through the outline’s one door', () => {
  /** The sheet's folder row, by the name it shows — `Vault root` for the root itself. */
  const folderRow = (folder: string): HTMLElement =>
    all<HTMLElement>(document.body, '.sync__folder').find((b) => b.firstElementChild?.textContent === folder)!

  const openSheet = (el: ParentNode, folder: string): void => {
    click(byLabel(el, 'Sync from folder'))
    click(folderRow(folder))
  }

  it('the approved links land as depth-0 bullets at the END, and each newly-linked note is tagged', async () => {
    const el = mount()
    openSheet(el, 'Vault root')
    click(sheetButton('Add'))
    await flush()

    expect(doc(el)).toBe('- [[Lead Gen]]\n- [[Nurture]]\n- [[Sales]]\n- [[KPIs]]\n- [[Other]]')
    expect(settingsWrites()).toHaveLength(1)
    // THE POINT (🔒 YAZ-950): the append travelled `commit`, so belonging synced for free.
    expect(memberWrites()).toEqual([
      [KPIS, 'folder_pages', ['[[Funnel Stages]]']],
      [OTHER, 'folder_pages', ['[[Funnel Stages]]']],
    ])
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  })

  it('the document above is kept byte-for-byte — the markers, the blank line and the prose all survive', async () => {
    const stored = '* [[Sales]]\n\n  free text about it'
    const el = mount(FUNNELS, vault({ ...SETTINGS, views: [{ ...OUTLINE, outline: stored }, TABLE] }))
    openSheet(el, 'Vault root')
    click(sheetButton('Add'))
    await flush()
    expect(doc(el)).toBe(`${stored}\n- [[KPIs]]\n- [[Other]]`)
  })

  it('a folder with nothing missing offers no Add at all, and dismissing writes nothing', async () => {
    const el = mount()
    openSheet(el, 'stages')
    expect(q(document.body, '[role="dialog"]').textContent).toContain('Nothing to add')
    expect(texts(document.body, '.confirm__btn')).toEqual(['Dismiss'])
    click(sheetButton('Dismiss'))
    await flush()
    expect(doc(el)).toBe('- [[Lead Gen]]\n- [[Nurture]]\n- [[Sales]]')
    expect(write).not.toHaveBeenCalled()
  })

  it('Cancel writes nothing at all', async () => {
    const el = mount()
    openSheet(el, 'Vault root')
    click(sheetButton('Cancel'))
    await flush()
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    expect(doc(el)).toBe('- [[Lead Gen]]\n- [[Nurture]]\n- [[Sales]]')
    expect(write).not.toHaveBeenCalled()
  })
})
