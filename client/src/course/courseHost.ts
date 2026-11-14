/**
 * THE COURSE'S SIDE EFFECTS (YAZ-5120, for issue 6F, YAZ-5124): what the course does in the person's vault. The
 * frame passes one `CourseHost` to each scene. Issue 6F builds the real one (the "Course Cards" folder, the card
 * files, the AI step's watch); this frame ships `showOnlyHost`, which makes nothing and says why.
 *
 * - `vault`: the window's active vault, or null with none open.
 * - `courseCards()`: the folder "Course Cards" at the top of the vault, made when missing ("Course Cards 2" when one
 *   exists that this Mac did not make). `{ showOnly }` when the course must only show: no vault, a read-only vault,
 *   IDs off, Review off, or (here) the step not built yet. The reason is one line for the person.
 * - `watchCards(folder, onCards)`: the card files in the folder, at once and on each change (the AI step). Returns the
 *   way to stop.
 */
export type CourseCardsFolder = { path: string } | { showOnly: string }

export interface CourseCard {
  path: string
  title: string
}

export interface CourseHost {
  vault: string | null
  courseCards(): Promise<CourseCardsFolder>
  watchCards(folder: string, onCards: (cards: readonly CourseCard[]) => void): () => void
}

/** The line a scene shows while the course's real files come in the next build. */
export const SHOW_ONLY_NOT_YET = 'In this build the course only shows. It makes no files yet.'

/** The frame's host: it makes nothing. */
export function showOnlyHost(vault: string | null): CourseHost {
  return {
    vault,
    courseCards: () => Promise.resolve({ showOnly: vault === null ? 'Open a vault to make real cards.' : SHOW_ONLY_NOT_YET }),
    watchCards: (_folder, onCards) => {
      onCards([])
      return () => undefined
    },
  }
}
