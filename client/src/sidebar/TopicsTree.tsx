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
 * The SET itself is the Sidebar's since ⚡ YAZ-873 — this tree is CONTROLLED: it computes the next
 * set and hands it up, while the restore and the write-back live with the owner, which needs the
 * same set for the lens row's expand/collapse-all button. `allExpandableTopics` below is that
 * button's answer: the same walk this tree draws, asked all at once.
 *
 * THE ROW UNFOLDS (⚡ YAZ-870, the amendment on 🔒 D3): clicking a folder-page row opens the page
 * AND expands it in place — one gesture, both meanings. Add-only: a second click never folds
 * (navigation must not close the tree under you; the chevron keeps the collapse), a ⌘-click
 * (background open, "not now") leaves the tree alone, and a page with nothing under it records
 * nothing. The chevron's own half of D3 stands untouched: expanding is still not opening.
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
 * THE OFFER (6C-, YAZ-849): the one thing this lens shows that is not the vault — a small card
 * above the tree, and ONLY when the folder has not been adopted (no `.yaseendocs/`, a fact App
 * establishes once per vault) AND nothing answers `[[Home]]`. An adopted vault never sees it: its
 * Home was created for it on open. The condition's live half is asked HERE, on this surface's own
 * feed, so the card retires the moment a Home appears — including an ordinary, unflagged page
 * called Home, which IS Home (🔒 D1) even though the roots rule above gives it no row. The card
 * REPLACES nothing: the roots and Uncategorized render underneath it exactly as they would.
 *
 * THE MENU (8G-, YAZ-865 — the ⚡ amendment on YAZ-821, ruled by Yasin): a PAGE row's right-click
 * opens the SAME `ContextMenu` a file row opens, on the page's own file. Not a menu of this
 * lens' own: the tree reports the row and the Sidebar — which owns the menu, its targets and
 * every pipeline behind them — does the rest, so copy/reveal/create/toggle/rename/delete can
 * never drift between the two readings of one vault. What gets NO menu: the Uncategorized
 * HEADER (no page behind it), the offer card, and blank space, whose menu stays the FILE tree's.
 * Still no drag.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { MAX_TOPICS_EXPANDED_PAGES, type IndexRecord } from '@shared/types'
