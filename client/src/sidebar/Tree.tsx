import { memo } from 'react'
import type { TabSort, TreeNode } from '@shared/types'
import { pageLabel, type PathTitles } from '../lib/pageLabel'
import { CreateInline } from './CreateInline'
import type { EntryKind, MenuRow } from './createEntry'
import { focusOpenDocument } from '../lib/focusHandoff'
import { isBoard, isMarkdown } from '@shared/fileKind'
import { copyFoldKey, copyFoldParts } from '@shared/foldKey'
import { CloudOffIcon, DiagramBadge, LinkIcon, ShortcutIcon } from '../views/view/icons'
import { TOO_LARGE_LABEL } from '../lib/syncAttention'
import { RenameInline } from './RenameInline'
import { sortLevel } from './treeSort'

/** Inline "New note" / "New folder" input pending inside the tree (GRO-2022). */
export interface PendingCreate {
  kind: EntryKind
  seed: string
  /** Absolute path of the directory the entry is created in. */
  parentDir: string
  /**
   * The top row of the right-clicked copy (YAZ-2845 D1): on Focus and Favorites a folder can show
   * twice, and two inputs would each take the focus — the first one's blur is its cancel. So the
   * input mounts under that copy alone. Null (blank space, a search row): under each level that matches.
   */
  top: string | null
  onSubmit: (name: string) => Promise<void>
  onCancel: () => void
}

/** Inline rename replacing one row's label (files E1, GRO-2194; folders E1b, GRO-2241). */
export interface PendingRename {
  /** Absolute path of the row (file or dir) being renamed. */
  path: string
  /** As `PendingCreate.top` (YAZ-2845 D1): the box replaces the label of the right-clicked copy alone. */
  top: string | null
  /** A note's or a folder's box edits a TITLE: the vault uses IDs. Where it does not (YAZ-2523 🔒 V3) it edits a file name, held to the name rules. */
  title: boolean
  onSubmit: (name: string) => Promise<void>
  onCancel: () => void
}

/**
 * Drag a FILE row onto a FOLDER row to move it there (E1b, GRO-2241). The TabBar's HTML5
 * drag idiom: component state carries the payload (`dataTransfer` is guarded — jsdom's
 * synthetic drags have none), a highlight class marks the hovered drop target. FILE rows
 * only — no multi-select, no folder dragging (Future note in GRO-2241).
 */
export interface TreeFileMove {
  /** The dragged FILE row's path; null when no drag is in flight. */
  dragging: string | null
  /** The dir currently highlighted as the drop target (a dir row's path, or the root for the header). */
  dropDir: string | null
  start: (path: string) => void
  end: () => void
  hover: (dir: string | null) => void
  drop: (dir: string) => void
}

/**
 * Drag a TOP row to reorder (YAZ-1766 D4; one rule for every tab, YAZ-2631 D3): the SAME HTML5 idiom
 * as `TreeFileMove`, but a separate mechanism — it rewrites the tab's LIST and never touches disk.
 * On the top rows only, a file or a folder: a deeper file row still moves on disk, and a deeper folder row does not drag.
 */
export interface TreeReorder {
  /** The dragged top row's path; null when no drag is in flight. */
  dragging: string | null
  /** The hovered top row and which edge of it the drop lands on. */
  over: { path: string; edge: 'before' | 'after' } | null
  start: (path: string) => void
  hover: (path: string, edge: 'before' | 'after') => void
  drop: () => void
  end: () => void
}

/** `label` with the typed text marked where it first sits (🔒 D5, YAZ-2620); a label that does not hold it (an alias or an id matched) is drawn plain. */
function marked(label: string, needle: string | undefined) {
  const at = needle === undefined ? -1 : label.toLowerCase().indexOf(needle)
  if (needle === undefined || at === -1) return label
  return (
    <>
      {label.slice(0, at)}
      <mark className="tree__mark">{label.slice(at, at + needle.length)}</mark>
      {label.slice(at + needle.length)}
    </>
  )
}

