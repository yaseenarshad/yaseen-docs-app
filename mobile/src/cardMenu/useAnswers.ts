import { useEffect, useState } from 'react'
import { useApp } from '../app/AppState'
import type { Answers } from '../answers/answers'
import type { VaultStore } from '../store'

/**
 * The reader's way to the ONE answer list of the open vault (YAZ-5504), once the engine has loaded (`sync.review()`,
 * as the comments ask for it). Null before, or with a sync that has none (a fake): the card menu's rows then wait.
 */
export function useAnswers(): Answers | null {
  const { sync } = useApp().services
  const [answers, setAnswers] = useState<Answers | null>(null)
  useEffect(() => {
    let live = true
    let found = false
    const ask = () => {
      if (found || sync.review === undefined) return
      void sync
        .review()
        .then((link) => {
          const a = link?.answers
          // A fake link of another screen's test may lack the list's reads: no list.
          if (!live || a === undefined || typeof a.text !== 'function' || typeof a.subscribe !== 'function') return
          found = true
          setAnswers(a)
        })
        .catch(() => {})
    }
    ask()
    const off = sync.subscribe((event) => {
      if (event.type === 'state') ask()
    })
    return () => {
      live = false
      off()
    }
  }, [sync])
  return answers
}

/** Calls `bump` when the phone's view of `path` changes: an action was added or undone (the card menu, Review). */
export function useAnswersChanged(answers: Answers | null, path: string, bump: () => void): void {
  useEffect(() => {
    if (answers === null) return
    return answers.subscribe((event) => {
      if (event.type === 'changed' && event.paths.includes(path)) bump()
    })
    // `bump` is a state setter's step: a new function each draw names the same step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers, path])
}

/**
 * The text of `path` as the phone shows it: the stored copy WITH the waiting actions (`answers.text`), so a change from
 * the card menu (Archive, Title on the front, …) shows at once, before it is sent. With no list (or a file that is not
 * text there), the stored copy.
 */
export async function shownText(store: VaultStore, vault: string, path: string, answers: Answers | null): Promise<string | null> {
  if (answers !== null) {
    const shown = await answers.text(path).catch(() => null)
    if (shown !== null) return shown
  }
  const file = await store.read(vault, path)
  return file === null ? null : typeof file.content === 'string' ? file.content : new TextDecoder().decode(file.content)
}
