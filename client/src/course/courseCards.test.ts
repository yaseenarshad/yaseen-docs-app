/**
 * Course Cards and the AI step (YAZ-5124), in temporary vaults: the real host over main's own create calls (`createDir`,
 * `createFile`, with a made-up ID door) and an index built by main's own scan (`scanFile`). Nothing here runs an agent:
 * the test writes the "agent's" card files itself.
 */
import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cardFileContent, cardFileShape, isCardFileContent } from '@shared/cardFileFormat'
import { EMPTY_CARD_LINE, cardReviewsOf, findCards, withCardId, withCardNoTitle, withCardReview } from '@shared/cardLine'
import { cardState, previewAnswers } from '@shared/cardSchedule'
import { cardPieces, cardSides } from '@shared/cardText'
import type { CourseMade } from '@shared/courseState'
import { parseFrontmatter, splitFrontmatter } from '@shared/frontmatter'
import type { PageDisk } from '@shared/pageBirth'
import { DEFAULT_REVIEW_SETTINGS } from '@shared/reviews'
import { FOLDER_SETTINGS_FILE, type IndexRecord } from '@shared/types'
import { createDir, createFile } from '../../../desktop/src/main/fs/create'
import { BridgeFailure } from '../../../desktop/src/main/fs/fsUtils'
import { scanFile } from '../../../desktop/src/main/vaultIndex/scan'
import { AGENT_PROMPT, NO_CARDS_YET } from './prompt'
import { act } from 'react'
import { COURSE } from './script'
import { WAITING_CLIPS } from './waits'
import { courseScenes } from './scenes'
import { mountScene, testClock } from './scenes/testing'
import { TARGET_HELP, checkTour, inFolder } from './tourHelp'
import { memoryHost, showOnlyHost, type CourseHost, type CourseVault, type MadeCard } from './courseHost'
import {
  COURSE_PAGE,
  COURSE_PAGE_LINE,
  EXAMPLE_CARDS,
  EXAMPLE_TEXT,
  NO_CARDS_YET_MS,
  SHOW_ONLY,
  agentPrompt,
  firstCard,
  forgetAgentSteps,
  titleFromFront,
  vaultCourseHost,
  type CourseHostDeps,
} from './courseCards'

const APP_SKILL = '/Applications/Yaseen Docs.app/Contents/Resources/card-skill'

let root: string
let n: number

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'course-cards-'))
  n = 0
})
afterEach(async () => {
  forgetAgentSteps()
  vi.useRealTimers()
  await rm(root, { recursive: true, force: true })
})

const door = { letters: ['TST'] as const, mint: async (count: number) => Array.from({ length: count }, () => `TST-${++n}`) }
const disk = (): PageDisk => ({
  read: (path) => readFile(path, 'utf8').catch((err: NodeJS.ErrnoException) => (err.code === 'ENOENT' ? null : Promise.reject(err))),
  createFile: (req) => createFile(req, door),
  createDir: (req) => createDir(req, door),
  mintId: async () => (await door.mint(1))[0],
  isThere: (err) => err instanceof BridgeFailure && err.code === 'ALREADY_EXISTS',
})

/** Every Markdown file under `dir`, as main's index reads them: pages and card files, and the folders' settings files. */
async function scan(dir: string): Promise<{ records: IndexRecord[]; folders: IndexRecord[] }> {
  const records: IndexRecord[] = []
  const folders: IndexRecord[] = []
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    const record = await scanFile(root, join(entry.parentPath, entry.name))
    ;(entry.name === FOLDER_SETTINGS_FILE ? folders : records).push(record)
  }
  return { records, folders }
}

interface Opts {
  readOnly?: boolean
  ids?: boolean
  review?: boolean
  cardSkill?: string | null
}

/** A live vault view over the temporary vault, as App gives it; `refresh` plays the index's read after a watch event. */
function vaultOf(opts: Opts = {}) {
  const listeners = new Set<() => void>()
  const index = { records: [] as IndexRecord[], folders: [] as IndexRecord[], ids: opts.ids ?? true, subscribe: (l: () => void) => (listeners.add(l), () => void listeners.delete(l)) }
  const view: CourseVault = {
    root,
    index,
    ready: () => true,
    readOnly: () => opts.readOnly ?? false,
    review: () => ({ ready: true, on: opts.review ?? true, settings: DEFAULT_REVIEW_SETTINGS }),
    cardSkill: opts.cardSkill === undefined ? APP_SKILL : opts.cardSkill,
  }
  return {
    view,
    async refresh() {
      Object.assign(index, await scan(root))
      listeners.forEach((l) => l())
    },
  }
}

