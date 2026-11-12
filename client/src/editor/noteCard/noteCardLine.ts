/**
 * A note card's card line in the editor (YAZ-4961): the `<!-- card: … -->` line right under a ```` ```card ```` fence
 * (`@shared/cardLine`, the one reader and writer) is the `code_block` node's `cardLine` attribute, as `<!-- code: … -->`
 * is its `width` (`code/codeWidth.ts`, which holds the schema, the load join and the save for both).
 *
 * LOAD: `codeWidthRemark` joins a `code` node of the language `card` (no text after it) with its NEXT sibling when that
 * is a card line (`joinNextComment`), BEFORE the code comment's join: the line leaves the tree and its text, trimmed,
 * goes on the node. SAVE: the fence, then the line as an `html` node, on the line right under the fence
 * (`noteCardJoin`), at the fence's indent. The attribute keeps the line's TEXT, so a line this build reads saves with
 * the same bytes, unknown parts and all. The user never sees or edits it: the ⋯ menu and the ID at insert change it
 * through `changeNoteCardLine`, one transaction (one ⌘Z).
 *
 * UNDO (YAZ-4975): a change of the line is a `CardLineStep`, not a plain attribute step. It holds the line before and
 * after, and it applies only that DIFFERENCE to the line it finds: the ID, `off`, and each review added or removed. So
 * the ⌘Z of "Turn review on" after an Inbox answer landed from outside turns review off again and keeps the answer.
 * A plain attribute step would write back the whole old line, and the answer would go.
 */
import type { Node as ProseNode, Schema } from '@milkdown/kit/prose/model'
import type { EditorState, Transaction } from '@milkdown/kit/prose/state'
import { AttrStep, Step, StepMap, StepResult, type Mappable } from '@milkdown/kit/prose/transform'
import { EMPTY_CARD_LINE, cardIdOf, cardReviewsOf, formatCardLine, isCardOff, parseCardLine, withCardId, withCardOff, type CardLine, type CardReview } from '@shared/cardLine'
import type { Code, RootContent } from 'mdast'

/** The language of a note card's fence. */
export const NOTE_CARD_LANGUAGE = 'card'
/** On the card's `<pre>` (copy and paste inside the app): the card line's text. */
export const CARD_LINE_ATTR = 'data-card-line'

/** Is `node` a note card: a code block of the language `card`? */
export const isNoteCardNode = (node: ProseNode | null | undefined): boolean => node?.type.name === 'code_block' && node.attrs.language === NOTE_CARD_LANGUAGE

/** Is the mdast `block` a note card's fence: ```` ```card ```` with nothing after the language (`isCardFence`)? */
export const isNoteCardCode = (block: RootContent): boolean => block.type === 'code' && block.lang === NOTE_CARD_LANGUAGE && !(block as Code).meta

/** A card line's text, checked: one card line (`parseCardLine` reads it), trimmed; else null. */
export function cleanCardLine(value: unknown): string | null {
  if (typeof value !== 'string' || /[\r\n]/.test(value.trim())) return null
  return parseCardLine(value) === null ? null : value.trim()
}

/** What a card's line holds (`EMPTY_CARD_LINE` when it has none). */
export const noteCardLineOf = (node: ProseNode): CardLine => {
  const text = cleanCardLine(node.attrs.cardLine)
  return (text === null ? null : parseCardLine(text)) ?? EMPTY_CARD_LINE
}

/** The card line of `node` changed by `change`, as one transaction on `state`; null when `pos` holds no card or nothing changes. */
export function changeNoteCardLine(state: EditorState, pos: number, change: (line: CardLine) => CardLine): Transaction | null {
  const node = state.doc.nodeAt(pos)
  if (node === null || !isNoteCardNode(node)) return null
  const line = noteCardLineOf(node)
  const changed = change(line)
  if (changed === line || formatCardLine(changed) === cleanCardLine(node.attrs.cardLine)) return null
  return state.tr.step(new CardLineStep(pos, formatCardLine(line), formatCardLine(changed)))
}

