// CHECKER (YAZ-4946 round 1): the sweep on the bytes the editor saves after a card is pasted ABOVE itself.
import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pageCards, cardIdOf, cardReviewsOf } from '@shared/cardLine'
import { IDS_FILE } from '@shared/noteId'
import { removeVault } from '../fs/testFixture'
import { writeConfig } from '../vaultConfig'
import { sweepIds } from './idSweep'
import { _evictAll } from './index'
import { scanFile } from './scan'

let root: string
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'mdapp-checker-'))
  await writeConfig(root, IDS_FILE, { enabled: true, letters: 'WIKI' })
})
afterEach(async () => {
  _evictAll()
  await removeVault(root)
})

const sweep = async (body: string) => {
  const p = path.join(root, 'deck.md')
  await writeFile(p, `---\nid: WIKI-1\n---\n${body}`)
  const records = new Map([[p, await scanFile(root, p)]])
  await sweepIds(root, records, [...records.values()], (q) => records.get(q)?.id)
  return pageCards(await readFile(p, 'utf8')).map((c) => [cardIdOf(c.line), cardReviewsOf(c.line).length])
}
const line = '<!-- card: WIKI-9, 2026-11-01T09:00Z good, 2026-11-05T09:00Z good -->'
const card = (text: string, l: string | null) => `\`\`\`card\n${text}\n\`\`\`\n${l === null ? '' : `${l}\n`}\n`

it('the card that was there first (the lower one) keeps its history: the editor saves the pasted copy with no ID (YAZ-4972)', async () => {
  // Byte for byte what the editor saves after the paste above (checker.paste.test.ts): the copy is FIRST, with no line.
  expect(await sweep(`Intro\n\n${card('Original question\n---\nAnswer', null)}${card('Original question\n---\nAnswer', line)}`)).toEqual([
    ['WIKI-10', 0],
    ['WIKI-9', 2],
  ])
})

it('an agent`s copy with one ID on the page: the same text loses the copy`s history (nothing is lost); another text keeps both', async () => {
  expect(await sweep(card('Q\n---\nA', line) + card('Q\n---\nA', line))).toEqual([
    ['WIKI-9', 2],
    ['WIKI-10', 0],
  ])
  // An edited copy ABOVE its original: the sweep cannot tell which came first, so no history is emptied.
  expect(await sweep(card('Q, reworded\n---\nA', line) + card('Q\n---\nA', line))).toEqual([
    ['WIKI-9', 2],
    ['WIKI-11', 2],
  ])
})
