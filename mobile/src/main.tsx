import { startAppearance } from './settings/appearance'
import { StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { onlyLocalMedia } from '@client/editor/card/cardSafety'
import { App, NoStorage } from './App'
import { forgetUpdateMark, startUpdates } from './pwa/browser'
import { lazySync } from './app/lazySync'
import { lazyMedia } from './media/ui/lazyMedia'
import { FRIENDS_ENABLED } from '@shared/features'
import { localFriends } from './app/friendsPort'
import { lazyFriends } from './friends/ui/lazy'
import { openPhoneStorage } from './store'
import { noteStorageCall, noteSyncStatus, startWakeLog } from './store/wakeLog'
import './styles.css'

// Light or dark as Settings › Appearance says, on the page before anything draws (no flash).
startAppearance()

// Every card the phone draws (the reader, Review) loads nothing from another host (`localOnly.ts`).
onlyLocalMedia()

const root = createRoot(document.getElementById('root')!)

// The screen fixtures (made-up data, for the screenshots) exist only in a `--mode fixtures` build. In the real build
// this test is `false` at build time, so the fixture code is not in the bundle.
if (import.meta.env.MODE === 'fixtures' && location.hash.startsWith('#fixture')) void import('./dev/fixtures').then((m) => m.mountFixture(root, location.hash))
else void boot(root)

// A new version NEVER starts by itself, not even here at a cold start: the app starts the version the person runs,
// and "A new version is ready" waits for a tap on Restart (`pwa/safeMoment.ts`). After that tap, the address loses
// its update mark. YAZ-5644: the same start in a browser tab (phone, tablet, computer) and in the Home Screen app: the
// sign-in, the storage and the worker. A phone's tab shows a light hint to add the app (`screens/InstallHint.tsx`).
async function boot(root: Root) {
  forgetUpdateMark()
  await start(root)
}

async function start(root: Root) {
  // YAZ-5596 (15): the wake log (Settings › Vault health): this start, each return, the first pass and storage calls.
  startWakeLog()
  const friendsDemo = import.meta.env.DEV && new URLSearchParams(location.search).get('friendsDemo') === '1'
  let storage: Awaited<ReturnType<typeof openPhoneStorage>>
  if (friendsDemo) {
    // YAZ-6221: isolated in-memory demo vault (lazy-loaded so zero bytes enter the first-load bundle).
    const [{ saveAccount }, { memoryBackend, openVaultStore, saveVaultList, tokenStoreOn, vaultId }, { gitBlobSha }, { INDEX_RULES, INDEX_STATE, phoneRecord }] =
      await Promise.all([import('./auth/account'), import('./store'), import('./sync/gitSha'), import('./sync/phoneIndex')])
    const backend = memoryBackend()
    const store = await openVaultStore(backend)
    const tokens = tokenStoreOn(backend)
    const demoVault = { repo: 'yaseen/demo-vault', branch: 'main', addedAt: 1 }
    const id = vaultId(demoVault)
    const now = Date.now()
    await tokens.write(id, 'ghu_friends_demo_only_000000000000')
    await saveAccount(store, id, { login: 'yaseen', name: 'Yaseen', avatarUrl: '', gists: 'yes', expiresAt: null, checkedAt: now })
    const demoFiles: Record<string, string> = {
      '.yaseendocs/review.json': JSON.stringify({ enabled: true }),
      '.yaseendocs/ids.json': JSON.stringify({ enabled: true, letters: 'DEMO' }),
      'Biochem/atp-synthase-DEMO-1.md':
        '---\nkind: card\n---\n```card\nWhich mitochondrial complex synthesizes ATP?\n---\nComplex V (ATP synthase)\n```\n<!-- card: DEMO-1, title "ATP Synthase" -->\n',
      'Spanish/ser-vs-estar-DEMO-2.md':
        '---\nkind: card\n---\n```card\nWhen do you use *estar* instead of *ser*?\n---\nTemporary states, locations, and ongoing actions\n```\n<!-- card: DEMO-2, title "Ser vs Estar" -->\n',
    }
    const shas: Record<string, string> = {}
    const records: Record<string, ReturnType<typeof phoneRecord>> = {}
    for (const [path, content] of Object.entries(demoFiles)) {
      await store.write(id, path, content)
      const bytes = new TextEncoder().encode(content)
      shas[path] = await gitBlobSha(bytes)
      if (/\.md$/.test(path) && !path.startsWith('.')) {
        records[path] = phoneRecord(path, bytes.length, content, { ctime: now, mtime: now })
      }
    }
    await store.setState(id, INDEX_STATE, { commit: 'demo-head-sha', rules: INDEX_RULES, records })
    await store.setCheckpoint(id, { commit: 'demo-head-sha', etag: 'demo-etag', shas })
    await saveVaultList(store, { vaults: [demoVault], open: id })
    storage = { store, tokens }
  } else {
    try {
      // YAZ-5645: a GitHub sign-in's token renews by itself, through the site's Worker (`worker/index.ts`). The call's
      // code loads only when a refresh is due (it is not in the first load).
      storage = await openPhoneStorage(noteStorageCall, { renew: async (refresh) => (await import('./auth/githubWorker')).renewAtWorker()(refresh) })
    } catch {
      root.render(<NoStorage />)
      return
    }
  }
  const { store, tokens } = storage
  // 3B's engine, loaded when a vault opens. 3D's media is made with the engine once it loads, in a
  // chunk of its own (`lazyMedia`): the reader and Review show pictures, sounds and files through it.
  // Friends (4E): the list gist, the sender (on the engine's passes), Cheer and Nudge, in a chunk of their own.
  const sync = friendsDemo
    ? lazySync(store, tokens, async () => {
        const [engineMod, pageEventsMod, answersMod, followAnswersMod] = await Promise.all([
          import('./sync/engine'),
          import('./sync/pageEvents'),
          import('./answers/answers'),
          import('./review/followAnswers'),
        ])
        const noopRemote = () => ({
          head: async (etag?: string) => (etag === 'demo-etag' ? ('unchanged' as const) : { sha: 'demo-head-sha', etag: 'demo-etag' }),
          tree: async () => Object.assign(new Map<string, string>(), { bytes: new Map<string, number>() }),
          blob: async () => new Uint8Array(),
          blobs: async () => [],
          commit: async () => 'demo-head-sha',
          contains: async () => true,
        })
        return {
          createSyncEngine: (opts) => engineMod.createSyncEngine({ ...opts, makeRemote: noopRemote }),
          followPage: pageEventsMod.followPage,
          createAnswers: answersMod.createAnswers,
          followAnswers: followAnswersMod.followAnswers,
        }
      })
    : lazySync(store, tokens)
  sync.subscribe((event) => event.type === 'state' && noteSyncStatus(event.state.status))
  // YAZ-5652: with Friends off (`shared/features.ts`), no friends chunk, list, sender or gist call: the plain port
  // (no friends, and the two settings kept on this phone) stands in.
  const friends = FRIENDS_ENABLED ? lazyFriends(store, tokens, sync.loaded()) : localFriends(store)
  const services = { store, tokens, sync, media: lazyMedia(sync.loaded, store), friends }
  root.render(
    <StrictMode>
      <App services={services} updates={startUpdates()} />
    </StrictMode>,
  )
}
