/**
 * THE COURSE'S SIDE EFFECTS (YAZ-5120 the seam, YAZ-5124 the real one): what the course does in the person's vault.
 * The frame passes one `CourseHost` to each scene (`SceneProps.host`). The real host is `vaultCourseHost`
 * (`courseCards.ts`, in the lazy course chunk); `showOnlyHost` makes nothing and says why; `memoryHost` is the test
 * double the scene builders use. A test keeps the three in step (`courseCards.test.ts`).
 *
 * Everything the course makes is a plain file in the folder "Course Cards" at the top of the vault: the person sees it
 * in the sidebar, and deleting any of it (the whole folder too) is always safe. The course makes what a step needs again.
 * The app has no AI inside and sends nothing anywhere: the AI step only copies a prompt and watches the folder.
 *
 * - `vault`: the course's vault, or null with none open.
 * - `courseCards()`: the folder, made the first time a step needs it. `{ showOnly }` when the course must only show (no
 *   vault, a read-only vault, IDs off, Review off): the one line for the person, and nothing is written.
 * - `watchCards(folder, onCards)`: every card in the folder (card files, and cards inside a page there), at once and on
 *   each change of the vault's index. Returns the way to stop.
 * - `makeFirstCard(input)`: chapter 2's card file from what the person typed. A repeat makes a second file.
 * - `coursePage()`: chapter 4's "Course page" in the folder, made when first needed.
 * - `readCard(card)`: the card's sides, to read it in the course (the AI step's "Read").
 * - `agentStep`: the AI step's state (chapter 8). It lives in the host, not in a scene: the layer unmounts a scene at
 *   the end of each clip, and the text, the copied prompt and the Read ticks must last from `c8-11` to `c8-16`.
 * - `summary()`: the end screen's numbers: the cards in the folder and when each comes back, from the real schedule.
 */
import type { ReviewSettings } from '@shared/reviews'
import type { IndexRecord } from '@shared/types'

/** The folder, or the one line that says why the course only shows. */
export type CourseCardsFolder = { path: string } | { showOnly: string }

/** One card in "Course Cards". `index` is its place among its file's cards (0 for a card file). */
export interface CourseCard {
  path: string
  index: number
  /** The card's ID; null until the vault's ID sweep gives it one (a file an agent wrote by hand). */
  id: string | null
  title: string
}

/** A card's key: its path and its place in the file. */
export const courseCardKey = (card: Pick<CourseCard, 'path' | 'index'>): string => `${card.path}#${card.index}`

/** What the person did in chapter 2: the front they typed, the word they hid (as text, or where it stands in `front`), and the back line (none: ''). */
export interface FirstCardInput {
  front: string
  hidden: string | { start: number; end: number }
  back: string
}

/** A card the course wrote: its file and what a scene shows of it. */
export interface MadeCard {
  path: string
  title: string
  /** The card's text: its sides, `---` between them, the hidden word in `{{ }}`. */
  text: string
  /** The title is hidden on the front (the card line's `notitle`): it would give the answer away. */
  titleHidden: boolean
}

/** A card to read in the course: its title and its sides (`---` splits them; the hidden words keep their `{{ }}`). */
export interface CourseCardText {
  title: string
  sides: string[]
}

/** The end screen: each card in "Course Cards" and when it comes back (ms; null: a new card, in the Inbox now). */
export interface CourseSummary {
  folder: string | null
  cards: { path: string; title: string; due: number | null }[]
}

/** Where the AI step is. `text`: the box; `copied`: the prompt was copied, the course waits for cards. */
export interface AgentStepState {
  text: string
  /** The person used the example text (the box holds it unchanged). */
  example: boolean
  /** The full prompt, or the one line that says why the course only shows (then nothing can be copied). */
  prompt: { text: string; folder: string } | { showOnly: string } | null
  /** When Copy was clicked (ms); null before. Only cards that are new after it count. */
  copiedAt: number | null
  /** The cards that came into "Course Cards" after Copy, in the order they came. */
  cards: CourseCard[]
  /** The keys (`courseCardKey`) of the cards the person opened. */
  read: string[]
  /** 60 seconds passed after Copy (or after the last card) with no new card: `NO_CARDS_YET` shows. The step keeps waiting. */
  quiet: boolean
  /** "No agent? Skip": the three example cards show. `made`: they are files now (only after the person said so). */
  examples: 'hidden' | 'shown' | MadeCard[]
  /** One line for a write that failed or was refused; null when all is well. */
  problem: string | null
}

