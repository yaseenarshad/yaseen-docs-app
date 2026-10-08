/**
 * A worker has no `document`, and micromark's browser build wants one: it decodes a named character
 * reference (`&amp;`) through a DOM element that it makes when its module loads, so without this
 * the worker throws before it can answer (YAZ-2643). This is that one element, and it decodes
 * nothing: every reference stays text. The worker reads block structure only, and in CommonMark a
 * character reference never makes structure.
 *
 * The worker imports this FIRST, so it runs before micromark's modules do.
 */
const element = {
  textContent: '',
  set innerHTML(html: string) {
    this.textContent = html
  },
}

;(self as unknown as { document?: unknown }).document ??= { createElement: () => element }
