/**
 * `yaseendocs` (YAZ-1617 🔒 D1, D4, D5): the door an agent uses to work with a page from the
 * shell — its comments, and its id and the ids it points at (YAZ-2293) — to read the app's
 * list of vaults (YAZ-2556 🔒 D2), and to make a page or find the day's daily page by the app's own
 * rules (YAZ-4269: `main/pages/`). Plain Node — this module and its entry never import
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
import { execFile } from 'node:child_process'
import { statSync } from 'node:fs'
import { readFile as readRaw, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import {
  addComment,
  deleteComment,
  editComment,
  newCommentId,
  nowIso,
  ownedBy,
  readComments,
  setResolved,
  threadsOf,
  type PageComment,
} from '@shared/comments'
import { alsoIn } from '@shared/alsoIn'
import { dailyPageName } from '@shared/dailyPage'
import { fileLink } from '@shared/links'
import type { FoundPage } from '@shared/pageBirth'
import { newestFile } from '@shared/settingsSync'
import { folderBlocks } from '@shared/folderValues'
import { parseFrontmatter, splitFrontmatter } from '@shared/frontmatter'
import { PAGE_ID_KEY, canonicalPageId, isNumberId, vaultPageId } from '@shared/pageId'
import { cardBlock, cardIdOf, changeCard, pageCards, withCardNext, withCardNoTitle, type CardLine } from '@shared/cardLine'
import { checkCard, type CardFault } from '@shared/cardCheck'
import { lineKinds } from '@shared/fences'
import { cardQueue, cardState } from '@shared/cardSchedule'
import { cardTitle, cardWithTitle } from '@shared/cardText'
import { cardFileTitle, hasTitleProperty } from '@shared/cardConvert'
import { cardFileContent, cardFileName, isCardFileContent } from '@shared/cardFileFormat'
import { CARD_SKILL_START_PAGE, cardSkillFolder } from '@shared/cardSkillFolder'
import { makeCardResolver } from '@shared/cardLinks'
import { isSkipped } from '@shared/fileKind'
import { REVIEW_SETTINGS_FILE, sanitizeReviewSettings, type ReviewSettings } from '@shared/reviews'
import { AGENT_HANDLE, VAULT_CONFIG_DIR, defaultAppState, isFolderSettingsPath, listVaults, type AppState, type IndexRecord, type SettingsState } from '@shared/types'
import { makeResolver } from '@shared/linkResolver'
import { mentionsOf } from '@shared/mentions'
import { CARD_SKILL_DIR } from '../main/cardSkill'
import { BridgeFailure, fsCall, requireMarkdownFile } from '../main/fs/fsUtils'
import { createFile } from '../main/fs/create'
import { readFile, writeFile } from '../main/fs/file'
import { dailyPage } from '../main/pages/daily'
import { newPage } from '../main/pages/page'
import { otherMacFiles } from '../main/settingsFiles'
import { mergeFolderSettings, parseState } from '../main/store'
import { STATE_FILE, userDataDir } from '../main/userData'
import { giveId, nextId, readPage } from '../main/vaultIndex/idSweep'
import { idVault, macId, mintIds, vaultIds } from '../main/vaultIndex/mint'
import { scanAll } from '../main/vaultIndex/reconcile'
import { fileTitle, scanFile, walk } from '../main/vaultIndex/scan'

export interface Io {
  /** The whole of stdin, for `--body -`. */
  stdin(): Promise<string>
  stdout(text: string): void
  stderr(text: string): void
  /** Hands a `yaseendocs://` link to the system, as a click on it would (D10). */
  open?(link: string): Promise<void>
}

export const USAGE = `usage:
  yaseendocs comment  <page.md> --body <text | -> [--title <one line>] [--reply-to <comment>] [--by <name>]
  yaseendocs comments <page.md | folder> [--open] [--json]
  yaseendocs edit     <page.md> <comment> --body <text | -> [--title <one line>] [--by <name>]
  yaseendocs delete   <page.md> <comment> [--by <name>]
  yaseendocs resolve  <page.md> <comment> [--reopen] [--by <name>]
  yaseendocs id       <page.md>
  yaseendocs links    <page.md> [--json]
  yaseendocs mentions <page.md> [--json]
  yaseendocs due      <page.md | folder> [--json]
  yaseendocs card add <page.md> --body <text | -> [--title <text>] [--after <heading>] [--hide-title] [--strict] [--json]
  yaseendocs card new <folder> --title <text> [--body <text | ->] [--hide-title] [--strict] [--json]
  yaseendocs card next <id> [<folder>] [--off] [--json]
  yaseendocs card guide [--path]
  yaseendocs card check <page.md> [--json]
  yaseendocs vaults   [--json]
  yaseendocs daily    <vault> [--date today | tomorrow | yesterday | YYYY-MM-DD] [--find] [--open] [--json]
  yaseendocs new      <folder> --title <title> [--body <text | ->] [--json]
  yaseendocs --help`

