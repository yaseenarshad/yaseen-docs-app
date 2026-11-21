import type { BridgeError, FriendsSendView } from '@shared/types'
import type { FriendsBoardPayload } from '@shared/friendsApi'
import { type Bridge, CONTRACT, isLeaf, type YaseenDocsApi } from '@shared/ipc'

// The error class moved to its own file (YAZ-5161), so code the phone shares can test for it with no bridge.
import { BridgeRequestError } from './bridgeError'
export { BridgeRequestError }

function isBridgeError(err: unknown): err is BridgeError {
  return typeof err === 'object' && err !== null && typeof (err as BridgeError).code === 'string' && typeof (err as BridgeError).message === 'string'
}

/** The bridge rejects with a plain `BridgeError` object (no prototype survives IPC); give it a class. */
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (isBridgeError(err)) throw new BridgeRequestError(err.code, err.message, err.mtime, err.path)
    throw new BridgeRequestError('IO_ERROR', err instanceof Error ? err.message : String(err))
  }
}

type Fns = Record<string, (...args: unknown[]) => unknown>

/**
 * `window.yaseenDocs` in `CONTRACT`'s shape (YAZ-2131 🔒 D9), looked up at call time: an invoke
 * rejects with a `BridgeRequestError`, a push subscribes as it is.
 */
function wrap(table: object, at: string[]): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(table).map(([key, v]) => {
      if (!isLeaf(v)) return [key, wrap(v, [...at, key])]
      const host = () => at.reduce<Fns>((o, k) => o[k] as unknown as Fns, window.yaseenDocs as unknown as Fns)
      return [key, v.kind === 'invoke' ? (...args: unknown[]) => call(async () => host()[key](...args)) : (listener: unknown) => host()[key](listener)]
    }),
  )
}

const bridge = wrap(CONTRACT, []) as Bridge<typeof CONTRACT>

export interface FriendsApi {
  status: () => Promise<FriendsSendView>
  board: (force?: boolean) => Promise<{ ok: true; board: FriendsBoardPayload } | { ok: false; error: string }>
  updatePrefs: (prefs: { vaults?: string[]; zone?: string | null; nickname?: string | null }) => Promise<{ ok: true; vaults: string[]; zone: string | null; nickname: string | null } | { ok: false; error: string }>
  createInvite: () => Promise<{ ok: true; code: string; link: string; expiresAt: string } | { ok: false; error: string }>
  acceptInvite: (code: string) => Promise<{ ok: true; result: unknown } | { ok: false; error: string }>
  removeFriend: (userId: number, block?: boolean) => Promise<{ ok: true } | { ok: false; error: string }>
  sendMark: (toUserId: number, kind: 'cheer' | 'nudge', message?: string) => Promise<{ ok: true } | { ok: false; error: string }>
  markSeen: (fromUserIds?: number[]) => Promise<{ ok: true } | { ok: false; error: string }>
  createGroup: (name: string) => Promise<{ ok: true; id: string; name: string; inviteCode: string; link: string } | { ok: false; error: string }>
  approveMember: (groupId: string, userId: number) => Promise<{ ok: true } | { ok: false; error: string }>
  removeMember: (groupId: string, userId?: number) => Promise<{ ok: true; deleted?: boolean } | { ok: false; error: string }>
  rotateGroupInvite: (groupId: string) => Promise<{ ok: true; inviteCode: string; link: string } | { ok: false; error: string }>
  shareCards: (input: { groupId?: string; toUserIds?: number[]; folderName?: string; cards: { title: string; markdown: string; note?: string | null }[] }) => Promise<{ ok: true; count: number } | { ok: false; error: string }>
  setCardState: (cardId: string, status: 'pending' | 'accepted' | 'dismissed') => Promise<{ ok: true } | { ok: false; error: string }>
  setFolderState: (folderId: string, status: 'pending' | 'accepted' | 'dismissed') => Promise<{ ok: true } | { ok: false; error: string }>
  deleteSharedCard: (cardId: string) => Promise<{ ok: true } | { ok: false; error: string }>
  importCards: (input: { root: string; dir: string; cards: { id: string; title: string; markdown: string; senderLogin: string; upNext?: boolean }[]; createFolder?: string }) => Promise<{ ok: true; paths: string[] } | { ok: false; error: string }>
  deleteMe: () => Promise<{ ok: true } | { ok: false; error: string }>
  onInviteLink: (cb: (payload: { kind: 'friend' | 'group'; code: string }) => void) => () => void
}

const friendsBridge = (): FriendsApi => (window.yaseenDocs as unknown as { friends: FriendsApi }).friends

const friendsApi: FriendsApi = {
  status: () => call(() => friendsBridge().status()),
  board: (force) => call(() => friendsBridge().board(force)),
  updatePrefs: (prefs) => call(() => friendsBridge().updatePrefs(prefs)),
  createInvite: () => call(() => friendsBridge().createInvite()),
  acceptInvite: (code) => call(() => friendsBridge().acceptInvite(code)),
  removeFriend: (userId, block) => call(() => friendsBridge().removeFriend(userId, block)),
  sendMark: (toUserId, kind, message) => call(() => friendsBridge().sendMark(toUserId, kind, message)),
  markSeen: (fromUserIds) => call(() => friendsBridge().markSeen(fromUserIds)),
  createGroup: (name) => call(() => friendsBridge().createGroup(name)),
  approveMember: (groupId, userId) => call(() => friendsBridge().approveMember(groupId, userId)),
  removeMember: (groupId, userId) => call(() => friendsBridge().removeMember(groupId, userId)),
  rotateGroupInvite: (groupId) => call(() => friendsBridge().rotateGroupInvite(groupId)),
  shareCards: (input) => call(() => friendsBridge().shareCards(input)),
  setCardState: (cardId, status) => call(() => friendsBridge().setCardState(cardId, status)),
  setFolderState: (folderId, status) => call(() => friendsBridge().setFolderState(folderId, status)),
  deleteSharedCard: (cardId) => call(() => friendsBridge().deleteSharedCard(cardId)),
  importCards: (input) => call(() => friendsBridge().importCards(input)),
  deleteMe: () => call(() => friendsBridge().deleteMe()),
  onInviteLink: (cb) => {
    const fn = friendsBridge()?.onInviteLink
    return typeof fn === 'function' ? fn(cb) : () => undefined
  },
}

/**
 * The renderer's one door to main: every call to `window.yaseenDocs` goes through here, the specials
 * passed through as they are — except the editors' Copy as / Paste as subscriptions, which reach
 * `window.yaseenDocs` with `?.`; `menu.onCopyAs/onPasteAs` stay here because `YaseenDocsApi`
 * requires them.
 */
export const api: Omit<YaseenDocsApi, 'friends'> & { friends: FriendsApi } = {
  ...bridge,
  friends: friendsApi,
  watch: (root, listener) => window.yaseenDocs.watch(root, listener),
  window: { ...bridge.window, onFlush: (listener) => window.yaseenDocs.window.onFlush(listener), onViews: (listener) => window.yaseenDocs.window.onViews(listener), onTabs: (listener) => window.yaseenDocs.window.onTabs(listener) },
  file: { ...bridge.file, pathFor: (file) => window.yaseenDocs.file.pathFor(file) },
  menu: {
    ...bridge.menu,
    onCopyAs: (listener) => window.yaseenDocs.menu.onCopyAs(listener),
    onPasteAs: (listener) => window.yaseenDocs.menu.onPasteAs(listener),
    edit: (action, arg) => window.yaseenDocs.menu.edit(action, arg),
  },
  spell: { suggestions: (word) => window.yaseenDocs.spell.suggestions(word) },
}