const sameReview = (a: CardReview, b: CardReview): boolean => a.at === b.at && a.rating === b.rating

/** `reviews` less one of each of `less` (a review is its time and its rating). */
function lessReviews(reviews: readonly CardReview[], less: readonly CardReview[]): CardReview[] {
  const left = [...less]
  return reviews.filter((r) => {
    const i = left.findIndex((l) => sameReview(l, r))
    if (i === -1) return true
    left.splice(i, 1)
    return false
  })
}

/** `line` with `review` among its reviews in time order: before the first later one, else after the last; with none, at `place`. */
function withReviewInOrder(line: CardLine, review: CardReview, place: number): CardLine {
  const later = line.parts.findIndex((p) => p.kind === 'review' && p.review.at > review.at)
  if (later === -1) {
    const last = line.parts.map((p) => p.kind === 'review').lastIndexOf(true)
    const at = last === -1 ? Math.min(place, line.parts.length) : last + 1
    return { parts: [...line.parts.slice(0, at), { kind: 'review', review }, ...line.parts.slice(at)] }
  }
  return { parts: [...line.parts.slice(0, later), { kind: 'review', review }, ...line.parts.slice(later)] }
}

/**
 * The line `now` with the change from `before` to `after` laid on it: the ID and `off` as `after` has them where they
 * differ, each review `after` gained added, each review it lost removed. Everything else of `now` stays.
 */
export function rebaseCardLine(now: CardLine, before: CardLine, after: CardLine): CardLine {
  let line = now
  const id = cardIdOf(after)
  if (id !== cardIdOf(before)) line = id === null ? { parts: line.parts.filter((p) => p.kind !== 'id') } : withCardId(line, id)
  if (isCardOff(after) !== isCardOff(before)) line = withCardOff(line, isCardOff(after))
  for (const gone of lessReviews(cardReviewsOf(before), cardReviewsOf(after))) {
    const i = line.parts.findIndex((p) => p.kind === 'review' && sameReview(p.review, gone))
    if (i !== -1) line = { parts: line.parts.filter((_, j) => j !== i) }
  }
  for (const added of lessReviews(cardReviewsOf(after), cardReviewsOf(before))) {
    const place = after.parts.findIndex((p) => p.kind === 'review' && sameReview(p.review, added))
    line = withReviewInOrder(line, added, place)
  }
  return line
}

const lineOf = (text: string | null): CardLine => (text === null ? null : parseCardLine(text)) ?? EMPTY_CARD_LINE

/**
 * One change of a card's line, as its difference (see the header): `before` and `after` are the line's text (null: no
 * line). Its inverse is the change back, laid on the line as it is THEN — so an undo keeps what landed in between.
 */
export class CardLineStep extends Step {
  constructor(
    readonly pos: number,
    readonly before: string | null,
    readonly after: string | null,
  ) {
    super()
  }

  apply(doc: ProseNode): StepResult {
    const node = doc.nodeAt(this.pos)
    if (node === null || !isNoteCardNode(node)) return StepResult.fail('No note card at the card line step`s position')
    const next = formatCardLine(rebaseCardLine(noteCardLineOf(node), lineOf(this.before), lineOf(this.after)))
    return new AttrStep(this.pos, 'cardLine', next).apply(doc)
  }

  getMap(): StepMap {
    return StepMap.empty
  }

  invert(): Step {
    return new CardLineStep(this.pos, this.after, this.before)
  }

  map(mapping: Mappable): Step | null {
    const pos = mapping.mapResult(this.pos, 1)
    return pos.deletedAfter ? null : new CardLineStep(pos.pos, this.before, this.after)
  }

  toJSON(): { stepType: string; pos: number; before: string | null; after: string | null } {
    return { stepType: 'noteCardLine', pos: this.pos, before: this.before, after: this.after }
  }

  static fromJSON(_schema: Schema, json: { pos: number; before: string | null; after: string | null }): CardLineStep {
    return new CardLineStep(json.pos, json.before, json.after)
  }
}
Step.jsonID('noteCardLine', CardLineStep)
