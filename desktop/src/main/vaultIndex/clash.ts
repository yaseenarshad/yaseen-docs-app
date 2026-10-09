import path from 'node:path'
import { rewriteIds } from '@shared/linkRewrite'
import { vaultNoteId } from '@shared/noteId'
import { TITLE_KEY, noteFileName, titleOf } from '@shared/noteName'
import { isFolderSettingsPath, type IndexRecord } from '@shared/types'
import { readFile, writeFile } from '../fs/file'
import { renameFile } from '../fs/rename'
import { namedIds, saveDiary, type Book } from './diary'
import { highestNumber, mintIds, type Counts, type Maker } from './mint'

/**
 * A CLASH (YAZ-2677 🔒 D7, R22 to R30a): two Macs that sync one vault each gave the same number
 * before a sync, and after it both hold two notes with one ID. Exactly ONE Mac fixes it, so the two
 * never write conflicting edits:
 *
 *  - the note of the Mac that gave the number FIRST keeps the ID (`makersOf`, R23);
 *  - each other Mac that gave it fixes ITS OWN note — the one its index held with the ID before the
 *    other arrived (R25, `myNote`) — and a Mac that did not give the number writes nothing (R24);
 *  - the fix gives that note the next number, changes the links this Mac's diary says meant it
 *    (R28), and reports one notice (R26, S45).
 *
 * Any other two notes with one ID are a COPY, and the sweep's own rule settles them (R30).
 *
 * 🔒 SAFE TO RUN AGAIN, AND TO STOP ANYWHERE. The new number is saved in the diary before the vault
 * changes, the links go first and the note takes its ID LAST: a fix that stops leaves the note
 * still holding the old ID, so the next sweep finds the pair, finds the saved number and continues
 * — it never takes a second number, and a link that already changed names the old ID no more.
 *
 * 🔒 The number stays in this Mac's `made` after the fix. Took out, the other Mac could read the
 * pair as a copy for a moment (a count file can arrive before a note) and renumber the same note:
 * two Macs writing one line. So for as long as both count files hold the number, only THIS Mac
 * writes for it: a note that holds the ID later is a copy that this Mac renumbers at once.
 */

/** A link the diary first saw less than this before the other note arrived may have meant either note: it is listed, not changed (R28). */
export const LINK_GRACE_MS = 5000

/** Two or more notes on disk with one ID, as the sweep found them. */
export interface Pair {
  root: string
  /** The vault's ID letters, the current ones first. */
  letters: readonly string[]
  /** The ID they hold, as the vault writes it now. */
  id: string
  /** The notes that hold it, each another file on disk, in path order. */
  sharing: readonly IndexRecord[]
  /** The id the index held for a path before this sweep's event. */
  knew: (path: string) => string | undefined
  /** The live index, to list the links that are not changed. */
  records: ReadonlyMap<string, IndexRecord>
}

/** One note that took a new number. */
export interface ClashFix {
  /** The ID two Macs gave. */
  id: string
  /** The number the note has now. */
  to: string
  title: string
  /** Where the note is now. */
  path: string
  /** Set when its file name held the ID and followed it (R26). */
  renamedFrom?: string
  /** Links changed to the new number. */
  links: number
  /** The title of each file that names the old ID and was not changed (R28, S44). */
  left: string[]
  /** This Mac could not tell which note it made (R29): no link was changed. */
  blind?: true
}

export type ClashOutcome =
  /**
   * Another Mac fixes it, and this one writes nothing (R24). `other` is the title of the note that
   * will change and `keeper` the path of the note that keeps the ID, when this Mac knows them (S46, S57).
   */
  | { kind: 'theirs'; other?: string; keeper?: string }
  /** This Mac's note left the ID before: the notes that hold it now are a copy, and this Mac renumbers it at once. */
  | { kind: 'copy' }
  | { kind: 'fixed'; fixes: ClashFix[] }
  /** A file changed under the fix, or the door gave no number: the next sweep continues. `keeper` as above. */
  | { kind: 'later'; keeper?: string }

/** How the sweep writes: its own compare-and-set, one write at a time. */
export interface SweepWrites {
  /** Do the bytes of `file` still hold `held`, and can it be written? Asked before a number is taken for it: one that could not be used is a gap. */
  needs(file: string, held: string): Promise<boolean>
  /** The file takes `to` while it still holds `held`; `first` runs before, with the new id. False when it took none. */
  give(file: string, held: string, to: string, first?: (to: string) => Promise<void>): Promise<boolean>
  /** A folder's notes carry their values for it from `from` to `to` (`carryFolderValues`). */
  carry(dir: string, from: string, to: string): Promise<void>
}

/**
 * THE NOTE THIS MAC KNEW FIRST of the pair (R25, R30): the one its index held with the ID before
 * the other arrived. In a clash it is this Mac's own note; in a copy it is the original. Said
 * once, at the first sight of the pair, and kept in the diary — the index holds both notes from
 * then on, and a number that waits for the vault's first Mac (R31) is given long after.
 * Undefined when this Mac cannot tell (R29).
 */
