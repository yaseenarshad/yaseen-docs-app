/**
 * `yaseendocs` (YAZ-1617 🔒 D1, D4, D5): the door an agent uses to work with a page from the
 * shell — its comments, and its id and the ids it points at (YAZ-2293) — and to read the app's
 * list of vaults (YAZ-2556 🔒 D2). Plain Node — this module and its entry never import
 * `electron`; the packaged shim runs it under `ELECTRON_RUN_AS_NODE=1` with the app's own binary
 * (VS Code's `code` pattern).
 *
 * It writes through the SAME `shared/comments.ts` the block uses, guarded the same way as the
 * renderer's `transformFile` (YAZ-1472 🔒 D8): fresh bytes, `expectedMtime`, one retry on
 * CONFLICT. `readFile` / `writeFile` from `main/fs/file` are Electron-free and already do the
 * atomic tmp+rename and the mtime check, so nothing is reimplemented here.
 *
 * `HELP` IS the contract: it is the only documentation an agent reads, so its wording is UI copy.
 */
import { readFile as readRaw, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import {
  addComment,
  deleteComment,
  editComment,
  newCommentId,
  nowIso,
  readComments,
  threadsOf,
  type PageComment,
} from '@shared/comments'
import { alsoIn } from '@shared/alsoIn'
import { folderBlocks } from '@shared/folderValues'
import { parseFrontmatter, splitFrontmatter } from '@shared/frontmatter'
import { NOTE_ID_KEY, isNoteId } from '@shared/noteId'
import { DEFAULT_REVIEW_SETTINGS, REVIEW_SETTINGS_FILE, sanitizeReviewSettings, type ReviewSettings } from '@shared/reviews'
import { dueAt, isInReview, reviewQueue } from '@shared/schedule'
import { VAULT_CONFIG_DIR, defaultAppState, isFolderSettingsPath, listVaults } from '@shared/types'
import { BridgeFailure, fsCall, requireMarkdownFile } from '../main/fs/fsUtils'
import { readFile, writeFile } from '../main/fs/file'
import { parseState } from '../main/store'
import { STATE_FILE, userDataDir } from '../main/userData'
import { giveId, idsOf, readPage } from '../main/vaultIndex/idSweep'
import { scanAll } from '../main/vaultIndex/reconcile'
import { scanFile, walk } from '../main/vaultIndex/scan'

export interface Io {
  /** The whole of stdin, for `--body -`. */
  stdin(): Promise<string>
  stdout(text: string): void
  stderr(text: string): void
}

export const USAGE = `usage:
  yaseendocs comment  <page.md> --body <text | -> [--title <one line>] [--reply-to <comment>] [--by <name>]
  yaseendocs comments <page.md> [--json]
  yaseendocs edit     <page.md> <comment> --body <text | -> [--title <one line>]
  yaseendocs delete   <page.md> <comment>
  yaseendocs id       <page.md>
  yaseendocs links    <page.md> [--json]
  yaseendocs due      <page.md | folder> [--json]
  yaseendocs vaults   [--json]
  yaseendocs --help`

export const HELP = `yaseendocs — a Yaseen Docs page's comments, its id and the ids it points at, when it is next due for review, and the app's list of vaults, from the shell.

${USAGE}

A comment lives in the page's frontmatter under \`comments:\` — never in the body — and this
command writes it exactly as the app does (id, number, time stamp, order). \`--body -\` reads
the text from stdin, so a long or multi-line comment needs no shell quoting. \`comments\` prints
every thread (\`--json\` for the raw shape). Name a comment by its number as the app shows it —
#3, or #3.1 for a reply — or by its id; a reply to #3 shows as #3.1.

Who wrote it: \`comment\` records \`by: agent\` unless --by says otherwise; a person's comment,
left in the app, has no \`by\`. \`edit\` and \`delete\` work only on comments that carry a \`by\` —
a person's comment is edited or deleted in the app. Deleting a comment deletes its replies.

A vault gives its notes IDs only when "Give this vault's notes IDs" is on in the app's Settings
(\`.yaseendocs/ids.json\`). In a vault that does not, a page's name is its file name, and \`id\`
and \`links\` are refused. The next two paragraphs describe a vault that does.

Every page has a permanent id in its frontmatter (\`id: k3m9x2pq7abc\`); a rename or a move never
changes it. A page's title is its \`title:\` line, and the app builds the file name from the title
and the id (\`<kebab-title>-<id>.md\`). A link between pages is written \`[[<id>]]\`, and the app
shows the page's current title in its place. \`id\` prints a page's id — a page that has none, or
an \`id\` some other tool wrote, is given one first, exactly as the app would, and only inside a
vault that gives its notes IDs. \`links\` lists every id on a page — its links, and the
folders it is also in — with the title and path of the page or folder that id names now, or
\`(missing)\` (\`--json\` for the raw shape). To find a page from an id, search the vault's file
names for it; a file the app did not name is found by its \`id: <id>\` line.

A folder's values for a page (its columns) are in the page's frontmatter under \`in:\`, in the block
named by the folder's id, and a folder's id is the \`id\` in \`<folder>/.folder.md\`. \`links\` lists
those folders after the links, each by id and the title and path of the folder it names now.

\`due\` prints the day a page is next up for review. The app works that date out from the page's
\`reviews:\` log, when the page last changed and the vault's settings, and never writes it into the
file, so this is the place to read it. Given a folder, \`due\` lists the pages due now under it,
each by title and path, most overdue first (\`--json\` for the raw shape of either). Nothing is due
in a vault until upkeep is turned on for it, in the app's Settings.

\`vaults\` lists the vaults the app knows, in the order of the app's own list (⌘O): the recent
ones, last used first, then each other vault that is open or has a number. A line is the vault's
name and its folder, then \`⌘<n>\` when it has number n, then \`(open)\` when a window is on it.
\`--json\` gives each vault as \`path\`, \`name\` (the display name set in the app, else the
folder's name), \`key\` (the number, or null), \`open\` and \`lastUsed\` (a time in milliseconds,
or null for a vault that is not a recent one). It reads the app's state file and never writes it,
and it does not talk to the app: with the app closed, \`open\` marks the windows the app opens
again when it starts.

Exit codes: 0 done · 1 refused or failed (the reason is on stderr) · 2 usage.

Example:
  yaseendocs comment "/vault/Weekly review.md" --title "Numbers check" --body "The Q3 figure is off by one row."
  → #3 added to /vault/Weekly review.md
`

/** Every flag the contract names; anything else is refused, because `--help` IS the contract (🔒 D1) and a typo must not be absorbed. */
const FLAGS = new Set(['--body', '--title', '--reply-to', '--by'])
/** Flags that take no value. */
const SWITCHES = new Set(['--json', '--help', '-h'])

class Usage extends Error {}

function parse(argv: readonly string[]): { verb: string; args: string[]; flags: Map<string, string | true> } {
  const args: string[] = []
  const flags = new Map<string, string | true>()
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('-') || a === '-') args.push(a)
    else if (SWITCHES.has(a)) flags.set(a, true)
    else if (!FLAGS.has(a)) throw new Usage(`unknown flag: ${a}`)
    else if (i + 1 < argv.length) flags.set(a, argv[++i])
    else throw new Usage(`${a} needs a value`)
  }
  const [verb = '', ...rest] = args
  return { verb, args: rest, flags }
}

