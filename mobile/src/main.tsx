import { startAppearance } from './settings/appearance'
import { StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { onlyLocalMedia } from '@client/editor/card/cardSafety'
import { App, NoStorage } from './App'
import { forgetUpdateMark, startUpdates } from './pwa/browser'
import { lazySync } from './app/lazySync'
import { lazyMedia } from './media/ui/lazyMedia'
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
  let storage: Awaited<ReturnType<typeof openPhoneStorage>>
  try {
    // YAZ-5645: a GitHub sign-in's token renews by itself, through the site's Worker (`worker/index.ts`). The call's
    // code loads only when a refresh is due (it is not in the first load).
    storage = await openPhoneStorage(noteStorageCall, { renew: async (refresh) => (await import('./auth/githubWorker')).renewAtWorker()(refresh) })
  } catch {
    root.render(<NoStorage />)
    return
  }
  const { store, tokens } = storage
  // 3B's engine, loaded when a vault opens. 3D's media is made with the engine once it loads, in a
  // chunk of its own (`lazyMedia`): the reader and Review show pictures, sounds and files through it.
  // Friends (4E): the list gist, the sender (on the engine's passes), Cheer and Nudge, in a chunk of their own.
  const sync = lazySync(store, tokens)
  sync.subscribe((event) => event.type === 'state' && noteSyncStatus(event.state.status))
  const friends = lazyFriends(store, tokens, sync.loaded())
  const services = { store, tokens, sync, media: lazyMedia(sync.loaded, store), friends }
  root.render(
    <StrictMode>
      <App services={services} updates={startUpdates()} />
    </StrictMode>,
  )
}
