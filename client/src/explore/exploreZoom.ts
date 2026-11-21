/**
 * THE ONE PAGE ZOOM OF EXPLORE (round 4, YAZ-5977): the zoom every page window of Explore shows its text at, kept in this
 * Mac's localStorage (`explore:zoom`, 50–400, 125 by default: YAZ-5977 Q6). One value with two doors: the title row's pill (and the
 * stack's ⌘+ / ⌘− / ⌘0) and Settings › Appearance › Explore › Page zoom. A change at either shows at once at the other,
 * and in the other windows of the app (the `storage` event).
 */
import { useSyncExternalStore } from 'react'
import { saveExploreZoom, savedExploreZoom } from './layers'

const listeners = new Set<() => void>()

/** Read from localStorage each time (a number, so React sees the same value until it changes); no entry or no storage: 125. */
export const getExploreZoom = (): number => savedExploreZoom()

export function setExploreZoom(zoom: number): void {
  saveExploreZoom(zoom)
  for (const listener of [...listeners]) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  // Another window of the app changed it: read it again.
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === 'explore:zoom') listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

/** The page zoom and its setter, for the stack and the Settings row. */
export function useExploreZoom(): [number, (zoom: number) => void] {
  return [useSyncExternalStore(subscribe, getExploreZoom), setExploreZoom]
}