/**
 * The renderer's `transformFile` on disk: read, transform, write against the mtime just read;
 * on CONFLICT read again and recompute ONCE. A second conflict throws. A no-op transform
 * writes nothing and returns the bytes as read. `create`: a file that is not there yet reads as
 * empty and the write creates it — a folder's settings file the app has not written yet (YAZ-2290 D1).
 */
export async function transformOnDisk(path: string, transform: (content: string) => string, create = false): Promise<string> {
  let file: { content: string; mtime?: number } = await (create ? readPage : readFile)(path)
  let retried = false
  for (;;) {
    const content = transform(file.content)
    if (content === file.content) return content
    try {
      await writeFile({ path, content, expectedMtime: file.mtime ?? 0 })
      return content
    } catch (err) {
      if (!(err instanceof BridgeFailure) || err.code !== 'CONFLICT' || retried) throw err
      retried = true
      file = await readFile(path)
    }
  }
}

/** `#3` for a top-level comment, `#3.1` for a reply; the id when a hand-written entry has no number. */
export function label(comments: readonly PageComment[], c: PageComment): string {
  if (c.n === undefined) return c.id
  const parent = c.reply_to === undefined ? undefined : comments.find((p) => p.id === c.reply_to)
  return parent?.n === undefined ? `#${c.n}` : `#${parent.n}.${c.n}`
}

const firstLine = (c: PageComment): string => c.title ?? c.body.split('\n', 1)[0]

