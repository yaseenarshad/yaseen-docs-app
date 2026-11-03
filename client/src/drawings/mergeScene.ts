import { mergeElements } from '@shared/boardMerge'
import type { ExcalidrawModule } from './engine'

/**
 * AN OUTSIDE SAVE OVER UNSAVED EDITS, ON THE CANVAS (YAZ-4279 D1, D4). An AI or another app saved the board while this tab
 * has edits it has not written. `base` is the scene as this tab last loaded or saved it, `disk` the file now, `live` the
 * canvas: the shared 3-way merge (`mergeElements`, the one git sync uses) takes each property from the side that changed it,
 * and answers the clash — one property changed on both sides, a delete against an edit — which the conflict bar settles.
 *
 * The sides are compared as the file holds them. A shape the canvas still holds as it was keeps its very OBJECT, so the engine
 * redraws only what the file brought; each shape taken from the file goes through the engine's own restore and gets a
 * `version` above the canvas's, as an edit would. Text the file changed, and the label of a box it changed, is measured
 * again (item 3: an AI rewrites a label but never its size). The board's own settings (`appState`, e.g. the background)
 * merge per key by the same rule.
 *
 * Pure apart from the engine utilities it is handed, so the rules are unit-tested without a canvas.
 */

type Element = Record<string, unknown> & { id: string; version?: number }

export interface SceneSide {
  readonly elements: readonly unknown[]
  readonly appState: Readonly<Record<string, unknown>>
}

export interface SceneMerge {
  elements: Element[]
  /** The board settings the file changed, to hand the engine; empty: none. */
  appState: Record<string, unknown>
  /** Ids of the shapes the file added (D5's green) and changed (amber), alive on the canvas after the merge. */
  added: string[]
  changed: string[]
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
const alive = (e: Element | undefined): e is Element => e !== undefined && e.isDeleted !== true

/** A clash (D4): the shapes that clash, outlined red while the bar shows (item 8); empty for a board setting both changed. */
export interface SceneClash {
  conflicts: string[]
}

export function mergeLiveScene(engine: Pick<ExcalidrawModule, 'restoreElements'>, base: SceneSide, disk: SceneSide, live: { elements: readonly unknown[]; appState: Readonly<Record<string, unknown>> }, boardKeys: readonly string[]): SceneMerge | SceneClash {
  const appState: Record<string, unknown> = {}
  for (const key of boardKeys) {
    const [was, theirs, mine] = [base.appState[key], disk.appState[key], live.appState[key]]
    // A file without the key says nothing about it (an AI writes only what it means to).
    if (theirs === undefined || same(theirs, was) || same(theirs, mine)) continue
    if (!same(mine, was)) return { conflicts: [] }
    appState[key] = theirs
  }

  const liveEls = live.elements as readonly Element[]
  const merged = mergeElements(base.elements as Element[], disk.elements as Element[], liveEls, 'per-property')
  if ('conflicts' in merged) return merged
  const onCanvas = new Map(liveEls.map((e) => [e.id, e]))
  const taken = merged.elements.filter((e) => e !== onCanvas.get(e.id))
  if (taken.length === 0) return { elements: [...liveEls], appState, added: [], changed: [] }

  const restored = new Map((engine.restoreElements(taken as never, null) as unknown as Element[]).map((e) => [e.id, e]))
  const elements = merged.elements.map((e) => restored.get(e.id) ?? e)
  for (const [id, text] of measured(engine, elements, restored)) restored.set(id, text)
  const now = Date.now()
  const added: string[] = []
  const changed: string[] = []
  const out = elements.map((e) => {
    const took = restored.get(e.id)
    if (took === undefined) return e
    const was = onCanvas.get(e.id)
    if (alive(took)) (alive(was) ? changed : added).push(e.id)
    // Above the canvas's version, as an edit: the engine redraws it, and the next save counts it.
    return { ...took, version: Math.max(was?.version ?? 0, took.version ?? 0) + 1, versionNonce: Math.floor(Math.random() * 2 ** 31), updated: now }
  })
  return { elements: out, appState, added, changed }
}

/**
 * Item 3: the text the file brought — a changed label, or the label of a box it changed — measured again with the engine's
 * own measure. Its restore re-measures only with its binding repair, and that repair drops a box's bindings to anything
 * outside the list it is handed; so each text goes in with its box alone, and only the measured TEXT comes back out.
 */
function measured(engine: Pick<ExcalidrawModule, 'restoreElements'>, elements: readonly Element[], taken: ReadonlyMap<string, Element>): Map<string, Element> {
  const byId = new Map(elements.map((e) => [e.id, e]))
  const texts = new Set<string>()
  for (const e of taken.values()) {
    if (!alive(e)) continue
    if (e.type === 'text') texts.add(e.id)
    else if (Array.isArray(e.boundElements)) for (const b of e.boundElements as { id: string; type?: string }[]) if (b.type === 'text' && alive(byId.get(b.id))) texts.add(b.id)
  }
  const out = new Map<string, Element>()
  for (const id of texts) {
    const text = (taken.get(id) ?? byId.get(id)) as Element
    const box = typeof text.containerId === 'string' ? byId.get(text.containerId) : undefined
    const again = engine.restoreElements((box === undefined ? [text] : [text, box]) as never, null, { repairBindings: true, refreshDimensions: true }) as unknown as Element[]
    const fresh = again.find((e) => e.id === id)
    if (fresh !== undefined && !same(fresh, text)) out.set(id, fresh)
  }
  return out
}
