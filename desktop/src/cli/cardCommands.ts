/**
 * Card lifecycle CLI handlers (YAZ-6156): `card edit`, `card archive`, `card extract`, and `card inline`.
 *
 * Plain Node — never imports `electron`, so it runs cleanly under `ELECTRON_RUN_AS_NODE=1` alongside `cli.ts`.
 * Every file edit goes through the same pure helpers (`@shared/cardLine`, `@shared/cardConvert`,
 * `@shared/cardFileFormat`) and compare-and-set disk writes (`main/fs/file`, `main/fs/create`, `main/fs/rename`)
 * that the app uses.
 */
import { lstat, stat, unlink } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { embedLine, keysLostOnPutBack, moveCardOut, putCardBack } from '@shared/cardConvert'
import { cardFileName, cardFileShape, isCardFileContent } from '@shared/cardFileFormat'
import {
  cardIdOf,
  cardTitleOf,
  changeCard,
  changeCardText,
  cleanCardTitle,
  isCardPropertyName,
  pageCards,
  withCardNoTitle,
  withCardOff,
  withCardProperty,
  withCardTitle,
  withoutCardProperty,
  type CardLine,
  type CardPropertyScalar,
  type CardPropertyValue,
} from '@shared/cardLine'
import { lineKinds } from '@shared/fences'
import { isSkipped } from '@shared/fileKind'
import { splitFrontmatter } from '@shared/frontmatter'
import { withLf } from '@shared/lineEnds'
import { canonicalPageId, isNumberId } from '@shared/pageId'
import { keyFold } from '@shared/propertyKeys'
import { isFolderSettingsPath, type IndexRecord } from '@shared/types'
import { createFile } from '../main/fs/create'
import { readFile, writeFile } from '../main/fs/file'
import { BridgeFailure, requireMarkdownFile } from '../main/fs/fsUtils'
import { renameFile, requireFreeTarget } from '../main/fs/rename'
import { idVault } from '../main/vaultIndex/mint'
import { scanAll } from '../main/vaultIndex/reconcile'
import { walk } from '../main/vaultIndex/scan'
import type { Io } from './cli'
import { onlyFlags as checkFlags, str, transformOnDisk, trashInVault } from './cliShared'

/** Usage error thrown by card subcommands (maps to CLI exit code 2). */
export class CardUsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CardUsageError'
  }
}

const byPath = (a: IndexRecord, b: IndexRecord): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)

const onlyFlags = (verb: string, flags: Map<string, string | true>, takes: readonly string[]): void =>
  checkFlags(verb, flags, takes, (msg) => new CardUsageError(msg))

async function bodyOf(flags: Map<string, string | true>, io: Io): Promise<string> {
  const body = flags.get('--body')
  if (typeof body !== 'string') throw new CardUsageError('--body is required')
  return body === '-' ? io.stdin() : body
}

/** The ID vault of `dir` (only vaults with IDs have cards), or a clear refusal. */
async function cardVault(dir: string, what: string): Promise<string> {
  const root = await idVault(dir)
  if (root === null) throw new Error(`${what}'s vault does not give its pages IDs, so it has no cards (turn on "Give this vault's pages IDs" in the app's Settings)`)
  return root
}

/** Parses repeatable `--prop <name>=<value>` flags (same rules as `card add` / `card new`). */
function parseCardProps(values: readonly string[] = []): Record<string, CardPropertyValue> {
  const out: Record<string, CardPropertyValue> = {}
  for (const raw of values) {
    const at = raw.indexOf('=')
    const name = at === -1 ? '' : raw.slice(0, at).trim()
    if (at === -1 || name === '') throw new CardUsageError(`--prop needs <name>=<value>, not ${raw}`)
    if (!isCardPropertyName(name)) throw new CardUsageError(`--prop: "${name}" is a word the card line uses; choose another name`)
    const text = raw.slice(at + 1)
    const value: CardPropertyScalar = text === 'true' || text === 'false' ? text === 'true' : /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text) ? Number(text) : text
    const held = Object.keys(out).find((k) => keyFold(k) === keyFold(name))
    if (held === undefined) out[name] = value
    else out[held] = [...(Array.isArray(out[held]) ? out[held] : [out[held]]), value]
  }
  return out
}

