/**
 * The Topics tree (6B-, YAZ-848): the folder-page tree in the sidebar. Each case pins ONE locked
 * rule — the roots rule (🔒 D2), the row gestures (🔒 D3), the guarded descent (⚡ D6 of YAZ-814)
 * with its own per-level ordering ([D5]), page-path expansion (🔒 D4) and its persistence, and
 * the Uncategorized section (🔒 D7).
 *
 * The feed is the real `WikilinkResolveSource` shape (records + resolver, always together) over a
 * hand-built snapshot, resolved by a basename map keyed exactly like `makeResolver`
 * (`folderPages.test.ts`'s helper). Persistence goes through the REAL `lib/storage` module over a
 * jsdom bridge stub, so the bucket, its patch and its restore are all exercised end to end.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StrictMode, act, useEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MAX_TOPICS_EXPANDED_PAGES, defaultAppState, defaultFolderState, type AppState, type IndexRecord, type WindowIdentity } from '@shared/types'
import { stripBrackets } from '../views/expr'
import type { ResolveLink, WikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { storage } from '../lib/storage'
import { folderPagesLookup } from '../links/folderPages'
import { TopicsTree, allExpandableTopics, topicRoots } from './TopicsTree'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const ROOT = '/vault'

// ---------- the snapshot ----------

const rec = (path: string, properties: Record<string, unknown> = {}, aliases: string[] = []): IndexRecord => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const rel = path.slice(`${ROOT}/`.length)
  return {
    path,
    name,
    basename: name.replace(/\.md$/, ''),
    folder: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '',
    ext: 'md',
    size: 1,
    ctime: 1,
    mtime: 1,
    properties,
    aliases,
    tags: [],
    links: [],
    embeds: [],
  }
}

/** A page carrying the strict flag. */
const folder = (path: string, properties: Record<string, unknown> = {}): IndexRecord => rec(path, { folder_page: true, ...properties })

/** The frontmatter a note declares its parents with. */
const belongs = (...entries: string[]): Record<string, unknown> => ({ folder_pages: entries })

/** A folder page's [D5] order, as the FIRST outline view's wikilink list. */
const ordered = (...order: string[]): Record<string, unknown> => ({
  folder_page_settings: { views: [{ type: 'outline', name: 'Outline', order }] },
})

