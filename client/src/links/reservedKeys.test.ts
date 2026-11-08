import { describe, expect, it } from 'vitest'
import { ALSO_IN_KEY } from '@shared/alsoIn'
import { COMMENTS_KEY } from '@shared/comments'
import { SHOW_OTHER_FILES_KEY, SHOW_PAGE_FILE_KEY } from '@shared/folderPage'
import { FOLDER_VALUES_KEY } from '@shared/folderValues'
import { NOTE_ID_KEY } from '@shared/noteId'
import { TITLE_KEY } from '@shared/noteName'
import { OUTSIDE_GLOW_KEY, PAGE_SWITCH_KEYS } from '@shared/pageSwitches'
import { READ_ONLY_KEY } from '@shared/readOnly'
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

describe('reserved keys: the read-only switch (YAZ-3076 D1, S16)', () => {
  it('`readonly` is Reserved in every vault: the panel shows it with no editor, and it is never a column to delete', () => {
    expect(READ_ONLY_KEY).toBe('readonly')
    expect(reservedKeys(true).has(READ_ONLY_KEY)).toBe(true)
    expect(reservedKeys(false).has(READ_ONLY_KEY)).toBe(true)
  })
})

describe('reserved keys: a vault that does not use IDs (YAZ-2523 V12)', () => {
  it('`id`, `title`, `also_in` and `in` are ordinary properties there; the comments store, the review log, the read-only switch and the page switches are still the app\u2019s', () => {
    const plain = reservedKeys(false)
    for (const key of [NOTE_ID_KEY, TITLE_KEY, ALSO_IN_KEY, FOLDER_VALUES_KEY]) expect(plain.has(key)).toBe(false)
    expect([...plain].sort()).toEqual([COMMENTS_KEY, REVIEWS_KEY, READ_ONLY_KEY, ...PAGE_SWITCH_KEYS, OUTSIDE_GLOW_KEY, SHOW_PAGE_FILE_KEY, SHOW_OTHER_FILES_KEY].sort())
  })

  // `show_page_file` added by YAZ-3746 D37, `show_other_files` by YAZ-4597: the folder page cog sets them.
  it('a vault that uses IDs owns all fifteen', () => {
    expect([...RESERVED_KEYS].sort()).toEqual([ALSO_IN_KEY, COMMENTS_KEY, NOTE_ID_KEY, FOLDER_VALUES_KEY, REVIEWS_KEY, TITLE_KEY, READ_ONLY_KEY, ...PAGE_SWITCH_KEYS, OUTSIDE_GLOW_KEY, SHOW_PAGE_FILE_KEY, SHOW_OTHER_FILES_KEY].sort())
  })
})

describe('reserved keys: the folder page file switch (YAZ-3746 D37)', () => {
  it('`show_page_file` is Reserved in every vault: the folder page cog sets it', () => {
    expect(SHOW_PAGE_FILE_KEY).toBe('show_page_file')
    expect(reservedKeys(true).has(SHOW_PAGE_FILE_KEY)).toBe(true)
    expect(reservedKeys(false).has(SHOW_PAGE_FILE_KEY)).toBe(true)
  })

  it('`show_other_files` (YAZ-4597) is Reserved in every vault: the folder page cog sets it', () => {
    expect(SHOW_OTHER_FILES_KEY).toBe('show_other_files')
    expect(reservedKeys(true).has(SHOW_OTHER_FILES_KEY)).toBe(true)
    expect(reservedKeys(false).has(SHOW_OTHER_FILES_KEY)).toBe(true)
  })
})