/**
 * The comment `ref` names: its id, or its number the way the app and the receipts show it —
 * `#3` / `3` (top level), `#3.1` / `3.1` (reply 1 of #3). An id wins when both could match. Found
 * by the SAME `label` the listing prints, so what an agent reads is what it can type.
 */
export function find(comments: readonly PageComment[], ref: string): PageComment | undefined {
  const byId = comments.find((c) => c.id === ref)
  if (byId !== undefined) return byId
  const number = /^#?(\d+(?:\.\d+)?)$/.exec(ref)?.[1]
  return number === undefined ? undefined : comments.find((c) => label(comments, c) === `#${number}`)
}

/** One line per comment: label, stamp, writer, then the title or first line. Replies indented under their parent. */
function listing(comments: readonly PageComment[]): string {
  const line = (c: PageComment, indent: string) => `${indent}${label(comments, c)}  ${c.id}  ${c.at}  ${c.by === undefined ? '' : `(${c.by})  `}${firstLine(c)}`
  return threadsOf(comments)
    .flatMap(({ comment, replies }) => [line(comment, ''), ...replies.map((r) => line(r, '  '))])
    .join('\n')
}

/** A comment the caller may edit or delete: `ref` names one (id or number) and it carries a `by` (🔒 D4). Returns the parse it did, so callers label without parsing again. */
function agentOwned(content: string, ref: string, page: string): { comments: PageComment[]; target: PageComment } {
  const comments = readComments(content)
  const target = find(comments, ref)
  if (target === undefined) throw new Error(`no comment ${ref} on ${page}`)
  if (target.by === undefined || target.by.trim() === '') {
    throw new Error(`${label(comments, target)} was left by a person — edit or delete it in the app`)
  }
  return { comments, target }
}

/** The vault a folder is in: the nearest folder at or above it that holds `.yaseendocs/`; null when there is none. */
async function vaultRoot(from: string): Promise<string | null> {
  for (let dir = from; ; dir = dirname(dir)) {
    if ((await stat(join(dir, VAULT_CONFIG_DIR)).catch(() => null))?.isDirectory()) return dir
    if (dir === dirname(dir)) return null
  }
}

/**
 * The vault whose IDs a page is in (YAZ-2523 🔒 V10): the nearest folder at or above it that has
 * ANSWERED, when that answer is yes. A folder that only holds app settings is not asked. Null
 * when the nearest answer is no, or nothing above has answered: "no" means no for agents too.
 */
async function idVault(from: string): Promise<string | null> {
  for (let dir = from; ; dir = dirname(dir)) {
    const answer = await idsOf(dir)
    if (answer !== undefined) return answer ? dir : null
    if (dir === dirname(dir)) return null
  }
}

async function bodyOf(flags: Map<string, string | true>, io: Io): Promise<string> {
  const body = flags.get('--body')
  if (typeof body !== 'string') throw new Usage('--body is required')
  return body === '-' ? io.stdin() : body
}

const str = (flags: Map<string, string | true>, name: string): string | undefined => {
  const v = flags.get(name)
  return typeof v === 'string' ? v : undefined
}

/** The review settings of the vault `dir` is in, or the defaults when it is in none. */
async function reviewSettings(dir: string): Promise<ReviewSettings> {
  const root = await vaultRoot(dir)
  if (root === null) return DEFAULT_REVIEW_SETTINGS
  return sanitizeReviewSettings(await readRaw(join(root, VAULT_CONFIG_DIR, REVIEW_SETTINGS_FILE), 'utf8').then(JSON.parse).catch(() => null))
}

/**
 * `due` (YAZ-2322 🔒 D2): a page's next review day, or the pages due now under a folder. The date
 * is computed by the same `shared/schedule.ts` the app uses, from the same scan, so the two agree.
 */
