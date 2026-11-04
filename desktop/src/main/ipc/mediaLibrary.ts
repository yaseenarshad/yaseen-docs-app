import { MAX_COMPONENT_FRAGMENT_BYTES, type MediaFavoritesRequest, type MediaItem, type MediaUsedRequest } from '@shared/types'
import { normalizeMediaItem } from '@shared/mediaLibrary'
import { CONTRACT } from '@shared/ipc'
import { BridgeFailure } from '../fs/fsUtils'
import { requireRequest, str } from '../fs/validate'
import { createFavoriteCopies, type FavoriteCopies } from '../library/favoriteCopies'
import { followLibraryFolder } from '../library/folder'
import { createMediaStore, type MediaStore } from '../library/mediaStore'
import type { Store } from '../store'
import { broadcastAll } from './broadcast'
import { handle } from './envelope'

/**
 * The `media.*` half of `window.yaseenDocs` (ported from Draw by YAZ-3038) (🔒 YAZ-1775 D4 / D5, YAZ-1817): the library's media store
 * behind the envelope, plus the ONE push. `media:changed` carries no payload — every window
 * re-lists, whichever vault it is on, because the library is the same file for all of them.
 *
 * The store follows `settings.libraryFolder`: a change re-points it and counts as a change of
 * the library (the lists a window shows are different now), so it broadcasts too.
 *
 * The favorites' own copies (YAZ-4363, `library/favoriteCopies.ts`) live beside it and follow the same folder: each
 * change of `media.json` starts a backfill pass (an add, the auto-favorite of a third use, another Mac's file), a
 * removal deletes the copy, and `media:favorite-copies` answers Settings › Images' line. Every kind gets a copy
 * (YAZ-4370); the Add panel reads the elements ones and makes the shapes' ones over three more channels.
 */

/** A renderer's item is validated whole (the web app's validator) or refused; it never reaches the file half-read. */
function requireItem(v: unknown): MediaItem {
  const item = normalizeMediaItem(v)
  if (item === null) throw new BridgeFailure('BAD_REQUEST', "'item' must be a complete media item")
  return item
}

function requireFavoritesRequest(v: unknown): MediaFavoritesRequest {
  const r = requireRequest(v)
  switch (r.op) {
    case 'list':
      return { op: 'list' }
    case 'add':
      return { op: 'add', item: requireItem(r.item) }
    case 'remove':
      return { op: 'remove', itemKey: str(r.itemKey, 'itemKey') }
    default:
      throw new BridgeFailure('BAD_REQUEST', "'op' must be list, add or remove")
  }
}

/** `media:used` (YAZ-4157): the query and the word are plain strings; the rules decide what of them is a word. */
function requireUsedRequest(v: unknown): MediaUsedRequest {
  const r = requireRequest(v)
  switch (r.op) {
    case 'list':
      return { op: 'list' }
    case 'record':
      if (typeof r.query !== 'string') throw new BridgeFailure('BAD_REQUEST', "'query' must be a string")
      return { op: 'record', item: requireItem(r.item), query: r.query }
    case 'add-word':
      return { op: 'add-word', item: requireItem(r.item), word: str(r.word, 'word') }
    case 'remove-word':
      return { op: 'remove-word', itemKey: str(r.itemKey, 'itemKey'), word: str(r.word, 'word') }
    default:
      throw new BridgeFailure('BAD_REQUEST', "'op' must be list, record, add-word or remove-word")
  }
}

export interface MediaLibraryIpcDeps {
  /** This Mac's ID (YAZ-4364): this Mac writes only `media-<macId>.json`. */
  macId: () => Promise<string>
  /** Whether this Mac has a Pixabay key (`secrets.has(PIXABAY_SECRET)`): a Pixabay copy waits until it does. */
  hasPixabayKey?: () => Promise<boolean>
  /** The wait between two copies of a backfill pass; tests make it short. */
  copyIntervalMs?: number
  /** A saved component's file (`componentStore.read`): a component favorite's copy is made from it (YAZ-4370). */
  readComponent?: (slug: string) => Promise<string>
}

export interface MediaLibraryIpc {
  media: MediaStore
  /** Handed to the Image Studio (`registerMediaStudioIpc`), whose providers ask it first and start its backfill. */
  copies: FavoriteCopies
  close(): Promise<void>
}

/** Returns the stores so a test can close the watcher; `main/index.ts` lets the process end take them. */
export function registerMediaLibraryIpc(store: Store, userData: string, deps: MediaLibraryIpcDeps): MediaLibraryIpc {
  const folder = followLibraryFolder(store, userData, (next) => {
    media.setFolder(next)
    copies.setFolder(next)
    broadcastAll(CONTRACT.media.onChanged.channel)
  })
  const media = createMediaStore(folder, { macId: deps.macId })
  const copies = createFavoriteCopies(folder, {
    favorites: () => media.favorites({ op: 'list' }),
    hasPixabayKey: deps.hasPixabayKey ?? (async () => false),
    intervalMs: deps.copyIntervalMs,
    readComponent: deps.readComponent,
  })
  media.onChanged(() => {
    broadcastAll(CONTRACT.media.onChanged.channel)
    void copies.backfill()
  })
  handle(CONTRACT.media.favorites, async (req: unknown) => {
    const request = requireFavoritesRequest(req)
    const list = await media.favorites(request)
    if (request.op === 'remove') await copies.remove(request.itemKey)
    return list
  })
  handle(CONTRACT.media.used, async (req: unknown) => media.used(requireUsedRequest(req)))
  handle(CONTRACT.media.favoriteCopies, async () => copies.status())
  // The elements copies (YAZ-4370): the Add panel reads them for an add, and makes the shapes' ones.
  handle(CONTRACT.media.favoriteElements, async (itemKey: unknown) => copies.readElements(str(itemKey, 'itemKey')))
  handle(CONTRACT.media.saveFavoriteElements, async (req: unknown) => {
    const r = requireRequest(req)
    const fragmentJson = str(r.fragmentJson, 'fragmentJson')
    if (Buffer.byteLength(fragmentJson) > MAX_COMPONENT_FRAGMENT_BYTES) throw new BridgeFailure('TOO_LARGE', 'that copy is over 32 MB')
    return copies.saveElements(str(r.itemKey, 'itemKey'), fragmentJson)
  })
  handle(CONTRACT.media.favoritesForPanel, async () => copies.missingForPanel())
  return {
    media,
    copies,
    close: async () => {
      await copies.close()
      await media.close()
    },
  }
}
