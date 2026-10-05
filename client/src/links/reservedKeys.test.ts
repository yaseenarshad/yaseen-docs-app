import { describe, expect, it } from 'vitest'
import { ALSO_IN_KEY } from '@shared/alsoIn'
import { COMMENTS_KEY } from '@shared/comments'
import { FOLDER_VALUES_KEY } from '@shared/folderValues'
import { NOTE_ID_KEY } from '@shared/noteId'
import { TITLE_KEY } from '@shared/noteName'
import { REVIEW_KEY, REVIEWS_KEY } from '@shared/reviews'
import { reservedKeys } from './reservedKeys'

/** The keys the app owns where the vault uses IDs. */
const RESERVED_KEYS = reservedKeys(true)

describe('reserved keys: the folders’ values (D19)', () => {
  it('The `in` key itself: Reserved — never a column, never a name a property is added under', () => {
    expect(RESERVED_KEYS.has(FOLDER_VALUES_KEY)).toBe(true)
    expect(RESERVED_KEYS.has('in')).toBe(true)
  })
})

describe('reserved keys: review (YAZ-2322)', () => {
  it('the review log is Reserved: the panel shows it with no editor', () => {
    expect(RESERVED_KEYS.has(REVIEWS_KEY)).toBe(true)
  })

  it('the on/off flag is an ordinary property, the user\'s to edit', () => {
    expect(RESERVED_KEYS.has(REVIEW_KEY)).toBe(false)
  })
})

describe('reserved keys: the title (YAZ-2420 D14)', () => {
  it('`title` is Reserved: edited through the page title, never added as a property or deleted as a column', () => {
    expect(TITLE_KEY).toBe('title')
    expect(RESERVED_KEYS.has(TITLE_KEY)).toBe(true)
  })
})

describe('reserved keys: a vault that does not use IDs (YAZ-2523 V12)', () => {
  it('`id`, `title`, `also_in` and `in` are ordinary properties there; the comments store and the review log are still the app\u2019s', () => {
    const plain = reservedKeys(false)
    for (const key of [NOTE_ID_KEY, TITLE_KEY, ALSO_IN_KEY, FOLDER_VALUES_KEY]) expect(plain.has(key)).toBe(false)
    expect([...plain].sort()).toEqual([COMMENTS_KEY, REVIEWS_KEY].sort())
  })

  it('a vault that uses IDs owns all six', () => {
    expect([...RESERVED_KEYS].sort()).toEqual([ALSO_IN_KEY, COMMENTS_KEY, NOTE_ID_KEY, FOLDER_VALUES_KEY, REVIEWS_KEY, TITLE_KEY].sort())
  })
})
