// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { renderCard } from './cardRender'
import { cardSafety, onlyLocalMedia } from './cardSafety'
import { urlOf } from './localOnly'

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
    // YAZ-5242: an address that is not the app's own bytes is never set as `src`; the phone's card reads the mark.
    expect([...el.querySelectorAll('img')].map((i) => [i.getAttribute('src'), i.getAttribute('data-card-src')])).toEqual([[null, 'data:text/plain,vault:pic.png']])
  })
})

describe('urlOf: a URL as the browser reads it (YAZ-5242)', () => {
  const BASE = 'https://app.example/vault/page'
  const kind = (v: string) => urlOf(v, BASE).kind
  it.each([
    ['pic.png', 'path'],
    ['assets/my%20pic.png', 'path'],
    ['/assets/pic.png', 'path'],
    ['../pic.png', 'path'],
    ['#fn-1', 'path'],
    ['https://evil.example/a', 'web'],
    ['HTTPS://EVIL.EXAMPLE/a', 'web'],
    ['hTtPs://evil.example/a', 'web'],
    ['ht\ntps://evil.example/a', 'web'],
    ['ht\ttps://evil.example/a', 'web'],
    ['ht\rtps://evil.example/a', 'web'],
    ['  \u0001https://evil.example/a  ', 'web'],
    ['//evil.example/a', 'web'],
    ['\\\\evil.example\\a', 'web'],
    ['/\\evil.example/a', 'web'],
    ['\\/evil.example/a', 'web'],
    ['https:\\\\evil.example\\a', 'web'],
    ['http:evil.example/a', 'web'],
    ['https://app.example/x', 'none'],
    ['javascript:alert(1)', 'none'],
    ['java\nscript:alert(1)', 'none'],
    ['JaVaScRiPt:alert(1)', 'none'],
    ['  javascript:alert(1)', 'none'],
    ['data:text/html,<b>x</b>', 'none'],
    ['data:image/svg+xml,<svg/>', 'own'],
    ['data:image/png;base64,iVBORw0KGgo=', 'own'],
    ['blob:https://app.example/1234', 'own'],
    ['blob:https://evil.example/1234', 'none'],
    ['file:///etc/passwd', 'none'],
    ['mailto:a@b.example', 'mail'],
    ['vbscript:x', 'none'],
    ['', 'none'],
  ])('%j is %s', (value, expected) => {
    expect(kind(value)).toBe(expected)
  })

  it('an entity in the HTML (`&#10;`, `&#9;`, `&#104;`) is read as its character first: the allow list sees through it', () => {
    onlyLocalMedia()
    for (const html of ['<img src="ht&#10;tps://evil.example/a">', '<img src="ht&#9;tps://evil.example/a">', '<img src="&#104;ttps://evil.example/a">', '<a href="java&#10;script:alert(1)">x</a>']) {
      const el = renderCard(html)
      expect([...el.querySelectorAll('*')].flatMap((e) => [...e.attributes].map((a) => a.value)).filter((v) => /evil|script/i.test(v) && !/^https:\/\/evil\.example\/a$/.test(v))).toEqual([])
      expect(el.querySelector('img')).toBeNull()
    }
  })
})
