/**
 * SOUND AND BOARDS IN A PAGE CARD (YAZ-5014, YAZ-5015): the DOM `renderCard` puts in place of a sound or a board
 * embed, AFTER DOMPurify (as the hidden-word spans are): the sanitiser sees only a plain marker span, and every element
 * and listener here is made by the app, never by the card's text.
 *
 *  THE PLAYER (YAZ-5014, Yaseen: "Yes, both"): `![](assets/audio/x.mp3)` and `![[x.mp3]]` (mp3, m4a, wav, ogg) are ONE
 *  line: a play button, the file name, a bar and the time, in the app's tokens (`card.css`). The `<audio>` is made
 *  at the first play, so a page of 50 sound cards fetches nothing until one plays; its file comes over `app://vault`
 *  (byte ranges for a seek, `desktop/src/main/vaultProtocol.ts`). ONE sound plays at a time in the whole window: a play
 *  stops the one before. A card drawn again (a side shown in the Inbox) keeps a playing sound: the new player of the
 *  same file takes it over. A click on the bar seeks. Nothing plays by itself; the Inbox's P plays or stops the card's
 *  first sound (`toggleCardAudio`), and its next card stops it (`stopCardAudio`).
 *
 *  THE BOARD PICTURE (YAZ-5015, Yaseen: "Yes, both"): `![[x.excalidraw]]` and `![[x.drawio]]` are a still picture of
 *  the whole board, fit to the card's width (its aspect kept, a max height), the board's name under it. The picture is
 *  the sidebar's hover picture (`boardPreviews`, a PNG fit in 1200×800, one per board, write and theme), so no live
 *  board engine starts in a card, and 50 cards of one board share one picture. It loads only when it comes near the
 *  screen (one IntersectionObserver for every card). A click opens the board as its link does (the page: Explore, a
 *  bound gesture a tab; the Inbox: the board layer on top). A board that does not resolve is the unresolved link pill.
 */
import { AUDIO_EXTENSIONS } from '@shared/types'
import { isBoard } from '@shared/fileKind'

/** On a sound's marker span (before the player is built): the source as written. */
export const CARD_AUDIO_ATTR = 'data-card-audio'
/** On a board picture (and its marker span): the raw `inner` of its `![[inner]]`, for the click, as a pill's. */
export const CARD_BOARD_ATTR = 'data-card-board'
/** What a click in a card opens: a pill or a board picture. */
export const CARD_OPENS = `[data-card-link], [${CARD_BOARD_ATTR}]`
/** A press here is the media's own: it never selects the card or steps the Inbox. */
export const CARD_MEDIA = '.card__audio'

