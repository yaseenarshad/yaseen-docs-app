/**
 * A path as a name (YAZ-2420 🔒 D14), from the index alone, with no bridge and no Files tree (YAZ-5161): the link
 * resolution (`editor/wikilink/linkResolve.ts`) and the card screens read these, also on the phone. `pageLabel.ts`
 * gives out the same names, next to the hooks that read the Files tree.
 */
import { MAX_WINDOW_ROOTS, type IndexRecord } from '@shared/types'
import { boardBaseName } from '@shared/fileKind'
import { basename, dirname, stripExt } from './paths'

/** Every page's and folder's title by its absolute path, a folder's by its directory's (YAZ-2420 🔒 D14). */
export type PathTitles = ReadonlyMap<string, string>

const titlesCache = new WeakMap<readonly IndexRecord[], WeakMap<readonly IndexRecord[], PathTitles>>()
/** No titles: one empty Map, so a holder that has none yet keeps one identity. */
export const NO_TITLES: PathTitles = new Map()
/**
 * The Map last built for each vault of the window (YAZ-2602 D1), newest first. A snapshot does not
 * say whose it is, and need not: the paths of two vaults never meet, so the Map that holds a
 * snapshot's first path is its own vault's.
 */
const latest: PathTitles[] = []

/**
 * The index snapshot as `PathTitles`: a folder's record is its `.folder.md`, so its directory is the
 * key. Built once per snapshot — keyed by the identity of its two arrays, as `rowsByFolder` is —
 * because every rendered id link, each label holder and each notice asks. A snapshot that changed
 * no title keeps the Map its vault's last one had, so a save elsewhere in the vault — or in another
 * vault of the window — re-renders nothing that shows a name (YAZ-2194).
 */
export function pathTitles(records: readonly IndexRecord[], folders: readonly IndexRecord[]): PathTitles {
  let byFolders = titlesCache.get(records)
  if (byFolders === undefined) titlesCache.set(records, (byFolders = new WeakMap()))
  let titles = byFolders.get(folders)
  if (titles === undefined) {
    const built = new Map<string, string>()
    for (const record of records) built.set(record.path, record.title)
    for (const folder of folders) built.set(dirname(folder.path), folder.title)
    const [path] = built.keys()
    const at = path === undefined ? -1 : latest.findIndex((held) => held.has(path))
    const last = path === undefined ? NO_TITLES : latest[at]
    if (last !== undefined && built.size === last.size && [...built].every(([key, title]) => last.get(key) === title)) titles = last
    else {
      // Its vault's newer Map takes the older one's place; a vault not seen before joins the list.
      if (at !== -1) latest.splice(at, 1)
      latest.unshift((titles = built))
      latest.length = Math.min(latest.length, MAX_WINDOW_ROOTS)
    }
    byFolders.set(folders, titles)
  }
  return titles
}

/**
 * A path as a NAME, wherever one is shown: its title (YAZ-2420 🔒 D14). A path the index does not
 * hold (not loaded yet, a PDF, an image, a board, a folder with no settings file) shows its file name: a
 * page, a drawing and a diagram hide their extension (YAZ-3536 D1); a folder's label is its whole name (YAZ-2290).
 */
export const pageLabel = (path: string, folder: boolean, titles: PathTitles): string => titles.get(path) ?? (folder ? basename(path) : fileLabel(basename(path)))

/** A file name with one app extension hidden at most: `Flow.md.excalidraw` → `Flow.md`, `Flow.excalidraw.md` → `Flow.excalidraw` (YAZ-3536). */
export const fileLabel = (name: string): string => {
  // `boardBaseName` is the board test too (its name whole = no board): one look at the extension, not `fileKind`'s six lists, on every row.
  const bare = boardBaseName(name)
  return bare !== name ? bare : stripExt(name)
}