/** Which half of the hovered row the pointer is in — jsdom's zero rect and 0 clientY read as `after`. */
const edgeOf = (e: React.DragEvent): 'before' | 'after' => {
  const r = e.currentTarget.getBoundingClientRect()
  return e.clientY < r.top + r.height / 2 ? 'before' : 'after'
}

/**
 * The arrows on a row of Files, Focus or Favorites (YAZ-2662 D11): ↓ and ↑ move the keyboard focus
 * to the next row on show and to the row before, and stop at both ends; → opens a closed folder row
 * and ← closes an open one. They read the rows as drawn, select nothing and open no page. A rename
 * box or a create box is no row, so its arrows stay its own (S64).
 */
function rowArrows(e: React.KeyboardEvent<HTMLElement>, onToggle: (dir: string) => void, onLeaveToPage?: () => boolean): void {
  const row = e.target instanceof HTMLElement && e.target.matches('.tree__row') ? e.target : null
  const path = row?.dataset.path
  if (row === null || path === undefined) return
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const rows = [...e.currentTarget.querySelectorAll<HTMLElement>('.tree__row[data-path]')]
    rows[rows.indexOf(row) + (e.key === 'ArrowDown' ? 1 : -1)]?.focus()
  } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    // A folder's item says whether it is open; a file's says nothing, so neither key acts on it.
    // A folder row of a copy (YAZ-3131) folds under its own key, which the row carries in `data-fold`.
    if (row.closest('[role="treeitem"]')?.getAttribute('aria-expanded') === String(e.key === 'ArrowLeft')) onToggle(row.dataset.fold ?? path)
    // → with nothing to open — a file row, a folder that is open — goes to the new tab page, when
    // it shows and has a row (YAZ-2663 D8). With no such page the key does nothing, as before (S62).
    else if (e.key === 'ArrowRight' && !(e.metaKey || e.ctrlKey || e.altKey || e.shiftKey)) onLeaveToPage?.()
  } else return
  e.preventDefault()
}

/**
 * A HELD Enter on a row does nothing (YAZ-2662 D1, D8): Enter and Shift+Enter in the search bar put
 * the keyboard focus on a row of Files, and the repeats of that press arrive there — where Enter
 * opens the row and Shift+Enter toggles it in the selection. The ONE guard, for a folder row, a
 * file row and Shift alike: the repeat is taken at the top of the tree, before the row and its
 * button's own click. A rename box or a create box is no row, so its Enter stays its own.
 */
function heldEnter(e: React.KeyboardEvent<HTMLElement>): void {
  if (e.key !== 'Enter' || !e.repeat || !(e.target instanceof HTMLElement) || !e.target.matches('.tree__row')) return
  e.preventDefault()
  e.stopPropagation()
}

/**
 * Sidebar multi-select (YAZ-1336, 🔒 D1) as both trees take it: the selected PATHS plus the two
 * gestures that change them. The Sidebar owns the reducer behind it; keying by path is 🔒 D3, so
 * a favorite standing at the root AND inside its favorited parent is ONE selected path. Which of
 * its rows LIGHTS is the copy it was picked in (YAZ-3131 Decision 3, `copies`). A path is a file
 * or a FOLDER (YAZ-1578): a selected folder is the folder itself, never its contents.
 */
export interface TreeSelection {
  paths: ReadonlySet<string>
  /** The copy each picked path was picked in (YAZ-3131): its top row. A path with no entry lights in every copy. */
  copies?: ReadonlyMap<string, string>
  /** 🔒 D2: shift+click on a file or folder row toggles it in or out — no range, never an open, never a fold. `top`: the copy it was picked in. */
  toggle: (path: string, top?: string) => void
  /** D9 (YAZ-1674): a plain click or ⌘-click makes the selection EXACTLY this row — then opens or folds as before. `top`: the copy it was picked in. */
  set: (path: string, top?: string) => void
}

/** What a search tree marks (🔒 D5, YAZ-2620): the paths the query matched, and the query as the matcher reads it — trimmed, lowercased. */
export interface TreeMarks {
  hits: ReadonlySet<string>
  needle: string
  /** The rows found by their ID, each with its full ID (YAZ-2677 S70): shown in front of the title, which tells note 12 of two vaults apart. */
  ids?: ReadonlyMap<string, string>
}