const AUDIO: readonly string[] = AUDIO_EXTENSIONS
/** The file part of a link or a source: before `|`, `#` and `?`. */
const targetOf = (ref: string): string => ref.split(/[|#?]/)[0].trim()
const extOf = (ref: string): string => {
  const t = targetOf(ref)
  const dot = t.lastIndexOf('.')
  return dot < 0 ? '' : t.slice(dot + 1).toLowerCase()
}
const nameOf = (ref: string): string => {
  const t = targetOf(ref)
  let name = t.slice(t.lastIndexOf('/') + 1)
  try {
    name = decodeURIComponent(name)
  } catch {
    // A malformed escape stays as written.
  }
  return name
}

/** Is `ref` (a link's inner or an image's source) a sound file? */
export const isAudioRef = (ref: string): boolean => AUDIO.includes(extOf(ref))
/** Is `inner` a drawing or a diagram? */
export const isBoardRef = (inner: string): boolean => isBoard(targetOf(inner))

const AUDIO_TEXT_RE = /!\[\[[^[\]\n]+?\.(?:mp3|m4a|wav|ogg)(?:[|#][^[\]\n]*)?\]\]|!\[[^\]\n]*\]\(<?[^)\n]+?\.(?:mp3|m4a|wav|ogg)>?(?:\s[^)\n]*)?\)/i
/** Does a card's text (or one side's) hold a sound? The Inbox's "P Play" hint. */
export const textHasAudio = (text: string): boolean => AUDIO_TEXT_RE.test(text)

// ── The player ───────────────────────────────────────────────────────────────────────────────────────────────────

const PLAY = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.8v8.4L10 6z" fill="currentColor"/></svg>'
const PAUSE = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 2h2v8H3zM7 2h2v8H7z" fill="currentColor"/></svg>'

/** The one sound of the window: its URL, its element, and the player that shows it now. */
let current: {
  url: string
  audio: HTMLAudioElement
  player: HTMLElement
} | null = null

const clock = (s: number): string => {
  if (!Number.isFinite(s) || s < 0) return '0:00'
  const t = Math.floor(s)
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}

/** The player's look from its sound (or from nothing: stopped at 0:00). */
function paint(player: HTMLElement, audio: HTMLAudioElement | null): void {
  const playing = audio !== null && !audio.paused
  const button = player.querySelector<HTMLButtonElement>('.card__audio-play')
  if (button !== null && button.dataset.playing !== String(playing)) {
    button.dataset.playing = String(playing)
    button.innerHTML = playing ? PAUSE : PLAY
    button.setAttribute('aria-label', playing ? 'Pause' : 'Play')
  }
  player.classList.toggle('card__audio--playing', playing)
  const at = audio?.currentTime ?? 0
  const duration = audio?.duration ?? Number.NaN
  const fill = player.querySelector<HTMLElement>('.card__audio-fill')
  if (fill !== null) fill.style.width = Number.isFinite(duration) && duration > 0 ? `${Math.min(100, (at / duration) * 100)}%` : '0%'
  const time = player.querySelector<HTMLElement>('.card__audio-time')
  if (time !== null) time.textContent = Number.isFinite(duration) ? `${clock(at)} / ${clock(duration)}` : clock(at)
}

/** The sound of `url`, made at its first play; the one before it stops. */
function soundFor(player: HTMLElement): HTMLAudioElement {
  const url = player.getAttribute(CARD_AUDIO_ATTR) ?? ''
  if (current !== null && current.url === url) {
    current.player = player
    return current.audio
  }
  stopCardAudio()
  const audio = new Audio(url)
  audio.preload = 'metadata'
  const repaint = () => current?.audio === audio && paint(current.player, audio)
  for (const type of ['play', 'pause', 'timeupdate', 'loadedmetadata', 'durationchange', 'ended', 'seeked']) audio.addEventListener(type, repaint)
  audio.addEventListener('error', () => {
    if (current?.audio !== audio) return
    current.player.classList.add('card__audio--broken')
    stopCardAudio()
  })
  current = { url, audio, player }
  return audio
}

/** Play or pause the sound of `player`. */
function toggle(player: HTMLElement): void {
  const audio = soundFor(player)
  if (audio.paused) {
    try {
      void Promise.resolve(audio.play()).catch(() => undefined)
    } catch {
      // No sound here (a test's DOM): the player stays stopped.
    }
  } else audio.pause()
  paint(player, audio)
}

/** Stop the window's sound, back to its start (the Inbox's next card, an answer, a hidden Inbox). */
export function stopCardAudio(): void {
  const was = current
  if (was === null) return
  current = null
  was.audio.pause()
  was.audio.removeAttribute('src')
  was.audio.load()
  paint(was.player, null)
}

/** The Inbox's P: play or stop the first sound in `root`. False when it has none. */
export function toggleCardAudio(root: ParentNode | null): boolean {
  const player = root?.querySelector<HTMLElement>(`.card__audio[${CARD_AUDIO_ATTR}]`) ?? null
  if (player === null) return false
  const url = player.getAttribute(CARD_AUDIO_ATTR)
  if (current !== null && current.url === url && !current.audio.paused) stopCardAudio()
  else toggle(player)
  return true
}

/** Is a sound playing now (a test)? */
export const cardAudioPlaying = (): boolean => current !== null && !current.audio.paused

/** The one-line player for the sound at `url` (its file name `name`). */
export function audioPlayer(url: string, name: string): HTMLElement {
  const player = document.createElement('span')
  player.className = 'card__audio'
  player.setAttribute(CARD_AUDIO_ATTR, url)
  player.setAttribute('role', 'group')
  player.setAttribute('aria-label', `Sound: ${name}`)
  player.contentEditable = 'false'
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'card__audio-play'
  const label = document.createElement('span')
  label.className = 'card__audio-name'
  label.textContent = name
  const bar = document.createElement('span')
  bar.className = 'card__audio-bar'
  const fill = document.createElement('span')
  fill.className = 'card__audio-fill'
  bar.append(fill)
  const time = document.createElement('span')
  time.className = 'card__audio-time'
  player.append(button, label, bar, time)
  // A press is the player's: no caret, no card selection, no Inbox step (the hosts skip `CARD_MEDIA`).
  player.addEventListener('mousedown', (event) => event.preventDefault())
  button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    toggle(player)
  })
  bar.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    const audio = soundFor(player)
    const box = bar.getBoundingClientRect()
    const at = box.width > 0 ? Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)) : 0
    const seek = () => {
      if (Number.isFinite(audio.duration)) audio.currentTime = at * audio.duration
    }
    if (Number.isFinite(audio.duration)) seek()
    else audio.addEventListener('loadedmetadata', seek, { once: true })
  })
  player.addEventListener('click', (event) => event.stopPropagation())
  // A card drawn again while its sound plays: this player shows it.
  if (current !== null && current.url === url) current.player = player
  paint(player, current?.url === url ? current.audio : null)
  return player
}

