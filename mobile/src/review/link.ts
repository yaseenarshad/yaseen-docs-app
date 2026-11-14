import type { Answers } from '../answers/answers'
import type { VaultStore } from '../store'
import type { SyncEngine } from '../sync/engine'

/**
 * What the Review tab (4B, YAZ-5078) needs from the engine (3B) and the answer list (3C) of the open vault. The app
 * shell makes ONE of each when the engine loads (`app/lazySync.ts`) and gives them here, so the screen and the send
 * share one list. Tests give the real engine and list on the fake GitHub (`review/testing.ts`).
 */
export interface ReviewLink {
  /** 3B's engine: the open vault's index, its `changed` events and its state. */
  engine: Pick<SyncEngine, 'index' | 'subscribe' | 'state'>
  /** 3C's answer list of the open vault: the answers, Undo, the lost answers, the phone's view of each file. */
  answers: Answers
  store: VaultStore
  /** Pictures and sounds (3D). Absent: the card shows a calm line in place of each one. */
  media?: CardMedia
}

/**
 * What a card needs from 3D (YAZ-5074, `mobile/src/media`) to show ONE picture or sound now: a structural part of
 * 3D's `MediaAhead`, so 3D's object plugs in as it is. `showLink(src, holder)` resolves `src` as written in the file
 * `holder` (the file that holds the card, never a page that embeds it) and never throws.
 *
 * WIRE 3D: pass `createMediaAhead({ engine, store, dayNumbers })` as `media` in `lazySync.ts` (`review()`).
 */
export interface CardMedia {
  showLink(src: string, holder: string): Promise<CardMediaShow>
}

/** 3D's `MediaShow`, the parts a card reads: a URL (`blob:`) for `<img>` and `<audio>`, or why there is none. */
export type CardMediaShow = { status: 'ready'; url: string } | { status: 'missing'; why: string }
