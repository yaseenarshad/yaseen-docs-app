/**
 * THE ICON PACKS' STATUS IN A RENDERER (YAZ-4359): what `media.packs` says now, kept true by `media:packs-progress`.
 * The Add panel's line, its offline line and the Settings row read the SAME store, so the three never disagree, and a
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

function follow() {
  if (following !== null) return
  try {
    following = api.media.onPacksProgress((status) => packsStore.set({ status }))
  } catch {
    following = () => undefined
  }
  void api.media
    .packs({ op: 'status' })
    .then((status) => packsStore.set({ status }))
    .catch(() => undefined)
}

/** A test starts with no status and no listener. */
export function resetIconPacks() {
  following?.()
  following = null
  packsStore.set({ status: null })
}

/** The status now, or null before main answered (or with no bridge). */
export function useIconPacks(): IconPacksStatus | null {
  follow()
  return useSyncExternalStore(packsStore.subscribe, () => packsStore.getState().status)
}

/** The packs' status, read once (outside React). */
export const iconPacksNow = (): IconPacksStatus | null => packsStore.getState().status

/** One verb; the answer is the new status (the progress push says the same, a moment earlier or later). */
export async function packsDo(op: IconPacksRequest['op']): Promise<IconPacksStatus | null> {
  try {
    const status = await api.media.packs({ op })
    packsStore.set({ status })
    return status
  } catch {
    return null
  }
}
