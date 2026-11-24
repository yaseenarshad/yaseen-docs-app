import { describe, expect, it } from 'vitest'
import {
  diskPathOf,
  inlineCardRowPath,
  inlineDrawingRowPath,
  isInlineRef,
  parseInlineRef,
} from './inlineRef'
import { inlineCardPathAtLine, inlineDrawingPathAtLine, inlineRefPathAtLine } from './inlineLine'

describe('inlineRef constructors and parsers', () => {
  it('constructs canonical synthetic row paths', () => {
    expect(inlineCardRowPath('/v/Note.md', 'WIKI-123')).toBe('/v/Note.md#WIKI-123')
    expect(inlineDrawingRowPath('/v/Note.md', 0)).toBe('/v/Note.md#drawing-0')
    expect(inlineDrawingRowPath('/v/C# Notes.md', 2)).toBe('/v/C# Notes.md#drawing-2')
  })

  it('parses valid inline card and inline drawing refs', () => {
    expect(parseInlineRef('/v/Note.md#WIKI-123')).toEqual({ kind: 'card', page: '/v/Note.md', id: 'WIKI-123' })
    expect(parseInlineRef('/v/Note.md#drawing-0')).toEqual({ kind: 'drawing', page: '/v/Note.md', index: 0 })
    expect(parseInlineRef('/v/C# Notes.md#WIKI-123')).toEqual({ kind: 'card', page: '/v/C# Notes.md', id: 'WIKI-123' })
    expect(parseInlineRef('/v/C# Notes.md#drawing-2')).toEqual({ kind: 'drawing', page: '/v/C# Notes.md', index: 2 })
    expect(parseInlineRef('/v/Note.MD#WIKI-42')).toEqual({ kind: 'card', page: '/v/Note.MD', id: 'WIKI-42' })
    expect(parseInlineRef('/v/Note.markdown#drawing-12')).toEqual({ kind: 'drawing', page: '/v/Note.markdown', index: 12 })
    expect(parseInlineRef('C:\\vault\\C# Notes.md#WIKI-7')).toEqual({ kind: 'card', page: 'C:\\vault\\C# Notes.md', id: 'WIKI-7' })
    expect(parseInlineRef('C:\\vault\\Note.md#drawing-1')).toEqual({ kind: 'drawing', page: 'C:\\vault\\Note.md', index: 1 })
  })

  it('never misparses normal filenames containing # or non-markdown paths or empty suffixes', () => {
    expect(parseInlineRef('C# Notes.md')).toBeNull()
    expect(parseInlineRef('/v/C# Notes.md')).toBeNull()
    expect(parseInlineRef('foo#bar.md')).toBeNull()
    expect(parseInlineRef('/v/a.excalidraw')).toBeNull()
    expect(parseInlineRef('/v/a.excalidraw#drawing-0')).toBeNull()
    expect(parseInlineRef('/v/Note.md#')).toBeNull()
    expect(parseInlineRef('#WIKI-123')).toBeNull()
    expect(parseInlineRef('/.md#WIKI-123')).toBeNull()
    expect(parseInlineRef('/v/Note.md')).toBeNull()
    expect(parseInlineRef('')).toBeNull()
  })

  it('round-trips constructors through parseInlineRef, isInlineRef, and diskPathOf', () => {
    const cardPath = inlineCardRowPath('/v/C# Notes.md', 'GEO-14')
    const drawingPath = inlineDrawingRowPath('/v/C# Notes.md', 3)
    expect(parseInlineRef(cardPath)).toEqual({ kind: 'card', page: '/v/C# Notes.md', id: 'GEO-14' })
    expect(parseInlineRef(drawingPath)).toEqual({ kind: 'drawing', page: '/v/C# Notes.md', index: 3 })
    expect(isInlineRef(cardPath)).toBe(true)
    expect(isInlineRef(drawingPath)).toBe(true)
    expect(isInlineRef('/v/C# Notes.md')).toBe(false)
    expect(diskPathOf(cardPath)).toBe('/v/C# Notes.md')
    expect(diskPathOf(drawingPath)).toBe('/v/C# Notes.md')
    expect(diskPathOf('/v/C# Notes.md')).toBe('/v/C# Notes.md')
    expect(diskPathOf('/v/a.excalidraw')).toBe('/v/a.excalidraw')
  })
})

