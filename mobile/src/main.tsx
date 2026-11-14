import { StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { App, NoStorage } from './App'
import { localFriends } from './app/friendsPort'
import { lazySync } from './app/lazySync'
import { cameraScanner } from './scan/camera'
import { openPhoneStorage } from './store'
import './styles.css'

const root = createRoot(document.getElementById('root')!)

// The screen fixtures (made-up data, for the screenshots) exist only in a `--mode fixtures` build. In the real build
// this test is `false` at build time, so the fixture code is not in the bundle.
if (import.meta.env.MODE === 'fixtures' && location.hash.startsWith('#fixture')) void import('./dev/fixtures').then((m) => m.mountFixture(root, location.hash))
else void start(root)

async function start(root: Root) {
  let storage: Awaited<ReturnType<typeof openPhoneStorage>>
  try {
    storage = await openPhoneStorage()
  } catch {
    root.render(<NoStorage />)
    return
  }
  const { store, tokens } = storage
  // 3B's engine (YAZ-5072), loaded when a vault opens. WIRE 4E (YAZ-5081): replace `localFriends(store)` with
  // Friends' own `FriendsPort`. WIRE 3D (YAZ-5074): pass its `MediaAhead` as `media` (the reader's `PageMedia`); until
  // then the reader shows only the pictures and files that are on the phone (`storedMedia`).
  const services = { store, tokens, sync: lazySync(store, tokens), friends: localFriends(store), scanner: cameraScanner() }
  root.render(
    <StrictMode>
      <App services={services} />
    </StrictMode>,
  )
}
