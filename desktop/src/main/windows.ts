/**
 * Which `AppState.windows` entry a renderer belongs to, keyed by `webContents.id`, so IPC
 * handlers can resolve their caller (`window.identity()` etc.). Main registers every window it
 * creates; the registry deliberately knows nothing about Electron beyond the id.
 */

export interface WindowLike {
  webContents: { id: number }
}

export interface WindowRegistry {
  idFor(webContents: { id: number }): string | undefined
}

const byWebContents = new Map<number, string>()

/** Maps `win` to the state entry `id`; returns the unregister function (call it on `closed`). */
export function register(win: WindowLike, id: string): () => void {
  const wcId = win.webContents.id
  byWebContents.set(wcId, id)
  return () => {
    if (byWebContents.get(wcId) === id) byWebContents.delete(wcId)
  }
}

export function idFor(webContents: { id: number }): string | undefined {
  return byWebContents.get(webContents.id)
}