export const HELP = `yaseendocs — a Yaseen Docs page's comments, its id and the ids it points at, the pages that link to it, its cards and the ones due for review, the app's list of vaults, and a new page or the day's daily page, from the shell.

${USAGE}

A comment lives in the page's frontmatter under \`comments:\` — never in the body — and this
command writes it exactly as the app does (id, number, time stamp, order). \`--body -\` reads
the text from stdin, so a long or multi-line comment needs no shell quoting. \`comments\` prints
every thread (\`--json\` for the raw shape). Name a comment by its number as the app shows it —
#3, or #3.1 for a reply — or by its id; a reply to #3 shows as #3.1.

Who wrote it: \`comment\` records \`by: agent\` unless --by says otherwise. Give each agent its own
name (\`--by claude\`), so one agent's comments are not another's. A person who set a profile in
the app's Settings signs with their handle (\`by: yaseen\`); a comment with no \`by\` is a person's
from before. \`edit\` and \`delete\` change only a comment whose \`by\` is the caller's own --by
(\`agent\` when none is given) — anyone else's is edited or deleted in the app. Deleting a comment
deletes its replies.

\`resolve\` marks a comment resolved (\`resolved:\` and \`resolved_by:\` in its entry); \`--reopen\`
opens it again. Any writer may resolve any comment: resolve the comment you acted on. A resolved
parent takes its whole thread out of the open list in the app. \`comments --open\` lists only open
comments; given a folder, \`comments\` lists the comments of every page under it, each page by
its title and path (\`--json\` for the raw shape).

A vault gives its pages IDs only when "Give this vault's pages IDs" is on in the app's Settings
(\`.yaseendocs/ids.json\`). In a vault that does not, a page's name is its file name, and \`id\`
and \`links\` are refused. The next two paragraphs describe a vault that does.

Every page has a permanent id in its frontmatter (\`id: YAZ-12\`: the vault's letters and a
number); a rename or a move never changes it. An old id of 12 characters (\`k3m9x2pq7abc\`) is
still read. A page's title is its \`title:\` line, and the app builds the file name from the title
and the id (\`<kebab-title>-<id>.md\`). A link between pages is written \`[[<id>]]\`, and the app
shows the page's current title in its place. \`id\` prints a page's id — a page that has none, or
an \`id\` some other tool wrote, is given one first, exactly as the app would, and only inside a
vault that gives its pages IDs. \`links\` lists every id on a page — its links, and the
folders it is also in — with the title and path of the page, card or folder that id names now, or
\`(missing)\` (\`--json\` for the raw shape: \`kind\` is \`page\`, \`card\`, \`folder\` or \`missing\`). A card's
path is the file that holds it: its card file, or its page. To find a page from an id, search the vault's file
names for it; a file the app did not name is found by its \`id: <id>\` line.

A page's value for a column is a top-level field of its frontmatter (\`domain: Billing\`), one value per
key, and every folder page that shows the page reads that same field. A column defined in
\`<folder>/.folder.md\` shows on that folder's page and on every folder page below it. Only a column
set to "Separate value for <folder>" keeps that folder's own value under \`in:\`, in the block named
by the folder's id; a folder's id is the \`id\` in \`<folder>/.folder.md\`. \`links\` lists the
folders of those blocks after the links, each by id and the title and path of the folder it names now.

\`mentions\` lists every page and folder that links to a page: the page's Linked mentions in the app, in
a vault with IDs or without. A line is the title and the path of the page, or of the folder with a
\`/\` after it; a link in a folder's page or settings counts for that folder. \`--json\` gives
\`title\`, \`path\` (from the vault's folder) and \`kind\` (\`page\`, \`card\` or \`folder\`; \`card\` is a card file). A link counts as
the app counts it: by id, path, title, file name or alias, in the body or the properties.

A card is a spaced-repetition card inside a page: a \`\`\`card\` fence with its text, and the card
line under it, \`<!-- card: <id>, <time> <answer>, ... -->\`, which holds the card's id and each review.
\`---\` alone on a line splits the front from the back, and \`{{word}}\` hides a word. Only a vault that
gives its pages IDs has cards, and \`due\` and \`card\` are refused in any other. \`card add\` and \`card new\`
write the card line, and the app writes each review. Never change a card line that the app wrote: it holds the card's
ID and its reviews. On a new card that you write by hand, you may put the line \`<!-- card: notitle -->\` directly
below the closing fence; the app adds the ID and keeps the option. With the command, use \`--hide-title\`.

\`due\` lists the cards due now under a folder (the whole vault for its root), as the app's Inbox
shows them: first the cards up next (see \`card next\`), then the cards due today, most overdue first, then
new cards, oldest or newest first by the vault's "New cards first", as many as its "New cards a day" leaves
for today (all of them when that box is empty). A line is the day it was due (\`next\` for a card up next,
\`new\` for a new card, \`steps\` for a card in its same-day steps: Forgot, or a new card not yet Remembered
twice; it is due now, minutes after its last answer), the card's id, its title (its first line; a card file's \`title:\`) and its page.
Given a page, \`due\` lists every card on it, each with the day it is next due, \`next\`, \`new\`, \`steps\`, or
\`off\` (archived: the app's "Archive card"). The app works the dates out from each card's reviews with FSRS and never writes
them, so this is the place to read them. \`--json\` gives \`id\`, \`page\`, \`title\`, \`due\` (ISO time; the
minute a step ends), \`isNew\`, \`next\` and \`inSteps\` (and \`off\` for a page), and \`cardFile: true\` for a card that lives in a card file.

\`card add\` adds a card to a page, with a new id from the vault's counter, as the app gives one:
\`--body\` (\`--body -\` for stdin) is the card's text, and \`--title\` (one line) its first line: a card's
first line is its title, what the app and a \`[[<card id>]]\` link to the card show. It goes at the end of
the page, or with \`--after\` at the end of that heading's section (the heading's text, without the \`#\`
marks; case does not count). It prints \`added <id> to <page>\`; \`--json\` gives \`id\`, \`page\` and \`title\`. A card file is refused:
"This is a card file. Use \`card new\`."

A card file is a card on its own: a page whose properties hold \`kind: card\` and whose body is one card and
its card line, nothing else. The card's id is the file's id (the file has no \`id:\` line). Its title is its
\`title:\` property, as a page's, and its name is \`<kebab-title>-<id>.md\`; the card holds only its sides.
\`card new\` makes one in a folder, with a new id from the vault's counter: \`--title\` (one line) is the
file's \`title:\`, and \`--body\` (\`--body -\` for stdin) the card's text. A name that is already taken is refused. It prints \`made <path>\`; \`--json\` gives
\`id\`, \`path\` and \`title\`.

\`--hide-title\` on \`card add\` and \`card new\` keeps the card's title off the front in review, as the app's
⋯ › "Title on the front" › Hide: the card line gets the part \`notitle\`, and the title is never a step of the
review. Do not put the title in \`{{ }}\`. Use \`--hide-title\`.

\`card check\` lists each card of a page (a card file is its own page) with its sure mistakes: a \`{{\` with no
\`}}\` after it on that side, an empty \`{{}}\`, a card with one side and nothing hidden, no title, the title still
"Title", and a question that hides its own subject ("What does {{NASA}} stand for?": hide the answer, not the
subject). Code is never checked. A line is \`<id>  <title>  ok\`, or \`<id>  <title>\` and one indented line for
each mistake: its text, then its kind and its side (\`front\`, \`back\`, \`side 3\`, …). It exits 0 when no card has
a mistake, exit 1 when one has; \`--json\` gives \`id\`, \`title\` and \`faults\` (\`kind\`, \`side\`: 0 for the
front, \`text\`). \`card add\` and \`card new\` check the new card the same way: each mistake is a
\`warning:\` line on stderr, and the card is still written. With \`--strict\` they write nothing and take no
number when the card has a mistake (exit 1).

\`card next <id>\` puts a card at the top of the Inbox, as the app's "Put at top of Inbox" does: the card
line gets the part \`next\`, and the Inbox shows the card first, due or not and outside the new cards a
day, until it is answered one time (the answer removes \`next\`). \`--off\` removes it ("Remove from top of
Inbox"). The card is found by its id in the vault of \`<folder>\` (the current folder when none is given).
An archived card stays out of the Inbox. It prints \`<id> is up next (<page>)\` or \`<id> is not up
next (<page>)\`; \`--json\` gives \`id\`, \`page\` and \`next\`.

\`card guide\` prints the start page of the card skill: how to write a good card, the formats, and how to check
one. Run \`yaseendocs card guide\` before you add or change a card. The skill is a folder of pages, and the start
page names the others: \`--path\` prints the folder's path in double quotes (it has a space on macOS), so you can
read them. Run inside a vault that has a \`Card skill\` folder at its top (the person's own copy of the skill), the
command uses that folder; anywhere else, the app's copy, which the app makes at its start. Before the app has
started once there is no copy, and the command says so (exit 1).

\`vaults\` lists the vaults the app knows: the recent ones, last used first, then each other vault
that is open or has a number. A line is the name, the folder, \`⌘<n>\` for number n, \`(open)\` for
a window on it. \`--json\` gives \`path\`, \`name\` (display name, else folder name), \`key\` (1-9 or
null), \`open\` and \`lastUsed\` (epoch ms, or null). It reads the app's state file and never
writes it: with the app closed, \`open\` is a window the app opens again at its start.

\`daily\` finds the daily page of a day in a vault, and makes it when there is none. The day is
today, your Mac's own day, or \`--date\`. It uses the app's Daily pages settings
(Settings › Files & Links › Daily pages): the folder, the name style, a folder for each day, and the
daily pages folder's template. A page that is there is never changed. Two runs at one moment, here or
in the app, give one page. \`--find\` only finds: no page is an error, and nothing is made. \`--open\`
then opens the page in the app, as a \`yaseendocs://\` link to it does: the window of its vault comes
to the front, and the app starts if it is closed.

\`new\` makes a page in a folder, as the app's New page does: the folder's \`.template.md\`, the title,
and in a vault with IDs a new id and the file name \`<kebab-title>-<id>.md\`. When that folder (not a
folder in it) already has a page with the title, that page is the answer and nothing is made, so a
run again after a timeout is safe; a \`--body\` is then not written, and stderr says so. \`--body\`
(\`--body -\` for stdin) takes the place of the template's body; a properties block at its top goes
over the template's properties, and \`--title\` always wins.

Both print \`made <path>\` or \`found <path>\`. When another page has the same title, each one is named
on stderr (\`warning: also <path>\`). \`--json\` gives \`path\`, \`title\`, \`id\` (null in a vault
without IDs), \`created\` and \`others\`. A page made while the app is open shows in it at once.

Exit codes: 0 done · 1 refused or failed (the reason is on stderr) · 2 usage.

Example:
  yaseendocs comment "/vault/Weekly review.md" --title "Numbers check" --body "The Q3 figure is off by one row."
  → #3 added to /vault/Weekly review.md

Plan a day:
  yaseendocs daily /vault --date tomorrow --json        → the page to plan in, made when it is missing
  yaseendocs daily /vault --date 2026-11-02 --find      → that day's page, or exit 1 and nothing made

Make a page with its first text:
  printf '## Plan\\n- Gym' | yaseendocs new "/vault/projects" --title "Gym plan" --body -

Make a card, and see what is due:
  printf 'The capital of {{France}}\\n---\\nParis' | yaseendocs card add "/vault/Geography.md" --after "Cards" --body -
  yaseendocs card new "/vault/Geography" --title "Capital of France" --body "{{Paris}}"
  yaseendocs due /vault --json
  yaseendocs card next WIKI-512 /vault                  → WIKI-512 shows first in the Inbox
`

