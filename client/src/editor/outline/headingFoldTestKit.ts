/**
 * Tests only (YAZ-3816): the blocks the heading folds hide under `root`. No marker sits on a hidden block, so this asks
 * each editor's own hide rules (`<style data-heading-folds>`, `headingFoldHideSelector`) without the page prefix.
 */
import { HEADING_FOLD_STYLE_ATTR } from './headingFolding'

const PREFIX = '.editor-instance .milkdown '

export const headingFoldHidden = (root: ParentNode): Element[] => {
  const selectors = [...document.querySelectorAll(`style[${HEADING_FOLD_STYLE_ATTR}]`)]
    .flatMap((style) => (style.textContent ?? '').split('\n'))
    .filter((rule) => rule.startsWith(PREFIX))
    .map((rule) => rule.slice(PREFIX.length, rule.indexOf(' {')))
  return selectors.length === 0 ? [] : [...root.querySelectorAll(selectors.join(', '))]
}
