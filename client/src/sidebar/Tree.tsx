import type { TreeNode } from '@shared/types'
import { stripExt } from '../lib/paths'
import { CreateInline } from './CreateInline'

/** Inline "New note"/"New folder" input pending inside the tree (GRO-2022). */
export interface PendingCreate {
  kind: 'file' | 'dir'
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
            indent={8 + depth * 14 + (pending.kind === 'file' ? 14 : 0)}
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
              className={`tree__row tree__row--file${node.path === activeFile ? ' tree__row--active' : ''}`}
              style={{ paddingLeft: 8 + depth * 14 + 14 }}
              onClick={() => onOpenFile(node.path)}
              onContextMenu={(e) => onNodeContextMenu(node, e)}
              title={node.path}
            >
              <span className="tree__label">{stripExt(node.name)}</span>
            </button>
          </li>
        ),
      )}
    </ul>
  )
}
