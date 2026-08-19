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
