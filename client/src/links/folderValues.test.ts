/**
 * A folder's values for a note (D19, `shared/folderValues.ts`): `in`, one block per folder id.
 * The reader tolerates anything written there; the writers change ONE folder's block, prune what
 * they empty and refuse to write over a value that is not theirs.
 */
import { describe, expect, it } from 'vitest'
import { FOLDER_VALUES_KEY, folderBlocks, folderValues, moveFolderValues, setFolderValue, withFolderValues, withoutStaleFolderValues } from '@shared/folderValues'
import { FrontmatterWriteError } from '@shared/frontmatter'

const HIRING = '3y7505rsr6fd'
const TASKS = 'mzf9cjhn02vm'

const NOTE = `---
# who this is
id: k3m9x2pq7abc
aliases: [Noor]
in:
  ${HIRING}:
    Status: Interview
    AI Fit Score: 8
  ${TASKS}:
    Status: 2-Todo
---
Body line
`

describe('folderValues: one folder’s block of a note', () => {
  const properties = { id: 'k3m9x2pq7abc', Status: 'top', in: { [HIRING]: { Status: 'Interview', 'AI Fit Score': 8 }, [TASKS]: { Status: '2-Todo' } } }

  it('the key is `in`', () => {
    expect(FOLDER_VALUES_KEY).toBe('in')
  })

  it('is that folder’s block and nothing else: no other folder’s values, no top-level field', () => {
    expect(folderValues(properties, HIRING)).toEqual({ Status: 'Interview', 'AI Fit Score': 8 })
    expect(folderValues(properties, TASKS)).toEqual({ Status: '2-Todo' })
  })

  it('a folder the note holds nothing for, and a folder with no id, read as empty', () => {
    expect(folderValues(properties, 'a1b2c3d4e5f6')).toEqual({})
    expect(folderValues(properties, undefined)).toEqual({})
    expect(folderValues({ Status: 'top' }, HIRING)).toEqual({})
  })

  it.each([['a scalar', 'hello'], ['a list', [HIRING]], ['null', null], ['a number', 4]])('an `in` that is %s reads as empty', (_what, value) => {
    expect(folderValues({ in: value }, HIRING)).toEqual({})
  })

  it.each([['a scalar', 'Interview'], ['a list', ['Interview']], ['null', null]])('a block that is %s reads as empty', (_what, block) => {
    expect(folderValues({ in: { [HIRING]: block } }, HIRING)).toEqual({})
  })
})

describe('folderBlocks: every folder’s block of a note, by folder id', () => {
  it('each block that is a map, in the order written; an `in` or a block that is no map is none', () => {
    expect(folderBlocks({ Status: 'top', in: { [HIRING]: { Status: 'Interview' }, [TASKS]: 4, a1b2c3d4e5f6: { Owner: '[[Sam]]' } } })).toEqual([
      [HIRING, { Status: 'Interview' }],
      ['a1b2c3d4e5f6', { Owner: '[[Sam]]' }],
    ])
    expect(folderBlocks({ Status: 'top' })).toEqual([])
    expect(folderBlocks({ in: 'the office' })).toEqual([])
  })
})

