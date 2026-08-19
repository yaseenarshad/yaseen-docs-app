import type { TreeNode } from '@shared/types'

/** Expanded-directory set for the sidebar tree (persisted per root; see storage.ts). */
export type TreeAction =
  | { type: 'toggle'; dir: string }
  | { type: 'expandTo'; root: string; file: string }

export function treeReducer(expanded: string[], action: TreeAction): string[] {
  switch (action.type) {
    case 'toggle':
      return expanded.includes(action.dir) ? expanded.filter((d) => d !== action.dir) : [...expanded, action.dir]
    case 'expandTo': {
      const missing = ancestorDirs(action.root, action.file).filter((d) => !expanded.includes(d))
      return missing.length === 0 ? expanded : [...expanded, ...missing]
    }
  }
}

/** Directories strictly between `root` and `file` (root excluded), outermost first. */
export function ancestorDirs(root: string, file: string): string[] {
  let cur = root.replace(/\/+$/, '')
  if (!file.startsWith(`${cur}/`)) return []
  const parts = file.slice(cur.length + 1).split('/')
  const dirs: string[] = []
  for (const part of parts.slice(0, -1)) {
    cur = `${cur}/${part}`
    dirs.push(cur)
  }
  return dirs
}

/** True when `path` is a file somewhere in `tree`. */
export function treeHasFile(tree: TreeNode[], path: string): boolean {
  return tree.some((n) => (n.type === 'file' ? n.path === path : treeHasFile(n.children, path)))
}
