import { ipcMain, type IpcMainEvent } from 'electron'
import type { WatchEvent } from '@shared/types'
import { SPECIAL } from '@shared/ipc'
import { requireAbsPath, requireDir, toBridgeFailure } from '../fs/fsUtils'
import { subscribe } from '../fs/watchers'

/** Live subscriptions per renderer (`webContents.id`) → subscription id → unsubscribe. */
const bySender = new Map<number, Map<string, () => void>>()
/**
 * Subscribe ids still checking their root, per sender. An unsubscribe in that gap (a quick vault
 * switch) drops the id here, so the late subscribe registers nothing instead of keeping the old
 * vault's watcher alive for the window's life (YAZ-2178).
 */
const pending = new Map<number, Set<string>>()
/** Senders whose `destroyed` and navigation hooks are on: one set of hooks per renderer, however often it subscribes. */
const hooked = new Set<number>()

/**
 * `window.yaseenDocs.watch(root, listener)`: the preload sends `{ id, root }`, main answers every
 * event as `watch:event { id, ev }` on that sender. One watcher per root (see `fs/watchers.ts`)
 * no matter how many windows or subscriptions; a window going away, or its page reloading, drops
 * all of its subscriptions.
 */
export function registerWatchIpc(): void {
  ipcMain.on(SPECIAL.watchSubscribe, (e, msg: unknown) => onSubscribe(e, msg))
  ipcMain.on(SPECIAL.watchUnsubscribe, (e, id: unknown) => onUnsubscribe(e, id))
}

async function onSubscribe(e: IpcMainEvent, msg: unknown): Promise<void> {
  if (typeof msg !== 'object' || msg === null) return
  const { id, root } = msg as Record<string, unknown>
  if (typeof id !== 'string') return
  const { sender } = e
  hook(sender)
  // A watcher event can land between the window closing and its `destroyed` hook running.
  const send = (ev: WatchEvent) => {
    if (!sender.isDestroyed()) sender.send(SPECIAL.watchEvent, { id, ev })
  }
  let checking = pending.get(sender.id)
  if (checking === undefined) pending.set(sender.id, (checking = new Set()))
  checking.add(id)
  let dir: string
  try {
    dir = requireAbsPath(root, 'root')
    await requireDir(dir)
  } catch (err) {
    // A bad root is the whole answer: one error event, no subscription.
    if (settle(sender.id, id)) send({ type: 'error', message: toBridgeFailure(err, String(root)).message })
    return
  }
  if (!settle(sender.id, id) || sender.isDestroyed()) return
  let subs = bySender.get(sender.id)
  if (subs === undefined) bySender.set(sender.id, (subs = new Map()))
  subs.set(id, subscribe(dir, send))
}

/**
 * Drops everything `sender` holds when it goes away, AND when its page goes (YAZ-3737: ⌘R, a crash, HMR's
 * full reload keep the same `webContents`, so `destroyed` alone left the old page's watchers alive until the
 * window closed). A root check still running is dropped too, so its late subscribe registers nothing.
 */
function hook(sender: IpcMainEvent['sender']): void {
  const senderId = sender.id
  if (hooked.has(senderId)) return
  hooked.add(senderId)
  const drop = (): void => {
    bySender.get(senderId)?.forEach((off) => off())
    bySender.delete(senderId)
    pending.delete(senderId)
  }
  sender.once('destroyed', () => {
    hooked.delete(senderId)
    drop()
  })
  sender.on('did-start-navigation', (details: { isMainFrame?: boolean; isSameDocument?: boolean }) => {
    if (details?.isMainFrame && !details.isSameDocument) drop()
  })
}

/** Ends `id`'s root check; false when it was unsubscribed meanwhile. */
function settle(senderId: number, id: string): boolean {
  const checking = pending.get(senderId)
  const live = checking?.delete(id) === true
  if (checking?.size === 0) pending.delete(senderId)
  return live
}

function onUnsubscribe(e: IpcMainEvent, id: unknown): void {
  if (typeof id !== 'string') return
  if (pending.get(e.sender.id)?.delete(id)) return
  const subs = bySender.get(e.sender.id)
  const off = subs?.get(id)
  if (subs === undefined || off === undefined) return
  subs.delete(id)
  off()
}
