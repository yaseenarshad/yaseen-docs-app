// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://app.example/"}
import { describe, expect, it } from 'vitest'
import { guardLink } from './safeLinks'

/** YAZ-5243: a tap on a link never takes the app's own window to another host. */
function tap(html: string) {
  const box = document.createElement('div')
  box.innerHTML = html
  const opened: string[] = []
  let prevented = false
  const took = guardLink({ target: box.querySelector('a')!, preventDefault: () => void (prevented = true) }, (url) => void opened.push(url))
  return { took, prevented, opened }
}

describe('a tap on a link (YAZ-5243)', () => {
  it.each([
    ['<a href="https://example.com/x" target="_blank">x</a>', ['https://example.com/x']],
    ['<a href="ht\ntps://evil.example/x">x</a>', ['https://evil.example/x']],
    ['<a href="\\\\evil.example\\x">x</a>', ['https://evil.example/x']],
    ['<a href="mailto:a@b.example">m</a>', ['mailto:a@b.example']],
    ['<a href="javascript:alert(1)">j</a>', []],
    ['<a href="data:text/html,x">d</a>', []],
    ['<a href="https://app.example/other">own</a>', []],
    ['<a href="page.md">vault path, not opened by the app</a>', []],
  ])('%s: the app window stays; Safari opens %j', (html, opened) => {
    const t = tap(html)
    expect(t).toEqual({ took: true, prevented: true, opened })
  })

  it('a #part scrolls the page itself', () => {
    expect(tap('<a href="#fn-1">1</a>')).toEqual({ took: false, prevented: false, opened: [] })
  })
})
