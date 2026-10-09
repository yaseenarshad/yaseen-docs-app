/**
 * The outline document model (YAZ-900): 🔒 D2 — one markdown bullet list, free-form. Each case
 * pins a locked rule: depth is RELATIVE indentation (tabs = 4 spaces), and a rename rewrites
 * exact-wikilink LINES only, byte-for-byte elsewhere.
 */
import { describe, expect, it } from 'vitest'
import { mapOutlineLinks } from '@shared/folderSettingsLinks'
import { escapeBlockStart, escapeOutlineMarkdown, parseOutline, serializeOutline } from './outlineDoc'

describe('parseOutline: depth is relative indentation', () => {
  it('reads four spaces, two spaces and tabs all as one level down', () => {
    expect(parseOutline('- a\n    - b\n')).toEqual([
      { depth: 0, text: 'a' },
      { depth: 1, text: 'b' },
    ])
    expect(parseOutline('- a\n  - b\n')).toEqual([
      { depth: 0, text: 'a' },
      { depth: 1, text: 'b' },
    ])
    expect(parseOutline('- a\n\t- b\n\t\t- c\n')).toEqual([
      { depth: 0, text: 'a' },
      { depth: 1, text: 'b' },
      { depth: 2, text: 'c' },
    ])
  })

  it('an over-deep indent still nests exactly ONE level, and a shallower line pops back', () => {
    expect(parseOutline('- a\n            - b\n  - c\n- d\n')).toEqual([
      { depth: 0, text: 'a' },
      { depth: 1, text: 'b' },
      { depth: 1, text: 'c' },
      { depth: 0, text: 'd' },
    ])
  })

  it('indentation on the FIRST line creates no depth, and a mid-list outdent lands on the shared level', () => {
    expect(parseOutline('    - a\n        - b\n    - c\n')).toEqual([
      { depth: 0, text: 'a' },
      { depth: 1, text: 'b' },
      { depth: 0, text: 'c' },
    ])
  })

  it('accepts -, * and + markers, and a bare marker is an empty line', () => {
    expect(parseOutline('- a\n* b\n+ c\n-\n')).toEqual([
      { depth: 0, text: 'a' },
      { depth: 0, text: 'b' },
      { depth: 0, text: 'c' },
      { depth: 0, text: '' },
    ])
  })

  it('CRLF lines read the same, and a marker with no gap after it (`-foo`) is not a bullet', () => {
    expect(parseOutline('- a\r\n    - b\r\n')).toEqual([
      { depth: 0, text: 'a' },
      { depth: 1, text: 'b' },
    ])
    expect(parseOutline('-foo\n- a  \n')).toEqual([{ depth: 0, text: 'a' }])
  })

  it('blank lines, prose lines and ordered items are not outline lines — they are skipped', () => {
    expect(parseOutline('- a\n\nloose prose\n1. numbered\n- b\n')).toEqual([
      { depth: 0, text: 'a' },
      { depth: 0, text: 'b' },
    ])
    expect(parseOutline('')).toEqual([])
  })
})

describe('serializeOutline: one canonical spelling, round-tripping byte-for-byte', () => {
  it('round-trips canonical text exactly', () => {
    const text = '- [[CAC]]\n    - [[LTV]]\n        - deeper\n- last'
    expect(serializeOutline(parseOutline(text))).toBe(text)
  })

  it('writes `- ` at four spaces per level, and a bare marker for an empty line', () => {
    expect(serializeOutline([{ depth: 0, text: 'a' }, { depth: 2, text: 'b' }, { depth: 0, text: '' }])).toBe(
      '- a\n        - b\n-',
    )
  })

  it('a tab / two-space / star-marker outline comes back canonical, structure intact', () => {
    expect(serializeOutline(parseOutline('* a\n  * b\n\t\t* c\n'))).toBe('- a\n    - b\n        - c')
  })

  it('no lines is the empty string', () => {
    expect(serializeOutline([])).toBe('')
    expect(parseOutline(serializeOutline([]))).toEqual([])
  })
})

describe('mapOutlineLinks: a rename reaches exact-wikilink LINES only', () => {
  const toC = (link: string) => (link === '[[B]]' ? '[[C]]' : undefined)

  it('rewrites the link line, keeping marker, indentation and every other line byte-for-byte', () => {
    const outline = '* [[A]]\n\t- [[B]]\n  - see [[B]] inline\n- [[B]] [[B]]\n\nprose [[B]]\n'
    expect(mapOutlineLinks(outline, toC)).toBe('* [[A]]\n\t- [[C]]\n  - see [[B]] inline\n- [[B]] [[B]]\n\nprose [[B]]\n')
  })

  it('undefined when no line changed — the page is never written', () => {
    expect(mapOutlineLinks('- [[A]]\n- prose about [[B]]\n', toC)).toBeUndefined()
    expect(mapOutlineLinks('', toC)).toBeUndefined()
  })

  it('padding inside the line survives: only the link text is spliced', () => {
    expect(mapOutlineLinks('-   [[B]]  ', toC)).toBe('-   [[C]]  ')
  })
})