function depsOf() {
  let made: CourseMade[] = []
  const copied: string[] = []
  const deps: CourseHostDeps = { disk: disk(), made: { get: () => made, set: (next) => void (made = next) }, clipboard: async (text) => void copied.push(text), now: () => Date.now() }
  return { deps, copied, made: () => made }
}

const top = async (): Promise<string[]> => (await readdir(root)).filter((name) => !name.startsWith('.')).sort()
const cardFilesIn = async (dir: string): Promise<string[]> => (await readdir(dir)).filter((name) => name.endsWith('.md') && name !== FOLDER_SETTINGS_FILE).sort()

/** Writes a card file the way an agent would by hand (no card line), named as it likes. */
const agentWrites = (dir: string, name: string, title: string, text: string): Promise<void> => writeFile(join(dir, name), `---\nkind: card\ntitle: ${title}\n---\n\`\`\`card\n${text}\n\`\`\`\n`)

describe('the folder "Course Cards" (YAZ-5124)', () => {
  it('is made once, at the top, with its title; again after the person deletes it; and kept in AppState.course.made', async () => {
    const vault = vaultOf()
    const { deps, made } = depsOf()
    const host = vaultCourseHost(vault.view, deps)
    const first = await host.courseCards()
    expect(first).toEqual({ path: `${root}/course-cards`, title: 'Course Cards' })
    expect(await top()).toEqual(['course-cards'])
    const settings = parseFrontmatter(splitFrontmatter(await readFile(join(root, 'course-cards', FOLDER_SETTINGS_FILE), 'utf8')).frontmatter).properties
    expect(settings.title).toBe('Course Cards')
    await vault.refresh()
    expect(await host.courseCards()).toEqual(first)
    expect(await top()).toEqual(['course-cards'])
    expect(made()).toEqual([{ vault: root, folder: `${root}/course-cards`, cards: [], page: null }])

    // Deleted: the index is a moment behind, and the next step makes it again, in the same place.
    await rm(join(root, 'course-cards'), { recursive: true })
    expect(await host.courseCards()).toEqual(first)
    expect(await top()).toEqual(['course-cards'])
  })

  // YAZ-5202: this test said before that the course uses the person's own "Course Cards" as it is. That was wrong: the
  // locked decision on YAZ-5060 (round 2 suggestion 3, round 3 decision 14) says the course makes "Course Cards 2".
  it('YAZ-5202: a "Course Cards" at the top that the course did not make is the person\'s: the course makes "Course Cards 2", and writes nothing into theirs', async () => {
    await createDir({ path: join(root, 'my-cards'), title: 'Course Cards' }, door)
    const vault = vaultOf()
    await vault.refresh()
    const { deps, made } = depsOf()
    const host = vaultCourseHost(vault.view, deps)
    const at = await host.courseCards()
    expect(at).toEqual({ path: `${root}/course-cards-2`, title: 'Course Cards 2' })
    const settings = parseFrontmatter(splitFrontmatter(await readFile(join(root, 'course-cards-2', FOLDER_SETTINGS_FILE), 'utf8')).frontmatter).properties
    expect(settings.title).toBe('Course Cards 2')
    await vault.refresh()
    expect(await host.courseCards()).toEqual(at)
    expect(made()).toEqual([{ vault: root, folder: `${root}/course-cards-2`, cards: [], page: null }])
    const card = (await host.makeFirstCard({ front: 'Water boils at 100 degrees at sea level.', hidden: '100', back: '' })) as MadeCard
    expect(card.path.startsWith(`${root}/course-cards-2/`)).toBe(true)
    expect(await host.coursePage()).toMatchObject({ path: expect.stringMatching(new RegExp(`^${root}/course-cards-2/`)) })
    expect(await readdir(join(root, 'my-cards'))).toEqual([FOLDER_SETTINGS_FILE])
    expect(await top()).toEqual(['course-cards-2', 'my-cards'])
    // The AI step names the real folder: in the prompt (its full path) and in its own lines (its title).
    host.agentStep.useExample()
    await host.agentStep.preparePrompt()
    expect((host.agentStep.state().prompt as { folder: string }).folder).toBe(`${root}/course-cards-2`)
    expect(host.agentStep.state().folderTitle).toBe('Course Cards 2')
    // The end screen counts the course's folder, not the person's.
    await vault.refresh()
    expect(host.summary().folder).toBe(`${root}/course-cards-2`)
  })

  it('YAZ-5202: "Course Cards" and "Course Cards 2" both the person\'s give "Course Cards 3"; a folder `made` names is used again', async () => {
    await createDir({ path: join(root, 'mine'), title: 'Course Cards' }, door)
    await createDir({ path: join(root, 'mine-too'), title: 'Course Cards 2' }, door)
    const vault = vaultOf()
    await vault.refresh()
    const { deps } = depsOf()
    expect(await vaultCourseHost(vault.view, deps).courseCards()).toEqual({ path: `${root}/course-cards-3`, title: 'Course Cards 3' })
    await vault.refresh()
    // A new host (the course opened again) with the same record: the course's own folder, not a fourth one.
    expect(await vaultCourseHost(vault.view, deps).courseCards()).toEqual({ path: `${root}/course-cards-3`, title: 'Course Cards 3' })
    expect(await top()).toEqual(['course-cards-3', 'mine', 'mine-too'])
  })

  it('YAZ-5202: a "Course Cards" folder the course made (in `made`) is used again; a plain folder on disk of that name is the person\'s', async () => {
    const vault = vaultOf()
    const { deps } = depsOf()
    expect(await vaultCourseHost(vault.view, deps).courseCards()).toEqual({ path: `${root}/course-cards`, title: 'Course Cards' })
    await vault.refresh()
    expect(await vaultCourseHost(vault.view, deps).courseCards()).toEqual({ path: `${root}/course-cards`, title: 'Course Cards' })
    // Another vault where the person made the folder by hand (no folder settings file, so not in the index's folders).
    await rm(join(root, 'course-cards'), { recursive: true })
    const { mkdir } = await import('node:fs/promises')
    await mkdir(join(root, 'course-cards'))
    await vault.refresh()
    expect(await vaultCourseHost(vault.view, depsOf().deps).courseCards()).toEqual({ path: `${root}/course-cards-2`, title: 'Course Cards 2' })
  })

  it.each([
    ['a read-only vault', { readOnly: true }, SHOW_ONLY.readOnly],
    ['a vault with IDs off', { ids: false }, SHOW_ONLY.noIds],
    ['a vault with Review off', { review: false }, SHOW_ONLY.reviewOff],
  ])('in %s, gives the one plain line and writes nothing', async (_name, opts, line) => {
    const host = vaultCourseHost(vaultOf(opts).view, depsOf().deps)
    expect(await host.courseCards()).toEqual({ showOnly: line })
    expect(await host.makeFirstCard({ front: 'Water boils at 100 degrees at sea level.', hidden: '100', back: '' })).toEqual({ showOnly: line })
    expect(await host.coursePage()).toEqual({ showOnly: line })
    host.agentStep.useExample()
    await host.agentStep.copy()
    expect(host.agentStep.state().prompt).toEqual({ showOnly: line })
    expect(host.agentStep.state().copiedAt).toBeNull()
    host.agentStep.showExamples()
    await host.agentStep.makeExamples()
    expect(host.agentStep.state().problem).toBe(line)
    expect(await top()).toEqual([])
  })
})

