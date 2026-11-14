/**
 * CHAPTER 12, "Where things are, and your first week" (YAZ-5121): the send-off. The card skill at the bottom of the
 * sidebar (read only: its lock; duplicate it to make it your own; the copy syncs, the built-in one updates with the
 * app); `yaseendocs card guide` in a terminal; Settings › Cards; the first week as seven days; a seedling; and the
 * finale: the course's main pictures one last time (the curve, the hub, the tree, the garden), then a card that
 * settles into the person, and the end screen (`finale.tsx`). A quiet finish, not a firework.
 */
import { useUnit } from '../../vault/unitWord'
import type { SceneProps } from '../scene'
import { CARD_SKILL_MENU } from '../../sidebar/menuSections'
import { InboxIcon, LockIcon } from '../../views/view/icons'
import { AgentTerminal, AppWindow, cardSkillMenuItems, Curve, Layer, MenuPreview, MiniCard, SAMPLE_REVIEWS, Stage, Tree, Words, between, clamp, cue, ease, hub, lerp, moved, pop, rise, showFor, since, useBeat, type Beat, Habits, HabitGlyph, Garden, Seedling, Head, Web, type WebNode } from './kit'
import { GARDEN } from './care'
import type { ChapterScenes } from './registry'
import './whereThingsAre.css'

/** One row of the sidebar copy: a folder, a page or a card, with the card skill's lock. */
interface Row {
  name: string
  kind: 'folder' | 'card' | 'page'
  depth?: number
  open?: boolean
  lock?: boolean
  glow?: number
  p?: number
  active?: boolean
}

/** The sidebar, as `SidebarPreview` draws it, with the card skill's row at the bottom (its lock, as `Tree.tsx` has it). */
function SkillSidebar({ rows, skill }: { rows: readonly Row[]; skill: readonly Row[] }) {
  const row = (r: Row, i: number) => {
    const p = r.p === undefined ? 1 : clamp(r.p)
    if (p <= 0) return null
    const g = clamp(r.glow ?? 0)
    return (
      <li key={`${r.name}-${i}`} style={{ opacity: p }}>
        <span
          className={`tree__row ${r.kind === 'folder' ? 'tree__row--dir' : 'tree__row--file'}${r.active === true ? ' tree__row--active' : ''} kit-glowable`}
          style={{ paddingLeft: 8 + (r.depth ?? 0) * 14, ...(g > 0 ? { boxShadow: `0 0 0 ${(2 * g).toFixed(2)}px var(--accent), 0 0 ${(18 * g).toFixed(1)}px color-mix(in srgb, var(--accent) 45%, transparent)` } : {}) }}
        >
          {r.kind === 'folder' ? <span className={`tree__chevron${r.open === true ? ' tree__chevron--open' : ''}`} /> : <span className="kit-app__spacer" />}
          <span className={`kit-app__icon kit-app__icon--${r.kind}`} aria-hidden="true" />
          <span className="tree__label">{r.name}</span>
          {r.lock === true && (
            <span className="later-lock" aria-label="Read only" role="img">
              <LockIcon size={12} />
            </span>
          )}
        </span>
      </li>
    )
  }
  return (
    <div className="sidebar kit-app__sidebar later-sidebar">
      <div className="sidebar__inbox">
        <InboxIcon className="sidebar__inbox-icon" />
        <span className="sidebar__inbox-name">Inbox</span>
        <span className="tree__count sidebar__inbox-count">4</span>
      </div>
      <ul className="tree kit-app__tree">{rows.map(row)}</ul>
      <ul className="tree kit-app__tree later-sidebar__foot">{skill.map(row)}</ul>
    </div>
  )
}

const FORMATS = ['concept', 'fact', 'person', 'procedure', 'quote', 'vocabulary']

/** c12-01 to c12-05, one span: the habits, then the sidebar; the card skill at its bottom; what is in it; read only,
 * duplicate it; the copy syncs, the built-in one updates. */
