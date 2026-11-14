/**
 * CHAPTER 4, "Where a card lives" (YAZ-5121): three places, one card. By itself (a card file), in a page (a card
 * block), embedded (a card shown in a page, with its "Embedded from" head). The same card, the protein card of
 * chapter 2, is shown in each; the app's parts are the kit's copies with the app's own classes (`PageView`,
 * `EmbedView`, `CardView`, `AppWindow`). Cues land on the real voice's words (`marks` in `script.ts`).
 */
import type { CSSProperties, ReactNode } from 'react'
import type { SceneProps } from '../scene'
import { useUnit } from '../../vault/unitWord'
import { InboxIcon } from '../../views/view/icons'
import { UMBRELLA } from './cards'
import {
  AppWindow,
  CardView,
  Caret,
  AgentChat,
  EmbedView,
  EditCard,
  Fit,
  glowStyle,
  Layer,
  cardMenuItems,
  CardPill,
  MenuPreview,
  PageText,
  PageView,
  Pointer,
  ReviewsStrip,
  SidebarPreview,
  SlashPreview,
  Stage,
  TryChip,
  Words,
  between,
  clamp,
  cue,
  ease,
  lerp,
  moved,
  pop,
  rise,
  showFor,
  since,
  useBeat,
  type Beat,
  type SidebarRow,
} from './kit'
import type { ChapterScenes } from './registry'
import './where.css'

/** The card of this chapter: the protein card, short (its front and the first line of its back). */
const CARD = { title: UMBRELLA.title, id: UMBRELLA.id, text: UMBRELLA.short }
/** The ID of the new card that `/card` makes in c4-05. */
const NEW_CARD_ID = 'DEMO-20'
const ADDED = 'An egg is mostly protein and fat.'
const EDITED = `${CARD.text}\n\n${ADDED}`

const FOOD = 'Food basics'
const MEALS = 'Weekly meals'

const rows = (active: string, glow: Readonly<Record<string, number>> = {}): SidebarRow[] => [
  { name: 'Course Cards', kind: 'folder', open: true },
  { name: CARD.title, kind: 'card', depth: 1, active: active === CARD.title, glow: glow[CARD.title] },
  { name: FOOD, kind: 'page', depth: 1, active: active === FOOD, glow: glow[FOOD] },
  { name: MEALS, kind: 'page', depth: 1, active: active === MEALS, glow: glow[MEALS] },
  { name: 'Projects', kind: 'folder' },
]

/** A tab of the app: the tab bar with its name, then the content. */
function Tab({ name, children }: { name: string; children: ReactNode }) {
  return (
    <>
      <div className="kit-app__tabbar">
        <span className="kit-app__tabname">{name}</span>
      </div>
      <div className="kit-where__tab">{children}</div>
    </>
  )
}

/** The card file's tab: its title, then the card. */
function CardFile({ beat, glow = 0, footer, menu }: { beat: Beat; glow?: number; footer?: ReactNode; menu?: ReactNode }) {
  return (
    <div className="kit-where__file">
      <p className="kit-app__bigtitle">{CARD.title}</p>
      <div style={{ ...glowStyle(glow), borderRadius: 8 }}>
        <CardView beat={beat} text={CARD.text} id={CARD.id} chrome="block" shown={1} />
      </div>
      {footer}
      {menu}
    </div>
  )
}

/** The three places, as small drawings in frames: by itself, in a page, embedded. */
const PLACES = ['By itself', 'In a page', 'Embedded'] as const

function PlaceDrawing({ kind, card = 1 }: { kind: number; card?: number }) {
  const box = <span className="kit-place__card" style={{ opacity: card }} />
  if (kind === 0)
    return (
      <span className="kit-place__inner">
        <span className="kit-place__tab" />
        <span className="kit-place__title" />
        {box}
      </span>
    )
  return (
    <span className="kit-place__inner">
      <span className="kit-place__title" />
      <i className="kit-place__line" style={{ width: '92%' }} />
      <i className="kit-place__line" style={{ width: '70%' }} />
      {kind === 2 ? (
        <span className="kit-place__embed" style={{ opacity: card }}>
          <span className="kit-place__embed-head">↗</span>
        </span>
      ) : (
        box
      )}
      <i className="kit-place__line" style={{ width: '84%' }} />
    </span>
  )
}

