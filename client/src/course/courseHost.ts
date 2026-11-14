/**
 * THE COURSE'S SIDE EFFECTS (YAZ-5120 the seam, YAZ-5124 the real one): what the course does in the person's vault.
 * The frame passes one `CourseHost` to each scene (`SceneProps.host`). The real host is `vaultCourseHost`
 * (`courseCards.ts`, in the lazy course chunk); `showOnlyHost` makes nothing and says why. The test double
 * `memoryHost` is in `scenes/testing.tsx`. A test keeps the three in step (`courseCards.test.ts`).
 *
 * Everything the course makes is a plain file in its folder "Course Cards" (or "Course Cards 2" when the person has a
 * "Course Cards" of their own, YAZ-5202) at the top of the vault: the person sees it
 * in the sidebar, and deleting any of it (the whole folder too) is always safe. The course makes what a step needs again.
 * The app has no AI inside and sends nothing anywhere: the AI step only copies a prompt and watches the folder.
 *
 * - `vault`: the course's vault, or null with none open.
 * - `courseCards()`: the folder, made the first time a step needs it. `{ showOnly }` when the course must only show (no
 *   vault, a read-only vault, IDs off, Review off): the one line for the person, and nothing is written.
 * - `watchCards(folder, onCards)`: every card in the folder (card files, and cards inside a page there), at once and on
 *   each change of the vault's index. Returns the way to stop.
 * - `makeFirstCard(input)`: chapter 2's card file from what the person typed, with their answer as its first review
 *   (YAZ-5203: the review the Inbox writes for that answer). A repeat makes a second file.
 * - `coursePage()`: chapter 4's "Course page" in the folder, made when first needed.
 * - `readCard(card)`: the card's sides, to read it in the course (the AI step's "Read").
 * - `agentStep`: the AI step's state (chapter 8). It lives in the host, not in a scene: the layer unmounts a scene at
 *   the end of each clip, and the text, the copied prompt and the Read ticks must last from `c8-11` to `c8-16`.
 * - `summary()`: the end screen's numbers: the cards in the folder and when each comes back, from the real schedule.
 */
import type { ReviewSettings } from '@shared/reviews'
import type { IndexRecord } from '@shared/types'

/**
 * The folder, or the one line that says why the course only shows. `title`: the folder's real title ("Course Cards", or
 * "Course Cards 2" when the person has a "Course Cards" of their own, YAZ-5202); absent: "Course Cards".
 */
export type CourseCardsFolder = { path: string; title?: string } | { showOnly: string }

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

/**
 * What the person did in chapter 2: the front they typed, the word they hid (as text, or where it stands in `front`),
 * the back line (none: ''), and their answer to "Did you remember it?" (YAZ-5203: the card's first review; absent: none).
 */
export interface FirstCardInput {
  front: string
  hidden: string | { start: number; end: number }
  back: string
  answer?: 'forgot' | 'remembered'
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

/** How the box's text changed: typed (the step waits on), or pasted (the person gave their text). */
type TextChange = 'typed' | 'pasted'

/** `given` after a change of the box to `text` (YAZ-5270): a paste with text gives it; an empty box takes it back. */
export const givenAfter = (was: boolean, text: string, how: TextChange): boolean => text.trim() !== '' && (was || how === 'pasted')

/** Where the AI step is. `text`: the box; `copied`: the prompt was copied, the course waits for cards. */
export interface AgentStepState {
  text: string
  /** The person used the example text (the box holds it unchanged). */
  example: boolean
  /**
   * The person gave their text (YAZ-5270): "Use the example", or a paste that left text in the box. Typing alone never
   * gives it (the person may still be typing); an empty box takes it back. The course's Next always moves on.
   */
  given: boolean
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
  /** The real title of the course's folder, once the step knows it (YAZ-5202); absent: "Course Cards". */
  folderTitle?: string
}

export interface AgentStep {
  state(): AgentStepState
  subscribe(listener: () => void): () => void
  /** The box's new text; `pasted`: the change was a paste (it gives the text, YAZ-5270). */
  setText(text: string, how?: TextChange): void
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

/** The line of the course with no vault open. */
export const NO_VAULT = 'Open a vault to make real cards.'

const EMPTY_SUMMARY: CourseSummary = Object.freeze({ folder: null, cards: [] })

/** A new AI step's state; `showOnly`: the one line when it can only show. */
export function blankStep(showOnly: string | null): AgentStepState {
  return { text: '', example: false, given: false, prompt: showOnly === null ? null : { showOnly }, copiedAt: null, cards: [], read: [], quiet: false, examples: 'hidden', problem: null }
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
    setText: (text, how = 'typed') => set({ text, example: false, given: givenAfter(state.given, text, how) }),
    useExample: () => undefined,
    preparePrompt: () => Promise.resolve(),
    copy: () => Promise.resolve(),
    markRead: () => undefined,
    showExamples: () => set({ examples: 'shown' }),
    makeExamples: () => (set({ problem: reason }), Promise.resolve()),
    stop: () => undefined,
  }
}

/** A host that makes nothing: each step says `reason` in one line. */
export function showOnlyHost(vault: string | null, reason: string): CourseHost {
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
