/**
 * Who links to what (YAZ-4738 L5): ONE pass over an index snapshot's links, the reverse map that the "Linked mentions"
 * section under each page, the Linked mentions column and `yaseendocs mentions` (L6) all read. Pure; the caller hands
 * in the resolver (the app's window resolver, or the command's own over the same scan), so all three agree.
 */
import { folderSettingsLinks } from './folderSettingsLinks'
import { exactLinkTarget } from './linkRewrite'
import type { IndexRecord } from './types'

/** Every target a page links to: index links and embeds, then the nested settings leaves (lazily). */
export function* referenceTargets(record: IndexRecord): Generator<string> {
  yield* record.links
  yield* record.embeds
  for (const link of folderSettingsLinks(record.properties)) {
    const target = exactLinkTarget(link)
    if (target !== null) yield target
  }
}

/** The directory of an absolute path ('/' separators): a folder's settings record names its folder by it. */
const dirOf = (path: string): string => path.slice(0, path.lastIndexOf('/'))

const byPath = (a: IndexRecord, b: IndexRecord): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)

/**
 * Path → the records that mention it, each list path-sorted. A page mentions what its `links` and `embeds` resolve to
 * (one entry however many mentions it holds); a folder, as its settings record, what its `referenceTargets` resolve to.
 * A page never mentions itself: a page its own path, a folder its own directory. One resolver call per link.
 */
export function mentionsOf(records: readonly IndexRecord[], folders: readonly IndexRecord[], resolve: (target: string) => string | null): Map<string, IndexRecord[]> {
  const map = new Map<string, IndexRecord[]>()
  const add = (from: IndexRecord, self: string, targets: Iterable<string>): void => {
    for (const target of targets) {
      const path = resolve(target)
      if (path === null || path === self) continue
      const list = map.get(path)
      if (list === undefined) map.set(path, [from])
      else if (list[list.length - 1] !== from) list.push(from) // a record's mentions come together: one entry each
    }
  }
  for (const r of records) {
    add(r, r.path, r.links)
    add(r, r.path, r.embeds)
  }
  for (const f of folders) add(f, dirOf(f.path), referenceTargets(f))
  for (const list of map.values()) list.sort(byPath)
  return map
}
