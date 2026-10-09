import { rm } from 'node:fs/promises'
import path from 'node:path'
import { isRecord } from '@shared/guards'
import { parseFrontmatter, splitFrontmatter } from '@shared/frontmatter'
import { rewriteIds, type IdChange } from '@shared/linkRewrite'
import { NOTE_ID_KEY, canonicalNoteId, isNoteId, isNumberId, noteIdNumber, numberId, vaultNoteId } from '@shared/noteId'
import { TITLE_KEY, noteFileName, titleOf } from '@shared/noteName'
import { VAULT_CONFIG_DIR, isFolderSettingsPath, type IdsState, type IndexRecord, type RenameFileResponse } from '@shared/types'
import { readFile, writeFile } from '../fs/file'
import { renameFile } from '../fs/rename'
import { readConfigDetailed, writeConfig } from '../vaultConfig'
import { namedIds } from './diary'
import { highestNumber, mintIds } from './mint'
import { walk } from './scan'

/**
 * THE TWO CHANGES OF EVERY ID IN A VAULT (YAZ-2677 🔒 D5, D6), each asked for by the user in
 * Settings and so run at once on this Mac (R32):
 *
 *  - "Change letters" (`reletter`): each number ID with letters the vault had before takes the
 *    letters it has now. The number never changes, and an old 12-character ID has no letters (S87).
 *  - "Give old IDs numbers" (`backfill`): each old ID takes the vault's next number.
 *
 * Both are ONE PASS over the vault's Markdown files (`rewriteVault`): `rewriteIds` with the file's
 * own `id:` line, then the file's name where the app built it from the title and the ID (R8, R26).
 *
 * 🔒 SAFE TO RUN AGAIN, AND TO STOP ANYWHERE. Each write is a compare-and-set against the bytes and
 * mtime read (as the sweep's), a file that names no changed ID keeps each byte, and the content is
 * written BEFORE the name: a run that stopped between the two is finished by the next, which finds
 * the new ID under the old name (`former`).
 */

/** Hears each file that took a new name, at once: the bridge repairs its open tab, its favorite and each stored path (S86). */
export type Renamed = (res: RenameFileResponse) => Promise<unknown>

/** What a pass did, for the index: it must not wait for the watcher to tell what the user just asked for. */
export interface Pass {
  /** Each file that names a changed ID and could not be written. */
  left: string[]
  /** Each file written or renamed, by the path it has now. */
  changed: string[]
  /** Each path a renamed file left. */
  gone: string[]
}

const newPass = (): Pass => ({ left: [], changed: [], gone: [] })

/** The IDs that the ID a file holds now had before: its file name can still be built from one of them. */
type Former = (id: string) => readonly string[]

/** The path `file` takes when its name was built from its title and an ID it had before; undefined when it keeps its name. */
function nameAfter(file: string, content: string, former: Former): string | undefined {
  if (isFolderSettingsPath(file)) return undefined
  const { properties, error } = parseFrontmatter(splitFrontmatter(content).frontmatter)
  const held = error === undefined ? properties[NOTE_ID_KEY] : undefined
  if (!isNoteId(held)) return undefined
  const id = canonicalNoteId(held)
  const title = titleOf({ [TITLE_KEY]: properties[TITLE_KEY] }, '')
  const name = path.basename(file)
  return former(id).some((before) => before !== id && name === noteFileName(title, before)) ? path.join(path.dirname(file), noteFileName(title, id)) : undefined
}

/**
 * One file of the pass: its content by `change` (a compare-and-set, tried one more time when the
 * file changed under it), then its name. A file that names a changed ID and could not be written
 * goes to `pass.left`; a file that cannot be read is left as the index leaves it.
 */
async function rewriteOne(file: string, change: IdChange, former: Former, renamed: Renamed | undefined, pass: Pass): Promise<void> {
  const attempt = async (): Promise<{ content: string; wrote: boolean } | null> => {
    const page = await readFile(file).catch(() => null)
    if (page === null) return null
    const next = rewriteIds(page.content, change, { own: true })
    if (next.changed > 0) await writeFile({ path: file, content: next.content, expectedMtime: page.mtime })
    return { content: next.content, wrote: next.changed > 0 }
  }
  const done = await attempt()
    .catch(attempt)
    .catch(() => undefined)
  if (done === undefined) pass.left.push(file)
  if (done === undefined || done === null) return
  const newPath = nameAfter(file, done.content, former)
  // A neighbour holds the new name, or the rename failed: the note keeps its name, and its ID is right.
  const res = newPath === undefined ? undefined : await renameFile({ oldPath: file, newPath }).catch(() => undefined)
  if (res !== undefined) pass.gone.push(file)
  if (res !== undefined || done.wrote) pass.changed.push(res?.newPath ?? file)
  if (res !== undefined) await renamed?.(res)
}

/** The pass over `files`, one at a time and in path order: the same on each Mac. */
async function rewriteFiles(files: readonly string[], change: IdChange, former: Former, renamed: Renamed | undefined, pass: Pass): Promise<void> {
  for (const file of [...files].sort()) await rewriteOne(file, change, former, renamed, pass)
}

/** Each Markdown file of the vault as it is on disk now: the index can be a moment behind. */
async function markdownFiles(root: string): Promise<string[]> {
  const files: string[] = []
  await walk(root, files).catch(() => undefined)
  return files
}

// ---------- change letters ----------

/** `ids.json` after the vault takes `to` (S81, S85): the letters of before go to the front of `was`, and `to` leaves it. Each other key stays (R10). */
export function configWithLetters(config: Record<string, unknown>, letters: readonly string[], to: string): Record<string, unknown> {
  const was = letters.filter((before) => before !== to)
  return { ...config, letters: to, ...(was.length > 0 ? { was } : {}) }
}

