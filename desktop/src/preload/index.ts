import { contextBridge, ipcRenderer } from 'electron'
import type { AppState, FileDeletedEvent, FileRenamedEvent, GithubSyncStatus, PropertiesResponse, VaultConfigChange, WatchEvent, YaseenDocsApi } from '@shared/types'
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
  writeAsset: (req) => call(CH.fsWriteAsset, req),
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
    setSidebarWidth: (width) => call(CH.stateSetSidebarWidth, width),
    setSidebarLens: (lens) => call(CH.stateSetSidebarLens, lens),
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
    onSearch: on<void>(CH.menuSearch),
    onToggleSidebar: on<void>(CH.menuToggleSidebar),
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
  // OS-level actions: reveal in the system file manager (GRO-2274), open in VS Code (YAZ-963).
  shell: {
    reveal: (req) => call(CH.shellReveal, req),
    openVsCode: (req) => call(CH.shellOpenVsCode, req),
  },
  // Vault-wide property declarations over `.yaseendocs/properties.json` (YAZ-835).
  properties: {
    get: (root) => call(CH.propertiesGet, root),
    setProperty: (root, name, def) => call(CH.propertiesSetProperty, root, name, def),
    removeProperty: (root, name) => call(CH.propertiesRemoveProperty, root, name),
    onChange: (listener) => {
      const on = (_e: unknown, msg: { root: string; properties: PropertiesResponse }) => listener(msg.properties)
      ipcRenderer.on(CH.propertiesChanged, on)
      return () => ipcRenderer.removeListener(CH.propertiesChanged, on)
    },
  },
  // Vault-local config in `<root>/.yaseendocs/` (Desktop J, GRO-2188).
  vaultConfig: {
    read: (root, name) => call(CH.vaultConfigRead, root, name),
    write: (root, name, value) => call(CH.vaultConfigWrite, root, name, value),
    onChange: on<VaultConfigChange>(CH.vaultConfigChanged),
  },
  // Per-vault GitHub sync over `.yaseendocs/github.json` (YAZ-1081); every window gets every status.
  github: {
    status: (root) => call(CH.githubStatus, root),
    syncNow: (root) => call(CH.githubSyncNow, root),
    setEnabled: (root, enabled) => call(CH.githubSetEnabled, root, enabled),
    onStatus: on<GithubSyncStatus>(CH.githubStatusChanged),
  },
}

contextBridge.exposeInMainWorld('yaseenDocs', api)

/** Exported for the completeness test only (the preload is otherwise side-effect driven). */
export { api as bridge }
