import { stat } from 'node:fs/promises'
import path from 'node:path'
import { FrontmatterWriteError, parseFrontmatter, setFrontmatterProperty, splitFrontmatter } from '@shared/frontmatter'
import { NOTE_ID_KEY, vaultNoteId } from '@shared/noteId'
import { TITLE_KEY, kebabTitle, noteFileName } from '@shared/noteName'
import { folderSettingsPath, isFolderSettingsPath, type RenameFileResponse } from '@shared/types'
import { giveId, nextId, readPage } from '../vaultIndex/idSweep'
import { vaultIds } from '../vaultIndex/mint'
import { writeFile } from './file'
import { BridgeFailure, createDurable, fsCall, requireAbsPath, requireMarkdownFile } from './fsUtils'
import { renameFile, requireFreeTarget } from './rename'
import { requireRequest } from './validate'

/**
 * A title edit (YAZ-2420 🔒 D16), the one operation behind the page title, the sidebar's rename
 * and a table's Name cell: the `title:` line is written, then the note or folder is renamed to
 * the name built from it. The title goes FIRST, so a rename that fails leaves the title right
 * and the name stale, and the next edit fixes the name. A title whose built name is the one on
 * disk moves nothing: `newPath` is `oldPath`.
 *
 * A NOTE that has no id is given one first (🔒 D29, `giveId`): the vault's next number, from its
 * door (YAZ-2677 R32). One that changes on disk as it is given is refused with nothing written. A FOLDER's title is in its `.folder.md`, created here
 * when it is missing; its name carries no id, so a title with no letter or digit, or one whose
 * name a neighbour holds, is refused before anything is written (🔒 D25). Properties that will
 * not parse refuse the edit (🔒 D24). The window's own vault root is refused as `fs:rename`
 * refuses it.
 */
export async function retitle(root: string, req: unknown): Promise<RenameFileResponse> {
  const { path: raw, title: typed } = requireRequest(req)
  const p = requireAbsPath(raw, 'path')
  const title = typeof typed === 'string' ? typed.trim() : ''
  if (title === '') throw new BridgeFailure('BAD_REQUEST', 'a title cannot be empty', { path: p })
  if (p === root) throw new BridgeFailure('BAD_REQUEST', 'the vault root itself cannot be renamed', { path: p })
  const src = await fsCall(p, () => stat(p))
  let name: string
  if (src.isDirectory()) {
    name = kebabTitle(title)
    if (name === '') throw new BridgeFailure('BAD_REQUEST', 'a folder name needs a letter or a digit', { path: p })
    await requireFreeTarget(src, path.join(path.dirname(p), name))
    const file = folderSettingsPath(p)
    await writeTitle(file, await readPage(file), title)
  } else {
    requireMarkdownFile(p)
    const page = await readPage(p)
    const { letters } = await vaultIds(root)
    const held = idOf(p, page.content, letters)
    const id = held ?? (await giveId(p, undefined, letters, nextId(root)))
    // `giveId` gives none only to a note that changed under the edit: nothing is written.
    if (id === undefined) throw new BridgeFailure('CONFLICT', 'this note changed on disk; try again', { path: p })
    await writeTitle(p, held === undefined ? await readPage(p) : page, title)
    name = noteFileName(title, id)
  }
  const newPath = path.join(path.dirname(p), name)
  return newPath === p ? { oldPath: p, newPath, kind: src.isDirectory() ? 'dir' : 'file' } : renameFile({ oldPath: p, newPath })
}

const unparsed = (file: string): BridgeFailure => new BridgeFailure('BAD_REQUEST', isFolderSettingsPath(file) ? "this folder's settings do not parse" : "this note's properties do not parse", { path: file })

/** The id the note at `file` holds, when it is an ID of the vault with `letters` (YAZ-2677 R5). Properties that do not parse refuse the edit (🔒 D24). */
const idOf = (file: string, content: string, letters: readonly string[]): string | undefined => {
  const { properties, error } = parseFrontmatter(splitFrontmatter(content).frontmatter)
  if (error !== undefined) throw unparsed(file)
  return vaultNoteId(properties[NOTE_ID_KEY], letters)
}

/** `page` goes back to `file` with its `title:` set; a `.folder.md` that was not there is created. */
async function writeTitle(file: string, { content, mtime }: { content: string; mtime?: number }, title: string): Promise<void> {
  let titled: string
  try {
    titled = setFrontmatterProperty(content, TITLE_KEY, title)
  } catch (err) {
    if (!(err instanceof FrontmatterWriteError)) throw err
    throw unparsed(file)
  }
  if (mtime === undefined) await createDurable(file, titled)
  else await writeFile({ path: file, content: titled, expectedMtime: mtime })
}
