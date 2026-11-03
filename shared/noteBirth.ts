/**
 * Birth of a note (YAZ-2290 E1/E3) and of a daily note (YAZ-3607): the ONE set of rules, for the app and the command
 * (YAZ-4269 D1). The rules are here and the disk is the caller's: the renderer passes its bridge (`bridgeDisk`), the
 * main process and the command `main/fs` (`noteDisk`).
 */
import { buildFrontmatter, parseFrontmatter, splitFrontmatter } from './frontmatter'
import { plainEntryName } from './entryName'
import { TITLE_KEY, kebabTitle, noteFileName } from './noteName'
import type { CreateDirRequest, CreateFileRequest, IndexRecord, SettingsState } from './types'

/** What the rules need of a disk. */
export interface NoteDisk {
  /** A file's content; null when it is not there. Any other failure propagates. */
  read(path: string): Promise<string | null>
  /** Never over a file: one that is there is refused (`isThere`). */
  createFile(req: CreateFileRequest): Promise<unknown>
  createDir(req: CreateDirRequest): Promise<unknown>
  /** The next ID of the vault that holds `path`, from its door (YAZ-2677 🔒 D4); refused where the vault does not use IDs. */
  mintId(path: string): Promise<string>
  /** True when `err` refused a file or a folder because it is there (`ALREADY_EXISTS`). */
  isThere(err: unknown): boolean
}

/** What a folder view's "New" makes of the template's properties: its seeded values (`FolderView`). */
export type Seed = (template: Record<string, unknown>) => Record<string, unknown>

export type DailyNoteSettings = Pick<SettingsState, 'dailyNoteFolder' | 'dailyNoteDayFolder'>

/** A note found or made (YAZ-4269 D2, D5, D7, D8): a day's daily note, or `yaseendocs new`'s. `id` is null in a vault without IDs; `others` are the other notes of that title. */
export interface FoundNote {
  path: string
  title: string
  id: string | null
  created: boolean
  others: string[]
}

/**
 * Birth (YAZ-2290 E1/E3), the ONE way a note is created: in `dir`, with its folder's template — the
 * hidden `.template.md` beside it, frontmatter and body — and what `seed` makes of the template's
 * properties. Nothing else: no column is ever stamped empty, a missing value is an empty cell. ONE
 * atomic call (`CreateFileRequest.content`, GRO-2202), so it never overwrites and there is no
 * create-then-write race. Failures propagate.
 *
 * It is born titled (YAZ-2420 🔒 D20): `title` is free text and is the note's `title`, whatever the
 * template or the seed says, and its file name is built from it and the note's id (`noteFileName`).
 * The id is the vault's next number, taken from the door BEFORE the note is made (`mintId`,
 * YAZ-2677 D4, R18): the name needs it. `id` is for a caller that has already taken it, and
 * written a link to the note (YAZ-2293). `templateAt` is for a caller whose template is not beside the note: a daily
 * note in its day folder takes the daily notes folder's (YAZ-3607 D6). `body`, when given, takes the place of the
 * template's body (YAZ-4269 D4: the command's `--body`). Resolves the note's path.
 *
 * All of that where the vault uses IDs (`ids`). In a vault that does not use IDs (YAZ-2523 🔒 V3)
 * `title` is the file's name (`plainEntryName`) and nothing is written about the note inside it:
 * with no seed and no body it is the template as it is, and else what the seed returns and the body.
 */
export async function createNote(disk: NoteDisk, dir: string, title: string, ids: boolean, seed?: Seed, id?: string, templateAt = `${dir}/.template.md`, body?: string): Promise<string> {
  // A name a file cannot hold is refused before anything is read or made.
  const plain = ids ? undefined : `${dir}/${plainEntryName(title, 'file')}`
  const template = (await disk.read(templateAt)) ?? ''
  const split = splitFrontmatter(template)
  const { properties } = parseFrontmatter(split.frontmatter)
  const seeded = seed === undefined ? properties : seed(properties)
  const text = body ?? split.body
  if (plain !== undefined) {
    await disk.createFile({ path: plain, content: seed === undefined && body === undefined ? template : buildFrontmatter(seeded) + text })
    return plain
  }
  // The number LAST before the create: a template that cannot be read costs none.
  const born = id ?? (await disk.mintId(dir))
  const path = `${dir}/${noteFileName(title, born)}`
  await disk.createFile({ path, content: buildFrontmatter({ ...seeded, [TITLE_KEY]: title }) + text, id: born })
  return path
}

