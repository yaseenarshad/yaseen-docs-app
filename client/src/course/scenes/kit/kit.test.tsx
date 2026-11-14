/**
 * The scene kit (YAZ-5121): each piece draws, with no error, at progress 0, 0.5 and 1 and at each mark, with and
 * without reduced motion; the beat's helpers are pure; reduced motion never moves a thing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { PAPERS } from '../papers'
import { PROTEIN } from '../cards'
import {
  Answers,
  AppWindow,
  Bars,
  BigNumber,
  BrainCells,
  Calendar,
  CardView,
  Cite,
  Counter,
  Curve,
  Gears,
  IndexCard,
  Keys,
  Medal,
  MenuPreview,
  MiniCard,
  Orb,
  Paper,
  Pointer,
  Ridge,
  SAMPLE_REVIEWS,
  SidebarPreview,
  SlashPreview,
  Stage,
  Tally,
  Timeline,
  ToolbarPreview,
  Tree,
  between,
  beatAt,
  dayAt,
  firedCount,
  hub,
  memory,
  moved,
  pop,
  rise,
  since,
  type Beat,
} from '.'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const MARKS = [0.3, 0.6, 0.8]
const H = hub(['a', 'b', 'c'])

/** Each piece, drawn from a beat (its progress values from the beat, as a scene does). */
const PIECES: Record<string, (b: Beat) => ReactElement> = {
  Paper: (b) => <Paper beat={b} paper={PAPERS.murreDros} at={{ in: 0, highlight: 0.3, lift: 0.6, out: 0.9 }} />,
  Cite: (b) => <Cite beat={b} paper={PAPERS.naqib} p={b.progress} />,
  BigNumber: (b) => <BigNumber beat={b} p={since(b, 0.3, 1)} value={317} label="experiments" />,
  Counter: (b) => <Counter beat={b} p={b.progress} to={28} />,
  Bars: (b) => <Bars beat={b} bars={[{ label: 'Tested', value: 80 }, { label: 'Re-read', value: 36, tone: 'muted' }]} />,
  Tally: (b) => <Tally beat={b} count={317} fill={between(b, 0, 0.6)} win={since(b, 0.8, 0.5)} />,
  'Tally of people': (b) => <Tally beat={b} count={10} shape="person" fill={1} win={b.progress} lit={9} />,
  Curve: (b) => <Curve beat={b} axis={{ days: 45, warp: 0.55 }} axes={1} cursor={45 * b.progress} reviews={SAMPLE_REVIEWS} jumps={b.marks.map((m) => since(b, m, 0.3))} ghost={1} line90={b.progress} />,
  Ridge: (b) => <Ridge beat={b} draw={b.progress} early={since(b, 0.3, 0.5)} late={since(b, 0.6, 0.5)} peak={since(b, 0.8, 0.5)} />,
  CardView: (b) => <CardView beat={b} title={PROTEIN.title} text={PROTEIN.text} links={PROTEIN.links} shown={b.fired} flip={b.progress} flipFrom={{ shown: 0, sides: 1 }} lit={[b.progress]} dim={0.5} grow={[undefined, undefined, undefined, b.progress]} blanks={b.progress} />,
  'CardView, block': (b) => <CardView beat={b} text={PROTEIN.text} chrome="block" editing={b.progress > 0.5} />,
  Timeline: (b) => <Timeline beat={b} stops={[{ day: 2, label: '2 days' }, { day: 11, label: '11 days' }, { day: 46, label: '6 weeks' }, { day: 163, label: '5 months' }]} land={b.marks.map((m) => since(b, m, 0.5))} />,
  Calendar: (b) => <Calendar beat={b} today={13} chips={[{ day: 3, p: b.progress }]} glowToday={b.progress} dim={b.progress} />,
  Tree: (b) => <Tree beat={b} nodes={H.nodes} edges={H.edges} show={Object.fromEntries([...H.nodes.map((n) => [n.id, b.progress]), ...H.edges.map((e) => [`${e.from}>${e.to}`, b.progress])])} glow={b.progress} />,
  BrainCells: (b) => <BrainCells beat={b} draw={1} pulses={b.marks.map((m) => since(b, m, 0.5))} strength={b.progress} switches={[b.progress]} labels={1} />,
  AppFrame: (b) => (
    <AppWindow sidebar={<SidebarPreview inbox={4} inboxGlow={b.progress} rows={[{ name: 'Course Cards', kind: 'folder', open: true }, { name: 'x', kind: 'card', depth: 1, typing: 'Sle' }, { name: 'Notes', kind: 'page', glow: 1 }]} />}>
      <MenuPreview beat={b} items={[{ label: 'New card', active: b.progress }]} x={10} y={10} p={b.progress} />
      <ToolbarPreview beat={b} items={[{ label: 'Hide word', key: '⌘L', active: 1 }]} x={50} y={30} p={b.progress} />
      <SlashPreview beat={b} rows={[{ label: 'New side', key: '⌘⇧↵' }]} x={30} y={40} p={b.progress} />
      <Pointer beat={b} from={[0, 0]} to={[50, 50]} move={b.progress} click={b.progress} />
      <Keys items={[{ keys: 'Cmd L', label: 'hide word' }]} />
    </AppWindow>
  ),
  Answers: (b) => <Answers beat={b} forgot={b.progress} remembered={b.progress} />,
  Drawings: (b) => (
    <>
      <IndexCard lines={['A line']} />
      <MiniCard title="Canberra" />
      <Gears beat={b} p={b.progress} />
      <Medal beat={b} p={b.progress} shine={b.progress} year="2000" />
      <Orb beat={b} stable={b.progress} glow={b.progress} />
    </>
  ),
}

