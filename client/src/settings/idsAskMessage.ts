/**
 * The words of the box that asks before a vault's notes get IDs (YAZ-2677 🔒 D2). The box that asked
 * when a vault opened is gone (🔒 D1); Settings shows these words when the user clicks On. The record
 * locks what the box must say, not these sentences. They live in pure functions.
 */
import type { IndexResponse } from '@shared/types'

type Ask = NonNullable<IndexResponse['ask']>

const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`

/**
 * What an ID is, what a yes would write, counted (the index snapshot's `ask`), and how to undo it.
 * `vault` is the vault's name in a window with two or more (S13): the question then says which one it acts on.
 */
export function idsAskMessage({ notes, folders, foreign }: Ask, vault?: string): string {
  const writes = [...(notes > 0 ? [`write an ID into ${count(notes, 'note')}`] : []), ...(folders > 0 ? [`add a hidden settings file to ${count(folders, 'folder')}`] : []), 'name the file of each note you make or retitle']
  const will = writes.length < 3 ? writes.join(' and ') : `${writes.slice(0, -1).join(', ')}, and ${writes[writes.length - 1]}`
  const replaced = foreign > 0 ? ` ${foreign} of the notes already ${foreign === 1 ? 'has' : 'have'} an ID from another tool, which the app will replace.` : ''
  return `Give the notes in ${vault ?? 'this vault'} IDs? An ID is a short name for a note that never changes, like BUS-12. Links use it, so they keep working when you rename or move a note. If you turn this on, the app will ${will}.${replaced} To undo, turn it off. The IDs stay in the files and the app stops using them.`
}

/** The line above the text field: a vault with no ID letters chooses them (S5), and one that has them types those (S9). */
export const idsLettersAsk = (letters: string | undefined): string => (letters === undefined ? 'Type the ID letters for this vault: 2 to 5 letters, like BUS.' : `Type this vault's ID letters, ${letters}, to confirm.`)