function CardSkill(props: SceneProps) {
  const b = useBeat(props)
  const id = props.clip.id
  const at = (c: string) => id === c
  const habits = at('c12-01') ? 1 - since(b, cue(b, 0, 0.29) - 0.04, 0.5) : 0
  const app = at('c12-01') ? since(b, cue(b, 0, 0.29), 0.6) : 1
  const week = at('c12-01') ? since(b, cue(b, 1, 0.71), 0.6) : 0
  const skillGlow = at('c12-02') ? since(b, cue(b, 0, 0.47) - 0.05, 0.6) : at('c12-03') ? 1 - since(b, 0.1, 0.5) : 0
  const open = at('c12-03') ? since(b, 0.02, 0.6) : at('c12-01') || at('c12-02') ? 0 : 1
  const rules = at('c12-03') ? since(b, cue(b, 0, 0.38), 0.4) : 1
  const formats = at('c12-03') ? since(b, cue(b, 1, 0.54), 0.4) : 1
  const words = at('c12-03') ? since(b, cue(b, 2, 0.76), 0.4) : 1
  const lock = at('c12-04') ? showFor(since(b, cue(b, 0, 0.07), 0.3), since(b, 0.3, 0.4)) : 0
  const menu = at('c12-04') ? showFor(since(b, cue(b, 1, 0.44) - 0.12, 0.3), since(b, cue(b, 2, 0.77) - 0.06, 0.3)) : 0
  const copy = at('c12-04') ? since(b, cue(b, 2, 0.77) - 0.04, 0.6) : at('c12-05') ? 1 : 0
  const syncs = at('c12-05') ? since(b, cue(b, 0, 0.12), 0.5) : 0
  const updates = at('c12-05') ? since(b, cue(b, 2, 0.79), 0.5) : 0
  const rows: Row[] = [
    { name: 'Course Cards', kind: 'folder' },
    { name: 'Projects', kind: 'folder' },
    { name: 'Card skill', kind: 'folder', glow: at('c12-04') ? showFor(copy, 0) : at('c12-05') ? showFor(syncs, since(b, 0.5, 0.4)) : 0, p: copy },
  ]
  const skill: Row[] = [
    { name: 'Card skill', kind: 'folder', open: open > 0.5, lock: true, glow: Math.max(skillGlow, lock, at('c12-05') ? showFor(updates, 0) : 0), active: open > 0.5 },
    { name: 'Start here', kind: 'page', depth: 1, p: open },
    { name: 'formats', kind: 'folder', depth: 1, p: open * formats },
    { name: 'Rules for a good card', kind: 'page', depth: 1, p: open * rules },
    { name: 'Course transcript', kind: 'page', depth: 1, p: open * words },
  ]
  return (
    <Stage beat={b} label={at('c12-01') ? 'To finish: where things are, and your first week' : at('c12-02') ? 'The card skill is at the bottom of the sidebar' : at('c12-03') ? 'The card skill: the rules, the formats with examples, and the words of this course' : at('c12-04') ? 'It is read only: duplicate it into your vault to make it your own' : 'Your copy syncs with your vault; the built-in skill still updates with the app'}>
      <Layer style={{ opacity: habits }}>
        <Habits beat={b} show={[1, 1, 1]} lit={[1, 1, 1]} />
      </Layer>
      <Layer style={{ opacity: app }}>
        <AppWindow
          sidebar={<SkillSidebar rows={rows} skill={skill} />}
          label="The sidebar, with the card skill at the bottom"
          over={<MenuPreview beat={b} x={22} y={52} p={menu} items={cardSkillMenuItems('My vault', { [CARD_SKILL_MENU.duplicate('My vault')]: since(b, cue(b, 1, 0.44), 0.3) })} />}
        >
          {open > 0 && (
            <div className="kit-app__tab later-skill" style={rise(b, open, 10)}>
              <p className="kit-app__bigtitle">Start here</p>
              <p className="later-skill__line">A short guide for you and your agent on how to make good cards.</p>
              <ul className="later-skill__list">
                <li style={rise(b, rules, 6)}>
                  <span className="kit-app__icon kit-app__icon--page" aria-hidden="true" /> Rules for a good card
                </li>
                <li style={rise(b, formats, 6)}>
                  <span className="kit-app__icon kit-app__icon--folder" aria-hidden="true" /> formats
                  <span className="later-skill__formats">
                    {FORMATS.map((f, i) => (
                      <span key={f} className="kit-chip" style={pop(b, clamp(formats * 3 - i * 0.3), 0.7)}>
                        {f}
                      </span>
                    ))}
                  </span>
                </li>
                <li style={rise(b, words, 6)}>
                  <span className="kit-app__icon kit-app__icon--page" aria-hidden="true" /> Course transcript
                </li>
              </ul>
              {(at('c12-04') || at('c12-05')) && (
                <p className="later-skill__ro" style={pop(b, at('c12-04') ? since(b, cue(b, 0, 0.07), 0.5) : 1)}>
                  <LockIcon size={13} /> Read only: duplicate it into your vault to change it.
                </p>
              )}
              {at('c12-05') && (
                <div className="kit-tags">
                  <span className="kit-chip" style={pop(b, syncs)}>
                    Your copy syncs with your vault
                  </span>
                  <span className="kit-chip" style={pop(b, updates)}>
                    ↻ The built-in skill updates with the app
                  </span>
                </div>
              )}
            </div>
          )}
        </AppWindow>
      </Layer>
      <Layer place="bottom" style={{ opacity: week * 0.6 }}>
        <div className="later-week later-week--small">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
            <span key={i} className="later-week__day">
              {d}
            </span>
          ))}
        </div>
      </Layer>
    </Stage>
  )
}

