import { contextBridge, ipcRenderer } from 'electron'
import type { ClipboardPasteRequest, PropertiesResponse, WatchEvent } from '@shared/types'
import { type Bridge, CONTRACT, type Envelope, isLeaf, SPECIAL, type YaseenDocsApi } from '@shared/ipc'

/** invoke + unwrap: resolves the value or rejects with the plain `BridgeError` object. */
async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const env = (await ipcRenderer.invoke(channel, ...args)) as Envelope<T>
  if (env.ok) return env.value
  throw env.error
}

/**
 * One invoke door as a function of its declared arity, forwarding exactly that many arguments, and
 * reporting it as `length`, as the hand-written functions did (surface.test.ts pins `/N`).
 */
function invoker(channel: string, arity: number): (...args: unknown[]) => Promise<unknown> {
  const fn = (...args: unknown[]) => call(channel, ...Array.from({ length: arity }, (_, i) => args[i]))
  return Object.defineProperty(fn, 'length', { value: arity })
}

/** One main→renderer push channel as a subscribe function: `on(listener)` returns the unsubscribe. */
const subscriber = (channel: string) => (listener: (payload: unknown) => void) => {
  const handler = (_e: unknown, payload: unknown) => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

/** The table's shape with each leaf turned into its function (YAZ-2131 🔒 D9): only its channels exist. */
function buildBridge(table: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(table).map(([key, v]) => [key, isLeaf(v) ? (v.kind === 'invoke' ? invoker(v.channel, v.arity) : subscriber(v.channel)) : buildBridge(v as object)]))
}

/**
 * The close/quit flush handshake (GRO-2160): main sends `app:flush` and holds the window until
 * `app:flushed` comes back. Every registered listener is awaited (none registered — e.g. the
 * Welcome window — acks at once); a rejection still acks, main's 5s cap is the only other out.
 */
const flushListeners = new Set<() => Promise<void> | void>()
ipcRenderer.on(SPECIAL.appFlush, () => {
  void Promise.allSettled([...flushListeners].map(async (listener) => listener())).then(() => ipcRenderer.send(SPECIAL.appFlushed))
})

// Each editor claims only its own focused surface. Ordinary inputs retain native insertion.
const pasteListeners = new Set<(request: ClipboardPasteRequest) => boolean>()
ipcRenderer.on(SPECIAL.menuPasteAs, (_event, request: ClipboardPasteRequest) => {
  for (const listener of pasteListeners) if (listener(request)) return
  void call<void>(SPECIAL.menuPasteTextFallback.channel, request.text).catch((error: unknown) => console.error('Paste failed', error))
})

/** DOM-only fallback for ordinary controls; editor subscribers own ProseMirror and CodeMirror selections. */
function selectedNativeText(): string {
  const active = document.activeElement
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    if (active instanceof HTMLInputElement && active.type === 'password') return ''
    const { selectionStart: start, selectionEnd: end } = active
    return start === null || end === null || start === end ? '' : active.value.slice(start, end)
  }
  const selection = document.getSelection()
  if (!selection || selection.isCollapsed || !selection.anchorNode || !selection.focusNode) return ''
  // A focused button or other surface must not copy a stale selection left in another editor.
  if (active && (!active.contains(selection.anchorNode) || !active.contains(selection.focusNode))) return ''
  return selection.toString()
}

// No clipboard API crosses contextBridge: only a main-process menu gesture can initiate this path.
const copyListeners = new Set<(mode: 'plain' | 'markdown') => string | undefined>()
ipcRenderer.on(SPECIAL.menuCopyAs, (_event, mode: unknown) => {
  if (mode !== 'plain' && mode !== 'markdown') return
  let text: string | undefined
  for (const listener of copyListeners) {
    const selected = listener(mode)
    if (typeof selected === 'string') {
      text = selected
      break
    }
  }
  text ??= selectedNativeText()
  if (text !== '') void call<void>(SPECIAL.menuCopyText.channel, text).catch((error: unknown) => console.error('Copy failed', error))
})

/** Adds `listener` to `set`; returns its removal. */
const listen = <L>(set: Set<L>, listener: L) => {
  set.add(listener)
  return () => {
    set.delete(listener)
  }
}

// The compiler cannot see through `buildBridge`, so this cast is unchecked; surface.test.ts pins the
// result byte for byte. Only the table's doors are claimed, so the literal below must supply every
// special or it does not compile.
const generated = buildBridge(CONTRACT) as Bridge<typeof CONTRACT>
const api: YaseenDocsApi = {
  ...generated,
  watch: (root, listener) => {
    const id = crypto.randomUUID()
    const onEvent = (_e: unknown, msg: { id: string; ev: WatchEvent }) => {
      if (msg.id === id) listener(msg.ev)
    }
    ipcRenderer.on(SPECIAL.watchEvent, onEvent)
    ipcRenderer.send(SPECIAL.watchSubscribe, { id, root })
    return () => {
      ipcRenderer.removeListener(SPECIAL.watchEvent, onEvent)
      ipcRenderer.send(SPECIAL.watchUnsubscribe, id)
    }
  },
  state: {
    ...generated.state,
    // Copies, as the hand-written bridge always sent.
    setFolds: (root, file, keys) => call(CONTRACT.state.setFolds.channel, root, file, [...keys]),
    setBaseGroups: (root, key, collapsed) => call(CONTRACT.state.setBaseGroups.channel, root, key, [...collapsed]),
  },
  window: { ...generated.window, onFlush: (listener) => listen(flushListeners, listener) },
  menu: {
    ...generated.menu,
    onCopyAs: (listener) => listen(copyListeners, listener),
    onPasteAs: (listener) => listen(pasteListeners, listener),
  },
  properties: {
    ...generated.properties,
    // Main sends `{ root, properties }`; a listener gets the declarations.
    onChange: (listener) => {
      const on = (_e: unknown, msg: { root: string; properties: PropertiesResponse }) => listener(msg.properties)
      ipcRenderer.on(CONTRACT.properties.onChange.channel, on)
      return () => ipcRenderer.removeListener(CONTRACT.properties.onChange.channel, on)
    },
  },
}

contextBridge.exposeInMainWorld('yaseenDocs', api)

/** Exported for the preload's own tests (the preload is otherwise side-effect driven). */
export { api as bridge }