/** Every flag the contract names; anything else is refused, because `--help` IS the contract (🔒 D1) and a typo must not be absorbed. */
const FLAGS = new Set(['--body', '--title', '--reply-to', '--by', '--date', '--after'])
/** Flags that take no value. */
const SWITCHES = new Set(['--json', '--help', '-h', '--find', '--open', '--reopen', '--off', '--path', '--hide-title', '--strict'])

class Usage extends Error {}
/** `card check` found a fault (YAZ-5116): exit 1, with the list on stdout and nothing more on stderr. */
class Checked extends Error {}

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
  const line = (c: PageComment, indent: string) =>
    `${indent}${label(comments, c)}  ${c.id}  ${c.at}  ${c.by === undefined ? '' : `(${c.by})  `}${c.resolved === undefined ? '' : '[resolved]  '}${firstLine(c)}`
  return threadsOf(comments)
    .flatMap(({ comment, replies }) => [line(comment, ''), ...replies.map((r) => line(r, '  '))])
    .join('\n')
}

/** The caller's name: its --by, else `agent` — what `comment` writes and what `edit` / `delete` may change. */
const callerOf = (flags: Map<string, string | true>): string => str(flags, '--by')?.trim() || AGENT_HANDLE

/** The comment `ref` names (id or number), or the refusal. Returns the parse it did, so callers label without parsing again. */
function named(content: string, ref: string, page: string): { comments: PageComment[]; target: PageComment } {
  const comments = readComments(content)
  const target = find(comments, ref)
  if (target === undefined) throw new Error(`no comment ${ref} on ${page}`)
  return { comments, target }
}

/** A comment the caller may edit or delete: it carries the caller's own `by` (YAZ-4615 D2, `ownedBy`). */
function callerOwned(content: string, ref: string, page: string, by: string): { comments: PageComment[]; target: PageComment } {
  const found = named(content, ref, page)
  const { comments, target } = found
  if (!ownedBy(target, by)) {
    const writer = target.by?.trim() ? `by ${target.by.trim()}` : 'by a person'
    throw new Error(`${label(comments, target)} was left ${writer} — only its writer can edit or delete it (--by)`)
  }
  return found
}

/** Open comments only (YAZ-4615 D3): a resolved one goes, and so does every reply of a resolved parent. */
function openOnly(comments: readonly PageComment[]): PageComment[] {
  const resolved = new Set(comments.filter((c) => c.resolved !== undefined).map((c) => c.id))
  return comments.filter((c) => !resolved.has(c.id) && !(c.reply_to !== undefined && resolved.has(c.reply_to)))
}

/** `comments <folder>` (YAZ-4615 item 6): every page under it that has comments, by title and path. */
async function folderComments(target: string, flags: Map<string, string | true>, io: Io): Promise<void> {
  const files: string[] = []
  await walk(target, files)
  const records = [...(await scanAll(target, files)).values()].sort((a, b) => (a.path < b.path ? -1 : 1))
  const pages: { title: string; path: string; comments: PageComment[] }[] = []
  for (const r of records) {
    const all = readComments((await readPage(r.path)).content)
    const comments = flags.has('--open') ? openOnly(all) : all
    if (comments.length > 0) pages.push({ title: r.title, path: r.path, comments })
  }
  if (flags.has('--json')) io.stdout(`${JSON.stringify(pages.map((p) => ({ title: p.title, path: p.path, threads: threadsOf(p.comments) })), null, 2)}\n`)
  else io.stdout(pages.length === 0 ? `no ${flags.has('--open') ? 'open ' : ''}comments under ${target}\n` : pages.map((p) => `${p.title}  ${p.path}\n${listing(p.comments).replace(/^/gm, '  ')}\n`).join(''))
}

