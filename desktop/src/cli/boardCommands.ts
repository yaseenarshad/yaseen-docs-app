/**
 * `yaseendocs board` (YAZ-6157): Electron-free CLI commands for Excalidraw drawings (`.excalidraw`)
 * and draw.io diagrams (`.drawio`):
 *
 *   yaseendocs board new      <folder> --title <name> [--kind drawing|diagram] [--json]
 *   yaseendocs board pictures <file.excalidraw> (--out | --inside) [--folder <dir>] [--json]
 *   yaseendocs board readonly <file> [--off] [--json]
 *   yaseendocs board inline   <page.md> [--title <text>] [--from <file.excalidraw>] [--after <heading>] [--unlocked] [--trash] [--json]
 *   yaseendocs board extract  <page.md> [--index <n>] [--title <name>] [--to <dir>] [--json]
 *
 * Plain Node — never imports `electron`. Shares the app's own fs and pure modules (`createBoard`,
 * `setBoardPictures`, `setBoardReadOnly`, `liftEmbedded`/`landAssets`, `shared/inlineDrawing.ts`,
 * `shared/drawingAssets.ts`).
 */
import { stat, unlink, readFile as readRaw } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  referencedFileIds,
  serializeBoard,
  stampBoardMetaScene,
  withPicturesOut,
} from '@shared/drawingAssets'
import { splitEmbed } from '@shared/embedOptions'
import { lineKinds } from '@shared/fences'
import { isDrawing } from '@shared/fileKind'
import { splitFrontmatter } from '@shared/frontmatter'
import {
  EMPTY_INLINE_SCENE_JSON,
  compactInlineScene,
  drawingTitleOf,
  findInlineDrawings,
  formatDrawingLine,
  inlineDrawingBlock,
  moveInlineDrawingOut,
  putDrawingBack,
} from '@shared/inlineDrawing'
import { inLineEnds, withLf } from '@shared/lineEnds'
import { newestFile } from '@shared/settingsSync'
import { defaultAppState, type AppState, type BoardKind, type SettingsState } from '@shared/types'
import { BOARDS } from '../main/fs/boardDocument'
import { setBoardPictures } from '../main/fs/boardPictures'
import { setBoardReadOnly } from '../main/fs/boardReadOnly'
import { readBoundedRegularFile } from '../main/fs/boundedRead'
import { createBoard } from '../main/fs/createBoard'
import { readFile } from '../main/fs/file'
import { BridgeFailure, createDurable, fsCall, requireMarkdownFile } from '../main/fs/fsUtils'
import { landAssets, liftEmbedded, parseScene } from '../main/fs/pictureStore'
import { blockedPicturesFolder } from '../main/fs/picturesFolders'
import { otherMacFiles } from '../main/settingsFiles'
import { mergeFolderSettings, parseState } from '../main/store'
import { STATE_FILE, userDataDir } from '../main/userData'
import { macId } from '../main/vaultIndex/mint'
import { vaultNewPlacesSettings, vaultRootOf } from '../main/vaultSettingsRead'
import type { Io } from './cli'
import { onlyFlags as checkFlags, sectionPlace, str, transformOnDisk, trashInVault } from './cliShared'

export { trashInVault as trashBoardFile } from './cliShared'

/** Usage error thrown by `boardCommand` so `cli.ts` can map it to exit code 2. */
export class BoardUsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'Usage'
  }
}

/** Value flags used by `board` subcommands (for `cli.ts` parser wiring). */
export const BOARD_FLAGS = ['--title', '--kind', '--folder', '--from', '--after', '--index', '--to'] as const
/** Switch flags used by `board` subcommands (for `cli.ts` parser wiring). */
export const BOARD_SWITCHES = ['--out', '--inside', '--off', '--unlocked', '--trash', '--json'] as const

const onlyFlags = (verb: string, flags: Map<string, string | true>, takes: readonly string[]): void =>
  checkFlags(verb, flags, takes, (msg) => new BoardUsageError(msg))

