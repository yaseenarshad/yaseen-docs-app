/**
 * FOLDED CARD SIDES (YAZ-5904; Yaseen: "collapse the sides (all of them side 2+) ... show like side 2 side 3 and then
 * you can click it to expand it"). A long Side 2 made a page hard to read. With the fold, each side after the first
 * starts hidden, and its rule (`.card__rule`, "Side 2") is a button: "▸ Side 2" (Q3: no line count). A click, Enter or Space opens
 * that side; again folds it. Which sides are open is not saved: a new draw folds them again (D2).
 *
 * WHERE IT FOLDS (D1, D3, Q1): a card in a page, an embed, the hover preview and the phone's page (Card sides in pages);
 * a card page (Card sides on card pages); Explore by its own setting. Never the Inbox, Preview, Review or Edit card: those never ask for the fold.
 *
 * WHO DECIDES: one CSS variable on each `.card`, `--card-sides-fold: on | off` (`card.css`). The vault's card look sets
 * `--card-sides-fold-pages`, `--card-sides-fold-card-pages` and `--card-sides-fold-explore` on each surface
 * (`cardLookStyle`). A card takes the pages' value, a card page's card the card pages' value; a page's own `card-sides` key on its mount (`data-card-sides`) wins;
 * a card in an Explore layer takes the Explore value. A surface that may fold reads the variable on its card (`foldAt`) once the
 * card is in the document, and folds it (`setCardFold`). A change of a setting or of a page key calls
 * `tellCardFoldChange`, and each surface reads the variable again. Pure DOM, no imports: the find chunk reads it too.
 */

/** The CSS variable that says "fold" (`on`) on a surface. */
export const CARD_SIDES_FOLD_VAR = '--card-sides-fold'

/** A rule that folds its side: a button. The surfaces' own press handlers leave it alone. */
export const CARD_FOLD_RULE = '.card__rule[data-fold]'

/** Does the surface around `el` fold card sides? Only an element in the document knows: else no. */
export function foldAt(el: Element | null): boolean {
  if (el === null || !el.isConnected || typeof getComputedStyle !== 'function') return false
  return getComputedStyle(el).getPropertyValue(CARD_SIDES_FOLD_VAR).trim() === 'on'
}

/** "Side 2": the rule's words, from the side's number (Q3: no line count). */
export const foldLabel = (side: number): string => `Side ${side}`

/** The side a rule opens: the element right after it. */
const sideOf = (rule: Element): HTMLElement | null => {
  const next = rule.nextElementSibling
  return next instanceof HTMLElement && next.classList.contains('card__side') ? next : null
}

/** Opens (`open`) or folds the side after `rule`. */
function setRuleOpen(rule: HTMLElement, open: boolean): void {
  const side = sideOf(rule)
  rule.setAttribute('aria-expanded', String(open))
  if (side !== null) side.hidden = !open
}

/**
 * Folds (`fold`) or unfolds the card `sides` (`renderCard`'s `.card__sides`). Folded: every side after the first is
 * hidden, and its rule is a button that says its side. Unfolded: the rules are separators again and every
 * side shows. The same value again changes nothing, so an open side stays open.
 */
export function setCardFold(sides: Element, fold: boolean): void {
  if (sides.hasAttribute('data-fold') === fold) return
  sides.toggleAttribute('data-fold', fold)
  for (const rule of sides.querySelectorAll<HTMLElement>(':scope > .card__rule')) {
    const side = sideOf(rule)
    if (fold) {
      const label = foldLabel(Number(side?.dataset.side ?? 0) + 1)
      rule.dataset.fold = label
      rule.setAttribute('role', 'button')
      rule.tabIndex = 0
      rule.setAttribute('aria-label', label)
      setRuleOpen(rule, false)
    } else {
      delete rule.dataset.fold
      rule.setAttribute('role', 'separator')
      rule.removeAttribute('tabindex')
      rule.removeAttribute('aria-label')
      rule.removeAttribute('aria-expanded')
      if (side !== null) side.hidden = false
    }
  }
}

/** Folds the card `sides` as the surface around them says (`foldAt`). */
export const followCardFold = (sides: Element | null | undefined): void => {
  if (sides != null) setCardFold(sides, foldAt(sides))
}

/** Each card's `.card__sides` under `root` (itself included), folded as its surface says. */
export function followCardFolds(root: Element): void {
  if (root.matches('.card__sides')) followCardFold(root)
  for (const sides of root.querySelectorAll('.card__sides')) followCardFold(sides)
}

/** The fold rule a press or a key hit, or null. */
const ruleAt = (target: EventTarget | null): HTMLElement | null => (target instanceof Element ? target.closest<HTMLElement>(CARD_FOLD_RULE) : null)

/** A click on a fold rule opens or folds its side (`renderCard` listens on each card). */
export function onFoldClick(event: MouseEvent): void {
  const rule = ruleAt(event.target)
  if (rule === null) return
  event.preventDefault()
  setRuleOpen(rule, rule.getAttribute('aria-expanded') !== 'true')
}

/** Enter or Space on a fold rule, as a button's. */
export function onFoldKey(event: KeyboardEvent): void {
  if (event.key !== 'Enter' && event.key !== ' ') return
  const rule = ruleAt(event.target)
  if (rule === null || event.metaKey || event.ctrlKey || event.altKey) return
  event.preventDefault()
  event.stopPropagation()
  setRuleOpen(rule, rule.getAttribute('aria-expanded') !== 'true')
}

/** Find (⌘F) landed in a folded side (YAZ-5904): that side opens, so the match shows. True when one opened. */
export function openFoldedSideAt(node: Node | null): boolean {
  const el = node instanceof Element ? node : (node?.parentElement ?? null)
  const side = el?.closest<HTMLElement>('.card__side[hidden]')
  const rule = side?.previousElementSibling
  if (side == null || !(rule instanceof HTMLElement) || !rule.matches(CARD_FOLD_RULE)) return false
  setRuleOpen(rule, true)
  return true
}

const listeners = new Set<() => void>()

/** Runs `listener` when a fold setting or a page's `card-sides` changes. Returns the unsubscribe. */
export function onCardFoldChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** A fold setting or a page's `card-sides` changed: each surface reads its variable again. */
export function tellCardFoldChange(): void {
  for (const listener of [...listeners]) listener()
}
