/**
 * THE GARDEN (YAZ-5121, chapters 11 and 12): the trees of cards from chapters 7 and 10, as plants in a bed. Each leaf
 * is a small card. A gardener clears the weeds, prunes a branch (it falls away) and grows a new one; dashed links join
 * leaves across plants. Also the SEEDLING (the best time to start is now) and the PROFILE (a head in profile: the mind
 * as a web in chapter 10, and the card that settles into the person at the very end). All drawings, 600 × 340.
 */
import type { ReactNode } from 'react'
import { clamp, ease, lerp, type Beat } from './beat'
import './kitMore.css'

interface Branch {
  /** Where on the trunk it starts, 0 (ground) to 1 (top). */
  at: number
  dir: -1 | 1
  len: number
  /** How far its tip rises above its start. */
  up: number
}

export interface PlantSpec {
  x: number
  h: number
  branches: readonly Branch[]
  /** The leaf on the trunk's top: a card title, or none. */
  top?: string
}

const GROUND = 300

/** The tip of a branch (or the trunk's top with `branch` -1), in the garden's view. */
export function tipOf(plant: PlantSpec, branch: number): [number, number] {
  if (branch < 0) return [plant.x, GROUND - plant.h]
  const b = plant.branches[branch]
  return [plant.x + b.dir * b.len, GROUND - plant.h * b.at - b.up]
}

function Leaf({ x, y, p, beat, accent = false, label }: { x: number; y: number; p: number; beat: Beat; accent?: boolean; label?: string }) {
  if (p <= 0) return null
  const s = beat.reduced ? 1 : ease.back(clamp(p))
  return (
    <g transform={`translate(${x} ${y}) scale(${s.toFixed(4)})`} opacity={clamp(p * 2)}>
      <rect className={`kit-garden__leaf${accent ? ' kit-garden__leaf--accent' : ''}`} x={-14} y={-9} width={28} height={18} rx={4} />
      <line className="kit-garden__leaf-line" x1={-8} y1={-2} x2={8} y2={-2} />
      <line className="kit-garden__leaf-line" x1={-8} y1={3} x2={3} y2={3} />
      {label !== undefined && (
        <text className="kit-svg-page kit-garden__label" y={-14} textAnchor="middle">
          {label}
        </text>
      )}
    </g>
  )
}

interface GardenProps {
  beat: Beat
  plants: readonly PlantSpec[]
  /** Per plant, 0..1: it grows (the trunk, then its branches in order). */
  grow: readonly number[]
  /** 0..1: weeds at the plants' feet (1: there; 0: cleared). */
  weeds?: number
  /** A branch that is cut and falls: `p` 0..1. */
  prune?: { plant: number; branch: number; p: number }
  /** Links between two tips (`[plant, branch]`, branch -1 = the top), drawn over `p`; `cut` cuts one (it falls apart). */
  links?: readonly { a: readonly [number, number]; b: readonly [number, number]; p: number; cut?: number }[]
  /** Per plant: which branch is lit (the accent leaf). */
  lit?: readonly (readonly [number, number])[]
  /** The ground line comes in. */
  ground?: number
  children?: ReactNode
}