/** The three frames in a row; each frame's `p` brings it in, `lit` lights it; `labels` under them. */
function Places({ beat, p, lit = [], card = [1, 1, 1], under, children }: { beat: Beat; p: readonly number[]; lit?: readonly number[]; card?: readonly number[]; under?: readonly ReactNode[]; children?: ReactNode }) {
  return (
    <div className="kit-places">
      {PLACES.map((name, i) => (
        <div key={name} className="kit-place" style={{ ...pop(beat, clamp(p[i] ?? 0), 0.85), ...glowStyle(lit[i] ?? 0) }}>
          <span className="kit-place__name">{name}</span>
          <PlaceDrawing kind={i} card={card[i] ?? 1} />
          {under?.[i]}
        </div>
      ))}
      {children}
    </div>
  )
}

/** c4-01: the card file; then pages beside it. */
function Beside(props: SceneProps) {
  const b = useBeat(props)
  const unit = useUnit()
  const file = cue(b, 0, 0.336)
  const beside = cue(b, 1, 0.714)
  const page = since(b, beside - 0.06, 0.7)
  const slide = moved(b, page)
  return (
    <Stage beat={b} label={unit('So far, the card is a file of its own; it can also live beside your pages')}>
      <Layer>
        <div className="kit-beside">
          <div className="kit-beside__file" style={{ ...rise(b, since(b, 0, 0.6)), transform: b.reduced ? undefined : `translateX(${lerp(26, 0, slide).toFixed(2)}%)` }}>
            <span className="kit-chip" style={pop(b, since(b, file, 0.5))}>
              A file of its own
            </span>
            <CardView beat={b} title={CARD.title} text={CARD.text} id={CARD.id} chrome="block" sides={1} className="kit-cardview--small" />
          </div>
          <div className="kit-beside__page" style={{ opacity: page, transform: b.reduced ? undefined : `translateX(${lerp(30, 0, ease.out(page)).toFixed(2)}%)` }}>
            <PageView title={FOOD}>
              <PageText beat={b}>Food is mostly three things. Each one does a different job in your body.</PageText>
              <PageText beat={b}>Most meals mix all three.</PageText>
            </PageView>
          </div>
        </div>
      </Layer>
    </Stage>
  )
}

/** c4-02: three places; the review works the same in each: one Inbox. */
function Three(props: SceneProps) {
  const b = useBeat(props)
  const unit = useUnit()
  const three = cue(b, 0, 0.22)
  const same = cue(b, 1, 0.535)
  const arrows = since(b, same, 0.7)
  return (
    <Stage beat={b} label={unit('A card can live in three places: by itself, in a page, embedded. The review is the same in each')}>
      <Layer>
        <div className="kit-three">
          <Places beat={b} p={[0, 1, 2].map((i) => since(b, three - 0.05 + i * 0.05, 0.5))} />
          <svg className="kit-three__arrows" viewBox="0 0 300 40" preserveAspectRatio="none" aria-hidden="true">
            {[50, 150, 250].map((x) => (
              <path key={x} d={`M${x} 2 Q${x} 26 150 38`} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - moved(b, arrows)} />
            ))}
          </svg>
          <span className="sidebar__inbox kit-three__inbox" style={pop(b, since(b, same + 0.1, 0.5), 0.8)}>
            <InboxIcon className="sidebar__inbox-icon" />
            <span className="sidebar__inbox-name">Inbox</span>
          </span>
        </div>
      </Layer>
    </Stage>
  )
}

/** c4-03: first, a card by itself: the card file you made. One file, one card. */
function ByItself(props: SceneProps) {
  const b = useBeat(props)
  const fileAt = cue(b, 0, 0.453)
  const oneFile = cue(b, 1, 0.657)
  const oneCard = cue(b, 2, 0.793)
  return (
    <Stage beat={b} label="A card by itself: the card file you made. One file, one card">
      <Layer>
        <Fit min={0.8}>
          <AppWindow sidebar={<SidebarPreview inbox={4} rows={rows(CARD.title, { [CARD.title]: showFor(since(b, fileAt, 0.4), since(b, oneCard + 0.1, 0.5)) })} />} label="The card file, open in its tab">
            <Tab name={CARD.title}>
              <CardFile beat={b} glow={showFor(since(b, oneCard, 0.4), since(b, 0.98, 0.3))} />
            </Tab>
            <span className="kit-chip kit-where__onefile" style={pop(b, since(b, oneFile, 0.4))}>
              One file
            </span>
            <span className="kit-chip kit-where__onecard" style={pop(b, since(b, oneCard, 0.4))}>
              One card
            </span>
          </AppWindow>
        </Fit>
      </Layer>
    </Stage>
  )
}