/** c12-06: your agent can find it too: `yaseendocs card guide` prints the skill's first page. */
function Guide(props: SceneProps) {
  const unit = useUnit()
  const b = useBeat(props)
  const cmd = cue(b, 0, 0.47)
  const prints = cue(b, 1, 0.63)
  const out = (i: number) => since(b, prints + i * 0.03, 0.4)
  return (
    <Stage beat={b} label={unit("One command prints the card skill's first page: yaseendocs card guide")}>
      <Layer>
        <Words size="kicker" style={rise(b, since(b, 0, 0.5))}>
          Your agent can find it too
        </Words>
        <AgentTerminal
          beat={b}
          title="Terminal"
          caret={b.progress < prints}
          lines={[
            { kind: 'cmd', text: 'yaseendocs card guide', p: between(b, cmd - 0.08, prints - 0.02) },
            { kind: 'head', text: '# Start here', p: out(0) },
            { kind: 'out', text: 'This skill tells you, or your AI agent, how to make good cards.', p: out(1) },
            { kind: 'head', text: '## What a card is', p: out(2) },
            { kind: 'out', text: 'A card is a short text that the app asks you to recall on a schedule.', p: out(3) },
          ]}
        />
      </Layer>
    </Stage>
  )
}

/** The Settings list as the app has it, short (YAZ-5271: the section is Cards, was Review, YAZ-5154). */
const NAV = ['General', 'Editor', 'Sidebar', 'Cards', 'Sync']

