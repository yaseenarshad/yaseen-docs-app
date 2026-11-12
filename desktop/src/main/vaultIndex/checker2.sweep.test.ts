// CHECKER (YAZ-4946 round 2): two cards with one ID and the SAME text but DIFFERENT histories (a git "keep both", an agent's stale copy).
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
  root = await mkdtemp(path.join(tmpdir(), 'mdapp-checker2-'))
  await writeConfig(root, IDS_FILE, { enabled: true, letters: 'WIKI' })
})
afterEach(async () => {
  _evictAll()
  await removeVault(root)
})

it('same text, different reviews: no review leaves the file', async () => {
  const p = path.join(root, 'deck.md')
  // Mac A answered on Nov 1, Mac B on Nov 1 and Nov 7; a merge kept both blocks. Or: an agent wrote a stale copy above.
  const a = '<!-- card: WIKI-9, 2026-11-01T09:00Z good -->'
  const b = '<!-- card: WIKI-9, 2026-11-01T09:00Z good, 2026-11-07T09:00Z good -->'
  await writeFile(p, `---\nid: WIKI-1\n---\n\`\`\`card\nQ\n---\nA\n\`\`\`\n${a}\n\n\`\`\`card\nQ\n---\nA\n\`\`\`\n${b}\n`)
  const records = new Map([[p, await scanFile(root, p)]])
  await sweepIds(root, records, [...records.values()], (q) => records.get(q)?.id)
  const after = await readFile(p, 'utf8')
  const all = pageCards(after).flatMap((c) => cardReviewsOf(c.line).map((r) => r.at))
  expect(pageCards(after).map((c) => cardIdOf(c.line))).toEqual(['WIKI-9', 'WIKI-10'])
  // The Nov 7 review exists only on the lower card. It must still be in the file.
  expect(all).toContain('2026-11-07T09:00Z')
})
