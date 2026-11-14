/**
 * COURSE CARDS (YAZ-5124, issue 6F of YAZ-5118): the real things the card course leaves in the person's vault, and the
 * step where the person uses their OWN agent. In the lazy course chunk; App passes only a live view of the vault
 * (`CourseVault`, a type).
 *
 * - The folder "Course Cards", at the top of the course's vault, made the first time a step needs it, as "New folder"
 *   makes it (`folderPath`): `course-cards` on disk with the title "Course Cards". Never anywhere else. Deleted, it is
 *   made again when a step needs it. A "Course Cards" at the top that the course did not make (it is not in
 *   `AppState.course.made` for this vault) is the person's: the course makes "Course Cards 2" (then 3, …), and never
 *   writes into theirs (YAZ-5202, the locked decision on YAZ-5060).
 * - A read-only vault, IDs off, or Review off: the course only shows. Nothing is written, and the step says why.
 * - Each card the course writes is a card file as "New card" and `yaseendocs card new` write it (`cardFileContent`,
 *   `cardFileName`): `kind: card`, the title in `title:`, one card with its sides, a new ID from the vault's door.
 *   A file is never written over; a repeat makes a second file.
 * - The AI step copies a prompt and watches the folder through the vault's index. The app runs no agent and sends
 *   nothing anywhere. The card check was removed (YAZ-5060): nothing grades the agent's cards; the person reads each.
 * - What the course made is kept in `AppState.course.made`, a record only: every file is in the sidebar.
 */
import { NEW_CARD_TEXT, cardFileContent, cardFileName, isCardKind } from '@shared/cardFileFormat'
import { EMPTY_CARD_LINE, findCards, withCardId, withCardNoTitle } from '@shared/cardLine'
import { cardState } from '@shared/cardSchedule'
import { cardSkillFolder } from '@shared/cardSkillFolder'
import { cardSides, cardTitle } from '@shared/cardText'
import type { CourseMade } from '@shared/courseState'
import { parseFrontmatter, splitFrontmatter } from '@shared/frontmatter'
import { createPage, folderPath, type PageDisk } from '@shared/pageBirth'
import { TITLE_KEY } from '@shared/pageName'
import type { ReviewSettings } from '@shared/reviews'
import type { IndexRecord } from '@shared/types'
import { typedFolders } from '@shared/linkResolver'
import { storage } from '../lib/storage'
import { bridgeDisk } from '../views/scaffold'
import { cardSkillPrompt } from '../vault/cardSkill'
import {
  courseCardKey,
  type AgentStep,
  type AgentStepState,
  type CourseCard,
  type CourseCardsFolder,
  type CourseCardText,
  type CourseHost,
  type CourseSummary,
  type CourseVault,
  type FirstCardInput,
  type MadeCard,
} from './courseHost'

/** The folder's title. */
export const COURSE_CARDS = 'Course Cards'
/** Chapter 4's page in the folder. */
export const COURSE_PAGE = 'Course page'
/** The one line in the Course page: the place to paste a card's link and show it as an embed. */
export const COURSE_PAGE_LINE = "Paste your card's link here, then right-click it and choose Show as embed."

/** The one line for each reason the course only shows. */
export const SHOW_ONLY = {
  loading: 'Your vault is still loading, so the course only shows for now.',
  readOnly: 'This vault is read only, so the course only shows. It makes no files.',
  noIds: 'This vault does not give its pages IDs, so it has no cards. The course only shows.',
  reviewOff: 'Review is off in this vault, so the course only shows. Turn it on in Settings › Review.',
} as const

/** The AI step's lines that are not in the script. */
export const AGENT_LINES = {
  noText: 'Paste some text you have digested, or use the example.',
  noCopy: "Can't copy the prompt. Select it, and copy it by hand.",
} as const

/** How long the AI step waits for a first card before `NO_CARDS_YET` shows (YAZ-5124). It keeps waiting after. */
export const NO_CARDS_YET_MS = 60_000

/** The longest title the course takes from a typed front. */
const TITLE_MAX = 60

// ---------------------------------------------------------------------------------------------------------------
// The words the course writes (made up; an adult who learns for themself, not a student)