/** c12-07: Settings › Cards: the card skill switch, and Open the course. */
function SettingsCards(props: SceneProps) {
  const b = useBeat(props)
  const review = cue(b, 0, 0.16)
  const sw = cue(b, 1, 0.29)
  const course = cue(b, 2, 0.69)
  const showHide = since(b, sw + 0.12, 0.3) > 0.5 && b.progress < sw + 0.3 ? 'Hide' : 'Show'
  return (
    <Stage beat={b} label="Settings › Cards: one switch shows or hides the card skill; Open the course brings you back here">
      <Layer>
        <div className="later-settings" style={rise(b, since(b, 0, 0.5), 10)}>
          <ul className="later-settings__nav">
            {NAV.map((n) => (
              <li key={n} data-on={n === 'Cards' && since(b, review, 0.3) > 0.5 ? 'true' : undefined}>
                {n}
              </li>
            ))}
          </ul>
          <div className="later-settings__page" style={{ opacity: lerp(0.35, 1, since(b, review, 0.4)) }}>
            <p className="later-settings__title">Cards</p>
            <div className="later-settings__row">
              <span>Use cards in this vault</span>
              <span className="later-seg">
                <b data-on="true">On</b>
                <b>Off</b>
              </span>
            </div>
            <div className="later-settings__row kit-glowable" style={since(b, sw, 0.4) > 0 ? { boxShadow: `0 0 0 ${(2 * showFor(since(b, sw, 0.4), since(b, course - 0.05, 0.4))).toFixed(2)}px var(--accent)` } : undefined}>
              <span>Card skill in the sidebar</span>
              <span className="later-seg">
                <b data-on={showHide === 'Show' ? 'true' : undefined}>Show</b>
                <b data-on={showHide === 'Hide' ? 'true' : undefined}>Hide</b>
              </span>
            </div>
            <div className="later-settings__row kit-glowable" style={since(b, course, 0.4) > 0 ? { boxShadow: `0 0 0 ${(2 * since(b, course, 0.4)).toFixed(2)}px var(--accent)` } : undefined}>
              <span>Card course</span>
              <span className="course__btn">Open the course</span>
            </div>
          </div>
        </div>
      </Layer>
    </Stage>
  )
}

const DAYS = ['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5', 'Day 6', 'Day 7']
const COL = (i: number) => 50 + i * 100

/** A small card on the week's drawing, at (x, y), coming in over `p`. */
function WeekCard({ beat, x, y, p, accent = false }: { beat: Beat; x: number; y: number; p: number; accent?: boolean }) {
  if (p <= 0) return null
  return (
    <g transform={`translate(${x} ${y}) scale(${beat.reduced ? 1 : ease.back(clamp(p)).toFixed(4)})`} opacity={clamp(p * 2)}>
      <rect className={`later-wk__card${accent ? ' later-wk__card--accent' : ''}`} x={-26} y={-16} width={52} height={32} rx={5} />
      <line className="kit-folder__card-line" x1={-16} y1={-5} x2={16} y2={-5} />
      <line className="kit-folder__card-line" x1={-16} y1={5} x2={4} y2={5} />
    </g>
  )
}