describe('each kit piece draws (YAZ-5121)', () => {
  afterEach(() => {
    document.body.textContent = ''
    vi.restoreAllMocks()
  })
  for (const [name, draw] of Object.entries(PIECES)) {
    it(`${name}: at 0, 0.5, 1 and each mark, with and without reduced motion`, () => {
      const errors = vi.spyOn(console, 'error')
      const el = document.createElement('div')
      document.body.appendChild(el)
      const root = createRoot(el)
      for (const reduced of [false, true]) {
        for (const p of [0, 0.5, 1, ...MARKS]) {
          const b = beatAt(p, 6, MARKS, reduced)
          act(() => root.render(<Stage beat={b}>{draw(b)}</Stage>))
          expect(el.querySelector('.kit-stage')).not.toBeNull()
          if (reduced) for (const node of el.querySelectorAll<HTMLElement>('.kit-paper, .kit-big, .kit-pointer')) expect(node.style.transform, `${name} @ ${p}`).toBe('')
        }
      }
      act(() => root.unmount())
      expect(errors).not.toHaveBeenCalled()
    })
  }
})

describe('the beat (YAZ-5121)', () => {
  it('counts fired marks, and gives a cue the same seconds in a long or a short clip', () => {
    expect(firedCount([0.2, 0.5], 0.5)).toBe(2)
    expect(beatAt(0.45, 6, [0.2, 0.5]).fired).toBe(1)
    expect(since(beatAt(0.5, 2), 0.25, 1)).toBeCloseTo(0.5)
    expect(since(beatAt(0.3, 20), 0.25, 1)).toBeCloseTo(1)
    expect(between(beatAt(0.5), 0.4, 0.6)).toBeCloseTo(0.5)
    expect(between(beatAt(0.1), 0.4, 0.6)).toBe(0)
  })

  it('with reduced motion, geometry snaps and things only fade', () => {
    const b = beatAt(0.5, 6, [], true)
    expect(moved(b, 0.2)).toBe(1)
    expect(moved(b, 0)).toBe(0)
    expect(rise(b, 0.5)).toEqual({ opacity: 0.5 })
    expect(pop(b, 0.5)).toEqual({ opacity: 0.5 })
    expect(rise(beatAt(0.5), 0.5).transform).toMatch(/translateY/)
  })

  it('has a memory model whose 90% day is where the curve meets the line', () => {
    expect(memory(0, 5)).toBe(1)
    expect(memory(dayAt(0.9, 5), 5)).toBeCloseTo(0.9)
  })
})