export function myNote(book: Book, pair: Pair, now: number): IndexRecord | undefined {
  const entry = book.clashes.get(pair.id)
  const held = entry === undefined ? undefined : pair.sharing.find((r) => r.path === entry.mine)
  if (held !== undefined) return held
  // The note the diary named is not among them: it took its number (and the app stopped before it said so), moved, or is gone.
  const done = entry?.done === true || entry?.to !== undefined
  const known = pair.sharing.filter((r) => vaultNoteId(pair.knew(r.path), pair.letters) === pair.id)
  if (known.length === 1) {
    book.clashes.set(pair.id, { mine: known[0].path, at: now, ...(done && { done: true as const }) })
    book.dirty = true
    return known[0]
  }
  if (entry !== undefined && done && entry.done !== true) {
    entry.done = true
    book.dirty = true
  }
  return undefined
}

/** The clash rule for one pair (R22 to R29). `makers` are the Macs that gave the number, the first in front: two or more. */
export async function settleClash(pair: Pair, counts: Counts, makers: readonly Maker[], book: Book, now: number, writes: SweepWrites): Promise<ClashOutcome> {
  // A Mac that did not give the number made neither note: it writes nothing, and names none (R24).
  if (!makers.some((m) => m.mac === counts.me)) return { kind: 'theirs' }
  const mine = myNote(book, pair, now)
  const entry = book.clashes.get(pair.id)
  if (makers[0].mac === counts.me) return { kind: 'theirs', ...(mine !== undefined && { other: pair.sharing.find((r) => r.path !== mine.path)?.title, keeper: mine.path }) }
  if (entry?.done === true) return { kind: 'copy' }
  if (mine === undefined || entry === undefined) return blindFix(pair, book, now, writes)

  const { root, id } = pair
  /** Until this Mac's note takes its number, the other note is the one the ID opens (S46). */
  const later: ClashOutcome = { kind: 'later', keeper: pair.sharing.find((r) => r.path !== mine.path)?.path }
  // Nothing is taken or changed for a note that cannot take its number now: the links would name an ID no note holds.
  if (!(await writes.needs(mine.path, id))) return later
  if (entry.to === undefined) {
    // The sweep holds the vault's notes: the door is told their highest number, as for every number a sweep takes.
    const to = (await mintIds(root, 1, highestNumber(pair.records.values(), pair.letters)).catch(() => null))?.[0]
    if (to === undefined) return later
    entry.to = to
    book.dirty = true
    // On disk before the vault changes: a fix that stops here continues with this number.
    if (!(await saveDiary(root).then(() => true, () => false))) return later
  }
  const to = entry.to
  // The links that meant this Mac's note (R28), then the note itself, last.
  const before = entry.at - LINK_GRACE_MS
  const meant = [...(book.links.get(id) ?? [])].filter(([, seen]) => seen < before)
  /** The files that name the old ID no more: the note itself, and each link file that was changed now or before. */
  const settled = new Set([mine.path])
  for (const [file] of meant) {
    const links = await rewriteFile(file, id, to)
    if (links === null) continue
    settled.add(file)
    if (links === 0) continue
    entry.links = (entry.links ?? 0) + links
    book.dirty = true
  }
  const dir = path.dirname(mine.path)
  if (!(await writes.give(mine.path, id, to, isFolderSettingsPath(mine.path) ? (given) => writes.carry(dir, id, given) : undefined))) return later
  const renamedTo = await followName(mine, id, to)
  entry.done = true
  // The links follow the note in the diary too, with the times they were first seen.
  book.links.delete(id)
  if (meant.length > 0) book.links.set(to, new Map([...(book.links.get(to) ?? []), ...meant]))
  book.dirty = true
  await saveDiary(root).catch(() => undefined)
  return {
    kind: 'fixed',
    fixes: [{ id, to, title: mine.title, path: renamedTo ?? mine.path, ...(renamedTo !== undefined && { renamedFrom: mine.path }), links: entry.links ?? 0, left: leftLinks(pair, settled) }],
  }
}

/**
 * R29: this Mac must fix and cannot tell which note it made (its index cache is lost). The first
 * note in path order keeps the ID, each other takes the next number, and no link is changed.
 */
async function blindFix(pair: Pair, book: Book, now: number, writes: SweepWrites): Promise<ClashOutcome> {
  const { root, id, sharing } = pair
  const later: ClashOutcome = { kind: 'later', keeper: sharing[0].path }
  const takes = await Promise.all(sharing.slice(1).map((r) => writes.needs(r.path, id)))
  const others = sharing.slice(1).filter((_, i) => takes[i])
  if (others.length === 0) return later
  const numbers = await mintIds(root, others.length, highestNumber(pair.records.values(), pair.letters)).catch(() => null)
  if (numbers === null) return later
  const fixes: ClashFix[] = []
  for (const [i, r] of others.entries()) {
    const to = numbers[i]
    const dir = path.dirname(r.path)
    if (!(await writes.give(r.path, id, to, isFolderSettingsPath(r.path) ? (given) => writes.carry(dir, id, given) : undefined))) continue
    const renamedTo = await followName(r, id, to)
    fixes.push({ id, to, title: r.title, path: renamedTo ?? r.path, ...(renamedTo !== undefined && { renamedFrom: r.path }), links: 0, left: leftLinks(pair, new Set(sharing.map((s) => s.path))), blind: true })
  }
  if (fixes.length < sharing.length - 1) return fixes.length === 0 ? later : { kind: 'fixed', fixes }
  book.clashes.set(id, { mine: '', at: now, done: true })
  book.dirty = true
  return { kind: 'fixed', fixes }
}

