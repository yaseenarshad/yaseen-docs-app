import { describe, expect, it } from 'vitest'
import { splitLink } from '@shared/linkParts'

const OLD = 'k3m9x2pq7abc'

describe('splitLink: the page on either side of the | (YAZ-4935)', () => {
  it('page first, the standard: the left side is the page, the right side the words', () => {
    expect(splitLink('WIKI-116|staging')).toEqual({ page: 'WIKI-116', hash: '', head: 'WIKI-116', words: 'staging', pipe: 8, pageFirst: true })
  })

  it("words first, Mochi's order: the one side that is an ID is the page", () => {
    expect(splitLink('staging|WIKI-116')).toEqual({ page: 'WIKI-116', hash: '', head: 'WIKI-116', words: 'staging', pipe: 7, pageFirst: false })
  })

  it('a #heading goes with the page side, in both orders', () => {
    expect(splitLink('WIKI-116#Intro|staging')).toMatchObject({ page: 'WIKI-116', hash: '#Intro', head: 'WIKI-116#Intro', words: 'staging', pageFirst: true })
    expect(splitLink('staging|WIKI-116#Intro')).toMatchObject({ page: 'WIKI-116', hash: '#Intro', head: 'WIKI-116#Intro', words: 'staging', pageFirst: false })
    expect(splitLink('staging|WIKI-116#^block')).toMatchObject({ page: 'WIKI-116', hash: '#^block', pageFirst: false })
  })

  it('two plain words: the left side is the page, as today', () => {
    expect(splitLink('Postgres|database')).toMatchObject({ page: 'Postgres', words: 'database', pageFirst: true })
    expect(splitLink('a#h|alias')).toMatchObject({ page: 'a', hash: '#h', words: 'alias', pageFirst: true })
  })

  it('two IDs: the left side is the page', () => {
    expect(splitLink('WIKI-116|WIKI-117')).toMatchObject({ page: 'WIKI-116', words: 'WIKI-117', pageFirst: true })
    expect(splitLink(`${OLD}|WIKI-117`)).toMatchObject({ page: OLD, words: 'WIKI-117', pageFirst: true })
  })

  it('an old 12-character ID is an ID on either side', () => {
    expect(splitLink(`${OLD}|the plan`)).toMatchObject({ page: OLD, words: 'the plan', pageFirst: true })
    expect(splitLink(`the plan|${OLD}`)).toMatchObject({ page: OLD, words: 'the plan', pageFirst: false })
  })

  it('an empty side: the page is the ID, with no words', () => {
    expect(splitLink('|WIKI-116')).toEqual({ page: 'WIKI-116', hash: '', head: 'WIKI-116', words: '', pipe: 0, pageFirst: false })
    expect(splitLink('WIKI-116|')).toEqual({ page: 'WIKI-116', hash: '', head: 'WIKI-116', words: '', pipe: 8, pageFirst: true })
    expect(splitLink('|')).toMatchObject({ page: '', words: '', pageFirst: true })
  })

  it('spaces around a side do not hide an ID; the page is trimmed, the head and the words are as written', () => {
    expect(splitLink(' staging | WIKI-116 ')).toEqual({ page: 'WIKI-116', hash: '', head: ' WIKI-116 ', words: ' staging ', pipe: 9, pageFirst: false })
    expect(splitLink(' B |Bee')).toMatchObject({ page: 'B', head: ' B ', words: 'Bee', pageFirst: true })
  })

  it('an ID is read in any case (R1), and other LETTERS-NUMBER text is one by shape alone', () => {
    expect(splitLink('staging|wiki-116')).toMatchObject({ page: 'wiki-116', pageFirst: false })
    expect(splitLink('the model|GPT-4')).toMatchObject({ page: 'GPT-4', pageFirst: false })
  })

  it('no |: the page and its #heading, the words null', () => {
    expect(splitLink('WIKI-116')).toEqual({ page: 'WIKI-116', hash: '', head: 'WIKI-116', words: null, pipe: -1, pageFirst: true })
    expect(splitLink('Note#Heading')).toEqual({ page: 'Note', hash: '#Heading', head: 'Note#Heading', words: null, pipe: -1, pageFirst: true })
    expect(splitLink('#same-file')).toMatchObject({ page: '', hash: '#same-file', words: null })
    expect(splitLink(' D ')).toMatchObject({ page: 'D', head: ' D ' })
  })

  it("an embed's options after the | are no ID: the target stays the left side (YAZ-4920)", () => {
    expect(splitLink('EMB-40|640x360 view=120,-40,0.8 locked')).toMatchObject({ page: 'EMB-40', words: '640x360 view=120,-40,0.8 locked', pageFirst: true })
    expect(splitLink('x.drawio|My name|640x360')).toMatchObject({ page: 'x.drawio', words: 'My name|640x360', pageFirst: true })
  })

  it('with the notes known: the left side wins when it names a found page; the right side is the page only when the left does not resolve (YAZ-4935 round 2)', () => {
    const found = (page: string) => page === 'Covid notes'
    // Words that only LOOK like an ID: the left side is a note, so it is the page.
    expect(splitLink('Covid notes|COVID-19', found)).toMatchObject({ page: 'Covid notes', head: 'Covid notes', words: 'COVID-19', pageFirst: true })
    // The left side names no note: the right side is the ID, as before.
    expect(splitLink('staging|WIKI-116', found)).toMatchObject({ page: 'WIKI-116', words: 'staging', pageFirst: false })
    // Page first stays page first; an empty left side is no page.
    expect(splitLink('WIKI-116|staging', found)).toMatchObject({ page: 'WIKI-116', words: 'staging', pageFirst: true })
    expect(splitLink('|WIKI-116', () => true)).toMatchObject({ page: 'WIKI-116', pageFirst: false })
    // The heading goes with the left side when it wins; the check is asked only when the shape alone would pick the right.
    expect(splitLink('Covid notes#Intro|COVID-19', found)).toMatchObject({ page: 'Covid notes', hash: '#Intro', pageFirst: true })
    const asked: string[] = []
    splitLink('Postgres|database', (p) => (asked.push(p), false))
    splitLink('WIKI-116|staging', (p) => (asked.push(p), false))
    expect(asked).toEqual([])
  })

  it('a second | belongs to the words: only the first one splits', () => {
    expect(splitLink('A|B|C')).toMatchObject({ page: 'A', words: 'B|C', pageFirst: true })
  })
})
