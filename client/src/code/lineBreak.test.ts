import { describe, expect, it } from 'vitest'
import { lineBreakOf, withOneLineBreak } from './lineBreak'

describe('lineBreakOf (YAZ-3445)', () => {
  it('S1: an LF file is LF', () => {
    expect(lineBreakOf('const a = 1\nconst b = 2\n')).toBe('\n')
  })

  it('S2: a CRLF file is CRLF', () => {
    expect(lineBreakOf('{\r\n  "a": 1\r\n}\r\n')).toBe('\r\n')
  })

  it('S3: a mixed file takes the first break found', () => {
    expect(lineBreakOf('a\r\nb\nc\n')).toBe('\r\n')
    expect(lineBreakOf('a\nb\r\nc\r\n')).toBe('\n')
  })

  it('S4: a leading UTF-8 BOM does not change the answer', () => {
    expect(lineBreakOf('﻿print("a")\r\n')).toBe('\r\n')
    expect(lineBreakOf('﻿print("a")\n')).toBe('\n')
  })

  it('a file with no break, an empty file, a lone CR and a file that starts with a break', () => {
    expect(lineBreakOf('one line')).toBe('\n')
    expect(lineBreakOf('')).toBe('\n')
    expect(lineBreakOf('a\rb')).toBe('\n')
    expect(lineBreakOf('\nb')).toBe('\n')
    expect(lineBreakOf('\r\nb')).toBe('\r\n')
  })

  it('withOneLineBreak gives every line the first break found (S3), and keeps a BOM and a clean file as they are', () => {
    expect(withOneLineBreak('a\r\nb\nc\rd\n')).toBe('a\r\nb\r\nc\r\nd\r\n')
    expect(withOneLineBreak('a\nb\r\nc\n')).toBe('a\nb\nc\n')
    expect(withOneLineBreak('\ufeffa\r\nb\r\n')).toBe('\ufeffa\r\nb\r\n')
    expect(withOneLineBreak('one line')).toBe('one line')
  })
})
