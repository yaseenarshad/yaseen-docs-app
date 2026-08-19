// jsdom lacks a few layout/observer APIs that ProseMirror/CodeMirror touch; Crepe otherwise runs fine in jsdom.
class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
}
const g = globalThis as unknown as Record<string, unknown>
g.IntersectionObserver ??= NoopObserver
g.ResizeObserver ??= NoopObserver
if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
}
document.elementFromPoint ??= () => null

// Node >= 25 defines a global `localStorage` getter that evaluates to `undefined` unless
// --localstorage-file is passed; vitest's jsdom env does not override an existing global key,
// so jsdom's Storage never lands on globalThis. Polyfill an in-memory Storage instead.
if (g.localStorage === undefined) {
  const makeStorage = (): Storage => {
    const m = new Map<string, string>()
    return {
      get length() {
        return m.size
      },
      key: (i) => [...m.keys()][i] ?? null,
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => void m.set(String(k), String(v)),
      removeItem: (k) => void m.delete(k),
      clear: () => m.clear(),
    }
  }
  Object.defineProperty(g, 'localStorage', { value: makeStorage(), configurable: true, writable: true })
  Object.defineProperty(g, 'sessionStorage', { value: makeStorage(), configurable: true, writable: true })
}
