/**
 * THE TREE (YAZ-5121): ideas as a drawing. A card is the hub of one idea; what you know about it are its spokes
 * (chapter 2). Later chapters grow it: an umbrella card with branches (chapter 7), links across trees (chapter 10).
 *
 * One piece draws all of them: nodes at positions in a 600 × 340 view, and edges between them. Each node and edge has
 * its own progress (`show`), so a scene grows the tree in step with the words. `hub()` lays out a hub and its spokes.
 *
 * A `branch` node is a small card with its title, set as HTML over the drawing: its box grows with its title, which
 * wraps and stays sharp at any stage size, and keeps the kit's smallest readable size. `cards[id]` gives a branch its
 * look: `glow` (look here), `tone` (`root`: the umbrella; `ghost`: not made yet; `grey`). Reduced motion: the
 * branches and cards cross-fade; nothing grows or pops.
 */
import type { ReactNode } from 'react'
import { clamp, ease, lerp, type Beat } from './beat'
import { glowStyle } from './AppFrame'

export interface TreeNode {
  id: string
  x: number
  y: number
  label?: string
  /** `hub`: the card, large; `branch`: a card with its title (HTML); `leaf`: a small node; `card`: a small card shape. */
  kind?: 'hub' | 'branch' | 'leaf' | 'card'
}

export interface TreeEdge {
  from: string
  to: string
  /** `spoke`/`branch`: solid; `link`: dashed, across trees. */
  kind?: 'spoke' | 'branch' | 'link'
}

/** A hub at the centre, with `labels` around it as spokes, evenly round the circle from `start` degrees. */
export function hub(labels: readonly string[], { cx = 300, cy = 170, r = 120, start = -90, hubLabel = 'Hub' } = {}): { nodes: TreeNode[]; edges: TreeEdge[] } {
  const nodes: TreeNode[] = [{ id: 'hub', x: cx, y: cy, label: hubLabel, kind: 'hub' }]
  const edges: TreeEdge[] = []
  labels.forEach((label, i) => {
    const a = ((start + (360 / labels.length) * i) * Math.PI) / 180
    nodes.push({ id: `s${i}`, x: cx + Math.cos(a) * r * 1.35, y: cy + Math.sin(a) * r, label, kind: 'leaf' })
    edges.push({ from: 'hub', to: `s${i}`, kind: 'spoke' })
  })
  return { nodes, edges }
}

export interface TreeCardLook {
  glow?: number
  tone?: 'root' | 'ghost' | 'grey'
}

/** `show[id]` for a node, `show["a>b"]` for an edge: 0..1. Missing: hidden. `glow` lights the hub. */
export function Tree({ beat, nodes, edges, show, glow = 0, cards = {}, children }: { beat: Beat; nodes: readonly TreeNode[]; edges: readonly TreeEdge[]; show: Readonly<Record<string, number>>; glow?: number; cards?: Readonly<Record<string, TreeCardLook>>; children?: ReactNode }) {
  const at = new Map(nodes.map((n) => [n.id, n]))
  const branches = nodes.filter((n) => n.kind === 'branch')
  const drawing = (
    <svg className="kit-tree" viewBox="0 0 600 340" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {edges.map((e) => {
        const a = at.get(e.from)
        const b = at.get(e.to)
        if (a === undefined || b === undefined) return null
        const p = clamp(show[`${e.from}>${e.to}`] ?? 0)
        if (p <= 0) return null
        const q = beat.reduced ? 1 : ease.out(p)
        return <line key={`${e.from}>${e.to}`} className={`kit-tree__edge kit-tree__edge--${e.kind ?? 'spoke'}`} x1={a.x} y1={a.y} x2={lerp(a.x, b.x, q)} y2={lerp(a.y, b.y, q)} opacity={beat.reduced ? p : 1} />
      })}
      {nodes.map((n) => {
        const p = clamp(show[n.id] ?? 0)
        if (p <= 0 || n.kind === 'branch') return null
        const s = beat.reduced ? 1 : ease.back(p)
        const kind = n.kind ?? 'leaf'
        return (
          <g key={n.id} transform={`translate(${n.x} ${n.y}) scale(${s.toFixed(4)})`} opacity={clamp(p * 2)}>
            {kind === 'hub' && (
              <>
                {glow > 0 && <circle className="kit-tree__halo" r={30 + 14 * clamp(glow)} opacity={0.5 * clamp(glow)} />}
                <circle className="kit-tree__hub" r={22} />
              </>
            )}
            {kind === 'card' && <rect className="kit-tree__card" x={-22} y={-14} width={44} height={28} rx={5} />}
            {kind === 'leaf' && <circle className="kit-tree__leaf" r={7} />}
            {n.label !== undefined && (
              <text className={`kit-svg-label${kind === 'hub' ? ' kit-svg-label--accent' : ''}`} y={kind === 'hub' ? 44 : kind === 'leaf' ? -15 : 4} textAnchor="middle">
                {n.label}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
  if (branches.length === 0 && children === undefined) return drawing
  return (
    <div className="kit-tree-box">
      {drawing}
      {branches.map((n) => {
        const p = clamp(show[n.id] ?? 0)
        if (p <= 0) return null
        const look = cards[n.id] ?? {}
        const s = beat.reduced ? 1 : lerp(0.6, 1, ease.back(p))
        return (
          <span
            key={n.id}
            className={`kit-tree__branch${look.tone === undefined ? '' : ` kit-tree__branch--${look.tone}`}`}
            style={{
              left: `${((n.x / 600) * 100).toFixed(3)}%`,
              top: `${((n.y / 340) * 100).toFixed(3)}%`,
              opacity: beat.reduced ? p : clamp(p * 2),
              transform: `translate(-50%, -50%) scale(${s.toFixed(4)})`,
              ...glowStyle(look.glow ?? 0),
            }}
          >
            {n.label}
          </span>
        )
      })}
      {children}
    </div>
  )
}
