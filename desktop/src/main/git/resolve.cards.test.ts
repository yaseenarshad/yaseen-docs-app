/**
 * YAZ-5089 (decision 5 on YAZ-5055), against REAL git: a card answered or marked on two Macs is no clash. Sync unites
 * the card's lines (`shared/cardMerge.ts`) before the page's line merge, so it makes no conflict copy. Any other clash
 * keeps both as before, and the copy's name is one the YAZ-5056 rule knows, so the copy never keeps a card ID.
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cardRecords } from '@shared/cardLine'
import { splitFrontmatter } from '@shared/frontmatter'
import { isSyncConflictCopy } from '@shared/syncConflict'
import { makeTwoMachines, REAL_GIT_TIMEOUT_MS, type Machine } from './gitFixture'
import { syncPass } from './sync'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c()
})

const card = (text: string, line: string) => `\`\`\`card\n${text}\n\`\`\`\n<!-- card: ${line} -->\n`
const PAGE = (cards: string, intro = 'Some words to learn.') => `---\nid: YAZ-1\ntitle: Spanish words\n---\n# Spanish words\n\n${intro}\n\n${cards}\nThe end.\n`
const OLD = '2026-11-01T09:00Z good'
const SAM = '2026-11-13T10:00Z good 4s'
const ME = '2026-11-13T10:05Z again 7s'
const cardsIn = (text: string) => cardRecords(splitFrontmatter(text).body).map(({ title: _t, ...rest }) => rest)
const copies = (m: Machine) => readdirSync(m.root).filter((f) => f.includes('(conflict'))

/** Every file's bytes, `.git` excluded. */
function vault(root: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.git') continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else out[path.relative(root, p).split(path.sep).join('/')] = readFileSync(p, 'utf8')
    }
  }
  walk(root)
  return out
}

/** Sam (B) syncs first; my pass (A) meets the clash; then Sam pulls, and both Macs must hold the same vault. */
async function meet(files: Record<string, string>, sam: Record<string, string | null>, me: Record<string, string | null>) {
  const pair = await makeTwoMachines(files)
  cleanups.push(pair.cleanup)
  const { a, b } = pair
  for (const [rel, text] of Object.entries(sam)) await (text === null ? b.remove(rel) : b.write(rel, text))
  for (const [rel, text] of Object.entries(me)) await (text === null ? a.remove(rel) : a.write(rel, text))
  expect((await syncPass(b.root)).state).toBe('synced')
  const status = await syncPass(a.root)
  expect(status.state).toBe('synced')
  expect((await syncPass(b.root)).state).toBe('synced')
  expect(vault(b.root)).toEqual(vault(a.root))
  expect(await a.git('status', '--porcelain')).toBe('')
  return { a, b, status }
}

