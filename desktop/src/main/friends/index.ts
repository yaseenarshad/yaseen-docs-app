/**
 * Mac Friends backend (YAZ-6219): wires `githubAuth.getValidAuth()` (with legacy `githubToken` fallback),
 * the Cloudflare D1 Friends API service (`service.ts`), the background stats sender (`macSender.ts`),
 * the card-file watcher trigger (`cardTrigger.ts`), and the count worker (`countWorker.ts`).
 */
import { join } from 'node:path'
import { emptyBudget } from '@shared/friendSend'
import { isRecord } from '@shared/guards'
import { cleanToken } from '@shared/githubInput'
import { REVIEW_SETTINGS_FILE, sanitizeReviewSettings } from '@shared/reviews'
import { GITHUB_TOKEN_SECRET, listVaults, type FriendsSendView } from '@shared/types'
import { atomicWrite, createChain, readOrQuarantine } from '../fs/fsUtils'
import { subscribe } from '../fs/watchers'
import { detectRepo } from '../git/detect'
import { resolveGit } from '../git/exec'
import { repoOfRemote } from '../git/repoOfRemote'
import type { GithubAuthManager } from '../githubAuth'
import { rootsOf } from '../ipc/broadcast'
import type { Secrets } from '../secrets'
import type { Store } from '../store'
import { readConfigDetailed } from '../vaultConfig'
import { getIndex } from '../vaultIndex'
import { watchCardFiles } from './cardTrigger'
import { gitFolderFacts, knownClosedVaults } from './closedVaults'
import { makeCounter } from './countJob'
import countWorker from './countWorker?modulePath'
import { createMacSender, type MacSendSaved, type MacSender } from './macSender'
import { createFriendsService, type FriendsService } from './service'

export const FRIENDS_SEND_FILE = 'friends-send.json'
export const FRIENDS_SCAN_DIR = 'friends-scan'
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
  service: FriendsService
  /** For Settings: the last state, with no network call, including per-vault include/exclude checkboxes. */
  look(): Promise<FriendsSendView>
  /** Include or exclude a local vault path from Friends counting (YAZ-6275). */
  setVaultIncluded(vaultPath: string, included: boolean): Promise<{ ok: true; knownVaults: { path: string; name: string; included: boolean }[] } | { ok: false; error: string }>
  tokenChanged(): void
  stop(): Promise<void>
}

export interface FriendsAuthSource {
  githubAuth?: Pick<GithubAuthManager, 'getValidAuth'>
  secrets?: Pick<Secrets, 'read'>
}

export function startFriendsSend(
  store: Store,
  auth: FriendsAuthSource | Pick<Secrets, 'read'>,
  userData: string,
  fetch: typeof globalThis.fetch = globalThis.fetch,
): FriendsSend {
  const state = sendStateFile(join(userData, FRIENDS_SEND_FILE))
  const authSource: FriendsAuthSource = 'read' in auth ? { secrets: auth } : auth

  const readToken = async (): Promise<string | null> => {
    const valid = await authSource.githubAuth?.getValidAuth().catch(() => null)
    if (valid?.token) return valid.token
    if (authSource.secrets) {
      const stored = await authSource.secrets.read(GITHUB_TOKEN_SECRET)
      return stored === null ? null : cleanToken(stored)
    }
    return null
  }

  const service = createFriendsService({
    getGithubToken: readToken,
    fetch,
  })

  let excludedSet: Set<string> | null = null
  const loadExcluded = async (): Promise<Set<string>> => {
    if (excludedSet !== null) return excludedSet
    const saved = await state.load().catch(() => null)
    excludedSet = new Set(Array.isArray(saved?.excludedVaults) ? saved.excludedVaults.filter((v): v is string => typeof v === 'string') : [])
    return excludedSet
  }
  const buildKnownVaults = (excluded: ReadonlySet<string>) =>
    listVaults(store.get()).map((v) => ({ path: v.path, name: v.name, included: !excluded.has(v.path) }))

  const counter = makeCounter(countWorker, { scanDir: join(userData, FRIENDS_SCAN_DIR), indexDir: join(userData, 'index-cache') })
  const sender = createMacSender({
    readToken,
    client: service.client,
    excludedVaults: loadExcluded,
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
    stats: (text, now, closed, zone) => counter(text, now, closed, zone),
    async closed(wanted) {
      const bin = await resolveGit()
      if (bin === null) return new Map()
      const current = store.get()
      return knownClosedVaults(listVaults(current).map((v) => v.path), new Set(rootsOf(current)), gitFolderFacts(bin), wanted)
    },
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
    service,
    async look() {
      const excluded = await loadExcluded()
      const knownVaults = buildKnownVaults(excluded)
      const view = sender.view()
      if (view.status !== 'idle') return { ...view, knownVaults }
      const saved = await state.load().catch(() => null)
      const base = { ...view, lastSentAt: saved?.lastSentAt ?? null, friends: saved?.friends ?? 0, groups: saved?.groups ?? 0, knownVaults }
      if ((await readToken()) === null) return { ...base, status: 'no-token' }
      return base
    },
    async setVaultIncluded(vaultPath: string, included: boolean) {
      const excluded = await loadExcluded()
      if (included) excluded.delete(vaultPath)
      else excluded.add(vaultPath)
      const prev = (await state.load().catch(() => null)) ?? {
        lastSentAt: null,
        lastKey: null,
        budget: emptyBudget(),
        friends: 0,
        groups: 0,
        refused: false,
      }
      await state.save({ ...prev, excludedVaults: [...excluded], lastInput: null })
      void sender.attempt('pass')
      return { ok: true as const, knownVaults: buildKnownVaults(excluded) }
    },
    tokenChanged: () => {
      service.clearSession()
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
