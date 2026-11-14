/**
 * THE CONVERT ACTIONS' WRITES (YAZ-5037 phase 5): the bytes come from `shared/cardConvert.ts`; here they go to disk.
 * Loaded when an action runs, never with the page.
 *
 *  - ONE COMPARE-AND-SET PER FILE: each file is read once (after its open editors saved, `flushRenamedPath`) and
 *    written once with that read's mtime; a file that changed meanwhile is a CONFLICT and nothing more is written. A new
 *    file is written with `expectedMtime: 0`: a file already at that name is a CONFLICT, never overwritten, and the
 *    next free name is tried (`-2`, `-3`, …).
 *  - THE INDEX KNOWS AT ONCE: every write is `quiet` (`FileWriteRequest.quiet`), which the main process hands to the
 *    live index as it lands (`indexWrote`), so the new card file and the page it left are both in it before the
 *    watcher. A card ID on two files for that moment is safe: the ID sweep waits `CARD_MOVE_WAIT_MS` before it reads
 *    a copy. No main or preload code: the existing doors already do it.
 *  - THE APP'S OWN WRITE (`announcedWrite`): an open tab of the file takes the new bytes quietly, out of its undo
 *    history. There is no ⌘Z for a convert: the reverse action is the undo.
 *  - TWO FILES: the new file first, then the old one. If the second write fails, the new file goes to the Trash and
 *    nothing has changed. Put back writes the page first, then moves the card file to the Trash; if that fails, the
 *    page gets its bytes back.
 *  - A file with `readonly: true` is never changed: the action stops with a notice. A refused write (`FORBIDDEN`) says
 *    so and changes nothing. The vault's Read only is asked before (`allowFileAction`), by the caller.
 */
import {
  cardFileAsPage,
  cardFromText,
  moveCardOut,
  moveTextIntoCard,
  pageAsCardFile,
  putCardBack,
  splitCardFile,
  type CardFileOut,
} from '@shared/cardConvert'
import { cardFileShape } from '@shared/cardFileFormat'
import { CardNotFoundError } from '@shared/cardLine'
import { splitFrontmatter } from '@shared/frontmatter'
import { isPageReadOnly } from '@shared/readOnly'
import type { FileResponse } from '@shared/types'
import { BridgeRequestError, api } from '../api'
import { flushRenamedPath } from '../lib/renameContinuity'
import { announcedWrite } from '../lib/twinEditors'
import { trackFileWrite } from '../views/writeProperty'

/** A convert that stopped before it wrote: its words are the notice's reason. */
export class ConvertStopped extends Error {}

/** Why a convert failed, in the notice's words. */
export function convertFailure(err: unknown): string {
  if (err instanceof BridgeRequestError && err.code === 'FORBIDDEN') return 'the disk refused the change. Nothing changed.'
  if (err instanceof BridgeRequestError && err.code === 'CONFLICT') return 'the file changed on disk. Nothing changed; try again.'
  if (err instanceof CardNotFoundError) return 'the card is no longer there.'
  return err instanceof Error ? err.message : String(err)
}

const folderOf = (path: string): string => path.slice(0, path.lastIndexOf('/'))

/** The file as it is on disk once its open editors saved (one read: its mtime is the compare-and-set's). */
async function readSaved(path: string): Promise<FileResponse> {
  await flushRenamedPath(path)
  const file = await api.readFile(path)
  if (isPageReadOnly(file.content)) throw new ConvertStopped('it is read only.')
  return file
}

/** ONE compare-and-set write of `path`, as the app's own (an open tab takes it quietly), taken by the index at once. */
const writeOnce = (path: string, content: string, mtime: number): Promise<{ mtime: number }> =>
  trackFileWrite(announcedWrite(path, () => api.writeFile({ path, content, expectedMtime: mtime, quiet: true })))

/** A NEW file in `folder` named `name`, or the first free `<stem>-2.md`, `-3`, …: a file there is never overwritten. */
async function createNew(folder: string, name: string, content: string): Promise<string> {
  const stem = name.replace(/\.md$/, '')
  for (let n = 1; n <= 50; n++) {
    const path = `${folder}/${n === 1 ? name : `${stem}-${n}.md`}`
    try {
      await trackFileWrite(api.writeFile({ path, content, expectedMtime: 0, quiet: true }))
      return path
    } catch (err) {
      if (!(err instanceof BridgeRequestError) || err.code !== 'CONFLICT') throw err
    }
  }
  throw new ConvertStopped(`no free name for ${name}.`)
}

/** New card files in `folder`, one for each of `cards`: all or none (the ones made go to the Trash when one fails). */
async function createCards(folder: string, cards: readonly CardFileOut[]): Promise<string[]> {
  const made: string[] = []
  try {
    for (const card of cards) made.push(await createNew(folder, card.name, card.content))
    return made
  } catch (err) {
    await removeAll(made)
    throw err
  }
}

