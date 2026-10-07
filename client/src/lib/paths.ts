/** Last path segment (trailing slashes ignored); the input itself for `/`. It lives in `shared/types.ts`, where `listVaults` names a vault's folder with it too (YAZ-2556). */
export { basename } from '@shared/types'

/** Parent directory of `p`: everything before its last `/` ('' when it has none). */
export const dirname = (p: string): string => p.slice(0, Math.max(0, p.lastIndexOf('/')))

/** `p` relative to `root`, the way the index names a folder (`Projects/Alpha`); `p` itself when it is not under `root`. */
export function relTo(root: string, p: string): string {
  const prefix = `${root.replace(/\/+$/, '')}/`
  return p.startsWith(prefix) ? p.slice(prefix.length) : p
}

/** The inverse: root-relative `rel` as an absolute path. */
export const absFrom = (root: string, rel: string): string => `${root.replace(/\/+$/, '')}/${rel}`

/** File name without its vault extension (`.md` / `.markdown`). */
export const stripExt = (name: string) => name.replace(/\.(md|markdown)$/i, '')