describe('inlineDrawingPathAtLine', () => {
  it('resolves 1-based opening fence line with and without frontmatter', () => {
    const noFm = '# Heading\n\n```excalidraw\n{"elements":[]}\n```\n'
    expect(inlineDrawingPathAtLine('/v/Note.md', noFm, 0)).toBe('/v/Note.md:3')
    expect(inlineDrawingPathAtLine('/v/Note.md', noFm, 1)).toBe('/v/Note.md')

    const withFm = [
      '---',
      'title: Demo',
      'tags: [a]',
      '---',
      '',
      'Intro',
      '',
      '```excalidraw',
      '{"elements":[]}',
      '```',
      '<!-- drawing: title "First", locked -->',
      '',
      '```excalidraw',
      '{"elements":[]}',
      '```',
    ].join('\n')
    expect(inlineDrawingPathAtLine('/v/Note.md', withFm, 0)).toBe('/v/Note.md:8')
    expect(inlineDrawingPathAtLine('/v/Note.md', withFm, 1)).toBe('/v/Note.md:13')
    expect(inlineDrawingPathAtLine('/v/Note.md', withFm, 2)).toBe('/v/Note.md')
  })

  it('handles CRLF line endings and skips nested fences', () => {
    const crlf = [
      '---',
      'title: Win',
      '---',
      '````markdown',
      '```excalidraw',
      '{}',
      '```',
      '````',
      '```excalidraw',
      '{"elements":[]}',
      '```',
    ].join('\r\n')
    expect(inlineDrawingPathAtLine('/v/Win.md', crlf, 0)).toBe('/v/Win.md:9')
  })
})

describe('inlineCardPathAtLine', () => {
  const doc = [
    '---',
    'title: Study',
    '---',
    '',
    'Intro text',
    '',
    '```card',
    'Front 1',
    '---',
    'Back 1',
    '```',
    '<!-- card: WIKI-1, title "First" -->',
    '',
    '```card',
    'Front 2',
    '```',
    '<!-- card: WIKI-2 -->',
  ].join('\n')

  it('resolves 1-based opening fence line by card ID with frontmatter offset', () => {
    expect(inlineCardPathAtLine('/v/Study.md', doc, 'WIKI-1')).toBe('/v/Study.md:7')
    expect(inlineCardPathAtLine('/v/Study.md', doc, 'WIKI-2')).toBe('/v/Study.md:14')
    expect(inlineCardPathAtLine('/v/Study.md', doc, 'MISSING')).toBe('/v/Study.md')
  })

  it('resolves without frontmatter and with empty frontmatter', () => {
    const noFm = 'Line 1\n```card\nQ\n```\n<!-- card: AB-1 -->\n'
    expect(inlineCardPathAtLine('/v/NoFm.md', noFm, 'AB-1')).toBe('/v/NoFm.md:2')

    const emptyFm = '---\n---\n```card\nQ\n```\n<!-- card: AB-2 -->\n'
    expect(inlineCardPathAtLine('/v/EmptyFm.md', emptyFm, 'AB-2')).toBe('/v/EmptyFm.md:3')
  })

  it('falls back to fallbackIndex when cardId is not found, and disambiguates duplicate IDs', () => {
    expect(inlineCardPathAtLine('/v/Study.md', doc, 'MISSING', 1)).toBe('/v/Study.md:14')
    expect(inlineCardPathAtLine('/v/Study.md', doc, 'MISSING', 9)).toBe('/v/Study.md')

    const dup = [
      '```card',
      'Copy A',
      '```',
      '<!-- card: WIKI-1 -->',
      '',
      '```card',
      'Copy B',
      '```',
      '<!-- card: WIKI-1 -->',
    ].join('\n')
    expect(inlineCardPathAtLine('/v/Dup.md', dup, 'WIKI-1', 1)).toBe('/v/Dup.md:6')
    expect(inlineCardPathAtLine('/v/Dup.md', dup, 'WIKI-1', 0)).toBe('/v/Dup.md:1')
  })

  it('handles CRLF and skips card fences inside outer code blocks', () => {
    const nested = [
      '---',
      'id: P-1',
      '---',
      '````markdown',
      '```card',
      'Not a card',
      '```',
      '<!-- card: WIKI-9 -->',
      '````',
      '```card',
      'Real card',
      '```',
      '<!-- card: WIKI-9 -->',
    ].join('\r\n')
    expect(inlineCardPathAtLine('/v/Nested.md', nested, 'WIKI-9')).toBe('/v/Nested.md:10')
  })
})

describe('inlineRefPathAtLine', () => {
  it('dispatches both card and drawing refs', () => {
    const content = [
      '---',
      'title: Mixed',
      '---',
      '```card',
      'Q',
      '```',
      '<!-- card: WIKI-5 -->',
      '```excalidraw',
      '{"elements":[]}',
      '```',
    ].join('\n')
    expect(inlineRefPathAtLine({ kind: 'card', page: '/v/Mixed.md', id: 'WIKI-5' }, content)).toBe('/v/Mixed.md:4')
    expect(inlineRefPathAtLine({ kind: 'card', page: '/v/Mixed.md', id: 'UNKNOWN' }, content, 0)).toBe('/v/Mixed.md:4')
    expect(inlineRefPathAtLine({ kind: 'drawing', page: '/v/Mixed.md', index: 0 }, content)).toBe('/v/Mixed.md:8')
    expect(inlineRefPathAtLine({ kind: 'drawing', page: '/v/Mixed.md', index: 1 }, content)).toBe('/v/Mixed.md')
  })
})