/** The vault a folder is in: the nearest folder at or above it that holds `.yaseendocs/`; null when there is none. */
async function vaultRoot(from: string): Promise<string | null> {
  for (let dir = from; ; dir = dirname(dir)) {
    if ((await stat(join(dir, VAULT_CONFIG_DIR)).catch(() => null))?.isDirectory()) return dir
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

/** The card settings of the vault at `root` (`.yaseendocs/review.json`), or the defaults. */
async function reviewSettings(root: string): Promise<ReviewSettings> {
  return sanitizeReviewSettings(await readRaw(join(root, VAULT_CONFIG_DIR, REVIEW_SETTINGS_FILE), 'utf8').then(JSON.parse).catch(() => null))
}

/** The ID vault of `dir` (YAZ-4946 D8: only a vault that gives IDs has cards), or the refusal. */
async function cardVault(dir: string, what: string): Promise<string> {
  const root = await idVault(dir)
  if (root === null) throw new Error(`${what}'s vault does not give its pages IDs, so it has no cards (turn on "Give this vault's pages IDs" in the app's Settings)`)
  return root
}

/**
 * The title of each card of a page (idea 3), in page order: its text is read here, the index does not hold it (D4). A
 * card file's card is titled by the file's `title` (YAZ-5044).
 */
async function cardTitles(page: string): Promise<string[]> {
  const { content } = await readPage(page)
  const file = isCardFileContent(content)
  return pageCards(content).map((card, i) => (file && i === 0 ? cardFileTitle(content) : cardTitle(card.text)))
}

/** `cardFile: true` for a card that lives in a card file (YAZ-5037), nothing for a card in a page: a row's own key. */
const inCardFile = (record: IndexRecord | undefined): { cardFile?: true } => (record?.kind === 'card' ? { cardFile: true } : {})

/**
 * `due` (YAZ-4963, idea 12): the cards due now, or every card of one page with the day it is next due. The date
 * is computed by the same `shared/cardSchedule.ts` the Inbox uses, from the same scan, so the two agree. A card in its
 * same-day steps (YAZ-5020: Forgot, or a new card not yet Remembered twice) is due now, whatever minute its step ends:
 * it is listed as `steps` (`--json`: `inSteps: true`, `due` the minute its step ends).
 */
async function due(target: string, json: boolean, io: Io): Promise<void> {
  const day = (ms: number): string => new Date(ms).toLocaleDateString('en-CA') // the LOCAL day, as YYYY-MM-DD
  const iso = (ms: number): string => new Date(ms).toISOString()
  const now = Date.now()
  if (!(await fsCall(target, () => stat(target))).isDirectory()) {
    requireMarkdownFile(target)
    const root = await cardVault(dirname(target), target)
    const settings = await reviewSettings(root)
    const titles = await cardTitles(target)
    // `off` is the card's own archive (HELP, YAZ-5046). With review off for the whole vault, ONE line says so, and each card keeps its day.
    const record = await scanFile(root, target)
    const rows = (record.cards ?? []).map((card, i) => {
      const state = cardState(card.reviews, settings)
      return { id: card.id, page: target, title: titles[i] ?? '', due: card.off ? null : state.isNew || card.next ? iso(now) : iso(state.due!), isNew: state.isNew, next: card.next, off: card.off, inSteps: state.inSteps, ...inCardFile(record) }
    })
    if (!settings.enabled && rows.length > 0) io.stderr(`review is off for this vault (Settings › Review › Review cards): no card is due\n`)
    if (json) io.stdout(`${JSON.stringify(rows, null, 2)}\n`)
    else
      io.stdout(
        rows.length === 0
          ? `no cards on ${target}\n`
          : rows.map((r) => `${r.due === null ? 'off       ' : r.next ? 'next      ' : r.isNew ? 'new       ' : r.inSteps ? 'steps     ' : day(Date.parse(r.due))}  ${r.id ?? '(no id yet)'}  ${r.title}\n`).join(''),
      )
    return
  }
  const root = await cardVault(target, target)
  const settings = await reviewSettings(root)
  const files: string[] = []
  await walk(root, files)
  const records = [...(await scanAll(root, files.filter((file) => !isFolderSettingsPath(file)))).values()]
  // The whole vault is read, so the new cards begun today count wherever they are; the folder then keeps its own.
  const folder = target === root ? '' : target.slice(root.length + 1).split(/[\\/]/).join('/')
  const queue = cardQueue(records, settings, now, folder, undefined, (await vaultIds(root)).letters)
  const titles = new Map<string, string[]>()
  for (const { path } of queue) if (!titles.has(path)) titles.set(path, await cardTitles(path))
  const byPath = new Map(records.map((r) => [r.path, r]))
  const inSteps = (q: (typeof queue)[number]): boolean => !q.isNew && cardState(byPath.get(q.path)?.cards?.[q.index]?.reviews ?? [], settings).inSteps
  const rows = queue.map((q) => ({ id: q.id, page: q.path, title: titles.get(q.path)?.[q.index] ?? '', due: iso(q.due), isNew: q.isNew, next: q.next, inSteps: inSteps(q), ...inCardFile(byPath.get(q.path)) }))
  if (json) io.stdout(`${JSON.stringify(rows, null, 2)}\n`)
  else if (!settings.enabled) io.stdout(`review is off for this vault (Settings › Review › Review cards): no card is due\n`)
  else io.stdout(rows.length === 0 ? `nothing is due under ${target}\n` : rows.map((r) => `${r.next ? 'next      ' : r.isNew ? 'new       ' : r.inSteps ? 'steps     ' : day(Date.parse(r.due))}  ${r.id}  ${r.title}  ${r.page}\n`).join(''))
}

/** The app's state file as the store itself reads it (`parseState`); only READ. No file yet is the default state; a damaged one is refused and left for the app to move aside. */
async function readState(): Promise<AppState> {
  const file = join(userDataDir(process.env, process.platform, homedir()), STATE_FILE)
  const text = await readRaw(file, 'utf8').catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') return null
    throw err
  })
  const state = text === null ? defaultAppState() : parseState(text)
  if (state === null) throw new Error(`${file} is not a valid app state`)
  return state
}

/**
 * The settings the app would start with now (YAZ-4269 D3): the state file's, then the newest file of another Mac in
 * the settings folder (YAZ-3276), merged as the app merges it at its start. On a Mac whose app has not run since a
 * change made on another one, that change still counts. A folder that can't be read is skipped. Nothing is written.
 */
async function settingsNow(): Promise<SettingsState> {
  const state = await readState()
  if (state.settingsFolder === null) return state.settings
  const files = await otherMacFiles(state.settingsFolder, await macId()).catch(() => [])
  const newer = newestFile(files, state.settingsSavedAt)
  return newer === null ? state.settings : mergeFolderSettings(state.settings, newer.settings)
}

/**
 * `vaults` (YAZ-2556 🔒 D2): the vaults the app knows — `listVaults`, over the app's state file as
 * the store itself reads it (`parseState`) — in that function's order: the recents, last used first,
 * then each other vault that is open or has a number. (The ⌘O panel draws the same rows and puts the
 * open ones first.) It only READS: no file yet is no vaults, and a damaged one is refused and left
 * for the app to move aside.
 */
