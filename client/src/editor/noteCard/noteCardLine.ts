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
 */
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import type { EditorState, Transaction } from '@milkdown/kit/prose/state'
import { EMPTY_CARD_LINE, formatCardLine, parseCardLine, type CardLine } from '@shared/cardLine'
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
  const next = formatCardLine(changed)
  if (changed === line || next === cleanCardLine(node.attrs.cardLine)) return null
  return state.tr.setNodeAttribute(pos, 'cardLine', next)
}
