/**
 * A board picture's cache KEY (YAZ-3028 D11), apart from the cache: the hover host builds it on every
 * dwell, and keeping it here lets the cache — the engine's export, draw.io's renderer — stay in the
 * lazy chunk `BoardPreview` brings.
 */
import type { DiagramDarkColors } from '@shared/types'

/**
 * One cache key per board, per write, per theme, per dark-mode colour setting. The mtime, not the
 * board's `updatedAt` block (🔒 D1 amendment): every write moves it, a sync or an outside editor
 * included; the block's one advantage, surviving a clone, means nothing to a cache that lives in
 * memory. Docs' tree is not read again on a save, so the caller hands the NEWEST mtime it knows —
 * the tree's, the board head's, or a watcher `change` while the preview shows (`HoverPreviewHost`, YAZ-3044 A41). Newline-separated because a path can hold ':' — the root sits at the start and the rest
 * at the end, so a path is whatever lies between. The colour setting only changes a diagram's
 * picture; a drawing redrawn after a toggle is the price of one key shape for both kinds.
 */
export function boardPreviewKey(root: string, node: { path: string; mtime: number }, theme: 'light' | 'dark', darkColors: DiagramDarkColors): string {
  return [root, node.path, node.mtime, theme, darkColors].join('\n')
}

/** The key back into its parts (see `boardPreviewKey`). */
export function parseKey(key: string): { root: string; path: string; theme: 'light' | 'dark'; darkColors: DiagramDarkColors } {
  const parts = key.split('\n')
  return {
    root: parts[0],
    path: parts.slice(1, -3).join('\n'),
    theme: parts[parts.length - 2] === 'dark' ? 'dark' : 'light',
    darkColors: parts[parts.length - 1] === 'keep' ? 'keep' : 'adapt',
  }
}
