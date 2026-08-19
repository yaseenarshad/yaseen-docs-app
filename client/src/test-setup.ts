// jsdom lacks a few layout/observer APIs that ProseMirror/CodeMirror touch.
// Crepe otherwise runs fine in jsdom (verified in GRO-1961).
class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return [] }
}
const g = globalThis as any
if (!g.IntersectionObserver) g.IntersectionObserver = NoopObserver
if (!g.ResizeObserver) g.ResizeObserver = NoopObserver
if (!g.Range.prototype.getClientRects) {
  g.Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} })
  g.Range.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) })
}
if (!g.document.elementFromPoint) g.document.elementFromPoint = () => null

// Node >= 25 defines a global `localStorage` getter that evaluates to `undefined`
// unless --localstorage-file is passed; vitest's jsdom env does not override an
// existing global key, so jsdom's Storage never lands on globalThis. Polyfill
// an in-memory Storage so client tests behave the same on every Node version.
if (typeof g.localStorage === 'undefined' || g.localStorage === undefined) {
  const makeStorage = (): Storage => {
    const m = new Map<string, string>()
    return {
      get length() { return m.size },
      key: (i: number) => Array.from(m.keys())[i] ?? null,
      getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
      setItem: (k: string, v: string) => { m.set(String(k), String(v)) },
      removeItem: (k: string) => { m.delete(k) },
      clear: () => { m.clear() },
    } as Storage
  }
  Object.defineProperty(g, 'localStorage', { value: makeStorage(), configurable: true, writable: true })
  if (typeof g.sessionStorage === 'undefined') Object.defineProperty(g, 'sessionStorage', { value: makeStorage(), configurable: true, writable: true })
}
