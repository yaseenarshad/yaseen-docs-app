import type { WebContents } from 'electron'

/**
 * The last real click or activation key in each web contents, as MAIN sees it (YAZ-5218, YAZ-5247): Electron's
 * `input-event` comes from the input the OS gives the page, not from page code. A script, the devtools console or a
 * synthetic DOM event makes none. The phone code (`ipc/phone.ts`) asks for one less than a few seconds ago.
 * Only what clicks a button counts: a mouse down or up, or Enter or Space down or up. A mouse move, a wheel, a char,
 * and the other keys of typing do not. A webview or another window is its own web contents, so its input does not
 * count for the app's page. (Main cannot tell which element of the page got the click.)
 */
const MOUSE = new Set(['mouseDown', 'mouseUp'])
const KEYS = new Set(['keyDown', 'rawKeyDown', 'keyUp'])
const ACTIVATION_KEYS = new Set(['Enter', ' ', 'Spacebar'])
const last = new Map<number, number>()

export function trackInput(contents: WebContents, now: () => number = Date.now): void {
  const id = contents.id
  contents.on('input-event', (_e, input) => {
    const key = (input as { key?: unknown }).key
    if (MOUSE.has(input.type) || (KEYS.has(input.type) && typeof key === 'string' && ACTIVATION_KEYS.has(key))) last.set(id, now())
  })
  contents.once('destroyed', () => last.delete(id))
}

export const lastInputAt = (contents: WebContents): number | null => last.get(contents.id) ?? null