/** Basename/alias → path, keyed like `makeResolver`: brackets stripped, `#`/`|` tail dropped, lowered. */
const resolverOver = (records: readonly IndexRecord[]): ResolveLink => {
  const byName = new Map<string, string>()
  for (const record of records) {
    byName.set(record.basename.toLowerCase(), record.path)
    for (const alias of record.aliases) byName.set(alias.toLowerCase(), record.path)
  }
  return (target) => byName.get(stripBrackets(target).replace(/[#|].*$/, '').trim().toLowerCase()) ?? null
}

/** The window's feed, pokeable: `update` swaps the snapshot and wakes every subscriber, as App's does. */
function sourceOver(records: readonly IndexRecord[]) {
  let snapshot = records
  const listeners = new Set<() => void>()
  const source: WikilinkResolveSource & { update: (next: readonly IndexRecord[]) => void } = {
    get records() {
      return snapshot
    },
    get resolve() {
      return snapshot.length === 0 ? null : resolverOver(snapshot)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    update(next) {
      snapshot = next
      listeners.forEach((l) => l())
    },
  }
  return source
}

/**
 * The standing vault: Home leads (a folder page), Projects is a second unparented folder page,
 * Metrics nests under Home with two members of its own, Loose belongs nowhere.
 */
const HOME = `${ROOT}/Home.md`
const METRICS = `${ROOT}/Metrics.md`
const PROJECTS = `${ROOT}/Projects.md`
const vault = (): IndexRecord[] => [
  folder(HOME),
  folder(METRICS, belongs('[[Home]]')),
  folder(PROJECTS),
  rec(`${ROOT}/Revenue.md`, belongs('[[Metrics]]')),
  rec(`${ROOT}/Churn.md`, belongs('[[Metrics]]')),
  rec(`${ROOT}/Loose.md`),
]

// ---------- the bridge + mount harness ----------

let bridgeSetFolder = vi.fn(async () => undefined)

async function initStorage(state: AppState = defaultAppState()): Promise<void> {
  bridgeSetFolder = vi.fn(async () => undefined)
  const bridge = {
    state: { get: vi.fn(async () => state), setFolder: bridgeSetFolder, onChange: vi.fn(() => () => undefined) },
    window: { identity: vi.fn(async (): Promise<WindowIdentity> => ({ id: 'w1', root: ROOT, file: null, tabs: [] })) },
  }
  Object.defineProperty(window, 'yaseenDocs', { value: bridge, configurable: true, writable: true })
  await storage.init()
}

let root: Root | null = null
let container: HTMLElement | null = null

type Props = Parameters<typeof TopicsTree>[0]
/** What the harness hands over: the tree's props minus the ones its OWNER supplies, plus the vault. */
type OwnedProps = Omit<Props, 'expanded' | 'onExpandedChange'> & { root: string }

/**
 * ⚡ YAZ-873 lifted the expansion into the Sidebar, so the tree is CONTROLLED. This is that owner
 * in miniature — the same restore from the per-vault bucket and the same idempotent write-back —
 * so every case below still drives the real gestures and still proves the persistence end to end.
 */
function Controlled({ root, ...props }: OwnedProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(storage.getTopicsExpanded(root)))
  useEffect(() => {
    const next = [...expanded]
    const stored = storage.getTopicsExpanded(root)
    if (stored.length === next.length && stored.every((path, i) => path === next[i])) return
    storage.setTopicsExpanded(root, next)
  }, [root, expanded])
  return <TopicsTree {...props} expanded={expanded} onExpandedChange={setExpanded} />
}

async function mount(over: Partial<OwnedProps> & { source: Props['source'] }) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  container = el
  root = createRoot(el)
  const props: OwnedProps = {
    root: ROOT,
    activeFile: null,
    onOpenFile: vi.fn(),
    onOpenFileBackground: vi.fn(),
    // 6C's offer (YAZ-849): every case below runs on an ADOPTED vault, where the card never
    // shows; the "the offer card" describe is the one that flips this.
    unadopted: false,
    onCreateHome: vi.fn(),
    // The menu, the inline rename and the inline create all belong to the SIDEBAR (8G-,
    // YAZ-865): this component only reports the row and draws whatever it is handed. The
    // whole gesture is pinned end to end in `Sidebar.test.tsx`, where the real menu renders.
    onRowContextMenu: vi.fn(),
    renaming: null,
    creating: null,
    ...over,
  }
  await act(async () => root?.render(<StrictMode><Controlled {...props} /></StrictMode>))
  return { el, props }
}

const rows = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('.tree__row')]
const labels = (el: HTMLElement) => rows(el).map((r) => r.querySelector('.tree__label')?.textContent ?? '')
const rowFor = (el: HTMLElement, label: string) => rows(el).find((r) => r.querySelector('.tree__label')?.textContent === label)
const countOn = (el: HTMLElement, label: string) => rowFor(el, label)?.querySelector('.tree__count')?.textContent ?? null
const indentOf = (el: HTMLElement, label: string) => rowFor(el, label)?.style.paddingLeft ?? null
const chevrons = (el: HTMLElement, label: string) => [...el.querySelectorAll<HTMLElement>(`[aria-label="${label}"]`)]
const click = async (node: Element, init: MouseEventInit = {}) => act(async () => void node.dispatchEvent(new MouseEvent('click', { bubbles: true, ...init })))

beforeEach(async () => {
  await initStorage()
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  delete (window as unknown as Record<string, unknown>).yaseenDocs
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------- ⚡ YAZ-873: the expand-all set

describe('allExpandableTopics (⚡ YAZ-873): every page the tree could unfold, once, loop-safe, capped', () => {
  const setOf = (records: readonly IndexRecord[]) => {
    const resolve = resolverOver(records)
    return allExpandableTopics(records, folderPagesLookup(records, resolve), resolve)
  }

  it('collects every folder page that can unfold, from every root, once each, and never a dead end', () => {
    // Home → A → B → A (a loop); Shared under Home AND Projects (a diamond); B can never unfold —
    // its only member is A, already standing above it on every trail the tree can walk.
    const records = [
      folder(HOME),
      folder(PROJECTS),
      folder(`${ROOT}/A.md`, belongs('[[Home]]', '[[B]]')),
      folder(`${ROOT}/B.md`, belongs('[[A]]')),
      folder(`${ROOT}/Shared.md`, belongs('[[Home]]', '[[Projects]]')),
      rec(`${ROOT}/Leaf.md`, belongs('[[Shared]]')),
    ]
    expect([...setOf(records)].sort()).toEqual([`${ROOT}/A.md`, HOME, PROJECTS, `${ROOT}/Shared.md`].sort())
  })

  it('a leaf-only vault and an empty feed both answer nothing', () => {
    expect(setOf([folder(PROJECTS), rec(`${ROOT}/Loose.md`)])).toEqual([])
    expect(allExpandableTopics([], folderPagesLookup([], () => null), null)).toEqual([])
  })

  it('caps at MAX_TOPICS_EXPANDED_PAGES — the bucket the answer is written into', () => {
    // A chain of 600 folder pages, each the sole member of the one before it: 599 can unfold.
    const chain: IndexRecord[] = [folder(`${ROOT}/T000.md`)]
    for (let i = 1; i < 600; i++) {
      const name = `T${String(i).padStart(3, '0')}`
      chain.push(folder(`${ROOT}/${name}.md`, belongs(`[[T${String(i - 1).padStart(3, '0')}]]`)))
    }
    expect(setOf(chain)).toHaveLength(MAX_TOPICS_EXPANDED_PAGES)
  })
})

// ---------------------------------------------------------------- 🔒 D2: the roots

describe('the roots rule (🔒 D2): Home first, then every other unparented folder page', () => {
  const rootsOf = (records: readonly IndexRecord[]) => {
    const resolve = records.length === 0 ? null : resolverOver(records)
    return topicRoots(records, folderPagesLookup(records, resolve ?? (() => null)), resolve).map((r) => r.path)
  }

  it('puts Home first and path-sorts the rest', () => {
    expect(rootsOf(vault())).toEqual([HOME, PROJECTS])
    // Path order, not declaration order: the snapshot below lists them backwards.
    const records = [folder(`${ROOT}/Zebra.md`), folder(`${ROOT}/Alpha.md`), folder(HOME)]
    expect(rootsOf(records)).toEqual([HOME, `${ROOT}/Alpha.md`, `${ROOT}/Zebra.md`])
  })

  it('resolves Home the way a CLICK would — case-insensitively and through an alias', () => {
    expect(rootsOf([folder(`${ROOT}/home.md`), folder(PROJECTS)])).toEqual([`${ROOT}/home.md`, PROJECTS])
    const aliased = rec(`${ROOT}/Start Here.md`, { folder_page: true }, ['Home'])
    expect(rootsOf([aliased, folder(PROJECTS)])).toEqual([`${ROOT}/Start Here.md`, PROJECTS])
  })

  it('an ORDINARY page called Home is no Home for the tree — no row, and the other roots still stand', async () => {
    const records = [rec(HOME), folder(PROJECTS)]
    expect(rootsOf(records)).toEqual([PROJECTS])
    const { el } = await mount({ source: sourceOver(records) })
    expect(labels(el)).toEqual(['Projects', 'Uncategorized'])
  })

  it('a folder page with any counting parent is NOT a root (it renders under that parent instead)', () => {
    expect(rootsOf(vault())).not.toContain(METRICS)
  })

  it('a Home that belongs somewhere still LEADS — and can never appear inside itself', async () => {
    // Home names Projects as its parent: it is both the lead root and a member of Projects.
    const records = [folder(HOME, belongs('[[Projects]]')), folder(PROJECTS)]
    expect(rootsOf(records)).toEqual([HOME, PROJECTS])
    const { el } = await mount({ source: sourceOver(records) })
    await click(chevrons(el, 'Expand Projects')[0])
    // Projects > Home, and Home's own branch holds Projects' guard: no third rung, ever.
    expect(labels(el)).toEqual(['Home', 'Projects', 'Home'])
    expect(chevrons(el, 'Expand Home')).toHaveLength(0)
  })

  it('an empty snapshot (before the first index) renders NOTHING — not even the Uncategorized row', async () => {
    const { el } = await mount({ source: sourceOver([]) })
    expect(rows(el)).toHaveLength(0)
    expect(el.textContent).toBe('')
  })
})

// ---------------------------------------------------------------- 🔒 D3: the rows

describe('the rows (🔒 D3): the file tree\'s two open handlers, a chevron of its own, glyph + count', () => {
  it('a row click OPENS the page and ⌘-click sends it to a background tab', async () => {
    const { el, props } = await mount({ source: sourceOver(vault()) })
    await click(rowFor(el, 'Home')!)
    expect(props.onOpenFile).toHaveBeenCalledWith(HOME)
    expect(props.onOpenFileBackground).not.toHaveBeenCalled()
    await click(rowFor(el, 'Projects')!, { metaKey: true })
    expect(props.onOpenFileBackground).toHaveBeenCalledWith(PROJECTS)
    expect(props.onOpenFile).toHaveBeenCalledTimes(1)
  })

  it('the chevron only EXPANDS — it never opens the page under it', async () => {
    const { el, props } = await mount({ source: sourceOver(vault()) })
    await click(chevrons(el, 'Expand Home')[0])
    expect(props.onOpenFile).not.toHaveBeenCalled()
    expect(labels(el)).toEqual(['Home', 'Metrics', 'Projects', 'Uncategorized'])
    await click(chevrons(el, 'Collapse Home')[0])
    expect(labels(el)).toEqual(['Home', 'Projects', 'Uncategorized'])
  })

  it('folder-page rows wear the glyph and their DIRECT-member count; leaves wear neither', async () => {
    const { el } = await mount({ source: sourceOver(vault()) })
    await click(chevrons(el, 'Expand Home')[0])
    await click(chevrons(el, 'Expand Metrics')[0])
    expect(countOn(el, 'Home')).toBe('1')
    expect(countOn(el, 'Metrics')).toBe('2')
    expect(countOn(el, 'Projects')).toBe('0')
    expect(countOn(el, 'Revenue')).toBeNull()
    expect(rowFor(el, 'Metrics')?.querySelector('.tree__glyph')).not.toBeNull()
    expect(rowFor(el, 'Revenue')?.querySelector('.tree__glyph')).toBeNull()
  })

  it('indents by 8 + depth * 14, exactly as the file tree does', async () => {
    const { el } = await mount({ source: sourceOver(vault()) })
    await click(chevrons(el, 'Expand Home')[0])
    await click(chevrons(el, 'Expand Metrics')[0])
    expect(indentOf(el, 'Home')).toBe('8px')
    expect(indentOf(el, 'Metrics')).toBe('22px')
    expect(indentOf(el, 'Revenue')).toBe('36px')
  })

  it('the open file is highlighted wherever it stands', async () => {
    const records = [folder(HOME), folder(PROJECTS), rec(`${ROOT}/Shared.md`, belongs('[[Home]]', '[[Projects]]'))]
    const { el } = await mount({ source: sourceOver(records), activeFile: `${ROOT}/Shared.md` })
    await click(chevrons(el, 'Expand Home')[0])
    await click(chevrons(el, 'Expand Projects')[0])
    expect(rows(el).filter((r) => r.classList.contains('tree__row--active'))).toHaveLength(2)
  })
})

// ---------------------------------------------------------------- ⚡ YAZ-870: the row unfolds

describe('the row gesture opens AND unfolds (⚡ YAZ-870, the amendment on 🔒 D3)', () => {
  it('a row click on a folder page opens it AND expands it in place', async () => {
    const { el, props } = await mount({ source: sourceOver(vault()) })
    await click(rowFor(el, 'Home')!)
    expect(props.onOpenFile).toHaveBeenCalledWith(HOME)
    expect(labels(el)).toEqual(['Home', 'Metrics', 'Projects', 'Uncategorized'])
    // …and through the same 🔒 D4 bucket a chevron expansion takes, so it persists.
    expect(storage.getTopicsExpanded(ROOT)).toEqual([HOME])
  })

  it('a second click never collapses — the chevron keeps that gesture to itself', async () => {
    const { el } = await mount({ source: sourceOver(vault()) })
    await click(rowFor(el, 'Home')!)
    await click(rowFor(el, 'Home')!)
    expect(labels(el)).toEqual(['Home', 'Metrics', 'Projects', 'Uncategorized'])
    await click(chevrons(el, 'Collapse Home')[0])
    expect(labels(el)).toEqual(['Home', 'Projects', 'Uncategorized'])
  })

  it('⌘-click still means "not now": a background tab, and the tree does not move', async () => {
    const { el, props } = await mount({ source: sourceOver(vault()) })
    await click(rowFor(el, 'Home')!, { metaKey: true })
    expect(props.onOpenFileBackground).toHaveBeenCalledWith(HOME)
    expect(labels(el)).toEqual(['Home', 'Projects', 'Uncategorized'])
    expect(storage.getTopicsExpanded(ROOT)).toEqual([])
  })

  it('a folder page with nothing under it just opens — nothing to unfold, nothing recorded', async () => {
    const { el, props } = await mount({ source: sourceOver(vault()) })
    await click(rowFor(el, 'Projects')!)
    expect(props.onOpenFile).toHaveBeenCalledWith(PROJECTS)
    expect(labels(el)).toEqual(['Home', 'Projects', 'Uncategorized'])
    expect(storage.getTopicsExpanded(ROOT)).toEqual([])
  })
})

// ---------------------------------------------------------------- ⚡ D6 + [D5]: the descent

describe('the descent: guardedChildren only (⚡ D6), ordered per level by its OWN settings ([D5])', () => {
  it('orders each level by that level\'s folder page, falling back to alphabetical', async () => {
    const records = [
      folder(HOME, ordered('[[Zulu]]')),
      rec(`${ROOT}/Alpha.md`, belongs('[[Home]]')),
      rec(`${ROOT}/Zulu.md`, belongs('[[Home]]')),
      folder(`${ROOT}/Mid.md`, belongs('[[Home]]')),
      rec(`${ROOT}/Beta.md`, belongs('[[Mid]]')),
      rec(`${ROOT}/Aleph.md`, belongs('[[Mid]]')),
    ]
    const { el } = await mount({ source: sourceOver(records) })
    await click(chevrons(el, 'Expand Home')[0])
    // Home's own `order` places Zulu first; the unlisted rest follow alphabetically. (Every page
    // here has a home and Home itself is a root, so there is no Uncategorized row at all.)
    expect(labels(el)).toEqual(['Home', 'Zulu', 'Alpha', 'Mid'])
    await click(chevrons(el, 'Expand Mid')[0])
    // Mid declares no order at all, so ITS level is all-alphabetical — Home's order says nothing here.
    expect(labels(el)).toEqual(['Home', 'Zulu', 'Alpha', 'Mid', 'Aleph', 'Beta'])
  })

  it('an A ↔ B loop renders FINITELY: the branch ends quietly where an ancestor comes round again', async () => {
    const records = [folder(HOME), folder(`${ROOT}/A.md`, belongs('[[Home]]', '[[B]]')), folder(`${ROOT}/B.md`, belongs('[[A]]'))]
    const { el } = await mount({ source: sourceOver(records) })
    await click(chevrons(el, 'Expand Home')[0])
    await click(chevrons(el, 'Expand A')[0])
    expect(labels(el)).toEqual(['Home', 'A', 'B'])
    // B's only member is A, already standing above it — so B offers no chevron at all.
    expect(chevrons(el, 'Expand B')).toHaveLength(0)
    // …and the count still tells the truth about B: A really does belong to it.
    expect(countOn(el, 'B')).toBe('1')
  })

  it('a diamond renders under BOTH parents (a path guard, never a global visited set)', async () => {
    const records = [folder(HOME), folder(PROJECTS), rec(`${ROOT}/Shared.md`, belongs('[[Home]]', '[[Projects]]'))]
    const { el } = await mount({ source: sourceOver(records) })
    await click(chevrons(el, 'Expand Home')[0])
    await click(chevrons(el, 'Expand Projects')[0])
    expect(labels(el)).toEqual(['Home', 'Shared', 'Projects', 'Shared'])
  })

  it('expanding ONE occurrence of a multi-parent page expands them ALL (🔒 D4: keyed by page path)', async () => {
    const records = [
      folder(HOME),
      folder(PROJECTS),
      folder(`${ROOT}/Shared.md`, belongs('[[Home]]', '[[Projects]]')),
      rec(`${ROOT}/Leaf.md`, belongs('[[Shared]]')),
    ]
    const { el } = await mount({ source: sourceOver(records) })
    await click(chevrons(el, 'Expand Home')[0])
    await click(chevrons(el, 'Expand Projects')[0])
    expect(labels(el)).toEqual(['Home', 'Shared', 'Projects', 'Shared'])
    await click(chevrons(el, 'Expand Shared')[0]) // the occurrence under Home
    expect(labels(el)).toEqual(['Home', 'Shared', 'Leaf', 'Projects', 'Shared', 'Leaf'])
  })

  it('a refetched snapshot rebuilds the tree in place — no fetch, no watcher of its own', async () => {
    const source = sourceOver(vault())
    const { el } = await mount({ source })
    expect(labels(el)).toEqual(['Home', 'Projects', 'Uncategorized'])
    await act(async () => source.update([...vault(), folder(`${ROOT}/Aha.md`)]))
    expect(labels(el)).toEqual(['Home', 'Aha', 'Projects', 'Uncategorized'])
  })
})

// ---------------------------------------------------------------- 🔒 D7: Uncategorized

describe('Uncategorized (🔒 D7): a muted row that expands IN PLACE, minus whatever already shows', () => {
  it('counts and lists the orphans, subtracting the folder pages standing as roots', async () => {
    const { el } = await mount({ source: sourceOver(vault()) })
    // Home and Projects have no parents either, so the carve-out-free lookup calls them orphans —
    // this surface subtracts them because they are already on screen. Loose is what is left.
    expect(countOn(el, 'Uncategorized')).toBe('1')
    await click(rowFor(el, 'Uncategorized')!)
    expect(labels(el)).toEqual(['Home', 'Projects', 'Uncategorized', 'Loose'])
    expect(indentOf(el, 'Loose')).toBe('22px')
    await click(rowFor(el, 'Uncategorized')!)
    expect(labels(el)).toEqual(['Home', 'Projects', 'Uncategorized'])
  })

  it('is muted, and its rows open like any other (⌘-click included) — never a page of its own', async () => {
    const { el, props } = await mount({ source: sourceOver(vault()) })
    expect(rowFor(el, 'Uncategorized')?.classList.contains('tree__row--muted')).toBe(true)
    await click(rowFor(el, 'Uncategorized')!)
    await click(rowFor(el, 'Loose')!, { metaKey: true })
    expect(props.onOpenFileBackground).toHaveBeenCalledWith(`${ROOT}/Loose.md`)
    expect(props.onOpenFile).not.toHaveBeenCalled()
  })

  it('hides itself entirely when every page has a home', async () => {
    const records = [folder(HOME), rec(`${ROOT}/Revenue.md`, belongs('[[Home]]'))]
    const { el } = await mount({ source: sourceOver(records) })
    expect(labels(el)).toEqual(['Home'])
  })
})

// ---------------------------------------------------------------- 🔒 D4: persistence

describe('expansion persists through the per-vault storage bucket (🔒 D4)', () => {
  it('restores the open pages from folders[root].topicsExpanded', async () => {
    const state = defaultAppState()
    state.folders = { [ROOT]: { ...defaultFolderState(), topicsExpanded: [HOME, METRICS] } }
    await initStorage(state)
    const { el } = await mount({ source: sourceOver(vault()) })
    expect(labels(el)).toEqual(['Home', 'Metrics', 'Churn', 'Revenue', 'Projects', 'Uncategorized'])
    // Restoring is not a write: the value already on disk is not sent back.
    expect(bridgeSetFolder).not.toHaveBeenCalled()
  })

  it('writes PAGE PATHS back through the bucket on every toggle, keyed by this vault', async () => {
    const { el } = await mount({ source: sourceOver(vault()) })
    await click(chevrons(el, 'Expand Home')[0])
    expect(storage.getTopicsExpanded(ROOT)).toEqual([HOME])
    expect(bridgeSetFolder).toHaveBeenLastCalledWith(ROOT, { topicsExpanded: [HOME] })
    await click(chevrons(el, 'Expand Metrics')[0])
    expect(storage.getTopicsExpanded(ROOT)).toEqual([HOME, METRICS])
    await click(chevrons(el, 'Collapse Home')[0])
    expect(storage.getTopicsExpanded(ROOT)).toEqual([METRICS])
    expect(bridgeSetFolder).toHaveBeenLastCalledWith(ROOT, { topicsExpanded: [METRICS] })
  })

  it('survives a remount — the lens switch away and back (the tree is unmounted meanwhile)', async () => {
    const first = await mount({ source: sourceOver(vault()) })
    await click(chevrons(first.el, 'Expand Home')[0])
    act(() => root?.unmount())
    root = null
    container?.remove()
    const { el } = await mount({ source: sourceOver(vault()) })
    expect(labels(el)).toEqual(['Home', 'Metrics', 'Projects', 'Uncategorized'])
  })
})

// ---------------------------------------------------------------- ⚡ the amendment: the offer

describe('the offer card (6C-, YAZ-849): un-adopted AND no Home, and nothing else', () => {
  const card = (el: HTMLElement) => el.querySelector<HTMLElement>('.topics-offer')
  const offerButton = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.topics-offer button')

  it('shows at the TOP of the lens when the folder is un-adopted and nothing answers [[Home]]', async () => {
    const { el } = await mount({ source: sourceOver([folder(PROJECTS), rec(`${ROOT}/Loose.md`)]), unadopted: true })
    expect(card(el)?.textContent).toContain('Your map starts here')
    expect(offerButton(el)?.textContent).toBe('Create Home')
    // First thing in the lens, and it REPLACES nothing: the tree still stands Projects up and
    // still lists the orphan (there is never a silent fallback to Files).
    expect(el.firstElementChild).toBe(card(el))
    expect(labels(el)).toEqual(['Projects', 'Uncategorized'])
  })

  it('one click runs the create — App makes Home and opens it; the card asks for nothing else', async () => {
    const onCreateHome = vi.fn()
    const { el } = await mount({ source: sourceOver([rec(`${ROOT}/Loose.md`)]), unadopted: true, onCreateHome })
    await click(offerButton(el) as Element)
    expect(onCreateHome).toHaveBeenCalledTimes(1)
  })

  it('an ADOPTED vault never offers — its Home was created for it, silently', async () => {
    const { el } = await mount({ source: sourceOver([rec(`${ROOT}/Loose.md`)]), unadopted: false })
    expect(card(el)).toBeNull()
  })

  it('a Home that RESOLVES retires the card live, flagged or not (🔒 D1)', async () => {
    const source = sourceOver([rec(`${ROOT}/Loose.md`)])
    const { el } = await mount({ source, unadopted: true })
    expect(card(el)).not.toBeNull()
    // The click made Home (or the user did, by hand, unflagged): the next snapshot answers
    // `[[Home]]`, so the offer retires — even though 6B's roots rule shows no Home ROW for an
    // unflagged page. The folder is still un-adopted; it simply has a Home now.
    await act(async () => source.update([rec(`${ROOT}/Loose.md`), rec(HOME)]))
    expect(card(el)).toBeNull()
    expect(labels(el)).toEqual(['Uncategorized'])
  })

  it('never shows before the first index lands — an empty feed knows nothing about Home', async () => {
    const { el } = await mount({ source: sourceOver([]), unadopted: true })
    expect(card(el)).toBeNull()
    expect(el.textContent).toBe('')
  })
})