describe('the first card (chapter 2)', () => {
  const input = { front: 'Protein keeps you full for longer than carbs do. It digests slowly.', hidden: 'Protein', back: 'Eggs at breakfast are an easy way to get it.' }

  it('is a card file the app and `card new` would write, that the app reads back as one card with the hidden word and the back', async () => {
    const host = vaultCourseHost(vaultOf().view, depsOf().deps)
    const made = (await host.makeFirstCard(input)) as MadeCard
    expect(made.path).toBe(`${root}/course-cards/protein-keeps-you-full-for-longer-than-carbs-do-tst-2.md`)
    expect(made.title).toBe('Protein keeps you full for longer than carbs do')
    expect(made.titleHidden).toBe(true)
    const content = await readFile(made.path, 'utf8')
    // Byte for byte the app's own writer (`cardFileContent`), with the ID the door gave and `notitle`: the title holds the answer.
    expect(content).toBe(cardFileContent(made.title, made.text, withCardNoTitle(withCardId(EMPTY_CARD_LINE, 'TST-2'), true)))
    expect(isCardFileContent(content)).toBe(true)
    const shape = cardFileShape(splitFrontmatter(content).body)
    expect(shape.problem).toBe('ok')
    const sides = cardSides(shape.cards[0].text)
    expect(sides).toEqual(['{{Protein}} keeps you full for longer than carbs do. It digests slowly.', 'Eggs at breakfast are an easy way to get it.'])
    expect(cardPieces(sides[0]).filter((p) => p.kind === 'hidden')).toEqual([{ kind: 'hidden', text: 'Protein' }])
    // The index reads it as one card, titled, with its ID.
    const record = await scanFile(root, made.path)
    expect(record.cards).toHaveLength(1)
    expect(record.cards?.[0]).toMatchObject({ id: 'TST-2', title: made.title, notitle: true })
  })

  it('YAZ-5121 with YAZ-5124: the chapter 2 scene, with the real host on a temporary vault, makes one valid card file from what the person typed', async () => {
    ;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    const ch = COURSE.find((c) => c.id === 'first-card')!
    const clip = (id: string) => ch.clips.find((c) => c.id === id)!
    const host = vaultCourseHost(vaultOf().view, depsOf().deps)
    const { clock } = testClock(4)
    const scene = mountScene(courseScenes('c2-07'), ch, { clock, done: () => undefined, host, waits: (c) => WAITING_CLIPS.has(c.id) })
    const typeInto = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      act(() => {
        Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }
    const click = (el: Element | null | undefined) => act(() => (el as HTMLElement).click())
    try {
      scene.render(clip('c2-07'))
      const field = scene.el.querySelector<HTMLTextAreaElement>('#kit-front')!
      typeInto(field, 'Light from the Sun takes about eight minutes to reach Earth.')
      act(() => field.form!.requestSubmit())
      scene.render(clip('c2-08'))
      click([...scene.el.querySelectorAll('.kit-word')].find((b) => b.textContent === 'eight'))
      scene.render(clip('c2-28'))
      const back = scene.el.querySelector<HTMLInputElement>('#kit-back')!
      typeInto(back, 'Light moves at about 300,000 km a second.')
      act(() => back.form!.requestSubmit())
      scene.render(clip('c2-10'))
      click(scene.el.querySelector('.kit-tap'))
      click(scene.el.querySelector('.kit-tap'))
      scene.render(clip('c2-11'))
      click([...scene.el.querySelectorAll('.card-inbox__answer')].find((b) => b.textContent?.includes('Remembered')))
      await vi.waitFor(async () => expect(await cardFilesIn(join(root, 'course-cards'))).toHaveLength(1))
      const [name] = await cardFilesIn(join(root, 'course-cards'))
      const content = await readFile(join(root, 'course-cards', name), 'utf8')
      expect(isCardFileContent(content)).toBe(true)
      const shape = cardFileShape(splitFrontmatter(content).body)
      expect(shape.problem).toBe('ok')
      expect(cardSides(shape.cards[0].text)).toEqual(['Light from the Sun takes about {{eight}} minutes to reach Earth.', 'Light moves at about 300,000 km a second.'])
      const record = await scanFile(root, join(root, 'course-cards', name))
      expect(record.cards).toHaveLength(1)
      // The host's title rule: the first sentence of the front, without its full stop.
      expect(record.cards?.[0]).toMatchObject({ title: 'Light from the Sun takes about eight minutes to reach Earth' })
      // YAZ-5203: "The app saves it with the card." The answer is the card's first review, as the Inbox writes it.
      const reviews = cardReviewsOf(shape.cards[0].line)
      expect(reviews).toHaveLength(1)
      expect(reviews[0]).toMatchObject({ rating: 'good', at: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\dZ$/) })
      expect(cardState(reviews, DEFAULT_REVIEW_SETTINGS).isNew).toBe(false)
      await act(() => Promise.resolve())
      expect(scene.el.querySelector('.card-inbox__last')?.textContent).toBe('Remembered · saved with the card')
    } finally {
      scene.unmount()
    }
  })

  it('YAZ-5203: the first answer is a real first review, through the app`s own answer (Forgot: again; Remembered: good, back in the days the Inbox would say)', async () => {
    const host = vaultCourseHost(vaultOf().view, depsOf().deps)
    const forgot = (await host.makeFirstCard({ ...input, answer: 'forgot' })) as MadeCard
    const line = (path: string) => findCards(splitFrontmatter(readFileSync(path, 'utf8')).body)[0].line
    expect(cardReviewsOf(line(forgot.path)).map((r) => r.rating)).toEqual(['again'])
    const now = Date.now()
    const remembered = (await host.makeFirstCard({ ...input, answer: 'remembered' })) as MadeCard
    const reviews = cardReviewsOf(line(remembered.path))
    expect(reviews.map((r) => r.rating)).toEqual(['good'])
    const inbox = previewAnswers([], DEFAULT_REVIEW_SETTINGS, now).find((a) => a.review.rating === 'good')!
    expect(cardState(reviews, DEFAULT_REVIEW_SETTINGS).due).toBe(inbox.due)
    // No answer (a test, or another caller): a new card, as before.
    const none = (await host.makeFirstCard(input)) as MadeCard
    expect(cardReviewsOf(line(none.path))).toEqual([])
  })

  it('YAZ-5203: a vault that refuses writes saves nothing, and the scene does not say the answer was saved', async () => {
    ;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    const ch = COURSE.find((c) => c.id === 'first-card')!
    const clip = (id: string) => ch.clips.find((c) => c.id === id)!
    const host = vaultCourseHost(vaultOf({ readOnly: true }).view, depsOf().deps)
    const { clock } = testClock(4)
    const scene = mountScene(courseScenes('c2-11'), ch, { clock, done: () => undefined, host, waits: (c) => WAITING_CLIPS.has(c.id) })
    try {
      scene.render(clip('c2-11'))
      act(() => [...scene.el.querySelectorAll<HTMLElement>('.card-inbox__answer')].find((b) => b.textContent?.includes('Remembered'))!.click())
      scene.render(clip('c2-13'))
      await vi.waitFor(() => expect(scene.el.querySelector('.kit-showonly')?.textContent).toBe(SHOW_ONLY.readOnly))
      scene.render(clip('c2-12'))
      expect(scene.el.querySelector('.card-inbox__last')?.textContent).toBe('Remembered')
      expect(await top()).toEqual([])
    } finally {
      scene.unmount()
    }
  })

  it('a repeat makes a second file, never over the first; no back makes a card of one side', async () => {
    const { deps, made } = depsOf()
    const host = vaultCourseHost(vaultOf().view, deps)
    const a = (await host.makeFirstCard(input)) as MadeCard
    const b = (await host.makeFirstCard({ ...input, back: '' })) as MadeCard
    expect(a.path).not.toBe(b.path)
    expect(await cardFilesIn(join(root, 'course-cards'))).toHaveLength(2)
    expect(cardSides(findCards(splitFrontmatter(await readFile(b.path, 'utf8')).body)[0].text)).toHaveLength(1)
    expect(made()[0].cards).toEqual([a.path, b.path])
  })

  it('takes the title from the first sentence, cut at a word; the hidden word by its place, or as a whole word', () => {
    expect(titleFromFront('Short one.')).toBe('Short one')
    expect(titleFromFront('A very long sentence about the way a bread dough rises in a warm kitchen on a slow day.')).toBe('A very long sentence about the way a bread dough rises in a…')
    expect(firstCard({ front: 'The pan is hot. Heat the pan first.', hidden: { start: 21, end: 24 }, back: '' }).text).toBe('The pan is hot. Heat {{the}} pan first.')
    const card = firstCard({ front: 'Carbs give quick energy; carbsplus is not a word.', hidden: 'energy', back: '' })
    expect(card).toEqual({ title: 'Carbs give quick energy; carbsplus is not a word', text: 'Carbs give quick {{energy}}; carbsplus is not a word.', titleHidden: true })
    expect(firstCard({ front: 'Sleep helps memory. It sorts the day.', hidden: 'sorts', back: '' }).titleHidden).toBe(false)
    expect(() => firstCard({ front: 'Sleep helps memory.', hidden: 'food', back: '' })).toThrow()
  })
})