const P1 = 'Food is mostly three things. Each one does a different job in your body.'
const P2 = 'Most meals mix all three. An egg is mostly protein and fat; bread is mostly carbs.'

/** c4-04 to c4-07, one span: a card inside a page; /card; the same menu, history and Inbox; Review this page. */
function InAPage(props: SceneProps) {
  const b = useBeat(props)
  const unit = useUnit()
  const id = props.clip.id
  const order = ['c4-04', 'c4-05', 'c4-06', 'c4-07']
  const step = order.indexOf(id)
  // c4-04: the card slides in between the paragraphs; the text beside it lights.
  const cardIn = step === 0 ? since(b, cue(b, 0, 0.193), 0.7) : 1
  const textLit = step === 0 ? showFor(since(b, cue(b, 1, 0.783), 0.4), since(b, 0.99, 0.3)) : 0
  // c4-05: "/card", Enter, a new card opens with its title line selected.
  const slashAt = step === 1 ? 0.137 : 2
  const typed = step !== 1 || b.progress < slashAt ? '' : '/card'.slice(0, Math.min(5, 1 + Math.floor(between(b, slashAt, 0.3) * 5)))
  const enter = step === 1 ? cue(b, 0, 0.446) : 2
  const opens = step === 1 ? cue(b, 1, 0.652) : 2
  const newCard = step === 1 && b.progress >= enter + 0.02
  const slash = step === 1 ? showFor(since(b, 0.24, 0.25), since(b, enter, 0.15)) : 0
  // c4-06: the card's menu, its history, the Inbox.
  const menu = step === 2 ? showFor(since(b, cue(b, 0, 0.336), 0.3), since(b, cue(b, 1, 0.595) - 0.05, 0.3)) : 0
  const history = step === 2 ? since(b, cue(b, 1, 0.595), 0.4) : step > 2 ? 1 : 0
  const inbox = step === 2 ? since(b, cue(b, 2, 0.784), 0.4) : 0
  // c4-07: right-click the page, Review this page.
  const right = step === 3 ? cue(b, 0, 0.424) : 2
  const review = step === 3 ? cue(b, 1, 0.724) : 2
  const pageMenu = step === 3 ? since(b, right + 0.03, 0.3) : 0
  return (
    <Stage beat={b} label={unit('A card inside a page: beside the text, made with /card, with the same menu, history and Inbox')}>
      <Layer>
        <Fit min={0.8}>
          <AppWindow
            sidebar={<SidebarPreview inbox={4} inboxGlow={inbox} rows={rows(FOOD, { [FOOD]: step === 3 ? showFor(since(b, right - 0.05, 0.3), since(b, 0.98, 0.3)) : 0 })} />}
            label={unit('A page with a card in it')}
            over={
              <>
                {/* The page's row in the sidebar: its right-click menu opens beside the row, over the sidebar. */}
                <MenuPreview beat={b} x={16} y={34} p={pageMenu} items={[{ label: 'Open in new tab' }, { label: 'Add to favorites' }, { label: unit('Review this page'), active: since(b, review, 0.3), rule: true }, { label: 'Rename', rule: true }]} />
                {step === 3 && <Pointer beat={b} from={[70, 80]} to={[14, 30]} move={between(b, 0.16, right)} click={since(b, right, 0.4)} show={showFor(since(b, 0.12, 0.3), since(b, 0.97, 0.3))} />}
              </>
            }
          >
            <Tab name={FOOD}>
              <div className="kit-where__page">
                <PageView title={FOOD}>
                  <div style={glowStyle(textLit * 0.6)}>
                    <PageText beat={b}>{P1}</PageText>
                  </div>
                  <div className="kit-where__slot" style={{ opacity: cardIn, maxHeight: b.reduced ? (cardIn > 0 ? '20em' : 0) : `${(ease.out(cardIn) * 20).toFixed(2)}em` }}>
                    <CardView beat={b} title={CARD.title} text={CARD.text} id={CARD.id} chrome="block" sides={1} className="kit-cardview--small" />
                    {history > 0 && <ReviewsStrip beat={b} count={4} next="Nov 22" p={history} glow={step === 2 ? showFor(since(b, cue(b, 1, 0.595), 0.4), since(b, cue(b, 2, 0.784), 0.4)) : 0} />}
                  </div>
                  <div style={glowStyle(textLit * 0.6)}>
                    <PageText beat={b}>{P2}</PageText>
                  </div>
                  {step === 1 && !newCard && (
                    <p className="kit-page__p kit-where__typing">
                      {typed}
                      <Caret />
                    </p>
                  )}
                  {newCard && (
                    <EditCard
                      id={NEW_CARD_ID}
                      className="kit-where__newcard"
                      style={pop(b, since(b, enter, 0.4), 0.9)}
                      keys={since(b, opens, 0.4)}
                      title={
                        <>
                          <span className="kit-selection">Title</span>
                          <Caret />
                        </>
                      }
                    >
                      <p>&nbsp;</p>
                    </EditCard>
                  )}
                </PageView>
                <SlashPreview beat={b} x={6} y={72} p={slash} rows={[{ label: 'Card', active: since(b, 0.33, 0.2) }, { label: 'Heading 1' }, { label: 'Bullet list' }, { label: 'Quote' }]} />
                <MenuPreview
                  beat={b}
                  x={52}
                  y={24}
                  p={menu}
                  items={cardMenuItems('page')}
                />
              </div>
            </Tab>
            {step === 2 && <Pointer beat={b} from={[80, 90]} to={[92, 21]} move={between(b, 0.12, cue(b, 0, 0.336) - 0.02)} click={since(b, cue(b, 0, 0.336) - 0.02, 0.4)} show={showFor(since(b, 0.1, 0.3), since(b, 0.55, 0.3))} />}
          </AppWindow>
        </Fit>
      </Layer>
      {step === 1 && (
        <Layer place="bottom" className="kit-layer--right">
          <span className="kit-where__key" style={{ opacity: showFor(since(b, enter - 0.06, 0.3), since(b, opens, 0.4)), boxShadow: b.progress >= enter && b.progress < enter + 0.05 ? '0 0 0 3px var(--accent-soft)' : undefined }}>
            Enter
          </span>
        </Layer>
      )}
    </Stage>
  )
}

