import type { OutsideChangeGlow } from '@shared/types'

/**
 * WHAT CHANGED OUTSIDE, ON THE CANVAS (YAZ-4279 D5, items 7 and 8). Each shape an outside save added (green) or changed
 * (amber) gets an outline, timed by the notes' Glow setting (`settings.outsideChangeGlow`): "Until I check it" — until that
 * shape is selected or edited — 10 s, 1 min, or never. While the conflict bar shows, the shapes that clash are red.
 *
 * The outline is the engine's own remote-selection outline, of one stand-in collaborator per colour. The engine colours a
 * collaborator by a hash of its id (`getClientColor`), so each id below is one that hashes to its hue: 130 (green), 40
 * (amber), 0 (red). It lives in appState, never in an element, so it never reaches the file, the autosave or ⌘Z. The
 * engine's avatar list is hidden (`drawingEditor.css`): the app has no collaborators of its own.
 */
export type MarkKind = 'added' | 'changed' | 'clash'

export const MARK_COLLABORATORS: Readonly<Record<MarkKind, string>> = { added: 'outside-added-63', changed: 'outside-changed-32', clash: 'outside-clash-8' }

const GLOW_MS: Readonly<Partial<Record<OutsideChangeGlow, number>>> = { '10s': 10_000, '60s': 60_000 }

/** The engine's collaborator, as far as an outline needs one. */
export interface MarkCollaborator {
  id: string
  username: string
  selectedElementIds: Record<string, true>
}

interface Shape {
  readonly id: string
  readonly version?: number
}

export class OutsideMarks {
  private readonly marks = new Map<string, { kind: MarkKind; version: number }>()
  private timer: ReturnType<typeof setTimeout> | null = null

  /** `show` hands the engine its collaborators: one per colour that has a shape. */
  constructor(private readonly show: (collaborators: Map<string, MarkCollaborator>) => void) {}

  /** An outside save's shapes, at the versions the canvas now holds them. Earlier outside marks go: these are the news. */
  mark(added: readonly string[], changed: readonly string[], shapes: readonly Shape[], glow: OutsideChangeGlow): void {
    this.drop('added', 'changed')
    if (glow !== 'off' && added.length + changed.length > 0) {
      const version = new Map(shapes.map((s) => [s.id, s.version ?? 0]))
      for (const id of added) this.marks.set(id, { kind: 'added', version: version.get(id) ?? 0 })
      for (const id of changed) this.marks.set(id, { kind: 'changed', version: version.get(id) ?? 0 })
      const ms = GLOW_MS[glow]
      if (ms !== undefined) this.timer = setTimeout(() => this.drop('added', 'changed') && this.render(), ms)
    }
    this.render()
  }

  /** The shapes the conflict bar is about (item 8); empty: the bar went. */
  clash(ids: readonly string[]): void {
    this.drop('clash')
    for (const id of ids) this.marks.set(id, { kind: 'clash', version: Infinity })
    this.render()
  }

  /**
   * "Until I check it": a marked shape the user selected or edited is checked. Fed every `onChange`, so it costs nothing
   * with no mark, and one pass over the shapes with one.
   */
  seen(selected: Readonly<Record<string, unknown>>, shapes: readonly Shape[]): void {
    if (this.marks.size === 0) return
    let changed = false
    for (const shape of shapes) {
      const mark = this.marks.get(shape.id)
      if (mark === undefined || mark.kind === 'clash') continue
      if (selected[shape.id] === true || (shape.version ?? 0) > mark.version) {
        this.marks.delete(shape.id)
        changed = true
      }
    }
    if (changed) this.render()
  }

  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }

  /** True when a mark went. */
  private drop(...kinds: MarkKind[]): boolean {
    if (kinds.includes('added')) this.dispose()
    let dropped = false
    for (const [id, mark] of this.marks) {
      if (!kinds.includes(mark.kind)) continue
      this.marks.delete(id)
      dropped = true
    }
    return dropped
  }

  private render(): void {
    const byKind = new Map<MarkKind, Record<string, true>>()
    for (const [id, { kind }] of this.marks) byKind.set(kind, { ...byKind.get(kind), [id]: true })
    const collaborators = new Map<string, MarkCollaborator>()
    for (const [kind, ids] of byKind) collaborators.set(MARK_COLLABORATORS[kind], { id: MARK_COLLABORATORS[kind], username: 'Outside change', selectedElementIds: ids })
    this.show(collaborators)
  }
}

/** A clean reload's news (D5): the live shapes the file added, and the ones whose content it changed (the stamps aside). */
export function changedShapes(before: readonly Record<string, unknown>[], after: readonly Record<string, unknown>[]): { added: string[]; changed: string[] } {
  const was = new Map(before.map((e) => [e.id as string, e]))
  const added: string[] = []
  const changed: string[] = []
  for (const e of after) {
    if (e.isDeleted === true) continue
    const old = was.get(e.id as string)
    if (old === undefined || old.isDeleted === true) added.push(e.id as string)
    else if (unstamped(old) !== unstamped(e)) changed.push(e.id as string)
  }
  return { added, changed }
}

const unstamped = ({ version: _v, versionNonce: _n, updated: _u, ...content }: Record<string, unknown>): string => JSON.stringify(content)
