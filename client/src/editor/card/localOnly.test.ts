// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { renderCard } from './cardRender'
import { cardSafety, onlyLocalMedia } from './cardSafety'

/**
 * YAZ-5209: the phone draws a card with "local media only" (`onlyLocalMedia`, set by the phone app). The Mac does not
 * set it, and draws as before: a web picture in a card loads (the desktop renderer has no CSP for pictures).
 */
const WEB = 'https://example.com/pic.png'
afterEach(() => {
  cardSafety.local = false
})

describe('a card and the web (YAZ-5209)', () => {
  it('the Mac (default): a web picture keeps its address, as today', () => {
    const el = renderCard(`![a](${WEB}) <img src="${WEB}">`)
    expect([...el.querySelectorAll('img')].map((i) => i.getAttribute('src'))).toEqual([WEB, WEB])
  })

  it('the phone: no web address stays; the picture is a link to tap; a vault picture still gets its look', () => {
    onlyLocalMedia()
    const el = renderCard(`![a](${WEB}) <span style="background:url(${WEB})">s</span>\n\n![b](pic.png)`, {}, { image: (src) => `data:text/plain,vault:${src}` })
    expect(el.querySelector('[style]')).toBeNull()
    expect(el.querySelector<HTMLAnchorElement>('a.page-media--web')?.href).toBe(WEB)
    expect([...el.querySelectorAll('img')].map((i) => i.getAttribute('src'))).toEqual(['data:text/plain,vault:pic.png'])
  })
})
