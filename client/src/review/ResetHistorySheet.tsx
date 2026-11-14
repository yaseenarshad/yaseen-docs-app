/**
 * RESET HISTORY ASKS BY TYPING (YAZ-5376, Yaseen: "it's way too easy to click on it"): the card's ⋯ menu's last row opens
 * this box, never a yes/no. It says what happens in plain words and the red button waits until `reset` is typed.
 */
import { TypedConfirmSheet } from '../components/TypedConfirmSheet'

/** The word to type: short, and the same for every card. */
export const RESET_WORD = 'reset'

export const resetHistoryText = (id: string | null): string =>
  `Reset the review history of ${id ?? 'this card'}? Its reviews are erased and it starts again as a new card. You can't undo this in the app. Useful to learn a card again from scratch.`

export function ResetHistorySheet({ id, onConfirm, onCancel }: { id: string | null; onConfirm: () => void; onCancel: () => void }) {
  return (
    <TypedConfirmSheet
      labelId="confirm-reset-history-text"
      text={resetHistoryText(id)}
      ask={`Type ${RESET_WORD} to confirm.`}
      confirmLabel="Reset history"
      danger
      valid={(typed) => typed.trim().toLowerCase() === RESET_WORD}
      onConfirm={() => onConfirm()}
      onCancel={onCancel}
    />
  )
}
