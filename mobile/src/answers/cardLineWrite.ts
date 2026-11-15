import { cardOnPageIn } from '@client/review/cardRead'
import { CardNotFoundError, cardIdOf, pageCards, type CardLine } from '@shared/cardLine'
import type { Answers } from './answers'
import { opsBetween } from './ops'

/**
 * THE PHONE'S SAFE CARD-LINE WRITE (YAZ-5078; shared since YAZ-5504): a change of card `id`'s line, from the file at
 * `path` as the phone shows it (`answers.text`: the stored copy with the waiting actions), becomes ACTIONS (`CardOp`,
 * `opsBetween`) in the answer list. So it is queued (offline too), idempotent, applied by card ID to the newest text at
 * the send (one compare-and-swap commit), and changes only its own word. A change it cannot send throws
 * `UnsentChangeError`; a card that is gone, `CardNotFoundError`. Review's host (`phoneReviewHost`) and the reader's
 * card menu (`cardMenu/`) both write through here.
 *
 * YAZ-5078: the inverse of a mark the list still holds unsent (Undo of Archive card, Up next, Fix later, Title on the
 * front; or the menu's second change back): the mark's group leaves the list, so the card reads byte for byte as
 * before. When a send has tried it (it may be on GitHub, YAZ-5180), the list keeps it and the inverse goes as an action.
 */
export async function changeCardLine(answers: Answers, path: string, id: string, change: (line: CardLine) => CardLine): Promise<void> {
  const text = await answers.text(path)
  const card = text === null ? null : cardOnPageIn(path, text, id)
  const block = text === null ? undefined : pageCards(text).find((c) => cardIdOf(c.line) === card?.id)
  if (card === null || block === undefined) throw new CardNotFoundError(id)
  const ops = opsBetween(id, block.line, change(block.line))
  if (ops.length === 0) return
  const only = ops.length === 1 ? ops[0] : null
  if (only !== null && (only.kind === 'off' || only.kind === 'next' || only.kind === 'fix' || only.kind === 'notitle')) {
    const waiting = answers.waiting()
    const mark = [...waiting].reverse().find((w) => w.op.kind === only.kind && w.op.id === id && 'on' in w.op && w.op.on === !only.on)
    if (mark !== undefined && waiting.filter((w) => w.group === mark.group).length === 1 && (await answers.undo(mark.group))) return
  }
  // The title off the card line (YAZ-5308), '' for a card with none: the lost-answer line then names the card by its ID.
  await answers.add(ops.map((op) => ({ op, path, title: card.title })))
}
