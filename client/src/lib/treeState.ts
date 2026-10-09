import type { TreeNode } from '@shared/types'

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

/** Every file in `tree` that is not a note, in tree order: the search's rows the index does not hold (YAZ-2620 🔒 D3). */
export function otherFiles(tree: readonly TreeNode[]): string[] {
  return tree.flatMap((n) => (n.type === 'dir' ? otherFiles(n.children) : n.kind === 'markdown' ? [] : [n.path]))
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

/** `path` is one of `paths` or stands inside one, at any depth (YAZ-2662 D2): one look in the set for the path and for each folder above it, whatever the set holds. */
export function atOrBelow(paths: ReadonlySet<string>, path: string): boolean {
  for (let end = path.length; end > 0; end = path.lastIndexOf('/', end - 1)) if (paths.has(path.slice(0, end))) return true
  return false
}

/**
 * The top rows of the search's top group (YAZ-2662 D3), off the rows of the Focus tab followed by
 * those of the Favorites tab: an item listed two times keeps its first place (S17), and an item
 * inside a different listed folder is no top row — it shows inside that folder (S18).
 */
export function pinnedRoots(nodes: readonly TreeNode[]): TreeNode[] {
  const paths = new Set(nodes.map((n) => n.path))
  const seen = new Set<string>()
  return nodes.filter((n) => {
    if (seen.has(n.path)) return false
    seen.add(n.path)
    return !atOrBelow(paths, n.path.slice(0, n.path.lastIndexOf('/')))
  })
}

/**
 * `tree` without the nodes at `paths`, at any depth: what the search cuts "Everything else" from
 * (YAZ-2662 S19) — `paths` are the pinned items that its top group draws. A folder that holds none
 * of them is the tree's own node, and so is a tree that holds none.
 */
export function withoutPaths(tree: readonly TreeNode[], paths: ReadonlySet<string>): readonly TreeNode[] {
  let same = true
  const kept = tree.flatMap((n): TreeNode[] => {
    if (paths.has(n.path)) {
      same = false
      return []
    }
    if (n.type === 'file') return [n]
    const children = withoutPaths(n.children, paths)
    if (children === n.children) return [n]
    same = false
    return [{ ...n, children: [...children] }]
  })
  return same ? tree : kept
}

/**
 * The Favorites tab's paths (YAZ-2631 D1): ONE flat list across the vaults of the window. `order`
 * (the store's) says which VAULT has each place; each vault fills its places in its own file's
 * order, so a synced file still wins inside its vault. A favorite with no place goes last, in vault order.
 */
export function favoriteOrder(roots: readonly string[], favorites: Readonly<Record<string, readonly string[]>>, order: readonly string[]): string[] {
  const own = roots.map((root) => favorites[root] ?? [])
  if (roots.length === 1) return [...own[0]]
  const home = new Map(own.flatMap((list, at) => list.map((path) => [path, at] as const)))
  const next = own.map(() => 0)
  const placed = order.flatMap((path) => {
    const at = home.get(path)
    return at === undefined || next[at] === own[at].length ? [] : [own[at][next[at]++]]
  })
  return [...placed, ...own.flatMap((list, at) => list.slice(next[at]))]
}