/** Finds the first record (in path order) holding card `id` in the vault of `from`. */
async function findCardInVault(id: string, from: string): Promise<{ root: string; record: IndexRecord }> {
  const root = await cardVault(from, from)
  const files: string[] = []
  await walk(root, files)
  const records = [...(await scanAll(root, files.filter((file) => !isFolderSettingsPath(file)))).values()].sort(byPath)
  const record = records.find((r) => r.cards?.some((card) => card.id === id))
  if (record === undefined) throw new Error(`no card ${id} in ${root}`)
  return { root, record }
}

/**
 * Finds the exact `inner` text of a lone embed `![[inner]]` on `body` that points to card `id` / `cardFilePath`.
 * Matches `id` (case-insensitive), basename with or without `.md`, or vault-relative path with or without `.md`,
 * and verifies with `embedLine` that it stands alone on its line outside code/card blocks.
 */
function findCardEmbedInner(body: string, id: string, cardFilePath: string, root: string): string | null {
  const base = basename(cardFilePath)
  const stem = base.replace(/\.(md|markdown)$/i, '')
  const rel = relative(root, cardFilePath).split(sep).join('/')
  const relStem = rel.replace(/\.(md|markdown)$/i, '')
  const candidates = [id, stem, relStem, base, rel]

  for (const candidate of candidates) {
    if (embedLine(body, candidate, 0) !== -1) return candidate
  }

  // Case-insensitive fallback (e.g. `![[yaz-10]]` or differently cased basename/path).
  const folded = new Set(candidates.map((c) => c.toLowerCase()))
  const lines = body.split('\n')
  const kinds = lineKinds(lines)
  for (let i = 0; i < lines.length; i++) {
    if (kinds[i] !== 'text') continue
    const m = /^!\[\[([^\]]+)\]\]$/.exec(lines[i].trim())
    if (m === null) continue
    const inner = m[1]
    const matchesId = isNumberId(inner) && canonicalPageId(inner) === id
    if ((matchesId || folded.has(inner.toLowerCase())) && embedLine(body, inner, 0) !== -1) return inner
  }
  return null
}

/**
 * `card edit <id> [<folder>] [--title <text>] [--body <text | ->] [--prop <name>=<value> ...]
 *   [--remove-prop <name> ...] [--hide-title | --show-title] [--json]`
 *
 * Atomically updates a card's title, body, properties, and/or title visibility.
 * If the card lives in a standalone card file and `--title` changed, renames the file
 * in the same folder to `cardFileName(newTitle, id)` (refusing if destination is taken).
 */