/** c4-08, c4-09, c4-16, c4-10 and c4-11, one span: the embed. One home, shown in a page; how to make one; the agent; the head; an edit. */
function Embedded(props: SceneProps) {
  const b = useBeat(props)
  const unit = useUnit()
  const id = props.clip.id
  let tab = MEALS
  let sidebarGlow: Record<string, number> = {}
  let embed = 1
  let pill = 0
  let embedGlow = 0
  let head = 0
  let name = 0
  let editing = false
  let edited = false
  let history = 0
  let cardMenu = 0
  let copyActive = 0
  let linkMenu = 0
  let showAsEmbed = 0
  let chat: { you: number; agent: number } | null = null
  let pointer: { from: [number, number]; to: [number, number]; move: number; click: number; show: number } | null = null
  let typing = ''
  let fileView = false
  if (id === 'c4-08') {
    const lives = cue(b, 0, 0.545)
    const shows = cue(b, 1, 0.853)
    embed = since(b, 0.12, 0.6)
    sidebarGlow = { [CARD.title]: showFor(since(b, lives, 0.4), since(b, shows, 0.4)) }
    embedGlow = since(b, shows, 0.4)
  } else if (id === 'c4-09') {
    const copy = cue(b, 0, 0.183)
    const paste = cue(b, 1, 0.391)
    const right = cue(b, 2, 0.624)
    const choose = cue(b, 3, 0.841)
    fileView = b.progress < paste - 0.03
    tab = fileView ? CARD.title : MEALS
    cardMenu = fileView ? since(b, copy - 0.03, 0.3) : 0
    copyActive = since(b, copy + 0.03, 0.2)
    pill = fileView ? 0 : since(b, paste, 0.3)
    linkMenu = showFor(since(b, right + 0.02, 0.3), since(b, choose + 0.05, 0.2))
    showAsEmbed = since(b, choose, 0.2)
    embed = since(b, choose + 0.06, 0.5)
    pill = pill * (1 - embed)
    pointer = fileView
      ? { from: [70, 85], to: [93, 26], move: between(b, 0.04, copy - 0.03), click: since(b, copy - 0.03, 0.4), show: since(b, 0.02, 0.3) }
      : { from: [70, 85], to: [38, 47], move: between(b, paste + 0.08, right), click: since(b, right, 0.4), show: showFor(since(b, paste + 0.05, 0.3), since(b, 0.98, 0.3)) }
  } else if (id === 'c4-16') {
    tab = FOOD
    chat = { you: between(b, 0.05, cue(b, 0, 0.393) + 0.05), agent: since(b, cue(b, 1, 0.861) - 0.1, 0.5) }
    embed = since(b, cue(b, 1, 0.861), 0.6)
  } else if (id === 'c4-10') {
    head = since(b, cue(b, 0, 0.446) - 0.03, 0.5)
    name = since(b, cue(b, 1, 0.802), 0.5)
  } else {
    const real = cue(b, 0, 0.404)
    const stays = cue(b, 1, 0.659)
    editing = b.progress >= 0.06 && b.progress < real + 0.02
    edited = b.progress >= real + 0.02
    typing = ADDED.slice(0, Math.round(ADDED.length * between(b, 0.13, real - 0.04)))
    sidebarGlow = { [CARD.title]: showFor(since(b, real, 0.4), since(b, stays, 0.4)) }
    history = since(b, stays, 0.4)
    pointer = { from: [70, 85], to: [83, 33], move: between(b, 0, 0.055), click: since(b, 0.055, 0.4), show: 1 - since(b, 0.12, 0.3) }
  }
  const embedText = edited ? EDITED : CARD.text
  return (
    <Stage beat={b} label={unit('A card embedded in a page: it lives in one place, and the page shows it')}>
      <Layer>
        <Fit min={0.8}>
          <div className="kit-embedscene">
            <AppWindow sidebar={<SidebarPreview inbox={4} rows={rows(tab, sidebarGlow)} />} label={unit('A page that shows a card from another file')}>
              <Tab name={tab}>
                {fileView ? (
                  <CardFile
                    beat={b}
                    menu={
                      <MenuPreview
                        beat={b}
                        x={46}
                        y={20}
                        p={cardMenu}
                        items={cardMenuItems('file', { 'Copy card link': copyActive }, 'Show', unit)}
                      />
                    }
                  />
                ) : (
                  <div className="kit-where__page">
                    <PageView title={tab}>
                      <PageText beat={b}>{tab === FOOD ? P1 : 'Breakfast this week: eggs and toast. Here is why that works.'}</PageText>
                      {pill > 0 && (
                        <p className="kit-page__p" style={{ opacity: pill }}>
                          <CardPill title={CARD.title} id={CARD.id} glow={showFor(since(b, cue(b, 2, 0.624), 0.3), since(b, cue(b, 3, 0.841), 0.3))} />
                        </p>
                      )}
                      {embed > 0 && (
                        <div style={{ opacity: embed, transform: b.reduced ? undefined : `translateY(${((1 - ease.out(embed)) * 8).toFixed(2)}px)` }}>
                          <EmbedView
                            beat={b}
                            title={CARD.title}
                            id={CARD.id}
                            text={embedText}
                            shown={1}
                            head={head}
                            name={name}
                            glow={embedGlow}
                            editing={editing}
                            editor={
                              <>
                                <p>
                                  The three things food is mostly made of are <span className="card__cloze">protein, carbs and fat</span>.
                                </p>
                                <div className="card__side-break" />
                                <p>Protein builds and repairs. Carbs are quick energy. Fat is slow energy, stored.</p>
                                <p>
                                  {typing}
                                  <Caret />
                                </p>
                              </>
                            }
                            footer={history > 0 ? <ReviewsStrip beat={b} count={4} next="Nov 22" glow={history} /> : undefined}
                          />
                        </div>
                      )}
                      <PageText beat={b}>{tab === FOOD ? P2 : 'Lunch: rice, beans and a salad.'}</PageText>
                    </PageView>
                  </div>
                )}
              </Tab>
              <MenuPreview
                beat={b}
                x={40}
                y={50}
                p={linkMenu}
                items={[{ label: 'Open' }, { label: 'Open in new tab' }, { label: 'Copy name and ID', rule: true }, { label: 'Show as embed', active: showAsEmbed, rule: true }, { label: 'Edit link' }, { label: 'Remove link' }]}
              />
              {pointer !== null && <Pointer beat={b} from={pointer.from} to={pointer.to} move={pointer.move} click={pointer.click} show={pointer.show} />}
            </AppWindow>
            {chat !== null && (
              <div className="kit-embedscene__chat">
                <AgentChat
                  beat={b}
                  lines={[
                    { who: 'you', text: 'Embed my protein card in the Food basics page.', p: chat.you },
                    { who: 'agent', text: 'Done: it is embedded after the first paragraph.', p: chat.agent, step: 'Edited Food basics' },
                  ]}
                />
              </div>
            )}
          </div>
        </Fit>
      </Layer>
    </Stage>
  )
}

