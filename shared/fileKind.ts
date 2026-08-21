import { BASE_EXTENSIONS, MARKDOWN_EXTENSIONS, type FileKind } from './types'

/**
 * Classifies a file name or path by extension (case-insensitive): `.md`/`.markdown` →
 * `markdown`, `.base` → `base`, anything else → null. A leading dot alone is not an
 * extension (`.base` the file is null), matching Node's `path.extname`.
 */
export function fileKind(name: string): FileKind | null {
  const basename = name.slice(name.lastIndexOf('/') + 1)
  const dot = basename.lastIndexOf('.')
  if (dot <= 0) return null
  const ext = basename.slice(dot).toLowerCase()
  if ((MARKDOWN_EXTENSIONS as readonly string[]).includes(ext)) return 'markdown'
  if ((BASE_EXTENSIONS as readonly string[]).includes(ext)) return 'base'
  return null
}
