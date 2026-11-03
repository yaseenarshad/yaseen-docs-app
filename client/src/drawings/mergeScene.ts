import { alive, mergeElements, same, type Element } from '@shared/boardMerge'
import type { ExcalidrawModule } from './engine'

/**
 * AN OUTSIDE SAVE, ON THE CANVAS (YAZ-4279 D1, D4). An AI or another app saved the board this tab shows. `base` is the scene
 * as this tab last loaded or saved it, `disk` the file now, `live` the canvas — with unsaved edits or none. The shared 3-way
 * merge (`mergeElements`, the one git sync uses) takes each property from the side that changed it, and answers the clash —
 * one property changed on both sides, a delete against an edit — which the conflict bar settles.
 *
 * The three sides are compared in ONE form, the engine's restored shapes (4A-6): the canvas holds restored shapes, so the
 * base and the file go through the same restore first, or a field only the restore fills in would read as the user's edit.
 * A shape the canvas still holds as it was keeps its very OBJECT, so the engine redraws only what the file brought; each one
 * taken from the file gets a `version` above the canvas's, as an edit would. Text the file changed, and the label of a box
 * it changed, is measured again (item 3: an AI rewrites a label but never its size). The board's own settings (`appState`,
 * e.g. the background) merge per key by the same rule.
 *
 * Pure apart from the engine utilities it is handed, so the rules are unit-tested without a canvas.
 */

type Shape = Element & { version?: number }
type Engine = Pick<ExcalidrawModule, 'restoreElements' | 'restoreAppState'>

export interface SceneSide {
  readonly elements: readonly unknown[]
  readonly appState: Readonly<Record<string, unknown>>
}

export interface SceneMerge {
  elements: Shape[]
  /** The board settings the file changed, to hand the engine; empty: none. */
  appState: Record<string, unknown>
  /** Ids of the shapes the file added (D5's green) and changed (amber), alive on the canvas after the merge. */
  added: string[]
  changed: string[]
}

/** A clash (D4): the shapes that clash, outlined red while the bar shows (item 8); empty for a board setting both changed. */
export interface SceneClash {
  conflicts: string[]
}

const restore = (engine: Engine, elements: readonly unknown[]): Shape[] => engine.restoreElements(elements as never, null) as unknown as Shape[]

export function mergeLiveScene(engine: Engine, base: SceneSide, disk: SceneSide, live: SceneSide, boardKeys: readonly string[]): SceneMerge | SceneClash {
  // A key missing from the base is the engine's default, as the canvas holds it (4A-8); one missing from the file says
  // nothing about it (an AI writes only what it means to).
  const [was, theirs] = [engine.restoreAppState(base.appState as never, null) as unknown as Record<string, unknown>, engine.restoreAppState(disk.appState as never, null) as unknown as Record<string, unknown>]
  const appState: Record<string, unknown> = {}
  for (const key of boardKeys) {
    if (!(key in disk.appState) || same(theirs[key], was[key]) || same(theirs[key], live.appState[key])) continue
    if (!same(live.appState[key], was[key])) return { conflicts: [] }
    appState[key] = theirs[key]
  }

  const [baseEls, diskEls] = [restore(engine, base.elements), restore(engine, disk.elements)]
  newWords(baseEls, diskEls)
  const liveEls = live.elements as readonly Shape[]
  const merged = mergeElements(baseEls, diskEls, liveEls, 'per-property')
  if ('conflicts' in merged) return merged
  const onCanvas = new Map(liveEls.map((e) => [e.id, e]))
  const taken = new Map(merged.elements.filter((e) => e !== onCanvas.get(e.id)).map((e) => [e.id, e as Shape]))
  // Nothing taken: every shape is the canvas's own object; the file may still have deleted some.
  if (taken.size === 0) return { elements: merged.elements as Shape[], appState, added: [], changed: [] }

  for (const [id, text] of measured(engine, merged.elements, taken)) taken.set(id, text)
  const now = Date.now()
  const added: string[] = []
  const changed: string[] = []
  const elements = merged.elements.map((e) => {
    const took = taken.get(e.id)
    if (took === undefined) return e as Shape
    const was = onCanvas.get(e.id)
    if (alive(took)) (alive(was) ? changed : added).push(e.id)
    // Above the canvas's version, as an edit: the engine redraws it, and the next save counts it.
    return { ...took, version: Math.max(was?.version ?? 0, took.version ?? 0) + 1, versionNonce: Math.floor(Math.random() * 2 ** 31), updated: now }
  })
  return { elements, appState, added, changed }
}

/**
 * 4A-5: the engine measures and wraps a label from its `originalText`. An AI that rewrites a label often writes `text`
 * alone; the file's new words then become its `originalText` too, or the measure would put the old words back.
 */
function newWords(base: readonly Shape[], disk: Shape[]): void {
  const was = new Map(base.map((e) => [e.id, e]))
  for (const e of disk) {
    const old = was.get(e.id)
    if (e.type === 'text' && old !== undefined && e.text !== old.text && e.originalText === old.originalText) e.originalText = e.text
  }
}

/**
 * Item 3: the text the file brought — a changed label, or the label of a box it changed — measured again with the engine's
 * own measure. Its restore re-measures only with its binding repair, and that repair drops a box's bindings to anything
 * outside the list it is handed; so each text goes in with its box alone, and only the measured TEXT comes back out.
 */
function measured(engine: Engine, elements: readonly Element[], taken: ReadonlyMap<string, Shape>): Map<string, Shape> {
  const byId = new Map(elements.map((e) => [e.id, e]))
  const texts = new Set<string>()
  for (const e of taken.values()) {
    if (!alive(e)) continue
    if (e.type === 'text') texts.add(e.id)
    else if (Array.isArray(e.boundElements)) for (const b of e.boundElements as { id: string; type?: string }[]) if (b.type === 'text' && alive(byId.get(b.id))) texts.add(b.id)
  }
  const out = new Map<string, Shape>()
  for (const id of texts) {
    const text = (taken.get(id) ?? byId.get(id)) as Shape
    const box = typeof text.containerId === 'string' ? byId.get(text.containerId) : undefined
    const again = engine.restoreElements((box === undefined ? [text] : [text, box]) as never, null, { repairBindings: true, refreshDimensions: true }) as unknown as Shape[]
    const fresh = again.find((e) => e.id === id)
    if (fresh !== undefined && !same(fresh, text)) out.set(id, fresh)
  }
  return out
}
