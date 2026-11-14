// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { audit, type Finding, type Theme } from './cssAudit'

/**
 * The parts of the contrast engine, each with a known answer (YAZ-5341: a part that breaks must turn a test red):
 * `opacity`, `color-mix()`, `var()`, `currentColor`, a fill from an ancestor or another rule, the dark theme, the
 * placeholder, the field border, the cascade (specificity, then order).
 */
afterEach(() => void document.body.replaceChildren())

const page = `:root { --bg: #ffffff; --fg: #000000; } @media (prefers-color-scheme: dark) { :root { --bg: #000000; --fg: #ffffff; } } body { background: var(--bg); color: var(--fg); }`
function run(html: string, css: string, theme: Theme = 'light'): Finding[] {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.append(host)
  return audit(host, [{ file: 'test.css', css: page + css }], { theme }).findings
}
const one = (fs: Finding[], text: string) => fs.find((f) => f.text === text)!

describe('the contrast engine', () => {
  it('opacity of an ancestor fades the text into what is under it: black at 50% on white is #808080, 3.98:1', () => {
    expect(one(run('<div class="p"><span>faded</span></div>', '.p { opacity: 0.5; }'), 'faded')).toMatchObject({ fg: '#808080', bg: '#ffffff', ratio: 3.98 })
  })

  it('color-mix() is resolved: black and white 50/50 is #808080', () => {
    expect(one(run('<span class="t">mixed</span>', '.t { color: color-mix(in srgb, #000000 50%, #ffffff); }'), 'mixed')).toMatchObject({ fg: '#808080', ratio: 3.98 })
  })

  it('a fill that ANOTHER rule sets on an ancestor (YAZ-5338): the text is checked on it, with its alpha', () => {
    const f = one(run('<span class="mark"><span class="word">Paris</span></span>', '.mark { background: rgba(0, 0, 0, 0.5); } .word { color: #777777; }'), 'Paris')
    expect(f).toMatchObject({ fg: '#777777', bg: '#808080' })
    expect(f.ratio).toBeLessThan(2)
  })

  it('var() and currentColor', () => {
    expect(one(run('<span class="t">token</span>', ':root { --ink: #595959; } .t { color: var(--ink); border-color: currentColor; }'), 'token')).toMatchObject({ fg: '#595959', ratio: 7 })
  })

  it('the dark theme: the dark tokens and the dark-only rules', () => {
    const light = one(run('<span class="t">dim</span>', '@media (prefers-color-scheme: dark) { .t { color: #333333; } }', 'light'), 'dim')
    const dark = one(run('<span class="t">dim</span>', '@media (prefers-color-scheme: dark) { .t { color: #333333; } }', 'dark'), 'dim')
    expect(light).toMatchObject({ fg: '#000000', bg: '#ffffff' })
    expect(dark).toMatchObject({ fg: '#333333', bg: '#000000', ratio: 1.66 })
  })

  it('a placeholder: the phone\'s own colour, or the browser\'s grey (a fail) when the phone sets none', () => {
    expect(one(run('<input placeholder="type">', 'input::placeholder { color: #595959; }'), 'type')).toMatchObject({ what: 'placeholder', ratio: 7 })
    expect(one(run('<input placeholder="type">', ''), 'type').ratio).toBeLessThan(4.5)
  })

  it('a field border is checked on what is outside the field (3:1)', () => {
    const f = run('<input class="f" value="x">', '.f { border: 1px solid #e4e4e7; background: #000000; }').find((x) => x.what === 'field border')!
    expect(f).toMatchObject({ bg: '#ffffff', need: 3, ratio: 1.27 })
  })

  it('the cascade: the more specific rule wins, then the later one; hidden text is not checked', () => {
    const fs = run('<p class="a b">won</p><p hidden class="a">gone</p><p class="sr" >sr</p>', '.a.b { color: #595959; } .a { color: #ffffff; } p.a { color: #eeeeee; } .sr { clip: rect(0 0 0 0); }')
    expect(one(fs, 'won')).toMatchObject({ fg: '#595959' })
    expect(fs.map((f) => f.text)).not.toContain('gone')
    expect(fs.map((f) => f.text)).not.toContain('sr')
  })
})
