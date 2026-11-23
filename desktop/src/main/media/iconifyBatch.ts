/**
 * ICONIFY TILE PICTURES IN BATCHES (YAZ-4157 demo 6G). A page of results used to cost one request per icon tile — the
 * `<prefix>/<name>.svg` endpoint — and a few searches in a row passed Iconify's rate limit (429). Iconify also answers
 * MANY icons of one set in one request, as data (`<prefix>.json?icons=a,b,c`), so the tiles that ask within one short
 * window are asked together, one request per icon set, and each SVG is built here from its set's data.
 *
 * Only the picture is built: an icon whose alias rotates or flips it gets null, and the caller fetches that one
 * finished SVG on its own. An import (a tile added to a board) never comes here; it fetches the finished SVG.
 */

/** One icon of a set, as Iconify's JSON gives it. The box defaults come from the set (and 16 × 16 at the last). */
interface IconData {
  body: string
  left?: number
  top?: number
  width?: number
  height?: number
  rotate?: number
  hFlip?: boolean
  vFlip?: boolean
}

/** The part of `<prefix>.json?icons=…` this file reads. */
export interface IconifySetData {
  prefix?: string
  icons?: Record<string, IconData>
  aliases?: Record<string, Partial<IconData> & { parent: string }>
  left?: number
  top?: number
  width?: number
  height?: number
}

/**
 * How many alias steps are followed before giving up: Iconify's own data never needs more than a few. The one limit for
 * the streamed set data and the downloaded packs (`iconPacks.ts`).
 */
export const MAX_ALIAS_DEPTH = 6

/**
 * The SVG for `name` in `set`, as the `.svg` endpoint would answer it, or null when the set data has no such icon.
 *
 * A rotated or flipped icon (an alias that turns its parent) is null too, unless `transforms` is set: the tile batch
 * then fetches that one finished SVG. A downloaded pack (YAZ-4359) has no network to ask, so it builds the turn itself,
 * as Iconify's own `iconToSVG` does: the flips and turns of every alias step add up, and wrap the body in one `<g>`.
 */
export function iconSvg(set: IconifySetData, name: string, { transforms = false }: { transforms?: boolean } = {}): string | null {
  // An alias may set its own box over its parent's; a nearer value wins. Its turns add to its parent's.
  const box: Partial<IconData> = {}
  let rotate = 0
  let hFlip = false
  let vFlip = false
  let at = name
  for (let depth = 0; depth <= MAX_ALIAS_DEPTH; depth++) {
    const icon = set.icons?.[at]
    const alias = icon === undefined ? set.aliases?.[at] : undefined
    const step = icon ?? alias
    if (step === undefined) return null
    if (step.rotate || step.hFlip || step.vFlip) {
      if (!transforms) return null
      rotate += step.rotate ?? 0
      if (step.hFlip) hFlip = !hFlip
      if (step.vFlip) vFlip = !vFlip
    }
    for (const key of ['left', 'top', 'width', 'height'] as const) if (box[key] === undefined && typeof step[key] === 'number') box[key] = step[key]
    if (icon !== undefined) {
      const view = { left: box.left ?? set.left ?? 0, top: box.top ?? set.top ?? 0, width: box.width ?? set.width ?? 16, height: box.height ?? set.height ?? 16 }
      const body = rotate !== 0 || hFlip || vFlip ? turned(icon.body, view, rotate, hFlip, vFlip) : icon.body
      return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1em" height="1em" viewBox="${view.left} ${view.top} ${view.width} ${view.height}">${body}</svg>`
    }
    at = (alias as { parent: string }).parent
  }
  return null
}

/** `iconToSVG`'s turn, from `@iconify/utils`: it changes `view` in place (a quarter turn swaps its sides). */
function turned(body: string, view: { left: number; top: number; width: number; height: number }, rotate: number, hFlip: boolean, vFlip: boolean): string {
  const steps: string[] = []
  let turns = rotate
  if (hFlip) {
    if (vFlip) turns += 2
    else {
      steps.push(`translate(${view.width + view.left} ${0 - view.top})`, 'scale(-1 1)')
      view.top = view.left = 0
    }
  } else if (vFlip) {
    steps.push(`translate(${0 - view.left} ${view.height + view.top})`, 'scale(1 -1)')
    view.top = view.left = 0
  }
  turns = ((turns % 4) + 4) % 4
  if (turns === 1) {
    const c = view.height / 2 + view.top
    steps.unshift(`rotate(90 ${c} ${c})`)
  } else if (turns === 2) steps.unshift(`rotate(180 ${view.width / 2 + view.left} ${view.height / 2 + view.top})`)
  else if (turns === 3) {
    const c = view.width / 2 + view.left
    steps.unshift(`rotate(-90 ${c} ${c})`)
  }
  if (turns % 2 === 1) {
    ;[view.left, view.top] = [view.top, view.left]
    ;[view.width, view.height] = [view.height, view.width]
  }
  return steps.length > 0 ? `<g transform="${steps.join(' ')}">${body}</g>` : body
}

/** How long the first tile of a set waits for the others; the renderer asks for a page's tiles all at once. */
export const BATCH_WAIT_MS = 15
/** The most icons in one request: it keeps the URL short. */
export const MAX_BATCH_ICONS = 48

type Waiter = { resolve: (svg: string | null) => void; reject: (cause: unknown) => void }

/**
 * `svg('prefix:name')` resolves with the built SVG, or null (see `iconSvg`). Calls within `BATCH_WAIT_MS` that share a
 * prefix become ONE `fetchSet`; a failed request rejects every tile that waited on it.
 */
export function createIconifyBatcher(fetchSet: (prefix: string, names: string[]) => Promise<IconifySetData>) {
  const queues = new Map<string, Map<string, Waiter[]>>()

  const flush = (prefix: string) => {
    const queue = queues.get(prefix)
    if (queue === undefined) return
    queues.delete(prefix)
    const names = [...queue.keys()]
    fetchSet(prefix, names).then(
      (set) => {
        for (const [name, waiters] of queue) for (const w of waiters) w.resolve(iconSvg(set, name))
      },
      (cause: unknown) => {
        for (const waiters of queue.values()) for (const w of waiters) w.reject(cause)
      },
    )
  }

  return {
    svg(providerId: string): Promise<string | null> {
      const [prefix, name] = providerId.split(':')
      return new Promise((resolve, reject) => {
        let queue = queues.get(prefix)
        if (queue === undefined) {
          queue = new Map()
          queues.set(prefix, queue)
          setTimeout(() => flush(prefix), BATCH_WAIT_MS)
        }
        queue.set(name, [...(queue.get(name) ?? []), { resolve, reject }])
        // A full batch goes now; the timer then finds no queue (or a new one) for this prefix.
        if (queue.size >= MAX_BATCH_ICONS) flush(prefix)
      })
    },
  }
}