describe('the Course page (chapter 4)', () => {
  it('is made once in Course Cards, with its one line, and found again after', async () => {
    const vault = vaultOf()
    const { deps, made } = depsOf()
    const host = vaultCourseHost(vault.view, deps)
    const page = await host.coursePage()
    expect('path' in page && page.path.startsWith(`${root}/course-cards/course-page-`)).toBe(true)
    const path = (page as { path: string }).path
    const content = await readFile(path, 'utf8')
    expect(parseFrontmatter(splitFrontmatter(content).frontmatter).properties).toMatchObject({ title: COURSE_PAGE })
    expect(splitFrontmatter(content).body).toBe(`${COURSE_PAGE_LINE}\n`)
    await vault.refresh()
    expect(await host.coursePage()).toEqual(page)
    expect(made()[0].page).toBe(path)
    // A new host with the same record finds it again.
    expect(await vaultCourseHost(vault.view, deps).coursePage()).toEqual(page)
    expect((await cardFilesIn(join(root, 'course-cards'))).length).toBe(1)
    // YAZ-5202: with no record (another Mac's course made the folder), "Course Cards" is not this Mac's: the course
    // makes "Course Cards 2" and its own Course page there, and leaves the other folder as it is.
    const fresh = await vaultCourseHost(vault.view, depsOf().deps).coursePage()
    expect('path' in fresh && fresh.path.startsWith(`${root}/course-cards-2/course-page-`)).toBe(true)
    expect((await cardFilesIn(join(root, 'course-cards'))).length).toBe(1)
  })
})

