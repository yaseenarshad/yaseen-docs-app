import { CARD_AUDIO_ATTR, stopCardAudio } from '@client/editor/card/cardMedia'
import { IMAGE_VIEW_MIME } from '@shared/types'
import type { VaultStore } from '../../store'
import type { MediaAhead } from '../ahead'

/**
 * THE PICTURES, SOUNDS AND FILES OF A DRAWN PAGE OR CARD (YAZ-5079, 4C; shared with 4B's Review screen). The screens
 * draw first and ask for bytes after: a drawn picture is `<img data-vault-src="<vault path>">` with no address, a page's
 * sound is `[data-vault-sound]`, a card's sound player (`renderCard`'s `.card__audio`) holds `vaultMediaUrl(path)`.
 * `watchMedia(root, media)` gives each one its bytes from 3D (`MediaAhead.show`: the store first, then GitHub, then
 * kept) ONLY when it comes near the screen, so a page of 200 pictures asks for the few in view. With no signal it shows
 * one calm line ("Needs a connection"; the text stays), and fills in when the signal returns (`online`, or `retry()`
 * after a pass). `stop()` (the view closes) stops the card's sound and forgets late answers.
 *
 * The object URLs are 3D's: one per file of the open vault, kept for `urlNow`, revoked when the file changes, the vault
 * changes, or the media stops. The store-only stand-in (`storedMedia`, tests and before the engine loads) revokes its
 * own at `release()`.
 */

/** What a screen gets for one file: the part of 3D's `MediaShow` the screens read. */
export type FileShow =
  | { status: 'ready'; path: string; url: string; type: string }
  | {
      status: 'missing'
      path: string | null
      /** 3D's reasons: `offline` (N3), `slowed`, `gone`, `not-in-vault`, `no-vault`, `failed`. */
      why: string
    }

/** The media a screen asks: 3D's `MediaAhead` as it is (`mediaFits`), or a stand-in. */
export interface VaultMedia {
  show(path: string): Promise<FileShow>
  /** The URL `show` made for `path` before, or null: for a card drawn at once (`CardLookPlace.src`). */
  urlNow?(path: string): string | null
}

/** 3D's `MediaAhead` is a `VaultMedia` as it is: this line fails the typecheck if the two drift apart. */
export const mediaFits = (media: MediaAhead): VaultMedia => media

// `lazyMedia` is in its own small file, so the first load (`main.tsx`) takes nothing else from here.
export { lazyMedia } from './lazyMedia'

const SOUND_MIME: Record<string, string> = { mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg' }

/** The MIME type of a vault file by its name: a picture, a sound, a PDF; else `application/octet-stream`. */
export function fileType(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  if (ext === 'pdf') return 'application/pdf'
  return (IMAGE_VIEW_MIME as Record<string, string>)[`.${ext}`] ?? SOUND_MIME[ext] ?? 'application/octet-stream'
}

/**
 * The store alone (no network): a stored file is an object URL, any other is `offline`. For tests, and for an app with no
 * engine. Its URLs live until `release()`, which revokes each one.
 */
export function storedMedia(store: VaultStore, vault: string): VaultMedia & { release(): void } {
  const urls = new Map<string, string>()
  return {
    async show(path) {
      const held = urls.get(path)
      if (held !== undefined) return { status: 'ready', path, url: held, type: fileType(path) }
      const file = await store.read(vault, path)
      if (file === null) return { status: 'missing', path, why: 'offline' }
      void store.markViewed(vault, path).catch(() => undefined)
      const bytes = typeof file.content === 'string' ? new TextEncoder().encode(file.content) : file.content
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: fileType(path) }))
      urls.set(path, url)
      return { status: 'ready', path, url, type: fileType(path) }
    },
    urlNow: (path) => urls.get(path) ?? null,
    release() {
      for (const url of urls.values()) URL.revokeObjectURL(url)
      urls.clear()
    },
  }
}

/**
 * The address a drawn card's picture or sound holds until its bytes come: a `data:` text that names the vault file, so
 * the browser fetches nothing (the page's CSP allows `data:`).
 */
export const VAULT_MEDIA_PREFIX = 'data:text/plain,vault-media:'
export const vaultMediaUrl = (path: string): string => `${VAULT_MEDIA_PREFIX}${encodeURIComponent(path)}`
export const vaultMediaPath = (src: string): string | null => (src.startsWith(VAULT_MEDIA_PREFIX) ? decodeURIComponent(src.slice(VAULT_MEDIA_PREFIX.length)) : null)

const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1)

/** The calm line for a file the phone cannot show now (N3: "Needs a connection"; the text still shows). */
export function missingWords(kind: 'Picture' | 'Sound' | 'File', path: string, show: Extract<FileShow, { status: 'missing' }>): string {
  if (show.why === 'offline') return `${kind} · ${nameOf(path)} · Needs a connection`
  if (show.why === 'gone' || show.why === 'not-in-vault') return `Missing ${kind.toLowerCase()} · ${nameOf(path)}`
  if (show.why === 'slowed') return `${kind} · ${nameOf(path)} · Try again soon`
  return `${kind} · ${nameOf(path)} · Can't show it now`
}

