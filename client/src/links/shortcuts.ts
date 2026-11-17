/**
 * Shortcuts (YAZ-2290 D2): a page lives in exactly ONE folder and may also APPEAR in others.
 * The shortcut is stored on the page — `also_in`, a list of FOLDER IDS, a folder's id being the
 * `id` of its `.folder.md` (YAZ-2293) — so it is the same file wherever it shows, and nothing is
 * rewritten when a folder or a page is renamed or moved. This module is the one door to that key.
 *
 * WHAT A FOLDER SHOWS (D4): the pages under it at any depth, plus those whose `also_in` holds its
 * id or the id of a folder under it — each once, in the index's order (`foldersShowing` is the
 * rule from the page's side). The vault root's entry is the pages directly in it. An `also_in`
 * entry no folder has is ignored.
 */
import { ALSO_IN_KEY, alsoIn, alsoInEntries } from '@shared/alsoIn'
import { parseFrontmatter, setFrontmatterProperty, splitFrontmatter } from '@shared/frontmatter'
import { PAGE_ID_KEY, canonicalPageId, isPageId } from '@shared/pageId'
import { folderSettingsPath, inFolder, type IndexRecord } from '@shared/types'
import { dirname } from '../lib/paths'
import { takePageId } from '../views/scaffold'
import { transformFile } from '../views/writeProperty'
import { folderRecord, foldersById } from './folderRows'

// The pure part, what a folder shows (YAZ-5460), is `folderRows.ts`: the phone reads it with no bridge.
export * from './folderRows'
const propertiesOf = (content: string): Record<string, unknown> => parseFrontmatter(splitFrontmatter(content).frontmatter).properties

/**
 * The id of the folder at `dir`, for its first shortcut or the first value written for it (D19): a
 * folder with no `.folder.md` gets one holding just its id (that write creates the file,
 * `readForWrite`), and a file with no id, or another tool's (YAZ-2420 🔒 D30), is given a fresh one.
 * Asked of the file's own bytes, never the index: a snapshot one write behind would give a second
 * id over the first, and every shortcut and value naming the first would be lost.
 *
 * The fresh id is the vault's next number, from the door (YAZ-2677 D4), taken only when the file
 * is seen to hold none: a folder that has its id costs no number. Returned as the index holds it (R2).
 */
export async function folderId(dir: string): Promise<string> {
  const file = folderSettingsPath(dir)
  const held = (bytes: string): string | undefined => {
    const id = propertiesOf(bytes)[PAGE_ID_KEY]
    return isPageId(id) ? canonicalPageId(id) : undefined
  }
  // A transform that changes nothing is a read: it writes nothing, and makes no file where there is none.
  const there = held((await transformFile(file, (bytes) => bytes)).content)
  if (there !== undefined) return there
  const fresh = await takePageId(dir)
  // Written against the file's bytes as they are now: an id that arrived since the read above stays.
  // Quiet (YAZ-3235 D1): a folder's id is the app's bookkeeping, not an edit the user made.
  const { content } = await transformFile(file, (bytes) => (held(bytes) === undefined ? setFrontmatterProperty(bytes, PAGE_ID_KEY, fresh) : bytes), true)
  return held(content) ?? fresh
}

/**
 * Make the page at `path` also appear in the folder at `dir` (D2): the folder's id joins the
 * page's `also_in` — once, and beside every entry already there, understood or not. Answers the id
 * it added, or null when the page held it already (checker 8E: an Undo then has nothing to take back).
 */
export async function addShortcut(dir: string, path: string): Promise<string | null> {
  const id = await folderId(dir)
  let added: string | null = null
  await transformFile(path, (content) => {
    const list = alsoInEntries(propertiesOf(content))
    if (list.some((entry) => asId(entry) === id)) return content
    added = id
    return setFrontmatterProperty(content, ALSO_IN_KEY, [...list, id])
  })
  return added
}

/**
 * The exact Undo of one add or one remove (checker 8E): `drop` leaves the page's `also_in`, `restore` joins it again
 * (each once, beside what is there), and nothing else changes — never the folders under one, as `removeShortcut` does.
 */
export function setShortcutEntries(path: string, change: { drop?: readonly unknown[]; restore?: readonly unknown[] }): Promise<unknown> {
  const drop = new Set((change.drop ?? []).map(asId))
  return transformFile(path, (content) => {
    const list = alsoInEntries(propertiesOf(content))
    const kept = list.filter((entry) => !drop.has(asId(entry)))
    const back = (change.restore ?? []).filter((entry) => !kept.some((k) => asId(k) === asId(entry)))
    const next = [...kept, ...back]
    if (next.length === list.length && next.every((entry, i) => entry === list[i])) return content
    return setFrontmatterProperty(content, ALSO_IN_KEY, next.length === 0 ? undefined : next)
  })
}

/** An `also_in` entry as the id it names (`alsoIn`'s reading, YAZ-2677 R2: `yaz-12` names `YAZ-12`); any other entry as it is. */
const asId = (entry: unknown): unknown => (isPageId(entry) ? canonicalPageId(entry) : entry)

/** The ids of the folder at `dir` and of every folder under it. */
const idsUnder = (folders: readonly IndexRecord[], dir: string): Set<unknown> => new Set(folders.filter((folder) => inFolder(dirname(folder.path), dir)).map((folder) => folder.id))

/**
 * Take the page at `path` out of the folder at `dir` (E5): the ids of that folder and of every
 * folder under it leave its `also_in`, and the key goes with its last entry — an emptied list is
 * no list, the comments store's rule (`shared/comments.ts`). The page itself stays where it lives,
 * and keeps every value (YAZ-4713 C9): a value that folder kept for it is listed in its properties, with Clear.
 */
export async function removeShortcut(dir: string, path: string, folders: readonly IndexRecord[]): Promise<unknown[]> {
  const ids = idsUnder(folders, dir)
  // The entries it took out, as written (checker 8E): its Undo puts back exactly these.
  let removed: unknown[] = []
  await transformFile(path, (content) => {
    const list = alsoInEntries(propertiesOf(content))
    const kept = list.filter((entry) => !ids.has(asId(entry)))
    removed = list.filter((entry) => ids.has(asId(entry)))
    return kept.length === list.length ? content : setFrontmatterProperty(content, ALSO_IN_KEY, kept.length === 0 ? undefined : kept)
  })
  return removed
}

/** One in-app move or rename of a page or a folder, as the rename door and a pasted Cut name it. */
export interface Move {
  oldPath: string
  newPath: string
  kind: 'file' | 'dir'
}

