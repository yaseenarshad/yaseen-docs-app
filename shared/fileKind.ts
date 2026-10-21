import { DIAGRAM_EXTENSIONS, DRAWING_VIEW_EXTENSIONS, IMAGE_VIEW_EXTENSIONS, MARKDOWN_EXTENSIONS, PDF_EXTENSIONS, TEXT_VIEW_EXTENSIONS, type BoardKind, type FileKind } from './types'

/**
 * Lower-cased extension of a file name or path, dot included; `null` when there is none. A leading
 * dot alone is not an extension (`.md` the file has none), matching Node's `path.extname`.
 */
function extensionOf(name: string): string | null {
  const basename = name.slice(name.lastIndexOf('/') + 1)
  const dot = basename.lastIndexOf('.')
  return dot <= 0 ? null : basename.slice(dot).toLowerCase()
}

/** Classifies a file name or path using the one approved, case-insensitive extension contract. */
export function fileKind(name: string): FileKind | null {
  const ext = extensionOf(name)
  if (ext === null) return null
  if ((MARKDOWN_EXTENSIONS as readonly string[]).includes(ext)) return 'markdown'
  if ((TEXT_VIEW_EXTENSIONS as readonly string[]).includes(ext)) return 'text'
  if ((PDF_EXTENSIONS as readonly string[]).includes(ext)) return 'pdf'
  if ((IMAGE_VIEW_EXTENSIONS as readonly string[]).includes(ext)) return 'image'
  if ((DRAWING_VIEW_EXTENSIONS as readonly string[]).includes(ext)) return 'drawing'
  if ((DIAGRAM_EXTENSIONS as readonly string[]).includes(ext)) return 'diagram'
  return null
}

export function isMarkdown(name: string): boolean {
  return fileKind(name) === 'markdown'
}

/**
 * Not Markdown, but a kind the app opens: never semantic, so a wikilink to it is navigation-only.
 * Drawings and diagrams count (YAZ-3028 edge cases) although a tab edits them: "view-only" names the
 * LINK rule, not the editor.
 */
export function isViewOnly(name: string): boolean {
  const kind = fileKind(name)
  return kind !== null && kind !== 'markdown'
}

export function isSupportedFile(name: string): boolean {
  return fileKind(name) !== null
}

/**
 * An EXCALIDRAW scene opened as a document (YAZ-3028 D2, Draw's 🔒 YAZ-1802 D2): the doors that read or
 * write scene JSON — `drawing:load` / `drawing:save`, the board create — ask this, so a diagram never reaches them.
 */
export function isDrawing(name: string): boolean {
  return fileKind(name) === 'drawing'
}

/** A draw.io diagram (YAZ-3028 D2): its own doors, `diagram:load` / `diagram:save`. */
export function isDiagram(name: string): boolean {
  return fileKind(name) === 'diagram'
}

/** A drawing OR a diagram: what the generic board surfaces ask (the tree row's Info, the hover preview, the create). */
export function isBoard(name: string): boolean {
  const kind = fileKind(name)
  return kind === 'drawing' || kind === 'diagram'
}

/**
 * What the app calls each board kind wherever a TYPE is meant (Draw's 🔒 YAZ-1802 D13): the engine is
 * named, so "Excalidraw drawing" and "draw.io diagram" never blur into each other.
 */
export const BOARD_TYPE_NAME: Record<BoardKind, string> = { drawing: 'Excalidraw drawing', diagram: 'draw.io diagram' }

/** The extension each kind of board is born with (YAZ-3028 D9). */
export const BOARD_EXTENSION: Record<BoardKind, string> = { drawing: DRAWING_VIEW_EXTENSIONS[0], diagram: DIAGRAM_EXTENSIONS[0] }

/** A board's name or path without its extension (`Flow.DRAWIO` → `Flow`, `.excalidraw` → ``); any other name is returned whole. */
export function boardBaseName(name: string): string {
  const dot = name.lastIndexOf('.')
  const ext = dot === -1 ? '' : name.slice(dot).toLowerCase()
  return ([...DRAWING_VIEW_EXTENSIONS, ...DIAGRAM_EXTENSIONS] as string[]).includes(ext) ? name.slice(0, dot) : name
}

/**
 * Renames never transcode bytes. Text and Markdown may move between extensions in their kind;
 * raster images must keep their real encoding (`.jpg` and `.jpeg` are the one equivalent spelling
 * pair); a file with no viewer keeps its exact extension, since nothing else vouches for what its
 * bytes are (YAZ-1577 D5).
 */
export function canRenameWithoutConversion(oldName: string, newName: string): boolean {
  const oldKind = fileKind(oldName)
  if (oldKind !== fileKind(newName)) return false
  if (oldKind !== 'image' && oldKind !== null) return true

  const oldExtension = extensionOf(oldName)
  const newExtension = extensionOf(newName)
  if (oldExtension === null || newExtension === null) return false
  if (oldExtension === newExtension) return true
  return ['.jpg', '.jpeg'].includes(oldExtension) && ['.jpg', '.jpeg'].includes(newExtension)
}

/** How many hex digits end an atomic write's tmp name, `<file>.tmp-<hex>` (`tmpSibling` in main's `fs/fsUtils.ts`). */
export const ATOMIC_TMP_HEX_LEN = 12
const ATOMIC_TMP = new RegExp(`\\.tmp-[0-9a-f]{${ATOMIC_TMP_HEX_LEN}}$`)

/**
 * Whether `name` (or a path) is an atomic write's own tmp file. One that outlives its write is a
 * crash's leftover and may be the only copy of a torn save, so it is never deleted; it is just
 * never listed, never watched and never synced (YAZ-2179).
 */
export const isAtomicTmp = (name: string): boolean => ATOMIC_TMP.test(name)
