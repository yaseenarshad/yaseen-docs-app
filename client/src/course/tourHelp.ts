/**
 * WHERE EACH TOUR TARGET IS (YAZ-5123): what the coach card says while a step's target is not on screen, where "Show
 * me" takes the person (the app's own navigation, `showTourPlace`), and what each chapter's tour needs before it can
 * start. The step's own line (`say`) is the script's and stays as it is; these lines are only the help under it.
 */
import type { CourseCard, CourseHost } from './courseHost'
import { COURSE_CARDS } from './courseCards'
import type { TourPlace, TourPlaces } from './tourBus'

interface TourContext {
  places: TourPlaces
  lastCard: string | null
}

interface TargetHelp {
  /** One line: where the control is, or what to do first. */
  where: string
  /** Where "Show me" goes; none when the step before brings the target. */
  show?: (c: TourContext) => TourPlace | null
  /** A screen that shows when the target cannot come (the folder review has no card today), and what to say then. */
  stuck?: { selector: string; say: string }
}

const folder = (c: TourContext): TourPlace | null => (c.places.folder === null ? null : { kind: 'folder', path: c.places.folder })
const card = (c: TourContext): TourPlace | null => (c.lastCard === null ? folder(c) : { kind: 'file', path: c.lastCard })
const reviewFolder = (c: TourContext): TourPlace | null => (c.places.folder === null ? null : { kind: 'review-folder', path: c.places.folder })
const NO_CARD_TODAY = {
  selector: '.card-inbox__done',
  say: 'The review has no card for you today: the Inbox brings only so many new cards a day. Skip this step, or go back to the course.',
}
const MENU_FIRST = "Open the card's menu first: the three dots in its head."

/** Every target the script names (`script.ts`, `tryIt`), with its help. A test checks that the two lists match. */
export const TARGET_HELP: Record<string, TargetHelp> = {
  'sidebar-course-cards': { where: 'Course Cards is a folder in the sidebar, under your vault.', show: folder },
  'new-card': { where: 'Right-click the Course Cards folder first. New card is in its menu.', show: folder },
  'new-card-name': { where: 'Choose New card first. A name box opens in the folder.' },
  'card-editor': { where: 'Open your card, and click Edit card.', show: card },
  'card-done': { where: 'Click Edit card first. Done is at the top of the card while you edit.', show: card },
  'review-folder': { where: 'Right-click the Course Cards folder first. Review this folder is in its menu.', show: folder },
  'inbox-card': { where: 'Right-click the Course Cards folder, and choose Review this folder.', show: reviewFolder, stuck: NO_CARD_TODAY },
  'inbox-answers': { where: 'The answers are under the card, in the Inbox.', show: reviewFolder, stuck: NO_CARD_TODAY },
  'sidebar-inbox': { where: 'Inbox is at the top of the sidebar.', show: () => ({ kind: 'sidebar' }) },
  'card-menu': { where: 'Open a card in Course Cards. Its menu is the three dots in its head.', show: card },
  'card-copy-link': { where: MENU_FIRST, show: card },
  'card-menu-archive': { where: MENU_FIRST, show: card },
  'card-menu-up-next': { where: MENU_FIRST, show: card },
  'course-page': { where: 'Course page is in the Course Cards folder, in the sidebar.', show: folder },
  'page-editor': { where: 'Open Course page first.', show: (c) => (c.places.page === null ? null : { kind: 'file', path: c.places.page }) },
  'card-edit': { where: 'Open a card in Course Cards first.', show: card },
  'link-picker': { where: 'Type two square brackets in the card first.' },
  'card-link-pill': { where: 'Save the card first: press Escape, or click Done.' },
  'inbox-filter': { where: 'Open the Inbox first.', show: (c) => (c.places.folder === null ? { kind: 'sidebar' } : { kind: 'inbox', path: c.places.folder }) },
  'inbox-unarchive': { where: 'In the All cards menu, choose Archived.' },
  'card-skill-row': { where: 'The card skill is at the bottom of the sidebar. If it is not there, turn it on in Settings, under Cards.', show: () => ({ kind: 'sidebar' }) },
  'settings-review': { where: 'Press Command comma to open Settings.', show: () => ({ kind: 'settings' }) },
  'settings-card-skill': { where: 'Open Settings, and click Cards.', show: () => ({ kind: 'settings', page: 'cards' }) },
  'settings-course': { where: 'Open Settings, and click Cards.', show: () => ({ kind: 'settings', page: 'cards' }) },
}