async function due(target: string, json: boolean, io: Io): Promise<void> {
  const day = (ms: number): string => new Date(ms).toLocaleDateString('en-CA') // the LOCAL day, as YYYY-MM-DD
  const iso = (ms: number): string => new Date(ms).toISOString()
  if (!(await fsCall(target, () => stat(target))).isDirectory()) {
    requireMarkdownFile(target)
    const settings = await reviewSettings(dirname(target))
    const record = await scanFile(dirname(target), target)
    const at = isInReview(record, settings) ? dueAt(record, settings) : null
    const page = `${record.title}  ${target}`
    io.stdout(json ? `${JSON.stringify({ title: record.title, path: target, inReview: at !== null, due: at === null ? null : iso(at) }, null, 2)}\n` : at === null ? `${page} is not in review\n` : `${day(at)}  ${page}\n`)
    return
  }
  const settings = await reviewSettings(target)
  const files: string[] = []
  await walk(target, files)
  const notes = files.filter((file) => !isFolderSettingsPath(file))
  const queue = reviewQueue([...(await scanAll(target, notes)).values()], settings, Date.now()).map((r) => ({ title: r.title, path: r.path, due: dueAt(r, settings) }))
  if (json) io.stdout(`${JSON.stringify(queue.map((q) => ({ ...q, due: iso(q.due) })), null, 2)}\n`)
  else io.stdout(queue.length === 0 ? `nothing is due under ${target}\n` : queue.map((q) => `${day(q.due)}  ${q.title}  ${q.path}\n`).join(''))
}

/**
 * `vaults` (YAZ-2556 🔒 D2): the vaults the app knows, the rows and the order of its ⌘O list — the
 * same `listVaults`, over the app's state file as the store itself reads it (`parseState`). It
 * only READS: no file yet is no vaults, and a damaged one is refused and left for the app to move aside.
 */
async function vaults(json: boolean, io: Io): Promise<void> {
  const file = join(userDataDir(process.env, process.platform, homedir()), STATE_FILE)
  const text = await readRaw(file, 'utf8').catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') return null
    throw err
  })
  const state = text === null ? defaultAppState() : parseState(text)
  if (state === null) throw new Error(`${file} is not a valid app state`)
  const rows = listVaults(state)
  if (json) io.stdout(`${JSON.stringify(rows, null, 2)}\n`)
  else io.stdout(rows.length === 0 ? 'no vaults\n' : rows.map((v) => `${v.name}  ${v.path}${v.key === null ? '' : `  ⌘${v.key}`}${v.open ? '  (open)' : ''}\n`).join(''))
}

