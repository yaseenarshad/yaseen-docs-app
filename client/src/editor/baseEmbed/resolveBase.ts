/**
 * Resolves a base embed's target to an absolute path over a bridge `tree()` snapshot (6A,
 * GRO-2145). Mirrors the main process's `findByBasename` (`desktop/src/main/fs/assets.ts`):
 * Obsidian's shortest-path rule, deterministically — breadth-first over the tree (a shallower
 * match always wins; a whole level is scanned before descending), first case-insensitive
 * basename match in tree order (the bridge already sorts each directory case-insensitively).
 * A target with a `/` tries the root-relative path first, then falls back to the basename.
 */
import type { TreeNode } from '@shared/types'

export function resolveBasePath(tree: readonly TreeNode[], root: string, target: string): string | null {
  const clean = target.trim().replace(/^\/+/, '')
  if (clean === '') return null
  if (clean.includes('/')) {
    const want = `${root.replace(/\/+$/, '')}/${clean}`.toLowerCase()
    const byPath = findFile(tree, (f) => f.path.toLowerCase() === want)
    if (byPath !== null) return byPath
  }
  const basename = clean.slice(clean.lastIndexOf('/') + 1).toLowerCase()
  let level: ReadonlyArray<readonly TreeNode[]> = [tree]
  while (level.length > 0) {
    const next: Array<readonly TreeNode[]> = []
    for (const children of level) {
      for (const node of children) {
        if (node.type === 'file' && node.name.toLowerCase() === basename) return node.path
      }
      for (const node of children) {
        if (node.type === 'dir') next.push(node.children)
      }
    }
    level = next
  }
  return null
}

function findFile(nodes: readonly TreeNode[], match: (f: Extract<TreeNode, { type: 'file' }>) => boolean): string | null {
  for (const node of nodes) {
    if (node.type === 'file') {
      if (match(node)) return node.path
    } else {
      const hit = findFile(node.children, match)
      if (hit !== null) return hit
    }
  }
  return null
}
