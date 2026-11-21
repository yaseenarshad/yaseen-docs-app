/**
 * INLINE EXCALIDRAW CONVERT ACTIONS (YAZ-5040 / YAZ-6121): disk writes for moving an inline
 * ```` ```excalidraw ```` block out to its own `.excalidraw` file and putting a standalone
 * `.excalidraw` embed back into a Markdown page.
 *
 * - Move out: creates `<Page title> drawing.excalidraw` via `createBoardForPage` (respecting
 *   `newBoardFolder`), saves the scene via `api.drawing.save` (which packs referenced `<vault>/assets/`
 *   images into an "inside" board automatically), and returns `{ target, boardPath }` so the caller
 *   can replace the inline block with `![[target|options]]`. If the save fails, the empty board goes
 *   to the Trash.
 * - Put back: reads the page (after flushing open editors) and the standalone board via
 *   `api.drawing.load`, lands any embedded images into `<vault>/assets/` via `api.drawing.landAssets`,
 *   writes the updated page with compare-and-set (`expectedMtime`, `quiet: true`, `announcedWrite`),
 *   and moves the standalone `.excalidraw` file to Trash. If trashing fails, the page is restored.
 */
import { formatEmbedOptions, newEmbed, splitEmbed } from '@shared/embedOptions'
import { parseDrawingLine, putDrawingBack } from '@shared/inlineDrawing'
import { isPageReadOnly } from '@shared/readOnly'
import type { DrawingNewFile } from '@shared/types'
import { api, BridgeRequestError } from '../../api'
import { createBoardForPage, DRAWINGS_DIR } from '../../drawings/createDrawing'
import { flushRenamedPath } from '../../lib/renameContinuity'
import { storage } from '../../lib/storage'
import { announcedWrite } from '../../lib/twinEditors'
import { ensureFolder } from '../../views/scaffold'
import { trackFileWrite } from '../../views/writeProperty'
import { linkPath, type WikilinkResolveSource } from '../wikilink/linkResolve'
import type { ViewOnlyLinkSource } from '../wikilink/viewOnlyLinkSource'

/** A convert that stopped before it wrote: its message is the notice's reason. */
export class DrawingConvertStopped extends Error {}

/** Why a drawing convert failed, in the notice's words. */
export function drawingConvertFailure(err: unknown): string {
  if (err instanceof BridgeRequestError && err.code === 'FORBIDDEN') return 'the disk refused the change. Nothing changed.'
  if (err instanceof BridgeRequestError && err.code === 'CONFLICT') return 'the file changed on disk. Nothing changed; try again.'
  return err instanceof Error ? err.message : String(err)
}

/** ONE compare-and-set write of `path`, as the app's own (an open tab takes it quietly), taken by the index at once. */
const writeOnce = (path: string, content: string, mtime: number): Promise<{ mtime: number }> =>
  trackFileWrite(announcedWrite(path, () => api.writeFile({ path, content, expectedMtime: mtime, quiet: true })))

/**
 * Formats an embed string `![[target|options]]` from a target and an optional `<!-- drawing: … -->` line.
 * When `drawingLine` is null or carries no options, produces `![[target|locked]]` (matching `newEmbed`).
 */
export function inlineEmbedText(target: string, drawingLine: string | null): string {
  const options = drawingLine === null ? null : parseDrawingLine(drawingLine)
  const formatted = options === null ? '' : formatEmbedOptions(options)
  return formatted === '' ? newEmbed(target) : `![[${target}|${formatted}]]`
}

export interface MoveInlineDrawingOptions {
  /** Vault root (absolute path). */
  root: string
  /** Absolute path of the page holding the inline drawing. */
  pagePath: string
  /** Display title of the page (used for `<title> drawing.excalidraw` when `drawingTitle` is empty). */
  title: string
  /** Optional title of the inline drawing (YAZ-6136): when non-empty, names the file `<drawingTitle>.excalidraw`. */
  drawingTitle?: string
  /** Raw JSON of the inline drawing scene. */
  sceneJson: string
  /** True when another file in the vault already has this bare file name. */
  nameTaken?: (name: string) => boolean
}

export interface MoveInlineDrawingResult {
  /** Embed target: bare file name if unique, else vault-relative path. */
  target: string
  /** Absolute path of the newly created `.excalidraw` file. */
  boardPath: string
}

const MAX_ATTEMPTS = 50

async function createNamedDrawing(opts: MoveInlineDrawingOptions, stem: string): Promise<{ relPath: string; unique: boolean }> {
  const { root, pagePath } = opts
  const pageDir = pagePath.slice(0, Math.max(pagePath.lastIndexOf('/'), 0))
  const inVault = pageDir === root || pageDir.startsWith(`${root}/`)
  const folderChoice = storage.getSettings().newBoardFolder
  const dir = folderChoice === 'assets' || !inVault ? await ensureFolder(root, DRAWINGS_DIR) : pageDir
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const name = `${stem}${attempt === 0 ? '' : ` ${attempt + 1}`}.excalidraw`
    const unique = opts.nameTaken?.(name) === false
    try {
      const made = await api.createBoard({ root, path: `${dir}/${name}` })
      return { relPath: made.path.slice(root.length + 1), unique }
    } catch (err) {
      if (!(err instanceof BridgeRequestError && err.code === 'ALREADY_EXISTS')) throw err
    }
  }
  throw new Error(`${MAX_ATTEMPTS} names in ${dir.slice(root.length + 1) || 'the vault'} are already taken`)
}

