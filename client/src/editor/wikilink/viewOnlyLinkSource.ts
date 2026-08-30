import type { ViewOnlyCatalog, ViewOnlyEntry } from '../../links/viewOnlyCatalog'

export interface ViewOnlyLinkSource {
  readonly ready: boolean
  readonly catalog: ViewOnlyCatalog | null
  readonly targets: readonly ViewOnlyEntry[]
  readonly resolve: ((target: string) => string | null) | null
  linkName(path: string): string | null
  subscribe(listener: () => void): () => void
}

export interface MutableViewOnlyLinkSource extends ViewOnlyLinkSource {
  update(catalog: ViewOnlyCatalog): void
}

export function createViewOnlyLinkSource(): MutableViewOnlyLinkSource {
  let current: ViewOnlyCatalog | null = null
  const listeners = new Set<() => void>()
  return {
    get ready() { return current !== null },
    get catalog() { return current },
    get targets() { return current?.entries ?? [] },
    get resolve() { return current?.resolve ?? null },
    linkName(path) { return current?.linkName(path) ?? null },
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    update(catalog) {
      current = catalog
      listeners.forEach((listener) => listener())
    },
  }
}
