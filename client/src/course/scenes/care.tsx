/**
 * CHAPTER 11, "Be a gardener" (YAZ-5121). The trees and their links become a garden: clear it, prune it, grow it.
 * Fixing is learning; a card that keeps turning red; the agent fixes the file while you keep reviewing; a scheduled
 * agent proposes and you approve each change (only approved ones land); Archive and Unarchive; a part that keeps
 * growing lifts off into its own card; tend the links; Up next; the review history; more new cards today. The cues are
 * `marks` in `script.ts`, from the real voice's word times.
 */
import type { SceneProps } from '../scene'
import { SLEEP_DEBT, TOO_MUCH, PROTEIN_BRANCH } from './cardsLater'
import { Answers, CardView, Fit, Keys, Layer, MenuPreview, Pointer, Stage, Words, between, clamp, cue, ease, lerp, moved, pop, rise, showFor, since, useBeat } from './kit'
import { Habits, HabitGlyph } from './kit/HabitIcons'
import { Garden, type PlantSpec } from './kit/Garden'
import { AgentChat } from './kit/AgentChat'
import { FilterMenu, ReviewsStrip, type ReviewRow } from './kit/AppPanels'
import { Web } from './kit/Web'
import { ArchiveIcon, UpNextIcon } from '../../review/cardInboxIcons'
import type { ChapterScenes } from './registry'
import './later.css'

/** The garden: chapter 10's two trees and a third, as plants. */
export const GARDEN: readonly PlantSpec[] = [
  {
    x: 120,
    h: 170,
    top: 'Protein, carbs and fat',
    branches: [
      { at: 0.35, dir: -1, len: 52, up: 26 },
      { at: 0.55, dir: 1, len: 58, up: 22 },
      { at: 0.78, dir: -1, len: 44, up: 18 },
    ],
  },
  {
    x: 310,
    h: 140,
    top: 'Sleep',
    branches: [
      { at: 0.4, dir: 1, len: 50, up: 24 },
      { at: 0.7, dir: -1, len: 46, up: 20 },
    ],
  },
  {
    x: 490,
    h: 180,
    top: 'Strength training',
    branches: [
      { at: 0.3, dir: -1, len: 56, up: 28 },
      { at: 0.55, dir: 1, len: 50, up: 22 },
      { at: 0.8, dir: -1, len: 42, up: 16 },
    ],
  },
]
const GARDEN_LINKS = [
  { a: [0, 1] as const, b: [2, 0] as const },
  { a: [1, 0] as const, b: [2, 1] as const },
]

/** c11-01, c11-02 and c11-03, one span: trees joined by links; a gardener clears and prunes; a fix is learning too. */
function Gardener(props: SceneProps) {
  const b = useBeat(props)
  const id = props.clip.id
  const grow = id === 'c11-01' ? GARDEN.map((_, i) => since(b, i * 0.05, 1.6)) : GARDEN.map(() => 1)
  const links = id === 'c11-01' ? since(b, cue(b, 0, 0.31), 0.9) : 1
  const review = id === 'c11-01' ? since(b, cue(b, 1, 0.57), 0.6) : 0
  const weeds = id === 'c11-01' ? 0 : id === 'c11-02' ? lerp(since(b, 0.2, 0.6), 0, since(b, cue(b, 1, 0.65), 0.7)) : 0
  const prune = id === 'c11-02' ? since(b, cue(b, 2, 0.8), 0.9) : id === 'c11-03' ? 1 : 0
  const fix = id === 'c11-03' ? since(b, 0, 0.6) : 0
  const reword = id === 'c11-03' ? since(b, cue(b, 0, 0.26), 0.8) : 0
  const learning = id === 'c11-03' ? since(b, cue(b, 1, 0.82), 0.6) : 0
  const gardenOut = Math.max(review * 0.8, fix * 0.88)
  return (
    <Stage beat={b} label={id === 'c11-01' ? 'Your cards form trees, joined by links: tend them as you review' : id === 'c11-02' ? 'A gardener clears the garden and prunes it' : 'Each fix makes you think about the idea again: that is learning too'}>
      <Layer style={{ opacity: 1 - gardenOut }}>
        <Garden beat={b} plants={GARDEN} grow={grow} weeds={weeds} prune={{ plant: 2, branch: 2, p: prune }} links={GARDEN_LINKS.map((l) => ({ ...l, p: links }))} lit={id === 'c11-02' ? [[0, -1], [1, -1], [2, -1]] : []} />
      </Layer>
      {id === 'c11-02' && (
        <Layer place="top">
          <span className="kit-chip" style={pop(b, showFor(since(b, cue(b, 1, 0.65), 0.4), since(b, cue(b, 2, 0.8), 0.4)))}>
            Clear
          </span>
          <span className="kit-chip" style={pop(b, since(b, cue(b, 2, 0.8), 0.4))}>
            Prune
          </span>
        </Layer>
      )}
      {review > 0 && (
        <Layer style={{ opacity: review }}>
          <div className="kit-row">
            <Fit>
              <CardView beat={b} title={SLEEP_DEBT.title} id={SLEEP_DEBT.id} text={SLEEP_DEBT.text} sides={1} state="Due today" className="kit-cardview--small" />
            </Fit>
            <Habits beat={b} show={[0, 0, 1]} lit={[0, 0, since(b, cue(b, 1, 0.57) + 0.08, 0.5)]} size="small" />
          </div>
        </Layer>
      )}
      {fix > 0 && (
        <Layer style={{ opacity: fix }}>
          <div className="card later-reword" style={{ boxShadow: `0 0 ${(30 * showFor(reword, learning * 0.5)).toFixed(1)}px color-mix(in srgb, var(--accent) 35%, transparent)` }}>
            <p className="later-reword__old" style={{ opacity: 1 - reword }}>
              Sleep debt: the thing about missed hours.
            </p>
            <p className="later-reword__new" style={rise(b, reword, 8)}>
              Each hour of sleep you miss adds to your <span className="card__blank later-blank">sleep debt</span>.
            </p>
          </div>
          <span className="kit-chip" style={pop(b, learning)}>
            Thinking about it again: learning
          </span>
        </Layer>
      )}
    </Stage>
  )
}

