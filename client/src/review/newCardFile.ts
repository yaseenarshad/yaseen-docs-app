/**
 * NEW CARD (YAZ-5037): the sidebar's "New card" makes a card file in a folder at once, with no name box: ONE ID from
 * the vault's door (`takeNoteId`, as a new page takes its own), then `<id>.md` (`cardFileName` of the placeholder
 * title) holding `kind: card` and one card — the line "Title", as `/card` starts, and the card line with that ID — in
 * ONE `createFile`, which never overwrites. Main writes no page `id:` into a card file: the card's ID is the file's.
 *
 * The file's tab then opens in Edit card with "Title" selected (`isNewCard`, read once by `CardFileView`), and its
 * first Done names the file after the title.
 */
import { NEW_CARD_TEXT, cardFileContent, cardFileName } from '@shared/cardFileFormat'
import { EMPTY_CARD_LINE, withCardId } from '@shared/cardLine'
import { api } from '../api'
import { takeNoteId } from '../views/scaffold'

/** The card files this window just made, whose tab has not opened yet. */
const fresh = new Set<string>()

/** Makes a new card file in `dir` and resolves its path. A failure (no ID, a name taken) propagates; nothing is made then. */
export async function createCardFile(dir: string): Promise<string> {
  const id = await takeNoteId(dir)
  const path = `${dir}/${cardFileName(NEW_CARD_TEXT, id)}`
  await api.createFile({ path, content: cardFileContent(NEW_CARD_TEXT, withCardId(EMPTY_CARD_LINE, id)) })
  fresh.add(path)
  return path
}

/** Is `path` a card file this window just made, whose tab has not opened yet? Its tab then starts in Edit card. */
export const isNewCard = (path: string): boolean => fresh.has(path)

/** Its tab opened (`isNewCard` read): it starts in Edit card once, and never again. */
export const forgetNewCard = (path: string): void => void fresh.delete(path)
