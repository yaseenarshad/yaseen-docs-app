/**
 * THE WEB (YAZ-5121, chapters 10 to 12): ideas as a network, not boxes. Dots (or small cards) and the lines between
 * them, in a 600 × 340 view, as `Tree` has; and the one thing `Tree` has not: SPREADING ACTIVATION. Light starts at
 * `source` and runs along the lines, one step of the network at a time, so the ideas linked to it light up after it
 * (Collins & Loftus 1975, chapter 10). A pulse travels along each line as the light crosses it.
 *
 * - `show[id]` (a node) and `show["a>b"]` (a line): 0..1, how far it is drawn in. Missing: `all` (default 1).
 * - `source`, `spread` (0..1): the light from one node, over the whole network's depth.
 * - `lit[id]`: extra light on a node (a node that fits and stays lit, a hub).
 * - `kind`: `dot` (an idea), `card` (a small card with its title), `hub` (a bigger card that many lines come into).
 * With reduced motion the lines appear whole, nothing grows, and no pulse travels: the light cross-fades.
 */
import { clamp, ease, lerp, type Beat } from './beat'
import './kitMore.css'

export interface WebNode {
  id: string
  x: number
  y: number
  label?: string
  kind?: 'dot' | 'card' | 'hub'
}

export interface WebEdge {
  from: string
  to: string
  /** `link`: an accent line (a card link); `faint`: an association. */
  kind?: 'link' | 'faint'
}

/** A card node's width: room for its title (12px type), and never under `min`. */
const cardW = (n: WebNode, min: number): number => Math.max(min, Math.round((n.label?.length ?? 0) * 6.7 + 20))

/** Steps from `source` to each node over the edges (both ways). Unreachable nodes are left out. */
export function webDistances(nodes: readonly WebNode[], edges: readonly WebEdge[], source: string): Map<string, number> {
  const next = new Map<string, string[]>(nodes.map((n) => [n.id, []]))
  for (const e of edges) {
    next.get(e.from)?.push(e.to)
    next.get(e.to)?.push(e.from)
  }
  const dist = new Map<string, number>([[source, 0]])
  const queue = [source]
  while (queue.length > 0) {
    const at = queue.shift()!
    for (const n of next.get(at) ?? []) {
      if (dist.has(n)) continue
      dist.set(n, dist.get(at)! + 1)
      queue.push(n)
    }
  }
  return dist
}

