import type { TreeNode } from '@shared/types'
import { stripExt } from '../lib/paths'
import { CreateInline } from './CreateInline'
import { renameInputName, type EntryKind } from './createEntry'
import { focusOpenDocument } from '../lib/focusHandoff'
import { RenameInline } from './RenameInline'

/** Inline "New note"/"New folder page"/"New folder" input pending inside the tree (GRO-2022, YAZ-841). */
export interface PendingCreate {
  kind: EntryKind
  /** Absolute path of the directory the entry is created in. */
  parentDir: string
  onSubmit: (name: string) => Promise<void>
  onCancel: () => void
}

/** Inline rename replacing one row's label (files E1, GRO-2194; folders E1b, GRO-2241). */
export interface PendingRename {
  /** Absolute path of the row (file or dir) being renamed. */
  path: string
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
 * Sidebar multi-select (YAZ-1336, 🔒 D1) as both trees take it: the selected PATHS plus the two
 * gestures that change them. The Sidebar owns the reducer behind it; keying by path is 🔒 D3, so
 * a page standing under two parents in Topics shows selected on BOTH of its rows.
 */
export interface TreeSelection {
  paths: ReadonlySet<string>
  /** 🔒 D2: shift+click on a FILE row toggles it in or out — no range, and never an open. */
  toggle: (path: string) => void
  /** A plain click starts over before it opens; ⌘-click leaves the selection alone. */
  clear: () => void
}

interface TreeProps {
  nodes: TreeNode[]
  /** Absolute path of the directory these nodes are children of (the root at depth 0). */
  dirPath: string
  expanded: ReadonlySet<string>
  activeFile: string | null
  onToggle: (dir: string) => void
  onOpenFile: (path: string) => void
  /**
   * ⌘-click on a file row (I3 LOCKED ruling, GRO-2235): open it in a background tab of THIS
   * window — activation stays put. "Open in new window" lives on the context menu (D2).
   */
  onOpenFileBackground: (path: string) => void
  /** Right-click on a row; blank-space right-clicks are handled by the sidebar body. */
  onNodeContextMenu: (node: TreeNode, e: React.MouseEvent) => void
  pending: PendingCreate | null
  /** The one row (file or dir) currently renamed inline (E1/E1b); null when none. */
  renaming: PendingRename | null
  /** File drag-to-move state + callbacks (E1b); owned by the Sidebar. */
  move: TreeFileMove
  /** Multi-select state + gestures (YAZ-1336); owned by the Sidebar, shared with the Topics lens. */
  selection: TreeSelection
  depth?: number
}

export function Tree({
  nodes,
  dirPath,
  expanded,
  activeFile,
  onToggle,
  onOpenFile,
  onOpenFileBackground,
  onNodeContextMenu,
  pending,
  renaming,
  move,
  selection,
  depth = 0,
}: TreeProps) {
  const recurse = { expanded, activeFile, onToggle, onOpenFile, onOpenFileBackground, onNodeContextMenu, pending, renaming, move, selection }
  return (
    <ul className="tree" role={depth === 0 ? 'tree' : 'group'}>
      {pending !== null && pending.parentDir === dirPath && (
        <li>
          <CreateInline
            kind={pending.kind}
            indent={8 + depth * 14 + (pending.kind === 'dir' ? 0 : 14)}
            onSubmit={pending.onSubmit}
            onCancel={pending.onCancel}
          />
        </li>
      )}
      {nodes.map((node) =>
        node.type === 'dir' ? (
          <li key={node.path} role="treeitem" aria-expanded={expanded.has(node.path)}>
            {renaming !== null && renaming.path === node.path ? (
              // Inline FOLDER rename (E1b, GRO-2241): same idiom as files, prefilled with the
              // raw name — folders have no extension logic (one could be NAMED "Notes.md").
              <RenameInline initial={node.name} indent={8 + depth * 14} onSubmit={renaming.onSubmit} onCancel={renaming.onCancel} />
            ) : (
              <button
                type="button"
                className={`tree__row tree__row--dir${move.dropDir === node.path ? ' tree__row--drop' : ''}`}
                style={{ paddingLeft: 8 + depth * 14 }}
                onClick={() => onToggle(node.path)}
                onContextMenu={(e) => onNodeContextMenu(node, e)}
                onDragOver={(e) => {
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
                  move.drop(node.path)
                }}
              >
                <span className={`tree__chevron${expanded.has(node.path) ? ' tree__chevron--open' : ''}`} />
                <span className="tree__label">{node.name}</span>
              </button>
            )}
            {expanded.has(node.path) && <Tree nodes={node.children} dirPath={node.path} depth={depth + 1} {...recurse} />}
          </li>
        ) : renaming !== null && renaming.path === node.path ? (
          // Inline rename (Links E1, GRO-2194): Markdown hides its suffix and re-appends it on
          // commit; view-only files show the full filename so their extension stays explicit.
          <li key={node.path} role="treeitem">
            <RenameInline initial={renameInputName(node.name)} indent={8 + depth * 14 + 14} onSubmit={renaming.onSubmit} onCancel={renaming.onCancel} />
          </li>
        ) : (
          <li key={node.path} role="treeitem" aria-selected={node.path === activeFile || selection.paths.has(node.path)}>
            <button
              type="button"
              className={`tree__row tree__row--file${node.path === activeFile ? ' tree__row--active' : ''}${selection.paths.has(node.path) ? ' tree__row--selected' : ''}`}
              style={{ paddingLeft: 8 + depth * 14 + 14 }}
              onClick={(e) => {
                // Shift is the SELECTION gesture and nothing else (YAZ-1336, 🔒 D2): it never
                // opens, never previews — so it is asked first, before any of the open rules.
                if (e.shiftKey) {
                  selection.toggle(node.path)
                  return
                }
                // First activation previews, second commits — the Topics rows' rule (YAZ-921):
                // opening keeps focus on the row, re-activating the open page enters its text.
                if (e.metaKey) onOpenFileBackground(node.path)
                else {
                  selection.clear() // a plain click starts over; ⌘ above deliberately does not
                  if (node.path === activeFile) focusOpenDocument() // YAZ-961: the VISIBLE one
                  else onOpenFile(node.path)
                }
              }}
              onContextMenu={(e) => onNodeContextMenu(node, e)}
              title={node.path}
              data-path={node.path}
              draggable
              onDragStart={(e) => {
                if (e.dataTransfer) {
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', node.path)
                }
                move.start(node.path)
              }}
              onDragEnd={move.end}
            >
              <span className="tree__label">{stripExt(node.name)}</span>
            </button>
          </li>
        ),
      )}
    </ul>
  )
}