/** c11-04: a card that keeps turning red; a magnifying glass over its wording: unclear, or too much at once. */
function KeepMissing(props: SceneProps) {
  const b = useBeat(props)
  const look = cue(b, 1, 0.31)
  const unclear = cue(b, 2, 0.55)
  const tooMuch = cue(b, 3, 0.71)
  const answers: ('forgot' | 'remembered')[] = ['forgot', 'forgot', 'remembered', 'forgot']
  const marks = answers.map((_, i) => since(b, 0.02 + i * 0.05, 0.4))
  const red = answers.reduce((r, a, i) => (a === 'forgot' ? Math.max(r, showFor(marks[i], since(b, 0.06 + i * 0.05, 0.3))) : r), 0)
  const glass = since(b, look - 0.04, 0.8)
  const gx = b.reduced ? 1 : ease.inOut(between(b, look - 0.04, unclear + 0.1))
  return (
    <Stage beat={b} label="A card you keep missing: often it is unclear, or it asks too much at once">
      <Layer>
        <div className="later-misses" aria-hidden="true">
          {answers.map((a, i) => (
            <span key={i} className={`later-miss later-miss--${a}`} style={pop(b, marks[i], 0.5)}>
              {a === 'forgot' ? '✕' : '✓'}
            </span>
          ))}
        </div>
        <div className="later-redcard" style={{ boxShadow: `0 0 0 ${(3 * red).toFixed(2)}px var(--danger), 0 0 ${(26 * red).toFixed(1)}px color-mix(in srgb, var(--danger) 40%, transparent)` }}>
          <Fit>
            <CardView beat={b} title={TOO_MUCH.title} id={TOO_MUCH.id} text={TOO_MUCH.text} sides={1} state="Due today" blanks={showFor(since(b, tooMuch, 0.4), 0) * (b.reduced ? 1 : 0.6 + 0.4 * Math.sin(b.t * 5) ** 2)} />
          </Fit>
          {glass > 0 && (
            <svg className="later-glass" viewBox="0 0 80 80" aria-hidden="true" style={{ opacity: glass, left: `${lerp(8, 62, gx).toFixed(1)}%` }}>
              <circle cx={32} cy={32} r={22} />
              <line x1={48} y1={48} x2={72} y2={72} />
            </svg>
          )}
        </div>
        <div className="kit-tags">
          <span className="kit-chip" style={pop(b, since(b, unclear, 0.5))}>
            Unclear?
          </span>
          <span className="kit-chip" style={pop(b, since(b, tooMuch, 0.5))}>
            Four blanks at once
          </span>
        </div>
      </Layer>
    </Stage>
  )
}

