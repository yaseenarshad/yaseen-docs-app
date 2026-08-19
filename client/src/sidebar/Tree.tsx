import type { TreeNode } from '@shared/types'
import { stripExt } from '../lib/paths'

interface TreeProps {
  nodes: TreeNode[]
  expanded: ReadonlySet<string>
  activeFile: string | null
  onToggle: (dir: string) => void
  onOpenFile: (path: string) => void
  depth?: number
}

export function Tree({ nodes, expanded, activeFile, onToggle, onOpenFile, depth = 0 }: TreeProps) {
  return (
    <ul className="tree" role={depth === 0 ? 'tree' : 'group'}>
      {nodes.map((node) =>
        node.type === 'dir' ? (
          <li key={node.path} role="treeitem" aria-expanded={expanded.has(node.path)}>
            <button
              type="button"
              className="tree__row tree__row--dir"
              style={{ paddingLeft: 8 + depth * 14 }}
              onClick={() => onToggle(node.path)}
            >
              <span className={`tree__chevron${expanded.has(node.path) ? ' tree__chevron--open' : ''}`} />
              <span className="tree__label">{node.name}</span>
            </button>
            {expanded.has(node.path) && (
              <Tree
                nodes={node.children}
                expanded={expanded}
                activeFile={activeFile}
                onToggle={onToggle}
                onOpenFile={onOpenFile}
                depth={depth + 1}
              />
            )}
          </li>
        ) : (
          <li key={node.path} role="treeitem" aria-selected={node.path === activeFile}>
            <button
              type="button"
              className={`tree__row tree__row--file${node.path === activeFile ? ' tree__row--active' : ''}`}
              style={{ paddingLeft: 8 + depth * 14 + 14 }}
              onClick={() => onOpenFile(node.path)}
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