describe('sync unites card lines before the line merge (YAZ-5089)', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it('the same card answered on both Macs: one page, the union of the reviews, no copy', async () => {
    const { a, status } = await meet({ 'words.md': PAGE(card('Hola', `YAZ-7, ${OLD}`)) }, { 'words.md': PAGE(card('Hola', `YAZ-7, ${OLD}, ${SAM}`)) }, { 'words.md': PAGE(card('Hola', `YAZ-7, ${OLD}, ${ME}`)) })
    expect(a.read('words.md')).toBe(PAGE(card('Hola', `YAZ-7, ${OLD}, ${SAM}, ${ME}`)))
    expect(copies(a)).toEqual([])
    expect(status.merged?.[0]?.copy).toBeUndefined()
  })

  it('one Mac answers, the other edits the card\'s text: one page with both, no copy', async () => {
    const base = PAGE(card('Hola\n---\nHello', `YAZ-7, ${OLD}`))
    const { a } = await meet({ 'words.md': base }, { 'words.md': PAGE(card('Hola\n---\nHello, hi', `YAZ-7, ${OLD}`)) }, { 'words.md': PAGE(card('Hola\n---\nHello', `YAZ-7, ${OLD}, ${ME}`)) })
    expect(a.read('words.md')).toBe(PAGE(card('Hola\n---\nHello, hi', `YAZ-7, ${OLD}, ${ME}`)))
    expect(copies(a)).toEqual([])
  })

  it('one Mac edits the text and answers, the other answers: one page, the new text and both reviews, no copy', async () => {
    const base = PAGE(card('Hola\n---\nHello', `YAZ-7, ${OLD}`))
    const { a } = await meet({ 'words.md': base }, { 'words.md': PAGE(card('Hola\n---\nHello, hi', `YAZ-7, ${OLD}, ${SAM}`)) }, { 'words.md': PAGE(card('Hola\n---\nHello', `YAZ-7, ${OLD}, ${ME}`)) })
    expect(a.read('words.md')).toBe(PAGE(card('Hola\n---\nHello, hi', `YAZ-7, ${OLD}, ${SAM}, ${ME}`)))
    expect(copies(a)).toEqual([])
  })

  it('one Mac archives the card and puts another up next, the other answers both: the marks and the reviews stay, no copy', async () => {
    const base = PAGE(card('Hola', `YAZ-7, ${OLD}`) + '\n' + card('Gato', 'YAZ-8'))
    const { a } = await meet(
      { 'words.md': base },
      { 'words.md': PAGE(card('Hola', `YAZ-7, off, ${OLD}`) + '\n' + card('Gato', 'YAZ-8, next')) },
      { 'words.md': PAGE(card('Hola', `YAZ-7, ${OLD}, ${ME}`) + '\n' + card('Gato', `YAZ-8, ${ME}`)) },
    )
    expect(cardsIn(a.read('words.md'))).toEqual([
      { id: 'YAZ-7', off: true, next: false, reviews: [{ at: '2026-11-01T09:00Z', rating: 'good' }, { at: '2026-11-13T10:05Z', rating: 'again', seconds: 7 }] },
      { id: 'YAZ-8', off: false, next: true, reviews: [{ at: '2026-11-13T10:05Z', rating: 'again', seconds: 7 }] },
    ])
    expect(copies(a)).toEqual([])
  })

  it('a card file answered on both Macs: the union of the reviews, its properties byte for byte, no copy', async () => {
    const file = (line: string) => `---\nkind: card\ntitle: "Capital: France"\n---\n${card('Capital of {{France}}\n---\nParis', line)}`
    const { a } = await meet({ 'Capital.md': file(`YAZ-9, ${OLD}`) }, { 'Capital.md': file(`YAZ-9, ${OLD}, ${SAM}`) }, { 'Capital.md': file(`YAZ-9, ${OLD}, ${ME}`) })
    expect(a.read('Capital.md')).toBe(file(`YAZ-9, ${OLD}, ${SAM}, ${ME}`))
    expect(copies(a)).toEqual([])
  })

  it('a card that moved to a card file on one Mac and was answered on the other: no union, keep both, and the copy is a YAZ-5056 copy', async () => {
    const base = PAGE(card('Hola', `YAZ-7, ${OLD}`))
    const { a, status } = await meet(
      { 'words.md': base },
      { 'words.md': PAGE('![[YAZ-7]]\n'), 'Hola.md': `---\nkind: card\n---\n${card('Hola', `YAZ-7, ${OLD}`)}` },
      { 'words.md': PAGE(card('Hola', `YAZ-7, ${OLD}, ${ME}`)) },
    )
    expect(a.read('words.md')).toBe(PAGE('![[YAZ-7]]\n'))
    const copy = status.merged?.[0]?.copy ?? ''
    expect(isSyncConflictCopy(copy)).toBe(true)
    expect(cardsIn(a.read(copy))).toEqual([{ id: 'YAZ-7', off: false, next: false, reviews: [{ at: '2026-11-01T09:00Z', rating: 'good' }, { at: '2026-11-13T10:05Z', rating: 'again', seconds: 7 }] }])
  })

  it('a real text clash elsewhere in the page: keep both as today; the page at its path holds both answers; the copy is a YAZ-5056 copy', async () => {
    const base = PAGE(card('Hola', `YAZ-7, ${OLD}`))
    const { a, status } = await meet(
      { 'words.md': base },
      { 'words.md': PAGE(card('Hola', `YAZ-7, ${OLD}, ${SAM}`), 'Words from Sam.') },
      { 'words.md': PAGE(card('Hola', `YAZ-7, ${OLD}, ${ME}`), 'Words from me.') },
    )
    expect(a.read('words.md')).toBe(PAGE(card('Hola', `YAZ-7, ${OLD}, ${SAM}, ${ME}`), 'Words from Sam.'))
    const copy = status.merged?.[0]?.copy ?? ''
    expect(copy).toMatch(/^words \(conflict, \d{4}-\d{2}-\d{2}\)\.md$/)
    expect(isSyncConflictCopy(copy)).toBe(true)
    expect(a.read(copy)).toContain('Words from me.')
  })

  it('a page with no cards: the same keep-both as before, each side byte for byte', async () => {
    const page = (words: string) => `---\ntitle: Plan\n---\n${words}\r\nline two\n`
    const { a, status } = await meet({ 'plan.md': page('line one') }, { 'plan.md': page('line one, Sam') }, { 'plan.md': page('line one, me') })
    expect(a.read('plan.md')).toBe(page('line one, Sam'))
    expect(a.read(status.merged?.[0]?.copy ?? '')).toBe(page('line one, me'))
  })
})
