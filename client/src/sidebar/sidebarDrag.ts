/**
 * The pages the sidebar drags now (YAZ-4748 D4). A diagram's draw.io frame cannot read a dropped file's path (it has
 * no preload), so the frame takes a drop only while this says a sidebar drag is on, and the host links the paths
 * kept here. The drop can land after the drag's end is heard (`file:drag-ended`), so the last drag's paths stay until
 * the next one starts.
 */
let current: readonly string[] = []
let last: readonly string[] = []
const listeners = new Set<() => void>()

/** The sidebar's drag started (its paths) or ended (none). */
export function setSidebarDrag(paths: readonly string[]): void {
  if (paths === current) return
  current = paths
  if (paths.length > 0) last = paths
  listeners.forEach((listener) => listener())
}

/** A sidebar drag is on. */
export const sidebarDragOn = (): boolean => current.length > 0

/** The paths of the sidebar's last drag, also once it ended. */
export const lastSidebarDrag = (): readonly string[] => last

export function onSidebarDrag(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