/** c11-06 and c11-05, one span: tell your agent the fix and keep reviewing (each card is a file); or Edit card, E, Escape. */
function FixIt(props: SceneProps) {
  const b = useBeat(props)
  const id = props.clip.id
  const agent = id === 'c11-06'
  const tell = cue(b, 0, 0.16)
  const keep = cue(b, 1, 0.42)
  const file = cue(b, 2, 0.65)
  const edited = agent ? since(b, file + 0.06, 0.8) : 0
  // c11-05: Edit card (a click), then E in the Inbox, then Escape.
  const click = cue(b, 0, 0.3)
  const eKey = cue(b, 1, 0.53)
  const esc = cue(b, 2, 0.79)
  const editing = !agent && ((b.progress >= click + 0.04 && b.progress < eKey - 0.04) || (b.progress >= eKey + 0.03 && b.progress < esc + 0.03))
  const inbox = !agent && b.progress >= eKey - 0.04
  return (
    <Stage beat={b} label={agent ? 'Tell your agent what to change, and keep reviewing: each card is a file' : 'Or do it yourself: Edit card, or E in the Inbox; Escape when you are done'}>
      {agent ? (
        <Layer>
          <div className="kit-row">
            <div className="later-tend__card">
              <Fit>
                <CardView beat={b} title={b.progress >= keep + 0.06 ? PROTEIN_BRANCH.title : TOO_MUCH.title} id={b.progress >= keep + 0.06 ? PROTEIN_BRANCH.id : TOO_MUCH.id} text={b.progress >= keep + 0.06 ? PROTEIN_BRANCH.text : TOO_MUCH.text} sides={1} state="Due today" className="kit-cardview--small" />
                <Answers beat={b} forgot={1} remembered={1} chosen={showFor(since(b, keep, 0.3), since(b, keep + 0.06, 0.2)) > 0.3 ? 'remembered' : null} />
              </Fit>
            </div>
            <div className="later-stack">
              <AgentChat beat={b} lines={[{ who: 'you', text: 'Make the Sleep card clearer: one idea, one blank.', p: between(b, tell, tell + 0.2) }, { who: 'agent', text: 'Done. Here is the change.', p: since(b, file - 0.04, 0.5) }]} style={{ width: 'min(46cqw, 24em)' }} />
              <div className="later-file" style={rise(b, since(b, file, 0.6), 10)}>
                <p className="later-file__name">sleep.md</p>
                <p className="later-file__del" style={{ opacity: 1 - edited * 0.4 }}>
                  - {'{{Sleep debt}}'} builds when {'{{nights are short}}'}, and …
                </p>
                <p className="later-file__add" style={{ opacity: edited }}>
                  + Each hour of sleep you miss adds to your {'{{sleep debt}}'}.
                </p>
              </div>
            </div>
          </div>
        </Layer>
      ) : (
        <Layer>
          <div className="later-editswap">
            {editing ? (
              <div className="card card--editing kit-editcard later-editcard">
                <div className="card__head">
                  <span className="card__id">{SLEEP_DEBT.id}</span>
                  <span className="card__edit">
                    Done <kbd>esc</kbd>
                  </span>
                  <span className="card__more">⋯</span>
                </div>
                <div className="kit-editcard__text">
                  <p>
                    Each hour of sleep you miss adds to your <span className="card__cloze">sleep debt</span>.
                  </p>
                </div>
              </div>
            ) : (
              <Fit>
                <CardView beat={b} title={SLEEP_DEBT.title} id={SLEEP_DEBT.id} text={SLEEP_DEBT.text} sides={1} chrome={inbox ? 'inbox' : 'block'} state="Due today" className="kit-cardview--small" />
              </Fit>
            )}
            <Pointer beat={b} from={[80, 90]} to={[78, 12]} move={between(b, 0.12, click - 0.02)} click={since(b, click - 0.02, 0.4)} show={1 - since(b, click + 0.08, 0.4)} />
          </div>
          <Keys p={since(b, eKey - 0.04, 0.4)} items={[{ keys: 'E', label: 'Edit card, in the Inbox' }, ...(b.progress >= esc - 0.04 ? [{ keys: 'esc', label: 'Done' }] : [])]} />
        </Layer>
      )}
    </Stage>
  )
}

const MORNINGS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']

