import { useEffect, useState } from 'react'
import type { Answers, AnswersState } from '../answers/answers'
import type { WaitingAnswer } from '../answers/outbox'
import type { ShellSync } from '../app/syncPort'

/** What the dot reads from 3C's answer list, and what its sheet does: Discard a lost answer, "Try now" (`sendNow`). */
export type DotAnswers = Pick<Answers, 'state' | 'subscribe' | 'waiting' | 'discard' | 'sendNow'>

/**
 * 4B (YAZ-5078) makes the ONE answer list of the open vault with the engine (`lazySync`) and gives it through
 * `ShellSync.review()`. The dot reads that same list. It never makes a second one: two lists would send twice.
 * Until 4B's `review()` is there (a fake sync, or before the merge), the engine alone drives the dot.
 */
type WithReview = { review?: () => Promise<{ answers: DotAnswers } | null> }

export interface DotAnswersView {
  list: DotAnswers | null
  /** The list's state once it has read its stored answers for the open vault; null before (YAZ-5297). */
  state: AnswersState | null
  waiting: readonly WaitingAnswer[]
  /** The app has no answer list at all (a sync with no `review()`): the engine alone drives the dot. */
  noList: boolean
}

const nothing = (noList: boolean): DotAnswersView => ({ list: null, state: null, waiting: [], noList })

/**
 * The open vault's answer list. YAZ-5297: at a cold start `review()` gives null while the engine chunk loads (lazySync
 * reads the checkpoint first), and the list reads its stored answers after that. So the hook asks again at each state
 * of the sync until it has the list, and gives the list's state only when it is the open vault's (`state.vault`).
 */
export function useDotAnswers(sync: ShellSync, vault: string | null): DotAnswersView {
  const review = (sync as ShellSync & WithReview).review
  const [view, setView] = useState<DotAnswersView>(() => nothing(review === undefined))
  useEffect(() => {
    let live = true
    let stop = () => {}
    let asking = false
    if (vault === null || review === undefined) {
      setView(nothing(review === undefined))
      return
    }
    setView(nothing(false))
    let list: DotAnswers | null = null
    const read = () => {
      if (!live || list === null) return
      const state = list.state()
      const own = state.vault === vault
      setView({ list, state: own ? state : null, waiting: own ? list.waiting() : [], noList: false })
    }
    const ask = () => {
      if (list !== null || asking) return
      asking = true
      void review
        .call(sync)
        .then((link) => {
          asking = false
          if (!live || link === null || list !== null) return
          list = link.answers
          stop = list.subscribe((event) => {
            if (event.type === 'state') read()
          })
          read()
        })
        .catch(() => {
          asking = false
        })
    }
    const unfollow = sync.subscribe((event) => {
      if (event.type === 'state') ask()
    })
    ask()
    return () => {
      live = false
      unfollow()
      stop()
    }
  }, [sync, vault, review])
  return view
}
