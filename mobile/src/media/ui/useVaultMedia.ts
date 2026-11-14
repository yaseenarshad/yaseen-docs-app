import { useEffect, useMemo, type RefObject } from 'react'
import { useApp } from '../../app/AppState'
import { storedMedia, watchMedia, type VaultMedia } from './vaultMedia'

/**
 * The open vault's media for a screen (YAZ-5079; 4B's Review screen uses the same): 3D's `MediaAhead` from the app
 * (`AppServices.media`), or, with none (tests), the store alone, whose URLs are revoked when the screen closes.
 */
export function useVaultMedia(): VaultMedia {
  const app = useApp()
  const { store } = app.services
  const vault = app.vaultKey ?? ''
  const media = useMemo<VaultMedia & { release?: () => void }>(() => app.services.media ?? storedMedia(store, vault), [app.services.media, store, vault])
  useEffect(() => () => media.release?.(), [media])
  return media
}

/**
 * Watches the pictures and sounds drawn inside `host` for as long as the screen shows (`watchMedia`): each one gets its
 * bytes when it comes near the screen; a missing one is asked again when the signal returns or a pass ends. Closing
 * the screen stops the card's sound.
 */
export function useMediaWatch(host: RefObject<HTMLElement | null>, media: VaultMedia): void {
  const { services } = useApp()
  const { sync } = services
  useEffect(() => {
    const el = host.current
    if (el === null) return
    const watch = watchMedia(el, media)
    const off = sync.subscribe((event) => {
      if (event.type === 'state' && event.state.status === 'synced') watch.retry()
    })
    return () => {
      off()
      watch.stop()
    }
  }, [host, media, sync])
}