/** c11-15, c11-16 and c11-17, one span: a scheduled agent wakes each morning; it reads and proposes; you approve each change. */
function Scheduled(props: SceneProps) {
  const b = useBeat(props)
  const id = props.clip.id
  const days = id === 'c11-15' ? since(b, cue(b, 1, 0.48) - 0.1, 1.6) : 1
  const wake = id === 'c11-15' ? since(b, cue(b, 2, 0.72), 0.6) : 1
  const reads = id === 'c11-16' ? since(b, cue(b, 0, 0.2), 1.4) : id === 'c11-17' ? 1 : 0
  const fixes = id === 'c11-16' ? since(b, cue(b, 1, 0.42), 0.6) : id === 'c11-17' ? 1 : 0
  const newLinks = id === 'c11-16' ? since(b, cue(b, 2, 0.73), 0.6) : id === 'c11-17' ? 1 : 0
  const approve = id === 'c11-17' ? since(b, cue(b, 0, 0.09), 0.4) : 0
  const skip = id === 'c11-17' ? since(b, cue(b, 1, 0.3), 0.4) : 0
  const lands = id === 'c11-17' ? since(b, cue(b, 2, 0.48), 0.7) : 0
  return (
    <Stage beat={b} label={id === 'c11-15' ? 'A scheduled agent runs by itself at set times' : id === 'c11-16' ? 'It reads your card base and proposes fixes, or new links' : 'You approve each change by hand; only approved ones land'}>
      <Layer place="top">
        <div className="later-days" style={{ opacity: id === 'c11-15' ? since(b, 0.05, 0.6) : 0.55 }}>
          {MORNINGS.map((d, i) => (
            <span key={d} className="later-day" data-on={clamp(days * 5 - i) > 0.5 ? 'true' : undefined}>
              <b>{d}</b> 7:00
            </span>
          ))}
        </div>
      </Layer>
      <Layer style={{ paddingTop: '8%' }}>
        <div className="kit-row">
          <div className="later-stack" style={{ opacity: id === 'c11-15' ? wake : 1 }}>
            <AgentChat
              beat={b}
              title="Your agent · scheduled"
              when="7:00"
              style={{ width: 'min(60cqw, 30em)' }}
              lines={[
                { who: 'agent', text: 'Good morning. Reading your card base.', p: wake },
                { who: 'agent', text: 'One card asks too much at once:', p: fixes, ask: { title: 'Make the Sleep card’s clue clearer', reason: 'four blanks in one line', answer: 'yes', answerP: approve, yes: 'Approve' } },
                { who: 'agent', text: 'Two cards connect:', p: newLinks, ask: { title: 'Link Protein to How muscle grows', reason: 'muscle is built from protein', answer: 'skip', answerP: skip, yes: 'Approve' } },
              ]}
            />
          </div>
          {id !== 'c11-15' && (
            <div className="later-base" style={rise(b, since(b, 0, 0.5))}>
              <p className="later-base__title">Your card base</p>
              <div className="later-base__grid">
                {['Sleep', 'Protein', 'How muscle grows', 'Calories', 'candid', 'Rest days'].map((t, i) => (
                  <span key={t} className="later-base__card" data-scan={reads > 0 && reads < 1 && Math.floor(reads * 6) === i ? 'true' : undefined} data-changed={t === 'Sleep' && lands > 0.5 ? 'true' : undefined}>
                    {t}
                    {t === 'Sleep' && lands > 0.5 ? ' ✓' : ''}
                  </span>
                ))}
              </div>
              <p className="later-base__note">{id === 'c11-17' && lands > 0.5 ? 'Only what you approved changed.' : 'Nothing changes on its own.'}</p>
            </div>
          )}
        </div>
      </Layer>
    </Stage>
  )
}

const MENU = (archive: number, upNext = 0) => [
  { label: 'Put at top of Inbox', active: upNext },
  { label: 'Archive card', active: archive },
  { label: 'Title on the front', rule: true },
  { label: 'Reset history' },
]

const HISTORY: ReviewRow[] = [
  { when: '3 Nov', answer: 'remembered' },
  { when: '1 Nov', answer: 'forgot' },
  { when: '30 Oct', answer: 'remembered' },
  { when: '28 Oct', answer: 'remembered' },
]

