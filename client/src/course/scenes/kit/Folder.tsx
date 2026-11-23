/**
 * THE FOLDER (YAZ-5121, chapter 10): a computer's folder, drawn simply, that a card drops into and that closes over it
 * ("one thing, one place"). It is an SVG group, so a scene puts several in one drawing and draws a link between the
 * cards inside them (the link that crosses two shut folders).
 *
 * - `x`, `y`: the folder's top-left in the parent's view; it is 160 × 140 at `scale` 1.
 * - `card`: the title of the card in it; `cardIn` (0..1): the card drops in from above.
 * - `shut` (0..1): the front rises, so only the top of the card shows; `dim`: the folder steps back; `glow`: look here.
 * `cardTop(folder)` gives where the top of its card stands once in, for a line drawn to it.
 */
import { clamp, ease, lerp, type Beat } from './beat'
import './kit.css'

const FOLDER_W = 160
const FOLDER_H = 140
const CARD_W = 108
const CARD_H = 66
/** The card's top inside the folder (its title still shows above the shut front). */
const CARD_IN_Y = 34

interface FolderProps {
  beat: Beat
  x: number
  y: number
  label: string
  scale?: number
  card?: string
  cardIn?: number
  shut?: number
  dim?: number
  glow?: number
  /** 0..1: the folder comes in. */
  p?: number
  /** Many small cards that fall in (an open box of cards): each its `p`, its place across (-1..1) and its tilt. */
  pile?: readonly { p: number; dx: number; tilt: number }[]
}

/** The centre of the top edge of a folder's card, once in, in the parent's view. */
export function cardTop({ x, y, scale = 1 }: Pick<FolderProps, 'x' | 'y' | 'scale'>): [number, number] {
  return [x + (FOLDER_W / 2) * scale, y + CARD_IN_Y * scale]
}

export function Folder({ beat, x, y, label, scale = 1, card, cardIn = 1, shut = 0, dim = 0, glow = 0, p = 1, pile = [] }: FolderProps) {
  const drop = beat.reduced ? (cardIn > 0 ? 1 : 0) : ease.out(clamp(cardIn))
  const cardY = lerp(-92, CARD_IN_Y, drop)
  const close = beat.reduced ? (shut > 0.5 ? 1 : 0) : ease.inOut(clamp(shut))
  const front = lerp(86, 52, close)
  const g = clamp(glow)
  return (
    <g className="kit-folder" transform={`translate(${x} ${y}) scale(${scale})`} opacity={clamp(p * 2) * lerp(1, 0.35, clamp(dim))}>
      {g > 0 && <rect className="kit-folder__glow" x={-8} y={-8} width={FOLDER_W + 16} height={FOLDER_H + 16} rx={18} opacity={0.5 * g} />}
      <path className="kit-folder__back" d={`M6 22 Q6 14 14 14 H58 L70 26 H146 Q154 26 154 34 V${FOLDER_H - 8} Q154 ${FOLDER_H} 146 ${FOLDER_H} H14 Q6 ${FOLDER_H} 6 ${FOLDER_H - 8} Z`} />
      {pile.map((c, i) => {
        if (c.p <= 0) return null
        const d = beat.reduced ? 1 : ease.out(clamp(c.p))
        const py = lerp(-110, 40 + (i % 3) * 6, d)
        return (
          <g key={i} transform={`translate(${(FOLDER_W / 2 + c.dx * 38).toFixed(2)} ${py.toFixed(2)}) rotate(${beat.reduced ? c.tilt : (c.tilt * d).toFixed(2)})`} opacity={clamp(c.p * 3)}>
            <rect className="kit-folder__card" x={-24} y={-16} width={48} height={32} rx={4} />
            <line className="kit-folder__card-line" x1={-15} y1={-5} x2={15} y2={-5} />
          </g>
        )
      })}
      {card !== undefined && cardIn > 0 && (
        <g transform={`translate(${(FOLDER_W - CARD_W) / 2} ${cardY.toFixed(2)})`} opacity={clamp(cardIn * 3)}>
          <rect className="kit-folder__card" width={CARD_W} height={CARD_H} rx={6} />
          <text className="kit-folder__card-title" x={CARD_W / 2} y={17} textAnchor="middle">
            {card}
          </text>
          <line className="kit-folder__card-line" x1={14} y1={32} x2={CARD_W - 14} y2={32} />
          <line className="kit-folder__card-line" x1={14} y1={44} x2={CARD_W - 34} y2={44} />
        </g>
      )}
      <path className="kit-folder__front" d={`M2 ${front + 8} Q2 ${front} 10 ${front} H150 Q158 ${front} 158 ${front + 8} L154 ${FOLDER_H - 8} Q154 ${FOLDER_H} 146 ${FOLDER_H} H14 Q6 ${FOLDER_H} 6 ${FOLDER_H - 8} Z`} />
      <text className="kit-folder__label" x={FOLDER_W / 2} y={FOLDER_H - 18} textAnchor="middle">
        {label}
      </text>
    </g>
  )
}