describe('the prompt (chapter 8)', () => {
  it('names the app copy of the skill, the full path of Course Cards, and has no check line', async () => {
    const { deps } = depsOf()
    const host = vaultCourseHost(vaultOf().view, deps)
    host.agentStep.useExample()
    await host.agentStep.preparePrompt()
    const prompt = host.agentStep.state().prompt as { text: string; folder: string }
    expect(prompt.folder).toBe(`${root}/course-cards`)
    expect(prompt.text).toBe(`${AGENT_PROMPT.replace('{path}', APP_SKILL)} Then make 3 cards from the text below, as card files in "${root}/course-cards".\n\n${EXAMPLE_TEXT}\n`)
    expect(prompt.text.toLowerCase()).not.toContain('check')
  })

  it("names the vault's own Card skill when it has one", async () => {
    await writeFile(join(root, 'Card skill.md'), '') // a page named so is no folder
    const vault = vaultOf()
    await createDir({ path: join(root, 'Card skill') }, null)
    await writeFile(join(root, 'Card skill', 'Start here.md'), '# Start here\n')
    await vault.refresh()
    const host = vaultCourseHost(vault.view, depsOf().deps)
    host.agentStep.setText('My own pages on sleep.')
    await host.agentStep.preparePrompt()
    expect((host.agentStep.state().prompt as { text: string }).text.startsWith(AGENT_PROMPT.replace('{path}', `${root}/Card skill`))).toBe(true)
    expect(agentPrompt(null, '/v/course-cards', 'x')).toContain('yaseendocs card guide')
  })

  it('asks for text first', async () => {
    const host = vaultCourseHost(vaultOf().view, depsOf().deps)
    await host.agentStep.copy()
    expect(host.agentStep.state().prompt).toBeNull()
    expect(host.agentStep.state().problem).not.toBeNull()
  })
})