/** c11-07, c11-08 and c11-09, one span: pruning; ⋯ › Archive card (it keeps its history); the Archived list and Unarchive. */
function Prune(props: SceneProps) {
  const b = useBeat(props)
  const id = props.clip.id
  const cut = id === 'c11-07' ? since(b, cue(b, 0, 0.62) - 0.06, 1) : 1
  const card = id === 'c11-08' ? since(b, 0, 0.5) : 0
  const menu = id === 'c11-08' ? showFor(since(b, cue(b, 0, 0.27) - 0.04, 0.3), since(b, cue(b, 1, 0.52) + 0.06, 0.3)) : 0
  const archived = id === 'c11-08' ? since(b, cue(b, 1, 0.52) + 0.06, 0.5) : 0
  const history = id === 'c11-08' ? since(b, cue(b, 2, 0.74), 0.6) : 0
  const inbox = id === 'c11-09' ? since(b, 0, 0.5) : 0
  const filter = id === 'c11-09' ? showFor(since(b, 0.06, 0.3), since(b, cue(b, 1, 0.53) - 0.02, 0.3)) : 0
  const list = id === 'c11-09' ? since(b, cue(b, 1, 0.53), 0.5) : 0
  const unarchive = id === 'c11-09' ? since(b, cue(b, 3, 0.78), 0.5) : 0
  return (
    <Stage beat={b} label={id === 'c11-07' ? 'Some cards no longer earn their place: pruning is part of it' : id === 'c11-08' ? "Open the card's menu and choose Archive card; it keeps its history" : 'Archived cards are at the bottom of the All cards menu; Unarchive brings one back'}>
      {id === 'c11-07' && (
        <Layer>
          <Garden beat={b} plants={[GARDEN[0]]} grow={[1]} prune={{ plant: 0, branch: 1, p: cut }} lit={cut >= 1 ? [[0, -1], [0, 0], [0, 2]] : []} />
          <span className="later-shears" style={{ ...pop(b, showFor(since(b, cue(b, 0, 0.62) - 0.12, 0.4), since(b, cue(b, 0, 0.62) + 0.06, 0.4))) }} aria-hidden="true">
            <HabitGlyph habit="tend" size={44} />
          </span>
        </Layer>
      )}
      {id === 'c11-08' && (
        <Layer style={{ opacity: card }}>
          <div className="later-menuwrap">
            <div style={{ opacity: lerp(1, 0.5, archived) }}>
              <CardView beat={b} title={TOO_MUCH.title} id={TOO_MUCH.id} text={TOO_MUCH.text} sides={1} chrome="block" />
            </div>
            <MenuPreview beat={b} x={58} y={14} p={menu} items={MENU(since(b, cue(b, 1, 0.52) - 0.08, 0.2))} />
            <Pointer beat={b} from={[60, 90]} to={menu > 0.5 ? [70, 30] : [94, 6]} move={between(b, 0.05, cue(b, 0, 0.27) - 0.04)} click={since(b, cue(b, 0, 0.27) - 0.04, 0.4)} show={1 - archived} />
            {archived > 0 && (
              <span className="kit-chip later-archived" style={pop(b, archived)}>
                <ArchiveIcon /> Archived
              </span>
            )}
            <ReviewsStrip beat={b} rows={HISTORY} open={history} />
          </div>
        </Layer>
      )}
      {id === 'c11-09' && (
        <Layer style={{ opacity: inbox }}>
          <div className="later-inbox">
            <div className="later-inbox__bar">
              <span className="later-inbox__filter">{list > 0.5 ? 'Archived' : 'All cards'} ▾</span>
            </div>
            <FilterMenu beat={b} p={filter} counts={{ all: '24', next: '2', due: '12', new: '10 / 48', archived: '1' }} active={{ archived: since(b, cue(b, 0, 0.21), 0.4) }} />
            {list > 0 && (
              <ul className="later-archived-list" style={rise(b, list, 8)}>
                <li style={{ opacity: 1 - unarchive * 0.7 }}>
                  <span className="kit-app__icon kit-app__icon--card" aria-hidden="true" />
                  <span>{TOO_MUCH.title}</span>
                  <span className="later-archived-list__page">sleep.md</span>
                  <span className="later-unarchive" data-on={since(b, cue(b, 2, 0.67), 0.3) > 0.5 ? 'true' : undefined}>
                    {unarchive > 0.5 ? 'Back in review' : 'Unarchive'}
                  </span>
                </li>
              </ul>
            )}
          </div>
        </Layer>
      )}
    </Stage>
  )
}

/** The umbrella card whose PROTEIN part keeps growing (c11-20). Parts: 0 the front; 1 the overview; 2 PROTEIN; 3 CARBS. */
const UMBRELLA = {
  title: 'Protein, carbs and fat',
  text: [
    'The three things food is mostly made of are {{protein, carbs and fat}}.',
    '---',
    'Each gives energy, and each does a job of its own.',
    '',
    '***',
    '',
    '**PROTEIN**',
    'Builds and repairs. Eggs, beans, fish.',
    'The body stores little of it.',
    'Muscle is built from it.',
    'About a palm of it a meal.',
    '',
    '***',
    '',
    '**CARBS**',
    'Quick energy. Bread, rice, fruit.',
  ].join('\n'),
}

