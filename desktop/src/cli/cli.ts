/**
 * `yaseendocs` (YAZ-1617 🔒 D1, D4, D5): the door an agent uses to work with a page from the
 * shell — its comments, and its id and the ids it points at (YAZ-2293). Plain Node — this module
 * and its entry never import `electron`; the packaged shim runs it under `ELECTRON_RUN_AS_NODE=1`
 * with the app's own binary (VS Code's `code` pattern).
 *
 * It writes through the SAME `shared/comments.ts` the block uses, guarded the same way as the
 * renderer's `transformFile` (YAZ-1472 🔒 D8): fresh bytes, `expectedMtime`, one retry on
 * CONFLICT. `readFile` / `writeFile` from `main/fs/file` are Electron-free and already do the
 * atomic tmp+rename and the mtime check, so nothing is reimplemented here.
 *
 * `HELP` IS the contract: it is the only documentation an agent reads (the Copy for Agent
 * handshake points at `--help` and names no verb), so its wording is UI copy.
 */
import { readFile as readRaw, stat } from 'node:fs/promises'
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
import { parseFrontmatter, splitFrontmatter } from '@shared/frontmatter'
import { NOTE_ID_KEY, isNoteId } from '@shared/noteId'
import { DEFAULT_REVIEW_SETTINGS, REVIEW_SETTINGS_FILE, sanitizeReviewSettings, type ReviewSettings } from '@shared/reviews'
import { dueAt, isInReview, reviewQueue } from '@shared/schedule'
import { VAULT_CONFIG_DIR, isFolderSettingsPath } from '@shared/types'
import { BridgeFailure, fsCall, requireMarkdownFile } from '../main/fs/fsUtils'
import { readFile, writeFile } from '../main/fs/file'
import { giveId, isAdopted } from '../main/vaultIndex/idSweep'
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
  yaseendocs --help`

export const HELP = `yaseendocs — a Yaseen Docs page's comments, its id and the ids it points at, and when it is next due for review, from the shell.

${USAGE}