interface TreeProps {
  nodes: TreeNode[]
  /** Absolute path of the directory these nodes are children of (the root at depth 0; '' above the vault rows, which no one directory holds). */
  dirPath: string
  /**
   * The paths that are VAULT rows (YAZ-2602 D3), each with its vault's name: with two or more vaults
   * each vault is one folder row, labelled as the app names the vault. It opens, closes, selects and
   * takes a drop like a folder, and is no page: it does not open as a tab. Empty with one vault.
   * A top row that is NOT one — a file or a folder of the Focus tab or of the Favorites tab (YAZ-2631 D4) — shows the name of the vault that holds it.
   */
  vaultRows: ReadonlyMap<string, string>
  expanded: ReadonlySet<string>
  /**
   * The rows are copies (YAZ-3131 Decision 2): Focus and Favorites can draw one folder under two top
   * rows. Each copy then folds under its own key (`copyFoldKey`), never the Files tab's plain path.
   */
  copies?: boolean
  activeFile: string | null
  /** The copy the open page lights in (YAZ-3131 Decision 3); null or absent: every row of it lights. */
  activeTop?: string | null
  onToggle: (dir: string) => void
  /** `top`: the copy of Focus or Favorites the row was clicked in (YAZ-3131 S11), so the page lights there. */
  onOpenFile: (path: string, top?: string) => void
  /**
   * A double click on a row (YAZ-2648 D2): the page is a KEPT tab. On a file row the first click
   * has opened it in the preview tab, and this keeps it; a folder row opens its folder as one.
   * `top`: as `onOpenFile`'s (YAZ-3144), so a page kept from a copy lights there too.
   */
  onKeepFile: (path: string, top?: string) => void
  /**
   * ⌘-click on a file row (I3 LOCKED ruling, GRO-2235): open it in a background tab of THIS
   * window — activation stays put. "Open in new window" lives on the context menu (D2).
   */
  onOpenFileBackground: (path: string) => void
  /** A row with no in-app viewer (`kind: null`, YAZ-1577 D2): hand it to the OS default app instead of a tab. */
  onOpenDefault: (path: string) => void
  /** Right-click on a row — a shortcut row says which folder it stands in; blank-space right-clicks are handled by the sidebar body. */
  onNodeContextMenu: (node: MenuRow, e: React.MouseEvent) => void
  pending: PendingCreate | null
  /** The one row (file or dir) currently renamed inline (E1/E1b); null when none. */
  renaming: PendingRename | null
  /** File drag-to-move state + callbacks (E1b); owned by the Sidebar. */
  move: TreeFileMove
  /** Multi-select state + gestures (YAZ-1336); owned by the Sidebar, shared with the Favorites tab. The search tree hands in its one highlighted match in this shape instead (YAZ-2620). */
  selection: TreeSelection
  /**
   * Each folder's SHORTCUTS, by its path (YAZ-2290 D2): notes that live elsewhere, drawn as
   * file rows among the folder's own files, marked. The row IS the note — it opens it, and
   * selection and the active highlight follow its path, so it lights with its real row (🔒 D3's
   * rule for a favorite on two rows) — but it is no file of this folder: it never drags, and a
   * click on it selects nothing, so ⌘C / ⌘X / ⌘V never act on the note from here.
   */
  shortcuts: ReadonlyMap<string, readonly TreeNode[]>
  /** What each row is labelled with (YAZ-2420 🔒 D15): its title; a row the index does not hold shows its file name. Name sorts by this label (YAZ-3227 D8). */
  titles: PathTitles
  /** A tab whose top rows reorder (YAZ-2631 D3): they drag along the list instead of moving on disk. Without it no row reorders. The top level alone gets it, so a drag's line draws no level below again. */
  reorder?: TreeReorder
  /** The tab's sort (YAZ-3227); absent on the Search tab, whose rows stand by name, A to Z. */
  sort?: TabSort
  /**
   * Search only (🔒 D5, YAZ-2620): the matched rows and the typed text, lowercased. A row in `hits`
   * shows that text marked in its label; a row outside it — a parent of a match, or a row inside a
   * matched folder — is drawn dim. Without it a tree draws, and re-renders, exactly as before.
   */
  marks?: TreeMarks
  /** The way to the new tab page from a row of Files, Focus or Favorites (YAZ-2663 D8): → on a row that has nothing to open asks it. The top level's alone. */
  onLeaveToPage?: () => boolean
  /** The top row this level stands under (YAZ-2845 D1); none at the top level. It tells the copies of a row that shows twice apart. */
  top?: string
  /**
   * The pointer or the focus rests on a drawing, diagram or note row, or left it (null): the hover
   * preview's dwell (YAZ-3028 D11; notes since YAZ-3075 D4). Absent → no row reports it. A text, PDF
   * or image row never does.
   */
  onHoverFile?: (node: { path: string } | null) => void
  /** YAZ-1801 D3 (YAZ-3039): absolute paths sync held back as over GitHub's limit; their rows get the cloud-off icon. A stable Set (the memo compares identity). */
  tooLarge?: ReadonlySet<string>
  /** Shared boards (YAZ-3040, Draw's YAZ-1799): a small link mark on the row, red when the last update failed or the link is stale; the title is the status. A stable Map. */
  shareBadges?: ReadonlyMap<string, ShareBadge>
  depth?: number
}

