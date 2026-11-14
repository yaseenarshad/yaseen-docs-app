import type { WebContents } from 'electron'

/**
 * The last real click or key in each web contents, as MAIN sees it (YAZ-5218): Electron's `input-event` comes from the
 * input the OS gives the page, not from page code. A script, the devtools console or a synthetic DOM event makes none.
 * The phone code (`ipc/phone.ts`) asks for one less than a few seconds ago.
 */
const KINDS = new Set(['mouseDown', 'mouseUp', 'keyDown', 'rawKeyDown', 'keyUp'])
const last = new Map<number, number>()

export function trackInput(contents: WebContents, now: () => number = Date.now): void {
  const id = contents.id
  contents.on('input-event', (_e, input) => {
    if (KINDS.has(input.type)) last.set(id, now())
  })
  contents.once('destroyed', () => last.delete(id))
}

export const lastInputAt = (contents: WebContents): number | null => last.get(contents.id) ?? null
