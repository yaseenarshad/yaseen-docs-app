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
 * - The course knows its folder by the folder's ID (YAZ-5202): the `id` in its `.folder.md`, which every folder of a
 *   vault with IDs has, kept in `made` with the path. A folder at the saved path with another ID is the person's (they
 *   deleted the course's and made their own); a folder at the top with the saved ID is the course's, renamed.
 * - A read-only vault, IDs off, or Review off: the course only shows. Nothing is written, and the step says why.
 * - Each card the course writes is a card file as "New card" and `yaseendocs card new` write it (`cardFileContent`,
 *   `cardFileName`): `kind: card` alone in its front matter, one card with its sides, and its card line with its new ID
 *   from the vault's door and its title (`title "…"`, YAZ-5308: a card's title is on its card line, never in its text
 *   or its front matter).
 *   A file is never written over; a repeat makes a second file.
 * - The AI step copies a prompt and watches the folder through the vault's index. The app runs no agent and sends
 *   nothing anywhere. Nothing grades the agent's cards: the person reads each.
 * - What the course made is kept in `AppState.course.made`, a record only: every file is in the sidebar.
 */
import { cardFileContent, cardFileName, isCardKind } from '@shared/cardFileFormat'
import { EMPTY_CARD_LINE, cardTime, cardTitleOf, findCards, withCardId, withCardNext, withCardNoTitle, withCardReview, type CardReview } from '@shared/cardLine'
import { cardState, previewAnswers } from '@shared/cardSchedule'
import { cardSkillFolder } from '@shared/cardSkillFolder'
import { cardSides } from '@shared/cardText'
import type { CourseMade } from '@shared/courseState'
import { parseFrontmatter, splitFrontmatter } from '@shared/frontmatter'
import { createPage, folderPath, type PageDisk } from '@shared/pageBirth'
import type { ReviewSettings } from '@shared/reviews'
import { PAGE_ID_KEY } from '@shared/pageId'
import { FOLDER_SETTINGS_FILE, type IndexRecord } from '@shared/types'
import { typedFolders } from '@shared/linkResolver'
import { storage } from '../lib/storage'
import { bridgeDisk } from '../views/scaffold'
import { cardSkillPrompt } from '../vault/cardSkill'
import {
  courseCardKey,
  givenAfter,
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
  reviewOff: 'Cards are off in this vault, so the course only shows. Turn them on in Settings › Cards.',
} as const

/** The AI step's lines that are not in the script. */
export const AGENT_LINES = {
  noText: 'Paste some text you have chewed on, or use the example.',
  noCopy: "Can't copy the prompt. Select it, and copy it by hand.",
} as const

/** How long the AI step waits for a first card before `NO_CARDS_YET` shows (YAZ-5124). It keeps waiting after. */
export const NO_CARDS_YET_MS = 60_000
/** After "Still working" (YAZ-5347), the question comes back this much later if no card has come. */
export const STILL_WORKING_MS = 120_000

/** The longest title the course takes from a typed front. */
const TITLE_MAX = 60

// ---------------------------------------------------------------------------------------------------------------
// The words the course writes (made up; an adult who learns for themself, not a student)

/** "Use the example": a short text the person could have chewed on. */
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
function showOnlyReason(vault: CourseVault): string | null {
  const review = vault.review()
  if (!vault.ready() || !review.ready) return SHOW_ONLY.loading
  if (vault.readOnly()) return SHOW_ONLY.readOnly
  if (!vault.index.ids) return SHOW_ONLY.noIds
  if (!review.on) return SHOW_ONLY.reviewOff
  return null
}

/** The course's folder titles in the order it tries them: "Course Cards", "Course Cards 2", "Course Cards 3", … */
const courseCardsTitle = (n: number): string => (n <= 1 ? COURSE_CARDS : `${COURSE_CARDS} ${n}`)
/** How many titles the course tries before it gives up (a vault with this many folders of that name is not a real case). */
const MAX_COURSE_FOLDERS = 99

/** Is a folder at the top of the vault titled or named `title`, or named as "New folder" would name it (any case)? */
function takenAtTop(root: string, records: readonly IndexRecord[], folders: readonly IndexRecord[], title: string): boolean {
  if (typedFolders(folders)('', title) !== undefined) return true
  const names = new Set([title.toLowerCase(), folderPath(root, title, true).slice(root.length + 1).toLowerCase()])
  const topOf = (folder: string): string => folder.split('/')[0].toLowerCase()
  return [...records, ...folders].some((r) => r.folder !== '' && names.has(topOf(r.folder)))
}

/** Is `path` a folder right at the top of `root`? */
const atTop = (root: string, path: string): boolean => path.startsWith(`${root}/`) && !path.slice(root.length + 1).includes('/')

/** The course title a folder at `path` was named from ("Course Cards", "Course Cards 2", …), or null for any other name. */
function courseTitleOf(root: string, path: string): string | null {
  for (let n = 1; n <= MAX_COURSE_FOLDERS; n++) if (folderPath(root, courseCardsTitle(n), true) === path) return courseCardsTitle(n)
  return null
}