describe('the AI step watches Course Cards', () => {
  it('lists new card files only from Course Cards, only after Copy, as they come; Read ticks; the step is done when each is read', async () => {
    const vault = vaultOf()
    const { deps, copied } = depsOf()
    const host: CourseHost = vaultCourseHost(vault.view, deps)
    const step = host.agentStep
    // A card from before Copy (chapter 2's), and the folder.
    const old = (await host.makeFirstCard({ front: 'Fat keeps you full.', hidden: 'Fat', back: '' })) as MadeCard
    const folder = join(root, 'course-cards')
    await mkdirP(join(root, 'elsewhere'))
    await agentWrites(folder, 'early.md', 'Early', 'Written before {{Copy}}')
    await vault.refresh()

    step.useExample()
    await step.copy()
    expect(copied).toHaveLength(1)
    expect(step.state().copiedAt).not.toBeNull()
    expect(step.state().cards).toEqual([])

    await agentWrites(join(root, 'elsewhere'), 'outside.md', 'Outside', 'Not in {{Course Cards}}')
    await agentWrites(folder, 'how-bread-rises.md', 'How bread rises', 'Bread rises because {{yeast}} eats sugar.\n---\nThe gas is trapped by gluten.')
    await vault.refresh()
    expect(step.state().cards.map((c) => c.title)).toEqual(['How bread rises'])
    await agentWrites(folder, 'poke-test.md', 'The poke test', 'Ready when the dent springs back {{slowly}}.')
    await vault.refresh()
    expect(step.state().cards.map((c) => c.title)).toEqual(['How bread rises', 'The poke test'])
    expect(step.state().cards.some((c) => c.path === old.path)).toBe(false)

    // Read: each opens here; opened, it is ticked.
    const [a, b] = step.state().cards
    expect(await host.readCard(a)).toEqual({ title: 'How bread rises', sides: ['Bread rises because {{yeast}} eats sugar.', 'The gas is trapped by gluten.'] })
    step.markRead(a)
    expect(step.state().read).toEqual([`${a.path}#0`])
    step.markRead(a)
    step.markRead(b)
    expect(step.state().read).toHaveLength(2)
    host.agentStep.stop()
  })

  it('shows NO_CARDS_YET after 60 seconds with no new card, keeps waiting, and drops it when a card comes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const vault = vaultOf()
    const host = vaultCourseHost(vault.view, depsOf().deps)
    const step = host.agentStep
    step.useExample()
    await step.copy()
    vi.advanceTimersByTime(NO_CARDS_YET_MS - 1)
    expect(step.state().quiet).toBe(false)
    vi.advanceTimersByTime(1)
    expect(step.state().quiet).toBe(true)
    expect(NO_CARDS_YET).toBe('No new cards yet. Did you check with your agent?')
    await agentWrites(join(root, 'course-cards'), 'late.md', 'Late', 'A {{late}} card')
    await vault.refresh()
    expect(step.state().quiet).toBe(false)
    expect(step.state().cards).toHaveLength(1)
    step.stop()
  })

  it('a course opened again at this step watches again, with the same text and cards', async () => {
    const vault = vaultOf()
    const first = vaultCourseHost(vault.view, depsOf().deps)
    first.agentStep.setText('Pages on sleep.')
    await first.agentStep.copy()
    first.agentStep.stop()
    const again = vaultCourseHost(vault.view, depsOf().deps)
    expect(again.agentStep.state().text).toBe('Pages on sleep.')
    await agentWrites(join(root, 'course-cards'), 'sleep.md', 'Sleep', 'Sleep {{sorts}} the day.')
    await vault.refresh()
    expect(again.agentStep.state().cards.map((c) => c.title)).toEqual(['Sleep'])
    again.agentStep.stop()
  })
})