/** "Use the example": a short text the person could have digested. */
export const EXAMPLE_TEXT = [
  'What I took from a weekend bread class.',
  '',
  'Bread rises because yeast eats the sugars in the flour and gives off carbon dioxide. The gas is trapped by gluten, a stretchy web of proteins that forms when flour meets water and is kneaded. Too little kneading, and the gas escapes: the loaf comes out flat and dense.',
  '',
  'A long, cool rise, such as a night in the fridge, gives more flavour than a quick, warm one. In the slow rise, enzymes in the flour have time to break starch into sugars.',
  '',
  'To see if the dough is ready to bake, press a finger into it. If the dent springs back slowly and only part of the way, it is ready. If it springs back at once, it needs more time. If it does not spring back at all, it has risen too long.',
].join('\n')

/** "No agent? Skip": the three example cards, in Yaseen's shape: a short front with hidden words, a back in sections. */
export const EXAMPLE_CARDS: readonly { title: string; text: string }[] = [
  {
    title: 'How bread rises',
    text: [
      'Bread rises because {{yeast}} eats the sugars in the flour and gives off {{carbon dioxide}}, which the dough traps.',
      '---',
      'The gas is held by gluten: a stretchy web of proteins that forms when flour meets water and is kneaded.',
      '***',
      'Example: with too little kneading, the gas escapes, and the loaf comes out flat and dense.',
      '***',
      'Hook: the yeast blows the bubbles, and the gluten is the balloon.',
    ].join('\n'),
  },
  {
    title: 'A slow rise for flavour',
    text: [
      'A long, {{cool}} rise gives bread more flavour than a quick, warm one.',
      '---',
      'How it works: in the slow rise, enzymes in the flour have time to break {{starch into sugars}}.',
      '***',
      'Example: shape the dough in the evening, leave it in the fridge for the night, and bake it in the morning.',
      '***',
      'Hook: time is an ingredient.',
    ].join('\n'),
  },
  {
    title: 'The poke test for dough',
    text: [
      'To see if dough is ready to bake, press a finger in. It is ready when the dent springs back {{slowly and only part of the way}}.',
      '---',
      'If the dent springs back at once, the dough needs more time.',
      '***',
      'If the dent does not spring back at all, the dough has risen too long, and the loaf may sink in the oven.',
      '***',
      'Hook: ready dough is like a pillow, not a sponge or a balloon.',
    ].join('\n'),
  },
]

// ---------------------------------------------------------------------------------------------------------------
// Pure parts

/** Why the course must only show in this vault, or null when it can make files. */
export function showOnlyReason(vault: CourseVault): string | null {
  const review = vault.review()
  if (!vault.ready() || !review.ready) return SHOW_ONLY.loading
  if (vault.readOnly()) return SHOW_ONLY.readOnly
  if (!vault.index.ids) return SHOW_ONLY.noIds
  if (!review.on) return SHOW_ONLY.reviewOff
  return null
}

/** The course's folder titles in the order it tries them: "Course Cards", "Course Cards 2", "Course Cards 3", … */
export const courseCardsTitle = (n: number): string => (n <= 1 ? COURSE_CARDS : `${COURSE_CARDS} ${n}`)
/** How many titles the course tries before it gives up (a vault with this many folders of that name is not a real case). */
const MAX_COURSE_FOLDERS = 99

/** Is a folder at the top of the vault titled or named `title`, or named as "New folder" would name it (any case)? */
export function takenAtTop(root: string, records: readonly IndexRecord[], folders: readonly IndexRecord[], title: string): boolean {
  if (typedFolders(folders)('', title) !== undefined) return true
  const names = new Set([title.toLowerCase(), folderPath(root, title, true).slice(root.length + 1).toLowerCase()])
  const topOf = (folder: string): string => folder.split('/')[0].toLowerCase()
  return [...records, ...folders].some((r) => r.folder !== '' && names.has(topOf(r.folder)))
}

/** Is `path` a folder right at the top of `root`? */
const atTop = (root: string, path: string): boolean => path.startsWith(`${root}/`) && !path.slice(root.length + 1).includes('/')

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Where the hidden word stands in the front: the range given, else the word's first whole-word place (any case). */
function hiddenRange(front: string, hidden: FirstCardInput['hidden']): { start: number; end: number } {
  if (typeof hidden !== 'string') {
    if (hidden.start < 0 || hidden.end > front.length || hidden.start >= hidden.end) throw new Error('The hidden word is not in the front')
    return hidden
  }
  const word = hidden.trim()
  if (word === '') throw new Error('The hidden word is empty')
  const whole = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(word)}(?![\\p{L}\\p{N}])`, 'u')
  const m = whole.exec(front) ?? new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(word)}(?![\\p{L}\\p{N}])`, 'iu').exec(front)
  const at = m?.index ?? front.indexOf(word)
  if (at === -1) throw new Error('The hidden word is not in the front')
  return { start: at, end: at + word.length }
}