/** Does a folder at the top, other than the one at `except` (root-relative), have the title `title` in the index? */
const titledAtTop = (folders: readonly IndexRecord[], title: string, except: string): boolean =>
  folders.some((f) => f.folder !== except && f.folder !== '' && !f.folder.includes('/') && f.title.toLowerCase() === title.toLowerCase())

/** The ID in the settings file (`.folder.md`) of the folder at `path`, read from the disk; null: gone, a plain folder, or no ID. */
async function folderIdAt(disk: PageDisk, path: string): Promise<string | null> {
  const content = await disk.read(`${path}/${FOLDER_SETTINGS_FILE}`).catch(() => null)
  if (content === null) return null
  const id = parseFrontmatter(splitFrontmatter(content).frontmatter).properties[PAGE_ID_KEY]
  return typeof id === 'string' && id !== '' ? id : null
}

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
function skillFolderOf(vault: Pick<CourseVault, 'root' | 'index' | 'cardSkill'>): string | null {
  const isFolder = (path: string): boolean => vault.index.records.some((r) => r.path.startsWith(`${path}/`)) || vault.index.folders.some((f) => `${vault.root}/${f.folder}` === path)
  if (vault.cardSkill === null) {
    const own = cardSkillFolder(vault.root, '', isFolder)
    return own === '' ? null : own
  }
  return cardSkillFolder(vault.root, vault.cardSkill, isFolder)
}

/** The first sentence when no card skill can be named (no app copy, no vault copy): the agent reads it through the command. */
const NO_SKILL_SENTENCE = 'Run `yaseendocs card guide` and read the card skill before you make or change cards in this vault.'

/**
 * The prompt for the person's own agent: `AGENT_PROMPT` with the skill's path; then the agent drafts 3 cards in the chat,
 * waits for the person's OK on each, and writes a card file in the full path of "Course Cards" only for an approved one
 * (Yaseen: the person chews the cards by reading the drafts in the chat); then the text.
 */
