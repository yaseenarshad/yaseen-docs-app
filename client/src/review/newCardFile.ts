/**
 * NEW CARD (YAZ-5037, YAZ-5101): the sidebar's "New card" opens the name box as "New note" does; the typed name is the
 * card's TITLE. Then ONE ID from the vault's door (`takeNoteId`, as a new page takes its own), and the file named after
 * the title (`cardFileName`; the placeholder "Title" gives `<id>.md`) holding `kind: card` and one card — the title as
 * its first line, and the card line with that ID — in ONE `createFile`, which never overwrites. Main writes no page
 * `id:` into a card file: the card's ID is the file's.
 *
 * The file's tab then opens in Edit card (`isNewCard`, read once by `CardFileView`): the caret after the title, or the
 * placeholder "Title" selected.
 */
import { NEW_CARD_TEXT, cardFileContent, cardFileName } from '@shared/cardFileFormat'
import { EMPTY_CARD_LINE, withCardId } from '@shared/cardLine'
import { api } from '../api'
import { takeNoteId } from '../views/scaffold'

/** The card files this window just made, whose tab has not opened yet. */
const fresh = new Set<string>()

/** Makes a new card file in `dir`, its card titled `title`, and resolves its path. A failure (no ID, a name taken) propagates; nothing is made then. */
export async function createCardFile(dir: string, title = NEW_CARD_TEXT): Promise<string> {
  const text = title.trim() === '' ? NEW_CARD_TEXT : title.trim()
  const id = await takeNoteId(dir)
  const path = `${dir}/${cardFileName(text, id)}`
  await api.createFile({ path, content: cardFileContent(text, withCardId(EMPTY_CARD_LINE, id)) })
  fresh.add(path)
  return path
}

/** Is `path` a card file this window just made, whose tab has not opened yet? Its tab then starts in Edit card. */
export const isNewCard = (path: string): boolean => fresh.has(path)

/** Its tab opened (`isNewCard` read): it starts in Edit card once, and never again. */
export const forgetNewCard = (path: string): void => void fresh.delete(path)
