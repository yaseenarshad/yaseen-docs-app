/**
 * THE TREE (YAZ-5121): ideas as a drawing. A card is the hub of one idea; what you know about it are its spokes
 * (chapter 2). Later chapters grow it: an umbrella card with branches (chapter 7), links across trees (chapter 10).
 *
 * One piece draws all of them: nodes at positions in a 600 × 340 view, and edges between them. Each node and edge has
 * its own progress (`show`), so a scene grows the tree in step with the words. `hub()` lays out a hub and its spokes.
 */
import { clamp, ease, lerp, type Beat } from './beat'

export interface TreeNode {
  id: string
  x: number
  y: number
  label?: string
  /** `hub`: the card, large; `branch`: a card under an umbrella; `leaf`: a small node; `card`: a small card shape. */
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

/** `show[id]` for a node, `show["a>b"]` for an edge: 0..1. Missing: hidden. `glow` lights the hub. */
export function Tree({ beat, nodes, edges, show, glow = 0 }: { beat: Beat; nodes: readonly TreeNode[]; edges: readonly TreeEdge[]; show: Readonly<Record<string, number>>; glow?: number }) {
  const at = new Map(nodes.map((n) => [n.id, n]))
  return (
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
        if (p <= 0) return null
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
            {kind === 'branch' && <rect className="kit-tree__card" x={-34} y={-20} width={68} height={40} rx={7} />}
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
}
