import { useEffect, useState } from 'react'
import type { Answers, AnswersState } from '../answers/answers'
import type { WaitingAnswer } from '../answers/outbox'
import type { ShellSync } from '../app/syncPort'

/** What the dot reads from 3C's answer list, and the one thing it does: Discard a lost answer. */
export type DotAnswers = Pick<Answers, 'state' | 'subscribe' | 'waiting' | 'discard'>

/**
 * 4B (YAZ-5078) makes the ONE answer list of the open vault with the engine (`lazySync`) and gives it through
 * `ShellSync.review()`. The dot reads that same list. It never makes a second one: two lists would send twice.
 * Until 4B's `review()` is there (a fake sync, or before the merge), the engine alone drives the dot.
 */
type WithReview = { review?: () => Promise<{ answers: DotAnswers } | null> }

export interface DotAnswersView {
  list: DotAnswers | null
  state: AnswersState | null
  waiting: readonly WaitingAnswer[]
}

const NOTHING: DotAnswersView = { list: null, state: null, waiting: [] }

/** The open vault's answer list, read again when the open vault changes. */
export function useDotAnswers(sync: ShellSync, vault: string | null): DotAnswersView {
  const [view, setView] = useState<DotAnswersView>(NOTHING)
  useEffect(() => {
    let live = true
    let stop = () => {}
    const review = (sync as ShellSync & WithReview).review
    if (vault === null || review === undefined) {
      setView(NOTHING)
      return
    }
    void review
      .call(sync)
      .then((link) => {
        if (!live || link === null) return
        const list = link.answers
        const read = () => setView({ list, state: list.state(), waiting: list.waiting() })
        stop = list.subscribe((event) => {
          if (event.type === 'state') read()
        })
        read()
      })
      .catch(() => undefined)
    return () => {
      live = false
      stop()
    }
  }, [sync, vault])
  return view
}
