/**
 * The kit's pieces for chapters 9 to 12 (YAZ-5121): each is a pure drawing of its beat. The light of `Web` spreads one
 * step of the network at a time; the folder takes its card; the crowd lights and doubts; the garden drops a pruned
 * branch; the agent's chat types and asks; the app's parts show their real words. Each draws at 0, 0.5 and 1, with
 * and without reduced motion, and reduced motion moves nothing (no translate in a style).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beatAt, type Beat } from './beat'
import { Habits } from './HabitIcons'
import { Web, webDistances, scatterWeb, type WebEdge, type WebNode } from './Web'
import { Folder } from './Folder'
import { AgentChat, typedText } from './AgentChat'
import { CardPill, FilterMenu, LinkPicker, LinkedMentions, ReviewsStrip, Terminal } from './AppPanels'
import { Garden, Profile, Seedling, type PlantSpec } from './Garden'
import { Crowd, GuessBars } from './Crowd'
import { ClockArc, Gauge } from './Dials'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

function draw(node: ReactElement): HTMLDivElement {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  act(() => root.render(node))
  return el
}
afterEach(() => {
  document.body.textContent = ''
})

const NODES: WebNode[] = [
  { id: 'a', x: 100, y: 100 },
  { id: 'b', x: 200, y: 100 },
  { id: 'c', x: 300, y: 100 },
  { id: 'd', x: 400, y: 100 },
]
const EDGES: WebEdge[] = [
  { from: 'a', to: 'b' },
  { from: 'b', to: 'c' },
  { from: 'c', to: 'd' },
]
const PLANT: PlantSpec = { x: 300, h: 160, branches: [{ at: 0.4, dir: -1, len: 50, up: 20 }, { at: 0.7, dir: 1, len: 40, up: 16 }] }

const pieces = (b: Beat, p: number): ReactElement[] => [
  <Habits key="h" beat={b} show={[p, p, p]} lit={[p, 0, 0]} notes={['a', undefined, 'c']} noteP={[p, 0, p]} />,
  <Web key="w" beat={b} nodes={NODES} edges={EDGES} all={p} source="a" spread={p} />,
  <svg key="f">
    <Folder beat={b} x={0} y={0} label="Food" card="Protein" cardIn={p} shut={p} pile={[{ p, dx: 0, tilt: 5 }]} />
  </svg>,
  <AgentChat key="c" beat={b} lines={[{ who: 'you', text: 'Find links.', p }, { who: 'agent', text: 'Here is one.', p, ask: { title: 'Link A to B', reason: 'why', read: p, answer: 'yes', answerP: p } }]} />,
  <LinkPicker key="l" beat={b} p={p} rows={[{ label: 'A page', kind: 'page' }, { label: 'A card', kind: 'card', active: p }]} />,
  <LinkedMentions key="m" beat={b} count={3} rows={[{ label: 'Protein', p }]} p={p} />,
  <FilterMenu key="fm" beat={b} p={p} counts={{ all: '1', next: '0', due: '1', new: '10 / 48', archived: '0' }} adding={{ n: 10, p }} enter={p} />,
  <ReviewsStrip key="r" beat={b} open={p} rows={[{ when: '1 Nov', answer: 'forgot', gone: p }, { when: '3 Nov', answer: 'remembered' }]} />,
  <Terminal key="t" beat={b} lines={[{ kind: 'cmd', text: 'yaseendocs card guide', p }, { kind: 'out', text: 'Start here', p }]} />,
  <Garden key="g" beat={b} plants={[PLANT, { ...PLANT, x: 500 }]} grow={[p, p]} weeds={1 - p} prune={{ plant: 0, branch: 1, p }} links={[{ a: [0, 0], b: [1, 0], p, cut: p / 2 }]} />,
  <Seedling key="s" beat={b} grow={p} />,
  <Profile key="pr" beat={b} glow={p} />,
  <Crowd key="cr" beat={b} appear={p} won={9} wonP={p} doubt={7} doubtP={p} doubtText="I think it lost" wonText="Spacing won" wonTextP={p} />,
  <GuessBars key="gb" beat={b} guess={50} guessLabel="About half" guessP={p} bars={[{ label: 'A', value: 80, text: '80%', p }]} missP={p} />,
  <Gauge key="ga" beat={b} p={p} value={0.1} swing={p} label="Kept" />,
  <ClockArc key="cl" beat={b} p={p} arcs={[{ from: 0, to: 15, p }]} label="15–20 min" labelP={p} />,
]

describe('the kit for chapters 9 to 12 (YAZ-5121)', () => {
  for (const reduced of [false, true])
    it(`draws each piece at 0, 0.5 and 1${reduced ? ', reduced motion: nothing travels' : ''}`, () => {
      for (const p of [0, 0.5, 1]) {
        const el = draw(<div>{pieces(beatAt(p, 6, [], reduced), p)}</div>)
        expect(el.innerHTML.includes('NaN'), `${p}`).toBe(false)
        if (reduced) for (const node of el.querySelectorAll<HTMLElement>('[style]')) expect(/translate|rotate/.test(node.style.transform), node.className).toBe(false)
        el.remove()
      }
    })

  it('spreads the light one step of the network at a time', () => {
    expect([...webDistances(NODES, EDGES, 'a').entries()]).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
      ['d', 3],
    ])
    const lit = (spread: number) => [...draw(<Web beat={beatAt(0.5)} nodes={NODES} edges={EDGES} source="a" spread={spread} />).querySelectorAll('[data-lit]')].length
    expect(lit(0)).toBe(0)
    expect(lit(0.2)).toBe(1)
    expect(lit(0.45)).toBe(2)
    expect(lit(1)).toBe(4)
  })

  it('makes the same calm scatter each time', () => {
    expect(scatterWeb(8, { seed: 3 })).toEqual(scatterWeb(8, { seed: 3 }))
    expect(scatterWeb(8).nodes).toHaveLength(8)
  })

  it('lights nine people and gives seven a sign', () => {
    const el = draw(<Crowd beat={beatAt(1)} appear={1} won={9} wonP={1} doubt={7} doubtP={1} doubtText="I think it lost" />)
    expect(el.querySelectorAll('.kit-crowd__person')).toHaveLength(10)
    expect(el.querySelectorAll('.kit-crowd__person[data-lit]')).toHaveLength(9)
    expect(el.querySelectorAll('.kit-crowd__sign')).toHaveLength(7)
    expect(el.textContent).toContain('I think it lost')
  })

  it('drops a pruned branch: gone once the cut is through', () => {
    const branches = (p: number) => draw(<Garden beat={beatAt(1)} plants={[PLANT]} grow={[1]} prune={{ plant: 0, branch: 1, p }} />).querySelectorAll('.kit-garden__branch').length
    expect(branches(0)).toBe(2)
    expect(branches(1)).toBe(1)
  })

  it('types the person’s line, and asks with Yes and Skip', () => {
    expect(typedText(beatAt(0.5), 'abcd', 0.5)).toBe('ab')
    expect(typedText(beatAt(0.5, 6, [], true), 'abcd', 0.1)).toBe('abcd')
    const el = draw(<AgentChat beat={beatAt(1)} lines={[{ who: 'you', text: 'Find links.', p: 1 }, { who: 'agent', text: 'One:', p: 1, ask: { title: 'Link A to B', answer: 'yes', answerP: 1, yes: 'Yes, add it' } }]} />)
    expect(el.querySelector('.kit-chat__ask')?.getAttribute('data-answer')).toBe('yes')
    expect(el.querySelector('.kit-chat__btn--yes')?.textContent).toBe('✓ Yes, add it')
  })

  it('shows the app’s words: the card pill, Linked mentions, the All cards menu', () => {
    const pill = draw(<CardPill title="How muscle grows" id="DEMO-12" />)
    expect(pill.querySelector('.wikilink--card')?.textContent).toBe('How muscle growsDEMO-12')
    expect(pill.querySelector('.wikilink__card-id')?.textContent).toBe('DEMO-12')
    expect(draw(<LinkedMentions beat={beatAt(1)} count={12} rows={[]} />).textContent).toContain('Linked mentions (12)')
    const menu = draw(<FilterMenu beat={beatAt(1)} p={1} counts={{ all: '24', next: '2 / 5', due: '12', new: '10 / 48', archived: '1' }} />)
    expect([...menu.querySelectorAll('.kit-filter__name')].map((n) => n.textContent)).toEqual(['All cards', 'Up next', 'Due today', 'New cards', 'Archived'])
    const adding = draw(<FilterMenu beat={beatAt(1)} p={1} counts={{ all: '24', next: '2 / 5', due: '12', new: '10 / 48', archived: '1' }} adding={{ n: 10, p: 1 }} />)
    expect(adding.textContent).toContain('Add 10 more new cards')
  })
})
