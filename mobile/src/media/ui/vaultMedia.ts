import { CARD_AUDIO_ATTR, stopCardAudio } from '@client/editor/card/cardMedia'
import { urlOf } from '@client/editor/card/localOnly'
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
 * The object URLs are 3D's: one per file of the open vault, counted by its users. The watcher lets go of each URL it
 * used (`releaseUrl`) when its element leaves the page or the view closes; 3D revokes it when no screen uses it, past a
 * few recent ones (YAZ-5200). The store-only stand-in (`storedMedia`, tests and before the engine loads) revokes its
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
  /** The screen no longer uses `url`, which one `show` of `path` gave (YAZ-5200, YAZ-5221): 3D may revoke it. */
  releaseUrl?(path: string, url?: string): void
}

/** 3D's `MediaAhead` is a `VaultMedia` as it is: this line fails the typecheck if the two drift apart. */
export const mediaFits = (media: MediaAhead): VaultMedia => media

// `lazyMedia` is in its own small file, so the first load (`main.tsx`) takes nothing else from here.
export { lazyMedia } from './lazyMedia'

const SOUND_MIME: Record<string, string> = { mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' }

/** The MIME type of a vault file by its name: a raster picture, a sound, a video, a PDF; else `application/octet-stream`. */
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
 * The mark a drawn card's picture or sound holds until its bytes come: a `#…` reference to the page itself that names the
 * vault file. It is never set as an address (YAZ-5242): `watchMedia` puts the bytes in its place.
 */
export const VAULT_MEDIA_PREFIX = '#vault-media:'
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

/**
 * THE TYPES THAT MAY OPEN AS A PAGE (YAZ-5280). A `blob:` page has the APP'S OWN origin, where the token is kept. So the
 * iPhone's viewer opens only a type that cannot run script there:
 *  - `application/pdf`: WebKit draws a PDF with its own viewer, which runs no script of the file.
 *  - `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/avif`, `image/bmp`: raster pictures; pixels only.
 *  - `audio/mpeg`, `audio/mp4`, `audio/wav`, `audio/ogg`; `video/mp4`, `video/quicktime`, `video/webm`: the media
 *    player; sound and frames only.
 * Both the file's name and the type 3D gives must be on the list, so a type that lies changes nothing. Anything else
 * (SVG, HTML, XML, `text/*`, an unknown type) never opens as a page: the phone says "Open this file on the Mac", with no
 * attempt. An SVG in a page or a card shows only through `<img>`, where it cannot run script.
 */
const OPENS_AS_PAGE = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/ogg',
  'video/mp4',
  'video/quicktime',
  'video/webm',
])

/**
 * Opens a vault file in the iPhone's own viewer from its stored blob (a PDF: round 12, item 11), when its type is on
 * `OPENS_AS_PAGE` (YAZ-5280). Any other file gets "<name> · Open this file on the Mac" at once, with no attempt
 * (round 12, item 12; the follow-up of the live run): the download path read the blob with `fetch`, which the CSP's
 * `connect-src` (GitHub only) refuses, so it never worked on the site. Returns the words to show, or null when it opened.
 */
export async function openFile(media: VaultMedia, path: string, open: (url: string) => boolean = (url) => window.open(url, '_blank') !== null): Promise<string | null> {
  const name = nameOf(path)
  const onMac = `${name} · Open this file on the Mac`
  if (!OPENS_AS_PAGE.has(fileType(path))) return onMac
  const show = await media.show(path)
  if (show.status !== 'ready') return missingWords('File', path, show)
  const type = show.type.split(';')[0].trim().toLowerCase()
  if (!OPENS_AS_PAGE.has(type)) return onMac
  return open(show.url) ? null : `${name} · Can't open on the phone yet`
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
  const state = new Map<Element, { path: string; asking: boolean; missing: HTMLElement | null; done: boolean; url?: string }>()
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
      (answer) => {
        let show = answer
        held.asking = false
        if (stopped || !el.isConnected || state.get(el) !== held) {
          // A late answer for a view that closed or an element that left: its URL has no user.
          if (show.status === 'ready') media.releaseUrl?.(held.path, show.url)
          return
        }
        // Only the app's own bytes become an address (YAZ-5242).
        if (show.status === 'ready' && urlOf(show.url).kind !== 'own') show = { status: 'missing', path: held.path, why: 'failed' }
        if (show.status === 'ready') {
          held.done = true
          held.url = show.url
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
  /** Lets go of the URL `el` used, one time (YAZ-5200). */
  const letGo = (el: Element) => {
    const held = state.get(el)
    state.delete(el)
    near.delete(el)
    seen?.unobserve(el)
    held?.missing?.remove()
    if (held?.done === true) media.releaseUrl?.(held.path, held.url)
  }
  const added = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) if (node instanceof Element) scan(node)
      // An element that left the page for good (not moved within it): its URL is let go.
      for (const node of record.removedNodes) {
        if (!(node instanceof Element) || node.isConnected) continue
        if (state.has(node)) letGo(node)
        for (const el of [...state.keys()]) if (node.contains(el)) letGo(el)
      }
    }
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
      for (const el of [...state.keys()]) letGo(el)
    },
  }
}
