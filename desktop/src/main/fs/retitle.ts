import { lstat, stat } from 'node:fs/promises'
import path from 'node:path'
import { cardFileCard, cardFileName, isCardFileContent } from '@shared/cardFileFormat'
import { cardIdOf, rewritePageCards, withCardTitle } from '@shared/cardLine'
import { FrontmatterWriteError, parseFrontmatter, setFrontmatterProperty, splitFrontmatter } from '@shared/frontmatter'
import { PAGE_ID_KEY, vaultPageId } from '@shared/pageId'
import { TITLE_KEY, kebabTitle, pageFileName } from '@shared/pageName'
import { folderSettingsPath, isFolderSettingsPath, type RenameFileResponse } from '@shared/types'
import { giveId, nextId, readPage } from '../vaultIndex/idSweep'
import { vaultIds } from '../vaultIndex/mint'
import { writeFile } from './file'
import { BridgeFailure, createDurable, fsCall, requireAbsPath, requireMarkdownFile } from './fsUtils'
import { renameFile, requireFreeTarget } from './rename'
import { requireRequest } from './validate'

/**
 * A title edit (YAZ-2420 🔒 D16), the one operation behind the page title, the sidebar's rename
 * and a table's Name cell: the `title:` line is written (a CARD FILE's title goes onto its card
 * line, YAZ-5308: `writeCardTitle`), then the page, card file or folder is renamed to the name
 * built from it. The title goes FIRST, so a rename that fails leaves the title right
 * and the name stale, and the next edit fixes the name. A title whose built name is the one on
 * disk moves nothing: `newPath` is `oldPath`.
 *
 * A PAGE that has no id is given one first (🔒 D29, `giveId`): the vault's next number, from its
 * door (YAZ-2677 R32). One that changes on disk as it is given is refused with nothing written. A FOLDER's title is in its `.folder.md`, created here
 * when it is missing; its name carries no id, so a title with no letter or digit, or one whose
 * name a neighbour holds, is refused before anything is written (🔒 D25). Properties that will
 * not parse refuse the edit (🔒 D24). The window's own vault root takes its title in its own
 * `.folder.md` and is never renamed (YAZ-4921; `fs:rename` refuses it).
 */
export async function retitle(root: string, req: unknown): Promise<RenameFileResponse> {
  const { path: raw, title: typed } = requireRequest(req)
  const p = requireAbsPath(raw, 'path')
  const title = typeof typed === 'string' ? typed.trim() : ''
  if (title === '') throw new BridgeFailure('BAD_REQUEST', 'a title cannot be empty', { path: p })
  const src = await fsCall(p, () => stat(p))
  let name: string
  if (p === root) {
    // The vault root's own page (YAZ-4921): its title goes into `<root>/.folder.md`, and the folder is never renamed —
    // `fs:rename` refuses the root, and so did this door before the root had a page.
    if (!src.isDirectory()) throw new BridgeFailure('BAD_REQUEST', 'the vault root is not a folder', { path: p })
    const file = folderSettingsPath(p)
    await writeTitle(file, await readPage(file), title)
    return { oldPath: p, newPath: p, kind: 'dir' }
  }
  if (src.isDirectory()) {
    name = kebabTitle(title)
    if (name === '') throw new BridgeFailure('BAD_REQUEST', 'a folder name needs a letter or a digit', { path: p })
    await requireFreeTarget(src, path.join(path.dirname(p), name), await lstat(p))
    const file = folderSettingsPath(p)
    await writeTitle(file, await readPage(file), title)
  } else {
    requireMarkdownFile(p)
    const page = await readPage(p)
    if (isCardFileContent(page.content)) name = await writeCardTitle(p, page, title)
    else {
      const { letters } = await vaultIds(root)
      const held = idOf(p, page.content, letters)
      const id = held ?? (await giveId(p, undefined, letters, nextId(root)))
      // `giveId` gives none only to a page that changed under the edit: nothing is written.
      if (id === undefined) throw new BridgeFailure('CONFLICT', 'this page changed on disk; try again', { path: p })
      await writeTitle(p, held === undefined ? await readPage(p) : page, title)
      name = pageFileName(title, id)
    }
  }
  const newPath = path.join(path.dirname(p), name)
  return newPath === p ? { oldPath: p, newPath, kind: src.isDirectory() ? 'dir' : 'file' } : renameFile({ oldPath: p, newPath })
}

/**
 * A card file's title (YAZ-5037, YAZ-5308 decision D): its title is on its card's line, as every card's, so the new
 * words go there, and `retitle` then gives the file the name built from them and the CARD's ID (`cardFileName`). No
 * page ID is given (D29 is for pages): the card's ID is the file's. A card with no ID yet keeps its name; the sweep
 * gives it one. Resolves to the file's new name.
 */
async function writeCardTitle(p: string, { content, mtime }: { content: string; mtime?: number }, title: string): Promise<string> {
  const card = cardFileCard(content)
  if (card === null) throw new BridgeFailure('BAD_REQUEST', 'this card file has no card', { path: p })
  const titled = rewritePageCards(content, (c, n) => (n === 0 ? withCardTitle(c.line, title) : undefined))
  if (titled !== content) await writeFile({ path: p, content: titled, ...(mtime !== undefined && { expectedMtime: mtime }) })
  const id = cardIdOf(card.line)
  return id === null ? path.basename(p) : cardFileName(title, id)
}

const unparsed = (file: string): BridgeFailure => new BridgeFailure('BAD_REQUEST', isFolderSettingsPath(file) ? "this folder's settings do not parse" : "this page's properties do not parse", { path: file })

/** The id the page at `file` holds, when it is an ID of the vault with `letters` (YAZ-2677 R5). Properties that do not parse refuse the edit (🔒 D24). */
const idOf = (file: string, content: string, letters: readonly string[]): string | undefined => {
  const { properties, error } = parseFrontmatter(splitFrontmatter(content).frontmatter)
  if (error !== undefined) throw unparsed(file)
  return vaultPageId(properties[PAGE_ID_KEY], letters)
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