/** Where the moving card sits in the row of frames: the middle of frame `i`, in percent. */
const FRAME_X = [16.67, 50, 83.33]

/** c4-12: the card moves between the three places; its history goes with it. */
function Move(props: SceneProps) {
  const b = useBeat(props)
  const between1 = cue(b, 0, 0.221)
  const goes = cue(b, 1, 0.669)
  const legA = moved(b, between(b, between1, between1 + 0.12))
  const legB = moved(b, between(b, between1 + 0.16, between1 + 0.28))
  const at = legB > 0 ? lerp(1, 2, legB) : lerp(0, 1, legA)
  const x = at <= 1 ? lerp(FRAME_X[0], FRAME_X[1], at) : lerp(FRAME_X[1], FRAME_X[2], at - 1)
  const hop = b.reduced ? 0 : Math.sin((at % 1) * Math.PI) * -18
  const home = Math.round(at)
  return (
    <Stage beat={b} label="Move a card between the three places at any time; its history goes with it">
      <Layer>
        <div className="kit-move">
          <Places beat={b} p={[1, 1, 1]} card={[0, 0, 0]} lit={[0, 1, 2].map((i) => (i === home ? 0.35 : 0))} />
          <div className="kit-move__card" style={{ left: `${x.toFixed(2)}%`, transform: `translate(-50%, ${hop.toFixed(2)}px)` }}>
            <span className="kit-move__box">{CARD.title}</span>
            <span className="kit-move__history" style={{ boxShadow: `0 0 0 ${(2.5 * showFor(since(b, goes, 0.4), since(b, 0.98, 0.3))).toFixed(2)}px var(--accent)` }}>
              ✓ 4 Reviews
            </span>
          </div>
        </div>
      </Layer>
    </Stage>
  )
}