/** Reads the app's state file (read-only); falls back to default state when absent. */
async function readAppState(): Promise<AppState> {
  const file = join(userDataDir(process.env, process.platform, homedir()), STATE_FILE)
  const text = await readRaw(file, 'utf8').catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') return null
    throw err
  })
  const state = text === null ? defaultAppState() : parseState(text)
  if (state === null) throw new Error(`${file} is not a valid app state`)
  return state
}

/** Current merged settings (state file + newest synced settings file from another Mac). */
async function currentSettings(): Promise<{ settings: SettingsState; approvedPictureFolders: readonly string[] }> {
  const state = await readAppState()
  if (state.settingsFolder === null) {
    return { settings: state.settings, approvedPictureFolders: state.approvedPictureFolders }
  }
  const files = await otherMacFiles(state.settingsFolder, await macId()).catch(() => [])
  const newer = newestFile(files, state.settingsSavedAt)
  return {
    settings: newer === null ? state.settings : mergeFolderSettings(state.settings, newer.settings),
    approvedPictureFolders: state.approvedPictureFolders,
  }
}

/** Validates an optional single-line `--title` value. */
function parseTitleFlag(flags: Map<string, string | true>, required: boolean, verb: string): string | undefined {
  const raw = flags.get('--title')
  if (raw === undefined) {
    if (required) throw new BoardUsageError(`${verb} needs --title`)
    return undefined
  }
  if (raw === true) throw new BoardUsageError('--title needs a value')
  const trimmed = raw.trim()
  if (trimmed === '' || /[\r\n]/.test(trimmed)) throw new BoardUsageError('--title must be a non-empty single line')
  return trimmed
}

/** Turns a board title into a safe filename with `ext` (refuses path separators, hidden names, empty stems). */
function boardFileName(title: string, ext: '.excalidraw' | '.drawio'): string {
  const trimmed = title.trim()
  if (trimmed === '' || /[\r\n\0]/.test(trimmed)) throw new BoardUsageError('--title must be a non-empty single line')
  if (trimmed.includes('/') || trimmed.includes('\\')) throw new BoardUsageError('--title cannot contain path separators')
  const stem = trimmed.toLowerCase().endsWith(ext) ? trimmed.slice(0, -ext.length).trim() : trimmed
  if (stem === '' || stem === '.' || stem === '..' || stem.startsWith('.')) {
    throw new BoardUsageError(`invalid board name: "${title}"`)
  }
  return `${stem}${ext}`
}