describe('"No agent? Skip"', () => {
  it('shows three example cards and writes nothing until the person says so; then exactly three valid card files, once', async () => {
    const vault = vaultOf()
    const { deps, made } = depsOf()
    const host = vaultCourseHost(vault.view, deps)
    host.agentStep.showExamples()
    expect(host.agentStep.state().examples).toBe('shown')
    expect(await top()).toEqual([])
    await host.agentStep.makeExamples()
    await host.agentStep.makeExamples()
    const files = await cardFilesIn(join(root, 'course-cards'))
    expect(files).toHaveLength(3)
    for (const name of files) {
      const content = await readFile(join(root, 'course-cards', name), 'utf8')
      expect(isCardFileContent(content)).toBe(true)
      const shape = cardFileShape(splitFrontmatter(content).body)
      expect(shape.problem).toBe('ok')
      const sides = cardSides(shape.cards[0].text)
      expect(sides).toHaveLength(2)
      expect(cardPieces(sides[0]).some((p) => p.kind === 'hidden')).toBe(true)
      expect(sides[1]).toContain('***')
    }
    expect(EXAMPLE_CARDS.map((c) => c.title)).toEqual(['How bread rises', 'A slow rise for flavour', 'The poke test for dough'])
    expect(made()[0].cards).toHaveLength(3)
  })
})

describe('the end screen', () => {
  it('counts the cards in Course Cards and gives when each comes back, from the real schedule', async () => {
    const vault = vaultOf()
    const host = vaultCourseHost(vault.view, depsOf().deps)
    expect(host.summary()).toEqual({ folder: null, cards: [] })
    const folder = (await host.courseCards()) as { path: string }
    const review = { at: '2026-11-01T10:00Z', rating: 'good' as const }
    const line = withCardReview(withCardReview(withCardId(EMPTY_CARD_LINE, 'TST-90'), review), { at: '2026-11-01T10:05Z', rating: 'good' })
    await writeFile(join(folder.path, 'reviewed-tst-90.md'), cardFileContent('Reviewed', 'A {{reviewed}} card', line))
    await writeFile(join(folder.path, 'new-tst-91.md'), cardFileContent('New', 'A {{new}} card', withCardId(EMPTY_CARD_LINE, 'TST-91')))
    await writeFile(join(root, 'other-tst-92.md'), cardFileContent('Other', 'Not a {{course}} card', withCardId(EMPTY_CARD_LINE, 'TST-92')))
    await vault.refresh()
    const due = cardState([review, { at: '2026-11-01T10:05Z', rating: 'good' }], DEFAULT_REVIEW_SETTINGS).due
    expect(due).toBeGreaterThan(Date.parse('2026-11-01T10:05Z'))
    expect(host.summary()).toEqual({
      folder: folder.path,
      cards: [
        { path: join(folder.path, 'new-tst-91.md'), title: 'New', due: null },
        { path: join(folder.path, 'reviewed-tst-90.md'), title: 'Reviewed', due },
      ],
    })
  })
})