export async function cardEdit(
  ref: string,
  from: string,
  flags: Map<string, string | true>,
  io: Io,
  props: readonly string[] = [],
  removeProps: readonly string[] = [],
): Promise<void> {
  onlyFlags('card edit', flags, ['--title', '--body', '--prop', '--remove-prop', '--hide-title', '--show-title', '--json'])
  if (!isNumberId(ref)) throw new CardUsageError(`card edit needs a card id (WIKI-512), not ${ref}`)
  if (flags.has('--hide-title') && flags.has('--show-title')) throw new CardUsageError('card edit cannot take both --hide-title and --show-title')

  let newTitle: string | undefined
  if (flags.has('--title')) {
    const raw = flags.get('--title')
    if (typeof raw !== 'string') throw new CardUsageError('--title needs a text')
    const trimmed = raw.trim()
    if (trimmed === '' || /[\r\n]/.test(trimmed)) throw new CardUsageError('--title needs one line of text')
    newTitle = trimmed
  }

  let newBody: string | undefined
  if (flags.has('--body')) {
    const rawBody = (await bodyOf(flags, io)).replace(/\r\n/g, '\n').replace(/^\n+|\s+$/g, '')
    if (rawBody === '') throw new CardUsageError('card edit needs a --body with text')
    newBody = rawBody
  }

  const propValues = props.length > 0 ? props : typeof flags.get('--prop') === 'string' ? [flags.get('--prop') as string] : []
  const removeValues = removeProps.length > 0 ? removeProps : typeof flags.get('--remove-prop') === 'string' ? [flags.get('--remove-prop') as string] : []

  const properties = parseCardProps(propValues)
  const removeNames = removeValues.map((raw) => {
    const name = raw.trim()
    if (name === '') throw new CardUsageError('--remove-prop needs a property name')
    if (!isCardPropertyName(name)) throw new CardUsageError(`--remove-prop: "${name}" is a word the card line uses`)
    return name
  })

  const hasEdit =
    newTitle !== undefined ||
    newBody !== undefined ||
    Object.keys(properties).length > 0 ||
    removeNames.length > 0 ||
    flags.has('--hide-title') ||
    flags.has('--show-title')
  if (!hasEdit) {
    throw new CardUsageError('card edit needs at least one edit flag (--title, --body, --prop, --remove-prop, --hide-title, --show-title)')
  }

  const id = canonicalPageId(ref)
  const { record } = await findCardInVault(id, from)

  // Pre-check standalone card file rename target before mutating disk content so a collision leaves nothing modified.
  const initial = (await readFile(record.path)).content
  const isCardFile = isCardFileContent(initial)
  const initialCard = pageCards(initial).find((c) => cardIdOf(c.line) === id)
  const prevTitle = initialCard === undefined ? '' : cardTitleOf(initialCard.line)
  const targetPath =
    isCardFile && newTitle !== undefined && cleanCardTitle(newTitle) !== prevTitle
      ? join(dirname(record.path), cardFileName(newTitle, id))
      : record.path

  if (targetPath !== record.path) {
    try {
      await requireFreeTarget(await stat(record.path), targetPath, await lstat(record.path))
    } catch (err) {
      if (err instanceof BridgeFailure && err.code === 'ALREADY_EXISTS') throw new Error(`${targetPath} is already there`)
      throw err
    }
  }

  let finalTitle = prevTitle
  await transformOnDisk(record.path, (content) => {
    let next = changeCard(content, id, (line: CardLine) => {
      let updated = line
      if (newTitle !== undefined) updated = withCardTitle(updated, newTitle)
      for (const name of removeNames) updated = withoutCardProperty(updated, name)
      for (const [name, value] of Object.entries(properties)) updated = withCardProperty(updated, name, value)
      if (flags.has('--hide-title')) updated = withCardNoTitle(updated, true)
      if (flags.has('--show-title')) updated = withCardNoTitle(updated, false)
      finalTitle = cardTitleOf(updated)
      return updated
    })
    if (newBody !== undefined) next = changeCardText(next, id, newBody)
    return next
  })

  let finalPath = record.path
  let renamed = false
  if (targetPath !== record.path) {
    try {
      await renameFile({ oldPath: record.path, newPath: targetPath })
      finalPath = targetPath
      renamed = true
    } catch (err) {
      if (err instanceof BridgeFailure && err.code === 'ALREADY_EXISTS') throw new Error(`${targetPath} is already there`)
      throw err
    }
  }

  if (flags.has('--json')) {
    const out = { id, page: finalPath, ...(renamed ? { oldPath: record.path, renamed: true as const } : {}), title: finalTitle }
    io.stdout(`${JSON.stringify(out, null, 2)}\n`)
  } else {
    io.stdout(renamed ? `edited ${id} (renamed ${record.path} -> ${finalPath})\n` : `edited ${id} (${finalPath})\n`)
  }
}

/**
 * `card archive <id> [<folder>] [--unarchive] [--json]`
 *
 * Atomically toggles the card's `off` part via `withCardOff(line, !unarchive)`.
 */
export async function cardArchive(ref: string, from: string, flags: Map<string, string | true>, io: Io): Promise<void> {
  onlyFlags('card archive', flags, ['--unarchive', '--json'])
  if (!isNumberId(ref)) throw new CardUsageError(`card archive needs a card id (WIKI-512), not ${ref}`)
  const id = canonicalPageId(ref)
  const { record } = await findCardInVault(id, from)
  const archived = !flags.has('--unarchive')
  await transformOnDisk(record.path, (content) => changeCard(content, id, (line) => withCardOff(line, archived)))
  io.stdout(flags.has('--json') ? `${JSON.stringify({ id, page: record.path, archived }, null, 2)}\n` : `${id} ${archived ? 'archived' : 'unarchived'} (${record.path})\n`)
}

/**
 * `card extract <id> [<folder>] [--to <dir>] [--json]`
 *
 * Moves an inline card out of its page into a standalone card file (`moveCardOut`),
 * replacing the block on the page with `![[ID]]` at the exact indent.
 */
