// The convert actions (YAZ-5037 phase 5): each one moves a card block and its card line byte for byte, so the ID, the
// reviews and every link stay; and the ID sweep makes no copy of a card that moved.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { canBeCardFile, cardFileAsPage, cardFromText, embedLine, moveCardOut, moveTextIntoCard, pageAsCardFile, putCardBack, splitCardFile } from '@shared/cardConvert'
import { cardFileShape, isCardFileContent } from '@shared/cardFileFormat'
import { CardNotFoundError, cardRecords } from '@shared/cardLine'
import { parseFrontmatter, splitFrontmatter } from '@shared/frontmatter'
import { IDS_FILE } from '@shared/noteId'
import type { IndexRecord } from '@shared/types'
import { makeFirstMac, removeVault, sleep } from './fs/testFixture'
import { subscribe } from './fs/watchers'
import { writeConfig } from './vaultConfig'
import { _swept, sweepIds } from './vaultIndex/idSweep'
import { _evictAll, getIndex, indexWrote } from './vaultIndex'
import { scanFile } from './vaultIndex/scan'

const LINE = '<!-- card: GEO-140, 2026-11-01T09:00Z good 12s, 2026-11-05T09:00Z again -->'
const BLOCK = ['```card', 'What is the capital of **France**?', '---', 'The capital is {{Paris}}.', '```', LINE].join('\n')
const indented = (block: string, indent: string) => block.split('\n').map((l) => indent + l).join('\n')
/** The block as a card file holds it (YAZ-5044): its first line is the file's `title`, the card holds its sides only. */
const FILE_BLOCK = ['```card', '---', 'The capital is {{Paris}}.', '```', LINE].join('\n')
const TITLE = 'What is the capital of France?'
const titledFile = (title: string, block: string, props = '') => `---\nkind: card\n${props}title: ${title}\n---\n${block}\n`
const props = (content: string) => parseFrontmatter(splitFrontmatter(content).frontmatter).properties

describe('Move to its own file', () => {
  it('the card file takes the card`s first line as its `title` (YAZ-5044), and the rest of the block byte for byte; the page holds `![[GEO-140]]` at its place; the rest of the page stays', () => {
    const page = `---\nid: GEO-1\n---\n# Europe\n\nAbove.\n\n${BLOCK}\n\nBelow.\n`
    const { page: next, card } = moveCardOut(page, 'GEO-140')
    expect(card).toEqual({ content: titledFile(TITLE, FILE_BLOCK), name: 'what-is-the-capital-of-france-geo-140.md', id: 'GEO-140', title: TITLE })
    expect(next).toBe('---\nid: GEO-1\n---\n# Europe\n\nAbove.\n\n![[GEO-140]]\n\nBelow.\n')
  })

  it('an indented card (in a list) leaves without its indent, and its embed keeps the indent', () => {
    const page = `- Capitals\n${indented(BLOCK, '  ')}\n- Next\n`
    const { page: next, card } = moveCardOut(page, 'GEO-140')
    expect(card.content).toBe(titledFile(TITLE, FILE_BLOCK))
    expect(next).toBe('- Capitals\n  ![[GEO-140]]\n- Next\n')
  })

  it('two cards with one ID: the one at `index` moves; an ID no card holds throws, and a card with no ID cannot move', () => {
    const page = `${BLOCK}\n\n${BLOCK.replace('France', 'Spain')}\n`
    expect(moveCardOut(page, 'GEO-140', 1).card.title).toBe('What is the capital of Spain?')
    expect(() => moveCardOut(page, 'GEO-9')).toThrow(CardNotFoundError)
    expect(() => moveCardOut('```card\nNo ID\n```\n', 'GEO-140')).toThrow(CardNotFoundError)
  })
})

