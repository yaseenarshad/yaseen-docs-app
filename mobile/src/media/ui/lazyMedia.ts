import type { VaultStore } from '../../store'
import type { SyncEngine } from '../../sync/engine'
import type { MediaAhead } from '../ahead'
import type { FileShow, VaultMedia } from './vaultMedia'

/**
 * 3D's media for the app, made ONE time, as soon as 3B's engine has loaded (`engineLoaded`), in a chunk of its own: the
 * first load does not carry it. It then downloads the pictures and sounds of the cards due soon after each pass
 * (decision 6). A `show` before that waits for it.
 */
export function lazyMedia(
  engineLoaded: () => Promise<SyncEngine>,
  store: VaultStore,
  load: () => Promise<{ createMediaAhead: (options: { engine: SyncEngine; store: VaultStore }) => MediaAhead }> = () => import('../ahead'),
): VaultMedia & { showLink(src: string, holder: string): Promise<FileShow> } {
  let ahead: MediaAhead | null = null
  let made: Promise<MediaAhead> | null = null
  const get = () =>
    (made ??= engineLoaded().then(async (engine) => {
      const { createMediaAhead } = await load()
      ahead = createMediaAhead({ engine, store })
      return ahead
    }))
  void get().catch(() => undefined)
  return {
    show: async (path) => (await get()).show(path),
    showLink: async (src, holder) => (await get()).showLink(src, holder),
    urlNow: (path) => ahead?.urlNow(path) ?? null,
  }
}
