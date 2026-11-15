import { describe, expect, it } from 'vitest'
import { absFrom, basename, relTo, stripExt } from './paths'

describe('relTo / absFrom: the root itself (YAZ-4921)', () => {
  it("relTo names a folder under the root as the index does, and the root itself as ''; a path elsewhere is itself", () => {
    expect(relTo('/v', '/v/Projects/Alpha')).toBe('Projects/Alpha')
    expect(relTo('/v/', '/v/Projects')).toBe('Projects')
    expect(relTo('/v', '/v')).toBe('')
    expect(relTo('/v/', '/v')).toBe('')
    expect(relTo('/v', '/w/a.md')).toBe('/w/a.md')
  })

  it("absFrom gives '' the root with no trailing slash, and a folder its path under it", () => {
    expect(absFrom('/v', 'Projects')).toBe('/v/Projects')
    expect(absFrom('/v/', 'Projects')).toBe('/v/Projects')
    expect(absFrom('/v', '')).toBe('/v')
    expect(absFrom('/v/', '')).toBe('/v')
  })
})

describe('basename', () => {
  it('returns the last segment, ignoring trailing slashes', () => {
    expect(basename('/a/b/c.md')).toBe('c.md')
    expect(basename('/a/b/')).toBe('b')
    expect(basename('/')).toBe('/')
  })
})

describe('stripExt', () => {
  it('strips markdown extensions, case-insensitive', () => {
    expect(stripExt('note.md')).toBe('note')
    expect(stripExt('note.MARKDOWN')).toBe('note')
  })

  it('leaves other names alone', () => {
    expect(stripExt('notes.txt')).toBe('notes.txt')
    expect(stripExt('Tasks.base')).toBe('Tasks.base') // not a vault extension since YAZ-844
    expect(stripExt('database')).toBe('database')
  })
})