// ── The board picture ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The still picture of a board (YAZ-5161: given by the host, so the card drawing reads no bridge and no settings):
 * the picture's URL, `''` for an empty board, null for a picture that cannot be made. It REJECTS when the board is gone,
 * and the card shows the unresolved pill. The desktop's is `desktopBoardPicture` (`boardPictureDesktop.ts`).
 */
export type BoardPictureLoad = (root: string, path: string) => Promise<string | null>

/** Where a board embed's file is, and how its picture loads; null when it does not resolve. */
export type CardBoardLook = (inner: string) => { root: string; path: string; picture: BoardPictureLoad } | null

const waiting = new WeakMap<Element, () => void>()
let observer: IntersectionObserver | null = null

/** Run `load` once `el` comes near the screen (at once without an IntersectionObserver). */
function whenNear(el: Element, load: () => void): void {
  if (typeof IntersectionObserver !== 'function') {
    queueMicrotask(load)
    return
  }
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        observer?.unobserve(entry.target)
        const run = waiting.get(entry.target)
        waiting.delete(entry.target)
        run?.()
      }
    },
    { rootMargin: '300px 0px' },
  )
  waiting.set(el, load)
  observer.observe(el)
}

/** The unresolved pill of `inner`, as a link that does not resolve (`refreshCardLook` gives it the look). */
export function missingBoard(inner: string): HTMLElement {
  const pill = document.createElement('span')
  pill.className = 'wikilink wikilink--unresolved'
  pill.setAttribute('data-card-link', inner)
  pill.textContent = targetOf(inner)
  return pill
}

/** The still picture of the board `inner` (at `root`, `path`): loaded by `picture` when it comes near the screen. */
export function boardPicture(inner: string, root: string, path: string, picture: BoardPictureLoad): HTMLElement {
  const box = document.createElement('span')
  box.className = 'card__board'
  box.setAttribute(CARD_BOARD_ATTR, inner)
  box.setAttribute('role', 'link')
  box.setAttribute('aria-label', `Open ${nameOf(inner)}`)
  box.contentEditable = 'false'
  const img = document.createElement('img')
  img.className = 'card__board-img'
  img.alt = ''
  img.setAttribute('loading', 'lazy')
  img.draggable = false
  const name = document.createElement('span')
  name.className = 'card__board-name'
  name.textContent = nameOf(inner)
  box.append(img, name)
  whenNear(box, () => {
    const abs = path.startsWith('/') ? path : `${root.replace(/\/+$/, '')}/${path}`
    void Promise.resolve()
      .then(() => picture(root, abs))
      .then(
        (url) => {
          if (url) img.src = url
          else box.classList.add(url === '' ? 'card__board--empty' : 'card__board--broken')
        },
        () => box.replaceWith(missingBoard(inner)),
      )
      .catch(() => box.classList.add('card__board--broken'))
  })
  return box
}