export function agentPrompt(skill: string | null, folder: string, text: string): string {
  const first = skill === null ? NO_SKILL_SENTENCE : cardSkillPrompt(skill)
  return `${first} Then draft 3 cards from the text below, here in the chat. Show me each card in full, and wait for my OK. Write a card file in "${folder}" only for each card I approve.\n\n${text.trim()}\n`
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
function courseSummary(records: readonly IndexRecord[], root: string, folder: string | null, settings: ReviewSettings): CourseSummary {
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

/** A card to read: its title off its card line (YAZ-5308, in a card file and in a page alike), and its sides. */
function cardTextOf(content: string, index: number): CourseCardText | null {
  const card = findCards(splitFrontmatter(content).body)[index]
  if (card === undefined) return null
  return { title: cardTitleOf(card.line), sides: cardSides(card.text) }
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

const appDeps = (): CourseHostDeps => ({
  disk: bridgeDisk,
  made: { get: () => storage.getCourse().made, set: (made) => storage.setCourse({ made }) },
  clipboard: (text) => navigator.clipboard.writeText(text),
  now: () => Date.now(),
})

/**
 * The review the Inbox writes for this answer now (YAZ-5203): the Inbox's own preview of its buttons (`previewAnswers`,
 * the review `writeCardAnswer` puts on the line), Forgot as `again` and Remembered as `good`. The course does not time
 * the answer, so the review has no seconds, as a review that nothing timed.
 */
function firstReview(answer: 'forgot' | 'remembered', settings: ReviewSettings, now: number): CardReview {
  const rating = answer === 'forgot' ? 'again' : 'good'
  const found = previewAnswers([], settings, now).find((a) => a.review.rating === rating)
  return found?.review ?? { at: cardTime(now), rating }
}

/**
 * Writes one card file in `dir`, as "New card" and `card new` do: a new ID, the title on the card line (`cardFileContent`,
 * YAZ-5308), the name from the title, never over a file. An empty title: no title part, the name `<id>.md`.
 * `review`: the card's first review, on its line in the same write (the line the Inbox's answer gives a new card).
 */
async function writeCardFile(disk: PageDisk, dir: string, title: string, text: string, titleHidden: boolean, review?: CardReview): Promise<MadeCard> {
  const id = await disk.mintId(dir)
  const fresh = withCardNoTitle(withCardId(EMPTY_CARD_LINE, id), titleHidden)
  const line = review === undefined ? fresh : withCardReview(withCardNext(fresh, false), review)
  const name = title.trim()
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

  /** A course folder's title: the index's, else the title its name was made from ("Course Cards", "Course Cards 2", …). */
  const titleAt = (path: string): string => {
    const indexed = vault.index.folders.find((f) => f.folder === relativeTo(root, path))?.title
    return typeof indexed === 'string' && indexed !== '' ? indexed : (courseTitleOf(root, path) ?? COURSE_CARDS)
  }
  /** A folder at the top whose settings file holds `id` in the index (the person renamed the course's folder). */
  const topFolderWithId = (id: string): string | null => {
    const found = vault.index.folders.find((f) => f.id === id && f.folder !== '' && !f.folder.includes('/'))
    return found === undefined ? null : `${root}/${found.folder}`
  }
  const keepFolder = (path: string, id: string | null): void =>
    remember(({ folderId: _old, ...m }) => ({ ...m, folder: path, ...(id === null ? {} : { folderId: id }) }))

  /**
   * The course's own folder in this vault, known by its ID (YAZ-5202), with its title. The folder at the saved path is
   * the course's only when its settings file holds the saved ID. Else a folder at the top with that ID is the course's,
   * renamed by the person: the course uses it under its new name. null: the course's folder is gone.
   */
  const ownFolder = async (): Promise<{ path: string; title: string } | null> => {
    const saved = madeHere()
    if (saved === undefined || saved.folder === '' || !atTop(root, saved.folder)) return null
    const id = await folderIdAt(deps.disk, saved.folder)
    if (saved.folderId === undefined) {
      // A record from before the course kept the ID: the folder at its path, and its ID from now on.
      if (id === null) return null
      keepFolder(saved.folder, id)
      return { path: saved.folder, title: titleAt(saved.folder) }
    }
    if (id === saved.folderId) return { path: saved.folder, title: titleAt(saved.folder) }
    const moved = topFolderWithId(saved.folderId)
    if (moved === null || (await folderIdAt(deps.disk, moved)) !== saved.folderId) return null
    keepFolder(moved, saved.folderId)
    return { path: moved, title: titleAt(moved) }
  }

  /** Makes the folder at `path` (nothing may be there), and keeps it with its new ID. false: a folder is there already. */
  const makeFolder = async (path: string, title: string): Promise<boolean> => {
    try {
      await deps.disk.createDir({ path, title })
    } catch (err) {
      if (deps.disk.isThere(err)) return false
      throw err
    }
    keepFolder(path, await folderIdAt(deps.disk, path))
    return true
  }

  const courseCards = async (): Promise<CourseCardsFolder> => {
    const reason = showOnlyReason(vault)
    if (reason !== null) return { showOnly: reason }
    const own = await ownFolder()
    if (own !== null) return own
    // Gone (the person deleted it): made again in its old place when nothing is there now and no other folder at the
    // top has its title (the index may still list the deleted folder for a moment).
    const was = madeHere()?.folder
    const wasTitle = was === undefined || !atTop(root, was) ? null : courseTitleOf(root, was)
    if (was !== undefined && wasTitle !== null && !titledAtTop(vault.index.folders, wasTitle, relativeTo(root, was)) && (await makeFolder(was, wasTitle))) {
      return { path: was, title: wasTitle }
    }
    // A new one: the first title no folder at the top has. A folder there already (the index a moment behind) is the person's.
    for (let n = 1; n <= MAX_COURSE_FOLDERS; n++) {
      const title = courseCardsTitle(n)
      if (takenAtTop(root, vault.index.records, vault.index.folders, title)) continue
      const path = folderPath(root, title, true)
      if (await makeFolder(path, title)) return { path, title }
    }
    throw new Error('The course could not find a free name for its Course Cards folder')
  }

  /** The course's folder as the index shows it now, by its ID (the end screen reads it without the disk). */
  const ownInIndex = (): string | null => {
    const saved = madeHere()
    if (saved === undefined || saved.folder === '' || !atTop(root, saved.folder)) return null
    if (saved.folderId === undefined) return saved.folder
    const at = vault.index.folders.find((f) => f.folder === relativeTo(root, saved.folder))
    return at?.id === saved.folderId ? saved.folder : topFolderWithId(saved.folderId)
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
      const review = input.answer === undefined ? undefined : firstReview(input.answer, vault.review().settings, deps.now())
      const made = await writeCardFile(deps.disk, at.path, card.title, card.text, card.titleHidden, review)
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
      const folder = ownInIndex()
      if (folder === null) return courseSummary(vault.index.records, root, null, vault.review().settings)
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
  let state: AgentStepState = { text: '', example: false, given: false, prompt: null, copiedAt: null, cards: [], read: [], quiet: false, examples: 'hidden', problem: null }
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
  const startTimer = (ms = NO_CARDS_YET_MS): void => {
    clearTimer()
    timer = setTimeout(() => {
      timer = null
      if (state.cards.length === 0) set({ quiet: true })
    }, ms)
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
    setText: (text, how = 'typed') => set({ text, example: false, given: givenAfter(state.given, text, how), prompt: null, problem: null }),
    useExample: () => set({ text: EXAMPLE_TEXT, example: true, given: true, prompt: null, problem: null }),
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
    stillWorking() {
      if (state.copiedAt === null || state.cards.length > 0) return
      set({ quiet: false })
      startTimer(STILL_WORKING_MS)
    },
    stop() {
      unwatch?.()
      unwatch = null
      clearTimer()
    },
  }
  return { step, attach }
}
