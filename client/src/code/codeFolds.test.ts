/**
 * A code tab's fold keys (YAZ-3451 S1–S3): the text of a fold's first line, never its number. Pure over
 * a list of lines; `CodeEditor.test.tsx` runs the same keys through the tab and the store.
 */
import { describe, expect, it } from 'vitest'
import { MAX_KEY_TEXT, foldKeysOf, foldLinesOf, type LinesLike } from './codeFolds'

const lines = (text: string): LinesLike => {
  const all = text.split('\n')
  return { getLineCount: () => all.length, getLineContent: (n) => all[n - 1] ?? '' }
}

const FILE = ['import a from "a"', '', 'function one() {', '  return 1', '}', '', 'function two() {', '  if (x) {', '    y()', '  } else {', '    z()', '  }', '}'].join('\n')

describe('foldKeysOf', () => {
  it('S1: a fold is keyed by the trimmed text of its first line', () => {
    expect(foldKeysOf(lines(FILE), [3, 8])).toEqual(['function one() {', 'if (x) {'])
    expect(foldKeysOf(lines(FILE), [])).toEqual([])
  })

  it('the same text again gets its occurrence: the 2nd `} else {` is not the 1st', () => {
    const twice = ['if (a) {', '} else {', '}', 'if (b) {', '} else {', '}'].join('\n')
    expect(foldKeysOf(lines(twice), [5])).toEqual(['} else {\u00002'])
    expect(foldKeysOf(lines(twice), [2, 5])).toEqual(['} else {', '} else {\u00002'])
  })

  it('a minified line keeps only its first MAX_KEY_TEXT characters', () => {
    const long = `const x = {${'a'.repeat(5000)}`
    const [key] = foldKeysOf(lines(long), [1])
    expect(key).toHaveLength(MAX_KEY_TEXT)
  })
})

describe('foldLinesOf', () => {
  it('S1: the keys find their lines again', () => {
    expect(foldLinesOf(lines(FILE), ['function one() {', 'if (x) {'])).toEqual({ lines: [3, 8], missing: [] })
  })

  it('S2: another app adds lines above the fold: the key finds the function on its new line', () => {
    const moved = ['// a header', '// added by an agent', '', FILE].join('\n')
    expect(foldLinesOf(lines(moved), ['function two() {'])).toEqual({ lines: [10], missing: [] })
  })

  it('S3: another app deletes the folded function: its key is missing, the others stay, nothing throws', () => {
    const gone = FILE.replace('function one() {\n  return 1\n}\n', '')
    expect(foldLinesOf(lines(gone), ['function one() {', 'function two() {'])).toEqual({ lines: [4], missing: ['function one() {'] })
    expect(foldLinesOf(lines(''), ['function one() {'])).toEqual({ lines: [], missing: ['function one() {'] })
  })

  it('an occurrence that is no longer there is missing; a key that does not read is ignored as missing', () => {
    const once = ['if (a) {', '} else {', '}'].join('\n')
    expect(foldLinesOf(lines(once), ['} else {', '} else {\u00002'])).toEqual({ lines: [2], missing: ['} else {\u00002'] })
    expect(foldLinesOf(lines(once), ['', 'x\u0000zero'])).toEqual({ lines: [], missing: ['', 'x\u0000zero'] })
  })

  it('round trip: the keys of any folds give back the same lines', () => {
    const starts = [3, 7, 8, 10]
    expect(foldLinesOf(lines(FILE), foldKeysOf(lines(FILE), starts)).lines).toEqual(starts)
  })
})