/**
 * MOVE TO ITS OWN FILE: creates `<drawingTitle>.excalidraw` (when `drawingTitle` is non-empty) or
 * `<Page title> drawing.excalidraw` (respecting `newBoardFolder`), writes `sceneJson` into it via
 * `api.drawing.save` (which packs referenced `<vault>/assets/` images into an "inside" board), and
 * returns `{ target, boardPath }`. If the save fails, the newly created empty board is moved to
 * Trash before rethrowing.
 */
export async function moveInlineDrawingToFile(opts: MoveInlineDrawingOptions): Promise<MoveInlineDrawingResult> {
  const customStem = opts.drawingTitle?.replace(/[/\\:]/g, '-').trim() ?? ''
  let relPath: string
  let unique = false
  if (customStem !== '') {
    ;({ relPath, unique } = await createNamedDrawing(opts, customStem))
  } else {
    relPath = await createBoardForPage(
      {
        root: opts.root,
        pagePath: opts.pagePath,
        title: opts.title,
        nameTaken: (name) => {
          // Ask before `api.createBoard` runs; return true so `createBoardForPage` always hands back the vault-relative path.
          unique = opts.nameTaken?.(name) === false
          return true
        },
      },
      'drawing',
    )
  }
  const boardPath = `${opts.root}/${relPath}`
  const fileName = relPath.slice(relPath.lastIndexOf('/') + 1)
  const target = unique ? fileName : relPath

  try {
    await api.drawing.save({
      root: opts.root,
      path: boardPath,
      json: opts.sceneJson,
      newFiles: [],
    })
  } catch (err) {
    await api.file.delete({ path: boardPath }).catch(() => undefined)
    throw err
  }

  return { target, boardPath }
}

export interface PutDrawingBackOptions {
  /** Vault root (absolute path). */
  root: string
  /** Absolute path of the Markdown page receiving the inline drawing. */
  pagePath: string
  /** Absolute or vault-relative path of the standalone `.excalidraw` file. */
  boardPath: string
  /** Exact text between `![[` and `]]` of the lone embed being replaced. */
  inner: string
  /** 0-based index among lone embeds with the same `inner` in the page. */
  nth: number
  /** Embed options text (after the options `|`), or null if none. */
  optionsText: string | null
}

/**
 * PUT BACK INTO THIS PAGE: loads the standalone `.excalidraw` board, lands any referenced image bytes
 * into `<vault>/assets/` (so the lean inline scene never loses embedded pictures), replaces the `nth`
 * lone embed `![[inner]]` in `pagePath` via compare-and-set `api.writeFile`, and moves the standalone
 * `.excalidraw` file to Trash. If trashing fails, the page gets its previous bytes back.
 */
export async function putDrawingBackIntoPage(opts: PutDrawingBackOptions): Promise<void> {
  await flushRenamedPath(opts.pagePath)
  const file = await api.readFile(opts.pagePath)
  if (isPageReadOnly(file.content)) throw new DrawingConvertStopped('it is read only.')

  const loaded = await api.drawing.load({ root: opts.root, path: opts.boardPath })
  const boardFileName = loaded.path.slice(loaded.path.lastIndexOf('/') + 1)
  const boardTitle = boardFileName.replace(/\.excalidraw$/i, '').trim()
  const nextPage = putDrawingBack(file.content, opts.inner, opts.nth, loaded.json, opts.optionsText, boardTitle)

  // Ensure every image referenced by the board exists in `<vault>/assets/` before the board is trashed.
  // (`landAssets` is content-addressed and idempotent: files already in `assets/` are skipped via EEXIST.)
  const newFiles: DrawingNewFile[] = Object.entries(loaded.files).map(([fileId, entry]) => ({
    fileId,
    mimeType: entry.mimeType,
    dataURL: entry.dataURL,
  }))
  if (newFiles.length > 0) {
    await api.drawing.landAssets({ root: opts.root, newFiles })
  }

  const written = await writeOnce(opts.pagePath, nextPage, file.mtime)
  try {
    await api.file.delete({ path: loaded.path })
  } catch (err) {
    await writeOnce(opts.pagePath, file.content, written.mtime).catch(() => undefined)
    throw err
  }
}

/**
 * Counts how many OTHER pages in `wikilinks.records` embed `boardPath` (excluding `pagePath` and
 * `boardPath` itself), so the UI can ask for confirmation before moving the standalone `.excalidraw`
 * file to Trash.
 */
export function drawingEmbeddersCount(
  wikilinks: WikilinkResolveSource | undefined,
  boardPath: string,
  pagePath: string,
  viewOnly?: ViewOnlyLinkSource,
): number {
  if (wikilinks === undefined) return 0
  let count = 0
  for (const record of wikilinks.records) {
    if (record.path === pagePath || record.path === boardPath) continue
    const embedsBoard = record.embeds.some((target) => {
      const resolved = linkPath(target, wikilinks, viewOnly)
      if (resolved !== null) return resolved === boardPath
      if (viewOnly !== undefined) return false
      const clean = splitEmbed(target).target.split('#')[0]!.trim()
      return clean !== '' && (boardPath === clean || boardPath.endsWith(`/${clean}`))
    })
    if (embedsBoard) count++
  }
  return count
}
