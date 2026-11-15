import { STATE_ASK, type WorkerState } from './swCore'
import { createUpdates, updateAddress, withoutUpdateMark, type SwContainerLike, type Updates } from './updates'

/**
 * The browser side of the home-screen app, for `main.tsx`. Only the real build has a service worker: not
 * the dev server (`vite`), not the screenshot build (`--mode fixtures`), not the tests.
 */
const enabled = import.meta.env.PROD && import.meta.env.MODE !== 'fixtures'
const container = (): SwContainerLike | undefined => (enabled && 'serviceWorker' in navigator ? (navigator.serviceWorker as unknown as SwContainerLike) : undefined)
/** YAZ-5555: the Restart's load: the worker chooses the new version for it. */
const reload = () => location.replace(updateAddress(location.href))

/**
 * YAZ-5555: the worker's { active, chosen }, asked by a message (the CSP lets the page fetch only GitHub); null with no
 * worker, or from an older worker that does not answer (2 s).
 */
function readState(): Promise<WorkerState | null> {
  const worker = navigator.serviceWorker.controller
  if (worker === null) return Promise.resolve(null)
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    const timer = setTimeout(() => resolve(null), 2000)
    channel.port1.onmessage = (event) => {
      clearTimeout(timer)
      resolve(event.data as WorkerState)
    }
    worker.postMessage({ type: STATE_ASK }, [channel.port2])
  })
}

/** YAZ-5555: after a Restart, the address bar loses the update mark (a later reload is a plain one). */
export function forgetUpdateMark(): void {
  const plain = withoutUpdateMark(location.href)
  if (plain !== null) history.replaceState(history.state, '', plain)
}

/** The worker, registered; and the update the line watches. Null: no service worker here. */
export function startUpdates(): Updates | null {
  const c = container()
  if (!c) return null
  const updates = createUpdates({ container: c, reload, now: Date.now, readState })
  void updates.start()
  return updates
}
