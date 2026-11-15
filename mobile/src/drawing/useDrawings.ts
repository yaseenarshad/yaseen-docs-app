import { useEffect, useRef, type RefObject } from 'react'
import { useApp } from '../app/AppState'
import type { VaultMedia } from '../media/ui/vaultMedia'
import type { VaultStore } from '../store'
import { useVaultData } from '../search/vaultData'
import { watchDrawings, type DrawingDeps } from './watchDrawings'

/**
 * The drawings of an open page (`watchDrawings`), for as long as the page shows. A file's bytes come from the
 * phone's store first; a file not there comes through the media layer (`media.show`: GitHub, then kept by its own
 * rules), and is read from the store once kept. A pass that ends asks again for each drawing that waited.
 */
/** A vault file's bytes: the phone's store first; else through the media layer (GitHub; it keeps the file by its rules). */
export function storeFirst(store: Pick<VaultStore, 'read'>, vault: string, media: VaultMedia): DrawingDeps['read'] {
  const bytesOf = (content: string | Uint8Array) => (typeof content === 'string' ? new TextEncoder().encode(content) : content)
  return async (path) => {
    const stored = await store.read(vault, path)
    if (stored !== null) return { bytes: bytesOf(stored.content) }
    const show = await media.show(path)
    if (show.status !== 'ready') return { why: show.why }
    // The media layer keeps the file (its own rules); the bytes are then the store's.
    const kept = (show as { kept?: Promise<boolean> }).kept
    if (kept !== undefined) await kept.catch(() => false)
    media.releaseUrl?.(path, show.url)
    const again = await store.read(vault, path)
    return again === null ? { why: 'failed' } : { bytes: bytesOf(again.content) }
  }
}

export function useDrawings(host: RefObject<HTMLElement | null>, media: VaultMedia): void {
  const app = useApp()
  const { store, sync } = app.services
  const vault = app.vaultKey ?? ''
  const data = useVaultData()
  const files = useRef<readonly string[]>([])
  files.current = data?.files ?? []
  useEffect(() => {
    const el = host.current
    if (el === null) return
    const read = storeFirst(store, vault, media)
    const watch = watchDrawings(el, { read, files: () => files.current })
    const off = sync.subscribe((event) => {
      if (event.type === 'state' && event.state.status === 'synced') watch.retry()
    })
    return () => {
      off()
      watch.stop()
    }
  }, [host, media, store, sync, vault])
}
