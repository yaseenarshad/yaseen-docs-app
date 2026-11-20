import { createWikilinkResolveSource, type WikilinkResolveSource } from '@client/editor/wikilink/linkResolve'
import { makeResolver } from '@shared/linkResolver'
import { IDS_FILE, idLettersOf, idsAnswer } from '@shared/pageId'
import { LINK_PILLS_FILE, NO_LINK_PILLS, isDefaultLinkPills, sanitizeLinkPills } from '@shared/linkPills'
import { DEFAULT_REVIEW_SETTINGS, REVIEW_SETTINGS_FILE, sanitizeReviewSettings, type ReviewSettings } from '@shared/reviews'
import { FOLDER_SETTINGS_FILE, VAULT_CONFIG_DIR, type IndexRecord } from '@shared/types'
import type { PhoneIndex } from '../sync/phoneIndex'
import type { ReviewLink } from './link'

/** The vault's review settings (`.yaseendocs/review.json`, shared by every device: the due dates are the same). */
export const REVIEW_SETTINGS_PATH = `${VAULT_CONFIG_DIR}/${REVIEW_SETTINGS_FILE}`
/** The vault's ID letters (`.yaseendocs/ids.json`): the new-card order reads them, as on the Mac. */
export const IDS_PATH = `${VAULT_CONFIG_DIR}/${IDS_FILE}`
/** The vault's link pills look (`.yaseendocs/link-pills.json`): a card's links follow its format, as on the Mac (YAZ-5792). */
export const LINK_PILLS_PATH = `${VAULT_CONFIG_DIR}/${LINK_PILLS_FILE}`

/**
 * The open vault as the Review tab reads it, with no second due list (decision 3): the engine's index, with the
 * answer list's waiting actions in it (`answers.view`), given to `useCardReview` as its `IndexSource`. It reads again
 * on each `changed` of the engine (a pass brought new files) and of the list (an answer, an Undo, a ⋯ action).
 *
 *  - `records` and `folders` are ONE array each while nothing changes (`useSyncExternalStore`), in path order as the
 *    Mac's index gives them. A record that did not change keeps its object, so the hook's caches hold.
 *  - `settings`: `review.json` through the Mac's own `sanitizeReviewSettings`. `letters`: `ids.json` as the Mac reads it.
 *  - `links`: the card's `[[links]]` resolve by the Mac's rule (`makeResolver`), for the pills.
 *  - `ready` is false until the first index is in: the screen starts no session on an empty list.
 */
export interface ReviewSource {
  readonly records: readonly IndexRecord[]
  readonly folders: readonly IndexRecord[]
  readonly letters: readonly string[] | undefined
  readonly settings: ReviewSettings
  readonly ready: boolean
  /** Every file of the vault (the checkpoint's list): where a card's picture or sound resolves. */
  readonly files: readonly string[]
  readonly links: WikilinkResolveSource
  subscribe(listener: () => void): () => void
  /** Reads the index and the list again (the screen calls it after a ⋯ write the hook does not read back). */
  refresh(): Promise<void>
  stop(): void
}

const NONE: readonly IndexRecord[] = Object.freeze([])
const byPath = (a: IndexRecord, b: IndexRecord) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)

const parse = (content: string | Uint8Array | undefined): unknown => {
  if (typeof content !== 'string') return undefined
  try {
    return JSON.parse(content) as unknown
  } catch {
    return undefined
  }
}

