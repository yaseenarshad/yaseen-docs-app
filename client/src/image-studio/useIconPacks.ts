/**
 * THE ICON PACKS' STATUS IN A RENDERER (YAZ-4359): what `media.packs` says now, kept true by `media:packs-progress`.
 * The Add panel's footer, its offline line and the Settings row read the SAME store, so the three never disagree, and a
 * download that one window started shows its progress in every window.
 *
 * Module scope, like the Add tab's session: the panel unmounts on close, and a download goes on without it. The first
 * reader asks main once; a bridge that cannot answer leaves it null, and every reader then shows nothing about packs.
 */
import { useSyncExternalStore } from 'react'
import type { IconPacksRequest, IconPacksStatus } from '@shared/iconPacks'
import { api } from '../api'
import { createStore } from '../lib/store'

const packsStore = createStore<{ status: IconPacksStatus | null }>({ status: null })
let following: (() => void) | null = null

/**
 * The request that a failure in the status is about, so "Try again" repeats it (YAZ-4366 audit 65): the last one this
 * window sent, or the run that main reported (a Check from Settings, a download from another window). A folder move
 * comes from Settings › Choose a folder…, so it has no Try again here.
 */
type PacksRequest = Exclude<IconPacksRequest['op'], 'status'> | 'move'
let lastRequest: PacksRequest = 'download'
const RUN_REQUEST: Partial<Record<IconPacksStatus['state'], PacksRequest>> = { downloading: 'download', checking: 'check', removing: 'remove', moving: 'move' }

function take(status: IconPacksStatus) {
  lastRequest = RUN_REQUEST[status.state] ?? lastRequest
  packsStore.set({ status })
}

function follow() {
  if (following !== null) return
  try {
    following = api.media.onPacksProgress(take)
  } catch {
    following = () => undefined
  }
  void api.media
    .packs({ op: 'status' })
    .then(take)
    .catch(() => undefined)
}

/** A test starts with no status and no listener. */
export function resetIconPacks() {
  following?.()
  following = null
  lastRequest = 'download'
  packsStore.set({ status: null })
}

/** The status now, or null before main answered (or with no bridge). */
export function useIconPacks(): IconPacksStatus | null {
  follow()
  return useSyncExternalStore(packsStore.subscribe, () => packsStore.getState().status)
}

/** The request that "Try again" repeats, or null when it is not one this panel can send (a folder move). */
export const failedRequest = (): Exclude<IconPacksRequest['op'], 'status'> | null => (lastRequest === 'move' ? null : lastRequest)

/** One verb; the answer is the new status (the progress push says the same, a moment earlier or later). */
export async function packsDo(op: IconPacksRequest['op']): Promise<IconPacksStatus | null> {
  if (op !== 'status') lastRequest = op
  try {
    const status = await api.media.packs({ op })
    take(status)
    return status
  } catch (err) {
    // YAZ-4348 demo: a request that fails says so where the user clicked, instead of nothing at all
    console.warn('[icon-packs]', op, 'failed', err)
    const now = packsStore.getState().status
    if (now !== null) packsStore.set({ status: { ...now, failed: true, message: op === 'download' ? "The download couldn't start. Try again." : "That didn't work. Try again." } })
    return null
  }
}
