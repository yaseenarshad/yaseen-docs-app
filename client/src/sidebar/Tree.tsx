import { memo } from 'react'
import type { TreeNode } from '@shared/types'
import { pageLabel, type PathTitles } from '../lib/pageLabel'
import { CreateInline } from './CreateInline'
import type { EntryKind, MenuRow } from './createEntry'
import { focusOpenDocument } from '../lib/focusHandoff'
import { ShortcutIcon } from '../views/view/icons'
import { RenameInline } from './RenameInline'

/** Inline "New note" / "New folder" input pending inside the tree (GRO-2022). */
export interface PendingCreate {
  kind: EntryKind
  seed: string
  /** Absolute path of the directory the entry is created in. */
  parentDir: string
  onSubmit: (name: string) => Promise<void>
  onCancel: () => void
}

/** Inline rename replacing one row's label (files E1, GRO-2194; folders E1b, GRO-2241). */
export interface PendingRename {
  /** Absolute path of the row (file or dir) being renamed. */
  path: string
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

/** A level's order as main sorts it (`fs/fsUtils.ts`): by name, case-insensitively. */
const byName = (a: TreeNode, b: TreeNode): number => a.name.toLowerCase().localeCompare(b.name.toLowerCase())

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
 * Sidebar multi-select (YAZ-1336, 🔒 D1) as both trees take it: the selected PATHS plus the two
 * gestures that change them. The Sidebar owns the reducer behind it; keying by path is 🔒 D3, so
 * a favorite standing at the root AND inside its favorited parent shows selected on BOTH of its
 * rows. A path is a file or a FOLDER (YAZ-1578): a selected folder is the folder itself, never its
 * contents.
 */
export interface TreeSelection {
  paths: ReadonlySet<string>
  /** 🔒 D2: shift+click on a file or folder row toggles it in or out — no range, never an open, never a fold. */
  toggle: (path: string) => void
  /** D9 (YAZ-1674): a plain click or ⌘-click makes the selection EXACTLY this row — then opens or folds as before. */
  set: (path: string) => void
}

/** What a search tree marks (🔒 D5, YAZ-2620): the paths the query matched, and the query as the matcher reads it — trimmed, lowercased. */
export interface TreeMarks {
  hits: ReadonlySet<string>
  needle: string
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
  activeFile: string | null
  onToggle: (dir: string) => void
  onOpenFile: (path: string) => void
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
  /** What each row is labelled with (YAZ-2420 🔒 D15): its title; a row the index does not hold shows its file name. The ORDER stays by file name. */
  titles: PathTitles
  /** A tab whose top rows reorder (YAZ-2631 D3): they drag along the list instead of moving on disk. Without it no row reorders. The top level alone gets it, so a drag's line draws no level below again. */
  reorder?: TreeReorder
  /**
   * Search only (🔒 D5, YAZ-2620): the matched rows and the typed text, lowercased. A row in `hits`
   * shows that text marked in its label; a row outside it — a parent of a match, or a row inside a
   * matched folder — is drawn dim. Without it a tree draws, and re-renders, exactly as before.
   */
  marks?: TreeMarks
  depth?: number
}

function TreeLevel({
  nodes,
  dirPath,
  vaultRows,
  expanded,
  activeFile,
  onToggle,
  onOpenFile,
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
  marks,
  depth = 0,
}: TreeProps) {
  const recurse = { vaultRows, expanded, activeFile, onToggle, onOpenFile, onOpenFileBackground, onOpenDefault, onNodeContextMenu, pending, renaming, move, selection, shortcuts, titles, marks }
  // This folder's shortcuts stand among its FILES in the tree's own name order; dirs still lead, as main sorts a level.
  const here = shortcuts.get(dirPath)
  const rows = here === undefined ? nodes : [...nodes.filter((n) => n.type === 'dir'), ...[...nodes.filter((n) => n.type === 'file'), ...here].sort(byName)]
  const isShortcutRow = (node: TreeNode): boolean => here?.includes(node) === true
  // The reorder gesture lives on the TOP rows alone (YAZ-2631 D3): a favorite, a focus item, a vault row of Files.
  const rowReorder = reorder !== undefined && depth === 0 ? reorder : null
  /** The vault a top row of the Focus tab or of the Favorites tab is in, file or folder (YAZ-2631 D4): said only where the window has two or more. A vault row is in no vault's folder, so it says none — and Files has no other top row. */
  const vaultTag = (path: string) => {
    const name = depth > 0 ? undefined : [...vaultRows].find(([row]) => path.startsWith(`${row}/`))?.[1]
    return name !== undefined && <span className="tree__vault">{name}</span>
  }
  // What a FILE row's drag does: reorder on a top row of a tree that reorders, else move on disk (E1b).
  const fileDrag: Pick<TreeFileMove, 'start' | 'end'> = rowReorder ?? move
  const dropEdge = (path: string) => (rowReorder?.over?.path === path ? ` tree__row--drop-${rowReorder.over.edge}` : '')
  // In a search tree (🔒 D5, YAZ-2620) a row the query did not match only gives a match its place.
  const context = (path: string) => (marks !== undefined && !marks.hits.has(path) ? ' tree__row--context' : '')
  const needleFor = (path: string) => (marks?.hits.has(path) ? marks.needle : undefined)
  return (
    <ul className="tree" role={depth === 0 ? 'tree' : 'group'}>
      {pending !== null && pending.parentDir === dirPath && (
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
          <li key={node.path} role="treeitem" aria-expanded={expanded.has(node.path)} aria-selected={node.path === activeFile || selection.paths.has(node.path)}>
            {renaming !== null && renaming.path === node.path ? (
              // Inline FOLDER rename (E1b, GRO-2241): same idiom as files, and what it edits is
              // the folder's TITLE (YAZ-2420 🔒 D16).
              <RenameInline initial={pageLabel(node.path, true, titles)} title={renaming.title} indent={8 + depth * 14} onSubmit={renaming.onSubmit} onCancel={renaming.onCancel} />
            ) : (
              <button
                type="button"
                // The folder itself is a tab (YAZ-2290 D3), so its row is the active one while that tab is.
                className={`tree__row tree__row--dir${vaultRows.has(node.path) ? ' tree__row--vault' : ''}${node.path === activeFile ? ' tree__row--active' : ''}${selection.paths.has(node.path) ? ' tree__row--selected' : ''}${move.dropDir === node.path ? ' tree__row--drop' : ''}${dropEdge(node.path)}${context(node.path)}`}
                style={{ paddingLeft: 8 + depth * 14 }}
                // Read by `flashTreeRows` (a Files reveal of a FOLDER, YAZ-1491) and by
                // `orderedSelection`, which puts a selected folder in on-screen order (YAZ-1578).
                data-path={node.path}
                // Shift is the SELECTION gesture everywhere (YAZ-1340) and a folder joins the
                // selection like a file (YAZ-1578, 🔒 D1) — so shift toggles and never folds. A
                // PLAIN click SELECTS the folder (D9, YAZ-1674 — the Finder rule) and then folds,
                // so ⌘C / ⌘V have a target the moment a folder is clicked.
                onClick={(e) => {
                  if (e.shiftKey) {
                    selection.toggle(node.path)
                    return
                  }
                  selection.set(node.path)
                  onToggle(node.path)
                }}
                // The folder itself is the tab (YAZ-2290 D3, overturning YAZ-1578 D3): a double
                // click opens it. Its two clicks have selected and folded as ever; shift never opens.
                // A vault row is no page (YAZ-2602 D3): neither gesture opens one, and Enter folds it.
                onDoubleClick={(e) => {
                  if (!e.shiftKey && !vaultRows.has(node.path)) onOpenFile(node.path)
                }}
                // Enter opens it too, as it opens a file row — there through the button's own click,
                // which on this row folds. So the key is taken here and Space is left to fold.
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' || e.shiftKey || vaultRows.has(node.path)) return
                  e.preventDefault()
                  selection.set(node.path)
                  onOpenFile(node.path)
                }}
                onContextMenu={(e) => onNodeContextMenu(node, e)}
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
                <span className={`tree__chevron${expanded.has(node.path) ? ' tree__chevron--open' : ''}`} />
                <span className="tree__label">{vaultRows.has(node.path) ? node.name : marked(pageLabel(node.path, true, titles), needleFor(node.path))}</span>
                {vaultTag(node.path)}
              </button>
            )}
            {expanded.has(node.path) && <Tree nodes={node.children} dirPath={node.path} depth={depth + 1} {...recurse} />}
          </li>
        ) : renaming !== null && renaming.path === node.path && !isShortcutRow(node) ? (
          // Inline rename (Links E1, GRO-2194): a note's box edits its TITLE (YAZ-2420 🔒 D16);
          // view-only files show the full filename so their extension stays explicit.
          // The REAL row only: a second input on the note's shortcut row would take the focus,
          // and the first one's blur is its commit (YAZ-1553).
          <li key={node.path} role="treeitem">
            <RenameInline initial={pageLabel(node.path, false, titles)} title={renaming.title && node.kind === 'markdown'} indent={8 + depth * 14 + 14} onSubmit={renaming.onSubmit} onCancel={renaming.onCancel} />
          </li>
        ) : (
          <li key={node.path} role="treeitem" aria-selected={node.path === activeFile || selection.paths.has(node.path)}>
            <button
              type="button"
              className={`tree__row tree__row--file${node.kind === null ? ' tree__row--external' : ''}${node.path === activeFile ? ' tree__row--active' : ''}${selection.paths.has(node.path) ? ' tree__row--selected' : ''}${dropEdge(node.path)}${context(node.path)}`}
              style={{ paddingLeft: 8 + depth * 14 + 14 }}
              onClick={(e) => {
                // Shift is the SELECTION gesture and nothing else (YAZ-1336, 🔒 D2): it never
                // opens, never previews — so it is asked first, before any of the open rules.
                if (e.shiftKey) {
                  if (!isShortcutRow(node)) selection.toggle(node.path)
                  return
                }
                // Every other click makes the selection THIS row (D9, YAZ-1674) — plain and ⌘
                // alike, the external row too — before the open rules decide where it opens.
                if (!isShortcutRow(node)) selection.set(node.path)
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
                if (e.metaKey) onOpenFileBackground(node.path)
                else if (node.path !== activeFile) onOpenFile(node.path)
                else if (e.detail === 0) focusOpenDocument() // YAZ-961: the VISIBLE one
              }}
              onContextMenu={(e) => onNodeContextMenu(isShortcutRow(node) ? { type: 'file', path: node.path, shortcutIn: dirPath } : node, e)}
              title={node.path}
              data-path={node.path}
              // A shortcut row never drags (YAZ-2290 D2): the drag would move the note out of the folder it lives in.
              draggable={!isShortcutRow(node)}
              onDragStart={isShortcutRow(node) ? undefined : (e) => {
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
              <span className="tree__label">{marked(pageLabel(node.path, false, titles), needleFor(node.path))}</span>
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
    if (key === 'expanded' || key === 'activeFile' || key === 'selection') continue
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
  if (prev.selection.toggle !== next.selection.toggle || prev.selection.set !== next.selection.set) return false
  return !changedBelow(prev.expanded, next.expanded, (path) => below(path, dir)) && !changedBelow(prev.selection.paths, next.selection.paths, drawn)
}

export const Tree = memo(TreeLevel, sameLevel)