async function run(argv: readonly string[], io: Io): Promise<void> {
  const { verb, args, flags } = parse(argv)
  if (verb === '' || verb === 'help' || flags.has('--help') || flags.has('-h')) {
    io.stdout(HELP)
    return
  }
  if (verb === 'vaults') return vaults(flags.has('--json'), io)
  if (verb === 'due') {
    if (args[0] === undefined) throw new Usage('due needs a page or a folder')
    return due(resolve(args[0]), flags.has('--json'), io)
  }
  const page = args[0] === undefined ? undefined : resolve(args[0])
  if (page === undefined) throw new Usage(`${verb} needs a page`)
  requireMarkdownFile(page) // a page is Markdown; every verb refuses anything else before any I/O

  switch (verb) {
    case 'comment': {
      const body = await bodyOf(flags, io)
      const id = newCommentId()
      const replyRef = str(flags, '--reply-to')
      const content = await transformOnDisk(page, (fresh) => {
        // The model keeps an unknown `reply_to` as given (the UI never passes one); the command REFUSES it, so a typo cannot orphan a reply.
        const parent = replyRef === undefined ? undefined : find(readComments(fresh), replyRef)
        if (replyRef !== undefined && parent === undefined) throw new Error(`no comment ${replyRef} on ${page}`)
        return addComment(fresh, body, { id, at: nowIso(), replyTo: parent?.id, title: str(flags, '--title'), by: str(flags, '--by')?.trim() || 'agent' })
      }, isFolderSettingsPath(page))
      const comments = readComments(content)
      const added = comments.find((c) => c.id === id)
      io.stdout(`${added === undefined ? id : label(comments, added)} added to ${page}\n`)
      return
    }
    case 'comments': {
      const comments = readComments((await readPage(page)).content)
      io.stdout(flags.has('--json') ? `${JSON.stringify(threadsOf(comments), null, 2)}\n` : comments.length === 0 ? `no comments on ${page}\n` : `${listing(comments)}\n`)
      return
    }
    case 'edit': {
      const ref = args[1]
      if (ref === undefined) throw new Usage('edit needs a comment (#3, #3.1, or its id)')
      const body = await bodyOf(flags, io)
      let name = ref
      await transformOnDisk(page, (fresh) => {
        const { comments, target } = agentOwned(fresh, ref, page)
        name = label(comments, target)
        return editComment(fresh, target.id, body, nowIso(), str(flags, '--title') ?? target.title ?? '')
      })
      io.stdout(`${name} edited\n`)
      return
    }
    case 'delete': {
      const ref = args[1]
      if (ref === undefined) throw new Usage('delete needs a comment (#3, #3.1, or its id)')
      let receipt = ref
      await transformOnDisk(page, (fresh) => {
        const { comments, target } = agentOwned(fresh, ref, page)
        const replies = comments.filter((c) => c.reply_to === target.id).length
        receipt = `${label(comments, target)} deleted${replies === 0 ? '' : ` (and ${replies} ${replies === 1 ? 'reply' : 'replies'})`}`
        return deleteComment(fresh, target.id)
      })
      io.stdout(`${receipt}\n`)
      return
    }
    case 'id': {
      const root = await idVault(dirname(page))
      if (root === null) throw new Error(`${page}'s vault does not give its notes IDs (turn on "Give this vault's notes IDs" in the app's Settings)`)
      const { properties, error } = parseFrontmatter(splitFrontmatter((await readPage(page)).content).frontmatter)
      let id = properties[NOTE_ID_KEY]
      if (!isNoteId(id)) {
        // The sweep's own refusals (`vaultIndex/idSweep.ts`), each given its reason; `giveId` checks them again on the bytes it writes against.
        if (error !== undefined) throw new Error('the properties block does not parse (invalid)')
        id = await giveId(root, page, undefined)
        if (id === undefined) throw new Error(`${page} changed while it was being given an id — run this again`)
      }
      io.stdout(`${id}\n`)
      return
    }
    case 'links': {
      const root = await idVault(dirname(page))
      if (root === null) throw new Error(`${page}'s vault does not use IDs, so there are no ID links to list`)
      const { links, properties } = await scanFile(root, page)
      const linked = links.filter(isNoteId)
      const ids = [...new Set([...linked, ...alsoIn(properties)])]
      const held = folderBlocks(properties).map(([id]) => id)
      // The vault as the app's index sees it (the same walk, the same scan). In path order, so of two pages sharing an id — a copy the sweep has not met — the one named is the sweep's first choice too.
      const files: string[] = []
      if (ids.length > 0 || held.length > 0) await walk(root, files)
      const records = [...(await scanAll(root, files)).values()].sort((a, b) => (a.path < b.path ? -1 : 1))
      // Each id with the title (YAZ-2420 🔒 D14) and the real path of what it names now.
      const rows = ids.map((id): { id: string; kind: 'note' | 'folder' | 'missing'; title?: string; path?: string } => {
        const r = records.find((o) => o.id === id)
        if (r === undefined) return { id, kind: 'missing' }
        // A folder's id is carried by its `.folder.md`; what it names is the folder.
        if (isFolderSettingsPath(r.path)) return { id, kind: 'folder', title: r.title, path: r.folder }
        return { id, kind: 'note', title: r.title, path: r.folder === '' ? r.name : `${r.folder}/${r.name}` }
      })
      const line = (r: (typeof rows)[number]) =>
        `${r.id}  ${r.kind === 'missing' ? '(missing)' : `${r.title}  ${r.kind === 'note' ? r.path : `${r.path}/${linked.includes(r.id) ? '' : '  (also in)'}`}`}`
      // The folders the page holds values for (`in`, D19), apart from its links: a block whose id no folder has is its id alone.
      const blocks = held.map((id): { id: string; title?: string; path?: string } => {
        const folder = records.find((o) => o.id === id && isFolderSettingsPath(o.path))
        return folder === undefined ? { id } : { id, title: folder.title, path: folder.folder }
      })
      const listed = rows.length === 0 ? `no ids on ${page}\n` : `${rows.map(line).join('\n')}\n`
      const values = blocks.length === 0 ? '' : `\nin:\n${blocks.map((b) => (b.path === undefined ? b.id : `${b.id}  ${b.title}  ${b.path}/`)).join('\n')}\n`
      io.stdout(flags.has('--json') ? `${JSON.stringify({ links: rows, in: blocks }, null, 2)}\n` : listed + values)
      return
    }
    default:
      throw new Usage(`unknown command: ${verb}`)
  }
}

/** The program: resolves to the exit code (0 done · 1 refused or failed · 2 usage). */
export async function main(argv: readonly string[], io: Io): Promise<number> {
  try {
    await run(argv, io)
    return 0
  } catch (err) {
    if (err instanceof Usage) {
      io.stderr(`${err.message}\n${USAGE}\n`)
      return 2
    }
    io.stderr(`${err instanceof Error ? err.message : String(err)}\n`)
    return 1
  }
}