async function vaults(json: boolean, io: Io): Promise<void> {
  const rows = listVaults(await readState())
  if (json) io.stdout(`${JSON.stringify(rows, null, 2)}\n`)
  else io.stdout(rows.length === 0 ? 'no vaults\n' : rows.map((v) => `${v.name}  ${v.path}${v.key === null ? '' : `  ⌘${v.key}`}${v.open ? '  (open)' : ''}\n`).join(''))
}

/** The day `--date` names, on this Mac's own calendar: today, tomorrow, yesterday or `YYYY-MM-DD` (D9); today when it is not given. */
export function dayOf(text: string | undefined, now = new Date()): Date {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const shift = { today: 0, tomorrow: 1, yesterday: -1 }[text ?? 'today']
  if (shift !== undefined) return new Date(today.getFullYear(), today.getMonth(), today.getDate() + shift)
  const [, y, m, d] = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text ?? '') ?? []
  const day = new Date(Number(y), Number(m) - 1, Number(d))
  if (y === undefined || day.getFullYear() !== Number(y) || day.getMonth() !== Number(m) - 1 || day.getDate() !== Number(d)) throw new Usage('--date takes today, tomorrow, yesterday or a day as YYYY-MM-DD')
  return day
}

/** A page's path from its vault's folder, as `links` and `mentions` print it. */
const vaultPath = (r: IndexRecord): string => (r.folder === '' ? r.name : `${r.folder}/${r.name}`)

const byPath = (a: IndexRecord, b: IndexRecord): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)

/**
 * A scanned record as the app's index hands it out (`vaultIndex/live.ts` `getIndex`): in a vault with IDs, its id as an
 * ID of that vault (the letters it had before read as the current ones), or none; in a vault without, no id, and the
 * title its file name gives (YAZ-2523 V12: `title:` is a field like any other there).
 */
function asIndexed(r: IndexRecord, letters: readonly string[] | undefined): IndexRecord {
  const { id: held, ...rest } = r
  if (letters === undefined) return { ...rest, title: fileTitle(r) }
  const id = vaultPageId(held, letters)
  return id === undefined ? rest : { ...rest, id }
}

/**
 * `mentions` (YAZ-4740 L6): every page and folder that links to `page` — its Linked mentions in the app. The same walk
 * and scan as `links`; resolved by the app's own rule (`@shared/linkResolver`) and gathered by the app's own map
 * (`@shared/mentions`), so the command and the app list the same pages.
 */
async function mentions(page: string, json: boolean, io: Io): Promise<void> {
  const idRoot = await idVault(dirname(page))
  const root = idRoot ?? (await vaultRoot(dirname(page)))
  if (root === null) throw new Error(`${page} is in no vault (no ${VAULT_CONFIG_DIR} folder above it)`)
  const letters = idRoot === null ? undefined : (await vaultIds(root)).letters
  const files: string[] = []
  await walk(root, files)
  const scanned = [...(await scanAll(root, files)).values()].sort(byPath).map((r) => asIndexed(r, letters))
  const records = scanned.filter((r) => !isFolderSettingsPath(r.path))
  const folders = scanned.filter((r) => isFolderSettingsPath(r.path))
  if (!records.some((r) => r.path === page)) throw new Error(`${page} is not a page of ${root}`)
  const resolvePage = makeResolver(records.map((record) => ({ record })), root, { folders, letters })
  const found = mentionsOf(records, folders, (target) => resolvePage(target)?.record.path ?? null).get(page) ?? []
  const rows = found.map((r) =>
    isFolderSettingsPath(r.path) ? { title: r.title, path: r.folder, kind: 'folder' as const } : { title: r.title, path: vaultPath(r), kind: r.kind === 'card' ? ('card' as const) : ('page' as const) },
  )
  if (json) io.stdout(`${JSON.stringify(rows, null, 2)}\n`)
  else io.stdout(rows.length === 0 ? `nothing links to ${page}\n` : rows.map((r) => `${r.title}  ${r.kind === 'folder' ? `${r.path}/` : r.path}\n`).join(''))
}

/** `made <path>` or `found <path>`, each other page of the title on stderr (D8); `--json` the whole answer. */
function report(io: Io, flags: Map<string, string | true>, page: FoundPage): void {
  for (const other of page.others) io.stderr(`warning: also ${other}\n`)
  io.stdout(flags.has('--json') ? `${JSON.stringify(page, null, 2)}\n` : `${page.created ? 'made' : 'found'} ${page.path}\n`)
}

/**
 * macOS `open`, Windows `explorer.exe` (no shell, so a `&` in a path is a letter): the link goes to the app as a click
 * on it would. `explorer.exe` answers 1 also when it opened the link, so on Windows only a failed start counts.
 */
const openLink = (link: string): Promise<void> =>
  new Promise((done, fail) => {
    const win = process.platform === 'win32'
    execFile(win ? 'explorer.exe' : 'open', [link], (err) =>
      err === null || (win && typeof err.code === 'number') ? done() : fail(new Error(`the page is ready, but the app could not be asked to open it: ${err.message}`)),
    )
  })

/** A flag that `verb` does not take is refused, not ignored: an agent that passed it meant something by it. */
function onlyFlags(verb: string, flags: Map<string, string | true>, takes: readonly string[]): void {
  const other = [...flags.keys()].find((flag) => !takes.includes(flag))
  if (other !== undefined) throw new Usage(`${verb} does not take ${other}`)
}

/** `daily` (YAZ-4269 D2, D5, D6, D9, D10): a day's daily page of a vault, found or made by the app's own rules. */
async function daily(target: string | undefined, flags: Map<string, string | true>, io: Io): Promise<void> {
  onlyFlags('daily', flags, ['--date', '--find', '--open', '--json'])
  if (target === undefined) throw new Usage('daily needs a vault')
  const day = dayOf(str(flags, '--date'))
  const settings = await settingsNow()
  const root = resolve(target)
  const page = await dailyPage(root, settings, day, !flags.has('--find'))
  if (page === null) throw new Error(`no daily page "${dailyPageName(settings.dailyPageFormat, day).trim()}" in ${root}`)
  report(io, flags, page)
  if (flags.has('--open')) await (io.open ?? openLink)(fileLink(page.path))
}

/** `new` (YAZ-4269 D4, D7): a page in a folder by the app's own rules; the one of that title when the folder has it. */
async function newCommand(target: string | undefined, flags: Map<string, string | true>, io: Io): Promise<void> {
  onlyFlags('new', flags, ['--title', '--body', '--json'])
  if (target === undefined) throw new Usage('new needs a folder')
  const title = str(flags, '--title')?.trim()
  if (title === undefined || title === '') throw new Usage('new needs --title')
  const body = flags.has('--body') ? await bodyOf(flags, io) : undefined
  const page = await newPage(resolve(target), title, body, (await settingsNow()).commentsHint)
  if (!page.created && body !== undefined) io.stderr(`warning: --body was not written: ${page.path} was already there\n`)
  report(io, flags, page)
}