describe('Put back into this page', () => {
  const cardFile = `---\nkind: card\ntags: [geo]\n---\n${BLOCK}\n`

  it('the embed alone on its line becomes the block and card line, at the embed\'s indent: Move and Put back give the page back, its title line plain text (YAZ-5044)', () => {
    const page = `# Europe\n\nAbove.\n\n${BLOCK}\n\n- Item\n${indented(BLOCK, '  ')}\n`
    const moved = moveCardOut(page, 'GEO-140', 1)
    expect(putCardBack(moved.page, 'GEO-140', 0, moved.card.content, 'GEO-140')).toBe(`# Europe\n\nAbove.\n\n${BLOCK}\n\n- Item\n${indented(BLOCK.replace('**France**', 'France'), '  ')}\n`)
    // A card file from before YAZ-5044 (its title still its first line) goes back byte for byte.
    const first = moveCardOut(page, 'GEO-140', 0)
    expect(putCardBack(first.page, 'GEO-140', 0, cardFile, 'GEO-140')).toBe(page)
  })

  it('a card file`s `title` is the card`s first line again (YAZ-5044); its card line, reviews and all, stays', () => {
    const file = titledFile('Capital of France', FILE_BLOCK, 'tags: [geo]\n')
    expect(putCardBack('# Europe\n\n![[GEO-140]]\n', 'GEO-140', 0, file, 'GEO-140')).toBe(`# Europe\n\n\`\`\`card\nCapital of France\n---\nThe capital is {{Paris}}.\n\`\`\`\n${LINE}\n`)
  })

  it('the nth embed of that text: an embed inside a code block, a card or a line with other words is none', () => {
    const body = 'See ![[GEO-140]] here.\n\n```\n![[GEO-140]]\n```\n\n```card\n![[GEO-140]]\n```\n\n![[GEO-140]]\n\n  ![[GEO-140]]\n'
    expect(embedLine(body, 'GEO-140', 0)).toBe(10)
    expect(embedLine(body, 'GEO-140', 1)).toBe(12)
    expect(embedLine(body, 'GEO-140', 2)).toBe(-1)
    expect(putCardBack(body, 'GEO-140', 1, cardFile, 'GEO-140')).toBe(`See ![[GEO-140]] here.\n\n\`\`\`\n![[GEO-140]]\n\`\`\`\n\n\`\`\`card\n![[GEO-140]]\n\`\`\`\n\n![[GEO-140]]\n\n${indented(BLOCK, '  ')}\n`)
    expect(() => putCardBack('No embed.\n', 'GEO-140', 0, cardFile, 'GEO-140')).toThrow()
    expect(() => putCardBack('![[GEO-140]]\n', 'GEO-140', 0, '---\nkind: card\n---\nNo card.\n', 'GEO-140')).toThrow(CardNotFoundError)
  })
})

describe('Turn into a page, Turn into a card file', () => {
  it('a card file turns into a page: `kind: card` goes, `title:` stays the title, and the card in the page takes it back as its first line (YAZ-5044)', () => {
    const { content, title } = cardFileAsPage(titledFile('Capital of France', FILE_BLOCK, 'tags: [geo]\n'))
    expect(title).toBe('Capital of France')
    expect(content).toBe(`---\ntags: [geo]\ntitle: Capital of France\n---\n\`\`\`card\nCapital of France\n---\nThe capital is {{Paris}}.\n\`\`\`\n${LINE}\n`)
    expect(isCardFileContent(content)).toBe(false)
    // One from before YAZ-5044: `title:` is the card`s title, the card stays byte for byte.
    const old = cardFileAsPage(`---\nkind: card\ntags: [geo]\n---\n${BLOCK}\n`)
    expect(old).toEqual({ title: TITLE, content: `---\ntags: [geo]\ntitle: ${TITLE}\n---\n${BLOCK}\n` })
  })

  it('a page with one card and no other text turns into a card file: `kind: card`, its title among `aliases`, its `id:` kept, the card\'s name', () => {
    const page = `---\nid: GEO-7\ntitle: Capitals\naliases: [Caps]\n---\n${BLOCK}\n`
    const out = pageAsCardFile(page)!
    expect(out.name).toBe('what-is-the-capital-of-france-geo-140.md')
    expect(props(out.content)).toEqual({ id: 'GEO-7', aliases: ['Caps', 'Capitals'], kind: 'card', title: TITLE })
    expect(splitFrontmatter(out.content).body).toBe(`${FILE_BLOCK}\n`)
    expect(cardFileShape(splitFrontmatter(out.content).body).problem).toBe('ok')
    // And back: Turn into a page keeps the card's title; the old page title stays among the aliases.
    expect(props(cardFileAsPage(out.content).content)).toEqual({ id: 'GEO-7', aliases: ['Caps', 'Capitals'], title: TITLE })
  })

  it('a page with no title line takes no aliases; a page with other text, two cards, or a card with no ID cannot', () => {
    expect(props(pageAsCardFile(`---\nid: GEO-7\n---\n\n${BLOCK}\n\n`)!.content)).toEqual({ id: 'GEO-7', kind: 'card', title: TITLE })
    expect(canBeCardFile(`# Head\n\n${BLOCK}\n`)).toBe(false)
    expect(canBeCardFile(`${BLOCK}\n\n${BLOCK}\n`)).toBe(false)
    expect(canBeCardFile('```card\nNo ID\n```\n')).toBe(false)
    expect(canBeCardFile('Just text.\n')).toBe(false)
    expect(pageAsCardFile('Just text.\n')).toBeNull()
  })
})

