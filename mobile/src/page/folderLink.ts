import { idKey, targetKey, typedFolders } from '@shared/linkResolver'
import type { VaultData } from '../search/vaultData'

/**
 * A LINK TO A FOLDER (YAZ-5550), as the Mac reads it (`client/src/links/folderLinks.ts`, YAZ-2290 D10): `[[Projects]]`
 * reaches the folder named Projects, but only when NO page, path or alias holds that name (the reader asks the page
 * resolver first, `pageLook.ts`), so no link that opened a page opens anything else now. The folder is found by the
 * Mac's order: its `.folder.md`'s ID, its path in the vault, its title, then its bare name; duplicates go to the
 * SHALLOWEST folder; a path of titles as a page's is (`typedFolders`). Case does not matter; `[[…]]`, `|alias` and
 * `#heading` are left out. The vault's root is no folder a link reaches.
 *
 * The Mac's `folderResolver` itself is not imported: its module brings the Mac's tree and view engine into the reader.
 * This is the same rule over the phone's index, with the root `''` (paths as in the repo); `folderLink.test.ts` holds
 * the two to the same answers. The folders are the ones the phone knows: each folder that holds a file or a
 * `.folder.md` (the Mac's Files tree also knows an empty folder; the phone has no such folder to open).
 */
const resolvers = new WeakMap<VaultData, (target: string) => string | null>()

/** The folder (its path in the vault) a link names, or null. One resolver per snapshot of the vault's data. */
export function folderLinkOf(data: VaultData): (target: string) => string | null {
  let resolve = resolvers.get(data)
  if (resolve === undefined) resolvers.set(data, (resolve = folderResolver(dirsOf(data), data.folders, data.letters)))
  return resolve
}

/** The vault's folders: each one above a file, and each with a `.folder.md` record; none hidden (`.yaseendocs`). */
function dirsOf(data: VaultData): string[] {
  const dirs = new Set<string>()
  const add = (path: string) => {
    for (let cut = path.indexOf('/'); cut > 0; cut = path.indexOf('/', cut + 1)) dirs.add(path.slice(0, cut))
  }
  for (const file of data.files) add(file)
  for (const f of data.folders) if (f.folder !== '') add(`${f.folder}/`)
  return [...dirs].filter((dir) => !dir.split('/').some((part) => part.startsWith('.'))).sort()
}

/** The Mac's `folderResolver` with the root `''` (`client/src/links/folderLinks.ts`). */
export function folderResolver(dirs: readonly string[], folders: VaultData['folders'], letters?: readonly string[]): (target: string) => string | null {
  const byRel = new Map<string, string>()
  const byTitle = new Map<string, { dir: string; depth: number }>()
  const byName = new Map<string, { dir: string; depth: number }>()
  const shallowest = (map: Map<string, { dir: string; depth: number }>, key: string, dir: string, depth: number) => {
    const prev = map.get(key)
    if (prev === undefined || depth < prev.depth) map.set(key, { dir, depth })
  }
  for (const dir of dirs) {
    const rel = dir.toLowerCase()
    if (!byRel.has(rel)) byRel.set(rel, dir)
    shallowest(byName, rel.slice(rel.lastIndexOf('/') + 1), dir, rel.split('/').length)
  }
  for (const settings of folders) {
    const dir = byRel.get(settings.folder.toLowerCase())
    if (dir !== undefined) shallowest(byTitle, settings.title.toLowerCase(), dir, settings.folder.split('/').length)
  }
  // The Mac's `foldersById` (the first folder that holds each ID), then by the ID in lowercase, as the Mac's link
  // resolver reads it (it asks with no `ids: false`).
  const exact = new Map<string, string>()
  for (const f of folders) if (f.id !== undefined && !exact.has(f.id)) exact.set(f.id, f.folder)
  const byId = new Map([...exact].map(([id, folder]) => [id.toLowerCase(), folder]))
  const typed = typedFolders(folders)
  const titledPath = (key: string): string | null => {
    let dir = ''
    for (const segment of key.split('/')) dir = typed(dir, segment)?.toLowerCase() ?? (dir === '' ? segment : `${dir}/${segment}`)
    return byRel.get(dir) ?? null
  }
  return (target) => {
    const key = targetKey(target).replace(/^\/+|\/+$/g, '')
    if (key === '') return null
    return byRel.get(byId.get(idKey(key, letters))?.toLowerCase() ?? key) ?? byTitle.get(key)?.dir ?? (key.includes('/') ? titledPath(key) : (byName.get(key)?.dir ?? null))
  }
}
