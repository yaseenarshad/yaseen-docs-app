import type { Root } from 'react-dom/client'
import { App } from '../App'
import { answersSetup } from '../answers/testing'
import type { AppServices } from '../app/AppState'
import { fakeFriends, fakeScanner, fakeSync } from './fakes'
import type { Updates } from '../pwa/updates'
import { memoryBackend, openVaultStore, saveVaultList, tokenStoreOn } from '../store'
import { BRANCH, REPO, VAULT } from '../sync/testing'
import type { VaultMedia } from '../media/ui/vaultMedia'

// Checker round 4 (YAZ-5078): `#fixture=c4-<card>[-update][-answered][-lost]`. Made-up data, checker worktree only.
const block = (text: string, line: string, fence = '```') => `${fence}card\n${text}\n${fence}\n<!-- card: ${line} -->`
const page = (title: string, ...cards: string[]) => `---\ntitle: ${title}\n---\n\n# ${title}\n\n${cards.join('\n\n')}\n`
const DUE = '2026-10-02T09:00Z good, 2026-10-12T09:00Z good'
const one = (text: string, extra = '', fence = '```') => ({ 'p.md': page('Geography', block(text, `CF-1${extra}, ${DUE}`, fence), block('Filler\n---\n{{filler}}', `CF-2, ${DUE}`)) })
export const C4: Record<string, Record<string, string>> = {
  zero: one('Paris is the capital of France.'),
  one: one('The capital of France is {{Paris}}.'),
  three: one('{{Seine}} runs through {{Paris}} to the {{sea}}.'),
  two: one('Hola\n---\nIt means {{Hello}}.'),
  multi: one('Which river?\n---\nIt is {{the river **Seine** in France}}.'),
  table: one('Capitals\n\n| Land | Capital |\n| -- | -- |\n| France | {{Paris}} |\n| Spain | {{Madrid}} |'),
  code: one('What prints?\n\n```js\nconsole.log({{42}})\n```\n---\nIt prints `{{42}}`.', '', '````'),
  link: one('Where?\n---\nIn [{{Paris}}](https://example.com/{{Paris}}) and [[{{Lyon}}]].'),
  alt: one('Which tower?\n\n![{{Eiffel}} tower](tower.png)\n---\nThe {{Eiffel}} tower.'),
  sound: { ...one('Which bird?\n\n![[call.mp3]]\n---\nA {{blackbird}}.'), 'call.mp3': 'made-up' },
  notitle: one('Paris is the capital\n\nWhat is the capital of France?\n---\n{{Paris}}', ', notitle'),
  titleword: one('The capital {{Paris}}\n\nOf which land?\n---\n{{France}}'),
  cardfile: { 'cards/eiffel.md': `---\nkind: card\ntitle: Eiffel tower answer\n---\n\n${block('Which tower is in Paris?\n---\nThe {{Eiffel}} tower.', `CF-3, notitle, ${DUE}`)}\n` },
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const press = (name: string) => [...document.querySelectorAll<HTMLElement>('button')].find((b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').replace(/\s+/g, ' ').trim() === name)?.click()

export async function mountCheck4Fixture(root: Root, name: string): Promise<void> {
  const kind = name.replace(/^c4-/, '').split('-')[0]
  const files = { '.yaseendocs/review.json': '{}', ...(C4[kind] ?? C4.one), 'tower.png': 'made-up' }
  Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })
  const t = await answersSetup({ files })
  const media: VaultMedia = { show: async (path) => (path.endsWith('.mp3') ? { status: 'ready', path, url: 'blob:fixture-sound', type: 'audio/mpeg' } : { status: 'missing', path, why: 'offline' }) }
  const backend = memoryBackend()
  const store = await openVaultStore(backend)
  const tokens = tokenStoreOn(backend)
  await tokens.write(VAULT, 'github_pat_11FIXTURE0' + 'f'.repeat(72))
  await saveVaultList(store, { vaults: [{ repo: REPO, branch: BRANCH, addedAt: 1 }], open: VAULT })
  const sync = fakeSync()
  sync.review = async () => ({ engine: t.engine, answers: t.answers, store: t.store })
  const services: AppServices = { store, tokens, sync, media, friends: fakeFriends(store, false), scanner: fakeScanner(), fetch: async () => new Response('{}', { status: 401 }) }
  const updates: Updates | null = name.includes('-update')
    ? ({ start: async () => {}, ready: () => true, tookOver: () => false, subscribe: () => () => {}, apply: () => {}, prepare: () => {}, check: async () => {} } as unknown as Updates)
    : null
  root.render(<App services={services} updates={updates} />)
  await wait(500)
  if (name.includes('-lost')) {
    press('Remembered')
    await wait(80)
    await t.s.git.push({ 'p.md': page('Geography', block('Filler\n---\n{{filler}}', `CF-2, ${DUE}`)) })
    await t.tick(5_000)
    await wait(500)
  }
  if (name.includes('-answered')) press('Remembered')
  if (name.includes('-done')) {
    press('Remembered')
    await wait(700)
    press('Remembered')
  }
  if (name.includes('-archived')) {
    press('More card actions')
    await wait(50)
    press('Archive card')
  }
  ;(window as unknown as { c4: unknown }).c4 = { t }
  await wait(700)
  document.documentElement.dataset.fixtureReady = name
}

// `#fixture=c4erase-<n>[-friends]`: Settings with the erase ask open; n answers waiting over two vaults (n split 2+rest).
export async function mountCheck4Erase(root: Root, name: string): Promise<void> {
  const { saveAccount } = await import('../auth/account')
  const { vaultId } = await import('../store')
  const { ANSWERS_STATE } = await import('../answers/outbox')
  const n = Number(/c4erase-(\d+)/.exec(name)?.[1] ?? '0')
  const vaults = [{ repo: 'demo/demo-vault', branch: 'main', addedAt: 1 }, { repo: 'demo/work-wiki', branch: 'main', addedAt: 2 }]
  const backend = memoryBackend()
  const store = await openVaultStore(backend)
  const tokens = tokenStoreOn(backend)
  for (const v of vaults) {
    await tokens.write(vaultId(v), 'github_pat_11FIXTURE0' + 'f'.repeat(72))
    await saveAccount(store, vaultId(v), { login: 'demo', name: 'Demo Person', avatarUrl: '', gists: 'yes', expiresAt: null, checkedAt: 0 })
  }
  await saveVaultList(store, { vaults, open: vaultId(vaults[0]) })
  // n answers: the first vault holds min(n, 2) (one is an answer to an Up next card: two actions, ONE group); the rest go to the second.
  const book = (groups: number) => {
    const waiting: { seq: number; group: number; op: unknown; path: string; title: string; madeAt: number }[] = []
    for (let g = 1; g <= groups; g++) {
      const review = { kind: 'review', id: `X-${g}`, review: { at: '2026-11-14T06:00Z', rating: 'good' } }
      // The first answer is to an Up next card: two actions in ONE group.
      if (g === 1) waiting.push({ seq: waiting.length + 1, group: g, op: { kind: 'next', id: `X-${g}`, on: false }, path: 'a.md', title: 'T', madeAt: 0 })
      waiting.push({ seq: waiting.length + 1, group: g, op: review, path: 'a.md', title: 'T', madeAt: 0 })
    }
    return { v: 1, next: 99, lost: [], waiting }
  }
  const fix = <T,>(b: T) => b
  if (n > 0) await store.setState(vaultId(vaults[0]), ANSWERS_STATE, fix(book(Math.min(n, 2))))
  if (n > 2) await store.setState(vaultId(vaults[1]), ANSWERS_STATE, fix(book(n - 2)))
  const services: AppServices = { store, tokens, sync: fakeSync(), friends: fakeFriends(store, name.includes('friends')), scanner: fakeScanner(), fetch: async () => new Response('{}', { status: 401 }) }
  root.render(<App services={services} />)
  await wait(300)
  press('Settings')
  await wait(100)
  press('Sign out and erase this phone')
  await wait(300)
  ;(window as unknown as { c4: unknown }).c4 = { store, tokens }
  document.documentElement.dataset.fixtureReady = name
}