export interface AgentStep {
  state(): AgentStepState
  subscribe(listener: () => void): () => void
  setText(text: string): void
  useExample(): void
  /** Builds the prompt for the text (makes the folder when needed). */
  preparePrompt(): Promise<void>
  /** Copies the prompt and starts to watch "Course Cards". */
  copy(): Promise<void>
  /** The person opened this card: its Read tick. */
  markRead(card: CourseCard): void
  /** "No agent? Skip": show the three example cards. Writes nothing. */
  showExamples(): void
  /** "Make these cards": the three example card files, made once. */
  makeExamples(): Promise<void>
  /** Stops the watch and the timer (the course closed). The state stays for the next open. */
  stop(): void
}

export interface CourseHost {
  vault: string | null
  courseCards(): Promise<CourseCardsFolder>
  watchCards(folder: string, onCards: (cards: readonly CourseCard[]) => void): () => void
  makeFirstCard(input: FirstCardInput): Promise<MadeCard | { showOnly: string }>
  coursePage(): Promise<{ path: string } | { showOnly: string }>
  readCard(card: Pick<CourseCard, 'path' | 'index'>): Promise<CourseCardText | null>
  agentStep: AgentStep
  summary(): CourseSummary
}

/**
 * The live view of the course's vault that App passes to the layer (a type only: App loads no course code). Each field
 * is read when the course needs it, so the host stays the same object while the vault's state changes.
 */
export interface CourseVault {
  root: string
  /** The vault's index (App's `wikilinks` source): the records, the folder records, IDs on, and a change listener. */
  index: {
    readonly records: readonly IndexRecord[]
    readonly folders: readonly IndexRecord[]
    readonly ids: boolean
    subscribe(listener: () => void): () => void
  }
  /** The index has loaded (until then `ids` reads false). */
  ready(): boolean
  /** The vault is read only (Settings › Read only). */
  readOnly(): boolean
  /** The vault's Review: its file was read, it is on, and its settings (for the schedule). */
  review(): { ready: boolean; on: boolean; settings: ReviewSettings }
  /** The app's own copy of the card skill (`storage.getCardSkill`); null when there is none. */
  cardSkill: string | null
}

/** The line a scene shows when the layer has no vault view (the frame alone, or a test). */
export const SHOW_ONLY_NOT_YET = 'In this build the course only shows. It makes no files yet.'

const EMPTY_SUMMARY: CourseSummary = Object.freeze({ folder: null, cards: [] })

function blankStep(showOnly: string | null): AgentStepState {
  return { text: '', example: false, prompt: showOnly === null ? null : { showOnly }, copiedAt: null, cards: [], read: [], quiet: false, examples: 'hidden', problem: null }
}

/** An AI step that can only show: it keeps the text and shows the examples, and writes nothing. */
function showOnlyStep(reason: string): AgentStep {
  let state = blankStep(reason)
  const listeners = new Set<() => void>()
  const set = (patch: Partial<AgentStepState>): void => {
    state = { ...state, ...patch }
    listeners.forEach((l) => l())
  }
  return {
    state: () => state,
    subscribe: (l) => (listeners.add(l), () => void listeners.delete(l)),
    setText: (text) => set({ text, example: false }),
    useExample: () => undefined,
    preparePrompt: () => Promise.resolve(),
    copy: () => Promise.resolve(),
    markRead: () => undefined,
    showExamples: () => set({ examples: 'shown' }),
    makeExamples: () => (set({ problem: reason }), Promise.resolve()),
    stop: () => undefined,
  }
}

