import { contextBridge, ipcRenderer } from 'electron'
import type { AppState, FileDeletedEvent, FileRenamedEvent, RegistryResponse, VaultConfigChange, WatchEvent, YaseenDocsApi } from '@shared/types'
import { CH, type Envelope } from '../channels'

/** invoke + unwrap: resolves the value or rejects with the plain `BridgeError` object. */
async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const env = (await ipcRenderer.invoke(channel, ...args)) as Envelope<T>
  if (env.ok) return env.value
  throw env.error
}

/** One main→renderer push channel as a subscribe function: `on(listener)` returns the unsubscribe. */
function on<T>(channel: string): (listener: (payload: T) => void) => () => void {
  return (listener) => {
    const handler = (_e: unknown, payload: T) => listener(payload)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  }
}

/**
 * The close/quit flush handshake (GRO-2160): main sends `app:flush` and holds the window until
 * `app:flushed` comes back. Every registered listener is awaited (none registered — e.g. the
 * Welcome window — acks at once); a rejection still acks, main's 5s cap is the only other out.
 */
const flushListeners = new Set<() => Promise<void> | void>()
ipcRenderer.on(CH.appFlush, () => {
  void Promise.allSettled([...flushListeners].map(async (listener) => listener())).then(() => ipcRenderer.send(CH.appFlushed))
})

const api: YaseenDocsApi = {
  tree: (root) => call(CH.fsTree, root),
  readFile: (path) => call(CH.fsRead, path),
  writeFile: (req) => call(CH.fsWrite, req),
  createDir: (path) => call(CH.fsCreateDir, path),
  createFile: (req) => call(CH.fsCreateFile, req),
  index: (root) => call(CH.fsIndex, root),
  // The cold-start reconcile diff (Links E1c, GRO-2242): read AFTER the first index(root).
  coldDiff: (root) => call(CH.fsColdDiff, root),
  readAsset: (root, ref) => call(CH.fsReadAsset, root, ref),
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
    removeRecent: (path) => call(CH.stateRemoveRecent, path),
    setFolder: (root, patch) => call(CH.stateSetFolder, root, patch),
    setFolds: (root, file, keys) => call(CH.stateSetFolds, root, file, [...keys]),
    setBaseGroups: (root, key, collapsed) => call(CH.stateSetBaseGroups, root, key, [...collapsed]),
    onChange: on<AppState>(CH.stateChanged),
  },
  window: {
    identity: () => call(CH.windowIdentity),
    setIdentity: (patch) => call(CH.windowSetIdentity, patch),
    open: (opts) => call(CH.windowOpen, opts),
    duplicate: () => call(CH.windowDuplicate),
    closeSelf: () => call(CH.windowCloseSelf),
    onFlush: (listener) => {
      flushListeners.add(listener)
      return () => {
        flushListeners.delete(listener)
      }
    },
  },
  // Menu gestures (GRO-2161; tabs GRO-2232): main sends these to the focused window only.
  menu: {
    onOpenFolder: on<void>(CH.menuOpenFolder),
    onOpenRoot: on<string>(CH.menuOpenRoot),
    onCloseTab: on<void>(CH.menuCloseTab),
    onNextTab: on<void>(CH.menuNextTab),
    onPrevTab: on<void>(CH.menuPrevTab),
  },
  // Deep links (E1, GRO-2171): main routes a yaseendocs:// URL to the best window.
  link: {
    onOpenFile: on<string>(CH.linkOpenFile),
    onNotice: on<string>(CH.linkNotice),
  },
  // In-app rename (Links E1, GRO-2194) + external-rename repair (E1c, GRO-2242): the invokes
  // plus the renamed push every window gets (repair reuses the SAME push downstream).
  // In-app delete (GRO-2272) rides the same shape: one invoke, one push to every window.
  file: {
    rename: (req) => call(CH.fsRename, req),
    repairRename: (req) => call(CH.fileRepairRename, req),
    onRenamed: on<FileRenamedEvent>(CH.fileRenamed),
    delete: (req) => call(CH.fsDelete, req),
    onDeleted: on<FileDeletedEvent>(CH.fileDeleted),
  },
  // OS-level actions (GRO-2274): reveal in the system file manager.
  shell: {
    reveal: (req) => call(CH.shellReveal, req),
  },
  // Type & property registry over `.yaseendocs/types.json` (Bible A, GRO-2201).
  registry: {
    get: (root) => call(CH.registryGet, root),
    setType: (root, name, def) => call(CH.registrySetType, root, name, def),
    removeType: (root, name) => call(CH.registryRemoveType, root, name),
    setProperty: (root, scope, name, def) => call(CH.registrySetProperty, root, scope, name, def),
    removeProperty: (root, scope, name) => call(CH.registryRemoveProperty, root, scope, name),
    onChange: (listener) => {
      const on = (_e: unknown, msg: { root: string; registry: RegistryResponse }) => listener(msg.registry)
      ipcRenderer.on(CH.registryChanged, on)
      return () => ipcRenderer.removeListener(CH.registryChanged, on)
    },
  },
  // Vault-local config in `<root>/.yaseendocs/` (Desktop J, GRO-2188).
  vaultConfig: {
    read: (root, name) => call(CH.vaultConfigRead, root, name),
    write: (root, name, value) => call(CH.vaultConfigWrite, root, name, value),
    onChange: on<VaultConfigChange>(CH.vaultConfigChanged),
  },
}

contextBridge.exposeInMainWorld('yaseenDocs', api)

/** Exported for the completeness test only (the preload is otherwise side-effect driven). */
export { api as bridge }
