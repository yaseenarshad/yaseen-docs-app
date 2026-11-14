import { isSkipped } from './fileKind'

/**
 * WHERE A PICTURE OR A SOUND LINK LANDS, FROM A LIST OF THE VAULT'S FILES (YAZ-5068): Obsidian's link order, as the
 * Mac's `resolveAsset` (`desktop/src/main/fs/assets.ts`) walks the disk for it. The phone has no disk to walk: it has
 * the vault's file list (a GitHub tree), so it answers from the list by the same rule. The order of names in a folder
 * (`nameOrderCi`) and the names skipped (`isSkipped`) are the one copy, which the Mac's walk uses too. A test runs both
 * on one tree and checks that they give the same answer. Pure: no Node import; paths are vault-relative, with `/`.
 */

/** The order of names in one folder (case-insensitive): the Mac's `byNameCi`, so a walk meets them in this order. */
export const nameOrderCi = (a: string, b: string): number => a.toLowerCase().localeCompare(b.toLowerCase())

/** `parts` joined and cleaned of `.` and `..`, as `path.resolve` under the root does; null when it leaves the vault. */
function inVault(...parts: string[]): string | null {
  const out: string[] = []
  for (const part of parts.join('/').split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (out.length === 0) return null
      out.pop()
    } else out.push(part)
  }
  return out.length === 0 ? null : out.join('/')
}

/** The order of the shortest-path walk: fewer folders first, then the folders and the name in `nameOrderCi` order. */
function walkOrder(a: readonly string[], b: readonly string[]): number {
  if (a.length !== b.length) return a.length - b.length
  for (let i = 0; i < a.length; i++) {
    const c = nameOrderCi(a[i], b[i])
    if (c !== 0) return c
  }
  return 0
}

/**
 * A lookup over `files` (every file of the vault, vault-relative, as a tree listing gives them). It answers the file a
 * link `target` (the bare target: `linkTarget` took off the words and the heading) lands on, or null:
 *  1. relative to `from`, the linking page's folder, when given (a page's own `./pic.png` wins);
 *  2. relative to the vault's root;
 *  Steps 1 and 2 match the path in any case, as the Mac's disk does, and answer the path's real case.
 *  3. Obsidian's shortest-path rule: the file of that name in any case, in the fewest folders, the first in the walk.
 * Steps 1 and 2 never leave the vault. Step 3 never finds a dot-entry, `node_modules`, or a file inside them.
 */
export function makeAssetResolver(files: readonly string[]): (target: string, from?: string) => string | null {
  /**
   * Each file by its path in lowercase (steps 1 and 2): the Mac's disk (APFS) ignores letter case, so `deep/PIC.png`
   * opens `Deep/pic.png` there (YAZ-5167). The answer is the path with its real case, as the list holds it. Two paths
   * that differ only in case (a repo can hold both): the exact one, else the first in the walk's order.
   */
  const byPath = new Map<string, string[]>()
  for (const file of files) {
    const key = file.toLowerCase()
    const list = byPath.get(key)
    if (list === undefined) byPath.set(key, [file])
    else list.push(file)
  }
  const fileAt = (p: string | null): string | null => {
    if (p === null) return null
    const found = byPath.get(p.toLowerCase())
    if (found === undefined) return null
    if (found.includes(p)) return p
    return found.reduce((a, b) => (walkOrder(b.split('/'), a.split('/')) < 0 ? b : a))
  }
  /** Each walkable file by its name in lowercase, with its parts. */
  const byName = new Map<string, string[][]>()
  for (const file of files) {
    const parts = file.split('/').filter((p) => p !== '')
    if (parts.length === 0 || parts.some(isSkipped)) continue
    const key = parts[parts.length - 1].toLowerCase()
    const list = byName.get(key)
    if (list === undefined) byName.set(key, [parts])
    else list.push(parts)
  }
  return (target, from) => {
    if (target === '') return null
    if (from !== undefined) {
      const viaPage = fileAt(inVault(from, target))
      if (viaPage !== null) return viaPage
    }
    const viaRoot = fileAt(inVault(target))
    if (viaRoot !== null) return viaRoot
    const name = target.split('/').filter((p) => p !== '').pop()
    const found = name === undefined ? undefined : byName.get(name.toLowerCase())
    if (found === undefined) return null
    let best = found[0]
    for (const parts of found) if (walkOrder(parts, best) < 0) best = parts
    return best.join('/')
  }
}
