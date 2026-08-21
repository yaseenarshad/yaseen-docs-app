import { describe, expect, it } from 'vitest'
import { basename, stripExt } from './paths'

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

  it('strips .base, case-insensitive (GRO-2126)', () => {
    expect(stripExt('Tasks.base')).toBe('Tasks')
    expect(stripExt('Tasks.BASE')).toBe('Tasks')
  })

  it('leaves other names alone', () => {
    expect(stripExt('notes.txt')).toBe('notes.txt')
    expect(stripExt('database')).toBe('database')
  })
})
