/**
 * The TOPICS lens' body (6B-, YAZ-848) — browsing the vault BY MEANING: the folder-page tree.
 * Home first, then every other unparented folder page as a root of its own, members nested per
 * each folder page's own order, live, loop-safe, with an expandable Uncategorized section at the
 * bottom. The sibling of `Tree.tsx`, which browses the same vault by its FOLDERS on disk; both
 * wear the same `.tree__row` family, the same `8 + depth * 14` indent and the same two open
 * handlers, because they are two readings of one vault and not two kinds of list.
 *
 * ROOTS (🔒 D2 of YAZ-821): whatever `[[Home]]` resolves to comes first — through the WINDOW's
 * resolver, so alias-aware and case-insensitive, every spelling a CLICK would follow — and only
 * when it is a FOLDER PAGE: a plain note called Home is not a tree root, and the tree simply has
 * no Home row (offering to make one is 6C's, deliberately not here). Then every other folder page
 * the lookup gives no parents (`folderPagesOf(path).length === 0`), path-sorted, so a vault with
 * no Home still shows all of its top-level topics rather than nothing at all.
 *
 * DESCENT (⚡ D6 amendment on YAZ-814): children come ONLY from `guardedChildren` — never raw
 * `pagesIn` — so `A → B → A` ends quietly at any depth while a page reachable down two branches
 * still renders under BOTH. Each level is ordered by ITS OWN folder page's settings
 * (`orderedMembers`, the [D5] rule's one place), because the order lives on the page that owns
 * the members, never on whoever happens to be showing them.
 *
 * EXPANSION (🔒 D4) is keyed by PAGE PATH, not by tree position: expanding Metrics under one
 * parent expands it under every parent, which is the mockup's behaviour and the honest one — the
 * user opened the PAGE. It is persisted per vault in the main-owned `folders[root].topicsExpanded`
 * bucket, `expanded`'s twin, so it survives a restart and is repaired by `store.renamePath`.
 *
 * UNCATEGORIZED (🔒 D7, the locked DEVIATION from the mockup): a muted row at the bottom that
 * EXPANDS IN PLACE — never a virtual page, never a main-pane view. It is the lookup's
 * carve-out-free `uncategorized()` minus whatever already stands as a root, which is this
 * surface's own subtraction to make (the lookup has none).
 *
 * FEED: the window's ONE `WikilinkResolveSource` — the same records + resolver pair backlinks,
 * the contents block and the folder-page toggle read. A refetched index pokes it and the whole
 * tree recomputes; there is no fetch, no watcher and no IPC of this lens' own. Before the first
 * index lands the feed is empty and this renders NOTHING — not even the Uncategorized row, which
 * would otherwise flash "0" over a vault it has not seen yet.
 *
 * Read-only apart from expansion: no drag, and no context menu of its own (YAZ-848's scope).
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { IndexRecord } from '@shared/types'
import { folderPageSettings, orderedMembers } from '../bases/folderPageSettings'
import { BaseGlyph } from '../bases/view/icons'
import type { ResolveLink, WikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { storage } from '../lib/storage'
import { folderPagesLookup, guardedChildren, type FolderPagesLookup } from '../links/folderPages'

export interface TopicsTreeProps {
  /** The vault, which keys the persisted expansion bucket (the Sidebar is mounted per root). */
  root: string
  /** The window's index feed: the snapshot AND the resolver built from it, always read together. */
  source: WikilinkResolveSource
  /** The open file, highlighted wherever it appears — including under two parents at once. */
  activeFile: string | null
  onOpenFile: (path: string) => void
  /** ⌘-click (I3, GRO-2235): a background tab of THIS window — the file tree's other handler. */
  onOpenFileBackground: (path: string) => void
}

/**
 * THE Home link (🔒 D1). A wikilink, not a bare name, because it goes through the very resolver a
 * CLICK would use: `[[home]]`, an alias, a `Home.md` anywhere in the vault — all of it lands here.
 */
