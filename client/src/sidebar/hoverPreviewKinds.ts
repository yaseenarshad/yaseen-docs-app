import { fileKind, isBoard, isMarkdown } from '@shared/fileKind'

/**
 * The files a hover preview shows (YAZ-3075 D6; widened by YAZ-3508): a note's top, a board's picture, and a code
 * or text file's top with its colours. A PDF, an image, a folder or any other file shows none. One rule for every
 * place: the sidebar's rows, Recents, the tab board, the tabs, the new tab page, linked mentions, links, folder views.
 */
export const hasHoverPreview = (path: string): boolean => isBoard(path) || isMarkdown(path) || fileKind(path) === 'text'

/** A code or text file: its card is `code/CodeHoverPreview.tsx`, in Monaco's chunk. */
export const isCodeHover = (path: string): boolean => fileKind(path) === 'text'