/** The frame's host: it makes nothing, and each step says why in one line. */
export function showOnlyHost(vault: string | null, reason = vault === null ? 'Open a vault to make real cards.' : SHOW_ONLY_NOT_YET): CourseHost {
  return {
    vault,
    courseCards: () => Promise.resolve({ showOnly: reason }),
    watchCards: (_folder, onCards) => {
      onCards([])
      return () => undefined
    },
    makeFirstCard: () => Promise.resolve({ showOnly: reason }),
    coursePage: () => Promise.resolve({ showOnly: reason }),
    readCard: () => Promise.resolve(null),
    agentStep: showOnlyStep(reason),
    summary: () => EMPTY_SUMMARY,
  }
}

/**
 * The test double (for the scene builders' tests): a host whose files live in memory. `arrive` plays an agent writing
 * a card into the folder; `step` is an AI step the test drives by hand (`set`). It has every member of `CourseHost`.
 */
export interface MemoryHost extends CourseHost {
  folder: string
  /** The cards the host "made" (first cards). */
  made: MadeCard[]
  /** The cards in the folder now, as `watchCards` gives them. */
  cards: CourseCard[]
  arrive(card: CourseCard, text?: string): void
  /** Sets the AI step's state directly, and wakes its listeners. */
  set(patch: Partial<AgentStepState>): void
}

export function memoryHost(vault = '/vault'): MemoryHost {
  const folder = `${vault}/course-cards`
  const texts = new Map<string, string>()
  const watchers = new Set<(cards: readonly CourseCard[]) => void>()
  let state = blankStep(null)
  const listeners = new Set<() => void>()
  const set = (patch: Partial<AgentStepState>): void => {
    state = { ...state, ...patch }
    listeners.forEach((l) => l())
  }
  const host: MemoryHost = {
    vault,
    folder,
    made: [],
    cards: [],
    courseCards: () => Promise.resolve({ path: folder }),
    watchCards: (_at, onCards) => {
      watchers.add(onCards)
      onCards(host.cards)
      return () => void watchers.delete(onCards)
    },
    makeFirstCard: (input) => {
      const front = typeof input.hidden === 'string' ? input.front.replace(input.hidden, `{{${input.hidden}}}`) : `${input.front.slice(0, input.hidden.start)}{{${input.front.slice(input.hidden.start, input.hidden.end)}}}${input.front.slice(input.hidden.end)}`
      const made: MadeCard = { path: `${folder}/card-${host.made.length + 1}.md`, title: input.front.slice(0, 60), text: input.back === '' ? front : `${front}\n---\n${input.back}`, titleHidden: false }
      host.made.push(made)
      return Promise.resolve(made)
    },
    coursePage: () => Promise.resolve({ path: `${folder}/course-page.md` }),
    readCard: (card) => {
      const text = texts.get(courseCardKey(card))
      const known = host.cards.find((c) => courseCardKey(c) === courseCardKey(card))
      return Promise.resolve(text === undefined || known === undefined ? null : { title: known.title, sides: text.split('\n---\n') })
    },
    agentStep: {
      state: () => state,
      subscribe: (l) => (listeners.add(l), () => void listeners.delete(l)),
      setText: (text) => set({ text, example: false }),
      useExample: () => set({ text: 'Example text', example: true }),
      preparePrompt: () => (set({ prompt: { text: `Prompt\n\n${state.text}`, folder } }), Promise.resolve()),
      copy: () => (set({ copiedAt: Date.now() }), Promise.resolve()),
      markRead: (card) => set({ read: [...new Set([...state.read, courseCardKey(card)])] }),
      showExamples: () => set({ examples: 'shown' }),
      makeExamples: () => (set({ examples: [] }), Promise.resolve()),
      stop: () => undefined,
    },
    summary: () => ({ folder, cards: host.cards.map((c) => ({ path: c.path, title: c.title, due: null })) }),
    arrive(card, text = 'A {{card}}\n---\nIts back') {
      host.cards = [...host.cards, card]
      texts.set(courseCardKey(card), text)
      watchers.forEach((w) => w(host.cards))
      if (state.copiedAt !== null) set({ cards: [...state.cards, card], quiet: false })
    },
    set,
  }
  return host
}
