/**
 * THE IMAGE STUDIO'S THREE DOORS (🔒 YAZ-1775 D4, YAZ-1818): `media:search`, `media:preview`,
 * `media:import`. The guard layer only — every decision is `main/media/`'s, every request is
 * validated whole here first, because a sandboxed renderer's arguments are input.
 *
 * WHY THE SECRETS INSTANCE IS PASSED IN: `registerSecretsIpc` owns `userData/secrets.json` and
 * returns the one object that can `read` it. Threading it here is what lets the providers build a
 * Pixabay request without the key ever existing outside main (🔒 YAZ-1775 D4). A second `createSecrets`
 * would be a second writer to the same file.
 *
 * THE CACHE IS SWEPT ONCE, AT REGISTRATION, DETACHED. `<userData>/media-cache/` is bounded by age
 * and nothing else, so the moment the app starts is exactly when yesterday's entries should go —
 * and the first search must not wait for a `readdir` of it.
 */
import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { isMediaBytesProvider, isMediaSearchSource, PIXABAY_SECRET, type MediaBytesRequest, type MediaDrawingRequest, type MediaSearchRequest } from '@shared/types'
import { CONTRACT } from '@shared/ipc'
import { isMediaFilters, type IconPacksRequest, type MediaFilters } from '@shared/iconPacks'
import { BridgeFailure } from '../fs/fsUtils'
import { requireRequest, str, strOrNull } from '../fs/validate'
import { createMediaCache } from '../media/cache'
import { MEDIA_CACHE_DIR } from '../media/cachePolicy'
import { createMediaProviders } from '../media/providers'
import { createIconPacks, resolveIconPacksFolder } from '../media/iconPacks'
import type { FavoriteCopies } from '../library/favoriteCopies'
import type { Store } from '../store'
import { broadcastAll } from './broadcast'
import type { Secrets } from '../secrets'
import { handle } from './envelope'

function requireSearchRequest(v: unknown): MediaSearchRequest {
  const r = requireRequest(v)
  if (typeof r.q !== 'string') throw new BridgeFailure('BAD_REQUEST', "'q' must be a string")
  if (!isMediaSearchSource(r.source)) throw new BridgeFailure('BAD_REQUEST', "'source' must be all, iconify or pixabay")
  // YAZ-4360: the filters are checked whole; a bad one is a bad request, never a silent "no filter".
  if (r.filters !== undefined && !isMediaFilters(r.filters)) throw new BridgeFailure('BAD_REQUEST', "'filters' is not a filter set")
  const req: MediaSearchRequest = { q: r.q, source: r.source, cursor: r.cursor === undefined ? null : strOrNull(r.cursor, 'cursor') }
  if (r.filters !== undefined) req.filters = r.filters as MediaFilters
  return req
}

function requireBytesRequest(v: unknown): MediaBytesRequest {
  const r = requireRequest(v)
  // `shape` is deliberately not one of these: a shape is drawn by the renderer from its own
  // catalog and has no bytes to fetch (🔒 YAZ-1775 D4).
  if (!isMediaBytesProvider(r.provider)) throw new BridgeFailure('BAD_REQUEST', "'provider' must be pixabay or iconify")
  return { provider: r.provider, id: str(r.id, 'id') }
}

/** One library item: the id's shape is checked by the providers (`parseDrawingId`). */
function requireDrawingRequest(v: unknown): MediaDrawingRequest {
  return { id: str(requireRequest(v).id, 'id') }
}

/** How often a running app sweeps the media cache again (YAZ-3044 A34); the first sweep is at launch. */
export const MEDIA_CACHE_SWEEP_MS = 60 * 60_000

/** `media.packs`: one verb of five. */
function requirePacksRequest(v: unknown): IconPacksRequest {
  const op = requireRequest(v).op
  if (op !== 'status' && op !== 'download' && op !== 'stop' && op !== 'check' && op !== 'remove') throw new BridgeFailure('BAD_REQUEST', "'op' must be status, download, stop, check or remove")
  return { op }
}

/**
 * The cache folder this registration owns — the one fact a test needs back from it. `store` is where the icon packs'
 * folder setting lives (YAZ-4359): a change of it moves the packs. Without one, the packs stay in the default folder.
 * `copies` (YAZ-4363) are the favorites' own pictures: `preview` and `import` ask them first (then the downloaded
 * packs, then the network), and they are made with a second set of providers that has no copy step, so a copy is
 * always the provider's picture.
 */
export function registerMediaStudioIpc(
  userData: string,
  secrets: Secrets,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
  store?: Pick<Store, 'get' | 'onChange'>,
  copies?: FavoriteCopies,
): string {
  const folder = join(userData, MEDIA_CACHE_DIR)
  const cache = createMediaCache(folder)
  const packsFolder = () => resolveIconPacksFolder(store?.get().settings.iconPacksFolder ?? null, userData)
  // Every window hears each change: the Add panel's line and the Settings row can be in different windows.
  const packs = createIconPacks({ folder: packsFolder(), fetch: fetchImpl, onStatus: (status) => broadcastAll(CONTRACT.media.onPacksProgress.channel, status) })
  // Each store change is checked against the folder last asked for, so a move that is still going is not asked again.
  let wanted = packsFolder()
  store?.onChange(() => {
    const next = packsFolder()
    if (next === wanted) return
    wanted = next
    void packs.moveTo(next).catch((err: unknown) => console.warn('[icon-packs] could not move to', next, err))
  })
  const readPixabayKey = () => secrets.read(PIXABAY_SECRET)
  const providers = createMediaProviders({ fetch: fetchImpl, readPixabayKey, cache, packs, favoriteCopy: copies })
  // The copy maker's providers: the same packs (an icon's copy needs no network when its pack is downloaded), no copy step.
  const originals = createMediaProviders({ fetch: fetchImpl, readPixabayKey, cache, packs })
  void copies?.start({ picture: originals.import, drawing: async (id) => (await originals.drawing({ id })).elements })

  // Detached: the folder has to exist before the first write, and yesterday's entries have to go,
  // but neither is something a renderer should ever wait behind.
  void mkdir(folder, { recursive: true })
    .then(() => cache.sweep())
    .then(
      (swept) => {
        if (swept > 0) console.log(`[media-cache] swept ${swept} expired entr${swept === 1 ? 'y' : 'ies'}`)
      },
      (err: unknown) => console.warn('[media-cache] could not prepare', folder, err),
    )

  // YAZ-3044 A34: a long session sweeps again each hour, not only at launch. `unref`: it never holds the app open.
  setInterval(() => void cache.sweep().catch(() => undefined), MEDIA_CACHE_SWEEP_MS).unref()

  handle(CONTRACT.media.search, async (req: unknown) => providers.search(requireSearchRequest(req)))
  handle(CONTRACT.media.preview, async (req: unknown) => providers.preview(requireBytesRequest(req)))
  handle(CONTRACT.media.import, async (req: unknown) => providers.import(requireBytesRequest(req)))
  handle(CONTRACT.media.drawingIndex, async () => providers.drawingIndex())
  handle(CONTRACT.media.drawing, async (req: unknown) => providers.drawing(requireDrawingRequest(req)))
  handle(CONTRACT.media.packList, async () => providers.packList())
  // Packs never download by themselves: only this door, from a click, starts a run (round 2 decision 8).
  handle(CONTRACT.media.packs, async (req: unknown) => {
    const { op } = requirePacksRequest(req)
    return op === 'status' ? packs.status() : op === 'download' ? packs.download() : op === 'stop' ? packs.stop() : op === 'check' ? packs.check() : packs.remove()
  })

  return folder
}