/** A shared board's mark (YAZ-3040, Draw's YAZ-1890): its tone, and its title — the link's status in words. */
export interface ShareBadge {
  tone: 'ok' | 'error'
  title: string
}

/** The shared-board mark: a small link glyph right of the name; nothing for an unshared board. */
const ShareMark = ({ badge }: { badge: ShareBadge | undefined }) =>
  badge === undefined ? null : (
    <span className="tree__share" data-tone={badge.tone} title={badge.title} aria-label={badge.title} role="img">
      <LinkIcon size={12} />
    </span>
  )

function TreeLevel({
  nodes,
  dirPath,
  vaultRows,
  expanded,
  copies = false,
  activeFile,
  activeTop,
  onToggle,
  onOpenFile,
  onKeepFile,
  onOpenFileBackground,
  onOpenDefault,
  onNodeContextMenu,
  pending,
  renaming,
  move,
  selection,
  shortcuts,
  titles,
  reorder,
  sort,
  marks,
  onLeaveToPage,
  top,
  onHoverFile,
  tooLarge,
  shareBadges,
  depth = 0,
}: TreeProps) {
  const recurse = { vaultRows, expanded, copies, activeFile, activeTop, onToggle, onOpenFile, onKeepFile, onOpenFileBackground, onOpenDefault, onNodeContextMenu, pending, renaming, move, selection, shortcuts, titles, marks, onHoverFile, tooLarge, shareBadges, sort }
  /** A board or note row's hover handlers (YAZ-3028 D11, YAZ-3075 D4): pointer and focus alike, so the keyboard walk previews too. */
  const hoverOf = (path: string) =>
    onHoverFile === undefined || !(isBoard(path) || isMarkdown(path)) ? {} : { onMouseEnter: () => onHoverFile({ path }), onMouseLeave: () => onHoverFile(null), onFocus: () => onHoverFile({ path }), onBlur: () => onHoverFile(null) }
  // This folder's shortcuts stand among its FILES (YAZ-2290), and the tab's sort orders the level (YAZ-3227 D7).
  // The top rows of a Manual list, and the vault rows, keep their own order; with no sort (Search) a level stands as it came.
  const here = shortcuts.get(dirPath)
  const keep = sort === undefined ? here === undefined : depth === 0 && (copies ? sort.by === 'manual' : vaultRows.size > 0)
  const rows = keep ? nodes : sortLevel(here === undefined ? nodes : [...nodes, ...here], sort, (node) => pageLabel(node.path, node.type === 'dir', titles))
  const isShortcutRow = (node: TreeNode): boolean => here?.includes(node) === true
  // The top row a row stands under (YAZ-2845 D1): a top row is its own. It tells the copies of a row
  // that shows twice apart, and a right-click hands it to the menu, so an input mounts in that copy alone.
  const topOf = (node: TreeNode): string => top ?? node.path
  const inCopy = (want: string | null, node: TreeNode): boolean => want === null || want === topOf(node)
  /** The key this folder row folds under: its copy's own in Focus and Favorites (YAZ-3131), else its path. */
  const foldOf = (node: TreeNode): string => (copies ? copyFoldKey(topOf(node), node.path) : node.path)
  /** The copy a click picks in (YAZ-3131): only a tree of copies records one. */
  const copyOf = (node: TreeNode): string | undefined => (copies ? topOf(node) : undefined)
  // A path lights in ONE copy (YAZ-3131 Decision 3): the copy it was picked in; with none, every copy, as before.
  // A note's SHORTCUT row is no copy (YAZ-3142, S18): it lights with its real row wherever that one
  // stands, as YAZ-2290 🔒 D3 has it.
  const isActive = (node: TreeNode): boolean => node.path === activeFile && (activeTop == null || isShortcutRow(node) || activeTop === topOf(node))
  const isSelected = (node: TreeNode): boolean => selection.paths.has(node.path) && (isShortcutRow(node) || (selection.copies?.get(node.path) ?? topOf(node)) === topOf(node))
  // The top level is no copy of anything: one per tab, so a create there (the root) mounts as before.
  const createsHere = pending !== null && pending.parentDir === dirPath && (pending.top === null || top === undefined || pending.top === top)
  // The reorder gesture lives on the TOP rows alone (YAZ-2631 D3): a favorite, a focus item, a vault row of Files.
  const rowReorder = reorder !== undefined && depth === 0 ? reorder : null
  /** The vault a top row of the Focus tab or of the Favorites tab is in, file or folder (YAZ-2631 D4): said only where the window has two or more. A vault row is in no vault's folder, so it says none — and Files has no other top row. */
  const vaultTag = (path: string) => {
    const name = depth > 0 ? undefined : [...vaultRows].find(([row]) => path.startsWith(`${row}/`))?.[1]
    return name !== undefined && <span className="tree__vault">{name}</span>
  }
  // What a FILE row's drag does: reorder on a top row of a tree that reorders, else move on disk (E1b).
  const fileDrag: Pick<TreeFileMove, 'start' | 'end'> = rowReorder ?? move
  // A top row of a SORTED Focus or Favorites list does not drag at all (YAZ-3227 D6): its drag would reorder, and
  // the order is the sort's — it must not turn into a move on disk. A shortcut row never drags (YAZ-2290 D2).
  const noDrag = (node: TreeNode): boolean => isShortcutRow(node) || (copies && depth === 0 && rowReorder === null)
  const dropEdge = (path: string) => (rowReorder?.over?.path === path ? ` tree__row--drop-${rowReorder.over.edge}` : '')
  // In a search tree (🔒 D5, YAZ-2620) a row the query did not match only gives a match its place.
  const context = (path: string) => (marks !== undefined && !marks.hits.has(path) ? ' tree__row--context' : '')
  const needleFor = (path: string) => (marks?.hits.has(path) ? marks.needle : undefined)
  /** `YAZ-12 — ` in front of the row of an ID match (YAZ-2677 S70); nothing for any other row. */
  const idFor = (path: string) => (marks?.ids?.has(path) ? `${marks.ids.get(path)} — ` : null)
  return (
    // The arrows are the whole tree's, taken once at its top (YAZ-2662 D11) — not a search tree's, whose keys are the search bar's.
    // A held Enter is stopped there too, in each tree.
    <ul className="tree" role={depth === 0 ? 'tree' : 'group'} onKeyDownCapture={depth === 0 ? heldEnter : undefined} onKeyDown={depth === 0 && marks === undefined ? (e) => rowArrows(e, onToggle, onLeaveToPage) : undefined}>
      {pending !== null && createsHere && (
        <li>
          <CreateInline
            kind={pending.kind}
            seed={pending.seed}
            indent={8 + depth * 14 + (pending.kind === 'dir' ? 0 : 14)}
            onSubmit={pending.onSubmit}
            onCancel={pending.onCancel}
          />
        </li>
      )}
      {rows.map((node) =>
        node.type === 'dir' ? (
          <li key={node.path} role="treeitem" aria-expanded={expanded.has(foldOf(node))} aria-selected={isActive(node) || isSelected(node)}>
            {renaming !== null && renaming.path === node.path && inCopy(renaming.top, node) ? (
              // Inline FOLDER rename (E1b, GRO-2241): same idiom as files, and what it edits is
              // the folder's TITLE (YAZ-2420 🔒 D16).
              <RenameInline initial={pageLabel(node.path, true, titles)} title={renaming.title} indent={8 + depth * 14} onSubmit={renaming.onSubmit} onCancel={renaming.onCancel} />
            ) : (
              <button
                type="button"
                // The folder itself is a tab (YAZ-2290 D3), so its row is the active one while that tab is.
                className={`tree__row tree__row--dir${vaultRows.has(node.path) ? ' tree__row--vault' : ''}${isActive(node) ? ' tree__row--active' : ''}${isSelected(node) ? ' tree__row--selected' : ''}${move.dropDir === node.path ? ' tree__row--drop' : ''}${dropEdge(node.path)}${context(node.path)}`}
                style={{ paddingLeft: 8 + depth * 14 }}
                // Read by `flashTreeRows` (a Files reveal of a FOLDER, YAZ-1491) and by
                // `orderedSelection`, which puts a selected folder in on-screen order (YAZ-1578).
                data-path={node.path}
                data-fold={foldOf(node)}
                // Shift is the SELECTION gesture everywhere (YAZ-1340) and a folder joins the
                // selection like a file (YAZ-1578, 🔒 D1) — so shift toggles and never folds. A
                // PLAIN click SELECTS the folder (D9, YAZ-1674 — the Finder rule) and then folds,
                // so ⌘C / ⌘V have a target the moment a folder is clicked.
                onClick={(e) => {
                  if (e.shiftKey) {
                    selection.toggle(node.path, copyOf(node))
                    return
                  }
                  selection.set(node.path, copyOf(node))
                  onToggle(foldOf(node))
                }}
                // The folder itself is the tab (YAZ-2290 D3, overturning YAZ-1578 D3): a double
                // click opens it, as a KEPT tab (YAZ-2648 D2). Its two clicks have selected and folded
                // as ever; shift never opens. A vault row is no page (YAZ-2602 D3): neither gesture
                // opens one, and Enter folds it.
                onDoubleClick={(e) => {
                  if (!e.shiftKey && !vaultRows.has(node.path)) onKeepFile(node.path, copyOf(node))
                }}
                // Enter opens it too, as it opens a file row — there through the button's own click,
                // which on this row folds. So the key is taken here and Space is left to fold.
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' || e.shiftKey || vaultRows.has(node.path)) return
                  e.preventDefault()
                  selection.set(node.path, copyOf(node))
                  onOpenFile(node.path, copyOf(node))
                }}
                onContextMenu={(e) => onNodeContextMenu({ ...node, top: topOf(node) }, e)}
                draggable={rowReorder !== null}
                onDragStart={rowReorder === null ? undefined : (e) => {
                  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
                  rowReorder.start(node.path)
                }}
                onDragEnd={rowReorder?.end}
                onDragOver={(e) => {
                  if (rowReorder !== null && rowReorder.dragging !== null) {
                    e.preventDefault()
                    rowReorder.hover(node.path, edgeOf(e))
                    return
                  }
                  if (move.dragging === null) return
                  e.preventDefault() // a dir row is a valid drop target while a file drag is in flight
                  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
                  if (move.dropDir !== node.path) move.hover(node.path)
                }}
                onDragLeave={() => {
                  if (move.dropDir === node.path) move.hover(null)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  if (rowReorder !== null && rowReorder.dragging !== null) rowReorder.drop()
                  else move.drop(node.path)
                }}
              >
                <span className={`tree__chevron${expanded.has(foldOf(node)) ? ' tree__chevron--open' : ''}`} />
                <span className="tree__label">
                  {idFor(node.path)}
                  {vaultRows.has(node.path) ? node.name : marked(pageLabel(node.path, true, titles), needleFor(node.path))}
                </span>
                {vaultTag(node.path)}
              </button>
            )}
            {expanded.has(foldOf(node)) && <Tree nodes={node.children} dirPath={node.path} depth={depth + 1} top={topOf(node)} {...recurse} />}
          </li>
        ) : renaming !== null && renaming.path === node.path && !isShortcutRow(node) && inCopy(renaming.top, node) ? (
          // Inline rename (Links E1, GRO-2194): a note's box edits its TITLE (YAZ-2420 🔒 D16);
          // view-only files show the full filename so their extension stays explicit.
          // The REAL row only: a second input on the note's shortcut row would take the focus,
          // and the first one's blur is its commit (YAZ-1553).
          <li key={node.path} role="treeitem">
            <RenameInline initial={pageLabel(node.path, false, titles)} title={renaming.title && node.kind === 'markdown'} indent={8 + depth * 14 + 14} onSubmit={renaming.onSubmit} onCancel={renaming.onCancel} />
          </li>
        ) : (
          <li key={node.path} role="treeitem" aria-selected={isActive(node) || isSelected(node)}>
            <button
              type="button"
              className={`tree__row tree__row--file${node.kind === null ? ' tree__row--external' : ''}${isActive(node) ? ' tree__row--active' : ''}${isSelected(node) ? ' tree__row--selected' : ''}${dropEdge(node.path)}${context(node.path)}`}
              style={{ paddingLeft: 8 + depth * 14 + 14 }}
              onClick={(e) => {
                // Shift is the SELECTION gesture and nothing else (YAZ-1336, 🔒 D2): it never
                // opens, never previews — so it is asked first, before any of the open rules.
                if (e.shiftKey) {
                  if (!isShortcutRow(node)) selection.toggle(node.path, copyOf(node))
                  return
                }
                // Every other click makes the selection THIS row (D9, YAZ-1674) — plain and ⌘
                // alike, the external row too — before the open rules decide where it opens.
                if (!isShortcutRow(node)) selection.set(node.path, copyOf(node))
                // No in-app viewer (YAZ-1577 D2): the OS default app IS the viewer, so no tab —
                // and nothing for ⌘ to background. Asked before the open rules, after shift.
                if (node.kind === null) {
                  onOpenDefault(node.path)
                  return
                }
                // First activation previews, second commits (YAZ-921): opening keeps focus on the
                // row, re-activating the open page enters its text.
                // The commit is KEYBOARD-only since D11 (YAZ-1674): Enter on the open row takes the
                // caret in (a keyboard click has `detail === 0`); a MOUSE click on the open note
                // just selects it, so click-then-⌘C works on every row instead of handing the key
                // to the editor.
                // The open row asks for its page too: the workspace changes nothing for the page
                // it already shows, and App closes the tab board over it (YAZ-2648 S46).
                if (e.metaKey) onOpenFileBackground(node.path)
                else {
                  // A shortcut row hands no copy (YAZ-3142): its note lights where the note itself stands.
                  onOpenFile(node.path, isShortcutRow(node) ? undefined : copyOf(node))
                  if (node.path === activeFile && e.detail === 0) focusOpenDocument() // YAZ-961: the VISIBLE one
                }
              }}
              // The second click of a double click KEEPS the tab the first one previewed (YAZ-2648 D2).
              // A row with no viewer in the app has no tab, and ⌘ opened a kept tab already.
              onDoubleClick={(e) => {
                if (!e.shiftKey && !e.metaKey && node.kind !== null) onKeepFile(node.path, isShortcutRow(node) ? undefined : copyOf(node))
              }}
              onContextMenu={(e) => onNodeContextMenu(isShortcutRow(node) ? { type: 'file', path: node.path, shortcutIn: dirPath, top: topOf(node) } : { ...node, top: topOf(node) }, e)}
              title={node.path}
              data-path={node.path}
              {...hoverOf(node.path)}
              // A shortcut row never drags (YAZ-2290 D2): the drag would move the note out of the folder it lives in.
              draggable={!noDrag(node)}
              onDragStart={noDrag(node) ? undefined : (e) => {
                if (e.dataTransfer) {
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', node.path)
                }
                fileDrag.start(node.path)
              }}
              onDragEnd={fileDrag.end}
              onDragOver={rowReorder === null ? undefined : (e) => {
                if (rowReorder.dragging === null) return
                e.preventDefault()
                rowReorder.hover(node.path, edgeOf(e))
              }}
              onDrop={rowReorder === null ? undefined : (e) => {
                e.preventDefault()
                rowReorder.drop()
              }}
            >
              <span className="tree__label">
                {idFor(node.path)}
                {marked(pageLabel(node.path, false, titles), needleFor(node.path))}
              </span>
              {node.kind === 'diagram' && <DiagramBadge />}
              {tooLarge?.has(node.path) === true && <CloudOffIcon label={TOO_LARGE_LABEL} />}
              <ShareMark badge={shareBadges?.get(node.path)} />
              {isShortcutRow(node) && <ShortcutIcon />}
              {vaultTag(node.path)}
            </button>
          </li>
        ),
      )}
    </ul>
  )
}