export async function cardExtract(ref: string, from: string, flags: Map<string, string | true>, io: Io): Promise<void> {
  onlyFlags('card extract', flags, ['--to', '--json'])
  if (!isNumberId(ref)) throw new CardUsageError(`card extract needs a card id (WIKI-512), not ${ref}`)
  const id = canonicalPageId(ref)
  const { root, record } = await findCardInVault(id, from)

  const initial = (await readFile(record.path)).content
  if (isCardFileContent(initial)) throw new Error(`${id} is already a standalone card file (${record.path})`)

  const toFlag = str(flags, '--to')
  if (flags.has('--to') && (toFlag === undefined || toFlag.trim() === '')) throw new CardUsageError('--to needs a folder')
  const toDir = toFlag !== undefined ? resolve(toFlag) : dirname(record.path)

  const dirStat = await stat(toDir).catch(() => null)
  if (dirStat === null) throw new Error(`no folder ${toDir}`)
  if (!dirStat.isDirectory()) throw new Error(`${toDir} is not a folder`)
  const rel = relative(root, toDir)
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`${toDir} is outside the vault ${root}`)
  if (rel.split(sep).some((name) => name !== '' && isSkipped(name))) throw new Error(`${toDir} is not a folder the vault shows`)

  const { card } = moveCardOut(initial, id)
  const cardPath = join(toDir, card.name)
  await createFile({ path: cardPath, content: card.content }, null).catch((err: unknown) => {
    throw err instanceof BridgeFailure && err.code === 'ALREADY_EXISTS' ? new Error(`${cardPath} is already there`) : err
  })

  try {
    await transformOnDisk(record.path, (fresh) => {
      if (isCardFileContent(fresh)) throw new Error(`${id} is already a standalone card file (${record.path})`)
      return moveCardOut(fresh, id).page
    })
  } catch (err) {
    await unlink(cardPath).catch(() => undefined)
    throw err
  }

  io.stdout(flags.has('--json') ? `${JSON.stringify({ id, page: record.path, card: cardPath, title: card.title }, null, 2)}\n` : `extracted ${id} to ${cardPath}\n`)
}

/**
 * `card inline <id> <page.md> [--force] [--json]`
 *
 * Pulls a standalone card file back into `pagePath` at its lone embed `![[...]]` (`putCardBack`),
 * preserving indent and migrating `comments:`, then moves the old card file to `<vault>/.trash/`.
 * Refuses if frontmatter keys would be lost (`keysLostOnPutBack`) unless `--force` is passed.
 */
export async function cardInline(ref: string, pagePath: string, flags: Map<string, string | true>, io: Io): Promise<void> {
  onlyFlags('card inline', flags, ['--force', '--json'])
  if (!isNumberId(ref)) throw new CardUsageError(`card inline needs a card id (WIKI-512), not ${ref}`)
  const page = resolve(pagePath)
  requireMarkdownFile(page)

  const id = canonicalPageId(ref)
  const { root, record } = await findCardInVault(id, dirname(page))
  if (record.path === page) throw new Error(`cannot inline ${id} into its own card file (${page})`)

  const cardFile = (await readFile(record.path)).content
  if (!isCardFileContent(cardFile)) throw new Error(`${id} is not a standalone card file (${record.path})`)
  if (cardFileShape(splitFrontmatter(cardFile).body).problem !== 'ok') {
    throw new Error(`${record.path} holds more than this card; fix it before inlining`)
  }

  const lost = keysLostOnPutBack(cardFile)
  if (lost.length > 0 && !flags.has('--force')) {
    throw new Error(`inlining ${id} would lose frontmatter keys: ${lost.join(', ')} (pass --force to inline anyway)`)
  }

  const originalPage = await readFile(page)
  const initialInner = findCardEmbedInner(splitFrontmatter(withLf(originalPage.content)).body, id, record.path, root)
  if (initialInner === null) throw new Error(`no lone embed for ${id} found on ${page}`)

  await transformOnDisk(page, (fresh) => {
    const inner = findCardEmbedInner(splitFrontmatter(withLf(fresh)).body, id, record.path, root)
    if (inner === null) throw new Error(`no lone embed for ${id} found on ${page}`)
    return putCardBack(fresh, inner, 0, cardFile, id)
  })

  try {
    await trashInVault(record.path, root)
  } catch (err) {
    // Restore original page bytes if trashing the card file fails.
    const written = await readFile(page).catch(() => null)
    if (written !== null) await writeFile({ path: page, content: originalPage.content, expectedMtime: written.mtime }).catch(() => undefined)
    throw err
  }

  io.stdout(flags.has('--json') ? `${JSON.stringify({ id, page, trashed: record.path }, null, 2)}\n` : `inlined ${id} into ${page} (trashed ${record.path})\n`)
}
