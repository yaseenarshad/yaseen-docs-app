/**
 * BRAIN CELLS (YAZ-5121): two cells and the link between them, clearly a drawing. Each spaced pulse runs down the
 * first cell's line to the link; when it lands, a switch in the second cell's centre turns on (the genes that build
 * long-term memory), and the link grows thicker. `pulses[i]` is pulse i's run (0..1); `strength` the link's weight.
 */
import { clamp, ease, lerp, type Beat } from './beat'

const A = { x: 150, y: 175 }
const B = { x: 452, y: 175 }
const AXON_END = { x: 318, y: 175 }
const SYNAPSE = { x: 352, y: 175 }

/** A cell body: a soft blob, with its branches. */
function cell(cx: number, cy: number, mirror: boolean) {
  const s = mirror ? -1 : 1
  const branches = [
    [-70, -60],
    [-84, -6],
    [-62, 54],
    [-20, -76],
    [-28, 78],
  ]
  return (
    <g>
      {branches.map(([dx, dy], i) => (
        <path key={i} className="kit-cell__branch" d={`M${cx} ${cy} Q${cx + (s * dx) / 2} ${cy + dy / 3} ${cx + s * dx} ${cy + dy}`} />
      ))}
      <path className="kit-cell__body" d={`M${cx - 34} ${cy} C${cx - 34} ${cy - 30} ${cx + 30} ${cy - 34} ${cx + 34} ${cy - 2} C${cx + 36} ${cy + 28} ${cx - 30} ${cy + 34} ${cx - 34} ${cy} Z`} />
    </g>
  )
}

export function BrainCells({ beat, draw, pulses, strength, switches = [], labels = 0 }: { beat: Beat; draw: number; pulses: readonly number[]; strength: number; switches?: readonly number[]; labels?: number }) {
  const sw = clamp(Math.max(0, ...switches.map((s) => clamp(s))))
  const st = clamp(strength)
  return (
    <svg className="kit-cells" viewBox="0 0 600 340" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <g opacity={clamp(draw * 2)}>
        {cell(A.x, A.y, false)}
        <path className="kit-cell__axon" d={`M${A.x + 34} ${A.y} L${AXON_END.x} ${AXON_END.y}`} />
        <circle className="kit-cell__terminal" cx={AXON_END.x} cy={AXON_END.y} r={9} />
        {cell(B.x, B.y, true)}
        <path className="kit-cell__axon" d={`M${SYNAPSE.x} ${SYNAPSE.y} L${B.x - 34} ${B.y}`} />
        {/* The link: thicker and brighter as it strengthens. */}
        <line className="kit-cell__link" x1={AXON_END.x + 9} y1={A.y} x2={SYNAPSE.x} y2={B.y} style={{ strokeWidth: lerp(1.5, 9, st) }} opacity={lerp(0.35, 1, st)} />
        {st > 0 && <circle className="kit-cell__glow" cx={(AXON_END.x + SYNAPSE.x) / 2} cy={A.y} r={lerp(8, 26, st)} opacity={0.25 * st} />}
        {/* The switch in the second cell's centre: off, then on. */}
        <circle className="kit-cell__nucleus" cx={B.x} cy={B.y} r={11} />
        <circle className="kit-cell__switch" cx={B.x} cy={B.y} r={11} opacity={sw} />
        {!beat.reduced &&
          switches.map((s, i) => {
            const q = clamp(s)
            return q > 0 && q < 1 ? <circle key={i} className="kit-ring" cx={B.x} cy={B.y} r={11 + 26 * ease.out(q)} opacity={0.7 * (1 - q)} /> : null
          })}
        <circle className="kit-cell__nucleus kit-cell__nucleus--a" cx={A.x} cy={A.y} r={11} />
      </g>
      {pulses.map((p, i) => {
        const q = clamp(p)
        if (q <= 0 || q >= 1) return null
        const x = beat.reduced ? AXON_END.x : lerp(A.x + 34, AXON_END.x, ease.inOut(q))
        return <circle key={i} className="kit-cell__pulse" cx={x} cy={A.y} r={7} opacity={beat.reduced ? 1 - q : 1} />
      })}
      <g opacity={clamp(labels)}>
        <text className="kit-svg-note" x={A.x} y={A.y + 112} textAnchor="middle">
          Brain cell
        </text>
        <text className="kit-svg-note" x={B.x} y={B.y + 112} textAnchor="middle">
          Brain cell
        </text>
        <text className="kit-svg-label kit-svg-label--accent" x={(AXON_END.x + SYNAPSE.x) / 2} y={A.y - 40} textAnchor="middle">
          The link
        </text>
      </g>
      <text className="kit-svg-label kit-svg-label--accent" x={B.x} y={B.y - 96} textAnchor="middle" opacity={sw}>
        Memory genes: on
      </text>
    </svg>
  )
}