export function Web({
  beat,
  nodes,
  edges,
  show,
  all = 1,
  source,
  spread = 0,
  lit = {},
  className,
  label,
}: {
  beat: Beat
  nodes: readonly WebNode[]
  edges: readonly WebEdge[]
  show?: Readonly<Record<string, number>>
  all?: number
  source?: string
  spread?: number
  lit?: Readonly<Record<string, number>>
  className?: string
  label?: string
}) {
  const at = new Map(nodes.map((n) => [n.id, n]))
  const dist = source === undefined ? new Map<string, number>() : webDistances(nodes, edges, source)
  const depth = Math.max(0, ...dist.values())
  // The light's front, in steps of the network: 0 at the source, depth + 1 when every reachable node is lit.
  const front = clamp(spread) * (depth + 1)
  const lightOf = (id: string): number => {
    const d = dist.get(id)
    const spreadLight = d === undefined || spread <= 0 ? 0 : clamp(front - d)
    return Math.max(spreadLight, clamp(lit[id] ?? 0))
  }
  const shown = (key: string): number => clamp(show?.[key] ?? all)
  return (
    <svg className={`kit-web${className === undefined ? '' : ` ${className}`}`} viewBox="0 0 600 340" preserveAspectRatio="xMidYMid meet" role={label === undefined ? undefined : 'img'} aria-label={label} aria-hidden={label === undefined ? 'true' : undefined}>
      {edges.map((e) => {
        const a = at.get(e.from)
        const b = at.get(e.to)
        if (a === undefined || b === undefined) return null
        const key = `${e.from}>${e.to}`
        const p = shown(key)
        if (p <= 0) return null
        const q = beat.reduced ? 1 : ease.out(p)
        // The light crosses the line from its nearer end to its farther one.
        const da = dist.get(e.from)
        const db = dist.get(e.to)
        const near = da === undefined || db === undefined ? undefined : Math.min(da, db)
        const t = near === undefined || spread <= 0 ? 0 : clamp(front - near)
        const [from, to] = da !== undefined && db !== undefined && db < da ? [b, a] : [a, b]
        const cross = Math.abs((da ?? 0) - (db ?? 0)) > 0
        const lightLine = cross ? t : 0
        return (
          <g key={key}>
            <line className={`kit-web__edge kit-web__edge--${e.kind ?? 'faint'}`} x1={a.x} y1={a.y} x2={lerp(a.x, b.x, q)} y2={lerp(a.y, b.y, q)} opacity={beat.reduced ? p : 1} />
            {lightLine > 0 && <line className="kit-web__edge kit-web__edge--lit" x1={from.x} y1={from.y} x2={lerp(from.x, to.x, beat.reduced ? 1 : lightLine)} y2={lerp(from.y, to.y, beat.reduced ? 1 : lightLine)} opacity={beat.reduced ? lightLine : 1} />}
            {!beat.reduced && lightLine > 0 && lightLine < 1 && <circle className="kit-web__pulse" cx={lerp(from.x, to.x, lightLine)} cy={lerp(from.y, to.y, lightLine)} r={5} />}
          </g>
        )
      })}
      {nodes.map((n) => {
        const p = shown(n.id)
        if (p <= 0) return null
        const l = lightOf(n.id)
        const s = beat.reduced ? 1 : ease.back(p)
        const kind = n.kind ?? 'dot'
        return (
          <g key={n.id} className={`kit-web__node kit-web__node--${kind}`} data-lit={l > 0.5 ? 'true' : undefined} transform={`translate(${n.x} ${n.y}) scale(${s.toFixed(4)})`} opacity={clamp(p * 2)}>
            {l > 0 && <circle className="kit-web__halo" r={kind === 'hub' ? 46 : kind === 'card' ? 36 : 20} opacity={(0.42 * l).toFixed(3)} />}
            {kind === 'dot' && <circle className="kit-web__dot" r={8} style={{ fillOpacity: lerp(0.12, 1, l) }} />}
            {kind === 'card' && <rect className="kit-web__card" x={-cardW(n, 76) / 2} y={-15} width={cardW(n, 76)} height={30} rx={6} style={{ strokeOpacity: lerp(0.5, 1, l) }} />}
            {kind === 'hub' && <rect className="kit-web__card kit-web__card--hub" x={-cardW(n, 104) / 2} y={-20} width={cardW(n, 104)} height={40} rx={8} />}
            {n.label !== undefined && (
              <text className={`kit-svg-label kit-web__label${l > 0.5 ? ' kit-svg-label--accent' : ''}`} y={kind === 'dot' ? -16 : 5} textAnchor="middle">
                {n.label}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

/** A loose, made-up network: `n` dots in a calm scatter (the same each time), with lines between near ones. */
export function scatterWeb(n: number, { seed = 7, links = 2, w = 600, h = 340, pad = 40 } = {}): { nodes: WebNode[]; edges: WebEdge[] } {
  let s = seed
  const rand = (): number => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
  const nodes: WebNode[] = []
  for (let i = 0; i < n; i++) nodes.push({ id: `n${i}`, x: Math.round(lerp(pad, w - pad, rand())), y: Math.round(lerp(pad, h - pad, rand())) })
  const edges: WebEdge[] = []
  const seen = new Set<string>()
  for (const a of nodes) {
    const near = nodes
      .filter((b) => b !== a)
      .map((b) => ({ b, d: Math.hypot(a.x - b.x, a.y - b.y) }))
      .sort((p, q) => p.d - q.d)
      .slice(0, links)
    for (const { b } of near) {
      const key = [a.id, b.id].sort().join('|')
      if (seen.has(key)) continue
      seen.add(key)
      edges.push({ from: a.id, to: b.id })
    }
  }
  return { nodes, edges }
}