/** Types the iPhone's own viewer shows (round 12, items 11 and 12). Any other: "Can't open on the phone yet". */
const VIEWABLE = /^(application\/pdf|image\/|audio\/|video\/|text\/)/

/**
 * Opens a vault file in the iPhone's own viewer from its stored blob (a PDF: round 12, item 11), or says why it cannot
 * (item 12). Returns the words to show, or null when the viewer opened.
 */
export async function openFile(media: VaultMedia, path: string, open: (url: string) => boolean = (url) => window.open(url, '_blank') !== null): Promise<string | null> {
  const show = await media.show(path)
  if (show.status !== 'ready') return missingWords('File', path, show)
  if (!VIEWABLE.test(show.type) || !open(show.url)) return `${nameOf(path)} · Can't open on the phone yet`
  return null
}

/** Each element that waits for bytes, found in `root`. */
const WAITING = `img[data-vault-src], [data-vault-sound], .card__audio[${CARD_AUDIO_ATTR}^="${VAULT_MEDIA_PREFIX}"]`

function pathOf(el: Element): string | null {
  if (el instanceof HTMLImageElement && el.dataset.vaultSrc !== undefined) return el.dataset.vaultSrc
  const sound = (el as HTMLElement).dataset?.vaultSound
  if (sound !== undefined) return sound
  return vaultMediaPath(el.getAttribute(CARD_AUDIO_ATTR) ?? '')
}

export interface MediaWatch {
  /** Asks again for each file that was missing (a pass ended, the signal came back). */
  retry(): void
  /** The view closes: no more asks, no late answer lands, the card's sound stops. */
  stop(): void
}

/** How far outside the screen a picture starts to come (the reader's own scroller). */
const NEAR = '600px 0px'

/**
 * Gives each picture and sound of `root` its bytes when it comes near the screen (see the module doc). New elements
 * (an embedded card read after the page, the next piece of a long page) are watched too.
 */
export function watchMedia(root: HTMLElement, media: VaultMedia, options: { online?: EventTarget } = {}): MediaWatch {
  let stopped = false
  /** Each element: what it asked last. `missing`: its calm line, asked again on `retry`. */
  const state = new Map<Element, { path: string; asking: boolean; missing: HTMLElement | null; done: boolean }>()
  const near = new Set<Element>()

  const fill = (el: Element, url: string) => {
    if (el instanceof HTMLImageElement) el.src = url
    else if (el.hasAttribute(CARD_AUDIO_ATTR)) el.setAttribute(CARD_AUDIO_ATTR, url)
    else {
      const audio = document.createElement('audio')
      audio.controls = true
      audio.preload = 'none'
      audio.src = url
      el.replaceChildren(audio)
    }
  }

  const ask = (el: Element) => {
    const held = state.get(el)
    if (stopped || held === undefined || held.asking || held.done) return
    held.asking = true
    void media.show(held.path).then(
      (show) => {
        held.asking = false
        if (stopped || !el.isConnected) return
        if (show.status === 'ready') {
          held.done = true
          held.missing?.remove()
          held.missing = null
          ;(el as HTMLElement).hidden = false
          fill(el, show.url)
          return
        }
        const words = missingWords(el instanceof HTMLImageElement ? 'Picture' : 'Sound', held.path, show)
        if (held.missing === null) {
          held.missing = document.createElement('span')
          held.missing.className = 'page-media page-media--missing'
          el.before(held.missing)
        }
        held.missing.textContent = words
        ;(el as HTMLElement).hidden = true
      },
      () => {
        held.asking = false
      },
    )
  }

  const seen =
    typeof IntersectionObserver === 'undefined'
      ? null
      : new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (!entry.isIntersecting) continue
              near.add(entry.target)
              ask(entry.target)
            }
          },
          { rootMargin: NEAR },
        )

  const take = (el: Element) => {
    if (state.has(el)) return
    const path = pathOf(el)
    if (path === null) return
    state.set(el, { path, asking: false, missing: null, done: false })
    // Without an observer (an old browser): ask at once.
    if (seen === null) ask(el)
    else seen.observe(el)
  }
  const scan = (node: ParentNode) => {
    if (node instanceof Element && node.matches(WAITING)) take(node)
    for (const el of node.querySelectorAll(WAITING)) take(el)
  }
  scan(root)
  const added = new MutationObserver((records) => {
    for (const record of records) for (const node of record.addedNodes) if (node instanceof Element) scan(node)
  })
  added.observe(root, { childList: true, subtree: true })

  const retry = () => {
    for (const [el, held] of state) if (held.missing !== null && (seen === null || near.has(el))) ask(el)
  }
  const online = options.online ?? window
  online.addEventListener('online', retry)

  return {
    retry,
    stop() {
      if (stopped) return
      stopped = true
      seen?.disconnect()
      added.disconnect()
      online.removeEventListener('online', retry)
      // A card's sound plays in the whole window (`cardMedia.ts`): the view that closes stops it.
      if (root.querySelector('.card__audio') !== null) stopCardAudio()
      for (const sound of root.querySelectorAll('audio')) sound.pause()
    },
  }
}
