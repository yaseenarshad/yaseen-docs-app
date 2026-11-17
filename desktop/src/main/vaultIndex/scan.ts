import type { Stats } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { isDrawing } from '@shared/fileKind'
import { indexRecord, type IndexRecordMeta } from '@shared/indexRecord'
import { IDS_FILE, idsAnswer } from '@shared/pageId'
import { FOLDER_SETTINGS_FILE, MAX_FILE_BYTES, VAULT_CONFIG_DIR, type IndexRecord } from '@shared/types'
import { fsCall, isMarkdown, isSkipped } from '../fs/fsUtils'

/**
 * Markdown files under `dir`, skipping dot-entries / node_modules; unreadable subdirs are skipped like `buildTree`.
 * A folder's settings file is the one dot-entry it keeps (YAZ-2290 D8). `dirs` takes every folder walked into: the ones the tree shows.
 * `boards` takes every `.excalidraw`: the index reads each one's ID off its head (YAZ-3943 4C).
 */
export async function walk(dir: string, out: string[], dirs?: string[], boards?: string[]): Promise<void> {
  const dirents = await readdir(dir, { withFileTypes: true })
  await Promise.all(
    dirents.map(async (e) => {
      if (isSkipped(e.name) && !(e.isFile() && e.name === FOLDER_SETTINGS_FILE)) return
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        dirs?.push(full)
        await walk(full, out, dirs, boards).catch(() => undefined)
      } else if (e.isFile() && isMarkdown(e.name)) out.push(full)
      else if (boards !== undefined && e.isFile() && isDrawing(e.name)) boards.push(full)
    }),
  )
}

/**
 * Does the folder `dir` answer for the IDs of its own pages (YAZ-4922 🔒 D1)? Only when its `.yaseendocs/ids.json`
 * holds an answer, yes or no (`idsAnswer`): then it is the ID vault of each page under it (`idVault`). A file that
 * is missing, unreadable or not JSON has not answered.
 */
export const answersIds = (dir: string): Promise<boolean> =>
  readFile(path.join(dir, VAULT_CONFIG_DIR, IDS_FILE), 'utf8').then(
    (raw) => {
      try {
        return idsAnswer(JSON.parse(raw)) !== undefined
      } catch {
        return false
      }
    },
    () => false,
  )

/**
 * THE BORDER OF A VAULT'S ID WORK (YAZ-4922 🔒 D1), for one pass: is the file at `p` (a page, a board or a folder's
 * settings file) one whose ID is the vault at `root`'s? It is not when a folder between them answers for itself
 * (`answersIds`): that folder is a vault inside the vault, and the page's ID is its. The vault still LISTS that page
 * (its sidebar, its search, its links); only the ID work stops at the border. Each folder is read once for the pass:
 * a pass that starts later reads again, so a vault made inside this one meanwhile counts at once. `answers` keeps the
 * reads longer, for what the index only SHOWS (the counts of the box): the live index clears it when folders change.
 */
export function idsOwnedBy(root: string, answers = new Map<string, Promise<boolean>>()): (p: string) => Promise<boolean> {
  const answered = (dir: string): Promise<boolean> => {
    let held = answers.get(dir)
    if (held === undefined) answers.set(dir, (held = answersIds(dir)))
    return held
  }
  return async (p) => {
    for (let dir = path.dirname(p); dir.startsWith(root + path.sep); dir = path.dirname(dir)) if (await answered(dir)) return false
    return true
  }
}

/**
 * The ID vault of `p` within the vault at `root` (YAZ-4922 🔒 D1, `idVault`'s rule): the nearest folder at or above `p`
 * that answers for its own IDs, up to `root` itself. A page made inside a vault inside `root` takes THAT vault's IDs.
 */
export async function idsHome(root: string, p: string): Promise<string> {
  for (let dir = p; dir.startsWith(root + path.sep); dir = path.dirname(dir)) if (await answersIds(dir)) return dir
  return root
}

/** The items of `items` that `own` says yes to, in order. */
export async function ownOnly<T>(items: readonly T[], own: (item: T) => Promise<boolean>): Promise<T[]> {
  const yes = await Promise.all(items.map(own))
  return items.filter((_, i) => yes[i])
}

/** What the record says of the file at `absPath` under `root` from its path and its `stat` (`indexRecord`'s `meta`). */
function fileMeta(root: string, absPath: string, st: Stats): IndexRecordMeta {
  const name = path.basename(absPath)
  const ext = path.extname(name)
  return {
    path: absPath,
    name,
    basename: name.slice(0, name.length - ext.length),
    folder: path.relative(root, path.dirname(absPath)).split(path.sep).join('/'),
    ext: ext.slice(1).toLowerCase(),
    size: st.size,
    ctime: st.birthtimeMs > 0 ? st.birthtimeMs : st.ctimeMs,
    mtime: st.mtimeMs,
  }
}

/**
 * Builds the index record for one markdown file under `root` (GRO-2128): stat + read, then `indexRecord`
 * (`shared/indexRecord.ts`, YAZ-5068): frontmatter parse + tag/link extraction off the text. Files over
 * MAX_FILE_BYTES get metadata only. fs errors surface as BridgeFailure.
 */
export async function scanFile(root: string, absPath: string): Promise<IndexRecord> {
  const st = await fsCall(absPath, () => stat(absPath))
  const meta = fileMeta(root, absPath, st)
  if (st.size > MAX_FILE_BYTES) return indexRecord(meta, null)
  return indexRecord(meta, await fsCall(absPath, () => readFile(absPath, 'utf8')))
}