import { folderPageSettings, orderedMembers } from '../views/folderPageSettings'
import { FolderPageGlyph } from '../views/view/icons'
import type { ResolveLink, WikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { folderPagesLookup, guardedChildren, type FolderPagesLookup } from '../links/folderPages'
import { CreateInline } from './CreateInline'
import type { EntryKind } from './createEntry'
import { HOME_LINK } from './ensureHome'
import { RenameInline } from './RenameInline'
import type { PendingRename } from './Tree'

/**
 * The inline "New …" input pending BESIDE one Topics row (8G-, YAZ-865). The file tree's
 * `PendingCreate` carries a `parentDir` because it has folder rows to nest the input inside;
 * this tree has none — a page's folder on disk is exactly what this reading hides — so the
 * input is anchored to the ROW the create was asked from and lines up with it. Where the file
 * LANDS is unchanged and still the Sidebar's: beside the right-clicked page (`targetDirFor`).
 */
export interface PendingTopicCreate {
  kind: EntryKind
  /** The right-clicked page's path; the input renders under that row's FIRST occurrence. */
  anchorPath: string
  onSubmit: (name: string) => Promise<void>
  onCancel: () => void
}

export interface TopicsTreeProps {
  /**
   * The open PAGE PATHS (🔒 D4). Owned by the Sidebar since ⚡ YAZ-873 — which restores it from
   * the per-vault bucket, writes it back, and needs the very same set for its expand-all button —
   * so this tree is CONTROLLED: it computes the next set and hands it up, nothing more. (The
   * `root` this tree used to take went with the bucket: keying it is the owner's job now.)
   */
  expanded: ReadonlySet<string>
  onExpandedChange: (next: ReadonlySet<string>) => void
  /** The window's index feed: the snapshot AND the resolver built from it, always read together. */
  source: WikilinkResolveSource
  /** The open file, highlighted wherever it appears — including under two parents at once. */
  activeFile: string | null
  onOpenFile: (path: string) => void
  /** ⌘-click (I3, GRO-2235): a background tab of THIS window — the file tree's other handler. */
  onOpenFileBackground: (path: string) => void
  /**
   * This folder has no `.yaseendocs/` (6C-, YAZ-849), so nothing was written into it and the
   * offer card is on the table. App establishes it once per vault (`useEnsureHome`) — it is a
   * fact about the FOLDER, not about Home, and stays true after the card has made one.
   */
  unadopted: boolean
  /** The card's one button: App runs the same create the auto-path runs, then opens the page. */
  onCreateHome: () => void
  /**
   * A PAGE row was right-clicked (8G-, YAZ-865): the Sidebar opens its ONE `ContextMenu` on that
   * page's file. Every member row gets it, at any depth and under Uncategorized too; the
   * Uncategorized HEADER and the offer card do not, and blank space is left to bubble so the
   * body's guard can hand it on unchanged.
   */
  onRowContextMenu: (path: string, e: React.MouseEvent) => void
  /** The one page currently renamed inline (menu → Rename), or null. The file tree's own type. */
  renaming: PendingRename | null
  /** The inline create input pending under one row (menu → New note / folder page / folder), or null. */
  creating: PendingTopicCreate | null
}

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

/**
 * THE EXPAND-ALL ANSWER (⚡ YAZ-873), pure and exported beside the roots rule it starts from:
 * every page the tree could unfold, once each, in walk order (roots first, depth first). It is
 * the SAME descent the rows are drawn from — from every root, through `guardedChildren` only
 * (⚡ D6), never raw `pagesIn` — so a loop ends quietly and a page whose only member already
 * stands above it on every reachable trail is honestly not expandable, exactly as its missing
 * chevron says. A diamond page counts ONCE: the set is keyed by page path, like the expansion
 * itself (🔒 D4). Capped at the bucket's own ceiling, because the answer is written into it.
 */
export function allExpandableTopics(records: readonly IndexRecord[], lookup: FolderPagesLookup, resolve: ResolveLink | null): string[] {
  const found: string[] = []
  const seen = new Set<string>()
  const descend = (page: IndexRecord, trail: readonly string[]): void => {
    const kids = guardedChildren(lookup, page.path, trail)
    if (kids.length === 0) return // a chevron-less row: there is nothing here to open
    if (!seen.has(page.path)) {
      seen.add(page.path)
      found.push(page.path)
    }
    // Only a folder page holds members, so only a folder page is descended into — `childrenFor`'s
    // own test, kept in step so the walk can never reach a row the tree does not draw.
    for (const kid of kids) if (lookup.isFolderPage(kid)) descend(kid, [...trail, kid.path])
  }
  for (const start of topicRoots(records, lookup, resolve)) descend(start, [start.path])
  return found.slice(0, MAX_TOPICS_EXPANDED_PAGES)
}

export function TopicsTree({ expanded, onExpandedChange, source, activeFile, onOpenFile, onOpenFileBackground, unadopted, onCreateHome, onRowContextMenu, renaming, creating }: TopicsTreeProps) {
  // Subscribe once, re-read the whole feed on each poke; an unchanged snapshot keeps the previous
  // object, so index churn that changed nothing here costs no render (BacklinksSection's idiom).
  const [feed, setFeed] = useState<Feed>(() => ({ records: source.records, resolve: source.resolve }))
  useEffect(() => {
    const read = () =>
      setFeed((prev) => (prev.records === source.records && prev.resolve === source.resolve ? prev : { records: source.records, resolve: source.resolve }))
    read()
    return source.subscribe(read)
  }, [source])

  // Uncategorized's own open/closed is SESSION state, deliberately not in the lifted bucket: that
  // bucket holds page paths (and is repaired as such on rename), and Uncategorized is not a page.
  // So it stays HERE while the expansion went up — the two are not the same kind of fact.
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

  // Pure computations over the prop since ⚡ YAZ-873 — the next set goes up, the owner decides.
  const toggle = (path: string): void => {
    const next = new Set(expanded)
    if (!next.delete(path)) next.add(path)
    onExpandedChange(next)
  }

  // ⚡ YAZ-870: `toggle`'s add-only twin — the row gesture unfolds but never folds, so
  // navigating to a page you are already on cannot close the tree under you.
  const expand = (path: string): void => {
    if (expanded.has(path)) return
    onExpandedChange(new Set(expanded).add(path))
  }

  const open = (path: string, e: React.MouseEvent): void => (e.metaKey ? onOpenFileBackground(path) : onOpenFile(path))

  /** The children to DESCEND into: the one door (⚡ D6), ordered by this parent's own settings. */
  const childrenFor = (parent: IndexRecord, trail: readonly string[]): IndexRecord[] =>
    lookup.isFolderPage(parent) ? orderedMembers(guardedChildren(lookup, parent.path, trail), folderPageSettings(parent), resolve ?? NEVER) : []

  // A page stands under EVERY parent that claims it (⚡ D6), so one path can own several rows —
  // but an inline input is ONE input: two autofocused ones would fight, the second's mount
  // blurring (and so cancelling) the first. Both land on the FIRST occurrence in document order,
  // which the top-down traversal below makes deterministic. Reset every render, never state.
  let renameRendered = false
  let createRendered = false

  /** The rename input in place of THIS row's label, or null when this row is not the one. */
  const renameOn = (record: IndexRecord, indent: number): ReactNode => {
    if (renaming === null || renaming.path !== record.path || renameRendered) return null
    renameRendered = true
    // `basename` is already the name minus its extension, which is exactly the file tree's prefill.
    return <RenameInline initial={record.basename} indent={indent} onSubmit={renaming.onSubmit} onCancel={renaming.onCancel} />
  }

  /** The create input pending BESIDE this row, as its own `<li>`, or null. */
  const createUnder = (record: IndexRecord, indent: number): ReactNode => {
    if (creating === null || creating.anchorPath !== record.path || createRendered) return null
    createRendered = true
    return (
      // `␟` (U+241F) separates the key's parts: a printable character that cannot appear in a
      // path or a name, so the key stays unique. It replaces a literal NUL, which did the same
      // job but made this file grep-invisible — `grep` treats a NUL byte as binary and skips it.
      <li key={`${record.path}␟new`}>
        <CreateInline kind={creating.kind} indent={indent} onSubmit={creating.onSubmit} onCancel={creating.onCancel} />
      </li>
    )
  }

  const rowsFor = (members: readonly IndexRecord[], depth: number, ancestors: readonly string[]): ReactNode[] =>
    members.flatMap((member) => {
      // `trail` is the ancestor PATH of this row's own subtree — it is what guards the descent,
      // and (joined) what makes the React key unique for a page rendered under two parents.
      const trail = [...ancestors, member.path]
      const isFolderPage = lookup.isFolderPage(member)
      const kids = childrenFor(member, trail)
      const isOpen = kids.length > 0 && expanded.has(member.path)
      const active = member.path === activeFile
      const indent = 8 + depth * 14
      const inlineRename = renameOn(member, indent)
      const row = (
        <li key={trail.join('>')} role="treeitem" aria-expanded={kids.length > 0 ? isOpen : undefined} aria-selected={active}>
          {/* Rename (YAZ-865) replaces the row exactly as it does in the file tree — never beside it. */}
          {inlineRename ?? (
            <button
              type="button"
              className={`tree__row${isFolderPage ? ' tree__row--dir' : ''}${active ? ' tree__row--active' : ''}`}
              style={{ paddingLeft: indent }}
              title={member.path}
              onClick={(e) => {
                open(member.path, e)
                // ⚡ YAZ-870: opening a topic unfolds it too — foreground opens only (⌘ says
                // "not now", so the tree stays put), and only when there is something to show
                // (`kids` is already the guarded, folder-page-only answer: leaves have none).
                if (kids.length > 0 && !e.metaKey) expand(member.path)
              }}
              onContextMenu={(e) => onRowContextMenu(member.path, e)}
            >
              {kids.length > 0 ? (
                // 🔒 D3: the chevron is its OWN hit target — expanding a topic is not opening it.
                // (The row around it opens AND unfolds since ⚡ YAZ-870; the chevron alone folds.)
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
              {isFolderPage && <FolderPageGlyph className="tree__glyph" />}
              <span className="tree__label">{member.basename}</span>
              {/* DIRECT members — the honest fact about the page, so a member hidden from THIS
                  branch by the loop guard is still counted where it belongs. The chevron above
                  asks the guarded question instead, so it never opens onto nothing. */}
              {isFolderPage && <span className="tree__count">{lookup.pagesIn(member.path).length}</span>}
            </button>
          )}
        </li>
      )
      // The create input sits directly under the row it was asked from — a SIBLING on disk, so
      // it wears that row's own indent — and above whatever the row is expanded onto.
      const born = createUnder(member, indent)
      const below = isOpen ? rowsFor(kids, depth + 1, trail) : []
      return born === null ? [row, ...below] : [row, born, ...below]
    })

  // The offer's live half (see the module doc): `resolve` is null until the first index lands, and
  // a card shown then would be asking about a vault nobody has read yet.
  const offerHome = unadopted && resolve !== null && resolve(HOME_LINK) === null

  return (
    <>
      {offerHome && (
        <div className="topics-offer">
          <p className="topics-offer__title">Your map starts here</p>
          <p className="topics-offer__body">A Home page is the top of your topics. Making one adds a single note to this folder.</p>
          <button type="button" className="btn btn--primary topics-offer__go" onClick={onCreateHome}>
            Create Home
          </button>
        </div>
      )}
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
                {/* An unfiled note is a PAGE like any other, so it carries the same menu, the
                    same inline rename and the same create-beside as a nested row (YAZ-865) —
                    only the muted HEADER above has no page behind it and so offers nothing. */}
                {orphans.flatMap((record) => {
                  const inline = renameOn(record, 8 + 14)
                  const born = createUnder(record, 8 + 14)
                  const row = (
                    <li key={record.path} role="treeitem" aria-selected={record.path === activeFile}>
                      {inline ?? (
                        <button
                          type="button"
                          className={`tree__row${record.path === activeFile ? ' tree__row--active' : ''}`}
                          style={{ paddingLeft: 8 + 14 }}
                          title={record.path}
                          onClick={(e) => open(record.path, e)}
                          onContextMenu={(e) => onRowContextMenu(record.path, e)}
                        >
                          <span className="tree__chevron tree__chevron--none" />
                          <span className="tree__label">{record.basename}</span>
                        </button>
                      )}
                    </li>
                  )
                  return born === null ? [row] : [row, born]
                })}
              </ul>
            )}
          </li>
        </ul>
      )}
    </>
  )
}