/** c12-08, c12-09, c12-10, c12-11, c12-16 and c12-12, one span: the first week, as seven days. */
function FirstWeek(props: SceneProps) {
  const b = useBeat(props)
  const id = props.clip.id
  const order = ['c12-08', 'c12-09', 'c12-10', 'c12-11', 'c12-16', 'c12-12']
  const step = order.indexOf(id)
  const past = (c: string) => order.indexOf(c) < step
  const at = (c: string) => id === c
  const days = at('c12-08') ? between(b, cue(b, 0, 0.33) - 0.1, 0.85) : 1
  const first = at('c12-09') ? since(b, cue(b, 0, 0.28), 0.6) : past('c12-09') ? 1 : 0
  const well = at('c12-09') ? since(b, cue(b, 1, 0.67), 0.5) : 0
  const inbox = at('c12-10') ? between(b, cue(b, 0, 0.21) - 0.05, 0.9) : past('c12-10') ? 1 : 0
  const answered = at('c12-10') ? between(b, cue(b, 1, 0.56) - 0.1, 0.95) : past('c12-10') ? 1 : 0
  const capture = at('c12-11') ? between(b, cue(b, 0, 0.07), 0.55) : past('c12-11') ? 1 : 0
  const desk = at('c12-11') ? since(b, cue(b, 1, 0.6), 0.5) : past('c12-11') ? 1 : 0
  const few = at('c12-11') ? since(b, cue(b, 2, 0.74), 0.8) : past('c12-11') ? 1 : 0
  const ask = at('c12-16') ? since(b, cue(b, 0, 0.36), 0.5) : 0
  const link = at('c12-16') ? since(b, cue(b, 1, 0.74), 0.8) : past('c12-16') ? 1 : 0
  const fix = at('c12-12') ? between(b, cue(b, 0, 0.16) - 0.05, 0.6) : 0
  const yours = at('c12-12') ? since(b, cue(b, 2, 0.81), 0.6) : 0
  const L = b.reduced ? (link > 0 ? 1 : 0) : ease.inOut(link)
  // The link from a new card on day 5 back to day 1's card.
  const [x0, y0] = [COL(4) + 18, 196]
  const [x1, y1] = [COL(0) + 22, 160]
  return (
    <Stage beat={b} label={['Your first week', 'Today, make one card from something you understand well', 'Each day, open the Inbox and answer what is due', 'Keep one place to capture; once this week, make a few cards from it', 'For each new card, ask what it connects to, and link it', 'As you review, fix what is unclear: that is tending'][Math.max(0, step)]}>
      <Layer>
        <svg className="later-weekart" viewBox="0 0 700 300" aria-hidden="true">
          {DAYS.map((d, i) => {
            const p = b.reduced ? (days > 0 ? 1 : 0) : clamp(days * 8 - i)
            const lit = i === 0 ? first : 0
            const inb = b.reduced ? (inbox > 0 && i > 0 ? 1 : 0) : clamp(inbox * 7 - (i - 1))
            const ans = b.reduced ? (answered > 0 && i > 0 ? 1 : 0) : clamp(answered * 7 - (i - 1))
            const fx = i > 0 && i % 2 === 0 ? (b.reduced ? (fix > 0 ? 1 : 0) : clamp(fix * 4 - i / 2 + 1)) : 0
            return (
              <g key={d} opacity={clamp(p * 2)} transform={`translate(0 ${b.reduced ? 0 : ((1 - ease.out(p)) * 12).toFixed(2)})`}>
                <rect className="later-wk__col" data-lit={lit > 0.5 || yours > 0.5 ? 'true' : undefined} x={COL(i) - 44} y={20} width={88} height={262} rx={10} />
                <text className="kit-svg-label" x={COL(i)} y={44} textAnchor="middle">
                  {d}
                </text>
                {i > 0 && inb > 0 && (
                  <g transform={`translate(${COL(i) - 12} 64)`} opacity={clamp(inb * 2)}>
                    <path className={`later-wk__inbox${inb >= 1 ? ' is-on' : ''}`} d="M1 13 4 3h16l3 10v8H1Z M1 13h6l1.5 3h7l1.5-3h6" />
                    {ans > 0.5 && (
                      <text className="later-wk__tick" x={30} y={18}>
                        ✓
                      </text>
                    )}
                  </g>
                )}
                {fx > 0 && (
                  <g transform={`translate(${COL(i) - 14} 102) scale(0.6)`} opacity={fx} className="later-wk__shears">
                    <circle cx={14} cy={36} r={6} />
                    <circle cx={34} cy={36} r={6} />
                    <path d="M18 31 37 6M30 31 11 6" />
                  </g>
                )}
                {capture > 0 && (
                  <line className="later-wk__capture" x1={COL(i) - 30} y1={258} x2={COL(i) - 30 + 60 * clamp(capture * 7 - i)} y2={258} />
                )}
              </g>
            )
          })}
          {capture > 0 && (
            <text className="kit-svg-page" x={10} y={252} opacity={clamp(capture * 3)}>
              Capture
            </text>
          )}
          <WeekCard beat={b} x={COL(0)} y={160} p={first} accent />
          {desk > 0 && (
            <g transform={`translate(${COL(4) - 12} 110)`} opacity={desk} className="later-wk__pen">
              <path d="M17 3 21 7 9 19 4 20 5 15Z" />
            </g>
          )}
          <WeekCard beat={b} x={COL(4)} y={160} p={few} />
          <WeekCard beat={b} x={COL(4)} y={196} p={clamp(few * 2 - 0.4)} accent={ask > 0.5 || link > 0} />
          <WeekCard beat={b} x={COL(4)} y={232} p={clamp(few * 2 - 0.8)} />
          {link > 0 && <path className="later-wk__link" d={`M${x0} ${y0} C${x0 - 120} ${y0 + 70 * L} ${x1 + 120} ${y1 + 80 * L} ${lerp(x0, x1, L)} ${lerp(y0, y1, L)}`} />}
        </svg>
      </Layer>
      <Layer place="bottom">
        {at('c12-09') && (
          <span className="kit-chip" style={pop(b, well)}>
            From something you understand well
          </span>
        )}
        {at('c12-16') && (
          <span className="kit-chip" style={pop(b, ask)}>
            What does it connect to?
          </span>
        )}
        {at('c12-12') && (
          <span className="kit-chip" style={pop(b, since(b, cue(b, 1, 0.49), 0.5))}>
            <HabitGlyph habit="tend" size={14} /> Tending
          </span>
        )}
      </Layer>
    </Stage>
  )
}