A comment lives in the page's frontmatter under \`comments:\` — never in the body — and this
command writes it exactly as the app does (id, number, time stamp, order). \`--body -\` reads
the text from stdin, so a long or multi-line comment needs no shell quoting. \`comments\` prints
every thread (\`--json\` for the raw shape). Name a comment by its number as the app shows it —
#3, or #3.1 for a reply — or by its id; a reply to #3 shows as #3.1.

Who wrote it: \`comment\` records \`by: agent\` unless --by says otherwise; a person's comment,
left in the app, has no \`by\`. \`edit\` and \`delete\` work only on comments that carry a \`by\` —
a person's comment is edited or deleted in the app. Deleting a comment deletes its replies.

Every page has a permanent id in its frontmatter (\`id: k3m9x2pq7abc\`); a rename or a move never
changes it. A link between pages is written \`[[<id>]]\`, and the app shows the page's current
title in its place. \`id\` prints a page's id — a page that has none is given one first, exactly
as the app would, and only inside a vault (a folder holding \`.yaseendocs/\`). \`links\` lists
every id on a page — its links, and the folders it is also in — with the page or folder that id
names now, or \`(missing)\` (\`--json\` for the raw shape). To find a page from an id, search the
vault for \`id: <id>\`.

\`due\` prints the day a page is next up for review. The app works that date out from the page's
\`reviews:\` log, when the page last changed and the vault's settings, and never writes it into the
file, so this is the place to read it. Given a folder, \`due\` lists the pages due now under it,
most overdue first (\`--json\` for the raw shape of either).

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
  let file: { content: string; mtime: number } = await readFile(path).catch((err: unknown) => {
    if (!create || !(err instanceof BridgeFailure) || err.code !== 'NOT_FOUND') throw err
    return { content: '', mtime: 0 }
  })
  let retried = false
  for (;;) {
    const content = transform(file.content)
    if (content === file.content) return content
    try {
      await writeFile({ path, content, expectedMtime: file.mtime })
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

/** The vault a folder is in: the nearest folder at or above it that the app has adopted (it holds `.yaseendocs/`); null when there is none. */
async function vaultRoot(from: string): Promise<string | null> {
  for (let dir = from; ; dir = dirname(dir)) {
    if (await isAdopted(dir)) return dir
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
    io.stdout(json ? `${JSON.stringify({ path: target, inReview: at !== null, due: at === null ? null : iso(at) }, null, 2)}\n` : at === null ? `${target} is not in review\n` : `${day(at)}  ${target}\n`)
    return
  }
  const settings = await reviewSettings(target)
  const files: string[] = []
  await walk(target, files)
  const notes = files.filter((file) => !isFolderSettingsPath(file))
  const queue = reviewQueue([...(await scanAll(target, notes)).values()], settings, Date.now()).map((r) => ({ path: r.path, due: dueAt(r, settings) }))
  if (json) io.stdout(`${JSON.stringify(queue.map((q) => ({ ...q, due: iso(q.due) })), null, 2)}\n`)
  else io.stdout(queue.length === 0 ? `nothing is due under ${target}\n` : queue.map((q) => `${day(q.due)}  ${q.path}\n`).join(''))
}

async function run(argv: readonly string[], io: Io): Promise<void> {
  const { verb, args, flags } = parse(argv)
  if (verb === '' || verb === 'help' || flags.has('--help') || flags.has('-h')) {
    io.stdout(HELP)
    return
  }
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
      const comments = readComments((await readFile(page)).content)
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
      const { properties, error } = parseFrontmatter(splitFrontmatter((await readFile(page)).content).frontmatter)
      let id = properties[NOTE_ID_KEY]
      if (!isNoteId(id)) {
        // The sweep's own refusals (`vaultIndex/idSweep.ts`), each given its reason; `giveId` checks them again on the bytes it writes against.
        if (error !== undefined) throw new Error('the properties block does not parse (invalid)')
        if (id !== undefined) throw new Error(`the ${NOTE_ID_KEY} property is not a page id (foreign)`)
        const root = await vaultRoot(dirname(page))
        if (root === null) throw new Error(`${page} has no id and is in no vault (no ${VAULT_CONFIG_DIR} folder above it)`)
        id = await giveId(root, page, undefined)
        if (id === undefined) throw new Error(`${page} changed while it was being given an id — run this again`)
      }
      io.stdout(`${id}\n`)
      return
    }
    case 'links': {
      const root = await vaultRoot(dirname(page))
      if (root === null) throw new Error(`${page} is in no vault (no ${VAULT_CONFIG_DIR} folder above it)`)
      const { links, properties } = await scanFile(root, page)
      const linked = links.filter(isNoteId)
      const ids = [...new Set([...linked, ...alsoIn(properties)])]
      // The vault as the app's index sees it (the same walk, the same scan). In path order, so of two pages sharing an id — a copy the sweep has not met — the one named is the sweep's first choice too.
      const files: string[] = []
      if (ids.length > 0) await walk(root, files)
      const records = [...(await scanAll(root, files)).values()].sort((a, b) => (a.path < b.path ? -1 : 1))
      const rows = ids.map((id): { id: string; kind: 'note' | 'folder' | 'missing'; path?: string } => {
        const r = records.find((o) => o.id === id)
        if (r === undefined) return { id, kind: 'missing' }
        // A folder's id is carried by its `.folder.md`; what it names is the folder.
        if (isFolderSettingsPath(r.path)) return { id, kind: 'folder', path: r.folder }
        return { id, kind: 'note', path: r.folder === '' ? r.name : `${r.folder}/${r.name}` }
      })
      const line = (r: (typeof rows)[number]) =>
        `${r.id}  ${r.kind === 'missing' ? '(missing)' : r.kind === 'note' ? r.path : `${r.path}/${linked.includes(r.id) ? '' : '  (also in)'}`}`
      io.stdout(flags.has('--json') ? `${JSON.stringify(rows, null, 2)}\n` : rows.length === 0 ? `no ids on ${page}\n` : `${rows.map(line).join('\n')}\n`)
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
