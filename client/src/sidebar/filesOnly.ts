/**
 * "Hide all others" in Files (YAZ-5790): the Files tab shows one folder alone, by its path. App keeps the path for the
 * window's session only (as the Focus tab's `focusOnly`, YAZ-4460 F8) and never writes it. These are its path rules.
 */

/** `path` is the folder `dir` or stands inside it, at any depth. */
export const inFolder = (dir: string, path: string): boolean => path === dir || path.startsWith(`${dir}/`)

/** A folder renamed or moved (`file:renamed`, kind `dir`): the folder shown alone follows when it is that folder or inside it. */
export const filesOnlyAfterRename = (only: string | null, oldDir: string, newDir: string): string | null =>
  only !== null && inFolder(oldDir, only) ? newDir + only.slice(oldDir.length) : only

/** A folder deleted (`file:deleted`, kind `dir`): when it is the folder shown alone, or holds it, the full tree shows again. */
export const filesOnlyAfterDelete = (only: string | null, deleted: string): string | null => (only !== null && inFolder(deleted, only) ? null : only)

/**
 * How long the Files tab waits for a folder shown alone that the tree does not hold, before it shows all again. A move
 * changes the disk before main says the new path (`file:renamed`), so a tree read in between misses the folder.
 */
export const FILES_ONLY_GRACE_MS = 3000