/** c12-13: years ago, a tree that could have been; now, a seedling in fresh soil. */
function Now(props: SceneProps) {
  const b = useBeat(props)
  const ago = cue(b, 0, 0.37)
  const second = cue(b, 1, 0.53)
  const now = cue(b, 2, 0.83)
  return (
    <Stage beat={b} label="The best time to start was years ago. The second best time is now">
      <Layer style={{ opacity: showFor(since(b, 0.05, 0.6), since(b, ago + 0.1, 0.6)) * 0.4 }}>
        <Garden beat={b} plants={[GARDEN[0]]} grow={[1]} ground={0} />
      </Layer>
      <Layer>
        <Seedling beat={b} grow={since(b, second - 0.02, 1.8)} soil={since(b, ago, 0.6)} />
      </Layer>
      <Layer place="top">
        <Words size="display" tone="accent" style={rise(b, since(b, now, 0.6))}>
          Now.
        </Words>
      </Layer>
    </Stage>
  )
}

/** c12-14: that is the whole course; one card today; the page turns to tomorrow and the Inbox lights. */
function Tomorrow(props: SceneProps) {
  const b = useBeat(props)
  const card = cue(b, 0, 0.32)
  const turn = cue(b, 1, 0.65)
  const light = cue(b, 2, 0.73)
  const flip = since(b, turn - 0.04, 0.7)
  const f = b.reduced ? (flip > 0.5 ? 1 : 0) : ease.inOut(flip)
  return (
    <Stage beat={b} label="Make one card today. Open the Inbox tomorrow">
      <Layer>
        <div className="kit-row">
          <div className="later-page-cal" style={{ transform: b.reduced ? undefined : `perspective(600px) rotateX(${(f < 0.5 ? f * 2 * -80 : (1 - f) * 2 * 80).toFixed(1)}deg)` }}>
            <span className="later-page-cal__top" />
            <span className="later-page-cal__day">{f >= 0.5 ? 'Tomorrow' : 'Today'}</span>
            {f < 0.5 && <MiniCard title="Your one card" style={pop(b, since(b, card, 0.6), 0.6)} />}
          </div>
          <div className="later-inbox-row kit-glowable" style={{ opacity: lerp(0.3, 1, since(b, light, 0.5)), boxShadow: `0 0 0 ${(2 * since(b, light, 0.5)).toFixed(2)}px var(--accent), 0 0 ${(22 * since(b, light, 0.5)).toFixed(1)}px color-mix(in srgb, var(--accent) 45%, transparent)` }}>
            <InboxIcon className="sidebar__inbox-icon" />
            <span>Inbox</span>
            {since(b, light, 0.5) > 0.5 && <span className="tree__count sidebar__inbox-count">1</span>}
          </div>
        </div>
      </Layer>
    </Stage>
  )
}

const HUB_ART = hub(['', '', '', '', ''], { r: 100 })
const TREE_ART: WebNode[] = [
  { id: 'u', x: 300, y: 70, kind: 'card' },
  { id: 'a', x: 200, y: 180, kind: 'card' },
  { id: 'b', x: 400, y: 180, kind: 'card' },
  { id: 'c', x: 400, y: 280, kind: 'card' },
]