/** c4-13: a card file for a fact on its own; a card in a page when it belongs with your pages. */
function Which(props: SceneProps) {
  const b = useBeat(props)
  const unit = useUnit()
  const fact = cue(b, 0, 0.211)
  const belongs = cue(b, 1, 0.744)
  return (
    <Stage beat={b} label={unit('Use a card file for a fact on its own; a card in a page when it belongs with your pages')}>
      <Layer>
        <div className="kit-which">
          <div className="kit-place" style={{ ...pop(b, since(b, 0, 0.5), 0.85), ...glowStyle(showFor(since(b, fact, 0.4), since(b, belongs - 0.05, 0.4)) * 0.6) }}>
            <span className="kit-place__name">{PLACES[0]}</span>
            <PlaceDrawing kind={0} />
            <Words size="label" style={rise(b, since(b, fact, 0.5))}>
              A fact on its own
            </Words>
          </div>
          <div className="kit-place" style={{ ...pop(b, since(b, 0.4, 0.5), 0.85), ...glowStyle(since(b, belongs, 0.4) * 0.6) }}>
            <span className="kit-place__name">{PLACES[1]}</span>
            <PlaceDrawing kind={1} />
            <Words size="label" style={rise(b, since(b, belongs, 0.5))}>
              Part of your pages
            </Words>
          </div>
        </div>
      </Layer>
    </Stage>
  )
}

