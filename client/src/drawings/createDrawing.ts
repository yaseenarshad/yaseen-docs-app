/**
 * A new board for a note (YAZ-877; named after the note since YAZ-4831 items 2, 3): "/drawing" and "/diagram" make
 * `<Note title> drawing.excalidraw` or `<Note title> diagram.drawio` and embed it.
 *
 * WHERE: Settings › `newBoardFolder` — `'note'` (the default) puts it in the note's own folder, `'assets'` in the vault's
 * `assets/drawings/` (made on the way, level by level). The write is `fs:create-board` (YAZ-3028 D9): the empty board,
 * born stamped, at an EXPLICIT path, never fuzzy, and never over a file. A name that is taken there comes back
 * `ALREADY_EXISTS` and the loop tries ` 2`, ` 3`, … (bounded by `MAX_ATTEMPTS`). Any other failure goes to the caller's
 * notice untouched.
 *
 * WHAT THE NOTE GETS: the embed's target. The bare file name when no other file of the vault has that name (it then
 * resolves to this one alone), else the vault-relative path.
 */
import { api, BridgeRequestError } from '../api'
import { storage } from '../lib/storage'
import { ensureFolder } from '../views/scaffold'

/** The `'assets'` choice of `newBoardFolder`: the drawings' home under the vault root. */
export const DRAWINGS_DIR = 'assets/drawings'

/** The empty scene lives in `shared/` since YAZ-3028 D9: main's `fs:create-board` writes the same bytes. */
export { EMPTY_SCENE, EMPTY_SCENE_JSON } from '@shared/drawingAssets'

export type NewBoardKind = 'drawing' | 'diagram'

/** A bound, so a folder full of taken names never loops forever. */
const MAX_ATTEMPTS = 50

/** `<title> drawing.excalidraw`, then `<title> drawing 2.excalidraw`, …: a title's `/`, `\` and `:` become `-`. */
export function boardFileName(title: string, kind: NewBoardKind, attempt = 0): string {
  const base = `${title.replace(/[/\\:]/g, '-').trim() || 'Untitled'} ${kind}`
  return `${base}${attempt === 0 ? '' : ` ${attempt + 1}`}${kind === 'drawing' ? '.excalidraw' : '.drawio'}`
}

export interface NewBoardPlace {
  root: string
  /** The note's absolute path: its folder is the default home. */
  notePath: string
  /** The note's title, as its tab shows it. */
  title: string
  /** True when a file of the vault already has this name (the index's answer); absent → always the path. */
  nameTaken?: (name: string) => boolean
}

/** Makes one empty board for the note; resolves the embed's target (see the module doc). */
export async function createBoardForNote(place: NewBoardPlace, kind: NewBoardKind): Promise<string> {
  const { root, notePath, title } = place
  const noteDir = notePath.slice(0, Math.max(notePath.lastIndexOf('/'), 0))
  // A10: inside the vault means the root itself or under `root/`; `/a/Vault 2/` is not inside `/a/Vault`.
  const inVault = noteDir === root || noteDir.startsWith(`${root}/`)
  const dir = storage.getSettings().newBoardFolder === 'assets' || !inVault ? await ensureFolder(root, DRAWINGS_DIR) : noteDir
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const name = boardFileName(title, kind, attempt)
    // Asked before the write: after it, the index holds this file too.
    const unique = place.nameTaken?.(name) === false
    try {
      const made = await api.createBoard({ root, path: `${dir}/${name}` })
      return unique ? name : made.path.slice(root.length + 1)
    } catch (err) {
      // Only a name clash is retryable — everything else is the caller's notice.
      if (!(err instanceof BridgeRequestError && err.code === 'ALREADY_EXISTS')) throw err
    }
  }
  // The reason only (A13): the slash menu's notice puts "Can't create a drawing:" before it.
  throw new Error(`${MAX_ATTEMPTS} names in ${dir.slice(root.length + 1) || 'the vault'} are already taken`)
}