/** c11-20: one part of a card keeps growing; it lifts off into its own card, and a line joins the two. */
function NewBranch(props: SceneProps) {
  const b = useBeat(props)
  const growing = cue(b, 0, 0.47)
  const own = cue(b, 1, 0.61)
  const link = cue(b, 2, 0.82)
  const lift = since(b, own - 0.03, 0.8)
  const w = b.reduced ? (lift > 0 ? 1 : 0) : ease.out(lift)
  const lines = Math.min(4, Math.floor(between(b, 0.05, growing + 0.05) * 4) + 1)
  const text = UMBRELLA.text
    .split('\n')
    .filter((line, i, all) => {
      const start = all.indexOf('**PROTEIN**')
      return i <= start || i > start + 4 || i - start <= lines
    })
    .join('\n')
  return (
    <Stage beat={b} label="When one part of a card keeps growing, give it its own card, and link the two">
      <Layer>
        <div className="kit-row later-branch">
          <div className="later-branch__card">
            <Fit>
              <CardView beat={b} title={UMBRELLA.title} text={text} chrome="block" shown={1} sides={2} lit={[0, 0, showFor(since(b, 0.05, 0.5), lift)]} dim={showFor(since(b, 0.05, 0.5), lift) * 0.6} grow={[undefined, undefined, 1 - lift * 0.85]} />
            </Fit>
          </div>
          <svg className="later-branch__link" viewBox="0 0 60 20" aria-hidden="true" style={{ width: `${(w * 8).toFixed(2)}em`, opacity: since(b, link, 0.5) }}>
            <line x1={2} y1={10} x2={lerp(2, 58, since(b, link, 0.6))} y2={10} />
          </svg>
          <div className="later-branch__new" style={{ maxWidth: `${(w * 24).toFixed(2)}em`, opacity: clamp(lift * 1.5) }}>
            <CardView beat={b} title={PROTEIN_BRANCH.title} id={PROTEIN_BRANCH.id} text={PROTEIN_BRANCH.text.split('\n\n***')[0]} chrome="block" shown={1} />
          </div>
        </div>
        <span className="kit-chip" style={pop(b, since(b, link + 0.05, 0.5))}>
          A new branch
        </span>
      </Layer>
    </Stage>
  )
}

/** c11-18 and c11-19, one span: two cards belong together, link them; a link that no longer helps is cut. */
function TendLinks(props: SceneProps) {
  const b = useBeat(props)
  const id = props.clip.id
  const notice = id === 'c11-18' ? since(b, cue(b, 0, 0.45), 0.6) : 1
  const linkP = id === 'c11-18' ? since(b, cue(b, 1, 0.8), 0.8) : 1
  const cut = id === 'c11-19' ? since(b, cue(b, 0, 0.45), 0.9) : 0
  const word = id === 'c11-19' ? since(b, cue(b, 1, 0.68), 0.5) : 0
  const nodes = [
    { id: 'a', x: 160, y: 120, label: 'Sleep debt adds up', kind: 'card' as const },
    { id: 'b', x: 440, y: 120, label: 'Recovery', kind: 'card' as const },
    { id: 'c', x: 160, y: 260, label: 'Muscle cramps', kind: 'card' as const },
    { id: 'd', x: 440, y: 260, label: 'Calories', kind: 'card' as const },
  ]
  const cx = 300
  const cy = 260
  const drop = b.reduced ? 0 : 28 * ease.inOut(cut)
  return (
    <Stage beat={b} label={id === 'c11-18' ? 'When two cards belong together, link them' : 'When a link no longer helps, delete it like a word'}>
      <Layer>
        <Web beat={b} nodes={nodes} edges={[{ from: 'a', to: 'b', kind: 'link' }]} show={{ a: 1, b: 1, c: id === 'c11-19' ? 1 : since(b, 0.05, 0.5), d: id === 'c11-19' ? 1 : since(b, 0.08, 0.5), 'a>b': linkP }} lit={{ a: showFor(notice, 0) * (id === 'c11-18' ? 1 : 0.3), b: showFor(notice, 0) * (id === 'c11-18' ? 1 : 0.3) }} />
        <svg className="kit-web later-cutlink" viewBox="0 0 600 340" aria-hidden="true">
          <g opacity={1 - cut}>
            <line className="kit-web__edge kit-web__edge--link" x1={210} y1={cy} x2={cx - 8} y2={cy + drop} />
            <line className="kit-web__edge kit-web__edge--link" x1={cx + 8} y1={cy + drop} x2={400} y2={cy} />
          </g>
          {id === 'c11-19' && (
            <g transform={`translate(${cx - 18} ${cy - 46})`} opacity={showFor(since(b, cue(b, 0, 0.45) - 0.1, 0.3), since(b, cue(b, 0, 0.45) + 0.12, 0.3))}>
              <g className="later-shears-svg">
                <circle cx={10} cy={30} r={6} />
                <circle cx={26} cy={30} r={6} />
                <path d="M13 25 28 4M23 25 8 4" />
              </g>
            </g>
          )}
          {id === 'c11-18' && notice > 0 && linkP <= 0 && <circle className="kit-web__pulse" cx={300} cy={120} r={4 + 6 * (b.reduced ? 1 : Math.abs(Math.sin(b.t * 4)))} opacity={0.7} />}
        </svg>
      </Layer>
      <Layer place="bottom">
        <span className="kit-chip" style={pop(b, word)}>
          Edit the card, and delete the pill
        </span>
      </Layer>
    </Stage>
  )
}