describe('the seam', () => {
  it('the test double and the frame host have every member of the real host, and of its AI step', () => {
    const real = vaultCourseHost(vaultOf().view, depsOf().deps)
    const keys = (o: object): string[] => [...new Set([...Object.keys(o), ...Object.getOwnPropertyNames(Object.getPrototypeOf(o))])].filter((k) => k !== 'constructor').sort()
    const members = (h: CourseHost): string[] => ['vault', 'courseCards', 'watchCards', 'makeFirstCard', 'coursePage', 'readCard', 'agentStep', 'summary'].filter((k) => k in h)
    for (const host of [memoryHost(), showOnlyHost('/v')]) {
      expect(members(host)).toEqual(members(real))
      expect(keys(host.agentStep)).toEqual(keys(real.agentStep))
      expect(Object.keys(host.agentStep.state()).sort()).toEqual(Object.keys(real.agentStep.state()).sort())
    }
    expect(members(real)).toHaveLength(8)
  })
})

async function mkdirP(path: string): Promise<void> {
  await createDir({ path }, null).catch(() => undefined)
}

describe('chapter 4\'s tour and its Course page (YAZ-5123 with YAZ-5124)', () => {
  it('the tour of chapter 4 asks the real host for Course page: the page is made once, and the tour marks that file', async () => {
    const vault = vaultOf()
    const host = vaultCourseHost(vault.view, depsOf().deps)
    await host.makeFirstCard({ front: 'Water boils at 100 degrees at sea level.', hidden: '100', back: '' })
    await vault.refresh()
    const checked = await checkTour('where', host)
    if (!('places' in checked)) throw new Error(`blocked: ${checked.blocked}`)
    expect(checked.places.folder).toBe(`${root}/course-cards`)
    const page = checked.places.page!
    expect(splitFrontmatter(await readFile(page, 'utf8')).body).toBe(`${COURSE_PAGE_LINE}\n`)
    await vault.refresh()
    expect(await checkTour('where', host)).toEqual(checked)
    expect((await cardFilesIn(join(root, 'course-cards'))).filter((name) => !name.includes('water'))).toEqual([page.slice(page.lastIndexOf('/') + 1)])
  })

  it('YAZ-5202: with the person\'s own "Course Cards", the tour marks the course\'s "Course Cards 2", and its help lines name it', async () => {
    await createDir({ path: join(root, 'mine'), title: 'Course Cards' }, door)
    const vault = vaultOf()
    await vault.refresh()
    const host = vaultCourseHost(vault.view, depsOf().deps)
    const empty = await checkTour('inbox', host)
    expect(empty).toEqual({ blocked: 'There is no card in Course Cards 2 yet. Chapter 2 shows how to make one.' })
    const checked = await checkTour('first-card', host)
    expect(checked).toEqual({ places: { folder: `${root}/course-cards-2`, page: `${root}/course-cards-2/Course page.md` }, folderTitle: 'Course Cards 2' })
    expect(inFolder(TARGET_HELP['new-card'].where, 'Course Cards 2')).toBe('Right-click the Course Cards 2 folder first. New card is in its menu.')
    expect(inFolder(TARGET_HELP['card-menu'].where, 'Course Cards 2')).toBe('Open a card in Course Cards 2. Its menu is the three dots in its head.')
    expect(inFolder(TARGET_HELP['new-card'].where, 'Course Cards')).toBe(TARGET_HELP['new-card'].where)
  })

  it('another chapter\'s tour makes no Course page; a read-only vault gives the tour its "cannot here" line and makes nothing', async () => {
    const vault = vaultOf()
    const host = vaultCourseHost(vault.view, depsOf().deps)
    expect('places' in (await checkTour('first-card', host))).toBe(true)
    expect(await cardFilesIn(join(root, 'course-cards'))).toEqual([])
    await rm(join(root, 'course-cards'), { recursive: true })
    const locked = vaultCourseHost(vaultOf({ readOnly: true }).view, depsOf().deps)
    expect(await checkTour('where', locked)).toEqual({ blocked: SHOW_ONLY.readOnly })
    expect(await top()).toEqual([])
  })
})
