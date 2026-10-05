/**
 * The box that asks, once, whether a vault's notes get IDs (YAZ-2523 🔒 V2, V11), before the
 * first one is written. The LOCKED copy lives in the pure function; the component stays trivial.
 */
import type { IndexResponse } from '@shared/types'
import { ConfirmSheet } from './ConfirmSheet'

type Ask = NonNullable<IndexResponse['ask']>

const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`

/** The LOCKED copy: what a yes would write, counted; with no note to write, what the two kinds of vault are. */
export function idsAskMessage({ notes, folders, foreign }: Ask): string {
  if (notes === 0) {
    return `Should this vault's notes have IDs? With IDs, the app names each note's file and links keep working when a note is renamed or moved.${folders > 0 ? ` Saying yes adds a hidden settings file to ${count(folders, 'folder')}.` : ''} Without them, notes are plain files named as you type them, and the app writes nothing extra.`
  }
  const replaced = foreign > 0 ? ` ${foreign} of them already ${foreign === 1 ? 'has' : 'have'} an ID from another tool, which would be replaced.` : ''
  return `Give this vault's notes IDs? The app would write an ID into ${count(notes, 'note')}${folders > 0 ? ` and add a hidden settings file to ${count(folders, 'folder')}` : ''}.${replaced} With IDs, links keep working when a note is renamed or moved. Without them, the app leaves every file exactly as it is.`
}

interface ConfirmIdsProps {
  /** What a yes would write (the index snapshot's `ask`). */
  ask: Ask
  /** One of the two answers, to be saved in the vault. */
  onAnswer: (enabled: boolean) => void
  /** Esc or a click outside: not now, and nothing is saved. */
  onDismiss: () => void
}

/**
 * In-app sheet with two answers, on `ConfirmSheet`: "Give IDs" and "Not for this vault". Enter
 * chooses neither, because one of them writes into every note.
 */
export function ConfirmIds({ ask, onAnswer, onDismiss }: ConfirmIdsProps) {
  return <ConfirmSheet labelId="confirm-ids-text" text={idsAskMessage(ask)} confirmLabel="Give IDs" cancelLabel="Not for this vault" onConfirm={() => onAnswer(true)} onCancel={() => onAnswer(false)} onDismiss={onDismiss} />
}
