/** The words of the box that asks before a vault's notes get IDs (YAZ-2677 🔒 D2), pinned character for character. */
import { describe, expect, it } from 'vitest'
import { idsAskMessage, idsLettersAsk } from './idsAskMessage'

const WHAT = ' An ID is a short name for a note that never changes, like BUS-12. Links use it, so they keep working when you rename or move a note.'
const NAMES = 'name the file of each note you make or retitle.'
const UNDO = ' To undo, turn it off. The IDs stay in the files and the app stops using them.'
const START = `Give the notes in this vault IDs?${WHAT} If you turn this on, the app will `

describe('the box’s words (YAZ-2677 D2)', () => {
  it('what an ID is, what the app will write with its counts, and how to undo (S5)', () => {
    expect(idsAskMessage({ notes: 854, folders: 61, foreign: 0 })).toBe(`${START}write an ID into 854 notes, add a hidden settings file to 61 folders, and ${NAMES}${UNDO}`)
  })

  it('one note and one folder are in the singular', () => {
    expect(idsAskMessage({ notes: 1, folders: 1, foreign: 0 })).toBe(`${START}write an ID into 1 note, add a hidden settings file to 1 folder, and ${NAMES}${UNDO}`)
  })

  it('only the parts that apply are listed: no folders, or no notes', () => {
    expect(idsAskMessage({ notes: 854, folders: 0, foreign: 0 })).toBe(`${START}write an ID into 854 notes and ${NAMES}${UNDO}`)
    expect(idsAskMessage({ notes: 0, folders: 4, foreign: 0 })).toBe(`${START}add a hidden settings file to 4 folders and ${NAMES}${UNDO}`)
  })

  it('a yes that would write nothing still says what turns on (S10)', () => {
    expect(idsAskMessage({ notes: 0, folders: 0, foreign: 0 })).toBe(`${START}${NAMES}${UNDO}`)
  })

  it('notes that hold another tool’s ID: how many the app will replace, "has" for one and "have" for more', () => {
    expect(idsAskMessage({ notes: 9, folders: 0, foreign: 1 })).toBe(`${START}write an ID into 9 notes and ${NAMES} 1 of the notes already has an ID from another tool, which the app will replace.${UNDO}`)
    expect(idsAskMessage({ notes: 9, folders: 2, foreign: 3 })).toBe(
      `${START}write an ID into 9 notes, add a hidden settings file to 2 folders, and ${NAMES} 3 of the notes already have an ID from another tool, which the app will replace.${UNDO}`,
    )
  })

  it('a window with two or more vaults: the question names the vault it acts on, and the rest reads as it does for one (S13)', () => {
    expect(idsAskMessage({ notes: 854, folders: 0, foreign: 0 }, 'Work')).toBe(`Give the notes in Work IDs?${WHAT} If you turn this on, the app will write an ID into 854 notes and ${NAMES}${UNDO}`)
  })
})

describe('the line that asks for the ID letters (YAZ-2677 D2)', () => {
  it('a vault with no letters is asked to choose them (S5)', () => {
    expect(idsLettersAsk(undefined)).toBe('Type the ID letters for this vault: 2 to 5 letters, like BUS.')
  })

  it('a vault that has letters is asked to type those letters (S9)', () => {
    expect(idsLettersAsk('YAZ')).toBe("Type this vault's ID letters, YAZ, to confirm.")
  })
})
