import { stripSlash, type TreeNode } from '@shared/types'

/** Expanded-directory set for the sidebar tree (persisted per root; see storage.ts). */
export type TreeAction =
  | { type: 'toggle'; dir: string }
  /** Replace the whole set (⚡ YAZ-862): expand-all and collapse-all are this ONE action, `[]` being the latter. */
  | { type: 'setAll'; dirs: string[] }
  | { type: 'expandTo'; root: string; file: string }

export function treeReducer(expanded: string[], action: TreeAction): string[] {
  switch (action.type) {
    case 'toggle':
      return expanded.includes(action.dir) ? expanded.filter((d) => d !== action.dir) : [...expanded, action.dir]
    case 'setAll':
      return action.dirs
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

/** Every directory in `tree`, at every depth, outer before inner — the expand-all set (YAZ-862). */
export function allDirs(tree: TreeNode[]): string[] {
  return tree.flatMap((n) => (n.type === 'dir' ? [n.path, ...allDirs(n.children)] : []))
}

/** True when `path` is a file somewhere in `tree`. */
export function treeHasFile(tree: TreeNode[], path: string): boolean {
  return tree.some((n) => (n.type === 'file' ? n.path === path : treeHasFile(n.children, path)))
}

/** File OR folder: what the multi-select may hold (YAZ-1578, 🔒 D1), so its prune asks this one. */
export function treeHasPath(tree: TreeNode[], path: string): boolean {
  return tree.some((n) => n.path === path || (n.type === 'dir' && treeHasPath(n.children, path)))
}

/** The dir node at `path`, any depth (YAZ-1605); null once the tree no longer holds it. */
export function findDirNode(tree: readonly TreeNode[], path: string): TreeNode | null {
  for (const n of tree) {
    if (n.type !== 'dir') continue
    if (n.path === path) return n
    if (path.startsWith(`${n.path}/`)) return findDirNode(n.children, path)
  }
  return null
}

/** The node at `path`, file OR dir, any depth — `findDirNode`'s kind-agnostic twin for the Favorites list (YAZ-1766) and the focus list (YAZ-2619); null once the tree no longer holds it. */
export function findNode(tree: readonly TreeNode[], path: string): TreeNode | null {
  for (const n of tree) {
    if (n.path === path) return n
    if (n.type === 'dir' && path.startsWith(`${n.path}/`)) return findNode(n.children, path)
  }
  return null
}

/** The notes at `path` (YAZ-2420 3E1): the note itself, or every note under that folder, any depth. */
export function notesAt(tree: readonly TreeNode[], path: string): string[] {
  return tree.flatMap((n) => (n.type === 'dir' ? notesAt(n.children, path) : n.kind === 'markdown' && (n.path === path || n.path.startsWith(`${path}/`)) ? [n.path] : []))
}

/**
 * The Favorites tab's top rows (YAZ-1766 D4), and the Focus tab's (YAZ-2619 D2): every listed path
 * the tree still holds, in the list's STORED order — the user's order, never the tree's — files and
 * dirs alike. Nesting is kept (a file listed beside its listed parent shows at the root AND inside
 * it), and a vanished path simply yields no row.
 */
export function favoriteRoots(tree: readonly TreeNode[], favorites: readonly string[]): TreeNode[] {
  return favorites.flatMap((p) => findNode(tree, p) ?? [])
}

/**
 * The Favorites tab (YAZ-2602 D5). One vault → its flat list, as before. Two or more → one row per
 * vault that HAS a favorite the tree holds, in vault order, holding them in that vault's stored
 * order; the row is the Files tab's vault row, so it opens and closes with it.
 */
export function favoriteForest(trees: readonly { root: string; name: string; tree: readonly TreeNode[] }[], favorites: Readonly<Record<string, readonly string[]>>): TreeNode[] {
  if (trees.length === 1) return favoriteRoots(trees[0].tree, favorites[trees[0].root] ?? [])
  return trees.flatMap((t) => {
    const children = favoriteRoots(t.tree, favorites[t.root] ?? [])
    return children.length === 0 ? [] : [{ type: 'dir' as const, name: t.name, path: stripSlash(t.root), children }]
  })
}