/**
 * Where the folder titled `title` stands in `parent` (YAZ-2420 🔒 D6): its name is the title in
 * kebab-case. A title with no letter or digit has no such name and is refused (🔒 D25). In a
 * vault that does not use IDs its name is the title as typed (`plainEntryName`).
 */
export function folderPath(parent: string, title: string, ids: boolean): string {
  if (!ids) return `${parent}/${plainEntryName(title, 'dir')}`
  const name = kebabTitle(title)
  if (name === '') throw new Error('A folder name needs a letter or a digit')
  return `${parent}/${name}`
}

/**
 * The note titled `title` is found by its TITLE, not by its file name (YAZ-3607 D3): a vault that uses IDs builds the
 * file name from the title and the id (`2026-10-28-yaz-41.md`). In a vault that does not use IDs the title is the file
 * name, so one rule serves both.
 *
 * Every note titled `title` in the daily notes folder `folder` (root-relative), or one level down in its day folder
 * (D9), the one that is today's first; empty when the vault has none yet. Both layouts are asked, the one `dayFolder`
 * names first: "Make a folder for each day" switched in the middle of a day finds the note made before the switch,
 * never a second one. A day folder carries the day's name, as it is made: the title in a vault without IDs, its
 * kebab-case in one with them (`folderPath`). So a note of that title in another folder is never the day's. More than
 * one is two notes of one day (YAZ-4269 D8): the command warns about the others.
 */
export function dailyNotes(records: readonly IndexRecord[], folder: string, title: string, dayFolder: boolean): string[] {
  const dayNames = new Set([title.trim(), kebabTitle(title)])
  const flat = (at: string) => at === folder
  const inDay = (at: string) => {
    const cut = at.lastIndexOf('/')
    return (cut === -1 ? '' : at.slice(0, cut)) === folder && at !== folder && dayNames.has(at.slice(cut + 1))
  }
  const [first, then] = dayFolder ? [inDay, flat] : [flat, inDay]
  const titled = records.filter((r) => r.title === title)
  return [...titled.filter((r) => first(r.folder)), ...titled.filter((r) => then(r.folder))].map((r) => r.path)
}

/** The day's note of `dailyNotes`, or null when the vault has none yet. One pass over the records, nothing read from disk. */
export function findDailyNote(records: readonly IndexRecord[], folder: string, title: string, dayFolder: boolean): string | null {
  return dailyNotes(records, folder, title, dayFolder)[0] ?? null
}

/**
 * Makes the note titled `title` (YAZ-3607 D5) in the daily notes folder of `vault`. A day folder (D9) is made when it
 * is missing, or used when it stands. The template is the daily notes folder's `.template.md`, in a day folder too
 * (D6). Never over a file: `createFile` refuses one (`isThere`).
 */
export async function makeDailyNote(disk: NoteDisk, vault: string, settings: DailyNoteSettings, title: string, ids: boolean): Promise<string> {
  const root = settings.dailyNoteFolder === '' ? vault : `${vault}/${settings.dailyNoteFolder}`
  let dir = root
  if (settings.dailyNoteDayFolder) {
    dir = folderPath(root, title, ids)
    try {
      await disk.createDir(ids ? { path: dir, title } : { path: dir })
    } catch (err) {
      if (!disk.isThere(err)) throw err
    }
  }
  try {
    return await createNote(disk, dir, title, ids, undefined, undefined, `${root}/.template.md`)
  } catch (err) {
    // A vault that does not use IDs names the file by the title: a note the index has not seen yet is the day's note.
    if (!ids && disk.isThere(err)) return `${dir}/${plainEntryName(title, 'file')}`
    throw err
  }
}
