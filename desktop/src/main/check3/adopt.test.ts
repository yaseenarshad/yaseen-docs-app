import { expect, it } from 'vitest'
import { INDEX_FILE, NUMBERS_FILE, ensureFriendsFiles } from '@shared/friendGists'
import { fakeGistWorld } from '@shared/friendGistsFake'

it('check3: a list with no stats adopts another tool`s gist that has a file named notecards-stats.json', async () => {
  const w = fakeGistWorld({ accounts: { ali: { login: 'ali' } }, start: Date.parse('2026-11-14T08:00:00Z') })
  const other = w.seed('ali', { [NUMBERS_FILE]: '{"my":"backup"}', 'README.md': 'my own private copy' })
  w.advance(1000)
  w.seed('ali', { [INDEX_FILE]: JSON.stringify({ v: 1, nickname: null, vaults: [], friends: [], groups: [] }) })
  const made = await ensureFriendsFiles(w.api('ali'), { vaults: [], nickname: null }, { describe: (k) => k, sleep: async () => {}, now: w.now })
  expect(made.kind === 'ok' && made.handle.index.stats).not.toBe(other) // fails if it adopts the other tool's gist
})