/** `path` sits somewhere below `dir`. */
const below = (path: string | null, dir: string): boolean => path !== null && path.startsWith(`${dir}/`)

/** Whether a path in one set but not the other is one `drawn` says the level draws. */
function changedBelow(a: ReadonlySet<string>, b: ReadonlySet<string>, drawn: (path: string) => boolean): boolean {
  if (a === b) return false
  for (const path of a) if (!b.has(path) && drawn(path)) return true
  for (const path of b) if (!a.has(path) && drawn(path)) return true
  return false
}

/**
 * A level re-renders only when something BELOW its own directory changed (YAZ-2194): every row it
 * draws, and every level it nests, sits below `dirPath` — or is a SHORTCUT row of a folder at or
 * below it (YAZ-2290 D2), the one row whose path lies elsewhere. So a folder toggle re-renders that
 * folder's ancestor levels, a tab switch the levels holding the old and the new active file, and a
 * resize or a save none at all. Every other prop is compared by identity, as `memo` does.
 */
function sameLevel(prev: TreeProps, next: TreeProps): boolean {
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)] as (keyof TreeProps)[])
  for (const key of keys) {
    if (key === 'expanded' || key === 'activeFile' || key === 'activeTop' || key === 'selection') continue
    if (!Object.is(prev[key], next[key])) return false
  }
  const dir = next.dirPath
  /** The shortcut rows this level and the levels it nests draw; walked once per compare, and only if asked. */
  let elsewhere: Set<string> | undefined
  const drawn = (path: string | null): boolean => {
    if (path === null || below(path, dir)) return path !== null
    elsewhere ??= new Set([...next.shortcuts].flatMap(([folder, rows]) => (folder === dir || below(folder, dir) ? rows.map((row) => row.path) : [])))
    return elsewhere.has(path)
  }
  if (prev.activeFile !== next.activeFile && (drawn(prev.activeFile) || drawn(next.activeFile))) return false
  // The copy that lights (YAZ-3131) moves only the levels that draw what it lights.
  if (prev.activeTop !== next.activeTop && drawn(next.activeFile)) return false
  if (prev.selection.toggle !== next.selection.toggle || prev.selection.set !== next.selection.set) return false
  if (prev.selection.copies !== next.selection.copies && [...next.selection.paths].some(drawn)) return false
  // A copy's fold key (YAZ-3131) is drawn where its PATH half is.
  return !changedBelow(prev.expanded, next.expanded, (key) => below(copyFoldParts(key)?.[1] ?? key, dir)) && !changedBelow(prev.selection.paths, next.selection.paths, drawn)
}

export const Tree = memo(TreeLevel, sameLevel)
