import { contextBridge, ipcRenderer } from 'electron'
import type { AppState, WatchEvent, YaseenDocsApi } from '@shared/types'
import { CH, type Envelope } from '../channels'

/** invoke + unwrap: resolves the value or rejects with the plain `BridgeError` object. */
async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const env = (await ipcRenderer.invoke(channel, ...args)) as Envelope<T>
  if (env.ok) return env.value
  throw env.error
}

const api: YaseenDocsApi = {
  tree: (root) => call(CH.fsTree, root),
  readFile: (path) => call(CH.fsRead, path),
  writeFile: (req) => call(CH.fsWrite, req),
  createDir: (path) => call(CH.fsCreateDir, path),
  createFile: (path) => call(CH.fsCreateFile, path),
  pickFolder: () => call(CH.dialogPickFolder),
  watch: (root, listener) => {
    const id = crypto.randomUUID()
    const onEvent = (_e: unknown, msg: { id: string; ev: WatchEvent }) => {
      if (msg.id === id) listener(msg.ev)
    }
    ipcRenderer.on(CH.watchEvent, onEvent)
    ipcRenderer.send(CH.watchSubscribe, { id, root })
    return () => {
      ipcRenderer.removeListener(CH.watchEvent, onEvent)
      ipcRenderer.send(CH.watchUnsubscribe, id)
    }
  },
  state: {
    get: () => call(CH.stateGet),
    setSettings: (settings) => call(CH.stateSetSettings, settings),
    setSidebarCollapsed: (collapsed) => call(CH.stateSetSidebarCollapsed, collapsed),
    pushRecent: (path) => call(CH.statePushRecent, path),
    setFolder: (root, patch) => call(CH.stateSetFolder, root, patch),
    setFolds: (root, file, keys) => call(CH.stateSetFolds, root, file, [...keys]),
    onChange: (listener) => {
      const on = (_e: unknown, state: AppState) => listener(state)
      ipcRenderer.on(CH.stateChanged, on)
      return () => ipcRenderer.removeListener(CH.stateChanged, on)
    },
  },
  window: {
    identity: () => call(CH.windowIdentity),
    setIdentity: (patch) => call(CH.windowSetIdentity, patch),
    open: (opts) => call(CH.windowOpen, opts),
    duplicate: () => call(CH.windowDuplicate),
  },
}

contextBridge.exposeInMainWorld('yaseenDocs', api)

/** Exported for the completeness test only (the preload is otherwise side-effect driven). */
export { api as bridge }
