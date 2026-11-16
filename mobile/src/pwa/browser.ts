import { STATE_ASK, VERSION_ASK, type ServedVersion, type WorkerState } from './swCore'
import { createUpdates, updateAddress, withoutUpdateMark, type SwContainerLike, type Updates } from './updates'

/**
 * The browser side of the home-screen app, for `main.tsx`. Only the real build has a service worker: not
 * the dev server (`vite`), not the screenshot build (`--mode fixtures`), not the tests.
 */
/** YAZ-5593: this build's commit, as `/version.txt` names it (Vite's define; `settings/buildInfo.ts` is not in the first load). */
declare const __NOTECARDS_COMMIT__: string | undefined
const COMMIT = typeof __NOTECARDS_COMMIT__ === 'string' ? __NOTECARDS_COMMIT__ : ''
const enabled = import.meta.env.PROD && import.meta.env.MODE !== 'fixtures'
const container = (): SwContainerLike | undefined => (enabled && 'serviceWorker' in navigator ? (navigator.serviceWorker as unknown as SwContainerLike) : undefined)
/** YAZ-5555: the Restart's load: the worker chooses the new version for it. */
const reload = () => location.replace(updateAddress(location.href))

/**
 * A question to the worker, by a message with a port for the answer (the CSP lets the page fetch only GitHub); null
 * with no worker, or from a worker that does not answer in `ms`.
 */
function askWorker<T>(type: string, ms: number): Promise<T | null> {
  const worker = navigator.serviceWorker.controller
  if (worker === null) return Promise.resolve(null)
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    const timer = setTimeout(() => resolve(null), ms)
    channel.port1.onmessage = (event) => {
      clearTimeout(timer)
      resolve(event.data as T | null)
    }
    worker.postMessage({ type }, [channel.port2])
  })
}

/** YAZ-5555: the worker's { active, chosen }; null from an older worker that does not answer (2 s). */
const readState = () => askWorker<WorkerState>(STATE_ASK, 2000)
/** YAZ-5593: what the host serves now (the worker reads `/version.txt` with no cache); null when it cannot say (15 s). */
const askServed = () => askWorker<ServedVersion>(VERSION_ASK, 15_000)

/** YAZ-5555: after a Restart, the address bar loses the update mark (a later reload is a plain one). */
export function forgetUpdateMark(): void {
  const plain = withoutUpdateMark(location.href)
  if (plain !== null) history.replaceState(history.state, '', plain)
}

/** The worker, registered; and the update the line watches. Null: no service worker here. */
export function startUpdates(): Updates | null {
  const c = container()
  if (!c) return null
  const updates = createUpdates({ container: c, reload, now: Date.now, readState, askServed, commit: COMMIT })
  void updates.start()
  return updates
}
