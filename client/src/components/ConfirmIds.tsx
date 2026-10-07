/**
 * The box that asks, once, whether a vault's notes get IDs (YAZ-2523 🔒 V2, V11), before the
 * first one is written. The record locks what the box must say and its two button labels, not
 * these sentences. They live in the pure function; the component stays trivial.
 */
import type { IndexResponse } from '@shared/types'
import { ConfirmSheet } from './ConfirmSheet'

type Ask = NonNullable<IndexResponse['ask']>

const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`

/**
 * The box's words: what a yes would write, counted; with no note to write, what the two kinds of vault are.
 * `vault` is the vault's name in a window with two or more (YAZ-2602 S40): the question then says which one it asks about.
 */
export function idsAskMessage({ notes, folders, foreign }: Ask, vault?: string): string {
  const whose = vault === undefined ? "this vault's notes" : `the notes in ${vault}`
  if (notes === 0) {
    return `Should ${whose} have IDs? With IDs, the app names each note's file and links keep working when a note is renamed or moved.${folders > 0 ? ` Saying yes adds a hidden settings file to ${count(folders, 'folder')}.` : ''} Without them, notes are plain files named as you type them, and the app writes nothing extra.`
  }
  const replaced = foreign > 0 ? ` ${foreign} of the notes already ${foreign === 1 ? 'has' : 'have'} an ID from another tool, which would be replaced.` : ''
  return `Give ${whose} IDs? The app would write an ID into ${count(notes, 'note')}${folders > 0 ? ` and add a hidden settings file to ${count(folders, 'folder')}` : ''}.${replaced} With IDs, links keep working when a note is renamed or moved, and the app names the file of a note you make or retitle. Without them, the app leaves every file exactly as it is.`
}

interface ConfirmIdsProps {
  /** What a yes would write (the index snapshot's `ask`). */
  ask: Ask
  /** The vault's name, handed over only where the window has two or more vaults (YAZ-2602 S40). */
  vault?: string
  /** One of the two answers, to be saved in the vault. */
  onAnswer: (enabled: boolean) => void
  /** Esc or a click outside: not now, and nothing is saved. */
  onDismiss: () => void
}

/**
 * In-app sheet with two answers, on `ConfirmSheet`: "Give IDs" and "Not for this vault". Enter
 * chooses neither, because one of them writes into every note.
 */
export function ConfirmIds({ ask, vault, onAnswer, onDismiss }: ConfirmIdsProps) {
  return <ConfirmSheet labelId="confirm-ids-text" text={idsAskMessage(ask, vault)} confirmLabel="Give IDs" cancelLabel="Not for this vault" onConfirm={() => onAnswer(true)} onCancel={() => onAnswer(false)} onDismiss={onDismiss} />
}
