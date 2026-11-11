import { fileKind, isBoard, isMarkdown } from '@shared/fileKind'

/**
 * The files a hover preview shows (YAZ-3075 D6; widened by YAZ-3508, and by YAZ-3746 13R): a note's top, a board's
 * picture, a code or text file's top with its colours, a picture, and a PDF's first page. A folder or any other file
 * shows none. One rule for every place: the sidebar's rows, Recents, the tab board, the tabs, the new tab page, linked
 * mentions, links, folder views, a folder page's Other files. (D6 said a PDF or an image never previews; Yaseen
 * overturned it on 2026-11-08, YAZ-3746 13R.)
 */
export const hasHoverPreview = (path: string): boolean => isBoard(path) || isMarkdown(path) || fileKind(path) === 'text' || isMediaHover(path)

/** A code or text file: its card is `code/CodeHoverPreview.tsx`, in Monaco's chunk. */
export const isCodeHover = (path: string): boolean => fileKind(path) === 'text'

/** A picture or a PDF (13R): its card is `sidebar/MediaHoverPreview.tsx`, its own chunk. */
export const isMediaHover = (path: string): boolean => {
  const kind = fileKind(path)
  return kind === 'image' || kind === 'pdf'
}
