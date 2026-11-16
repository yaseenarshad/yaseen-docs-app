/**
 * Sound and boards in a card (YAZ-5014, YAZ-5015), through the one render (`renderCard`): an mp3 is the
 * one-line player, built after the sanitiser, that plays only when asked and one at a time; a board embed is a still
 * picture that loads only when it comes near the screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderCard, type CardLook } from './cardRender'
import { cardAudioPlaying, stopCardAudio, textHasAudio, toggleCardAudio } from './cardMedia'
import { desktopBoardPicture } from './boardPictureDesktop'

const boardHead = vi.hoisted(() => vi.fn(async (path: string) => ({ mtime: path.includes('Gone') ? Promise.reject(new Error('x')) : 7 })))
vi.mock('../../api', () => ({ api: { boardHead: (path: string) => boardHead(path) } }))
const load = vi.hoisted(() => vi.fn(async (_key: string) => 'data:image/png;base64,AAAA'))
vi.mock('../../sidebar/boardPreviewCache', () => ({ boardPreviews: { load: (key: string) => load(key) }, boardPreviewKey: (root: string, node: { path: string; mtime: number }) => `${root}|${node.path}|${node.mtime}` }))

/** jsdom has no media engine: `play` and `pause` move `paused`, and each element made is kept. */
const made: HTMLAudioElement[] = []
beforeEach(() => {
  made.length = 0
  boardHead.mockClear()
  load.mockClear()
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
    Object.defineProperty(this, 'paused', { value: false, configurable: true })
    this.dispatchEvent(new Event('play'))
    return Promise.resolve()
  })
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
    Object.defineProperty(this, 'paused', { value: true, configurable: true })
    this.dispatchEvent(new Event('pause'))
  })
  const RealAudio = window.Audio
  vi.stubGlobal(
    'Audio',
    class extends RealAudio {
      constructor(src?: string) {
        super(src)
        made.push(this)
      }
    },
  )
})
afterEach(() => {
  stopCardAudio()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const look: CardLook = {
  image: (src) => `app://vault/%2Fv/${src}?from=`,
  link: (inner) => ({ label: inner, resolved: !inner.startsWith('Gone') }),
  // The desktop's picture (YAZ-5161: the host gives it): the board's head through the bridge, then the hover picture.
  board: (inner) => (inner.startsWith('Gone') ? null : { root: '/v', path: `/v/${inner.split('|')[0]}`, picture: desktopBoardPicture }),
}

describe('a sound in a card (YAZ-5014)', () => {
  it('`![](assets/audio/x.mp3)` and `![[x.mp3]]` are each the one-line player: play, the name, a bar, the time; the URL is the vault`s; no <audio> until a play', () => {
    const card = renderCard('Hear ![](assets/audio/tone.mp3)\n---\n![[voice.m4a]]', {}, look)
    const players = [...card.querySelectorAll<HTMLElement>('.card__audio')]
    expect(players.map((p) => p.getAttribute('data-card-audio'))).toEqual(['app://vault/%2Fv/assets/audio/tone.mp3?from=', 'app://vault/%2Fv/voice.m4a?from='])
    expect([...players[0].children].map((c) => c.className)).toEqual(['card__audio-play', 'card__audio-name', 'card__audio-bar', 'card__audio-time'])
    expect(players.map((p) => p.querySelector('.card__audio-name')?.textContent)).toEqual(['tone.mp3', 'voice.m4a'])
    expect(players[0].querySelector('.card__audio-time')?.textContent).toBe('0:00')
    // Not a broken picture, and nothing loads by itself.
    expect(card.querySelector('img')).toBeNull()
    expect(card.querySelector('audio')).toBeNull()
    expect(made).toHaveLength(0)
  })

  it('the player is built after DOMPurify: a script in the card`s text never survives, the button is the app`s', () => {
    const card = renderCard('<button onclick="x()">b</button><img src=x.mp3 onerror="alert(1)"> ![[t.mp3]]', {}, look)
    expect(card.querySelectorAll('.card__audio')).toHaveLength(2)
    expect(card.querySelectorAll('button')).toHaveLength(2)
    expect(card.innerHTML).not.toMatch(/onclick|onerror|alert/)
  })

  it('a click on play plays, again pauses; only one sound plays at a time', () => {
    const card = renderCard('![[a.mp3]] ![[b.mp3]]', {}, look)
    document.body.append(card)
    const [a, b] = [...card.querySelectorAll<HTMLButtonElement>('.card__audio-play')]
    a.click()
    expect([made.length, made[0].paused, a.getAttribute('aria-label')]).toEqual([1, false, 'Pause'])
    b.click()
    expect([made.length, made[0].paused, made[1].paused]).toEqual([2, true, false])
    expect(a.getAttribute('aria-label')).toBe('Play')
    b.click()
    expect(cardAudioPlaying()).toBe(false)
    card.remove()
  })

  it('P (`toggleCardAudio`) plays and stops the first sound; false in a card with none; `textHasAudio` reads both spellings', () => {
    const card = renderCard('![[a.mp3]]', {}, look)
    expect(toggleCardAudio(card)).toBe(true)
    expect(cardAudioPlaying()).toBe(true)
    toggleCardAudio(card)
    expect(cardAudioPlaying()).toBe(false)
    expect(toggleCardAudio(renderCard('No sound', {}, look))).toBe(false)
    expect([textHasAudio('![[x.mp3]]'), textHasAudio('![A tone](assets/audio/tone.ogg)'), textHasAudio('[[x.mp3]]'), textHasAudio('x.mp3')]).toEqual([true, true, false, false])
  })
})

describe('a board in a card (YAZ-5015)', () => {
  /** One stand-in observer: `near()` brings every watched element on screen. */
  let watched: Element[] = []
  let fire: (els: Element[]) => void = () => undefined
  beforeEach(() => {
    watched = []
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: (entries: Array<{ target: Element; isIntersecting: boolean }>) => void) {
          fire = (els) => cb(els.map((target) => ({ target, isIntersecting: true })))
        }
        observe(el: Element) {
          watched.push(el)
        }
        unobserve(el: Element) {
          watched = watched.filter((w) => w !== el)
        }
        disconnect() {}
      },
    )
  })
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

  it('`![[x.excalidraw]]` and `![[x.drawio]]` are an <img> that loads lazily: nothing is read until it comes near the screen, then the hover picture', async () => {
    const card = renderCard('![[Card loop.excalidraw]]\n---\n![[Card pipeline.drawio]]', {}, look)
    const boxes = [...card.querySelectorAll<HTMLElement>('.card__board')]
    expect(boxes.map((b) => [b.getAttribute('data-card-board'), b.querySelector('.card__board-name')?.textContent])).toEqual([
      ['Card loop.excalidraw', 'Card loop.excalidraw'],
      ['Card pipeline.drawio', 'Card pipeline.drawio'],
    ])
    const imgs = boxes.map((b) => b.querySelector('img')!)
    expect(imgs.map((i) => [i.getAttribute('loading'), i.hasAttribute('src')])).toEqual([
      ['lazy', false],
      ['lazy', false],
    ])
    await settle()
    expect(boardHead).not.toHaveBeenCalled()
    expect(watched).toEqual(boxes)
    fire([boxes[0]])
    await settle()
    await settle()
    expect(boardHead.mock.calls).toEqual([['/v/Card loop.excalidraw']])
    expect(load.mock.calls).toEqual([['/v|/v/Card loop.excalidraw|7']])
    expect(imgs[0].getAttribute('src')).toBe('data:image/png;base64,AAAA')
    // The second, still off the screen, has read nothing.
    expect(imgs[1].hasAttribute('src')).toBe(false)
  })

  it('a board that does not resolve is the unresolved link pill, as a missing link', () => {
    const card = renderCard('![[Gone.drawio]]', {}, look)
    expect(card.querySelector('.card__board')).toBeNull()
    const pill = card.querySelector('.wikilink')!
    expect([pill.classList.contains('wikilink--unresolved'), pill.getAttribute('data-card-link')]).toEqual([true, 'Gone.drawio'])
  })
})