describe('the notice\'s fixes', () => {
  it('Split: the first card stays; each other leaves byte for byte, with its ID and history, for a card file of its name', () => {
    const second = BLOCK.replace('France', 'Spain').replace('GEO-140', 'GEO-141')
    const third = '```card\nThird\n```\n<!-- card: GEO-142 -->'
    const out = splitCardFile(`---\nkind: card\n---\n${BLOCK}\n\n${second}\n\n${third}\n`)!
    expect(out.keep).toBe(`---\nkind: card\n---\n${BLOCK}\n`)
    expect(cardFileShape(splitFrontmatter(out.keep).body).problem).toBe('ok')
    expect(out.cards.map((c) => [c.name, c.content])).toEqual([
      ['what-is-the-capital-of-spain-geo-141.md', titledFile('What is the capital of Spain?', FILE_BLOCK.replace('GEO-140', 'GEO-141'))],
      ['third-geo-142.md', titledFile('Third', '```card\n\n```\n<!-- card: GEO-142 -->')],
    ])
    expect(splitCardFile(`---\nkind: card\n---\n${BLOCK}\n`)).toBeNull()
    expect(splitCardFile(`---\nkind: card\n---\n${BLOCK}\n\n\`\`\`card\nNo ID yet\n\`\`\`\n`)).toBeNull()
  })

  it('Move into the card: the text above starts the front, the text below ends the last side; the card line stays', () => {
    const next = moveTextIntoCard(`---\nkind: card\n---\nAbove it.\n\n${BLOCK}\n\nBelow it.\n`)!
    expect(next).toBe(`---\nkind: card\n---\n\`\`\`card\nAbove it.\n\nWhat is the capital of **France**?\n---\nThe capital is {{Paris}}.\n\nBelow it.\n\`\`\`\n${LINE}\n`)
    expect(cardRecords(splitFrontmatter(next).body)[0].reviews).toHaveLength(2)
    expect(moveTextIntoCard(`---\nkind: card\n---\n${BLOCK}\n`)).toBeNull()
  })

  it('Make a card from the text: the body becomes one card with no ID yet; its properties stay; with no `title`, the first line is the title (YAZ-5044), "Title" for an empty body', () => {
    expect(cardFromText('---\nkind: card\ntags: [geo]\n---\nParis is the capital.\n\nOf France.\n')).toBe('---\nkind: card\ntags: [geo]\ntitle: Paris is the capital.\n---\n```card\nOf France.\n```\n')
    expect(cardFromText('---\nkind: card\ntitle: Kept\n---\nParis.\n')).toBe('---\nkind: card\ntitle: Kept\n---\n```card\nParis.\n```\n')
    expect(cardFromText('---\nkind: card\n---\n\n')).toBe('---\nkind: card\ntitle: Title\n---\n```card\n\n```\n')
    expect(cardFromText(`---\nkind: card\n---\n${BLOCK}\n`)).toBeNull()
  })
})

