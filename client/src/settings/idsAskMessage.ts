/**
 * The words of the box that asks before a vault's notes get IDs (YAZ-2677 🔒 D2). The box that asked
 * when a vault opened is gone (🔒 D1); Settings shows these words when the user clicks On. The record
 * locks what the box must say, not these sentences. They live in pure functions.
 */
import { SAME_WORD, type UnitText } from '../vault/unitWord'
import type { IdsState, IndexResponse } from '@shared/types'

type Ask = NonNullable<IndexResponse['ask']>

const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`
/** The notes counted, in the vault's word (YAZ-4938). */
const notesCount = (n: number, unit: UnitText): string => unit(count(n, 'note'))

/**
 * What an ID is, what a yes would write, counted (the index snapshot's `ask`), and how to undo it.
 * `vault` is the vault's name in a window with two or more (S13): the question then says which one it acts on.
 */
export function idsAskMessage({ notes, folders, foreign }: Ask, vault?: string, unit: UnitText = SAME_WORD): string {
  const writes = [...(notes > 0 ? [`write an ID into ${notesCount(notes, unit)}`] : []), ...(folders > 0 ? [`add a hidden settings file to ${count(folders, 'folder')}`] : []), unit('name the file of each note you make or retitle')]
  const will = writes.length < 3 ? writes.join(' and ') : `${writes.slice(0, -1).join(', ')}, and ${writes[writes.length - 1]}`
  const replaced = foreign > 0 ? unit(` ${foreign} of the notes already ${foreign === 1 ? 'has' : 'have'} an ID from another tool, which the app will replace.`) : ''
  return unit(`Give the notes in ${vault ?? 'this vault'} IDs? An ID is a short name for a note that never changes, like BUS-12. Links use it, so they keep working when you rename or move a note. If you turn this on, the app will ${will}.${replaced} To undo, turn it off. The IDs stay in the files and the app stops using them.`)
}

/**
 * The box of "Give IDs" in a folder whose notes already hold number IDs (YAZ-4922 🔒 D2): how many hold which letters,
 * what "Keep" keeps, what a yes writes, and what other letters do. `groups` come biggest first (`ask.groups`).
 */
export function keepIdsAskMessage({ folders, groups = [], bare = 0 }: Ask, vault?: string, unit: UnitText = SAME_WORD): string {
  const [main, ...others] = groups
  if (main === undefined) return idsAskMessage({ notes: bare, folders, foreign: 0 }, vault, unit)
  const held = `${main.count} ${main.count === 1 ? 'note or folder has' : 'notes and folders have'} an ID with ${main.letters}`
  const rest = others.map((group) => `${group.count} with ${group.letters}`)
  const listed = rest.length === 0 ? held : `${[held, ...rest.slice(0, -1)].join(', ')}, and ${rest[rest.length - 1]}`
  const kept = others.length === 0 ? '' : `, and so do the ${others.map((group) => group.letters).join(' and ')} IDs`
  const writes = [...(bare > 0 ? [`write an ID into the ${count(bare, 'note')} with none`] : []), ...(folders > 0 ? [`add a hidden settings file to ${count(folders, 'folder')}`] : []), 'name the file of each note you make or retitle']
  const will = writes.length < 3 ? writes.join(' and ') : `${writes.slice(0, -1).join(', ')}, and ${writes[writes.length - 1]}`
  // The vault's word (YAZ-4938) for every "note" in the box: one pass over the whole text.
  return unit(`Give the notes in ${vault ?? 'this vault'} IDs? ${listed}. Keep ${main.letters}: these IDs stay as they are${kept}. The app will ${will}. Or type other letters: each ${main.letters} ID takes them, its number stays, and each link and file name follows. To undo, turn it off.`)
}

/** The line above the text field of the box that keeps the IDs (YAZ-4922 D2). */
export const KEEP_OTHER_ASK = 'Or type other letters: 2 to 5 letters, like BUS.'

/** The line above the text field: a vault with no ID letters chooses them (S5), and one that has them types those (S9). */
export const idsLettersAsk = (letters: string | undefined): string => (letters === undefined ? 'Type the ID letters for this vault: 2 to 5 letters, like BUS.' : `Type this vault's ID letters, ${letters}, to confirm.`)

/**
 * The box of "Change letters" (YAZ-2677 🔒 D5, S80): what changes, counted, what stays, and when to do it.
 * `notes` counts each note and folder that holds a number ID.
 */
export const lettersAskMessage = ({ letters, notes }: Pick<IdsState, 'letters' | 'notes'>, vault?: string, unit: UnitText = SAME_WORD): string =>
  `Change the ID letters of ${vault ?? 'this vault'}? They are ${letters} now. The app will change the ID of ${notesCount(notes, unit)}, and each link and file name that holds one. The numbers stay, and a link with the old letters still opens. Do this on one Mac, while this vault is synced and closed on your other Macs.`

/** The line above the text field of "Change letters". */
export const NEW_LETTERS_ASK = 'Type the new ID letters: 2 to 5 letters, like BUS.'

/** The line of the row "ID letters": the letters, and what a change that stopped left (S79, S83). */
export const lettersLine = ({ letters, stale }: Pick<IdsState, 'letters' | 'stale'>, unit: UnitText = SAME_WORD): string =>
  `This vault's ID letters are ${letters}.${stale > 0 ? ` ${notesCount(stale, unit)} still ${stale === 1 ? 'has' : 'have'} the old letters.` : ''}`

/** The line of the row "Old IDs" (S88). With no note left, a run stopped before each link followed its note (S90). */
export const oldIdsLine = (old: number, unit: UnitText = SAME_WORD): string => (old === 0 ? unit('Each note has a number, but some links still hold an old ID.') : `${notesCount(old, unit)} ${old === 1 ? 'has' : 'have'} an old ID, like 6cbnmcq5n2sj.`)

/** The box of "Give them numbers" (🔒 D6, S89, S91): the count, what happens, and what to do on the other Mac first. */
export const oldIdsAskMessage = (old: number, vault?: string, unit: UnitText = SAME_WORD): string =>
  `${old === 0 ? unit(`Finish giving the old IDs in ${vault ?? 'this vault'} numbers? Each note has its number. Each link that still holds an old ID follows.`) : `Give the ${notesCount(old, unit)} with an old ID in ${vault ?? 'this vault'} a number? Each one gets the next number of the vault, the oldest file first. Each link and file name follows.`} First sync this vault and close the app on your other Macs: a Mac with edits that are not synced can conflict.`
