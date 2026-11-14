/**
 * The desktop's board picture for a card (YAZ-5015; its own file since YAZ-5161, so the card drawing reads no bridge
 * and no settings): the board's head through the bridge (`api.boardHead`; a board that is gone rejects, and the card
 * shows the unresolved pill), then the sidebar's hover picture (`boardPreviews`) in the app's theme and the
 * "dark colours" setting. The desktop passes it to `cardLook` (`CardLookPlace.boardPicture`).
 */
import { api } from '../../api'
import { storage } from '../../lib/storage'
import { appliedTheme } from '../../lib/theme'
import type { BoardPictureLoad } from './cardMedia'

export const desktopBoardPicture: BoardPictureLoad = async (root, path) => {
  const theme = appliedTheme()
  const darkColors = storage.getSettings()?.diagramDarkColors === 'keep' ? 'keep' : 'adapt'
  const head = await api.boardHead(path)
  try {
    // The picture code and the engines are the hover picture's lazy chunk: only a card on screen brings them.
    const { boardPreviews, boardPreviewKey } = await import('../../sidebar/boardPreviewCache')
    const picture = await boardPreviews.load(boardPreviewKey(root, { path, mtime: head.mtime }, theme, darkColors))
    return picture === '' ? '' : picture || null
  } catch {
    return null
  }
}