/** A title from a typed front: its first sentence, as plain text, cut at a word to `TITLE_MAX` characters. */
export function titleFromFront(front: string): string {
  const plain = front.replace(/\{\{([\s\S]*?)\}\}/g, '$1').replace(/\s+/g, ' ').trim()
  const sentence = (/^.*?[.!?](?=\s|$)/.exec(plain)?.[0] ?? plain).replace(/[.!?]+$/, '').trim()
  if (sentence.length <= TITLE_MAX) return sentence
  const cut = sentence.slice(0, TITLE_MAX + 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > 20 ? cut.slice(0, space) : cut.slice(0, TITLE_MAX)).replace(/[,;:\s]+$/, '')}…`
}

/** Chapter 2's card from what the person typed: its title, its text (front, and the back after `---`), and whether the title would give the answer away. */
export function firstCard(input: FirstCardInput): { title: string; text: string; titleHidden: boolean } {
  const front = input.front.replace(/\r\n?/g, '\n')
  const { start, end } = hiddenRange(front, input.hidden)
  const word = front.slice(start, end)
  const marked = `${front.slice(0, start)}{{${word}}}${front.slice(end)}`.trim()
  const back = input.back.replace(/\r\n?/g, '\n').trim()
  const title = titleFromFront(front)
  return { title, text: back === '' ? marked : `${marked}\n---\n${back}`, titleHidden: title.toLowerCase().includes(word.trim().toLowerCase()) }
}

/** The card skill folder this vault uses: its own `Card skill` at the top (the index holds a page in it) wins, else the app's copy. */
export function skillFolderOf(vault: Pick<CourseVault, 'root' | 'index' | 'cardSkill'>): string | null {
  const isFolder = (path: string): boolean => vault.index.records.some((r) => r.path.startsWith(`${path}/`)) || vault.index.folders.some((f) => `${vault.root}/${f.folder}` === path)
  if (vault.cardSkill === null) {
    const own = cardSkillFolder(vault.root, '', isFolder)
    return own === '' ? null : own
  }
  return cardSkillFolder(vault.root, vault.cardSkill, isFolder)
}

/** The first sentence when no card skill can be named (no app copy, no vault copy): the agent reads it through the command. */
export const NO_SKILL_SENTENCE = 'Run `yaseendocs card guide` and read the card skill before you make or change cards in this vault.'

/**
 * The prompt for the person's own agent: `AGENT_PROMPT` with the skill's path, one sentence that asks for 3 card files
 * in the full path of "Course Cards", then the text. No check line: the card check was removed (YAZ-5060).
 */
export function agentPrompt(skill: string | null, folder: string, text: string): string {
  const first = skill === null ? NO_SKILL_SENTENCE : cardSkillPrompt(skill)
  return `${first} Then make 3 cards from the text below, as card files in "${folder}".\n\n${text.trim()}\n`
}

/** The folder's path from the vault's root, '/' separators (the index's `folder`). */
const relativeTo = (root: string, path: string): string => (path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path)

/** Every card in the folder (and the folders in it): card files and cards inside pages, in path order. */
export function cardsIn(records: readonly IndexRecord[], root: string, folder: string): CourseCard[] {
  const rel = relativeTo(root, folder)
  return records
    .filter((r) => (r.folder === rel || r.folder.startsWith(`${rel}/`)) && (r.cards?.length ?? 0) > 0)
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .flatMap((r) => {
      const file = isCardKind(r.properties)
      return (r.cards ?? []).map((c, index) => ({ path: r.path, index, id: c.id, title: (file && index === 0 ? r.title : c.title) ?? r.title }))
    })
}

/** The end screen: each card in the folder, and when it comes back (null: new, in the Inbox now). */
export function courseSummary(records: readonly IndexRecord[], root: string, folder: string | null, settings: ReviewSettings): CourseSummary {
  if (folder === null) return { folder: null, cards: [] }
  const rel = relativeTo(root, folder)
  const cards = records
    .filter((r) => r.folder === rel || r.folder.startsWith(`${rel}/`))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .flatMap((r) =>
      (r.cards ?? []).map((c, index) => {
        const state = cardState(c.reviews, settings)
        return { path: r.path, title: (isCardKind(r.properties) && index === 0 ? r.title : c.title) ?? r.title, due: state.isNew ? null : state.due }
      }),
    )
  return { folder, cards }
}

/** A card to read: its sides, from the file's text. A card file's title is its `title:`; a card in a page has its first line. */
export function cardTextOf(content: string, index: number): CourseCardText | null {
  const { frontmatter, body } = splitFrontmatter(content)
  const card = findCards(body)[index]
  if (card === undefined) return null
  const { properties } = parseFrontmatter(frontmatter)
  const fileTitle = isCardKind(properties) && typeof properties[TITLE_KEY] === 'string' ? (properties[TITLE_KEY] as string) : null
  return { title: fileTitle ?? cardTitle(card.text), sides: cardSides(card.text) }
}

const sameCards = (a: readonly CourseCard[], b: readonly CourseCard[]): boolean =>
  a.length === b.length && a.every((c, i) => courseCardKey(c) === courseCardKey(b[i]) && c.id === b[i].id && c.title === b[i].title)

// ---------------------------------------------------------------------------------------------------------------
// The real host

/** What the host needs outside the vault view. The app's: the bridge, `AppState.course.made`, the clipboard. Tests pass a temporary vault. */
export interface CourseHostDeps {
  disk: PageDisk
  made: { get(): readonly CourseMade[]; set(made: CourseMade[]): void }
  clipboard(text: string): Promise<void>
  now(): number
}

export const appDeps = (): CourseHostDeps => ({
  disk: bridgeDisk,
  made: { get: () => storage.getCourse().made, set: (made) => storage.setCourse({ made }) },
  clipboard: (text) => navigator.clipboard.writeText(text),
  now: () => Date.now(),
})

/** Writes one card file in `dir`, as "New card" and `card new` do: a new ID, the name from the title, never over a file. */
async function writeCardFile(disk: PageDisk, dir: string, title: string, text: string, titleHidden: boolean): Promise<MadeCard> {
  const id = await disk.mintId(dir)
  const line = withCardNoTitle(withCardId(EMPTY_CARD_LINE, id), titleHidden)
  const name = title.trim() === '' ? NEW_CARD_TEXT : title
  const path = `${dir}/${cardFileName(name, id)}`
  await disk.createFile({ path, content: cardFileContent(name, text, line) })
  return { path, title: name, text, titleHidden }
}

/** The AI step of each vault, kept for the session: a course closed in this step opens at it with its text and cards. */
const steps = new Map<string, { step: AgentStep; host: { current: VaultHost }; attach(): void }>()

interface VaultHost extends CourseHost {
  vaultView: CourseVault
  deps: CourseHostDeps
  remember(change: (made: CourseMade) => CourseMade): void
  madeHere(): CourseMade | undefined
}

/** The real host over the vault App shows (`CourseVault`). */
export function vaultCourseHost(vault: CourseVault, deps: CourseHostDeps = appDeps()): CourseHost {
  const root = vault.root
  const madeHere = (): CourseMade | undefined => deps.made.get().find((m) => m.vault === root)
  const remember = (change: (made: CourseMade) => CourseMade): void => {
    const all = deps.made.get()
    const was = all.find((m) => m.vault === root) ?? { vault: root, folder: '', cards: [], page: null }
    const next = change(was)
    deps.made.set([...all.filter((m) => m.vault !== root), next])
  }

  /** The course's own folder in this vault (`made`), with its title: the index's, else the title its name was made from. */
  const ownFolder = (): { path: string; title: string } | null => {
    const path = madeHere()?.folder
    if (path === undefined || path === '' || !atTop(root, path)) return null
    const rel = path.slice(root.length + 1)
    const indexed = vault.index.folders.find((f) => f.folder === rel)?.title
    let title = COURSE_CARDS
    for (let n = 1; n <= MAX_COURSE_FOLDERS; n++) if (folderPath(root, courseCardsTitle(n), true) === path) title = courseCardsTitle(n)
    return { path, title: typeof indexed === 'string' && indexed !== '' ? indexed : title }
  }

  const courseCards = async (): Promise<CourseCardsFolder> => {
    const reason = showOnlyReason(vault)
    if (reason !== null) return { showOnly: reason }
    // The course's own folder: used again; deleted (the index a moment behind), it is made again in the same place.
    const own = ownFolder()
    if (own !== null) {
      try {
        await deps.disk.createDir({ path: own.path, title: own.title })
      } catch (err) {
        if (!deps.disk.isThere(err)) throw err
      }
      return own
    }
    // A new one: the first title no folder at the top has. A folder there already (the index a moment behind) is the person's.
    for (let n = 1; n <= MAX_COURSE_FOLDERS; n++) {
      const title = courseCardsTitle(n)
      if (takenAtTop(root, vault.index.records, vault.index.folders, title)) continue
      const path = folderPath(root, title, true)
      try {
        await deps.disk.createDir({ path, title })
      } catch (err) {
        if (deps.disk.isThere(err)) continue
        throw err
      }
      remember((m) => ({ ...m, folder: path }))
      return { path, title }
    }
    throw new Error('The course could not find a free name for its Course Cards folder')
  }

  const watchCards = (folder: string, onCards: (cards: readonly CourseCard[]) => void): (() => void) => {
    let last: CourseCard[] = cardsIn(vault.index.records, root, folder)
    onCards(last)
    return vault.index.subscribe(() => {
      const now = cardsIn(vault.index.records, root, folder)
      if (sameCards(now, last)) return
      last = now
      onCards(now)
    })
  }

  const host: VaultHost = {
    vault: root,
    vaultView: vault,
    deps,
    remember,
    madeHere,
    courseCards,
    watchCards,
    async makeFirstCard(input) {
      const at = await courseCards()
      if ('showOnly' in at) return at
      const card = firstCard(input)
      const made = await writeCardFile(deps.disk, at.path, card.title, card.text, card.titleHidden)
      remember((m) => ({ ...m, cards: [...m.cards, made.path] }))
      return made
    },
    async coursePage() {
      const at = await courseCards()
      if ('showOnly' in at) return at
      const rel = relativeTo(root, at.path)
      const known = madeHere()?.page ?? null
      if (known !== null && known.startsWith(`${at.path}/`) && (await deps.disk.read(known)) !== null) return { path: known }
      const found = vault.index.records.find((r) => r.folder === rel && r.title === COURSE_PAGE && !isCardKind(r.properties))
      if (found !== undefined && (await deps.disk.read(found.path)) !== null) {
        remember((m) => ({ ...m, page: found.path }))
        return { path: found.path }
      }
      const path = await createPage(deps.disk, at.path, COURSE_PAGE, true, undefined, undefined, undefined, `${COURSE_PAGE_LINE}\n`)
      remember((m) => ({ ...m, page: path }))
      return { path }
    },
    async readCard(card) {
      const content = await deps.disk.read(card.path)
      return content === null ? null : cardTextOf(content, card.index)
    },
    get agentStep(): AgentStep {
      return agentStepOf(host)
    },
    summary() {
      // The course's own folder only (YAZ-5202): a "Course Cards" of the person's is not the course's.
      const folder = ownFolder()?.path
      if (folder === undefined) return courseSummary(vault.index.records, root, null, vault.review().settings)
      const there = vault.index.records.some((r) => r.folder === relativeTo(root, folder) || r.folder.startsWith(`${relativeTo(root, folder)}/`))
      return courseSummary(vault.index.records, root, there ? folder : null, vault.review().settings)
    },
  }
  return host
}

/** The AI step of the host's vault: one per vault for the session, always acting through the newest host. */
function agentStepOf(host: VaultHost): AgentStep {
  const held = steps.get(host.vaultView.root)
  if (held !== undefined) {
    if (held.host.current !== host) {
      held.host.current = host
      held.attach()
    }
    return held.step
  }
  const ref = { current: host }
  const { step, attach } = createAgentStep(ref)
  steps.set(host.vaultView.root, { step, host: ref, attach })
  return step
}

/** Forgets every vault's AI step (tests). */
export function forgetAgentSteps(): void {
  for (const { step } of steps.values()) step.stop()
  steps.clear()
}

function createAgentStep(ref: { current: VaultHost }): { step: AgentStep; attach(): void } {
  let state: AgentStepState = { text: '', example: false, prompt: null, copiedAt: null, cards: [], read: [], quiet: false, examples: 'hidden', problem: null }
  const listeners = new Set<() => void>()
  let unwatch: (() => void) | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  /** The cards in the folder when Copy was clicked, and the example cards: never "new from the agent". */
  const before = new Set<string>()

  const set = (patch: Partial<AgentStepState>): void => {
    state = { ...state, ...patch }
    listeners.forEach((l) => l())
  }
  const clearTimer = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }
  const startTimer = (): void => {
    clearTimer()
    timer = setTimeout(() => {
      timer = null
      if (state.cards.length === 0) set({ quiet: true })
    }, NO_CARDS_YET_MS)
  }
  const onCards = (cards: readonly CourseCard[]): void => {
    const fresh = cards.filter((c) => !before.has(courseCardKey(c)) && !state.cards.some((s) => courseCardKey(s) === courseCardKey(c)))
    // A card already listed keeps its place; its ID and title follow the index (the ID sweep gives one a moment later).
    const kept = state.cards.flatMap((s) => cards.filter((c) => courseCardKey(c) === courseCardKey(s)))
    if (fresh.length === 0 && sameCards(kept, state.cards)) return
    if (fresh.length > 0) clearTimer()
    set({ cards: [...kept, ...fresh], quiet: fresh.length > 0 || kept.length > 0 ? false : state.quiet })
  }

  /** The folder of the last prompt: a prompt built again for an edited text does not ask the disk again (Copy does). */
  let folderAt: string | null = null
  const promptFor = async (ensure: boolean): Promise<void> => {
    if (state.text.trim() === '') return set({ problem: AGENT_LINES.noText })
    const text = state.text
    const at: CourseCardsFolder = !ensure && folderAt !== null ? { path: folderAt } : await ref.current.courseCards()
    if ('showOnly' in at) return set({ prompt: at, problem: null })
    folderAt = at.path
    if (at.title !== undefined && state.folderTitle !== at.title) set({ folderTitle: at.title })
    if (state.text !== text) return promptFor(false) // the person typed on meanwhile: build it for the new text
    set({ prompt: { text: agentPrompt(skillFolderOf(ref.current.vaultView), at.path, text), folder: at.path }, problem: null })
  }
  const preparePrompt = (): Promise<void> => promptFor(false)

  /** Watches the folder of the copied prompt (again, after the course opens again at this step), and waits for a first card. */
  const watch = (folder: string): void => {
    unwatch?.()
    unwatch = ref.current.watchCards(folder, onCards)
    if (state.cards.length === 0 && !state.quiet) startTimer()
  }
  const attach = (): void => {
    const prompt = state.prompt
    if (state.copiedAt !== null && prompt !== null && !('showOnly' in prompt)) watch(prompt.folder)
  }

  const step: AgentStep = {
    state: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    setText: (text) => set({ text, example: false, prompt: null, problem: null }),
    useExample: () => set({ text: EXAMPLE_TEXT, example: true, prompt: null, problem: null }),
    preparePrompt,
    async copy() {
      // The folder is made (again, when the person deleted it) before the agent is asked to write into it.
      await promptFor(true)
      const prompt = state.prompt
      if (prompt === null || 'showOnly' in prompt) return
      try {
        await ref.current.deps.clipboard(prompt.text)
      } catch {
        return set({ problem: AGENT_LINES.noCopy })
      }
      // The first Copy sets what counts as new; a Copy after an edit keeps the cards already shown.
      if (state.copiedAt === null) {
        before.clear()
        for (const c of cardsIn(ref.current.vaultView.index.records, ref.current.vaultView.root, prompt.folder)) before.add(courseCardKey(c))
      }
      set({ copiedAt: ref.current.deps.now(), quiet: false })
      watch(prompt.folder)
    },
    markRead(card) {
      const key = courseCardKey(card)
      if (!state.read.includes(key)) set({ read: [...state.read, key] })
    },
    showExamples: () => {
      if (state.examples === 'hidden') set({ examples: 'shown' })
    },
    async makeExamples() {
      if (Array.isArray(state.examples)) return
      const at = await ref.current.courseCards()
      if ('showOnly' in at) return set({ problem: at.showOnly })
      const made: MadeCard[] = []
      for (const card of EXAMPLE_CARDS) {
        const one = await writeCardFile(ref.current.deps.disk, at.path, card.title, card.text, false)
        made.push(one)
        before.add(courseCardKey({ path: one.path, index: 0 }))
      }
      ref.current.remember((m) => ({ ...m, cards: [...m.cards, ...made.map((c) => c.path)] }))
      set({ examples: made, problem: null, ...(at.title === undefined ? {} : { folderTitle: at.title }) })
    },
    stop() {
      unwatch?.()
      unwatch = null
      clearTimer()
    },
  }
  return { step, attach }
}
