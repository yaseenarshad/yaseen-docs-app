/**
 * The `yaseendocs://` deep-link format (E1, GRO-2171; locked decision D7): path-only,
 * absolute, percent-encoded — `yaseendocs:///Users/me/vault/My%20page.md` — no vault id.
 * An optional `?root=` (also a percent-encoded absolute path) overrides which folder the
 * link opens under. Shared so main's parser and the client's generator agree byte-for-byte
 * on one encoding.
 *
 * Yaseen Draw's `yaseendraw://` links (YAZ-3028 D7) have the same format, so this one parser
 * reads them too and they open the file in Docs. Docs never WRITES one: `fileLink` stays
 * `yaseendocs://`. Draw's Windows drive form (`/C:/…`) is not read back to a drive path: Docs
 * reads paths the way it always has (D12), so such a link names no file here.
 */

const SCHEME = 'yaseendocs://'

/** Every scheme the app claims, its own first (the packaged `protocols` and `claimDeepLinkScheme`). */
export const LINK_SCHEMES = ['yaseendocs', 'yaseendraw'] as const

/** A URL in one of the app's own schemes: what a second launch's argv may carry (Windows/Linux). */
export const isAppLink = (url: string): boolean => LINK_SCHEMES.some((s) => url.startsWith(`${s}://`))

/**
 * `encodeURI` keeps `/` readable and encodes spaces/unicode, but leaves `#` and `?` alone —
 * either would truncate the path on parse, so they get encoded on top.
 */
const encodePath = (path: string): string => encodeURI(path).replace(/#/g, '%23').replace(/\?/g, '%3F')

/** Optional target view opened when a vault deep link (`?open=inbox` or `?open=today`) activates (YAZ-5967, YAZ-6373). */
export type LinkOpenTarget = 'inbox' | 'today'

const isOpenTarget = (value: string): value is LinkOpenTarget => value === 'inbox' || value === 'today'

/** The `yaseendocs://` link that opens `path` (absolute), with optional `?open=inbox|today`. */
export function fileLink(path: string, opts?: { open?: LinkOpenTarget }): string {
  const base = SCHEME + encodePath(path)
  if (opts?.open !== undefined && isOpenTarget(opts.open)) return `${base}?open=${opts.open}`
  return base
}

/** The `yaseendocs://workspace/<id>` link that opens a saved workspace (`VaultSet`). */
export function workspaceLink(id: string): string {
  return `${SCHEME}workspace/${encodeURIComponent(id)}`
}

/** `decodeURIComponent` that answers null for malformed percent-encoding instead of throwing. */
function decode(encoded: string): string | null {
  try {
    return decodeURIComponent(encoded)
  } catch {
    return null
  }
}

const WORKSPACE_LINK_RE = /^yaseendocs:\/\/workspace\/([^/?#]+)$/i

/** Parses a `yaseendocs://workspace/<id>` deep link back to its decoded workspace id, or null. */
export function parseWorkspaceLink(url: string): string | null {
  const m = WORKSPACE_LINK_RE.exec(url)
  if (m === null) return null
  const id = decode(m[1])
  return id === null || id.length === 0 ? null : id
}

/**
 * Parses a `yaseendocs://` or `yaseendraw://` link back to its absolute path (+ optional
 * `?root=` override and optional `?open=inbox|today` target view). Null for any other scheme,
 * a relative/empty path, or malformed percent-encoding. Manual string parsing on purpose:
 * `new URL()` host-parses the double-slash form (`yaseendocs://Users/...`) unpredictably for
 * non-special schemes — here it simply decodes to a relative path and is rejected.
 */
export function parseFileLink(url: string): { path: string; root: string | null; open?: LinkOpenTarget } | null {
  const scheme = LINK_SCHEMES.find((s) => url.startsWith(`${s}://`))
  if (scheme === undefined) return null
  let rest = url.slice(scheme.length + 3)
  let root: string | null = null
  let open: LinkOpenTarget | undefined
  const q = rest.indexOf('?')
  if (q !== -1) {
    for (const pair of rest.slice(q + 1).split('&')) {
      const eq = pair.indexOf('=')
      if (eq === -1) continue
      const key = pair.slice(0, eq)
      const rawValue = pair.slice(eq + 1)
      if (key === 'root') {
        const decoded = decode(rawValue)
        if (decoded === null) return null
        // A non-absolute override could never contain the (absolute) path: no override at all.
        if (decoded.startsWith('/')) root = decoded
      } else if (key === 'open') {
        const decoded = decode(rawValue)
        if (decoded === null) return null
        if (isOpenTarget(decoded)) open = decoded
      }
    }
    rest = rest.slice(0, q)
  }
  const path = decode(rest)
  if (path === null || !path.startsWith('/')) return null
  return open === undefined ? { path, root } : { path, root, open }
}