/** Each of `paths` to the Trash; one that will not go stays (its card is the same card: the sweep settles it). */
async function removeAll(paths: readonly string[]): Promise<void> {
  for (const path of paths) await api.file.delete({ path }).catch(() => undefined)
}

/** The new files are written; then `path`, once. A second write that fails takes the new files back out. */
async function thenWrite(made: readonly string[], path: string, content: string, mtime: number): Promise<void> {
  try {
    await writeOnce(path, content, mtime)
  } catch (err) {
    await removeAll(made)
    throw err
  }
}

/**
 * MOVE TO ITS OWN FILE: card `id` (the one at `index`) of `page` goes to a new card file in the page's folder, named
 * `cardFileName(title, id)` (a free name if taken); `![[GEO-140]]` takes its place. Resolves to the card file's path.
 */
export async function moveCardToFile(page: string, id: string, index: number): Promise<string> {
  const file = await readSaved(page)
  const out = moveCardOut(file.content, id, index)
  const [made] = await createCards(folderOf(page), [out.card])
  await thenWrite([made], page, out.page, file.mtime)
  return made
}

/**
 * PUT BACK INTO THIS PAGE: the `nth` lone embed `![[inner]]` of `page` becomes card `id`'s block from its card file
 * `cardPath`, at the embed's indent; then the card file goes to the Trash. Only a valid card file (this card and nothing
 * else) goes: one that holds more stops the action. A card file that will not go: the page gets its bytes back.
 */
export async function putCardBackIntoPage(page: string, cardPath: string, id: string, inner: string, nth: number): Promise<void> {
  const file = await readSaved(page)
  const card = await readSaved(cardPath)
  // The card file goes to the Trash: only one that holds this card and nothing else.
  if (cardFileShape(splitFrontmatter(card.content).body).problem !== 'ok') throw new ConvertStopped('its card file holds more than this card. Fix it in its tab first.')
  const written = await writeOnce(page, putCardBack(file.content, inner, nth, card.content, id), file.mtime)
  try {
    await api.file.delete({ path: cardPath })
  } catch (err) {
    await writeOnce(page, file.content, written.mtime).catch(() => undefined)
    throw err
  }
}

/**
 * TURN INTO A PAGE: the card file `path` loses `kind: card`; the card's title (on its card line, YAZ-5308) is the page's
 * `title:` too; then the page name
 * rule (`retitle`: the page's own ID, and `<title>-<id>.md`). Resolves to its path after. A rename that fails keeps
 * the name: the file is a page all the same.
 */
export async function turnIntoPage(path: string): Promise<string> {
  const file = await readSaved(path)
  const { content, title } = cardFileAsPage(file.content)
  await writeOnce(path, content, file.mtime)
  if (title === '') return path
  return api.file.retitle({ path, title }).then(
    (res) => res.newPath,
    () => path,
  )
}

/**
 * TURN INTO A CARD FILE: the page `path` (one card with its ID, no other text) takes `kind: card`, its `title:` goes to
 * `aliases` (and onto a card line with no title, YAZ-5308), its `id:` stays; then it takes the card's name. Resolves to its path after (a rename that fails keeps the name).
 */
export async function turnIntoCardFile(path: string): Promise<string> {
  const file = await readSaved(path)
  const out = pageAsCardFile(file.content)
  if (out === null) throw new ConvertStopped('the page must hold one card and no other text.')
  await writeOnce(path, out.content, file.mtime)
  const to = `${folderOf(path)}/${out.name}`
  if (to === path) return path
  return api.file.rename({ oldPath: path, newPath: to }).then(
    (res) => res.newPath,
    () => path,
  )
}

/** SPLIT INTO N CARD FILES: the first card stays in `path`; each other card goes to a new card file beside it. Resolves to the new files. */
export async function splitIntoCardFiles(path: string): Promise<string[]> {
  const file = await readSaved(path)
  const out = splitCardFile(file.content)
  if (out === null) throw new ConvertStopped('each card needs its ID first. Try again in a moment.')
  const made = await createCards(folderOf(path), out.cards)
  await thenWrite(made, path, out.keep, file.mtime)
  return made
}

/** MOVE INTO THE CARD: the text outside the card of `path` goes into it (above → the front's start, below → the last side's end). */
export async function moveIntoCard(path: string): Promise<void> {
  const file = await readSaved(path)
  const next = moveTextIntoCard(file.content)
  if (next !== null) await writeOnce(path, next, file.mtime)
}

/** MAKE A CARD FROM THE TEXT: the body of the card file `path`, which holds no card, becomes one card. */
export async function makeCardFromText(path: string): Promise<void> {
  const file = await readSaved(path)
  const next = cardFromText(file.content)
  if (next !== null) await writeOnce(path, next, file.mtime)
}
