/**
 * THE SCOPE OF A "FOLDER OF <VAULT>" WINDOW (YAZ-4922 🔒 D3). Such a window reads its vault's index, IDs and links, but
 * what it FINDS — the sidebar's tree, Search (⌘K), Recents and Find in files (⌘⇧F, YAZ-2571) — is the pages under its
 * folder. `folder` is `storage.folderIn(vault)`: undefined (or null) where the window shows the whole vault, and then
 * every path is in scope. One rule, so each finder draws the same line.
 */
export const inPlace = (folder: string | null | undefined, path: string): boolean => folder == null || path.startsWith(`${folder}/`)

/** `items` in the scope of `folder` (`inPlace`): `items` itself where the window shows the whole vault, so nothing is copied. */
export const placeOnly = <T extends { path: string }>(folder: string | null | undefined, items: readonly T[]): readonly T[] => (folder == null ? items : items.filter((item) => inPlace(folder, item.path)))