export function Garden({ beat, plants, grow, weeds = 0, prune, links = [], lit = [], ground = 1, children }: GardenProps) {
  const isLit = (pi: number, bi: number): boolean => lit.some(([p, b]) => p === pi && b === bi)
  return (
    <svg className="kit-garden" viewBox="0 0 600 340" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <line className="kit-garden__ground" x1={30} y1={GROUND} x2={lerp(30, 570, beat.reduced ? (ground > 0 ? 1 : 0) : ease.out(clamp(ground)))} y2={GROUND} opacity={clamp(ground * 2)} />
      {plants.map((plant, pi) => {
        const g = clamp(grow[pi] ?? 0)
        if (g <= 0) return null
        const n = plant.branches.length
        // The trunk takes the first third of the growth; each branch then its share.
        const trunk = beat.reduced ? 1 : ease.out(clamp(g * 3))
        const top = GROUND - plant.h * trunk
        return (
          <g key={pi} className="kit-garden__plant">
            <line className="kit-garden__trunk" x1={plant.x} y1={GROUND} x2={plant.x} y2={top} />
            {plant.branches.map((b, bi) => {
              const bp = beat.reduced ? (g > 0.33 + (bi / Math.max(1, n)) * 0.6 ? 1 : 0) : clamp((g - 0.33 - (bi / Math.max(1, n)) * 0.6) * n * 1.6)
              if (bp <= 0) return null
              const cut = prune !== undefined && prune.plant === pi && prune.branch === bi ? clamp(prune.p) : 0
              if (cut >= 1) return null
              const [sx, sy] = [plant.x, GROUND - plant.h * b.at]
              const [tx, ty] = tipOf(plant, bi)
              const e = beat.reduced ? 1 : ease.out(bp)
              const fall = beat.reduced ? 0 : ease.inOut(cut)
              return (
                <g key={bi} opacity={1 - (beat.reduced ? cut : cut * cut)} transform={fall > 0 ? `translate(${(b.dir * 18 * fall).toFixed(2)} ${(70 * fall).toFixed(2)}) rotate(${(b.dir * 40 * fall).toFixed(2)} ${sx} ${sy})` : undefined}>
                  <path className="kit-garden__branch" d={`M${sx} ${sy} Q${lerp(sx, tx, 0.6)} ${sy} ${lerp(sx, tx, e)} ${lerp(sy, ty, e)}`} />
                  <Leaf beat={beat} x={tx} y={ty} p={clamp((bp - 0.6) * 2.5)} accent={isLit(pi, bi)} />
                </g>
              )
            })}
            <Leaf beat={beat} x={plant.x} y={top - 10} p={clamp((g - 0.25) * 4)} accent={isLit(pi, -1)} label={plant.top} />
          </g>
        )
      })}
      {weeds > 0 &&
        plants.map((plant, pi) =>
          [-26, 22].map((dx, wi) => (
            <path key={`${pi}-${wi}`} className="kit-garden__weed" d={`M${plant.x + dx} ${GROUND} q-4 -12 2 -20 M${plant.x + dx} ${GROUND} q5 -9 10 -12 M${plant.x + dx} ${GROUND} q-8 -5 -12 -8`} opacity={clamp(weeds) * clamp((grow[pi] ?? 0) * 3)} />
          )),
        )}
      {links.map((link, i) => {
        const pa = plants[link.a[0]]
        const pb = plants[link.b[0]]
        if (pa === undefined || pb === undefined || link.p <= 0) return null
        const [ax, ay] = tipOf(pa, link.a[1])
        const [bx, by] = tipOf(pb, link.b[1])
        const q = beat.reduced ? 1 : ease.out(clamp(link.p))
        const cut = clamp(link.cut ?? 0)
        if (cut > 0) {
          const mx = (ax + bx) / 2
          const my = (ay + by) / 2
          const drop = beat.reduced ? 0 : 30 * ease.inOut(cut)
          return (
            <g key={i} opacity={1 - cut}>
              <line className="kit-garden__link" x1={ax} y1={ay} x2={mx - 6} y2={my - 6 + drop} />
              <line className="kit-garden__link" x1={mx + 6} y1={my + 6 + drop} x2={bx} y2={by} />
            </g>
          )
        }
        return <line key={i} className="kit-garden__link" x1={ax} y1={ay} x2={lerp(ax, bx, q)} y2={lerp(ay, by, q)} opacity={beat.reduced ? clamp(link.p) : 1} />
      })}
      {children}
    </svg>
  )
}

/** A seedling: fresh soil, then a stem that rises and two leaves that open (`grow` 0..1). */
export function Seedling({ beat, grow, soil = 1 }: { beat: Beat; grow: number; soil?: number }) {
  const g = beat.reduced ? (grow > 0 ? 1 : 0) : ease.out(clamp(grow))
  const stem = lerp(0, 74, clamp(g * 1.5))
  const leaf = clamp((g - 0.45) * 2.2)
  return (
    <svg className="kit-seedling" viewBox="0 0 600 340" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <path className="kit-seedling__soil" d="M170 300 Q300 236 430 300 Z" opacity={clamp(soil * 2)} />
      <path className="kit-seedling__stem" d={`M300 272 Q296 ${272 - stem * 0.5} 300 ${272 - stem}`} opacity={stem > 0 ? 1 : 0} />
      {leaf > 0 && (
        <g transform={`translate(300 ${272 - stem})`} opacity={clamp(leaf * 2)}>
          <path className="kit-seedling__leaf" d={`M0 0 Q${-30 * leaf} ${-26 * leaf} ${-54 * leaf} ${-8 * leaf} Q${-26 * leaf} ${8 * leaf} 0 0Z`} />
          <path className="kit-seedling__leaf" d={`M0 0 Q${30 * leaf} ${-30 * leaf} ${58 * leaf} ${-14 * leaf} Q${28 * leaf} ${6 * leaf} 0 0Z`} />
        </g>
      )}
    </svg>
  )
}
