import { memo, type CSSProperties } from 'react'
import type { TabSort, TreeNode } from '@shared/types'
import { pageLabel, type PathTitles } from '../lib/pageLabel'
import { CreateInline } from './CreateInline'
import type { EntryKind, MenuRow } from './createEntry'
import { focusOpenDocument } from '../lib/focusHandoff'
import { isBoard, isMarkdown } from '@shared/fileKind'
import { copyFoldKey, copyFoldParts } from '@shared/foldKey'
import { CloudOffIcon, LinkIcon, ShortcutIcon } from '../views/view/icons'
import { TOO_LARGE_LABEL } from '../lib/syncAttention'
import { RenameInline } from './RenameInline'
import { iconVars } from './materialIcons'
import { iconsChangedBelow, rowIcon, type RowIcons } from './rowIcons'
import { sortLevel, timeOf } from './treeSort'
import { shortRelativeTime } from '../lib/relativeTime'
import { formatDateTime } from '../lib/format'

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
 * Drag a row onto a FOLDER to move it there (E1b, GRO-2241): a file, a folder, or the selection
 * (YAZ-3251 D5). Since YAZ-3254 D4 it is the OS drag: the row stops the page's own drag at
 * `dragstart`, and LIFT_PX from the press (YAZ-3467 D1) main starts one that Finder can take; a drop back in the window comes as files
 * (`dataTransfer` is guarded — jsdom's synthetic drags have none, and drop through `drop`). No
 * `dragend` comes back. The drag lives in refs, not React state (D2): this object keeps ONE identity for the
 * Sidebar's life, so `sameLevel` sees no change and a hover renders no level; the lit target wears
 * its class by DOM. A file row takes the drop for its folder (D7), and a closed folder held under a
 * drag opens (D8).
 */
export interface TreeFileMove {
  /** A drop into `dir` would land: false for a dragged folder and for every folder inside it (S6). `files`: the drag comes from the OS (YAZ-3253), which lands in any folder when no row drag is in flight. */
  accepts: (dir: string, files?: boolean) => boolean
  /** A row drag to move begins (D5): the ONE place. It arms the row, which lifts into the OS drag (YAZ-3254 D4) LIFT_PX from the press (YAZ-3467 D1). `top`: the copy the row stands in (YAZ-3131). */
  start: (path: string, top?: string) => void
  end: () => void
  /** The drag is over `dir`, whose row `el` lights (null: none does). `open` arms the spring of a closed folder (D8). */
  hover: (dir: string | null, el: HTMLElement | null, open?: () => void) => void
  /** The pointer left a target for `dir`: its light goes, if it is the lit one. */
  leave: (dir: string) => void
  drop: (dir: string) => void
  /** Files dropped into `dir` (YAZ-3253 D3): Finder's, a second window's, or this window's own OS drag back (YAZ-3254 D4). */
  dropFiles: (dir: string, files: readonly File[]) => void
}

/** The drag comes from the OS — Finder, or a row's own OS drag (YAZ-3253, YAZ-3254 D4): its `types` hold `Files`. */
export const hasFiles = (e: React.DragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes('Files')

/** A drop on a target for `dir`: files go to `dropFiles`, anything else is the page's own row drag (jsdom's synthetic drags have no `dataTransfer`). */
export const dropOn = (move: TreeFileMove, e: React.DragEvent, dir: string): void => (hasFiles(e) ? move.dropFiles(dir, Array.from(e.dataTransfer.files)) : move.drop(dir))

/**
 * The pointer left a drop target (YAZ-3251 D2): a move into the target's own label or icon is no
 * leave, so the light and a closed folder's spring (D8) hold. With no `relatedTarget` it is a leave.
 */
export const leftTarget = (e: React.DragEvent): boolean => !(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))

/** The row that lights for a drop on a file row (YAZ-3251 D7): its folder's row, or at the top of a one-vault window the root header. */
function folderRowOf(row: HTMLElement): HTMLElement | null {
  const folder = row.closest('ul.tree')?.parentElement?.querySelector<HTMLElement>(':scope > .tree__row--dir')
  return folder ?? row.closest('.sidebar')?.querySelector<HTMLElement>('.sidebar__header') ?? null
}

/**
 * Drag a TOP row to reorder (YAZ-1766 D4; one rule for every tab, YAZ-2631 D3): a separate mechanism
 * from `TreeFileMove` — it rewrites the tab's LIST and never touches disk. On the top rows only, a file
 * or a folder: a deeper row, file or folder, still moves on disk (YAZ-3251 D5). Since YAZ-3467 D2 it is
 * mouse events, owned by the hook: a top row marks itself `data-reorder`, and the Tree draws the line.
 */
/** The hovered top row of a reorder and the edge of it the drop lands on (YAZ-2631 D3). */
export type ReorderOver = { path: string; edge: 'before' | 'after' }

export interface TreeReorder {
  /** The hovered top row and which edge of it the drop lands on; null when no line shows. */
  over: ReorderOver | null
  /** A row's `dragstart` arms the reorder: it lifts LIFT_PX from the press, as a move does. */
  start: (path: string) => void
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

/**
 * The arrows on a row of Files, Focus or Favorites (YAZ-2662 D11; VS Code's moves since YAZ-3440 D12):
 * - ↓ and ↑ move the keyboard focus to the next row on show and to the row before, and stop at both ends.
 * - Home and End move it to the first and to the last row on show (D12).
 * - → opens a closed folder row, and ← closes an open one.
 * - ← on a file row or a closed folder row moves it to the row of the folder that holds it (D12). In Focus
 *   and Favorites that is the folder inside the same copy (YAZ-3131): the parent is read from the rows as
 *   drawn. A top row has no folder above it, so nothing happens.
 * - → on an open folder row moves it to the folder's first row (D12, which changes YAZ-2663 D8 for an
 *   open folder only). An empty folder has no first row, so nothing happens.
 * - → on a file row goes to the new tab page (YAZ-2663 D8).
 * They read the rows as drawn, select nothing and open no page. A rename box or a create box is no
 * row, so its arrows stay its own (S64). The browser's `.focus()` scrolls the row into view, and
 * `scroll-margin-top` (app.css) keeps it below the stuck rows (YAZ-3440 D1).
 */
function rowArrows(e: React.KeyboardEvent<HTMLElement>, onToggle: (dir: string) => void, onLeaveToPage?: () => boolean): void {
  const row = e.target instanceof HTMLElement && e.target.matches('.tree__row') ? e.target : null
  const path = row?.dataset.path
  if (row === null || path === undefined) return
  const plain = !(e.metaKey || e.ctrlKey || e.altKey || e.shiftKey)
  const rows = () => [...e.currentTarget.querySelectorAll<HTMLElement>('.tree__row[data-path]')]
  // A folder's item says whether it is open; a file's says nothing (null).
  const item = row.closest('[role="treeitem"]')
  const open = item?.getAttribute('aria-expanded') ?? null
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const all = rows()
    all[all.indexOf(row) + (e.key === 'ArrowDown' ? 1 : -1)]?.focus()
  } else if ((e.key === 'Home' || e.key === 'End') && plain) {
    const all = rows()
    all[e.key === 'Home' ? 0 : all.length - 1]?.focus()
  } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    // A folder row of a copy (YAZ-3131) folds under its own key, which the row carries in `data-fold`.
    if (open === String(e.key === 'ArrowLeft')) onToggle(row.dataset.fold ?? path)
    // ← with nothing to close (D12): the row of the folder this row is drawn in — its item's level is a
    // group, and that group's item is the folder's. The tree's own level is no group: a top row stops here.
    else if (e.key === 'ArrowLeft') {
      if (plain) item?.parentElement?.closest('[role="treeitem"]')?.querySelector<HTMLElement>(':scope > .tree__row[data-path]')?.focus()
    }
    // → on an open folder (D12): its first row, if it holds one.
    else if (open === 'true') {
      if (plain) item?.querySelector<HTMLElement>(':scope > [role="group"] .tree__row[data-path]')?.focus()
    }
    // → on a file row goes to the new tab page, when it shows and has a row (YAZ-2663 D8). With no such
    // page the key does nothing, as before (S62).
    else if (plain) onLeaveToPage?.()
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
   * has opened it in the preview tab, and this keeps it. A folder row has no double click (YAZ-3377 D1).
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
  /** Drag-to-move (E1b; folders and the selection, YAZ-3251); owned by the Sidebar, one identity for its life. */
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
  /** The tab's sort (YAZ-3227); the Search tab's own since YAZ-3511 (`searchSort`). */
  sort?: TabSort
  /** Search only (YAZ-3511 D6): each row but a vault row shows its Last updated at the right end. */
  dates?: boolean
  /** The top rows keep the order they came in, whatever the sort (YAZ-3511): the search's pinned items, focus before favorites (YAZ-2662 D3). The top level's alone. */
  keepTop?: boolean
  /**
   * Search only (🔒 D5, YAZ-2620): the matched rows and the typed text, lowercased. A row in `hits`
   * shows that text marked in its label; a row outside it — a parent of a match, or a row inside a
   * matched folder — is drawn dim. Without it a tree draws, and re-renders, exactly as before.
   */
  marks?: TreeMarks
  /** The way to the new tab page from a row of Files, Focus or Favorites (YAZ-2663 D8): → on a file row asks it. An open folder's → goes to its first row since YAZ-3440 D12. The top level's alone. */
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
  /**
   * The user's own icons (YAZ-3440 D8, D9): a row's pick in its vault's `.yaseendocs/icons.json`, else the first
   * matching name rule of the settings (`sidebarIconRules`), before Material's match. Absent: Material's match alone. `sameLevel` re-renders a level for a new pick
   * only where it draws that row; a change of rules re-renders every level.
   */
  icons?: RowIcons
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
  dates,
  keepTop,
  marks,
  onLeaveToPage,
  top,
  onHoverFile,
  tooLarge,
  shareBadges,
  icons,
  depth = 0,
}: TreeProps) {
  const recurse = { vaultRows, expanded, copies, activeFile, activeTop, onToggle, onOpenFile, onKeepFile, onOpenFileBackground, onOpenDefault, onNodeContextMenu, pending, renaming, move, selection, shortcuts, titles, marks, onHoverFile, tooLarge, shareBadges, icons, sort, dates }
  /** A board or note row's hover handlers (YAZ-3028 D11, YAZ-3075 D4): pointer and focus alike, so the keyboard walk previews too. */
  const hoverOf = (path: string) =>
    onHoverFile === undefined || !(isBoard(path) || isMarkdown(path)) ? {} : {
          // A pointer that comes in with a button down is in a press or a reorder, not a hover (YAZ-3467, audit 4).
          onMouseEnter: (e: React.MouseEvent) => {
            if (e.buttons === 0) onHoverFile({ path })
          },
          onMouseLeave: () => onHoverFile(null), onFocus: () => onHoverFile({ path }), onBlur: () => onHoverFile(null) }
  // This folder's shortcuts stand among its FILES (YAZ-2290), and the tab's sort orders the level (YAZ-3227 D7).
  // The top rows of a Manual list, the vault rows and the search's pinned items keep their own order; with no sort a level stands as it came.
  const here = shortcuts.get(dirPath)
  const keep = sort === undefined ? here === undefined : depth === 0 && (keepTop === true || (copies ? sort.by === 'manual' : vaultRows.size > 0))
  const rows = keep ? nodes : sortLevel(here === undefined ? nodes : [...nodes, ...here], sort, (node) => pageLabel(node.path, node.type === 'dir', titles))
  const isShortcutRow = (node: TreeNode): boolean => here?.includes(node) === true
  // The top row a row stands under (YAZ-2845 D1): a top row is its own. It tells the copies of a row
  // that shows twice apart, and a right-click hands it to the menu, so an input mounts in that copy alone.
  const topOf = (node: TreeNode): string => top ?? node.path
  const inCopy = (want: string | null, node: TreeNode): boolean => want === null || want === topOf(node)
  /** A folder row that is the inline rename input now (E1b, GRO-2241). */
  const renamesHere = (node: TreeNode): boolean => renaming !== null && renaming.path === node.path && inCopy(renaming.top, node)
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
  // What a row's drag does: reorder on a top row of a tree that reorders, else move on disk (E1b; a folder too, YAZ-3251 D5).
  const rowDrag: Pick<TreeFileMove, 'start'> = rowReorder ?? move
  // A top row of a SORTED Focus or Favorites list does not drag at all (YAZ-3227 D6): its drag would reorder, and
  // the order is the sort's — it must not turn into a move on disk. A shortcut row never drags (YAZ-2290 D2), and
  // a vault row moves nothing on disk (YAZ-3251 S8): it drags only where its tree reorders.
  const noDrag = (node: TreeNode): boolean => isShortcutRow(node) || (copies && depth === 0 && rowReorder === null) || (vaultRows.has(node.path) && rowReorder === null)
  /**
   * A row drag begins: the move or the reorder takes it (YAZ-3251 D5). The page's own drag stops
   * here for both, and `start` arms the row: it lifts LIFT_PX from the press (YAZ-3467 D1, D2). A
   * move lifts into the OS drag (YAZ-3254 D4), which Finder can take. A reorder lifts into mouse
   * events (S15): it never leaves the window.
   */
  const dragStart = (node: TreeNode) => (e: React.DragEvent) => {
    e.preventDefault()
    rowDrag.start(node.path, copyOf(node))
  }
  /**
   * A file row takes the drop for its folder (YAZ-3251 D7) — the folder it is drawn in, so a
   * shortcut row's is the folder it stands in. A top row of Focus or Favorites stands in no folder
   * on show, and above the vault rows no folder stands: those take none.
   */
  const fileDrop = dirPath !== '' && !(copies && depth === 0)
  const dropEdge = (path: string) => (rowReorder?.over?.path === path ? ` tree__row--drop-${rowReorder.over.edge}` : '')
  // In a search tree (🔒 D5, YAZ-2620) a row the query did not match only gives a match its place.
  const context = (path: string) => (marks !== undefined && !marks.hits.has(path) ? ' tree__row--context' : '')
  const needleFor = (path: string) => (marks?.hits.has(path) ? marks.needle : undefined)
  /**
   * A row's icon (YAZ-3440 D4, D5, D8, D9): the row's pick or a name rule, else Material's match by name; a folder's open
   * twin while it is open. Set during render, as `data-icon` (`data-icon-custom` for the vault's own) and the
   * inline `--icon` app.css draws, so a row has no node more and a fold restyles only the level that renders for
   * it anyway. A vault row has none. One resolve per row: the attributes and the row's style (its indent) together.
   */
  const iconProps = (node: TreeNode, paddingLeft: number): { style: CSSProperties; 'data-icon'?: string; 'data-icon-custom'?: '' } => {
    if (node.type === 'dir' && vaultRows.has(node.path)) return { style: { paddingLeft } }
    const { id, custom } = rowIcon(icons, node.path, node.name, node.type === 'dir' ? 'folder' : 'file', node.type === 'dir' && expanded.has(foldOf(node)))
    return { style: { paddingLeft, ...(iconVars(id) as CSSProperties) }, 'data-icon': id, ...(custom ? { 'data-icon-custom': '' as const } : {}) }
  }
  /** `YAZ-12 — ` in front of the row of an ID match (YAZ-2677 S70); nothing for any other row. */
  const idFor = (path: string) => (marks?.ids?.has(path) ? `${marks.ids.get(path)} — ` : null)
  return (
    // The arrows, Home and End are the whole tree's, taken once at its top (YAZ-2662 D11, YAZ-3440 D12) — not a search tree's, whose keys are the search bar's.
    // A held Enter is stopped there too, in each tree.
    // A nested level carries its depth (YAZ-3309): app.css draws its level line below the chevron of the folder that holds it.
    <ul className="tree" role={depth === 0 ? 'tree' : 'group'} style={depth > 0 ? ({ '--tree-depth': depth } as CSSProperties) : undefined} onKeyDownCapture={depth === 0 ? heldEnter : undefined} onKeyDown={depth === 0 && marks === undefined ? (e) => rowArrows(e, onToggle, onLeaveToPage) : undefined}>
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
          // `data-renaming`: the row is the input, so app.css draws no coloured chevron on it (YAZ-3309 D7, bug YAZ-3342).
          <li key={node.path} role="treeitem" aria-expanded={expanded.has(foldOf(node))} aria-selected={isActive(node) || isSelected(node)} data-renaming={renamesHere(node) ? '' : undefined}>
            {renaming !== null && renaming.path === node.path && inCopy(renaming.top, node) ? (
              // Inline FOLDER rename (E1b, GRO-2241): same idiom as files, and what it edits is
              // the folder's TITLE (YAZ-2420 🔒 D16).
              <RenameInline initial={pageLabel(node.path, true, titles)} title={renaming.title} indent={8 + depth * 14} onSubmit={renaming.onSubmit} onCancel={renaming.onCancel} />
            ) : (
              <button
                type="button"
                // The folder itself is a tab (YAZ-2290 D3), so its row is the active one while that tab is.
                // Every folder row sticks at the top while its folder's rows scroll under it (YAZ-3440 D1): CSS alone,
                // which also stops it below the level cap (D2, `stickyFolders.ts`). `data-kind` (the Line set) and
                // `data-icon` (Material) draw its folder icon (D5) on the label, so the row has no node more; a vault row has none.
                className={`tree__row tree__row--dir tree__row--sticky${vaultRows.has(node.path) ? ' tree__row--vault' : ''}${isActive(node) ? ' tree__row--active' : ''}${isSelected(node) ? ' tree__row--selected' : ''}${dropEdge(node.path)}${context(node.path)}`}
                // Read by `flashTreeRows` (a Files reveal of a FOLDER, YAZ-1491) and by
                // `orderedSelection`, which puts a selected folder in on-screen order (YAZ-1578).
                data-path={node.path}
                data-fold={foldOf(node)}
                data-kind={vaultRows.has(node.path) ? undefined : 'folder'}
                {...iconProps(node, 8 + depth * 14)}
                // Shift is the SELECTION gesture everywhere (YAZ-1340) and a folder joins the
                // selection like a file (YAZ-1578, 🔒 D1) — so shift toggles and never folds. A
                // PLAIN click SELECTS the folder (D9, YAZ-1674 — the Finder rule) and then folds,
                // so ⌘C / ⌘V have a target the moment a folder is clicked.
                // Two fast clicks only fold and unfold: a double click opens nothing (YAZ-3377 D1,
                // overturning YAZ-2290 D3). The menu's "Open folder page" and Enter open the folder.
                // A click on a STUCK row (YAZ-3440 D3) goes back to the folder, as in VS Code: its li scrolls to the top and
                // nothing folds. Stuck = the row stands below its li's top (jsdom has no boxes: never stuck). Its arrow, and
                // Space (a click with `detail === 0`), still fold; then the li scrolls in, so a closed folder does not
                // vanish above the list. `scroll-margin-top` (app.css) lands it under the rows stuck above it.
                onClick={(e) => {
                  if (e.shiftKey) {
                    selection.toggle(node.path, copyOf(node))
                    return
                  }
                  selection.set(node.path, copyOf(node))
                  const item = e.currentTarget.closest('[role="treeitem"]')
                  const stuck = item !== null && item.getBoundingClientRect().top < e.currentTarget.getBoundingClientRect().top - 1
                  if (stuck && e.detail !== 0 && !(e.target instanceof Element && e.target.closest('.tree__chevron') !== null)) {
                    item?.scrollIntoView?.({ block: 'start' })
                    return
                  }
                  onToggle(foldOf(node))
                  if (stuck) requestAnimationFrame(() => item?.scrollIntoView?.({ block: 'start' }))
                }}
                // Enter opens the folder, as it opens a file row — there through the button's own click,
                // which on this row folds. So the key is taken here and Space is left to fold. A vault
                // row is no page (YAZ-2602 D3): Enter folds it.
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' || e.shiftKey || vaultRows.has(node.path)) return
                  e.preventDefault()
                  selection.set(node.path, copyOf(node))
                  onOpenFile(node.path, copyOf(node))
                }}
                onContextMenu={(e) => onNodeContextMenu({ ...node, top: topOf(node) }, e)}
                draggable={!noDrag(node)}
                onDragStart={noDrag(node) ? undefined : dragStart(node)}
                data-reorder={rowReorder === null ? undefined : ''}
                onDragOver={(e) => {
                  if (!move.accepts(node.path, hasFiles(e))) return
                  e.preventDefault() // a dir row is a valid drop target while a row drag, or a drag from Finder, is in flight
                  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
                  // A closed folder held under the drag opens (D8), under its own fold key. The spring only opens:
                  // it reads the row as it is when it fires, so a folder that opened another way meanwhile stays open.
                  const item = e.currentTarget.closest('[role="treeitem"]')
                  move.hover(node.path, e.currentTarget, expanded.has(foldOf(node)) ? undefined : () => {
                    if (item?.isConnected === true && item.getAttribute('aria-expanded') === 'false') onToggle(foldOf(node))
                  })
                }}
                onDragLeave={(e) => {
                  if (leftTarget(e)) move.leave(node.path)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  dropOn(move, e, node.path)
                }}
              >
                <span className={`tree__chevron${expanded.has(foldOf(node)) ? ' tree__chevron--open' : ''}`} />
                <span className="tree__label">
                  {idFor(node.path)}
                  {vaultRows.has(node.path) ? node.name : marked(pageLabel(node.path, true, titles), needleFor(node.path))}
                </span>
                {vaultTag(node.path)}
                {dates === true && !vaultRows.has(node.path) && <RowDate node={node} />}
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
              // The file's icon before the name (YAZ-3440 D4), which took the place of the diagram's mark after it: its
              // kind for the Line set (a file with no viewer in the app is `other`), its Material icon by name (`data-icon`
              // and the inline `--icon`). app.css draws the one the icon set asks for on the label: no node more.
              data-kind={node.kind ?? 'other'}
              {...iconProps(node, 8 + depth * 14 + 14)}
              {...hoverOf(node.path)}
              // A shortcut row never drags (YAZ-2290 D2): the drag would move the note out of the folder it lives in.
              draggable={!noDrag(node)}
              onDragStart={noDrag(node) ? undefined : dragStart(node)}
              data-reorder={rowReorder === null ? undefined : ''}
              onDragOver={(e) => {
                if (!fileDrop || !move.accepts(dirPath, hasFiles(e))) return
                e.preventDefault()
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
                move.hover(dirPath, folderRowOf(e.currentTarget))
              }}
              onDragLeave={fileDrop ? (e) => {
                if (leftTarget(e)) move.leave(dirPath)
              } : undefined}
              onDrop={(e) => {
                if (!fileDrop) return
                e.preventDefault()
                dropOn(move, e, dirPath)
              }}
            >
              <span className="tree__label">
                {idFor(node.path)}
                {marked(pageLabel(node.path, false, titles), needleFor(node.path))}
              </span>
              {tooLarge?.has(node.path) === true && <CloudOffIcon label={TOO_LARGE_LABEL} />}
              <ShareMark badge={shareBadges?.get(node.path)} />
              {isShortcutRow(node) && <ShortcutIcon />}
              {vaultTag(node.path)}
              {dates === true && <RowDate node={node} />}
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
    if (key === 'expanded' || key === 'activeFile' || key === 'activeTop' || key === 'selection' || key === 'icons') continue
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
  // A vault's own icons (YAZ-3440 D8, D9): a pick re-renders the levels that draw its row, a rule change every level.
  if (iconsChangedBelow(prev.icons, next.icons, drawn)) return false
  // A copy's fold key (YAZ-3131) is drawn where its PATH half is.
  return !changedBelow(prev.expanded, next.expanded, (key) => below(copyFoldParts(key)?.[1] ?? key, dir)) && !changedBelow(prev.selection.paths, next.selection.paths, drawn)
}

export const Tree = memo(TreeLevel, sameLevel)

/** A row's Last updated (YAZ-3511 D5): "3h", "2d", "5mo", the full date and time on hover. A folder's is its newest row in this tree (D6); an empty one shows none. */
function RowDate({ node }: { node: TreeNode }) {
  const time = timeOf(node)
  return time > 0 ? <span className="tree__date" title={formatDateTime(time)}>{shortRelativeTime(time, Date.now())}</span> : null
}