/**
 * Each number ID with letters the vault had before becomes the same number with the letters of
 * now (`letters`, the current ones first). `ids.json` already holds them: this is the second step
 * of "Change letters", and the whole of "Finish" (S83).
 */
export async function reletter(root: string, letters: readonly string[], renamed?: Renamed): Promise<Pass> {
  const pass = newPass()
  if (letters.length < 2) return pass
  const change = (id: string): string | undefined => vaultNoteId(id, letters)
  await rewriteFiles(await markdownFiles(root), change, (id) => formerLetters(id, letters), renamed, pass)
  return pass
}

/** `id` with each of the letters the vault had before. An old ID had none. */
function formerLetters(id: string, letters: readonly string[]): string[] {
  const number = noteIdNumber(id)
  return number === undefined ? [] : letters.slice(1).map((before) => numberId(before, number))
}

/**
 * What Settings shows about a vault's IDs (`IdsState`), from the index in memory. `stale` counts a
 * file when its own ID, an ID it names, or its built file name still has letters the vault had before.
 */
export function idsStateOf(records: Iterable<IndexRecord>, letters: readonly string[]): IdsState {
  const current = `${letters[0]}-`
  const before = (id: string | undefined): boolean => id !== undefined && isNumberId(id) && !id.startsWith(current) && vaultNoteId(id, letters) !== undefined
  const state: IdsState = { letters: letters[0], notes: 0, stale: 0, old: 0 }
  for (const r of records) {
    const id = vaultNoteId(r.id, letters)
    if (id === undefined) continue
    if (!isNumberId(id)) state.old++
    else state.notes++
    if (letters.length < 2) continue
    const title = titleOf({ [TITLE_KEY]: r.properties[TITLE_KEY] }, '')
    const named = !isFolderSettingsPath(r.path) && formerLetters(id, letters).some((was) => r.name === noteFileName(title, was))
    if (before(r.id) || named || namedIds(r).some(before)) state.stale++
  }
  return state
}

// ---------- give old IDs numbers ----------

/** The plan of a backfill (D6): each old ID to the number ID it takes, saved in the vault BEFORE any note is written. */
export const BACKFILL_FILE = 'ids-backfill.json'

const isOldId = (id: unknown): id is string => isNoteId(id) && !isNumberId(id)

/** The plan in the vault, as far as it is one: an old ID to a number ID of this vault. Anything else is dropped. */
async function readPlan(root: string, letters: readonly string[]): Promise<Map<string, string>> {
  const held = await readConfigDetailed(root, BACKFILL_FILE).catch(() => undefined)
  const plan = new Map<string, string>()
  if (held?.state !== 'ok' || !isRecord(held.value)) return plan
  for (const [old, to] of Object.entries(held.value)) {
    const id = vaultNoteId(to, letters)
    if (isOldId(old) && id !== undefined && isNumberId(id)) plan.set(old, id)
  }
  return plan
}

/**
 * "Give old IDs numbers" (🔒 D6, S88 to S90). Each note, and each folder's settings file, that holds
 * an old 12-character ID takes the vault's next number: oldest file first (`ctime`, the file's
 * creation time), then the path, after the highest number in use, and all with ONE write of this
 * Mac's count file (R19).
 *
 * 🔒 THE PLAN (`BACKFILL_FILE`) is the map from each old ID to its number, on disk before any note
 * changes. A run that stopped is finished by the next with the SAME numbers: a note in the plan
 * takes the number of the plan, and only a note that is not in it is given a new one. The plan
 * goes when a run ends with no file left.
 *
 * 🔒 A NOTE TAKES ITS ID FIRST, THEN ITS LINKS FOLLOW: part A writes each old note's own `id:` line
 * (and its name), part B each link, `also_in` entry and folder-value key of the vault. So an old ID
 * that remains after a stop still works: its note holds it, and no link to it was changed (S90).
 */
export async function backfill(root: string, records: Iterable<IndexRecord>, letters: readonly string[], renamed?: Renamed): Promise<Pass> {
  const pass = newPass()
  const all = [...records]
  const olds = all.filter((r) => isOldId(r.id) && r.frontmatterError === undefined).sort((a, b) => a.ctime - b.ctime || (a.path < b.path ? -1 : 1))
  const plan = await readPlan(root, letters)
  // Two notes with one old ID are a copy: the sweep gives one of them its own number afterwards.
  const fresh = [...new Set(olds.map((r) => r.id as string))].filter((id) => !plan.has(id))
  if (fresh.length > 0) {
    // Higher than each number in the vault AND each the plan already holds.
    const floor = Math.max(highestNumber(all, letters), highestNumber([...plan.values()].map((id) => ({ id })), letters))
    const numbers = await mintIds(root, fresh.length, floor)
    if (numbers === null) return pass
    fresh.forEach((id, i) => plan.set(id, numbers[i]))
    await writeConfig(root, BACKFILL_FILE, Object.fromEntries(plan))
  }
  if (plan.size === 0) return pass
  const former: Former = (id) => [...plan].filter(([, to]) => to === id).map(([old]) => old)
  // Part A, oldest first: the note's own ID. Its links wait for part B.
  for (const r of olds) {
    const id = r.id as string
    await rewriteOne(r.path, new Map([[id, plan.get(id) as string]]), former, renamed, pass)
  }
  // Part B: each file as it is named now. A file part A could not write is tried again here.
  pass.left = []
  await rewriteFiles(await markdownFiles(root), plan, former, renamed, pass)
  if (pass.left.length === 0) await rm(path.join(root, VAULT_CONFIG_DIR, BACKFILL_FILE), { force: true }).catch(() => undefined)
  return pass
}