/** Sanitizes a fallback title read from `<!-- drawing: title "..." -->` into a valid filename stem. */
function safeBoardStem(raw: string): string {
  const cleaned = raw
    .replace(/[/\\:*?"<>|\r\n\0]+/g, ' ')
    .replace(/^\.+/, '')
    .trim()
  return cleaned === '' ? 'Drawing' : cleaned
}

/** Retries a board mtime-guarded operation once on `CONFLICT`. */
async function withBoardMtimeRetry<T>(file: string, run: (expectedMtime: number) => Promise<T>): Promise<T> {
  let expectedMtime = (await fsCall(file, () => stat(file))).mtimeMs
  try {
    return await run(expectedMtime)
  } catch (err) {
    if (!(err instanceof BridgeFailure) || err.code !== 'CONFLICT') throw err
    expectedMtime = err.mtime ?? (await fsCall(file, () => stat(file))).mtimeMs
    return await run(expectedMtime)
  }
}

/** `board new <folder> --title <name> [--kind drawing|diagram] [--json]` */
export async function boardNew(args: readonly string[], flags: Map<string, string | true>, io: Io): Promise<void> {
  onlyFlags('board new', flags, ['--title', '--kind', '--json'])
  if (args[0] === undefined) throw new BoardUsageError('board new needs a folder')
  if (args.length > 1) throw new BoardUsageError(`unexpected argument: ${args[1]}`)
  const title = parseTitleFlag(flags, true, 'board new')!
  const kindRaw = str(flags, '--kind') ?? 'drawing'
  if (kindRaw !== 'drawing' && kindRaw !== 'diagram') {
    throw new BoardUsageError('--kind must be drawing or diagram')
  }
  const kind: BoardKind = kindRaw
  const ext = kind === 'drawing' ? '.excalidraw' : '.drawio'
  const fileName = boardFileName(title, ext)
  const dir = resolve(args[0])
  const dirStat = await stat(dir).catch(() => null)
  if (dirStat === null) throw new Error(`no folder ${dir}`)
  if (!dirStat.isDirectory()) throw new Error(`${dir} is not a folder`)
  const vault = await vaultRootOf(dir)
  const root = vault ?? dir
  const { settings: app } = await currentSettings()
  const s = vault === null ? app : await vaultNewPlacesSettings(vault, app)
  const target = join(dir, fileName)
  const res = await createBoard({ root, path: target }, s.newBoardPictures, s.newBoardPicturesFolder).catch((err: unknown) => {
    if (err instanceof BridgeFailure && err.code === 'ALREADY_EXISTS') {
      throw new Error(`${target} already exists`)
    }
    throw err
  })
  if (flags.has('--json')) {
    io.stdout(`${JSON.stringify({ path: res.path, kind, mtime: res.mtime, size: res.size }, null, 2)}\n`)
  } else {
    io.stdout(`made ${res.path}\n`)
  }
}

/** `board pictures <file.excalidraw> (--out | --inside) [--folder <dir>] [--json]` */
export async function boardPictures(args: readonly string[], flags: Map<string, string | true>, io: Io): Promise<void> {
  onlyFlags('board pictures', flags, ['--out', '--inside', '--folder', '--json'])
  if (args[0] === undefined) throw new BoardUsageError('board pictures needs a .excalidraw file')
  if (args.length > 1) throw new BoardUsageError(`unexpected argument: ${args[1]}`)
  const wantOut = flags.has('--out')
  const wantInside = flags.has('--inside')
  if (wantOut === wantInside) throw new BoardUsageError('board pictures needs exactly one of --out or --inside')
  const rawFolder = str(flags, '--folder')
  if (flags.has('--folder') && !wantOut) throw new BoardUsageError('--folder is only valid with --out')
  if (flags.has('--folder') && (rawFolder === undefined || rawFolder.trim() === '')) {
    throw new BoardUsageError('--folder needs a folder path')
  }
  const file = resolve(args[0])
  const root = (await vaultRootOf(dirname(file))) ?? dirname(file)
  let folder: string | undefined
  if (rawFolder !== undefined) {
    const trimmed = rawFolder.trim()
    if (isAbsolute(trimmed)) {
      const abs = resolve(trimmed)
      if (abs.startsWith(root + sep)) {
        folder = relative(root, abs).split(sep).join('/')
      } else {
        folder = abs
      }
    } else {
      folder = trimmed.split('\\').join('/')
    }
  }
  const { approvedPictureFolders } = await currentSettings()
  const approved = [
    ...approvedPictureFolders,
    ...(folder !== undefined && isAbsolute(folder) && !blockedPicturesFolder(folder) ? [folder] : []),
  ]
  const before = await fsCall(file, () => stat(file))
  const res = await withBoardMtimeRetry(file, (expectedMtime) =>
    setBoardPictures({ root, path: file, out: wantOut, ...(folder !== undefined ? { folder } : {}), expectedMtime }, approved),
  )
  const after = await fsCall(file, () => stat(file))
  const moved = after.ino !== before.ino || res.mtime !== before.mtimeMs || res.size !== before.size
  if (flags.has('--json')) {
    io.stdout(`${JSON.stringify({ path: res.path, out: wantOut, ...(folder !== undefined ? { folder } : {}), moved, mtime: res.mtime }, null, 2)}\n`)
  } else if (wantOut) {
    const dest = folder ?? 'assets'
    io.stdout(moved ? `moved pictures of ${res.path} to ${dest}\n` : `pictures of ${res.path} are already in ${dest}\n`)
  } else {
    io.stdout(moved ? `moved pictures inside ${res.path}\n` : `pictures are already inside ${res.path}\n`)
  }
}

/** `board readonly <file> [--off] [--json]` */
export async function boardReadOnly(args: readonly string[], flags: Map<string, string | true>, io: Io): Promise<void> {
  onlyFlags('board readonly', flags, ['--off', '--json'])
  if (args[0] === undefined) throw new BoardUsageError('board readonly needs a board file')
  if (args.length > 1) throw new BoardUsageError(`unexpected argument: ${args[1]}`)
  const file = resolve(args[0])
  const readOnly = !flags.has('--off')
  const root = (await vaultRootOf(dirname(file))) ?? dirname(file)
  const res = await withBoardMtimeRetry(file, (expectedMtime) =>
    setBoardReadOnly({ root, path: file, on: readOnly, expectedMtime }),
  )
  if (flags.has('--json')) {
    io.stdout(`${JSON.stringify({ path: res.path, readOnly, mtime: res.mtime }, null, 2)}\n`)
  } else {
    io.stdout(`${res.path} is ${readOnly ? 'read-only' : 'editable'}\n`)
  }
}

interface MatchedEmbed {
  inner: string
  nth: number
  options: string | null
  lineIndex: number
}

const LONE_EMBED_RE = /^[ \t]*!\[\[([^\]]+)\]\][ \t]*$/

/** Finds the first lone embed `![[...]]` in `body` (outside code fences) that resolves to `boardPath`. */
function findMatchingEmbed(body: string, pagePath: string, root: string, boardPath: string): MatchedEmbed | null {
  const lines = body.split('\n')
  const kinds = lineKinds(lines)
  const boardBase = basename(boardPath).toLowerCase()
  const pageDir = dirname(pagePath)
  const seenCounts = new Map<string, number>()

  for (let i = 0; i < lines.length; i++) {
    if (kinds[i] !== 'text') continue
    const m = LONE_EMBED_RE.exec(lines[i]!)
    if (m === null) continue
    const inner = m[1]!
    const nth = seenCounts.get(inner) ?? 0
    seenCounts.set(inner, nth + 1)
    const { target, options } = splitEmbed(inner)
    if (target === '') continue
    const normalized = target.split('#', 1)[0]!.trim()
    const matches =
      resolve(root, normalized) === boardPath ||
      resolve(pageDir, normalized) === boardPath ||
      (!normalized.includes('/') && !normalized.includes('\\') && normalized.toLowerCase() === boardBase)
    if (matches) return { inner, nth, options, lineIndex: i }
  }
  return null
}

/** Inserts `block` into `lfContent` after `--after <heading>` (or at end) and returns the new content + block index. */
function insertInlineBlock(lfContent: string, block: string, after: string | undefined): { content: string; index: number } {
  const { frontmatter, body } = splitFrontmatter(lfContent)
  const lines = body.split('\n')
  const at = sectionPlace(body, after)
  let from = at
  while (from > 0 && lines[from - 1]!.trim() === '') from--
  const before = lines.slice(0, from)
  const rest = lines.slice(at)
  const insertOpen = before.length + (before.length > 0 ? 1 : 0)
  const next = [...before, ...(before.length > 0 ? [''] : []), block, ...(rest.some((l) => l !== '') ? ['', ...rest] : [''])]
  const nextBody = next.join('\n')
  const blocks = findInlineDrawings(nextBody)
  const idx = blocks.findIndex((b) => b.open === insertOpen)
  return { content: frontmatter + nextBody, index: idx === -1 ? Math.max(0, blocks.length - 1) : idx }
}

/** `board inline <page.md> [--title <text>] [--from <file.excalidraw>] [--after <heading>] [--unlocked] [--trash] [--json]` */
export async function boardInline(args: readonly string[], flags: Map<string, string | true>, io: Io): Promise<void> {
  onlyFlags('board inline', flags, ['--title', '--from', '--after', '--unlocked', '--trash', '--json'])
  if (args[0] === undefined) throw new BoardUsageError('board inline needs a page')
  if (args.length > 1) throw new BoardUsageError(`unexpected argument: ${args[1]}`)
  const page = resolve(args[0])
  requireMarkdownFile(page)
  const title = parseTitleFlag(flags, false, 'board inline')
  const fromArg = str(flags, '--from')
  const after = str(flags, '--after')
  const unlocked = flags.has('--unlocked')
  const trash = flags.has('--trash')
  if (trash && fromArg === undefined) throw new BoardUsageError('--trash can only be used with --from')

  if (fromArg === undefined) {
    const drawingLine = formatDrawingLine({ width: null, height: null, view: null, locked: !unlocked, page: null, rest: [] }, title)
    const block = inlineDrawingBlock(EMPTY_INLINE_SCENE_JSON, drawingLine)
    let insertedIndex = 0
    await transformOnDisk(page, (fresh) =>
      inLineEnds(fresh, (lf) => {
        const res = insertInlineBlock(lf, block, after)
        insertedIndex = res.index
        return res.content
      }),
    )
    if (flags.has('--json')) {
      io.stdout(`${JSON.stringify({ page, index: insertedIndex, ...(title !== undefined ? { title } : {}) }, null, 2)}\n`)
    } else {
      io.stdout(`inlined drawing #${insertedIndex} in ${page}\n`)
    }
    return
  }

  // Pull-in mode (`--from <file.excalidraw>`)
  const fromPath = resolve(fromArg)
  if (!isDrawing(fromPath)) {
    throw new BridgeFailure('UNSUPPORTED_EXTENSION', 'only .excalidraw files can be inlined', { path: fromPath })
  }
  const snap = await readBoundedRegularFile(fromPath, BOARDS.drawing.max, BOARDS.drawing.tooLarge)
  const { scene, elements } = parseScene(snap.data.toString('utf8'), fromPath, 'IO_ERROR')
  const root = (await vaultRootOf(dirname(page))) ?? (await vaultRootOf(dirname(fromPath))) ?? dirname(page)
  const { lean, lifted } = liftEmbedded(scene, elements)
  if (lifted.length > 0) await landAssets(root, lifted)
  const { json: compactJson } = compactInlineScene(JSON.stringify(lean))

  let insertedIndex = 0
  await transformOnDisk(page, (fresh) => {
    const lf = withLf(fresh)
    const { body } = splitFrontmatter(lf)
    const match = after === undefined ? findMatchingEmbed(body, page, root, fromPath) : null
    if (match !== null) {
      const updated = putDrawingBack(fresh, match.inner, match.nth, compactJson, match.options, title)
      const nextBlocks = findInlineDrawings(splitFrontmatter(withLf(updated)).body)
      const idx = nextBlocks.findIndex((b) => b.open === match.lineIndex)
      insertedIndex = idx === -1 ? Math.max(0, nextBlocks.length - 1) : idx
      return updated
    }
    const drawingLine = formatDrawingLine({ width: null, height: null, view: null, locked: !unlocked, page: null, rest: [] }, title)
    const block = inlineDrawingBlock(compactJson, drawingLine)
    return inLineEnds(fresh, (text) => {
      const res = insertInlineBlock(text, block, after)
      insertedIndex = res.index
      return res.content
    })
  })

  let trashed = false
  if (trash) {
    await trashInVault(fromPath, root)
    trashed = true
  }

  if (flags.has('--json')) {
    io.stdout(
      `${JSON.stringify(
        {
          page,
          index: insertedIndex,
          from: fromPath,
          ...(trashed ? { trashed: true } : {}),
          ...(title !== undefined ? { title } : {}),
        },
        null,
        2,
      )}\n`,
    )
  } else {
    io.stdout(`inlined ${fromPath} into ${page} (#${insertedIndex})${trashed ? ' (trashed original)' : ''}\n`)
  }
}

/** `board extract <page.md> [--index <n>] [--title <name>] [--to <dir>] [--json]` */
export async function boardExtract(args: readonly string[], flags: Map<string, string | true>, io: Io): Promise<void> {
  onlyFlags('board extract', flags, ['--index', '--title', '--to', '--json'])
  if (args[0] === undefined) throw new BoardUsageError('board extract needs a page')
  if (args.length > 1) throw new BoardUsageError(`unexpected argument: ${args[1]}`)
  const page = resolve(args[0])
  requireMarkdownFile(page)

  const indexRaw = str(flags, '--index')
  let requestedIndex: number | undefined
  if (indexRaw !== undefined) {
    if (!/^\d+$/.test(indexRaw)) throw new BoardUsageError('--index must be a non-negative integer')
    requestedIndex = Number(indexRaw)
  }
  const titleFlag = parseTitleFlag(flags, false, 'board extract')
  const toArg = str(flags, '--to')
  const toDir = toArg === undefined ? dirname(page) : resolve(toArg)
  const toStat = await stat(toDir).catch(() => null)
  if (toStat === null) throw new Error(`no folder ${toDir}`)
  if (!toStat.isDirectory()) throw new Error(`${toDir} is not a folder`)

  const file = await readFile(page)
  const blocks = findInlineDrawings(splitFrontmatter(withLf(file.content)).body)
  if (blocks.length === 0) throw new Error(`no inline drawings in ${page}`)
  let index: number
  if (requestedIndex === undefined) {
    if (blocks.length > 1) {
      throw new Error(`${page} has ${blocks.length} inline drawings; pass --index <0..${blocks.length - 1}>`)
    }
    index = 0
  } else {
    if (requestedIndex < 0 || requestedIndex >= blocks.length) {
      throw new Error(`inline drawing #${requestedIndex} not found in ${page} (valid: 0..${blocks.length - 1})`)
    }
    index = requestedIndex
  }

  const block = blocks[index]!
  const { scene, elements } = parseScene(block.json, page, 'IO_ERROR')
  const fileName =
    titleFlag !== undefined
      ? boardFileName(titleFlag, '.excalidraw')
      : `${safeBoardStem(drawingTitleOf(block.drawingLine) || 'Drawing')}.excalidraw`
  const boardPath = join(toDir, fileName)

  const pageVault = await vaultRootOf(dirname(page))
  let targetLink: string
  if (toDir === dirname(page)) {
    targetLink = basename(boardPath)
  } else if (pageVault !== null && boardPath.startsWith(pageVault + sep)) {
    targetLink = relative(pageVault, boardPath).split(sep).join('/')
  } else {
    targetLink = relative(dirname(page), boardPath).split(sep).join('/')
  }

  const now = Date.now()
  let stampedScene = stampBoardMetaScene(scene, { createdAt: now, updatedAt: now })
  if (referencedFileIds(elements).size > 0) {
    stampedScene = withPicturesOut(stampedScene, true, now, now)
  }
  const boardText = serializeBoard(stampedScene)

  // Write extracted board durably without ever overwriting an existing file.
  await fsCall(boardPath, () => createDurable(boardPath, boardText)).catch((err: unknown) => {
    if (err instanceof BridgeFailure && err.code === 'ALREADY_EXISTS') {
      throw new Error(`${boardPath} already exists`)
    }
    throw err
  })

  // Atomically update `<page.md>`; clean up the newly created board file if page update fails.
  try {
    await transformOnDisk(page, (fresh) => moveInlineDrawingOut(fresh, index, targetLink).page)
  } catch (err) {
    await unlink(boardPath).catch(() => undefined)
    throw err
  }

  if (flags.has('--json')) {
    io.stdout(`${JSON.stringify({ page, board: boardPath, index }, null, 2)}\n`)
  } else {
    io.stdout(`extracted #${index} from ${page} to ${boardPath}\n`)
  }
}

/** Dispatcher for `yaseendocs board <subcommand> ...`. */
export async function boardCommand(args: readonly string[], flags: Map<string, string | true>, io: Io): Promise<void> {
  const [sub, ...rest] = args
  switch (sub) {
    case 'new':
      return boardNew(rest, flags, io)
    case 'pictures':
      return boardPictures(rest, flags, io)
    case 'readonly':
      return boardReadOnly(rest, flags, io)
    case 'inline':
      return boardInline(rest, flags, io)
    case 'extract':
      return boardExtract(rest, flags, io)
    case undefined:
      throw new BoardUsageError('board needs new, pictures, readonly, inline or extract')
    default:
      throw new BoardUsageError(`unknown board command: ${sub}`)
  }
}