const QUEUE = ['Calories', 'candid', 'Sleep debt adds up', 'Rest days']

/** c11-10: ⋯ › Put at top of Inbox; the card moves to the top of the Inbox with the Up next mark. */
function UpNext(props: SceneProps) {
  const b = useBeat(props)
  const choose = cue(b, 0, 0.21)
  const put = cue(b, 1, 0.41)
  const mark = cue(b, 2, 0.65)
  const menu = showFor(since(b, choose - 0.08, 0.3), since(b, put + 0.04, 0.3))
  const move = moved(b, since(b, put + 0.06, 0.8))
  const list = since(b, put + 0.02, 0.5)
  return (
    <Stage beat={b} label="Put at top of Inbox: the card gets the Up next mark until you answer it">
      <Layer style={{ opacity: 1 - list }}>
        <div className="later-menuwrap">
          <CardView beat={b} title={SLEEP_DEBT.title} id={SLEEP_DEBT.id} text={SLEEP_DEBT.text} sides={1} chrome="block" />
          <MenuPreview beat={b} x={58} y={14} p={menu} items={MENU(0, since(b, put - 0.08, 0.2))} />
        </div>
      </Layer>
      <Layer style={{ opacity: list }}>
        <div className="later-queue">
          <p className="later-queue__head">Inbox</p>
          {QUEUE.map((t, i) => {
            const isIt = t === SLEEP_DEBT.title
            const from = i
            const to = isIt ? 0 : i < 2 ? i + 1 : i
            const y = lerp(from, to, move)
            return (
              <div key={t} className="later-queue__row" data-it={isIt ? 'true' : undefined} style={{ top: `${(y * 2.6 + 2.2).toFixed(3)}em` }}>
                <span className="kit-app__icon kit-app__icon--card" aria-hidden="true" />
                <span>{t}</span>
                {isIt && (
                  <span className="kit-chip later-upnext" style={pop(b, since(b, mark, 0.5))}>
                    <UpNextIcon /> Up next
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </Layer>
    </Stage>
  )
}

/** c11-11: the card's Reviews open; one wrong answer deleted; then ⋯ › Reset history, and the card is New. */
function History(props: SceneProps) {
  const b = useBeat(props)
  const open = cue(b, 0, 0.16)
  const del = cue(b, 1, 0.43)
  const reset = cue(b, 2, 0.67)
  const fresh = cue(b, 3, 0.83)
  const gone = since(b, del + 0.05, 0.5)
  const wiped = since(b, fresh - 0.03, 0.5)
  const rows: ReviewRow[] = HISTORY.map((r) => (r.answer === 'forgot' ? { ...r, gone, bin: since(b, del - 0.08, 0.3) } : { ...r, gone: wiped }))
  return (
    <Stage beat={b} label="Each card keeps its review history: delete one wrong answer, or Reset history to start fresh">
      <Layer>
        <div className="later-menuwrap">
          <CardView beat={b} title={SLEEP_DEBT.title} id={SLEEP_DEBT.id} text={SLEEP_DEBT.text} sides={1} chrome="block" />
          <ReviewsStrip beat={b} rows={rows} open={since(b, open, 0.6)} empty="No reviews yet." />
          <MenuPreview beat={b} x={58} y={14} p={showFor(since(b, reset - 0.06, 0.3), since(b, fresh - 0.05, 0.3))} items={[{ label: 'Put at top of Inbox' }, { label: 'Archive card' }, { label: 'Title on the front', rule: true }, { label: 'Reset history', active: since(b, reset, 0.2) }]} />
          {wiped > 0 && (
            <span className="kit-chip later-archived" style={pop(b, wiped)}>
              New
            </span>
          )}
        </div>
      </Layer>
    </Stage>
  )
}

/** c11-12: the All cards menu, "New cards 10 / 48"; a click on the count, "Add [10] more new cards"; Enter. */
function MoreNew(props: SceneProps) {
  const b = useBeat(props)
  const count = cue(b, 0, 0.42)
  const enter = cue(b, 1, 0.79)
  const adding = since(b, count + 0.05, 0.4)
  const done = since(b, enter + 0.06, 0.4)
  return (
    <Stage beat={b} label="More new cards today: click their count in the All cards menu, and press Enter">
      <Layer>
        <div className="later-inbox">
          <div className="later-inbox__bar">
            <span className="later-inbox__filter">All cards ▾</span>
          </div>
          <FilterMenu
            beat={b}
            p={since(b, 0.04, 0.4)}
            counts={{ all: '24', next: '2 / 5', due: '12', new: done > 0.5 ? '20 / 48' : '10 / 48', archived: '1' }}
            countGlow={{ new: showFor(since(b, count - 0.1, 0.3), adding) }}
            adding={done > 0.5 ? undefined : { n: 10, p: adding }}
            enter={since(b, enter, 0.2)}
          />
        </div>
        <Keys p={showFor(since(b, enter - 0.04, 0.3), done)} items={[{ keys: '↵', label: 'Enter' }]} />
      </Layer>
    </Stage>
  )
}

/** c11-13: "Try it in the app": Archive and Up next on your own card. */
function TryCare(props: SceneProps) {
  const b = useBeat(props)
  const glow = showFor(since(b, cue(b, 1, 0.67), 0.4), since(b, 0.95, 0.4))
  return (
    <Stage beat={b} label="Try Archive and Up next on your own card, in the app">
      <Layer>
        <div className="kit-tags">
          <span className="kit-chip" style={pop(b, since(b, cue(b, 0, 0.11) - 0.04, 0.5))}>
            <ArchiveIcon /> Archive card
          </span>
          <span className="kit-chip" style={pop(b, since(b, 0.25, 0.5))}>
            <UpNextIcon /> Put at top of Inbox
          </span>
        </div>
        <div className="kit-try" style={pop(b, since(b, 0.3, 0.6), 0.85)}>
          <span className="course__btn course__btn--try" style={{ boxShadow: `0 0 0 ${(4 * glow).toFixed(2)}px var(--accent-soft)` }}>
            Try it in the app
          </span>
          <span className="course__btn">Next chapter</span>
        </div>
      </Layer>
    </Stage>
  )
}

/** A garden with one more branch to grow (c11-14). */
const GROWN: readonly PlantSpec[] = GARDEN.map((p, i) => (i === 1 ? { ...p, branches: [...p.branches, { at: 0.86, dir: 1 as const, len: 40, up: 18 }] } : p))

/** c11-14: grow a branch here, prune one there: the garden full and tidy; then the week ahead. */
function TrueGarden(props: SceneProps) {
  const b = useBeat(props)
  const grow = cue(b, 0, 0.05)
  const prune = cue(b, 1, 0.2)
  const tidy = cue(b, 2, 0.52)
  const week = cue(b, 3, 0.72)
  const out = since(b, week, 0.6)
  return (
    <Stage beat={b} label="Grow a branch here, prune one there, and your card base stays true. Next: your first week">
      <Layer style={{ opacity: 1 - out * 0.85, transform: b.reduced ? undefined : `translateY(${lerp(0, -16, moved(b, out)).toFixed(2)}cqh) scale(${lerp(1, 0.7, moved(b, out)).toFixed(3)})` }}>
        <Garden beat={b} plants={GROWN} grow={[1, lerp(0.86, 1, since(b, grow, 1.2)), 1]} prune={{ plant: 2, branch: 2, p: since(b, prune, 0.9) }} links={GARDEN_LINKS.map((l) => ({ ...l, p: 1 }))} lit={since(b, tidy, 0.6) > 0.5 ? [[0, -1], [1, -1], [2, -1], [1, 2]] : [[1, 2]]} />
      </Layer>
      <Layer place="bottom" style={{ opacity: out }}>
        <div className="later-week later-week--small">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
            <span key={i} className="later-week__day" style={pop(b, since(b, week + i * 0.02, 0.4), 0.7)}>
              {d}
            </span>
          ))}
        </div>
      </Layer>
    </Stage>
  )
}

export const CARE_SCENES: ChapterScenes = {
  chapter: 'care',
  entries: [
    { clips: ['c11-01', 'c11-02', 'c11-03'], scene: Gardener },
    { clips: ['c11-04'], scene: KeepMissing },
    { clips: ['c11-06', 'c11-05'], scene: FixIt },
    { clips: ['c11-15', 'c11-16', 'c11-17'], scene: Scheduled },
    { clips: ['c11-07', 'c11-08', 'c11-09'], scene: Prune },
    { clips: ['c11-20'], scene: NewBranch },
    { clips: ['c11-18', 'c11-19'], scene: TendLinks },
    { clips: ['c11-10'], scene: UpNext },
    { clips: ['c11-11'], scene: History },
    { clips: ['c11-12'], scene: MoreNew },
    { clips: ['c11-13'], scene: TryCare },
    { clips: ['c11-14'], scene: TrueGarden },
  ],
}