export const HOME_LINK = '[[Home]]'

/** Stands in while the index has not landed; only ever paired with an empty snapshot. */
const NEVER: ResolveLink = () => null

const byPath = (a: IndexRecord, b: IndexRecord): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)

/** The resolver and the records it was built from, always read together (BacklinksSection's idiom). */
interface Feed {
  records: readonly IndexRecord[]
  resolve: ResolveLink | null
}

/**
 * THE ROOTS RULE (🔒 D2), pure and exported so it can be pinned on its own: Home when it resolves
 * AND carries the flag, then every OTHER folder page with no parents, path-sorted.
 *
 * Home is not required to be parentless — a Home that says it belongs somewhere leads the tree
 * anyway AND still appears under its parent, which is the same "a page belongs under every parent"
 * rule the descent follows. It can never appear inside ITSELF: the descent's ancestor path starts
 * at the root it came from.
 */
export function topicRoots(records: readonly IndexRecord[], lookup: FolderPagesLookup, resolve: ResolveLink | null): IndexRecord[] {
  const homePath = resolve === null ? null : resolve(HOME_LINK)
  const home = homePath === null ? undefined : records.find((record) => record.path === homePath)
  // An ORDINARY page called Home is no Home for the tree: it gets no row, and the rule below
  // still stands the unparented folder pages up. (6C decides whether to OFFER one; not here.)
  const homeRoot = home !== undefined && lookup.isFolderPage(home) ? home : null
  const others = records
    .filter((record) => lookup.isFolderPage(record) && record.path !== homeRoot?.path && lookup.folderPagesOf(record.path).length === 0)
    .sort(byPath)
  return homeRoot === null ? others : [homeRoot, ...others]
}