/** c4-14: "Try it in the app": behind it, the step: the card's menu, Copy card link. */
function TryIt(props: SceneProps) {
  const b = useBeat(props)
  const unit = useUnit()
  const tryAt = cue(b, 0, 0.621)
  return (
    <Stage beat={b} label={unit('Try it in the app: embed your first card in a page')}>
      <Layer style={{ opacity: 0.5 * since(b, 0, 0.6) }}>
        <AppWindow sidebar={<SidebarPreview inbox={4} rows={rows(CARD.title)} />}>
          <Tab name={CARD.title}>
            <CardFile
              beat={b}
              menu={<MenuPreview beat={b} x={46} y={20} p={showFor(since(b, 0.12, 0.4), since(b, 0.6, 0.4))} items={cardMenuItems('file', { 'Copy card link': since(b, 0.3, 0.3) }, 'Show', unit)} />}
            />
          </Tab>
        </AppWindow>
      </Layer>
      <Layer>
        <TryChip beat={b} p={since(b, 0.04, 0.6)} glow={showFor(since(b, tryAt - 0.04, 0.4), since(b, 0.97, 0.4))} beside={<span className="course__btn">Next chapter</span>} />
      </Layer>
    </Stage>
  )
}

/** Where the pages sit around the one card (percent of the stage), and their names. */
const AROUND: readonly [number, number, string][] = [
  [17, 26, FOOD],
  [83, 26, MEALS],
  [50, 84, 'Gym plan'],
]
/** The far field that comes in when the stage widens: small pages (x, y in percent). */
const FIELD: readonly [number, number][] = [
  [6, 8], [30, 6], [70, 7], [94, 10], [4, 52], [96, 50], [10, 92], [30, 95], [72, 94], [92, 90], [22, 60], [78, 62], [40, 18], [60, 20],
]

/** c4-15: one card, one home, shown wherever it helps; then the stage widens: where all of this can take you. */
function Everywhere(props: SceneProps) {
  const b = useBeat(props)
  const one = cue(b, 0, 0.278)
  const shown = cue(b, 1, 0.475)
  const next = cue(b, 2, 0.798)
  const widen = moved(b, since(b, next, 1.6))
  const field = since(b, next + 0.03, 1)
  return (
    <Stage beat={b} label="One card, one home, shown wherever it helps; then the view widens">
      <Layer className="kit-layer--fill">
        <div className="kit-every" style={b.reduced ? undefined : { transform: `scale(${lerp(1, 0.62, widen).toFixed(4)})` }}>
          <svg className="kit-every__lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {AROUND.map(([x, y], i) => {
              const p = since(b, shown + i * 0.04, 0.6)
              const q = moved(b, p)
              return <line key={i} x1={50} y1={50} x2={lerp(50, x, q)} y2={lerp(50, y, q)} opacity={b.reduced ? p : 1} />
            })}
          </svg>
          {AROUND.map(([x, y, title], i) => (
            <div key={title} className="kit-every__page" style={{ left: `${x}%`, top: `${y}%`, ...pop(b, since(b, shown + 0.04 + i * 0.04, 0.5), 0.7) }}>
              <span className="kit-every__title">{title}</span>
              <i />
              <span className="kit-every__embed">↗ {CARD.title}</span>
              <i style={{ width: '70%' }} />
            </div>
          ))}
          <div className="kit-every__card" style={pop(b, since(b, one - 0.06, 0.5), 0.7)}>
            <span className="kit-every__cardtitle">{CARD.title}</span>
            <span className="kit-every__home" style={{ opacity: since(b, 0.36, 0.4) }}>
              <span className="kit-app__icon kit-app__icon--card" /> One home
            </span>
          </div>
          {FIELD.map(([x, y], i) => (
            <span key={i} className="kit-every__far" style={{ left: `${x}%`, top: `${y}%`, opacity: clamp(field * 1.4 - i * 0.04) * 0.7 }} />
          ))}
        </div>
      </Layer>
    </Stage>
  )
}

export const WHERE_SCENES: ChapterScenes = {
  chapter: 'where',
  entries: [
    { clips: ['c4-01'], scene: Beside },
    { clips: ['c4-02'], scene: Three },
    { clips: ['c4-03'], scene: ByItself },
    { clips: ['c4-04', 'c4-05', 'c4-06', 'c4-07'], scene: InAPage },
    { clips: ['c4-08', 'c4-09', 'c4-16', 'c4-10', 'c4-11'], scene: Embedded },
    { clips: ['c4-12'], scene: Move },
    { clips: ['c4-13'], scene: Which },
    { clips: ['c4-14'], scene: TryIt },
    { clips: ['c4-15'], scene: Everywhere },
  ],
}
