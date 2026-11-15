import { backlinksFor } from '@client/links/backlinks'
import type { IndexRecord } from '@shared/types'
import type { VaultData } from '../search/vaultData'
import { resolveSourceOf } from './pageLook'

/**
 * The pages that link to `path`, as "Linked mentions" lists them (YAZ-5455): the Mac's `backlinksFor` over the phone's index,
 * by the reader's resolver, less any file the phone cannot open (a folder's `.folder.md`). The ONE list of "Linked
 * mentions" at the end of a page, on the full page and in an Explore panel (YAZ-5535).
 */
export function linkedFromOf(path: string, data: VaultData): IndexRecord[] {
  const resolve = resolveSourceOf(data).resolve
  return resolve === null ? [] : backlinksFor(path, data.records, resolve, data.folders).filter((r) => data.byPath[r.path] !== undefined)
}
