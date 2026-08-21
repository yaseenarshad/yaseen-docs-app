import type { TreeNode } from '@shared/types'
import { stripExt } from '../lib/paths'
import { CreateInline } from './CreateInline'
import type { EntryKind } from './createEntry'

/** Inline "New note"/"New base"/"New folder" input pending inside the tree (GRO-2022, GRO-2126). */
export interface PendingCreate {
  kind: EntryKind
  /** Absolute path of the directory the entry is created in. */
  parentDir: string
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
  /** Right-click on a row; blank-space right-clicks are handled by the sidebar body. */
  onNodeContextMenu: (node: TreeNode, e: React.MouseEvent) => void
  pending: PendingCreate | null
  depth?: number
}

/** 2×2 grid marking a `.base` row (GRO-2126); same stroke weight as `SidebarPanelIcon`. */
function BaseGlyph() {
  return (
    <svg className="tree__glyph" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
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
  onNodeContextMenu,
  pending,
  depth = 0,
}: TreeProps) {
  const recurse = { expanded, activeFile, onToggle, onOpenFile, onNodeContextMenu, pending }
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
        ) : (
          <li key={node.path} role="treeitem" aria-selected={node.path === activeFile}>
            <button
              type="button"
              className={`tree__row tree__row--file${node.kind === 'base' ? ' tree__row--base' : ''}${node.path === activeFile ? ' tree__row--active' : ''}`}
              style={{ paddingLeft: 8 + depth * 14 + 14 }}
              onClick={() => onOpenFile(node.path)}
              onContextMenu={(e) => onNodeContextMenu(node, e)}
              title={node.path}
            >
              {node.kind === 'base' && <BaseGlyph />}
              <span className="tree__label">{stripExt(node.name)}</span>
            </button>
          </li>
        ),
      )}
    </ul>
  )
}