/**
 * c12-15: the finale, quiet. The course's pictures come back one by one on the words (the curve on "card base", the
 * hub on "knowledge base", the tree on "build it", the garden on "one card at a time"). Then they go, and the head
 * draws in alone: one card comes up into it as a small steady light, as in chapter 5, and the mind warms ("becomes part
 * of who you are"). Each thing has its own time and place: nothing sits on another. The caption says the last line;
 * the layer's end screen lists the cards the course made (`CourseEnd`).
 */
function Finale(props: SceneProps) {
  const b = useBeat(props)
  const hubAt = cue(b, 0, 0.19)
  const treeAt = cue(b, 1, 0.34)
  const gardenAt = cue(b, 2, 0.55)
  const partOf = cue(b, 3, 0.74)
  const tiles = [since(b, 0.01, 0.8), since(b, hubAt, 0.8), since(b, treeAt, 0.8), since(b, gardenAt - 0.08, 0.8)]
  const go = since(b, partOf - 0.16, 0.6)
  const head = since(b, partOf - 0.1, 1)
  return (
    <Stage beat={b} label="Your card base is your knowledge base: the curve, the hub, the tree, the garden; and what you learn becomes part of who you are">
      {go < 1 && (
        <Layer style={{ opacity: 1 - go }}>
          <div className="later-tiles">
            <div className="later-tile" style={rise(b, tiles[0], 8)}>
              <Curve beat={b} axis={{ days: 45, warp: 0.55 }} axes={0.5} cursor={45} reviews={SAMPLE_REVIEWS.map((r) => ({ ...r, label: undefined }))} jumps={[1, 1, 1, 1]} yLabel="" xLabel="" today={false} />
            </div>
            <div className="later-tile" style={rise(b, tiles[1], 8)}>
              <Tree beat={b} nodes={HUB_ART.nodes.map((n) => ({ ...n, label: undefined }))} edges={HUB_ART.edges} show={Object.fromEntries([...HUB_ART.nodes.map((n) => [n.id, 1]), ...HUB_ART.edges.map((e) => [`${e.from}>${e.to}`, 1])])} glow={tiles[1]} />
            </div>
            <div className="later-tile" style={rise(b, tiles[2], 8)}>
              <Web beat={b} nodes={TREE_ART} edges={[{ from: 'u', to: 'a' }, { from: 'u', to: 'b' }, { from: 'b', to: 'c' }]} />
            </div>
            <div className="later-tile" style={rise(b, tiles[3], 8)}>
              <Garden beat={b} plants={GARDEN} grow={GARDEN.map((_, i) => since(b, gardenAt - 0.08 + i * 0.04, 1.2))} links={[{ a: [0, 1], b: [2, 0], p: since(b, gardenAt + 0.06, 0.8) }]} />
            </div>
          </div>
        </Layer>
      )}
      {head > 0 && (
        <Layer>
          <Head beat={b} p={head} className="kit-head--large" light={{ arrive: between(b, partOf - 0.04, partOf + 0.08) }} glow={since(b, partOf + 0.04, 1.6)} />
        </Layer>
      )}
    </Stage>
  )
}

export const WHERE_THINGS_ARE_SCENES: ChapterScenes = {
  chapter: 'where-things-are',
  entries: [
    { clips: ['c12-01', 'c12-02', 'c12-03', 'c12-04', 'c12-05'], scene: CardSkill },
    { clips: ['c12-06'], scene: Guide },
    { clips: ['c12-07'], scene: SettingsCards },
    { clips: ['c12-08', 'c12-09', 'c12-10', 'c12-11', 'c12-16', 'c12-12'], scene: FirstWeek },
    { clips: ['c12-13'], scene: Now },
    { clips: ['c12-14'], scene: Tomorrow },
    { clips: ['c12-15'], scene: Finale },
  ],
}
