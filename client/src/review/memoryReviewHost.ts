/**
 * An in-memory `ReviewHost` (YAZ-5067), for tests: the review hook with no disk, no app state and no bridge. The files
 * are a map of path to text; each write is ONE pure change of the text (`changeCard`), by card ID, as the desktop's
 * `transformFile` does; a missing file or card throws `CardNotFoundError`, which the hook reads as "gone"
 * (`isCardGone`). The card read is the desktop's own pure read (`cardOnPageIn`), so a CARD FILE's card comes with its
 * `title` (YAZ-5044) as on the Mac. The day numbers (Up next places taken, added numbers) are this host's own, one
 * set per vault, as the phone keeps its own (decision 9): never the app state.
 */
import { CardNotFoundError, cardNextIndex, cardReviewIndex, changeCard, withCardNext, withCardReview, withCardReviewAt, withoutCardReview, type CardLine } from '@shared/cardLine'
import { NOTHING_ADDED, type CardsAddedToday } from '@shared/cardSchedule'
import { cardOnPageIn } from './cardRead'
import type { ReviewHost } from './reviewHost'

export interface MemoryReviewHost extends ReviewHost {
  /** The vault: path to text. Tests read and set it directly. */
  readonly files: Map<string, string>
  /** How many writes changed a file. */
  readonly writes: () => number
}

const NONE: readonly string[] = Object.freeze([])

export function memoryReviewHost(files: Map<string, string>, vault = 'Memory vault'): MemoryReviewHost {
  let writes = 0
  const taken = new Map<string, readonly string[]>()
  const added = new Map<string, CardsAddedToday>()
  const listeners = new Set<() => void>()
  const wake = () => listeners.forEach((l) => l())
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => void listeners.delete(listener)
  }
  /** Card `id`'s line in `path` changed by `change`: one write. */
  const change = (path: string, id: string, edit: (line: CardLine) => CardLine, index?: number): Promise<void> => {
    const content = files.get(path)
    if (content === undefined) return Promise.reject(new CardNotFoundError(id))
    try {
      files.set(path, changeCard(content, id, edit, index))
    } catch (err) {
      return Promise.reject(err)
    }
    writes++
    return Promise.resolve()
  }
  return {
    files,
    writes: () => writes,
    readCard: async (path, id) => {
      const content = files.get(path)
      return content === undefined ? null : cardOnPageIn(path, content, id)
    },
    writeCardAnswer: async (path, id, review) => {
      let next = -1
      await change(path, id, (l) => {
        next = cardNextIndex(l)
        return withCardReview(withCardNext(l, false), review)
      })
      return next
    },
    undoCardAnswer: (path, id, at, next) =>
      change(path, id, (l) => {
        const without = withoutCardReview(l, at)
        return next < 0 ? without : withCardNext(without, true, next)
      }),
    deleteCardReview: async (path, id, at) => {
      let removed = -1
      await change(path, id, (l) => {
        removed = cardReviewIndex(l, at)
        return withoutCardReview(l, at)
      })
      return removed
    },
    restoreCardReview: (path, id, review, index) => (index < 0 ? Promise.resolve() : change(path, id, (l) => withCardReviewAt(l, review, index))),
    changeCardLine: (path, id, edit) => change(path, id, edit),
    upNextTakenToday: (root) => taken.get(root) ?? NONE,
    setUpNextTaken: (root, id, on) => {
      const cards = new Set(taken.get(root) ?? NONE)
      if (cards.has(id) === on) return
      if (on) cards.add(id)
      else cards.delete(id)
      taken.set(root, [...cards])
      wake()
    },
    subscribeUpNextTaken: subscribe,
    cardsAddedToday: (root) => added.get(root) ?? NOTHING_ADDED,
    setCardsAdded: (root, next) => {
      const now = added.get(root) ?? NOTHING_ADDED
      if (now.newCards === next.newCards && now.upNext === next.upNext) return
      added.set(root, { newCards: Math.max(0, next.newCards), upNext: Math.max(0, next.upNext) })
      wake()
    },
    subscribeCardsAdded: subscribe,
    vaultName: () => vault,
  }
}
