/**
 * Tests only (YAZ-3816): the blocks the heading folds hide under `root`. A folded section marks only its heading and the
 * block after it, so this asks the plugin's own selector (`headingFoldSiblingsSelector`) for each fold drawn under `root`.
 */
import { HEADING_FOLD_START_CLASS, headingFoldSiblingsSelector } from './headingFolding'

export const headingFoldHidden = (root: ParentNode): Element[] => {
  const ids = [...root.querySelectorAll(`[class*="${HEADING_FOLD_START_CLASS}"]`)].flatMap((el) =>
    [...el.classList].filter((cls) => cls.startsWith(HEADING_FOLD_START_CLASS)).map((cls) => cls.slice(HEADING_FOLD_START_CLASS.length)),
  )
  if (ids.length === 0) return []
  return [...root.querySelectorAll(ids.map(headingFoldSiblingsSelector).join(', '))]
}
