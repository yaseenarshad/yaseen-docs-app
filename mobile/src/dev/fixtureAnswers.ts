import type { Answers, AnswersEvent } from '../answers/answers'
import { applyOps } from '../answers/ops'
import type { WaitingAnswer } from '../answers/outbox'
import type { VaultStore } from '../store'

/**
 * A made-up answer list for the screen fixtures of the card menu (YAZ-5504: `card-menu`, `page-card-menu`): in memory,
 * on the fixture's store; nothing is sent (the fixtures never call GitHub). Only what the reader's card menu uses.
 */
export function fixtureAnswers(store: VaultStore, vault: string): Answers {
  const waiting: WaitingAnswer[] = []
  const listeners = new Set<(event: AnswersEvent) => void>()
  let seq = 0
  const changed = (paths: string[]) => listeners.forEach((l) => l({ type: 'changed', vault, paths }))
  const answers: Partial<Answers> = {
    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    waiting: () => waiting,
    async add(entries) {
      const group = ++seq
      for (const e of entries) waiting.push({ seq: ++seq, group, op: e.op, path: e.path, title: e.title, madeAt: Date.now() } as WaitingAnswer)
      changed([...new Set(entries.map((e) => e.path))])
      return group
    },
    async undo(group) {
      const paths = waiting.filter((w) => w.group === group).map((w) => w.path)
      if (paths.length === 0) return false
      waiting.splice(0, waiting.length, ...waiting.filter((w) => w.group !== group))
      changed(paths)
      return true
    },
    async text(path) {
      const file = await store.read(vault, path)
      return file === null || typeof file.content !== 'string' ? null : applyOps(file.content, waiting.map((w) => w.op)).content
    },
  }
  return answers as Answers
}
