/**
 * Eagerly-importable state store for open mini-windows (`PageWindow`, YAZ-6008 D3):
 * kept separate from `PageWindow.tsx` so `App.tsx` can handle renames and deletes
 * without pulling the FolderView / PageWindow React component tree into the startup chunk.
 */
import { cellNotePinnedAtStart } from '../../editor/table/cellNoteCard'

/** An open card: the page it shows now, and its place, size and pin, kept while the app runs (D17): in memory only. */
export interface PageWindowMemory {
  path: string
  placed: { x: number; y: number } | null
  width: number | null
  height: number | null
  pinned: boolean
  properties?: { current: boolean | null }
  zoom?: { current: number | null }
}

export const pageWindowMemory = (path: string, pinned: boolean | null = null): PageWindowMemory => ({
  path,
  placed: null,
  width: null,
  height: null,
  pinned: pinned ?? cellNotePinnedAtStart(),
})

export const openWindows = new Map<string, PageWindowMemory>()
export const MAX_OPEN_WINDOWS = 50
export const windowListeners = new Set<(from: string, to: string | null) => void>()

export const pageWindowKey = (tabId: string | undefined, folderPath: string, viewName: string): string =>
  JSON.stringify([tabId ?? null, folderPath, viewName])
export const openPageWindow = (key: string): PageWindowMemory | undefined => openWindows.get(key)
export function keepPageWindow(key: string, memory: PageWindowMemory): void {
  openWindows.delete(key)
  openWindows.set(key, memory)
  if (openWindows.size > MAX_OPEN_WINDOWS) openWindows.delete(openWindows.keys().next().value!)
}
export const dropPageWindow = (key: string): void => void openWindows.delete(key)
export const dropAllPageWindows = (): void => openWindows.clear()

export const isAtOrUnder = (path: string, at: string): boolean => path === at || path.startsWith(`${at}/`)
const keyParts = (key: string): [string | null, string, string] => JSON.parse(key) as [string | null, string, string]

function rekeyPageWindows(moves: (tabId: string | null, folderPath: string, viewName: string) => string | null): void {
  for (const [key, memory] of [...openWindows]) {
    const to = moves(...keyParts(key))
    if (to === null || to === key) continue
    openWindows.delete(key)
    openWindows.set(to, memory)
  }
}

export function renamePageWindows(oldPath: string, newPath: string): void {
  for (const memory of openWindows.values()) if (isAtOrUnder(memory.path, oldPath)) memory.path = newPath + memory.path.slice(oldPath.length)
  rekeyPageWindows((tabId, folderPath, viewName) => (isAtOrUnder(folderPath, oldPath) ? pageWindowKey(tabId ?? undefined, newPath + folderPath.slice(oldPath.length), viewName) : null))
  for (const tell of [...windowListeners]) tell(oldPath, newPath)
}

export const renamePageWindowView = (folderPath: string, from: string, to: string): void =>
  rekeyPageWindows((tabId, folder, viewName) => (folder === folderPath && viewName === from ? pageWindowKey(tabId ?? undefined, folderPath, to) : null))

export function dropPageWindowsAt(path: string): void {
  for (const tell of [...windowListeners]) tell(path, null)
  for (const [key, memory] of openWindows) if (isAtOrUnder(memory.path, path)) openWindows.delete(key)
}