describe('setFolderValue: ONE field of ONE folder’s block, in a whole file’s content', () => {
  it('a note with no frontmatter grows `in` with the folder’s block', () => {
    expect(setFolderValue('Body\n', HIRING, 'Status', 'Interview')).toBe(`---\nin:\n  ${HIRING}:\n    Status: Interview\n---\nBody\n`)
  })

  it('a first value for a folder lands in a new block beside the others; every other byte stays', () => {
    const next = setFolderValue(NOTE, 'a1b2c3d4e5f6', 'Owner', '[[Sam]]')
    expect(next).toBe(NOTE.replace(`    Status: 2-Todo\n`, `    Status: 2-Todo\n  a1b2c3d4e5f6:\n    Owner: "[[Sam]]"\n`))
  })

  it('changes that folder’s value only: no other folder’s block and no top-level field moves', () => {
    expect(setFolderValue(NOTE, TASKS, 'Status', '4-Done')).toBe(NOTE.replace('Status: 2-Todo', 'Status: 4-Done'))
    expect(setFolderValue(NOTE, HIRING, 'Status', 'Offer')).toBe(NOTE.replace('Status: Interview', 'Status: Offer'))
  })

  // Written by hand, by an agent or by the one-time conversion: not the layout the app would choose.
  const STYLED = `---\nid: "k3m9x2pq7abc"\nin:\n  ${HIRING}:\n    Status: "Interview"\n    reviewed_on: '2026-09-07' # by Sam\n    Notes: "a: b"\n  ${TASKS}:\n    Status: "2-Todo"\n    tags: [a, "b"]\n---\nBody\n`

  it('touches only its own line: every other field of every block keeps its quoting, comments and layout', () => {
    expect(setFolderValue(STYLED, HIRING, 'Status', 'Offer')).toBe(STYLED.replace('Status: "Interview"', 'Status: "Offer"'))
    expect(setFolderValue(STYLED, TASKS, 'Due', 3)).toBe(STYLED.replace('    tags: [a, "b"]\n', '    tags: [a, "b"]\n    Due: 3\n'))
    expect(setFolderValue(STYLED, HIRING, 'Notes', undefined)).toBe(STYLED.replace('    Notes: "a: b"\n', ''))
    // A whole block, and then `in`, go the same way: nothing else is laid out again.
    const one = setFolderValue(setFolderValue(STYLED, TASKS, 'Status', undefined), TASKS, 'tags', undefined)
    expect(one).toBe(STYLED.replace(`  ${TASKS}:\n    Status: "2-Todo"\n    tags: [a, "b"]\n`, ''))
  })

  it('an `in`, or a block, written with no value takes the first one', () => {
    expect(setFolderValue('---\nin:\n---\n', HIRING, 'Status', 'Offer')).toBe(`---\nin:\n  ${HIRING}:\n    Status: Offer\n---\n`)
    expect(setFolderValue(`---\nin:\n  ${HIRING}:\n---\n`, HIRING, 'Status', 'Offer')).toBe(`---\nin:\n  ${HIRING}:\n    Status: Offer\n---\n`)
  })

  it('a top-level field of the same name is the note’s own and is left alone', () => {
    const own = `---\nStatus: mine\n---\n`
    expect(setFolderValue(own, HIRING, 'Status', 'Interview')).toBe(`---\nStatus: mine\nin:\n  ${HIRING}:\n    Status: Interview\n---\n`)
  })

  it('holds a list, a number, a boolean and an empty value as written', () => {
    let next = setFolderValue('', HIRING, 'tags', ['a', 'b'])
    next = setFolderValue(next, HIRING, 'score', 8)
    next = setFolderValue(next, HIRING, 'done', false)
    next = setFolderValue(next, HIRING, 'note', '')
    expect(next).toBe(`---\nin:\n  ${HIRING}:\n    tags:\n      - a\n      - b\n    score: 8\n    done: false\n    note: ""\n---\n`)
  })

  it('clearing a field removes it from that folder’s block only', () => {
    expect(setFolderValue(NOTE, HIRING, 'AI Fit Score', undefined)).toBe(NOTE.replace('    AI Fit Score: 8\n', ''))
  })

  it('a folder’s block becomes empty: the block is removed; when `in:` is empty the key is removed', () => {
    const oneBlock = setFolderValue(NOTE, TASKS, 'Status', undefined)
    expect(oneBlock).toBe(NOTE.replace(`  ${TASKS}:\n    Status: 2-Todo\n`, ''))
    const none = setFolderValue(setFolderValue(oneBlock, HIRING, 'Status', undefined), HIRING, 'AI Fit Score', undefined)
    expect(none).toBe('---\n# who this is\nid: k3m9x2pq7abc\naliases: [Noor]\n---\nBody line\n')
  })

  it('clearing a field the folder holds no value for is the same string: nothing to write', () => {
    expect(setFolderValue(NOTE, HIRING, 'Owner', undefined)).toBe(NOTE)
    expect(setFolderValue(NOTE, 'a1b2c3d4e5f6', 'Status', undefined)).toBe(NOTE)
    expect(setFolderValue('Body\n', HIRING, 'Status', undefined)).toBe('Body\n')
  })

  it('never writes over an `in`, or a block, that is not a map: someone else’s value is refused', () => {
    expect(() => setFolderValue('---\nin: the office\n---\n', HIRING, 'Status', 'x')).toThrow(FrontmatterWriteError)
    expect(() => setFolderValue(`---\nin:\n  ${HIRING}: 4\n---\n`, HIRING, 'Status', 'x')).toThrow(FrontmatterWriteError)
  })

  it('frontmatter that is not valid YAML is refused, never rewritten', () => {
    expect(() => setFolderValue('---\nStatus: [unclosed\n---\n', HIRING, 'Status', 'x')).toThrow(FrontmatterWriteError)
    expect(() => setFolderValue('---\nStatus: [unclosed\n---\n', HIRING, 'Status', undefined)).toThrow('frontmatter is not valid YAML')
  })
})

