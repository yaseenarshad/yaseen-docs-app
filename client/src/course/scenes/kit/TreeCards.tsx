/**
 * THE TREE OF CARDS (YAZ-5121, chapter 7; for chapters 10 and 11 too): the kit's `Tree` draws the branches, and each
 * node is a small card with its title (HTML, so a long title wraps and stays sharp). The box keeps the Tree's own
 * 600 × 340 shape, so a card sits exactly on its node at any stage size.
 *
 * - `nodes`, `edges`, `show`: as `Tree` (`show["a>b"]` grows a branch). A node's card shows from `show[id]`.
 * - `cards[id]`: the card's look: `glow` (look here), `tone` (`root`: the umbrella; `ghost`: not made yet; `grey`).
 * Reduced motion: the branches and cards cross-fade; nothing grows or pops.
 */
import type { CSSProperties, ReactNode } from 'react'
import { Tree, type TreeEdge, type TreeNode } from './Tree'
import { clamp, ease, lerp, type Beat } from './beat'
import './kit68.css'

export interface TreeCardLook {
  glow?: number
  tone?: 'root' | 'ghost' | 'grey'
}

export function TreeCards({ beat, nodes, edges, show, cards = {}, style, children }: { beat: Beat; nodes: readonly TreeNode[]; edges: readonly TreeEdge[]; show: Readonly<Record<string, number>>; cards?: Readonly<Record<string, TreeCardLook>>; style?: CSSProperties; children?: ReactNode }) {
  // The Tree draws only the branches: its own node shapes stay hidden under the cards.
  const edgeShow: Record<string, number> = {}
  for (const e of edges) edgeShow[`${e.from}>${e.to}`] = show[`${e.from}>${e.to}`] ?? 0
  return (
    <div className="kit-treecards" style={style}>
      <Tree beat={beat} nodes={nodes} edges={edges} show={edgeShow} />
      {nodes.map((n) => {
        const p = clamp(show[n.id] ?? 0)
        if (p <= 0) return null
        const look = cards[n.id] ?? {}
        const g = clamp(look.glow ?? 0)
        const s = beat.reduced ? 1 : lerp(0.6, 1, ease.back(p))
        return (
          <span
            key={n.id}
            className={`kit-treecard${look.tone === undefined ? '' : ` kit-treecard--${look.tone}`}`}
            style={{
              left: `${((n.x / 600) * 100).toFixed(3)}%`,
              top: `${((n.y / 340) * 100).toFixed(3)}%`,
              opacity: beat.reduced ? p : clamp(p * 2),
              transform: `translate(-50%, -50%) scale(${s.toFixed(4)})`,
              boxShadow: g > 0 ? `0 0 0 ${(2.5 * g).toFixed(2)}px var(--accent), 0 0 ${(20 * g).toFixed(1)}px color-mix(in srgb, var(--accent) 45%, transparent)` : undefined,
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
