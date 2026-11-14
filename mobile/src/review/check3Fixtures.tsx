import type { Root } from 'react-dom/client'
import { App } from '../App'
import { answersSetup } from '../answers/testing'
import type { AppServices } from '../app/AppState'
import { fakeFriends, fakeScanner, fakeSync } from '../dev/fakes'
import type { Updates } from '../pwa/updates'
import { memoryBackend, openVaultStore, saveVaultList, tokenStoreOn } from '../store'
import { BRANCH, REPO, VAULT } from '../sync/testing'
import type { VaultMedia } from '../media/ui/vaultMedia'

// Checker round 3 (YAZ-5078) screen fixtures, `#fixture=c3-…`: made-up data, the real engine and answer list on the
// fake GitHub. In the checker's worktree only.
const block = (text: string, line: string) => `\`\`\`card\n${text}\n\`\`\`\n<!-- card: ${line} -->`
const page = (title: string, ...cards: string[]) => `---\ntitle: ${title}\n---\n\n# ${title}\n\n${cards.join('\n\n')}\n`
const DUE = '2026-10-02T09:00Z good, 2026-10-12T09:00Z good'
const long = `The long card\n\n${Array.from({ length: 30 }, (_, i) => `${i + 1}. A long made-up line about the printing press, line ${i + 1}.`).join('\n')}\n---\nAbout {{1450}}.`
const SETS: Record<string, Record<string, string>> = {
  short: { 'words.md': page('Spanish words', block('Hola\n---\n{{Hello}}', `CK-1, ${DUE}`), block('Adios\n---\n{{Bye}}', `CK-2, ${DUE}`)) },
  long: { 'history.md': page('History', block(long, `CK-3, ${DUE}`)) },
  table: { 'verbs.md': page('Verbs', block('Verbs: ser\n\n| | ser |\n| -- | -- |\n| yo | {{soy}} |\n| tú | {{eres}} |\n| él | {{es}} |', `CK-4, ${DUE}`)) },
  sound: { 'birds.md': page('Birds', block('Which bird?\n\n![[blackbird.mp3]]\n---\nA {{blackbird}}.', `CK-5, ${DUE}`)), 'blackbird.mp3': 'made-up' },
  sound2: { 'birds.md': page('Birds', block('Which is higher?\n\n![[one.mp3]]\n\n![[two.mp3]]\n---\nThe {{second}}.', `CK-6, ${DUE}`)), 'one.mp3': 'made-up', 'two.mp3': 'made-up' },
  done: { 'words.md': page('Spanish words', block('Hola\n---\n{{Hello}}', `CK-1, ${DUE}`)) },
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const press = (name: string) => [...document.querySelectorAll<HTMLElement>('button')].find((b) => (b.getAttribute('aria-label') ?? b.textContent ?? '').replace(/\s+/g, ' ').trim() === name)?.click()

export async function mountCheck3Fixture(root: Root, name: string): Promise<void> {
  const kind = name.replace(/^c3-/, '').replace(/-(lost|update|answered)$/, '').replace(/-update$/, '')
  const files = { '.yaseendocs/review.json': '{}', ...(SETS[kind] ?? SETS.short) }
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
  if (kind === 'done' || name.endsWith('-answered')) press('Remembered')
  if (name.endsWith('-lost')) {
    // An answer whose card goes on GitHub before the send: the amber line.
    press('Remembered')
    await wait(80)
    await t.s.git.push({ 'words.md': page('Spanish words', block('Adios\n---\n{{Bye}}', `CK-2, ${DUE}`)) })
    await t.tick(5_000)
  }
  await wait(600)
  document.documentElement.dataset.fixtureReady = name
}
