import type { Root } from 'react-dom/client'
import { App } from '../App'
import type { AppServices } from '../app/AppState'
import { saveAccount, type VaultAccount } from '../auth/account'
import type { TokenEndWarning } from '../auth/expiry'
import { fakeFriends, fakeScanner, fakeSync } from '../dev/fakes'
import { memoryBackend, openVaultStore, saveVaultList, tokenStoreOn, vaultId, type PhoneVault } from '../store'
import { syncDot, type DotInput } from './dot'
import { DotWords } from './SyncStatus'
import { fakeAnswers, lostAnswer } from './testing'
import './status.css'

/**
 * The dot's screen fixtures (`#fixture=dot-…`), made-up data only, for the screenshots of YAZ-5080. Only the
 * `--mode fixtures` build reaches this file (`dev/fixtures.tsx`). Nothing calls GitHub.
 *  - `dot-all`: the five states of decision 12 in five top bars, with the words of each.
 *  - `dot-<state>`: the whole app with that state; `dot-<state>-sheet`: the same, after a tap on the dot;
 *    `dot-lost-ask`: the ask of the first Discard.
 */
const VAULT: PhoneVault = { repo: 'demo/demo-vault', branch: 'main', addedAt: 1 }
const MIN = 60_000
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

const ALL: [string, Partial<DotInput>][] = [
  ['All is sent and up to date', {}],
  ['Answers not sent yet', { answers: { waiting: 3, lost: 0, sending: false, problem: null } }],
  ['Sending or getting changes now', { sync: { status: 'syncing', problem: null } }],
  ['No connection', { online: false }],
  ['The token stopped working', { sync: { status: 'attention', problem: 'UNAUTHORIZED' } }],
  ['Answers wait, no connection (the longest words)', { online: false, answers: { waiting: 3, lost: 0, sending: false, problem: null } }],
  ['Two answers whose card is gone', { answers: { waiting: 0, lost: 2, sending: false, problem: null } }],
]

function Gallery() {
  const base: DotInput = { sync: { status: 'synced', problem: null }, answers: { waiting: 0, lost: 0, sending: false, problem: null }, online: true, token: { kind: 'none' } }
  return (
    <div className="app" style={{ overflow: 'auto' }}>
      {ALL.map(([what, over]) => {
        const dot = syncDot({ ...base, ...over })
        return (
          <section key={what} style={{ marginBottom: 14 }}>
            <header className="topbar">
              <h1 className="topbar__title">demo-vault</h1>
              <button type="button" className="sync-status" aria-label={`Sync status: ${dot.words}`}>
                <span className={`sync-dot sync-dot--${dot.state}`} aria-hidden="true" />
                <DotWords dot={dot} />
              </button>
              <button type="button" className="icon-btn" aria-label="Settings">
                ⚙
              </button>
            </header>
            <p className="muted" style={{ margin: '6px 16px 0' }}>
              {dot.state}: {what}
            </p>
          </section>
        )
      })}
    </div>
  )
}

export async function mountDotFixture(root: Root, name: string): Promise<void> {
  if (name === 'dot-all') {
    root.render(<Gallery />)
    await wait(50)
    document.documentElement.dataset.fixtureReady = name
    return
  }
  const now = Date.now()
  const ask = name.endsWith('-ask')
  const sheet = ask || name.endsWith('-sheet')
  const state = name.replace(/^dot-/, '').replace(/-(sheet|ask)$/, '')
  const backend = memoryBackend()
  const store = await openVaultStore(backend)
  const tokens = tokenStoreOn(backend)
  const token: TokenEndWarning['kind'] = state === 'token' ? 'soon' : 'none'
  const account: VaultAccount = { login: 'demo', name: 'Demo Person', avatarUrl: '', gists: 'yes', expiresAt: token === 'soon' ? new Date(now + 2.5 * 86_400_000).toISOString() : null, checkedAt: 0 }
  await tokens.write(vaultId(VAULT), 'github_pat_11FIXTURE0' + 'f'.repeat(72))
  await saveAccount(store, vaultId(VAULT), account)
  await saveVaultList(store, { vaults: [VAULT], open: vaultId(VAULT) })
  const sync = fakeSync()
  const answers = fakeAnswers()
  Object.assign(sync, { review: async () => ({ answers }) })
  const refuseAll = async () => new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 })
  const services: AppServices = { store, tokens, sync, friends: fakeFriends(store, false), scanner: fakeScanner(), fetch: refuseAll, now: () => now }
  root.render(<App services={services} />)
  await wait(80)
  sync.set({ lastSyncedAt: now - 2 * 60 * MIN })
  switch (state) {
    case 'pending':
      answers.set({ waiting: 3 })
      break
    case 'one':
      answers.set({ waiting: 1 })
      break
    case 'syncing':
      sync.set({ status: 'syncing' })
      break
    case 'off':
      sync.set({ status: 'off', problem: 'OFFLINE' })
      break
    case 'waiting-off':
      sync.set({ status: 'off', problem: 'OFFLINE' })
      answers.set({ waiting: 3 })
      break
    case 'stale':
      answers.set({ waiting: 2, problem: 'STALE_HEAD', retryAt: now + 4 * MIN })
      break
    case 'slowed':
      sync.set({ status: 'slowed', problem: 'RATE_LIMITED', retryAt: now + 4 * MIN })
      break
    case 'attention':
      sync.set({ status: 'attention', problem: 'UNAUTHORIZED' })
      break
    case 'lost':
      answers.set({ lost: [lostAnswer(5), lostAnswer(6, "Ohm's law", 'again', 'NC-2')] })
      break
  }
  await wait(50)
  if (sheet) document.querySelector<HTMLButtonElement>('.sync-status')?.click()
  await wait(50)
  if (ask) document.querySelector<HTMLButtonElement>('.discard-answer')?.click()
  await wait(50)
  document.documentElement.dataset.fixtureReady = name
}
