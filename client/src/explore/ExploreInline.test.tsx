/**
 * Integration tests for YAZ-6470 (#3A, #5, #8, #9):
 * - #3A: Clicking an inline drawing in Explore stays inside Explore (`ExploreBoard` with `inlineJson`, `Show in page`, `⌘↵` to tab).
 * - #5: Explore Search right-click menus for inline drawings and inline cards, plus `toTab` card/drawing landing.
 * - #8: Explore `‹ ›` stepping across pages, inline cards, inline drawings, and standalone boards.
 * - #9: `ExplorePage` read-mode inline drawing menu actions (`onCopyPath`, `onOpenInTab`) and `'drawing'` read-only edit transition.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { act, useContext } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IndexRecord } from '@shared/types'
import { TitleRowControls } from '../editor/PageFrame'
import { createWikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import type { WatchSource } from '../hooks/useWatch'
import type { SearchVault } from '../search/useSearchResults'
import { takeCardLanding } from '../editor/card/cardOpen'
import { takeInlineDrawingLanding } from '../editor/drawing/inlineDrawingLand'
import { tellReadOnlyEdit } from '../editor/readOnlyEdit'
import { resetExploreRecents } from './exploreRecents'
import { ExploreStack, type ExploreStackProps } from './ExploreStack'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

type Crepe = {
  opts: Record<string, unknown> & {
    root: HTMLElement
    defaultValue?: string
    inlineDrawing?: {
      root: string | null
      pagePath?: string | null
      onCopyPath?: (index: number) => void
      onOpenInTab?: (index: number, background: boolean) => void
    }
  }
  create: Mock
  setReadonly: Mock
  destroy: Mock
}

const { readFile, writeFile, index, openLink, crepes, copyText, landed } = vi.hoisted(() => ({
  readFile: vi.fn<(path: string) => Promise<{ path: string; content: string; mtime: number; size: number }>>(),
  writeFile: vi.fn<(req: { path: string; content: string }) => Promise<{ path: string; mtime: number; size: number }>>(),
  index: vi.fn(),
  openLink: vi.fn(),
  crepes: [] as Crepe[],
  copyText: vi.fn(),
  landed: vi.fn(),
}))

vi.mock('../api', () => ({ api: { readFile, writeFile, index, shell: { openLink } } }))
vi.mock('../editor/linkMenu', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../editor/linkMenu')>()),
  copyText,
}))
vi.mock('../editor/toc/tocMotion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../editor/toc/tocMotion')>()),
  landOn: landed,
}))
vi.mock('../editor/createCrepe', () => ({
  createCrepe: vi.fn((opts: Crepe['opts']) => {
    const inst: Crepe = { opts, create: vi.fn(async () => {}), setReadonly: vi.fn(), destroy: vi.fn() }
    const pm = document.createElement('div')
    pm.className = 'ProseMirror'
    pm.textContent = opts.defaultValue ?? ''
    opts.root.appendChild(pm)
    crepes.push(inst)
    return inst
  }),
  cardLook: () => ({}),
  editorViewOf: (crepe: Crepe) => ({ dom: crepe.opts.root.firstChild, state: {}, dispatch: vi.fn() }),
  getPlainText: (crepe: Crepe) => crepe.opts.defaultValue ?? '',
}))
vi.mock('../editor/pagePlace', () => ({
  readPagePlace: vi.fn(() => null),
  showPagePlace: vi.fn(() => false),
  keepPlace: vi.fn((_scroller: Element, put: () => void) => {
    put()
    return () => undefined
  }),
}))
vi.mock('../editor/outline/foldAllHotkeys', () => ({
  FOLDS_CHANGED_EVENT: 'yaseendocs:folds-changed',
  nextDocumentFold: () => 'none',
  setAllDocumentFolds: () => () => true,
}))

type FakeBoard = { host: import('../editor/embed/types').BoardWindowHost; dom: HTMLElement; destroy: Mock; showPage: Mock; handleKey: Mock; setSelected: Mock }
const boards = vi.hoisted(() => ({ made: [] as FakeBoard[] }))
vi.mock('../editor/embed/types', () => ({
  loadBoardWindow: () =>
    Promise.resolve({
      mountBoardWindow: (host: FakeBoard['host']) => {
        const dom = document.createElement('div')
        dom.className = 'board-window board-window--fill'
        dom.tabIndex = -1
        const made: FakeBoard = { host, dom, destroy: vi.fn(), showPage: vi.fn(), handleKey: vi.fn(() => true), setSelected: vi.fn() }
        boards.made.push(made)
        return { dom, update: vi.fn(), setSelected: made.setSelected, handleKey: made.handleKey, setFolded: vi.fn(), setFoldable: vi.fn(), menuRows: () => [], fit: vi.fn(), showPage: made.showPage, flush: vi.fn(), destroy: made.destroy }
      },
    }),
}))
vi.mock('../comments/CommentsSection', () => ({ CommentsSection: () => null }))
vi.mock('../links/BacklinksSection', () => ({ BacklinksSection: () => null }))

const SCENE_0 = '{"type":"excalidraw","version":2,"elements":[{"id":"a"}]}'
const SCENE_1 = '{"type":"excalidraw","version":2,"elements":[{"id":"b"}]}'
const ARCH_MD = [
  '---',
  'title: Architecture',
  '---',
  '',
  'Overview',
  '```excalidraw',
  SCENE_0,
  '```',
  '<!-- drawing: title "Auth Flow" -->',
  '',
  '```card',
  'Q1',
  '---',
  'A1',
  '```',
  '<!-- card: YAZ-10 title "OAuth Card" -->',
  '',
  '```card',
  'Q2',
  '---',
  'A2',
  '```',
  '<!-- card: YAZ-11 title "PKCE Card" -->',
  '',
  '```excalidraw',
  SCENE_1,
  '```',
  '<!-- drawing: title "Token Graph" -->',
  '',
].join('\n')

const rec = (path: string, title: string, extra: Partial<IndexRecord> = {}): IndexRecord => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return { path, name, basename: name.replace(/\.md$/, ''), title, folder: '', ext: 'md', size: 1, ctime: 1, mtime: 1, properties: {}, aliases: [], tags: [], links: [], embeds: [], ...extra }
}

const RECORDS: IndexRecord[] = [
  rec('/v/Architecture.md', 'Architecture', {
    cards: [
      { id: 'YAZ-10', title: 'OAuth Card', off: false, next: false, reviews: [] },
      { id: 'YAZ-11', title: 'PKCE Card', off: false, next: false, reviews: [] },
    ],
    inlineDrawings: [
      { index: 0, title: 'Auth Flow' },
      { index: 1, title: 'Token Graph' },
    ],
  }),
  rec('/v/Beta.md', 'Beta'),
]

const watch: WatchSource = { subscribe: () => () => undefined }
const wikilinks = createWikilinkResolveSource()
const vaults: SearchVault[] = [{ root: '/v', watch, dirs: ['/v/sub'], files: ['/v/Standalone.excalidraw'], cards: true }]
const candidates = { candidates: [], subscribe: () => () => undefined }
const viewOnly = { resolve: null, subscribe: () => () => undefined } as unknown as import('../editor/wikilink/viewOnlyLinkSource').ViewOnlyLinkSource

function StubEditor({ path }: { path: string }) {
  const controls = useContext(TitleRowControls)
  return (
    <div className="editor" data-editor={path}>
      <div className="page-header">{controls}</div>
    </div>
  )
}

let root: Root | null = null
let el: HTMLElement
let props: ExploreStackProps

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

async function mount(overrides: Partial<ExploreStackProps> = {}) {
  el = document.createElement('div')
  document.body.appendChild(el)
  root = createRoot(el)
  props = {
    request: 1,
    vaults,
    vaultOf: () => ({ root: '/v', wikilinks, wikilinkCandidates: candidates, viewOnlyLinks: viewOnly }),
    nameOf: (p) => p.slice(p.lastIndexOf('/') + 1).replace(/\.(md|excalidraw|drawio)$/i, ''),
    textVarsFor: () => ({}),
    renderEditor: (path) => <StubEditor path={path} />,
    createFolder: () => '',
    linkActions: { openVsCode: vi.fn(), reveal: vi.fn() },
    openInTab: vi.fn(),
    onOpenInlineDrawingTab: vi.fn(),
    onNotice: vi.fn(),
    onRenameFile: vi.fn(),
    commentsOrder: 'newest',
    onChangeCommentsOrder: vi.fn(),
    onClose: vi.fn(),
    exploreSize: 100,
    onExploreSize: vi.fn(),
    ...overrides,
  }
  act(() => root!.render(<ExploreStack {...props} />))
  await flush()
  await flush()
}

const layers = () => [...el.querySelectorAll<HTMLElement>('.explore__layer')]
const top = () => layers()[layers().length - 1]!
const input = () => top().querySelector<HTMLInputElement>('.explore__input')!
const key = (target: Element, init: KeyboardEventInit) => act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })))

async function typeQuery(text: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input(), text)
    input().dispatchEvent(new Event('input', { bubbles: true }))
  })
  await flush()
}

function findSearchRow(text: string): HTMLElement {
  const row = [...top().querySelectorAll<HTMLElement>('.search-results__row')].find((r) => r.textContent?.includes(text))
  if (!row) throw new Error(`Row containing "${text}" not found`)
  return row
}

beforeEach(() => {
  resetExploreRecents()
  crepes.length = 0
  boards.made.length = 0
  landed.mockReset()
  copyText.mockReset().mockResolvedValue(undefined)
  readFile.mockReset().mockImplementation(async (path) => ({
    path,
    content: path === '/v/Architecture.md' ? ARCH_MD : `# ${path}\n\nbody\n`,
    mtime: 1,
    size: 100,
  }))
  index.mockReset().mockResolvedValue({ root: '/v', records: RECORDS, folders: [], generatedAt: 1, ids: false, size: RECORDS.length })
  openLink.mockReset()
  window.matchMedia = vi.fn(() => ({ matches: true }) as unknown as MediaQueryList)
})

afterEach(() => {
  if (root !== null) {
    act(() => root!.unmount())
    root = null
  }
  el?.remove()
})

describe('YAZ-6470 #3A: Inline drawings stay inside Explore', () => {
  it('clicking an inline drawing pushes an ExploreBoard layer with inlineJson, title in head+trail, Show in page, and ⌘↵ to tab', async () => {
    await mount()
    await typeQuery('Auth Flow')
    act(() => findSearchRow('Auth Flow').click())
    await flush()
    await flush()

    // Stays inside Explore: board layer pushed, NOT closed or sent to tab
    expect(props.onOpenInlineDrawingTab).not.toHaveBeenCalled()
    expect(props.onClose).not.toHaveBeenCalled()
    expect(layers()).toHaveLength(2)
    expect(top().dataset.kind).toBe('board')
    expect(top().querySelector('.explore__title')?.textContent).toBe('Auth Flow')
    const trail = [...el.querySelectorAll('.explore__chip')].map((c) => c.textContent)
    expect(trail).toEqual(['Search', 'Auth Flow'])

    // mountBoardWindow received inlineJson extracted from the page
    expect(boards.made).toHaveLength(1)
    expect(boards.made[0]!.host.ref.inlineJson).toBe(SCENE_0)
    expect(boards.made[0]!.host.ref.path).toBeNull()

    // Show in page button pushes ExplorePage landed on drawing #0
    const showInPageBtn = [...top().querySelectorAll('button')].find((b) => b.textContent === 'Show in page')
    expect(showInPageBtn).toBeDefined()
    act(() => showInPageBtn!.click())
    await flush()
    await flush()

    expect(layers()).toHaveLength(3)
    expect(top().dataset.kind).toBe('page')
    // Simulate rendered .inline-drawing blocks in the read-only Crepe and verify landing
    const pm = crepes[crepes.length - 1]!.opts.root.querySelector('.ProseMirror')!
    const d0 = pm.appendChild(Object.assign(document.createElement('div'), { className: 'board-embed inline-drawing' }))
    pm.appendChild(Object.assign(document.createElement('div'), { className: 'board-embed inline-drawing' }))
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(landed).toHaveBeenCalledWith(d0)

    // ⌘↵ on ExplorePage with drawing lands on drawing #0 in the tab
    key(top(), { key: 'Enter', metaKey: true })
    expect(takeInlineDrawingLanding('/v/Architecture.md', 0)).toBe(true)
    expect(props.openInTab).toHaveBeenCalledWith('/v/Architecture.md')
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('⌘↵ on an inline ExploreBoard calls onOpenInlineDrawingTab and closes Explore', async () => {
    await mount()
    await typeQuery('Auth Flow')
    act(() => findSearchRow('Auth Flow').click())
    await flush()
    await flush()

    key(top(), { key: 'Enter', metaKey: true })
    expect(props.onOpenInlineDrawingTab).toHaveBeenCalledWith('/v/Architecture.md', 0, false)
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('⌘↵ on an inline drawing search row still opens directly in a tab', async () => {
    await mount()
    await typeQuery('Auth Flow')
    key(input(), { key: 'Enter', metaKey: true })
    expect(props.onOpenInlineDrawingTab).toHaveBeenCalledWith('/v/Architecture.md', 0, false)
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('handles a missing/deleted inline drawing block gracefully in ExploreBoard', async () => {
    readFile.mockResolvedValue({ path: '/v/Architecture.md', content: '# Empty page\nNo drawings left\n', mtime: 1, size: 30 })
    await mount()
    await typeQuery('Auth Flow')
    act(() => findSearchRow('Auth Flow').click())
    await flush()
    await flush()

    expect(boards.made).toHaveLength(0)
    expect(top().querySelector('.editor-msg')?.textContent).toBe('This drawing is no longer there')
  })
})

describe('YAZ-6470 #5: Explore Search inline right-click menus and toTab card landing', () => {
  it('right-clicking an inline drawing row shows inline drawing actions and omits Rename file', async () => {
    await mount()
    await typeQuery('Auth Flow')
    const row = findSearchRow('Auth Flow')
    act(() => {
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 }))
    })
    const menuItems = [...document.querySelectorAll<HTMLElement>('.ctx-menu [role="menuitem"]')]
    const labels = menuItems.map((m) => m.textContent?.trim())
    expect(labels).toEqual(['Open in Explore', 'Show in page', 'Open in new tab', 'Copy path', 'Open in'])
    expect(labels).not.toContain('Rename file')

    // Copy path resolves <pagePath>:<line>
    act(() => menuItems.find((m) => m.textContent?.trim() === 'Copy path')!.click())
    await flush()
    expect(copyText).toHaveBeenCalledWith('/v/Architecture.md:6', 'path', expect.any(Function))
  })

  it('right-clicking an inline card row opens card menu, Open card pushes ExploreCard, and ⌘↵ on ExploreCard lands on card', async () => {
    await mount()
    await typeQuery('OAuth Card')
    const row = findSearchRow('OAuth Card')
    act(() => {
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 }))
    })
    const menuItems = [...document.querySelectorAll<HTMLElement>('.ctx-menu [role="menuitem"]')]
    const labels = menuItems.map((m) => m.textContent?.trim())
    expect(labels).toEqual(['Open in Explore', 'Open card', 'Open in new tab', 'Copy path', 'Copy card ID', 'Copy card link', 'Open in'])
    expect(labels).not.toContain('Rename file')

    act(() => menuItems.find((m) => m.textContent?.trim() === 'Open card')!.click())
    await flush()
    expect(top().dataset.kind).toBe('card')

    // ⌘↵ on ExploreCard calls landOnCard before openInTab
    key(top(), { key: 'Enter', metaKey: true })
    expect(takeCardLanding('/v/Architecture.md', 'YAZ-10')).toBe(true)
    expect(props.openInTab).toHaveBeenCalledWith('/v/Architecture.md')
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('⌘↵ on ExplorePage opened at an inline card calls landOnCard before openInTab', async () => {
    await mount()
    await typeQuery('OAuth Card')
    act(() => findSearchRow('OAuth Card').click())
    await flush()
    await flush()

    expect(top().dataset.kind).toBe('page')
    key(top(), { key: 'Enter', metaKey: true })
    expect(takeCardLanding('/v/Architecture.md', 'YAZ-10')).toBe(true)
    expect(props.openInTab).toHaveBeenCalledWith('/v/Architecture.md')
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('right-clicking an inline ExploreBoard header omits Rename file and Open in Explore', async () => {
    await mount()
    await typeQuery('Auth Flow')
    act(() => findSearchRow('Auth Flow').click())
    await flush()
    await flush()

    const head = top().querySelector('.explore__head')!
    act(() => {
      head.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 80, clientY: 40 }))
    })
    const labels = [...document.querySelectorAll<HTMLElement>('.ctx-menu [role="menuitem"]')].map((m) => m.textContent?.trim())
    expect(labels).toEqual(['Show in page', 'Open in new tab', 'Copy path', 'Open in'])
    expect(labels).not.toContain('Rename file')
  })
})

describe('YAZ-6470 #8: Explore ‹ › stepping includes inline cards and inline drawings', () => {
  it('steps across inline cards and inline drawings in place, updating count, board inlineJson, and card landings', async () => {
    await mount()
    // Filter to Cards or search with a query matching both cards & drawings ("a" matches Architecture, Auth Flow, OAuth Card, PKCE Card, Token Graph, Beta, Standalone)
    await typeQuery('a')
    // Open OAuth Card
    act(() => findSearchRow('OAuth Card').click())
    await flush()
    await flush()

    expect(top().dataset.kind).toBe('page')
    const countText = () => top().querySelector('.explore__count')?.textContent
    expect(countText()).toMatch(/^\d+\/\d+$/)
    const [, total] = countText()!.split('/').map(Number)
    // Should count Architecture, Auth Flow, OAuth Card, PKCE Card, Token Graph, Beta, Standalone (all 7 steppable rows!)
    expect(total).toBeGreaterThanOrEqual(5)

    // Open Auth Flow directly and step to next and previous
    await mount()
    await typeQuery('a')
    act(() => findSearchRow('Auth Flow').click())
    await flush()
    await flush()
    expect(top().dataset.kind).toBe('board')
    expect(top().querySelector('.explore__title')?.textContent).toBe('Auth Flow')
    const authPlace = countText()

    // Step forward until we visit both a card/page and another drawing (or step through all rows)
    const visitedKinds = new Set<string>()
    const visitedTitles = new Set<string>()
    const nextBtn = () => top().querySelector<HTMLButtonElement>('button[aria-label="Next search result"]')
    const prevBtn = () => top().querySelector<HTMLButtonElement>('button[aria-label="Previous search result"]')
    // Step backward to start
    while (prevBtn() && !prevBtn()!.disabled) {
      act(() => prevBtn()!.click())
      await flush()
      await flush()
    }
    // Step forward through the whole list
    for (let i = 0; i < 10; i++) {
      visitedKinds.add(top().dataset.kind!)
      visitedTitles.add(top().querySelector('.explore__title')?.textContent ?? '')
      if (!nextBtn() || nextBtn()!.disabled) break
      act(() => nextBtn()!.click())
      await flush()
      await flush()
    }
    expect(authPlace).toMatch(/^\d+\/\d+$/)
    expect(visitedKinds.has('page')).toBe(true)
    expect(visitedKinds.has('board')).toBe(true)
    expect(visitedTitles.has('Auth Flow')).toBe(true)
    expect(visitedTitles.has('Token Graph')).toBe(true)
    expect(boards.made.some((b) => b.host.ref.inlineJson === SCENE_0)).toBe(true)
    expect(boards.made.some((b) => b.host.ref.inlineJson === SCENE_1)).toBe(true)
  })

  it('stepping between two inline cards on the same page lands on each card', async () => {
    await mount()
    await typeQuery('Card')
    act(() => findSearchRow('OAuth Card').click())
    await flush()
    await flush()

    const pm = crepes[crepes.length - 1]!.opts.root.querySelector('.ProseMirror')!
    const c0 = pm.appendChild(Object.assign(document.createElement('div'), { className: 'card' }))
    c0.dataset.pageCard = ''
    c0.dataset.cardId = 'YAZ-10'
    const c1 = pm.appendChild(Object.assign(document.createElement('div'), { className: 'card' }))
    c1.dataset.pageCard = ''
    c1.dataset.cardId = 'YAZ-11'
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(landed).toHaveBeenCalledWith(c0)

    landed.mockClear()
    const nextBtn = top().querySelector<HTMLButtonElement>('button[aria-label="Next search result"]')!
    expect(nextBtn.disabled).toBe(false)
    act(() => nextBtn.click())
    await flush()
    await flush()
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(landed).toHaveBeenCalledWith(c1)
  })
})

describe('YAZ-6470 #9: ExplorePage read-mode inline drawing actions and edit transition', () => {
  it('wires read-safe inlineDrawing onCopyPath and onOpenInTab into createCrepe', async () => {
    await mount()
    await typeQuery('Architecture')
    act(() => findSearchRow('Architecture').click())
    await flush()
    await flush()

    const crepe = crepes[crepes.length - 1]!
    expect(crepe.opts.inlineDrawing).toBeDefined()
    expect(crepe.opts.inlineDrawing?.pagePath).toBe('/v/Architecture.md')

    // Copy path copies <pagePath>:<line>
    crepe.opts.inlineDrawing!.onCopyPath!(0)
    await flush()
    expect(copyText).toHaveBeenCalledWith('/v/Architecture.md:6', 'path', expect.any(Function))

    // Background open keeps Explore open
    crepe.opts.inlineDrawing!.onOpenInTab!(1, true)
    expect(props.onOpenInlineDrawingTab).toHaveBeenCalledWith('/v/Architecture.md', 1, true)
    expect(props.onClose).not.toHaveBeenCalled()

    // Foreground open closes Explore
    crepe.opts.inlineDrawing!.onOpenInTab!(0, false)
    expect(props.onOpenInlineDrawingTab).toHaveBeenCalledWith('/v/Architecture.md', 0, false)
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('transitions ExplorePage to edit mode on tellReadOnlyEdit(..., "drawing")', async () => {
    await mount()
    await typeQuery('Architecture')
    act(() => findSearchRow('Architecture').click())
    await flush()
    await flush()

    expect(top().querySelector('[data-editor]')).toBeNull()
    const pm = crepes[crepes.length - 1]!.opts.root.querySelector('.ProseMirror')!
    const drawingEl = pm.appendChild(Object.assign(document.createElement('div'), { className: 'board-embed inline-drawing' }))
    act(() => tellReadOnlyEdit(drawingEl, 'drawing', () => {}))
    await flush()

    expect(top().querySelector('[data-editor="/v/Architecture.md"]')).not.toBeNull()
  })

  it('asks "Allow edits?" on tellReadOnlyEdit(..., "drawing") when the vault is read-only', async () => {
    await mount({
      vaultOf: () => ({ root: '/v', wikilinks, wikilinkCandidates: candidates, viewOnlyLinks: viewOnly, readOnly: true }),
    })
    await typeQuery('Architecture')
    act(() => findSearchRow('Architecture').click())
    await flush()
    await flush()

    const pm = crepes[crepes.length - 1]!.opts.root.querySelector('.ProseMirror')!
    const drawingEl = pm.appendChild(Object.assign(document.createElement('div'), { className: 'board-embed inline-drawing' }))
    act(() => tellReadOnlyEdit(drawingEl, 'drawing', () => {}))
    await flush()

    // Stays reading and opens ReadOnlyChip's "Allow edits?" box
    expect(top().querySelector('[data-editor]')).toBeNull()
    expect(top().querySelector('.read-only-chip__ask')).not.toBeNull()
  })
})
