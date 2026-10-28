import { afterAll, beforeAll } from 'vitest'
import { loadMaterialIcons } from './sidebar/materialIcons'
import { trackMilkdownTimeouts } from './test-timers'

// The app starts loading Material's icon tables before its first render (`main.tsx`, YAZ-3470), so they are in by
// the time a tree, a tab or a picker draws: each test file starts with them in too.
beforeAll(() => loadMaterialIcons())

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
// prosemirror-keymap resolves `Mod-` from `navigator.platform`, which jsdom leaves empty (→ Ctrl).
// The app ships mac-only, so `Mod-` is ⌘ everywhere it runs; say so, and a test pressing ⌘ presses
// what the user presses. (`IS_MAC` in the older keyboard tests reads the same property and follows.)
if (navigator.platform === '') Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true })
if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
}
document.elementFromPoint ??= () => null
// Milkdown's readiness timeouts outlive `editor.destroy()`; cancel them before jsdom goes (YAZ-2233).
afterAll(trackMilkdownTimeouts())
