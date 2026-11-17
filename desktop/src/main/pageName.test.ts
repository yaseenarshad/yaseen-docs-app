import { describe, expect, it } from 'vitest'
import { kebabTitle, pageFileName } from '@shared/pageName'

describe('a title in kebab-case (YAZ-2420 D3)', () => {
  it('is the title in lowercase, its words joined by hyphens', () => {
    expect(kebabTitle('UP-001 - Abdul Sample R')).toBe('up-001-abdul-sample-r')
  })

  it('turns every run of punctuation and spaces into one hyphen, and has none at either end', () => {
    expect(kebabTitle('UP-058 - Baber J.')).toBe('up-058-baber-j')
    expect(kebabTitle('UP-266 - Sahil Shah — Applicant')).toBe('up-266-sahil-shah-applicant')
    expect(kebabTitle('  What/Why: a "plan"?  ')).toBe('what-why-a-plan')
  })

  it('treats an underscore as punctuation, but keeps the ones a title starts with', () => {
    expect(kebabTitle('09_12 - Mental Math')).toBe('09-12-mental-math')
    // A leading underscore holds a page at the top of a list sorted by name, so the name keeps it.
    expect(kebabTitle('_synthesis')).toBe('_synthesis')
    expect(kebabTitle('_PIPELINE-CONTEXT')).toBe('_pipeline-context')
    expect(kebabTitle('  _Messaging & Scheduling')).toBe('_messaging-scheduling')
    expect(kebabTitle('__draft__ pages_')).toBe('__draft-pages')
    expect(kebabTitle('_')).toBe('') // no letter or digit: still nothing to name it by
  })

  it('drops accents and keeps the letter', () => {
    expect(kebabTitle('Café Olé')).toBe('cafe-ole')
  })

  it('keeps letters and digits of any script', () => {
    expect(kebabTitle('ملاحظات 2026')).toBe('ملاحظات-2026')
    expect(kebabTitle('한글 노트')).toBe('한글-노트')
  })

  it('is at most 60 characters, cut at the end of a word', () => {
    const word = 'abcdefghij'
    expect(kebabTitle(Array(8).fill(word).join(' '))).toBe(Array(5).fill(word).join('-')) // the sixth word would end at 65
    // Exactly 60, with a word ending there: nothing more is dropped.
    expect(kebabTitle('Chapter 08 - The Tough Stuff Made Easy - Advanced Multiplication and Long Division')).toBe(
      'chapter-08-the-tough-stuff-made-easy-advanced-multiplication',
    )
    expect(kebabTitle('a'.repeat(200))).toBe('a'.repeat(60)) // one long word has no end to cut at
  })

  it('is empty for a title with no letter or digit', () => {
    expect(kebabTitle('— … —')).toBe('')
    expect(kebabTitle('')).toBe('')
  })
})

describe("a page's file name (YAZ-2420 D3)", () => {
  it('is the kebab-case title, then the id', () => {
    expect(pageFileName('UP-001 - Abdul Sample R', 'k3m9x2pq7abc')).toBe('up-001-abdul-sample-r-k3m9x2pq7abc.md')
  })

  it('keeps a leading underscore in front of the kebab-case title', () => {
    expect(pageFileName('_PIPELINE-CONTEXT', 'k3m9x2pq7abc')).toBe('_pipeline-context-k3m9x2pq7abc.md')
  })

  it('is the id alone when the title has no letter or digit', () => {
    expect(pageFileName('—', 'k3m9x2pq7abc')).toBe('k3m9x2pq7abc.md')
  })

  it('holds a number ID in lowercase (YAZ-2677 R8, S14)', () => {
    expect(pageFileName('My page', 'YAZ-12')).toBe('my-page-yaz-12.md')
    expect(pageFileName('—', 'YAZ-12')).toBe('yaz-12.md')
  })
})
