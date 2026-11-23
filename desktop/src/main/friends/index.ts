/**
 * Mac Friends backend (YAZ-6219): wires `githubAuth.getValidAuth()` (with legacy `githubToken` fallback),
 * the Cloudflare D1 Friends API service (`service.ts`), the background stats sender (`macSender.ts`),
 * the card-file watcher trigger (`cardTrigger.ts`), and the count worker (`countWorker.ts`).
 */
import { join } from 'node:path'
import type { DeckVaultConfig } from '@shared/friendsApi'
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
  /** Lists repositories from the user's GitHub App installations with their real `installationId`. */
  listInstallableRepos(): Promise<{ ok: true; repos: DeckVaultConfig[] } | { ok: false; error: string }>
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
      await state.save({ ...prev, excludedVaults: [...excluded], lastInput: null, lastKey: null })

      // Sync canonical lowercase `owner/repo` included vaults to D1 via PUT /api/friends/prefs
      try {
        const bin = await resolveGit()
        if (bin !== null) {
          const includedRepos: string[] = []
          const seen = new Set<string>()
          for (const v of listVaults(store.get())) {
            if (excluded.has(v.path)) continue
            const facts = await detectRepo(bin, v.path).catch(() => null)
            const rawRepo = facts?.remoteUrl ? repoOfRemote(facts.remoteUrl) : null
            if (!rawRepo) continue
            const slug = rawRepo.split('@')[0].trim().toLowerCase()
            if (slug && !seen.has(slug)) {
              seen.add(slug)
              includedRepos.push(slug)
            }
          }
          await service.updatePrefs({ vaults: includedRepos }).catch(() => undefined)
        }
      } catch {
        // Best-effort prefs sync; local exclusion + recount still proceeds.
      }

      sender.vaultsChanged()
      return { ok: true as const, knownVaults: buildKnownVaults(excluded) }
    },
    async listInstallableRepos() {
      if (process.env.YASEEN_DOCS_FRIENDS_DEMO === '1') {
        return {
          ok: true as const,
          repos: [
            { repo: 'yaseen/cards-friends-demo', installationId: 1001, name: 'Cards Friends Demo' },
            { repo: 'yaseen/med-notes', installationId: 1001, name: 'Med Notes' },
          ],
        }
      }
      const token = await readToken()
      if (!token) return { ok: false as const, error: 'signed_out' }
      const headers = {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      }
      try {
        const instRes = await fetch('https://api.github.com/user/installations?per_page=100', { headers })
        if (!instRes.ok) {
          return { ok: false as const, error: instRes.status === 401 ? 'signed_out' : `github_${instRes.status}` }
        }
        const instJson = (await instRes.json().catch(() => null)) as { installations?: unknown[] } | null
        const installations = Array.isArray(instJson?.installations) ? instJson.installations : []
        const seen = new Map<string, DeckVaultConfig>()
        for (const item of installations) {
          if (!isRecord(item) || typeof item.id !== 'number' || item.id <= 0) continue
          const installationId = item.id
          const repoRes = await fetch(`https://api.github.com/user/installations/${installationId}/repositories?per_page=100`, { headers })
          if (!repoRes.ok) continue
          const repoJson = (await repoRes.json().catch(() => null)) as { repositories?: unknown[] } | null
          const repositories = Array.isArray(repoJson?.repositories) ? repoJson.repositories : []
          for (const r of repositories) {
            if (!isRecord(r) || typeof r.full_name !== 'string') continue
            const slug = r.full_name.trim().toLowerCase()
            if (!slug || seen.has(slug)) continue
            const name = typeof r.name === 'string' && r.name.trim() !== '' ? r.name.trim() : slug.split('/').pop() ?? slug
            seen.set(slug, { repo: slug, installationId, name })
          }
        }
        const repos = [...seen.values()].sort((a, b) => a.repo.localeCompare(b.repo))
        return { ok: true as const, repos }
      } catch (err) {
        return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
      }
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