/**
 * Each `from` in `file` becomes `to` (`rewriteIds`): a compare-and-set, tried one more time when the
 * file changed under it. Resolves to the links changed — 0 for a file that names `from` no more —
 * and null for a file that is gone, cannot be read, or is being written: its link is then listed.
 */
async function rewriteFile(file: string, from: string, to: string): Promise<number | null> {
  const attempt = async (): Promise<number> => {
    const { content, mtime } = await readFile(file)
    const next = rewriteIds(content, new Map([[from, to]]))
    if (next.changed > 0) await writeFile({ path: file, content: next.content, expectedMtime: mtime })
    return next.changed
  }
  return attempt().catch(attempt).catch(() => null)
}

/**
 * A note whose file name is the one the app builds from its title and its ID (`noteFileName`) gets
 * the name of its new ID (R26). Resolves to the new path; undefined when the name was not built, a
 * neighbour holds the new one, or the rename failed — the note keeps its name, and the ID is right.
 */
async function followName(note: IndexRecord, from: string, to: string): Promise<string | undefined> {
  const title = titleOf({ [TITLE_KEY]: note.properties[TITLE_KEY] }, '')
  if (isFolderSettingsPath(note.path) || path.basename(note.path) !== noteFileName(title, from)) return undefined
  const newPath = path.join(path.dirname(note.path), noteFileName(title, to))
  return renameFile({ oldPath: note.path, newPath }).then(
    () => newPath,
    () => undefined,
  )
}

/** The title of each indexed file that names the pair's ID and is not in `settled`, in path order: the links the notice lists (S44, S45). */
function leftLinks(pair: Pair, settled: ReadonlySet<string>): string[] {
  const left: IndexRecord[] = []
  for (const r of pair.records.values()) {
    if (!settled.has(r.path) && namedIds(r).some((named) => vaultNoteId(named, pair.letters) === pair.id)) left.push(r)
  }
  return left.sort((a, b) => (a.path < b.path ? -1 : 1)).map((r) => r.title)
}

const LISTED_MAX = 5
const quoted = (titles: readonly string[]): string => {
  const shown = titles.slice(0, LISTED_MAX).map((title) => `"${title}"`)
  return titles.length > LISTED_MAX ? `${shown.join(', ')} and ${titles.length - LISTED_MAX} more` : shown.join(', ')
}
const count = (n: number, what: string): string => `${n} ${what}${n === 1 ? '' : 's'}`

/** The ONE notice of a fix (S45): what was on two Macs, what the note is now, how many links followed, and each link that did not. */
export function fixNotice(fixes: readonly ClashFix[]): string {
  const said = fixes.map((fix) => {
    const head = `${fix.id} was used on two Macs. "${fix.title}" is now ${fix.to}.`
    if (fix.blind === true) return `${head} No link was changed: this Mac could not tell which note it made.${fix.left.length > 0 ? ` Check the links in ${quoted(fix.left)}.` : ''}`
    return `${head} ${count(fix.links, 'link')} updated.${fix.left.length > 0 ? ` Not changed: ${quoted(fix.left)}.` : ''}`
  })
  return said.join(' ')
}

/** The line for a pair another Mac must fix (S57). */
export const theirsLine = (id: string, other: string | undefined): string =>
  `${id} is on two notes. The Mac that made ${other === undefined ? 'the newer note' : `"${other}"`} fixes it when its app runs.`

/** What "Check for duplicates" tells, in one line (S55 to S57): each note that took a number, and each ID another Mac must fix. */
export function checkLine({ fixes, theirs, copies, later }: { fixes: readonly ClashFix[]; theirs: readonly { id: string; other?: string }[]; copies: readonly { title: string; id: string }[]; later: readonly string[] }): string {
  const said: string[] = []
  if (fixes.length > 0) said.push(fixNotice(fixes))
  if (copies.length > 0) {
    const shown = copies.slice(0, LISTED_MAX).map(({ title, id }) => `"${title}" is now ${id}`)
    said.push(`Fixed ${copies.length}: ${shown.join(', ')}${copies.length > LISTED_MAX ? ` and ${copies.length - LISTED_MAX} more` : ''}.`)
  }
  for (const { id, other } of theirs) said.push(theirsLine(id, other))
  if (later.length > 0) said.push(`${[...new Set(later)].slice(0, LISTED_MAX).join(', ')} could not be fixed now: a file changed during the check. Check again.`)
  return said.length === 0 ? 'No duplicates.' : said.join(' ')
}