describe('withFolderValues: the same change over parsed properties (a new note’s seed)', () => {
  it('sets the values in that folder’s block, beside what the block and the note already hold', () => {
    const template = { owner: 'me', in: { [HIRING]: { Status: 'Applied', Stage: 1 }, [TASKS]: { Status: '1-Backlog' } } }
    expect(withFolderValues(template, HIRING, { Status: 'Interview', Score: 8 })).toEqual({
      owner: 'me',
      in: { [HIRING]: { Status: 'Interview', Stage: 1, Score: 8 }, [TASKS]: { Status: '1-Backlog' } },
    })
    expect(template.in[HIRING]).toEqual({ Status: 'Applied', Stage: 1 }) // the input is not touched
  })

  it('no values is no `in`: properties with none stay without the key', () => {
    expect(withFolderValues({ owner: 'me' }, HIRING, {})).toEqual({ owner: 'me' })
  })
})

describe('moveFolderValues: a copied folder’s block of a note, named by the copy’s id', () => {
  const COPY = 'c0py00000001'

  it('the block is the same block under the new id, where it stood; every other byte stays', () => {
    expect(moveFolderValues(NOTE, HIRING, COPY)).toBe(NOTE.replace(`  ${HIRING}:`, `  ${COPY}:`))
  })

  it('a note with no block for the old id is the same string: nothing to write', () => {
    expect(moveFolderValues(NOTE, 'a1b2c3d4e5f6', COPY)).toBe(NOTE)
    expect(moveFolderValues('Body\n', HIRING, COPY)).toBe('Body\n')
  })

  it('a note that already has a block for the new id is left as it is: never overwritten', () => {
    expect(moveFolderValues(NOTE, HIRING, TASKS)).toBe(NOTE)
  })

  it('frontmatter that is not valid YAML is the same string: nothing to write', () => {
    const broken = `---\nStatus: [unclosed\nin:\n  ${HIRING}:\n    Status: x\n---\n`
    expect(moveFolderValues(broken, HIRING, COPY)).toBe(broken)
  })

  it('run again, it is the same string', () => {
    const moved = moveFolderValues(NOTE, HIRING, COPY)
    expect(moveFolderValues(moved, HIRING, COPY)).toBe(moved)
  })
})

describe('withoutStaleFolderValues: a folder’s values leave the note when the note leaves the folder (D20)', () => {
  const GONE = 'a1b2c3d4e5f6'
  const properties = { Status: 'top', in: { [HIRING]: { Status: 'Interview' }, [TASKS]: { Status: '2-Todo' }, [GONE]: { Status: 'old' } } }
  const ids = (...list: string[]): ReadonlySet<string> => new Set(list)

  it('a block is removed only if its folder is known AND is not among the folders showing the note', () => {
    expect(withoutStaleFolderValues(properties, ids(HIRING), ids(HIRING, TASKS))).toEqual({ Status: 'top', in: { [HIRING]: { Status: 'Interview' }, [GONE]: { Status: 'old' } } })
  })

  it('a folder that still shows the note keeps its block', () => {
    expect(withoutStaleFolderValues(properties, ids(HIRING, TASKS), ids(HIRING, TASKS, GONE)).in).toEqual({ [HIRING]: { Status: 'Interview' }, [TASKS]: { Status: '2-Todo' } })
  })

  it('a block for a folder the app cannot find is kept, always', () => {
    expect(withoutStaleFolderValues(properties, ids(), ids())).toBe(properties)
    expect(withoutStaleFolderValues(properties, ids(), ids(HIRING, TASKS)).in).toEqual({ [GONE]: { Status: 'old' } })
  })

  it('nothing stale is the same object: nothing to write', () => {
    expect(withoutStaleFolderValues(properties, ids(HIRING, TASKS), ids(HIRING, TASKS))).toBe(properties)
    const none = { Status: 'top' }
    expect(withoutStaleFolderValues(none, ids(), ids(HIRING))).toBe(none)
    const foreign = { in: 'the office' }
    expect(withoutStaleFolderValues(foreign, ids(), ids(HIRING))).toBe(foreign)
  })

  it('`in` goes with its last block; the note’s own fields stay', () => {
    expect(withoutStaleFolderValues({ Status: 'top', in: { [HIRING]: { Status: 'Interview' } } }, ids(), ids(HIRING))).toEqual({ Status: 'top' })
  })
})
