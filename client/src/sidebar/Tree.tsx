import type { TreeNode } from '@shared/types'
import { stripExt } from '../lib/paths'
import { CreateInline } from './CreateInline'
import type { EntryKind } from './createEntry'
import { RenameInline } from './RenameInline'

/** Inline "New note"/"New base"/"New folder" input pending inside the tree (GRO-2022, GRO-2126). */
export interface PendingCreate {
  kind: EntryKind
  /** Absolute path of the directory the entry is created in. */
  parentDir: string
  /** "New KPI" for a typed create (Bible B, GRO-2202); absent → the kind placeholder. */
  placeholder?: string
  onSubmit: (name: string) => Promise<void>
  onCancel: () => void
}

/** Inline rename replacing one FILE row's label (Links E1, GRO-2194). */
export interface PendingRename {
  /** Absolute path of the file row being renamed. */
  path: string
  onSubmit: (name: string) => Promise<void>
  onCancel: () => void
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
  /** The one file row currently renamed inline (Links E1); null when none. */
  renaming: PendingRename | null
  depth?: number
}

/** 2×2 grid marking a `.base` row (GRO-2126) or tab (I3 shares it with the TabBar); same stroke weight as `SidebarPanelIcon`. */
export function BaseGlyph({ className }: { className: string }) {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
      <rect x="1.5" y="1.5" width="9" height="9" rx="1" />
      <line x1="6" y1="1.5" x2="6" y2="10.5" />
      <line x1="1.5" y1="6" x2="10.5" y2="6" />
    </svg>
  )
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
  depth = 0,
}: TreeProps) {
  const recurse = { expanded, activeFile, onToggle, onOpenFile, onOpenFileBackground, onNodeContextMenu, pending, renaming }
  return (
    <ul className="tree" role={depth === 0 ? 'tree' : 'group'}>
      {pending !== null && pending.parentDir === dirPath && (
        <li>
          <CreateInline
            kind={pending.kind}
            indent={8 + depth * 14 + (pending.kind === 'dir' ? 0 : 14)}
            placeholder={pending.placeholder}
            onSubmit={pending.onSubmit}
            onCancel={pending.onCancel}
          />
        </li>
      )}
      {nodes.map((node) =>
        node.type === 'dir' ? (
          <li key={node.path} role="treeitem" aria-expanded={expanded.has(node.path)}>
            <button
              type="button"
              className="tree__row tree__row--dir"
              style={{ paddingLeft: 8 + depth * 14 }}
              onClick={() => onToggle(node.path)}
              onContextMenu={(e) => onNodeContextMenu(node, e)}
            >
              <span className={`tree__chevron${expanded.has(node.path) ? ' tree__chevron--open' : ''}`} />
              <span className="tree__label">{node.name}</span>
            </button>
            {expanded.has(node.path) && <Tree nodes={node.children} dirPath={node.path} depth={depth + 1} {...recurse} />}
          </li>
        ) : renaming !== null && renaming.path === node.path ? (
          // Inline rename (Links E1, GRO-2194): the input replaces the row, prefilled with
          // the name minus its extension (the extension re-appends on commit).
          <li key={node.path} role="treeitem">
            <RenameInline initial={stripExt(node.name)} indent={8 + depth * 14 + 14} onSubmit={renaming.onSubmit} onCancel={renaming.onCancel} />
          </li>
        ) : (
          <li key={node.path} role="treeitem" aria-selected={node.path === activeFile}>
            <button
              type="button"
              className={`tree__row tree__row--file${node.kind === 'base' ? ' tree__row--base' : ''}${node.path === activeFile ? ' tree__row--active' : ''}`}
              style={{ paddingLeft: 8 + depth * 14 + 14 }}
              onClick={(e) => (e.metaKey ? onOpenFileBackground(node.path) : onOpenFile(node.path))}
              onContextMenu={(e) => onNodeContextMenu(node, e)}
              title={node.path}
            >
              {node.kind === 'base' && <BaseGlyph className="tree__glyph" />}
              <span className="tree__label">{stripExt(node.name)}</span>
            </button>
          </li>
        ),
      )}
    </ul>
  )
}