export function createReviewSource(link: ReviewLink, vault: string, vaultName: string): ReviewSource {
  const { engine, answers, store } = link
  const listeners = new Set<() => void>()
  const links = createWikilinkResolveSource()
  let records = NONE
  let folders = NONE
  let letters: readonly string[] | undefined
  let settings: ReviewSettings = DEFAULT_REVIEW_SETTINGS
  let ready = false
  let files: readonly string[] = []
  let stopped = false
  let shown: PhoneIndex | null = null
  let running: Promise<void> | null = null
  let again = false
  let readSettings = true

  const wake = () => listeners.forEach((l) => l())

  async function readConfig(): Promise<void> {
    const [review, ids, pills] = await Promise.all([store.read(vault, REVIEW_SETTINGS_PATH), store.read(vault, IDS_PATH), store.read(vault, LINK_PILLS_PATH)])
    // YAZ-5792: the card's links follow the vault's link format (`cardPill`); the same look object while the file holds still.
    const clean = sanitizeLinkPills(parse(pills?.content))
    const look = isDefaultLinkPills(clean) ? NO_LINK_PILLS : clean
    if (JSON.stringify(look) !== JSON.stringify(links.pills)) links.setLook(look, vaultName)
    const next = sanitizeReviewSettings(parse(review?.content))
    // ONE settings object while the file holds still: the hook's plan follows its identity.
    if (JSON.stringify(next) !== JSON.stringify(settings)) settings = next
    const config = parse(ids?.content)
    const held = idsAnswer(config) === true ? idLettersOf(config, vaultName).letters : undefined
    if (held?.join() !== letters?.join()) letters = held
  }

/** True when every field read by `makeResolver` and `links.update` is identical (card review history changes do not alter link resolution, YAZ-6028). */
function sameLinkRecord(a: IndexRecord, b: IndexRecord): boolean {
  if (a === b) return true
  if (a.path !== b.path || a.name !== b.name || a.folder !== b.folder || a.basename !== b.basename || a.title !== b.title || a.id !== b.id) return false
  const aa = a.properties.aliases
  const ba = b.properties.aliases
  if (aa !== ba) {
    if (!Array.isArray(aa) || !Array.isArray(ba) || aa.length !== ba.length || aa.some((v, i) => v !== ba[i])) return false
  }
  const ac = a.cards
  const bc = b.cards
  if (ac !== bc) {
    if ((ac?.length ?? 0) !== (bc?.length ?? 0)) return false
    if (ac !== undefined && bc !== undefined && ac.some((c, i) => c.id !== bc[i]!.id)) return false
  }
  return true
}

  let lettersBuilt: readonly string[] | undefined
  async function read(): Promise<void> {
    if (readSettings) {
      readSettings = false
      await readConfig()
    }
    const index = engine.index()
    if (index === null || engine.state().vault !== vault) return
    const view = await answers.view(index)
    if (stopped) return
    const checkpoint = await store.checkpoint(vault)
    const list = Object.keys(checkpoint?.shas ?? {})
    if (list.length !== files.length || list.some((f, i) => f !== files[i])) files = list
    const prev = new Map((shown === null ? [] : Object.values(shown.records)).map((r) => [r.path, r]))
    const all = Object.values(view.records)
    const same = shown !== null && all.length === prev.size && all.every((r) => prev.get(r.path) === r)
    const sameLinks =
      ready &&
      shown !== null &&
      lettersBuilt === letters &&
      all.length === prev.size &&
      all.every((r) => {
        const old = prev.get(r.path)
        return old !== undefined && sameLinkRecord(old, r)
      })
    shown = view
    if (!same || !ready) {
      const pages: IndexRecord[] = []
      const settingsFiles: IndexRecord[] = []
      for (const r of all) (r.name === FOLDER_SETTINGS_FILE ? settingsFiles : pages).push(r)
      records = pages.sort(byPath)
      folders = settingsFiles.sort(byPath)
      if (!sameLinks) {
        lettersBuilt = letters
        const resolve = makeResolver(
          records.map((record) => ({ record })),
          undefined,
          { folders, letters },
        )
        links.update((target) => resolve(target)?.record.path ?? null, records, folders, letters !== undefined, letters ?? [])
      }
    }
    ready = true
    wake()
  }

  /** One read at a time; a change during a read reads once more after it. */
  function refresh(): Promise<void> {
    if (stopped) return Promise.resolve()
    if (running !== null) {
      again = true
      return running
    }
    running = (async () => {
      try {
        do {
          again = false
          await read()
        } while (again && !stopped)
      } finally {
        running = null
      }
    })()
    return running
  }

  const offEngine = engine.subscribe((event) => {
    if (event.type !== 'changed' || event.vault !== vault) return
    if (event.diff === null || event.settings.some((p) => p === REVIEW_SETTINGS_PATH || p === IDS_PATH)) readSettings = true
    void refresh()
  })
  const offAnswers = answers.subscribe((event) => {
    if (event.type === 'changed' && event.vault === vault) void refresh()
  })
  void refresh()

  return {
    get records() {
      return records
    },
    get folders() {
      return folders
    },
    get letters() {
      return letters
    },
    get settings() {
      return settings
    },
    get ready() {
      return ready
    },
    get files() {
      return files
    },
    links,
    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    refresh,
    stop() {
      stopped = true
      offEngine()
      offAnswers()
      listeners.clear()
    },
  }
}
