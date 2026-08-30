import { MARKDOWN_EXTENSIONS, PDF_EXTENSIONS, TEXT_VIEW_EXTENSIONS, type FileKind } from './types'

/**
 * Classifies a file name or path using the one approved, case-insensitive extension contract.
 * A leading dot alone is not an extension (`.md` the file is null), matching Node's
 * `path.extname`.
 */
export function fileKind(name: string): FileKind | null {
  const basename = name.slice(name.lastIndexOf('/') + 1)
  const dot = basename.lastIndexOf('.')
  if (dot <= 0) return null
  const ext = basename.slice(dot).toLowerCase()
  if ((MARKDOWN_EXTENSIONS as readonly string[]).includes(ext)) return 'markdown'
  if ((TEXT_VIEW_EXTENSIONS as readonly string[]).includes(ext)) return 'text'
  if ((PDF_EXTENSIONS as readonly string[]).includes(ext)) return 'pdf'
  return null
}

export function isMarkdown(name: string): boolean {
  return fileKind(name) === 'markdown'
}

export function isViewOnly(name: string): boolean {
  const kind = fileKind(name)
  return kind === 'text' || kind === 'pdf'
}

export function isSupportedFile(name: string): boolean {
  return fileKind(name) !== null
}
