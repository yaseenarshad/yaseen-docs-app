/**
 * The fold key of a folder row in a COPY (YAZ-3131 Decision 1). A folder of the Focus tab or of the
 * Favorites tab can stand under two top rows, and each copy opens and closes on its own. `top` is the
 * top row the folder stands under. A NUL never stands in a path, so the two halves split back without
 * doubt. Session state only, as every fold (YAZ-1642). A fold of the Files tab stays its plain path.
 */
export const copyFoldKey = (top: string, path: string): string => `${top}\0${path}`

/** The two paths of a copy fold key, or null for a plain path. */
export function copyFoldParts(key: string): [top: string, path: string] | null {
  const at = key.indexOf('\0')
  return at < 0 ? null : [key.slice(0, at), key.slice(at + 1)]
}
