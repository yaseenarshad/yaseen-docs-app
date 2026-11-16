import { useEffect, useState } from 'react'
import { cardOnPageIn } from '@client/review/cardRead'
import { CardNotFoundError } from '@shared/cardLine'
import type { Answers } from '../answers/answers'
import { changeCardLine } from '../answers/cardLineWrite'
import { UnsentChangeError } from '../answers/ops'
import CardActionRows from './CardActionRows'
import type { CardActionMarks } from './cardActions'

export interface CardMenuForProps {
  /** The open vault's answer list; null: the rows wait. */
  answers: Answers | null
  /** The file that holds the card (a page, or a card file) and the card's ID. */
  path: string
  id: string
  /** The Up next row (the vault reviews). */
  upNext: boolean
  /** The second tap: the host closes its menu. */
  onClose: () => void
  /** What to say when the write is in the list ("Archived"), or why it is not. */
  onNotice: (text: string) => void
  rowClassName?: string
}

/**
 * THE CARD ACTIONS FOR ONE CARD OUTSIDE REVIEW: the ⋯ on a card's head, in a page or in the card view. It reads the card's
 * marks as the phone shows them (`answers.text`: with the waiting actions) and writes each action with the phone's
 * safe card-line write (`changeCardLine`, the same one as Review's Up next): only that word changes,
 * queued, sent later in one compare-and-swap commit. Lazy: its chunk comes with the first menu.
 */
export default function CardMenuFor({ answers, path, id, upNext, onClose, onNotice, rowClassName }: CardMenuForProps) {
  const [marks, setMarks] = useState<CardActionMarks | null>(null)
  const [reads, setReads] = useState(0)
  useEffect(() => {
    if (answers === null) return
    return answers.subscribe((event) => {
      if (event.type === 'changed' && event.paths.includes(path)) setReads((n) => n + 1)
    })
  }, [answers, path])
  useEffect(() => {
    if (answers === null) return
    let live = true
    void answers.text(path).then((text) => {
      if (!live) return
      const card = text === null ? null : cardOnPageIn(path, text, id)
      setMarks(card === null ? null : { off: card.off, next: card.next, fix: card.fix === true, notitle: card.notitle === true })
    })
    return () => {
      live = false
    }
  }, [answers, path, id, reads])
  return (
    <CardActionRows
      marks={marks}
      upNext={upNext}
      disabled={answers === null}
      rowClassName={rowClassName}
      onAction={(action) => {
        onClose()
        if (answers === null) return
        void changeCardLine(answers, path, id, action.change).then(
          () => onNotice(action.done),
          (err: unknown) => onNotice(err instanceof CardNotFoundError ? 'This card is not on the phone now.' : err instanceof UnsentChangeError ? 'The phone cannot make this change. Make it on the Mac.' : 'That did not save. Try again.'),
        )
      }}
    />
  )
}