/** Where a new card goes in `body`: after the line index returned (the end of the heading's section), or the end. */
function cardPlace(body: string, after: string | undefined): number {
  const lines = body.split('\n')
  if (after === undefined) return lines.length
  const want = after.replace(/^#+\s*/, '').trim().toLowerCase()
  const kinds = lineKinds(lines)
  const headings: { at: number; level: number; text: string }[] = []
  lines.forEach((line, at) => {
    // A heading in a code block (or a card) is the block's own text.
    const h = kinds[at] === 'text' ? /^(#{1,6})[ \t]+(.*?)[ \t#]*$/.exec(line) : null
    if (h !== null) headings.push({ at, level: h[1].length, text: h[2].trim().toLowerCase() })
  })
  const i = headings.findIndex((h) => h.text === want)
  if (i === -1) throw new Error(`no heading "${after}" on the page`)
  const end = headings.slice(i + 1).find((h) => h.level <= headings[i].level)
  return end === undefined ? lines.length : end.at
}

/** A card file holds one card (YAZ-5037): `card add` never puts a second one in it. */
const CARD_FILE_REFUSED = 'This is a card file. Use `card new`.'

/** The title flag of `card add` and `card new` (YAZ-5030: a card's first line; a card file's `title`, YAZ-5044): one line of text, '' when not given. */
function cardTitleFlag(flags: Map<string, string | true>): string {
  const titleFlag = flags.get('--title')
  if (titleFlag === true) throw new Usage('--title needs a text')
  const titleLine = titleFlag?.trim() ?? ''
  if (titleFlag !== undefined && (titleLine === '' || /[\r\n]/.test(titleLine))) throw new Usage('--title needs one line of text')
  return titleLine
}

/** The new card's line (YAZ-5135): its ID, and `notitle` with `--hide-title`, as ⋯ › "Title on the front" › Hide writes it. */
const newCardLine = (id: string, flags: Map<string, string | true>): CardLine => withCardNoTitle({ parts: [{ kind: 'id', id }] }, flags.has('--hide-title'))

/** A fault's side as people say it (YAZ-5116): `front`, `back`, then `side 3` and up. */
const sideName = (side: number): string => (side === 0 ? 'front' : side === 1 ? 'back' : `side ${side + 1}`)
/** One fault on one line: its text, then its kind and side. */
const faultLine = (f: CardFault): string => `${f.text} (${f.kind}, ${sideName(f.side)})`

/**
 * The check of a new card (YAZ-5116, suggestion 16), before a number is taken: each fault a `warning:` line on stderr;
 * with `--strict` a card with a fault is refused, so nothing is written and no number is spent.
 */
function checkNewCard(text: string, flags: Map<string, string | true>, io: Io): void {
  const faults = checkCard(text)
  for (const f of faults) io.stderr(`warning: ${faultLine(f)}\n`)
  if (faults.length > 0 && flags.has('--strict')) throw new Error(`the card has ${faults.length} ${faults.length === 1 ? 'thing' : 'things'} to check, so nothing was added`)
}

/** `card check` (YAZ-5116): each card of a page with its sure mistakes; exit 1 when one has a mistake. */
async function cardCheck(page: string, flags: Map<string, string | true>, io: Io): Promise<boolean> {
  onlyFlags('card check', flags, ['--json'])
  await cardVault(dirname(page), page)
  const content = (await readFile(page)).content
  // A card file's title is its `title` (YAZ-5044): the check reads the card as Review does, the title as its first line.
  const titled = isCardFileContent(content) && hasTitleProperty(content) ? cardFileTitle(content) : null
  const rows = pageCards(content).map((card, i) => {
    const text = titled !== null && i === 0 ? cardWithTitle(titled, card.text) : card.text
    return { id: cardIdOf(card.line), title: cardTitle(text), faults: checkCard(text) }
  })
  if (flags.has('--json')) io.stdout(`${JSON.stringify(rows, null, 2)}\n`)
  else
    io.stdout(
      rows.length === 0
        ? `no cards on ${page}\n`
        : rows.map((r) => `${r.id ?? '(no id yet)'}  ${r.title}${r.faults.length === 0 ? '  ok' : ''}\n${r.faults.map((f) => `  ${faultLine(f)}\n`).join('')}`).join(''),
    )
  return rows.some((r) => r.faults.length > 0)
}

/** `card add` (YAZ-4963, idea 16): a card with a real ID from the vault's counter, written atomically. */
async function cardAdd(page: string, flags: Map<string, string | true>, io: Io): Promise<void> {
  onlyFlags('card add', flags, ['--body', '--title', '--after', '--hide-title', '--strict', '--json'])
  const body = (await bodyOf(flags, io)).replace(/\r\n/g, '\n').replace(/^\n+|\s+$/g, '')
  if (body === '') throw new Usage('card add needs a --body with text')
  // The title is the card's first line (YAZ-5030): one line, before the body.
  const titleLine = cardTitleFlag(flags)
  const text = titleLine === '' ? body : `${titleLine}\n${body}`
  const root = await cardVault(dirname(page), page)
  const after = str(flags, '--after')
  // The page and the heading are checked before a number is taken: a refusal costs no number.
  const content = (await readFile(page)).content
  if (isCardFileContent(content)) throw new Error(CARD_FILE_REFUSED)
  cardPlace(splitFrontmatter(content).body, after)
  checkNewCard(text, flags, io)
  // The door (YAZ-2677 D4): the count file is on disk before the card is written (R18), the app's own number.
  const id = (await mintIds(root, 1))?.[0]
  if (id === undefined) throw new Error(`${page}'s vault does not give its pages IDs, so it has no cards`)
  const block = cardBlock(text, newCardLine(id, flags))
  await transformOnDisk(page, (fresh) => {
    if (isCardFileContent(fresh)) throw new Error(CARD_FILE_REFUSED)
    const { frontmatter, body } = splitFrontmatter(fresh)
    const lines = body.split('\n')
    const at = cardPlace(body, after)
    // One blank line before the card and one after it; the page's own blank lines stay.
    let from = at
    while (from > 0 && lines[from - 1].trim() === '') from--
    const before = lines.slice(0, from)
    const rest = lines.slice(at)
    const next = [...before, ...(before.length > 0 ? [''] : []), block, ...(rest.length > 0 && rest.some((l) => l !== '') ? ['', ...rest] : [''])]
    return frontmatter + next.join('\n')
  })
  const title = cardTitle(text)
  io.stdout(flags.has('--json') ? `${JSON.stringify({ id, page, title }, null, 2)}\n` : `added ${id} to ${page}\n`)
}

/**
 * `card new` (YAZ-5037): a card file in `dir` — `kind: card`, the title in `title:` (YAZ-5044), and one card whose text
 * is the body when one is given — with a new ID from the vault's counter, named `<kebab-title>-<id>.md` as a page is.
 * The folder is checked before a number is taken. The create never writes over a file: a name that is taken is refused
 * (the number is spent, as the app's New page spends one on a create that fails).
 */
async function cardNew(dir: string, flags: Map<string, string | true>, io: Io): Promise<void> {
  onlyFlags('card new', flags, ['--title', '--body', '--hide-title', '--strict', '--json'])
  const title = cardTitleFlag(flags)
  if (title === '') throw new Usage('card new needs --title')
  const body = flags.has('--body') ? (await bodyOf(flags, io)).replace(/\r\n/g, '\n').replace(/^\n+|\s+$/g, '') : ''
  const at = await stat(dir).catch(() => null)
  if (at === null) throw new Error(`no folder ${dir}`)
  if (!at.isDirectory()) throw new Error(`${dir} is not a folder`)
  const root = await cardVault(dir, dir)
  // A folder the vault does not show (`.trash`, `.yaseendocs`, node_modules) is outside it: the index never reads its files.
  if (relative(root, dir).split(sep).some((name) => name !== '' && isSkipped(name))) throw new Error(`${dir} is not a folder the vault shows`)
  const text = body === '' ? title : `${title}\n\n${body}`
  checkNewCard(text, flags, io)
  const id = (await mintIds(root, 1))?.[0]
  if (id === undefined) throw new Error(`${dir}'s vault does not give its pages IDs, so it has no cards`)
  const path = join(dir, cardFileName(title, id))
  // No door: a card file carries no page `id:` (its card's ID is the file's), so the content is written as it is.
  await createFile({ path, content: cardFileContent(title, body, newCardLine(id, flags)) }, null).catch((err: unknown) => {
    throw err instanceof BridgeFailure && err.code === 'ALREADY_EXISTS' ? new Error(`${path} is already there`) : err
  })
  io.stdout(flags.has('--json') ? `${JSON.stringify({ id, path, title }, null, 2)}\n` : `made ${path}\n`)
}

/**
 * `card next` (YAZ-4999 D3): the card with ID `ref` in the vault of `from` up next, or no longer (`--off`) — the part
 * `next` on its card line, as the app's "Put at top of Inbox" writes it. The first page in path order that holds the
 * ID is the card's (the Inbox shows that one too). Written atomically; the same mark again writes nothing.
 */
async function cardNext(ref: string, from: string, flags: Map<string, string | true>, io: Io): Promise<void> {
  onlyFlags('card next', flags, ['--off', '--json'])
  if (!isNumberId(ref)) throw new Usage(`card next needs a card id (WIKI-512), not ${ref}`)
  const id = canonicalPageId(ref)
  const root = await cardVault(from, from)
  const files: string[] = []
  await walk(root, files)
  const records = [...(await scanAll(root, files.filter((file) => !isFolderSettingsPath(file)))).values()].sort(byPath)
  const record = records.find((r) => r.cards?.some((card) => card.id === id))
  if (record === undefined) throw new Error(`no card ${id} in ${root}`)
  const on = !flags.has('--off')
  await transformOnDisk(record.path, (content) => changeCard(content, id, (line) => withCardNext(line, on)))
  if (on && record.cards?.find((card) => card.id === id)?.off === true) io.stderr(`${id} is archived: it shows in the Inbox once it is unarchived\n`)
  io.stdout(flags.has('--json') ? `${JSON.stringify({ id, page: record.path, next: on }, null, 2)}\n` : `${id} is ${on ? '' : 'not '}up next (${record.path})\n`)
}

/**
 * `card guide` (YAZ-5110, decision 6): the card skill's start page, or with `--path` its folder in double quotes. The
 * vault is the one the current folder is in; its own `Card skill` folder wins over the app's copy (suggestion 18,
 * `cardSkillFolder`). The app's copy is `<userData>/card-skill`, found as `vaults` finds the state file.
 */
async function cardGuide(args: readonly string[], flags: Map<string, string | true>, io: Io): Promise<void> {
  onlyFlags('card guide', flags, ['--path'])
  if (args.length > 0) throw new Usage('card guide takes no argument')
  const appCopy = join(userDataDir(process.env, process.platform, homedir()), CARD_SKILL_DIR)
  const folder = cardSkillFolder(await vaultRoot(process.cwd()), appCopy, (path) => statSync(path, { throwIfNoEntry: false })?.isDirectory() === true)
  if (!(await stat(folder).catch(() => null))?.isDirectory()) throw new Error(`The card skill is not there yet: start Yaseen Docs once to make ${folder}`)
  if (flags.has('--path')) {
    io.stdout(`"${folder}"\n`)
    return
  }
  const start = await readRaw(join(folder, CARD_SKILL_START_PAGE), 'utf8').catch(() => null)
  if (start === null) throw new Error(`no ${CARD_SKILL_START_PAGE} in ${folder}`)
  io.stdout(start.endsWith('\n') ? start : `${start}\n`)
}

async function run(argv: readonly string[], io: Io): Promise<void> {
  const { verb, args, flags } = parse(argv)
  if (verb === '' || verb === 'help' || flags.has('--help') || flags.has('-h')) {
    io.stdout(HELP)
    return
  }
  if (verb === 'vaults') return vaults(flags.has('--json'), io)
  if (verb === 'daily') return daily(args[0], flags, io)
  if (verb === 'new') return newCommand(args[0], flags, io)
  if (verb === 'mentions') {
    onlyFlags('mentions', flags, ['--json'])
    if (args[0] === undefined) throw new Usage('mentions needs a page')
    const page = resolve(args[0])
    requireMarkdownFile(page)
    return mentions(page, flags.has('--json'), io)
  }
  if (verb === 'card') {
    if (args[0] === 'next') {
      if (args[1] === undefined) throw new Usage('card next needs a card id')
      return cardNext(args[1], resolve(args[2] ?? '.'), flags, io)
    }
    if (args[0] === 'new') {
      if (args[1] === undefined) throw new Usage('card new needs a folder')
      return cardNew(resolve(args[1]), flags, io)
    }
    if (args[0] === 'guide') return cardGuide(args.slice(1), flags, io)
    if (args[0] === 'check') {
      if (args[1] === undefined) throw new Usage('card check needs a page')
      const page = resolve(args[1])
      requireMarkdownFile(page)
      if (await cardCheck(page, flags, io)) throw new Checked()
      return
    }
    if (args[0] !== 'add') throw new Usage(args[0] === undefined ? 'card needs add, new, next, guide or check' : `unknown card command: ${args[0]}`)
    if (args[1] === undefined) throw new Usage('card add needs a page')
    const page = resolve(args[1])
    requireMarkdownFile(page)
    return cardAdd(page, flags, io)
  }
  if (verb === 'due') {
    onlyFlags('due', flags, ['--json'])
    if (args[0] === undefined) throw new Usage('due needs a page or a folder')
    return due(resolve(args[0]), flags.has('--json'), io)
  }
  const page = args[0] === undefined ? undefined : resolve(args[0])
  if (page === undefined) throw new Usage(`${verb} needs a page`)
  if (verb === 'comments' && (await stat(page).catch(() => null))?.isDirectory()) return folderComments(page, flags, io)
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
        return addComment(fresh, body, { id, at: nowIso(), replyTo: parent?.id, title: str(flags, '--title'), by: callerOf(flags) })
      }, isFolderSettingsPath(page))
      const comments = readComments(content)
      const added = comments.find((c) => c.id === id)
      io.stdout(`${added === undefined ? id : label(comments, added)} added to ${page}\n`)
      return
    }
    case 'comments': {
      const all = readComments((await readPage(page)).content)
      const comments = flags.has('--open') ? openOnly(all) : all
      io.stdout(flags.has('--json') ? `${JSON.stringify(threadsOf(comments), null, 2)}\n` : comments.length === 0 ? `no comments on ${page}\n` : `${listing(comments)}\n`)
      return
    }
    case 'edit': {
      const ref = args[1]
      if (ref === undefined) throw new Usage('edit needs a comment (#3, #3.1, or its id)')
      const body = await bodyOf(flags, io)
      let name = ref
      await transformOnDisk(page, (fresh) => {
        const { comments, target } = callerOwned(fresh, ref, page, callerOf(flags))
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
        const { comments, target } = callerOwned(fresh, ref, page, callerOf(flags))
        const replies = comments.filter((c) => c.reply_to === target.id).length
        receipt = `${label(comments, target)} deleted${replies === 0 ? '' : ` (and ${replies} ${replies === 1 ? 'reply' : 'replies'})`}`
        return deleteComment(fresh, target.id)
      })
      io.stdout(`${receipt}\n`)
      return
    }
    case 'resolve': {
      const ref = args[1]
      if (ref === undefined) throw new Usage('resolve needs a comment (#3, #3.1, or its id)')
      const reopen = flags.has('--reopen')
      let receipt = ref
      await transformOnDisk(page, (fresh) => {
        const { comments, target } = named(fresh, ref, page)
        receipt = `${label(comments, target)} ${reopen ? 'reopened' : 'resolved'}`
        return setResolved(fresh, target.id, reopen ? null : nowIso(), callerOf(flags))
      })
      io.stdout(`${receipt}\n`)
      return
    }
    case 'id': {
      const root = await idVault(dirname(page))
      if (root === null) throw new Error(`${page}'s vault does not give its pages IDs (turn on "Give this vault's pages IDs" in the app's Settings)`)
      const { letters } = await vaultIds(root)
      const { properties, error } = parseFrontmatter(splitFrontmatter((await readPage(page)).content).frontmatter)
      // An ID of this vault (YAZ-2677 R5), printed as the app writes it; any other `id` is another tool's (R7).
      let id = vaultPageId(properties[PAGE_ID_KEY], letters)
      if (id === undefined) {
        // The sweep's own refusals (`vaultIndex/idSweep.ts`), each given its reason; `giveId` checks them again on the bytes it writes against.
        if (error !== undefined) throw new Error('the properties block does not parse (invalid)')
        // The number the app would give (R20, S40): from the same door, with this Mac's one count
        // file. The command holds no index, so the door scans the vault for its highest number.
        id = await giveId(page, undefined, letters, nextId(root))
        if (id === undefined) throw new Error(`${page} changed while it was being given an id — run this again`)
      }
      io.stdout(`${id}\n`)
      return
    }
    case 'links': {
      const root = await idVault(dirname(page))
      if (root === null) throw new Error(`${page}'s vault does not use IDs, so there are no ID links to list`)
      const { letters } = await vaultIds(root)
      /** `value` as an ID of this vault (YAZ-2677 R5, S92): a number ID or an old ID; a name is none. */
      const own = (value: unknown): string[] => {
        const id = vaultPageId(value, letters)
        return id === undefined ? [] : [id]
      }
      const { links, properties } = await scanFile(root, page)
      const linked = links.flatMap(own)
      const ids = [...new Set([...linked, ...alsoIn(properties).flatMap(own)])]
      const held = folderBlocks(properties).map(([id]) => id)
      // The vault as the app's index sees it (the same walk, the same scan). In path order, so of two pages sharing an id — a copy the sweep has not met — the one named is the sweep's first choice too.
      const files: string[] = []
      if (ids.length > 0 || held.length > 0) await walk(root, files)
      const records = [...(await scanAll(root, files)).values()].sort((a, b) => (a.path < b.path ? -1 : 1))
      // A card's ID names the card (YAZ-5030), in a card file or in a page; IDs come from one counter, so a page's own ID is never a card's.
      const resolveCard = makeCardResolver(records, letters)
      // Each id with the title (YAZ-2420 🔒 D14) and the real path of what it names now.
      const rows = ids.map((id): { id: string; kind: 'page' | 'card' | 'folder' | 'missing'; title?: string; path?: string } => {
        const r = records.find((o) => vaultPageId(o.id, letters) === id)
        if (r === undefined) {
          const card = resolveCard(id)
          const holder = card === null ? undefined : records.find((o) => o.path === card.path)
          return card === null || holder === undefined ? { id, kind: 'missing' } : { id, kind: 'card', title: card.title, path: vaultPath(holder) }
        }
        // A folder's id is carried by its `.folder.md`; what it names is the folder.
        if (isFolderSettingsPath(r.path)) return { id, kind: 'folder', title: r.title, path: r.folder }
        // A page turned into a card file keeps its `id:` (YAZ-5037 pick 6): that ID names the card file.
        return { id, kind: r.kind === 'card' ? 'card' : 'page', title: r.title, path: vaultPath(r) }
      })
      const line = (r: (typeof rows)[number]) =>
        `${r.id}  ${r.kind === 'missing' ? '(missing)' : `${r.title}  ${r.kind !== 'folder' ? r.path : `${r.path}/${linked.includes(r.id) ? '' : '  (also in)'}`}`}`
      // The folders the page holds values for (`in`, D19), apart from its links: a block whose id no folder has is its id alone.
      const blocks = held.map((id): { id: string; title?: string; path?: string } => {
        const folder = records.find((o) => o.id !== undefined && vaultPageId(o.id, letters) === vaultPageId(id, letters) && isFolderSettingsPath(o.path))
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
    if (err instanceof Checked) return 1
    if (err instanceof Usage) {
      io.stderr(`${err.message}\n${USAGE}\n`)
      return 2
    }
    io.stderr(`${err instanceof Error ? err.message : String(err)}\n`)
    return 1
  }
}
