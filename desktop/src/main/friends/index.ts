/**
 * The Mac's send of the numbers (YAZ-5086, 4E5), wired to the app: the token from the ONE secrets store (YAZ-5098's
 * `githubToken`, Settings › Review › "Phone and friends"), the open vaults and their live index, the stored state in
 * `<userData>/friends-send.json`, the trigger (`cardTrigger.ts`) and one try at the app's start.
 */
import { join } from 'node:path'
import { isRecord } from '@shared/guards'
import { cleanToken } from '@shared/githubInput'
import { REVIEW_SETTINGS_FILE, sanitizeReviewSettings } from '@shared/reviews'
import { GITHUB_TOKEN_SECRET, type FriendsSendView } from '@shared/types'
import { atomicWrite, createChain, readOrQuarantine } from '../fs/fsUtils'
import { subscribe } from '../fs/watchers'
import { detectRepo } from '../git/detect'
import { resolveGit } from '../git/exec'
import { rootsOf } from '../ipc/broadcast'
import { repoOfRemote } from '../phoneCode'
import type { Secrets } from '../secrets'
import type { Store } from '../store'
import { readConfigDetailed } from '../vaultConfig'
import { getIndex } from '../vaultIndex'
import { watchCardFiles } from './cardTrigger'
import { countTextOffThread } from './countJob'
import countWorker from './countWorker?modulePath'
import { macGistsApi, readProfile } from './gistsHttp'
import { createMacSender, type MacSendSaved, type MacSender } from './macSender'

export const FRIENDS_SEND_FILE = 'friends-send.json'
/** The first try after the app starts: after the windows and their vaults are open, never in the way of the start. */
export const START_TRY_MS = 30_000

/** The stored state, as `createMacSender` reads it. A file that is not one is moved aside and the state starts empty. */
export function sendStateFile(file: string): { load(): Promise<MacSendSaved | null>; save(saved: MacSendSaved): Promise<void> } {
  const chain = createChain()
  const parse = (raw: unknown): MacSendSaved | null =>
    isRecord(raw) && isRecord(raw.budget) && Array.isArray(raw.budget.updates) ? (raw as unknown as MacSendSaved) : null
  return {
    load: () => readOrQuarantine(file, parse, 'friends', 'a friends send state'),
    save: (saved) => chain.run(async () => void (await atomicWrite(file, `${JSON.stringify(saved)}\n`))),
  }
}

export interface FriendsSend {
  sender: MacSender
  /** For Settings: the last state, with no network call. */
  look(): Promise<FriendsSendView>
  tokenChanged(): void
  stop(): Promise<void>
}

export function startFriendsSend(store: Store, secrets: Pick<Secrets, 'read'>, userData: string, fetch: typeof globalThis.fetch = globalThis.fetch): FriendsSend {
  const state = sendStateFile(join(userData, FRIENDS_SEND_FILE))
  const readToken = async () => {
    const stored = await secrets.read(GITHUB_TOKEN_SECRET)
    return stored === null ? null : cleanToken(stored)
  }
  const sender = createMacSender({
    readToken,
    api: (token) => macGistsApi(token, fetch),
    profile: (token) => readProfile(token, fetch),
    async vaults() {
      const bin = await resolveGit()
      const out = new Map<string, string>()
      if (bin === null) return out
      for (const root of rootsOf(store.get())) {
        const facts = await detectRepo(bin, root).catch(() => null)
        const repo = facts?.remoteUrl ? repoOfRemote(facts.remoteUrl) : null
        if (repo !== null && !out.has(repo.toLowerCase())) out.set(repo.toLowerCase(), root)
      }
      return out
    },
    async count(root) {
      const [index, config] = await Promise.all([getIndex(root), readConfigDetailed(root, REVIEW_SETTINGS_FILE)])
      return { pages: index.records, settings: sanitizeReviewSettings(config.state === 'ok' ? config.value : null) }
    },
    state,
    // YAZ-5250: the count runs on a worker thread; main only packs the cards and waits.
    stats: (text, now) => countTextOffThread(countWorker, text, now),
  })
  const stopTrigger = watchCardFiles({
    roots: () => rootsOf(store.get()),
    onRootsChange: (listener) => store.onChange(() => listener()),
    subscribe,
    cardPaths: async (root) => new Set((await getIndex(root)).records.filter((r) => (r.cards?.length ?? 0) > 0).map((r) => r.path)),
    fire: () => void sender.attempt('pass'),
  })
  const startTry = setTimeout(() => void sender.attempt('pass'), START_TRY_MS)
  startTry.unref?.()
  return {
    sender,
    async look() {
      const view = sender.view()
      if (view.status !== 'idle') return view
      const saved = await state.load().catch(() => null)
      const base = { ...view, lastSentAt: saved?.lastSentAt ?? null, friends: saved?.friends ?? 0, groups: saved?.groups ?? 0 }
      if ((await readToken()) === null) return { ...base, status: 'no-token' }
      if (saved?.refused) return { ...base, status: 'no-gists' }
      return base
    },
    tokenChanged: () => {
      sender.tokenChanged()
      void sender.attempt('pass')
    },
    async stop() {
      clearTimeout(startTry)
      stopTrigger()
      await sender.stop()
    },
  }
}
