import { StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { App, NoStorage } from './App'
import { localFriends } from './app/friendsPort'
import { standInSync } from './app/syncPort'
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
  // WIRE 3B (YAZ-5072): replace `standInSync()` with `createSyncEngine({ store, tokens })`, and call
  // `followPage(engine)` once. WIRE 4E (YAZ-5081): replace `localFriends(store)` with Friends' own `FriendsPort`.
  const services = { store, tokens, sync: standInSync(), friends: localFriends(store), scanner: cameraScanner() }
  root.render(
    <StrictMode>
      <App services={services} />
    </StrictMode>,
  )
}
