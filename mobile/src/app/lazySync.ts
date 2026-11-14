import type { Answers } from '../answers/answers'
import type { ReviewLink } from '../review/link'
import { vaultId, type TokenStore, type VaultStore } from '../store'
import type { SyncEngine } from '../sync/engine'
import { IDLE, type ShellSync, type ShellSyncEvent, type ShellSyncState } from './syncPort'

type EngineModule = {
  createSyncEngine: typeof import('../sync/engine').createSyncEngine
  followPage: typeof import('../sync/pageEvents').followPage
  /** 3C's answer list (YAZ-5073), made with the engine: ONE list for the Review tab and the send. */
  createAnswers?: typeof import('../answers/answers').createAnswers
  /** The list's own page events (decision 4): hidden → send at once; `online` → send at once. */
  followAnswers?: typeof import('../review/followAnswers').followAnswers
}

/** 3B's engine is a `ShellSync` as it is: this line fails the typecheck if the two drift apart. */
export const engineFits = (engine: SyncEngine): ShellSync => engine

/**
 * 3B's sync engine (YAZ-5072), loaded the first time a vault opens. The engine brings the shared frontmatter parser
 * (`yaml`, through `indexRecord`): about 126 kB minified, so it is a chunk of its own and the sign-in screen does not
 * wait for it. A vault whose copy is whole on the phone (a checkpoint) is ready at once, also while the engine loads
 * or reads its stored index, so a returning person sees the tabs, and only a first open sees the download view.
 */
export function lazySync(store: VaultStore, tokens: TokenStore, load: () => Promise<EngineModule> = loadEngine): ShellSync {
  let engine: SyncEngine | null = null
  let answers: Answers | null = null
  let loading: Promise<SyncEngine> | null = null
  let state: ShellSyncState = IDLE
  const listeners = new Set<(event: ShellSyncEvent) => void>()
  /** The vault id whose copy is whole on the phone (a checkpoint exists: 3B writes it last). */
  let held: string | null = null
  /** Counts the `open` calls: only the last one may open the engine. */
  let calls = 0
  const emit = (event: ShellSyncEvent) => {
    // The engine says `ready: false` while it reads the stored index on open; a whole copy is ready all the same.
    if (event.type === 'state') {
      state = { ...event.state, ready: event.state.ready || (held !== null && event.state.vault === held) }
      event = { type: 'state', state }
    }
    for (const listener of [...listeners]) listener(event)
  }
  const ready = () =>
    (loading ??= load().then((m) => {
      const e = m.createSyncEngine({ store, tokens })
      m.followPage(e)
      // 3C's result comment: the list needs its own two calls, or the background send does not run (YAZ-5078).
      if (m.createAnswers !== undefined) {
        answers = m.createAnswers({ store, engine: e })
        m.followAnswers?.(answers)
      }
      e.subscribe(emit)
      engine = e
      return e
    }))

  return {
    state: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    async open(vault) {
      // The LAST call wins (YAZ-5176): a call that waited for the chunk, or for the checkpoint, while a later call came
      // does nothing when it wakes.
      const call = ++calls
      const id = vault === null ? null : vaultId(vault)
      const whole = id !== null && (await store.checkpoint(id)) !== null
      if (call !== calls) return
      held = whole ? id : null
      if (engine === null) {
        if (vault === null) {
          if (state !== IDLE) emit({ type: 'state', state: IDLE })
          return
        }
        emit({ type: 'state', state: { ...IDLE, status: 'syncing', vault: id, ready: false } })
        const loaded = await ready()
        if (call !== calls) return
        await loaded.open(vault)
        return
      }
      await engine.open(vault)
      // A new token for the same vault ("Sign in again", N6): the waiting answers go now.
      if (vault !== null) void answers?.sendNow()
    },
    async idle() {
      if (engine !== null) await engine.idle()
    },
    async syncNow() {
      if (engine !== null) await engine.syncNow()
      // After the pass: the answers that waited (3C: "engine.syncNow(), then answers.sendNow()").
      await answers?.sendNow()
    },
    async review(): Promise<ReviewLink | null> {
      if (loading === null) return null
      const e = await loading
      return answers === null ? null : { engine: e, answers, store }
    },
  }
}

async function loadEngine(): Promise<EngineModule> {
  const [engine, page, list, follow] = await Promise.all([import('../sync/engine'), import('../sync/pageEvents'), import('../answers/answers'), import('../review/followAnswers')])
  return { createSyncEngine: engine.createSyncEngine, followPage: page.followPage, createAnswers: list.createAnswers, followAnswers: follow.followAnswers }
}
