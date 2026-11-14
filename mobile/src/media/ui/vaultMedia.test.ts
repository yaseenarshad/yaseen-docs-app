// @vitest-environment jsdom
import { audioPlayer } from '@client/editor/card/cardMedia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { memoryBackend, openVaultStore } from '../../store'
import { fileType, lazyMedia, openFile, storedMedia, vaultMediaUrl, watchMedia, type FileShow, type VaultMedia } from './vaultMedia'

/**
 * YAZ-5079 follow-up: the pictures and sounds of a drawn page or card get their bytes from 3D's media (`show`) only when
 * they come into view, show the calm line with no signal, fill in when the signal returns, and stop their sound when
 * the view closes.
 */

/** A stand-in for IntersectionObserver: the test says what is in view. */
class FakeObserver {
  static all: FakeObserver[] = []
  seen = new Set<Element>()
  constructor(readonly callback: IntersectionObserverCallback) {
    FakeObserver.all.push(this)
  }
  observe(el: Element) {
    this.seen.add(el)
  }
  unobserve(el: Element) {
    this.seen.delete(el)
  }
  disconnect() {
    this.seen.clear()
  }
  /** `els` come into view. */
  show(els: Element[]) {
    this.callback(
      els.filter((el) => this.seen.has(el)).map((target) => ({ target, isIntersecting: true }) as IntersectionObserverEntry),
      this as unknown as IntersectionObserver,
    )
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0))
const settle = async () => {
  for (let i = 0; i < 5; i++) await tick()
}

/** A media whose files are on GitHub; `online` says if the network answers. */
function fakeMedia(stored: Set<string> = new Set()) {
  const media = {
    online: true,
    asked: [] as string[],
    async show(path: string): Promise<FileShow> {
      media.asked.push(path)
      if (stored.has(path) || media.online) return { status: 'ready', path, url: `blob:media/${path}`, type: fileType(path) }
      return { status: 'missing', path, why: 'offline' }
    },
  }
  return media
}

function pictures(n: number): HTMLElement {
  const root = document.createElement('div')
  for (let i = 0; i < n; i++) {
    const img = document.createElement('img')
    img.dataset.vaultSrc = `assets/p${i}.png`
    img.alt = `p${i}`
    root.append(img)
  }
  document.body.append(root)
  return root
}

beforeEach(() => {
  FakeObserver.all = []
  ;(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = FakeObserver
})
afterEach(() => {
  document.body.replaceChildren()
})

describe('pictures come when they are in view (YAZ-5079)', () => {
  it('a page with 200 pictures asks for none at first, then only for the ones that come into view', async () => {
    const root = pictures(200)
    const media = fakeMedia()
    const watch = watchMedia(root, media)
    await settle()
    expect(media.asked).toEqual([])
    const imgs = [...root.querySelectorAll('img')]
    FakeObserver.all[0].show(imgs.slice(0, 3))
    await settle()
    expect(media.asked).toEqual(['assets/p0.png', 'assets/p1.png', 'assets/p2.png'])
    expect(imgs.slice(0, 3).map((i) => i.getAttribute('src'))).toEqual(['blob:media/assets/p0.png', 'blob:media/assets/p1.png', 'blob:media/assets/p2.png'])
    expect(imgs[3].getAttribute('src')).toBeNull()
    // In view a second time: no second ask.
    FakeObserver.all[0].show(imgs.slice(0, 3))
    await settle()
    expect(media.asked).toHaveLength(3)
    watch.stop()
  })

  it('no signal: the calm line, the text still there; the signal returns: the picture fills in', async () => {
    const root = pictures(2)
    root.prepend('Words before.')
    const media = fakeMedia()
    media.online = false
    const watch = watchMedia(root, media)
    const imgs = [...root.querySelectorAll('img')]
    FakeObserver.all[0].show(imgs)
    await settle()
    expect([...root.querySelectorAll('.page-media--missing')].map((m) => m.textContent)).toEqual(['Picture · p0.png · Needs a connection', 'Picture · p1.png · Needs a connection'])
    expect(imgs.every((i) => i.hidden)).toBe(true)
    expect(root.textContent).toContain('Words before.')
    media.online = true
    window.dispatchEvent(new Event('online'))
    await settle()
    expect(root.querySelectorAll('.page-media--missing')).toHaveLength(0)
    expect(imgs.map((i) => [i.hidden, i.getAttribute('src')])).toEqual([
      [false, 'blob:media/assets/p0.png'],
      [false, 'blob:media/assets/p1.png'],
    ])
    watch.stop()
  })

  it('retry() (a pass ended) asks again for what was missing, and only that', async () => {
    const root = pictures(3)
    const media = fakeMedia(new Set(['assets/p0.png']))
    media.online = false
    const watch = watchMedia(root, media)
    FakeObserver.all[0].show([...root.querySelectorAll('img')])
    await settle()
    media.online = true
    media.asked = []
    watch.retry()
    await settle()
    expect(media.asked.sort()).toEqual(['assets/p1.png', 'assets/p2.png'])
    watch.stop()
  })

  it('pictures added later (an embedded card read after the page) are watched too', async () => {
    const root = pictures(0)
    const media = fakeMedia()
    const watch = watchMedia(root, media)
    const img = document.createElement('img')
    img.dataset.vaultSrc = 'assets/late.png'
    root.append(img)
    await settle()
    FakeObserver.all[0].show([img])
    await settle()
    expect(img.getAttribute('src')).toBe('blob:media/assets/late.png')
    watch.stop()
  })

  it('after stop(), an answer that comes late changes nothing', async () => {
    const root = pictures(1)
    let answer!: (s: FileShow) => void
    const media: VaultMedia = { show: () => new Promise((r) => (answer = r)) }
    const watch = watchMedia(root, media)
    const img = root.querySelector('img')!
    FakeObserver.all[0].show([img])
    watch.stop()
    answer({ status: 'ready', path: 'assets/p0.png', url: 'blob:late', type: 'image/png' })
    await settle()
    expect(img.getAttribute('src')).toBeNull()
  })
})

describe('a sound in a card (YAZ-5079)', () => {
  it("the card's player gets the sound's address when it is in view, and the sound stops when the view closes", async () => {
    const root = document.createElement('div')
    document.body.append(root)
    const player = audioPlayer(vaultMediaUrl('audio/hola.mp3'), 'hola.mp3')
    root.append(player)
    const media = fakeMedia()
    const watch = watchMedia(root, media)
    FakeObserver.all[0].show([player])
    await settle()
    expect(player.getAttribute('data-card-audio')).toBe('blob:media/audio/hola.mp3')
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async function (this: HTMLMediaElement) {
      Object.defineProperty(this, 'paused', { value: false, configurable: true })
    })
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
    player.querySelector<HTMLButtonElement>('.card__audio-play')!.click()
    expect(play).toHaveBeenCalledTimes(1)
    watch.stop()
    expect(pause).toHaveBeenCalled()
    play.mockRestore()
    pause.mockRestore()
  })

  it('a sound not on the phone with no signal: the calm line', async () => {
    const root = document.createElement('div')
    document.body.append(root)
    const player = audioPlayer(vaultMediaUrl('audio/hola.mp3'), 'hola.mp3')
    root.append(player)
    const media = fakeMedia()
    media.online = false
    const watch = watchMedia(root, media)
    FakeObserver.all[0].show([player])
    await settle()
    expect(root.querySelector('.page-media--missing')?.textContent).toBe('Sound · hola.mp3 · Needs a connection')
    watch.stop()
  })
})