describe('the ID sweep makes no copy of a card that moved (CARD_MOVE_WAIT_MS)', () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'mdapp-cardconvert-'))
    await writeConfig(root, IDS_FILE, { enabled: true, letters: 'GEO' })
  })
  afterEach(async () => {
    _evictAll()
    await removeVault(root)
  })
  const at = (...p: string[]) => path.join(root, ...p)
  const read = (rel: string) => readFile(at(rel), 'utf8')
  const PAGE = `---\nid: GEO-1\n---\n# Europe\n\n${BLOCK}\n`

  async function scanAll(files: Record<string, string>, records = new Map<string, IndexRecord>()): Promise<Map<string, IndexRecord>> {
    for (const [rel, content] of Object.entries(files)) {
      await mkdir(path.dirname(at(rel)), { recursive: true })
      await writeFile(at(rel), content)
      records.set(at(rel), await scanFile(root, at(rel)))
    }
    return records
  }

  it('Move: the card file lands first (both hold GEO-140, nothing is written), then the page; after the wait the card file keeps its ID and history', async () => {
    const records = await scanAll({ 'Europe.md': PAGE })
    const { page, card } = moveCardOut(PAGE, 'GEO-140')
    const waits = new Map<string, number>()
    await scanAll({ [card.name]: card.content }, records)
    await sweepIds(root, records, [records.get(at(card.name))!], () => undefined, [], { cardWaits: waits })
    expect(await read(card.name)).toBe(card.content)
    await scanAll({ 'Europe.md': page }, records)
    await sweepIds(root, records, [...records.values()], (p) => records.get(p)?.id, [], { cardWaits: waits, cardOver: new Set(waits.keys()) })
    expect(await read(card.name)).toBe(card.content)
    expect(await read('Europe.md')).toBe(page)
  })

  const EUROPE = '---\nid: GEO-2\n---\n# Europe\n\n![[GEO-140]]\n'
  it('Put back and Split: the card on its new file keeps its ID and history after the wait', async () => {
    const cardFile = `---\nkind: card\n---\n${BLOCK}\n\n${BLOCK.replace('GEO-140', 'GEO-141').replace('France', 'Spain')}\n`
    const records = await scanAll({ 'capitals.md': cardFile, 'Europe.md': EUROPE })
    const split = splitCardFile(cardFile)!
    const waits = new Map<string, number>()
    await scanAll({ [split.cards[0].name]: split.cards[0].content }, records)
    await sweepIds(root, records, [records.get(at(split.cards[0].name))!], () => undefined, [], { cardWaits: waits })
    await scanAll({ 'capitals.md': split.keep }, records)
    await sweepIds(root, records, [...records.values()], (p) => records.get(p)?.id, [], { cardWaits: waits, cardOver: new Set(waits.keys()) })
    expect(await read(split.cards[0].name)).toBe(split.cards[0].content)
    // Put back: the page takes the card while its card file still holds it; then the card file goes.
    const back = putCardBack(EUROPE, 'GEO-140', 0, split.keep, 'GEO-140')
    await scanAll({ 'Europe.md': back }, records)
    await sweepIds(root, records, [records.get(at('Europe.md'))!], (p) => records.get(p)?.id, [], { cardWaits: waits })
    expect(await read('Europe.md')).toBe(back)
    await scanAll({ 'capitals.md': '---\nkind: card\n---\n' }, records)
    await sweepIds(root, records, [...records.values()], (p) => records.get(p)?.id, [], { cardWaits: waits, cardOver: new Set(waits.keys()) })
    expect(await read('Europe.md')).toBe(back)
  })

  it('the live index: both writes taken at once (`indexWrote`, as the app\'s quiet writes are), and no file changes', async () => {
    await makeFirstMac(root)
    await scanAll({ 'Europe.md': PAGE })
    const ready = new Promise<void>((resolve) => {
      const off = subscribe(root, (ev) => {
        if (ev.type !== 'ready') return
        queueMicrotask(() => off())
        resolve()
      })
    })
    await getIndex(root)
    await ready
    const { page, card } = moveCardOut(PAGE, 'GEO-140')
    await writeFile(at(card.name), card.content)
    await indexWrote(at(card.name))
    await writeFile(at('Europe.md'), page)
    await indexWrote(at('Europe.md'))
    const index = await getIndex(root)
    expect(index.records.find((r) => r.path === at(card.name))?.cards?.map((c) => c.id)).toEqual(['GEO-140'])
    expect(index.records.find((r) => r.path === at('Europe.md'))?.cards ?? []).toEqual([])
    await _swept(root)
    await sleep(200)
    await _swept(root)
    expect(await read(card.name)).toBe(card.content)
    expect(await read('Europe.md')).toBe(page)
  })
})