describe('escapeBlockStart: text that would re-parse as a BLOCK stays literal text (YAZ-973)', () => {
  it('escapes ordered-list markers, keeping the digits', () => {
    expect(escapeBlockStart('1. Title > Promise > Intro > Temp Check')).toBe('1\\. Title > Promise > Intro > Temp Check')
    expect(escapeBlockStart('4. Level 1) Human (Good old Meat Machines)')).toBe('4\\. Level 1) Human (Good old Meat Machines)')
    expect(escapeBlockStart('12) foo')).toBe('12\\) foo')
    expect(escapeBlockStart('1.')).toBe('1\\.')
  })

  it('a number that is not a list marker is untouched', () => {
    expect(escapeBlockStart('1.5 tokens per word')).toBe('1.5 tokens per word')
    expect(escapeBlockStart('1.foo')).toBe('1.foo')
    expect(escapeBlockStart('v2) see notes')).toBe('v2) see notes')
  })

  it('escapes bullet markers, headings, quotes, fences and thematic breaks', () => {
    expect(escapeBlockStart('- foo')).toBe('\\- foo')
    expect(escapeBlockStart('* foo')).toBe('\\* foo')
    expect(escapeBlockStart('+ foo')).toBe('\\+ foo')
    expect(escapeBlockStart('-')).toBe('\\-')
    expect(escapeBlockStart('# Heading')).toBe('\\# Heading')
    expect(escapeBlockStart('###### six')).toBe('\\###### six')
    expect(escapeBlockStart('> quoted')).toBe('\\> quoted')
    expect(escapeBlockStart('```')).toBe('\\```')
    expect(escapeBlockStart('```js')).toBe('\\```js')
    expect(escapeBlockStart('~~~')).toBe('\\~~~')
    expect(escapeBlockStart('---')).toBe('\\---')
    expect(escapeBlockStart('* * *')).toBe('\\* * *')
    expect(escapeBlockStart('___')).toBe('\\___')
  })

  it('plain text, wikilinks, inline html, existing escapes and seven hashes pass through unchanged', () => {
    expect(escapeBlockStart('hello world')).toBe('hello world')
    expect(escapeBlockStart('')).toBe('')
    expect(escapeBlockStart('[[Sub Note]]')).toBe('[[Sub Note]]')
    expect(escapeBlockStart('**<u>Solving Business Problems with AI</u>**')).toBe('**<u>Solving Business Problems with AI</u>**')
    expect(escapeBlockStart('2\\) what surface do you use?')).toBe('2\\) what surface do you use?')
    expect(escapeBlockStart('\\*')).toBe('\\*')
    expect(escapeBlockStart('####### seven is not a heading')).toBe('####### seven is not a heading')
  })
})

describe('escapeOutlineMarkdown: every bullet line armored, every other byte untouched (YAZ-973)', () => {
  it('escapes the text of each bullet line, preserving marker and indentation', () => {
    expect(escapeOutlineMarkdown('- 1. a\n    - # b\n* 2) c')).toBe('- 1\\. a\n    - \\# b\n* 2\\) c')
  })

  it('non-bullet lines, blank lines and empty bullets survive byte-for-byte', () => {
    expect(escapeOutlineMarkdown('- ok\nplain prose\n\n-\n- 1. x')).toBe('- ok\nplain prose\n\n-\n- 1\\. x')
  })

  it('a document with nothing to escape comes back identical', () => {
    const doc = '- a\n    - b\n- [[Sub Note]]'
    expect(escapeOutlineMarkdown(doc)).toBe(doc)
  })
})

describe('escapeBlockStart: footnote definitions — the one GFM dropper the scan missed (YAZ-974)', () => {
  it('escapes a footnote definition, and only a definition', () => {
    expect(escapeBlockStart('[^1]: note')).toBe('\\[^1]: note')
    expect(escapeBlockStart('[^long-name]: see below')).toBe('\\[^long-name]: see below')
    // A plain link-reference-style line survives the editor as literal text already — untouched.
    expect(escapeBlockStart('[x]: /url')).toBe('[x]: /url')
  })
})