export function TopicsTree({ root, source, activeFile, onOpenFile, onOpenFileBackground }: TopicsTreeProps) {
  // Subscribe once, re-read the whole feed on each poke; an unchanged snapshot keeps the previous
  // object, so index churn that changed nothing here costs no render (BacklinksSection's idiom).
  const [feed, setFeed] = useState<Feed>(() => ({ records: source.records, resolve: source.resolve }))
  useEffect(() => {
    const read = () =>
      setFeed((prev) => (prev.records === source.records && prev.resolve === source.resolve ? prev : { records: source.records, resolve: source.resolve }))
    read()
    return source.subscribe(read)
  }, [source])

  // 🔒 D4: PAGE PATHS, restored from the main-owned per-vault bucket, so the tree opens where it
  // was left — across a lens switch, a window and a restart alike.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(storage.getTopicsExpanded(root)))
  useEffect(() => {
    const next = [...expanded]
    const stored = storage.getTopicsExpanded(root)
    // Idempotent: the first render after a mount holds exactly what was just read, and re-sending
    // it would make the main process commit, write and broadcast for nothing.
    if (stored.length === next.length && stored.every((path, i) => path === next[i])) return
    storage.setTopicsExpanded(root, next)
  }, [root, expanded])

  // Uncategorized's own open/closed is SESSION state, deliberately not in the bucket above: that
  // bucket holds page paths (and is repaired as such on rename), and Uncategorized is not a page.
  const [showOrphans, setShowOrphans] = useState(false)

  const { records, resolve } = feed
  const lookup = useMemo(() => folderPagesLookup(records, resolve ?? NEVER), [records, resolve])
  const roots = useMemo(() => topicRoots(records, lookup, resolve), [records, lookup, resolve])
  // The subtraction is THIS surface's (🔒 D7): the lookup has no carve-outs, so a folder page
  // standing as a root would otherwise be listed as an orphan too — it has no parents either.
  const orphans = useMemo(() => {
    const shown = new Set(roots.map((record) => record.path))
    return lookup.uncategorized().filter((record) => !shown.has(record.path))
  }, [lookup, roots])

  const toggle = (path: string): void =>
    setExpanded((set) => {
      const next = new Set(set)
      if (!next.delete(path)) next.add(path)
      return next
    })

  const open = (path: string, e: React.MouseEvent): void => (e.metaKey ? onOpenFileBackground(path) : onOpenFile(path))

  /** The children to DESCEND into: the one door (⚡ D6), ordered by this parent's own settings. */
  const childrenFor = (parent: IndexRecord, trail: readonly string[]): IndexRecord[] =>
    lookup.isFolderPage(parent) ? orderedMembers(guardedChildren(lookup, parent.path, trail), folderPageSettings(parent), resolve ?? NEVER) : []

  const rowsFor = (members: readonly IndexRecord[], depth: number, ancestors: readonly string[]): ReactNode[] =>
    members.flatMap((member) => {
      // `trail` is the ancestor PATH of this row's own subtree — it is what guards the descent,
      // and (joined) what makes the React key unique for a page rendered under two parents.
      const trail = [...ancestors, member.path]
      const isFolderPage = lookup.isFolderPage(member)
      const kids = childrenFor(member, trail)
      const isOpen = kids.length > 0 && expanded.has(member.path)
      const active = member.path === activeFile
      const row = (
        <li key={trail.join('>')} role="treeitem" aria-expanded={kids.length > 0 ? isOpen : undefined} aria-selected={active}>
          <button
            type="button"
            className={`tree__row${isFolderPage ? ' tree__row--dir' : ''}${active ? ' tree__row--active' : ''}`}
            style={{ paddingLeft: 8 + depth * 14 }}
            title={member.path}
            onClick={(e) => open(member.path, e)}
          >
            {kids.length > 0 ? (
              // 🔒 D3: the chevron is its OWN hit target — expanding a topic is not opening it,
              // and the row around it stays the open gesture the file tree taught.
              <span
                role="button"
                className={`tree__chevron${isOpen ? ' tree__chevron--open' : ''}`}
                aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${member.basename}`}
                onClick={(e) => {
                  e.stopPropagation()
                  toggle(member.path)
                }}
              />
            ) : (
              <span className="tree__chevron tree__chevron--none" />
            )}
            {isFolderPage && <BaseGlyph className="tree__glyph" />}
            <span className="tree__label">{member.basename}</span>
            {/* DIRECT members — the honest fact about the page, so a member hidden from THIS
                branch by the loop guard is still counted where it belongs. The chevron above
                asks the guarded question instead, so it never opens onto nothing. */}
            {isFolderPage && <span className="tree__count">{lookup.pagesIn(member.path).length}</span>}
          </button>
        </li>
      )
      return isOpen ? [row, ...rowsFor(kids, depth + 1, trail)] : [row]
    })

  return (
    <>
      {roots.length > 0 && (
        <ul className="tree" role="tree" aria-label="Topics">
          {rowsFor(roots, 0, [])}
        </ul>
      )}
      {orphans.length > 0 && (
        <ul className="tree tree--uncategorized" role="tree" aria-label="Uncategorized">
          <li role="treeitem" aria-expanded={showOrphans}>
            {/* 🔒 D7: the whole row toggles — there is no page behind it to open. */}
            <button type="button" className="tree__row tree__row--muted" style={{ paddingLeft: 8 }} onClick={() => setShowOrphans((on) => !on)}>
              <span className={`tree__chevron${showOrphans ? ' tree__chevron--open' : ''}`} />
              <span className="tree__label">Uncategorized</span>
              <span className="tree__count">{orphans.length}</span>
            </button>
            {showOrphans && (
              <ul className="tree" role="group">
                {orphans.map((record) => (
                  <li key={record.path} role="treeitem" aria-selected={record.path === activeFile}>
                    <button
                      type="button"
                      className={`tree__row${record.path === activeFile ? ' tree__row--active' : ''}`}
                      style={{ paddingLeft: 8 + 14 }}
                      title={record.path}
                      onClick={(e) => open(record.path, e)}
                    >
                      <span className="tree__chevron tree__chevron--none" />
                      <span className="tree__label">{record.basename}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        </ul>
      )}
    </>
  )
}
