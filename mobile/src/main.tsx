import { StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { onlyLocalMedia } from '@client/editor/card/cardSafety'
import { App, NoStorage } from './App'
import { startUpdates, swapWaitingVersion } from './pwa/browser'
import { lazySync } from './app/lazySync'
import { lazyMedia } from './media/ui/lazyMedia'
import { lazyFriends } from './friends/ui/lazy'
import { cameraScanner } from './scan/camera'
import { openPhoneStorage } from './store'
import './styles.css'

// YAZ-5209: every card the phone draws (the reader, Review) loads nothing from another host (`localOnly.ts`).
onlyLocalMedia()

const root = createRoot(document.getElementById('root')!)

// The screen fixtures (made-up data, for the screenshots) exist only in a `--mode fixtures` build. In the real build
// this test is `false` at build time, so the fixture code is not in the bundle.
if (import.meta.env.MODE === 'fixtures' && location.hash.startsWith('#fixture')) void import('./dev/fixtures').then((m) => m.mountFixture(root, location.hash))
else void boot(root)

// YAZ-5087: a new version that waits starts now, before the app runs (nothing is open; the answer list is stored).
async function boot(root: Root) {
  if (await swapWaitingVersion()) return
  await start(root)
}

async function start(root: Root) {
  let storage: Awaited<ReturnType<typeof openPhoneStorage>>
  try {
    storage = await openPhoneStorage()
  } catch {
    root.render(<NoStorage />)
    return
  }
  const { store, tokens } = storage
  // 3B's engine (YAZ-5072), loaded when a vault opens. 3D's media (YAZ-5074) is made with the engine once it loads, in a
  // chunk of its own (`lazyMedia`): the reader and Review show pictures, sounds and files through it (YAZ-5079).
  // Friends (4E, YAZ-5085): the list gist, the sender (on the engine's passes), Cheer and Nudge, in a chunk of their own.
  const sync = lazySync(store, tokens)
  const friends = lazyFriends(store, tokens, sync.loaded())
  const services = { store, tokens, sync, media: lazyMedia(sync.loaded, store), friends, scanner: cameraScanner() }
  root.render(
    <StrictMode>
      <App services={services} updates={startUpdates()} />
    </StrictMode>,
  )
}