/** What a chapter's tour needs first: the Course Cards folder, this many cards in it, and its "Course page" (chapter 4). */
interface TourNeeds {
  folder: boolean
  cards: number
  page?: boolean
}
const TOUR_NEEDS: Record<string, TourNeeds> = {
  'first-card': { folder: true, cards: 0 },
  inbox: { folder: true, cards: 1 },
  where: { folder: true, cards: 1, page: true },
  links: { folder: true, cards: 2 },
  care: { folder: true, cards: 1 },
}
const needsOf = (chapterId: string): TourNeeds => TOUR_NEEDS[chapterId] ?? { folder: false, cards: 0 }

/** The name of the page that chapter 4's tour opens, in the Course Cards folder (the host's own file wins: `coursePage()`). */
export const COURSE_PAGE = 'Course page.md'

const noCardsLine = (need: number, folderTitle = COURSE_CARDS): string =>
  need <= 1 ? `There is no card in ${folderTitle} yet. Chapter 2 shows how to make one.` : `This tour needs ${need} cards in ${folderTitle}. Chapter 2 shows how to make one.`

/**
 * A help line with the real title of the course's folder (YAZ-5202): "Course Cards 2" when the person has a "Course
 * Cards" of their own. The script's own words (`say`) are not changed: only these help lines.
 */
export const inFolder = (line: string, folderTitle: string): string => (folderTitle === COURSE_CARDS ? line : line.replaceAll(COURSE_CARDS, folderTitle))

/** How long the check waits for the folder's cards before it starts anyway. */
const CARDS_WAIT_MS = 3000

/**
 * The check before a tour: its places, or the one line that says why it cannot run. It uses the course's host (6F):
 * `courseCards()` gives the folder (or why the course only shows), `watchCards()` its cards.
 */
export async function checkTour(chapterId: string, host: CourseHost): Promise<{ places: TourPlaces; folderTitle?: string } | { blocked: string }> {
  const needs = needsOf(chapterId)
  if (!needs.folder) return { places: { folder: null, page: null } }
  const found = await host.courseCards()
  if ('showOnly' in found) return { blocked: found.showOnly }
  const folderTitle = found.title ?? COURSE_CARDS
  let places: TourPlaces = { folder: found.path, page: `${found.path}/${COURSE_PAGE}` }
  // Chapter 4 opens "Course page": the host makes it once (YAZ-5124), and its file is the one the tour marks.
  if (needs.page === true) {
    const page = await host.coursePage()
    if ('showOnly' in page) return { blocked: page.showOnly }
    places = { ...places, page: page.path }
  }
  if (needs.cards === 0) return { places, folderTitle }
  const cards = await new Promise<readonly CourseCard[] | null>((resolve) => {
    let stop: (() => void) | null = null
    let settled = false
    const timer = setTimeout(() => finish(null), CARDS_WAIT_MS)
    function finish(list: readonly CourseCard[] | null): void {
      if (settled) return
      settled = true
      clearTimeout(timer)
      queueMicrotask(() => stop?.())
      resolve(list)
    }
    // A host that answers at once calls `finish` before `stop` is set: the microtask stops it after.
    stop = host.watchCards(found.path, (list) => finish(list))
  })
  if (cards !== null && cards.length < needs.cards) return { blocked: noCardsLine(needs.cards, folderTitle) }
  return { places, folderTitle }
}
