/** The reload's one edit (YAZ-3451, the undo decision): only the part that changed, as a Monaco range. */
import { describe, expect, it } from 'vitest'
import { diskEdit } from './reloadEdit'

/** `old` with the edit applied, the way Monaco applies a range (1-based lines and columns, LF). */
function apply(old: string, edit: NonNullable<ReturnType<typeof diskEdit>>): string {
  const rows = old.split('\n')
  const offset = (line: number, column: number) => rows.slice(0, line - 1).reduce((n, r) => n + r.length + 1, 0) + column - 1
  return old.slice(0, offset(edit.range.startLineNumber, edit.range.startColumn)) + edit.text + old.slice(offset(edit.range.endLineNumber, edit.range.endColumn))
}

describe('diskEdit', () => {
  it('the same text is no edit', () => {
    expect(diskEdit('a\nb\n', 'a\nb\n')).toBeNull()
  })

  it('lines added above: an insert at line 1, nothing replaced', () => {
    expect(diskEdit('a\nb\n', 'x\ny\na\nb\n')).toEqual({ range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }, text: 'x\ny\n' })
  })

  it('one word changed mid-file: the range is that word, the lines around it are not touched', () => {
    const edit = diskEdit('one\nconst a = 1\nthree\n', 'one\nconst a = 22\nthree\n')
    expect(edit).toEqual({ range: { startLineNumber: 2, startColumn: 11, endLineNumber: 2, endColumn: 12 }, text: '22' })
  })

  it('lines deleted: the range covers them and the text is empty', () => {
    expect(diskEdit('a\nb\nc\n', 'a\nc\n')).toEqual({ range: { startLineNumber: 2, startColumn: 1, endLineNumber: 3, endColumn: 1 }, text: '' })
  })

  it('applied, every edit gives the new text: a sweep of shapes', () => {
    const texts = ['', 'a', 'a\n', 'a\nb', 'a\nb\n', 'b\na\n', 'aa\naa\n', 'x\n\ny\n', '\n\n', 'a😀b\n', 'a😁b\n']
    for (const old of texts) for (const next of texts) {
      const edit = diskEdit(old, next)
      expect(edit === null ? old : apply(old, edit), JSON.stringify([old, next])).toBe(next)
    }
  })

  it('never cuts a surrogate pair in two', () => {
    const edit = diskEdit('a😀b', 'a😁b')!
    expect(edit.text).toBe('😁')
    expect(edit.range).toEqual({ startLineNumber: 1, startColumn: 2, endLineNumber: 1, endColumn: 4 })
  })
})