describe('files and object URLs (YAZ-5079)', () => {
  it("a PDF opens in the iPhone's own viewer from its blob; another type says it can't open yet", async () => {
    const media = fakeMedia()
    const opened: string[] = []
    const open = (url: string) => (opened.push(url), true)
    expect(await openFile(media, 'docs/Guide.pdf', open)).toBeNull()
    expect(opened).toEqual(['blob:media/docs/Guide.pdf'])
    expect(await openFile(media, 'docs/data.zip', open)).toBe("data.zip · Can't open on the phone yet")
    media.online = false
    expect(await openFile(media, 'docs/Other.pdf', open)).toBe('File · Other.pdf · Needs a connection')
  })

  it('the store-only media revokes each URL it made: 500 pictures, 500 revoked', async () => {
    const made: string[] = []
    const revoked: string[] = []
    URL.createObjectURL = vi.fn(() => {
      made.push(`blob:${made.length}`)
      return made.at(-1)!
    })
    URL.revokeObjectURL = vi.fn((url: string) => void revoked.push(url))
    const store = await openVaultStore(memoryBackend())
    for (let i = 0; i < 500; i++) await store.write('v', `assets/p${i}.png`, new Uint8Array([i % 256]))
    const media = storedMedia(store, 'v')
    for (let i = 0; i < 500; i++) await media.show(`assets/p${i}.png`)
    // The same picture again: the same URL.
    await media.show('assets/p0.png')
    expect(made).toHaveLength(500)
    media.release()
    expect(revoked.sort()).toEqual([...made].sort())
  })
})

describe('3D, loaded with the engine (YAZ-5079)', () => {
  it('the media module loads only once the engine has loaded, ONE time; a show waits for it', async () => {
    let loaded!: (engine: unknown) => void
    const engine = new Promise((r) => (loaded = r))
    const made: unknown[] = []
    const ahead = { show: vi.fn(async (path: string): Promise<FileShow> => ({ status: 'ready', path, url: `blob:${path}`, type: 'image/png' })), showLink: vi.fn(), urlNow: vi.fn(() => 'blob:now'), stop: vi.fn() }
    const load = vi.fn(async () => ({
      createMediaAhead: (options: unknown) => {
        made.push(options)
        return ahead
      },
    }))
    const store = await openVaultStore(memoryBackend())
    const media = lazyMedia(() => engine as never, store, load as never)
    expect(media.urlNow?.('a.png')).toBeNull()
    const shown = media.show('a.png')
    await settle()
    expect(load).not.toHaveBeenCalled()
    loaded({ name: 'engine' })
    expect(await shown).toEqual({ status: 'ready', path: 'a.png', url: 'blob:a.png', type: 'image/png' })
    await media.show('b.png')
    expect(load).toHaveBeenCalledTimes(1)
    expect(made).toEqual([{ engine: { name: 'engine' }, store }])
    expect(media.urlNow?.('a.png')).toBe('blob:now')
  })
})
