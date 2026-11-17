/**
 * Mochi's progress bar (YAZ-5676), read as text (jsdom lays nothing out): YAZ-5671 finding 14's measured values, for
 * the Mac's Inbox and the phone's Review (one file, `sessionCount.css`). Option B's steps (YAZ-5660) are gone.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => readFileSync(path.join(__dirname, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const css = read('sessionCount.css')

/** The declarations of the rule whose selector list is exactly `selector`, inside `within` (default: the whole file). */
function decls(selector: string, within = css): Record<string, string> {
  const rule = [...within.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((m) => m[1]!.replace(/\s+/g, ' ').trim() === selector)
  if (rule === undefined) throw new Error(`no rule ${selector}`)
  return Object.fromEntries(
    rule[2]!
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()]),
  )
}

describe('YAZ-5676: the progress bar is Mochi`s exactly (YAZ-5671 finding 14)', () => {
  it('the track: 6 px tall, 3 px corners, rgba(51,51,51,0.10); two fills from the left edge, red under grey', () => {
    const bar = decls('.session-bar')
    expect(bar).toMatchObject({ height: '6px', 'border-radius': '3px', background: 'var(--session-track)', position: 'relative' })
    expect(bar).toMatchObject({ '--session-track': 'rgba(51, 51, 51, 0.1)', '--session-red': 'rgb(209, 179, 173)', '--session-grey': 'rgb(200, 200, 200)' })
    expect(decls('.session-bar__red, .session-bar__grey')).toMatchObject({ position: 'absolute', left: '0', 'border-radius': '3px', transition: 'width 0.2s cubic-bezier(0.36, 0.66, 0.04, 1)' })
    expect(decls('.session-bar__red')).toEqual({ background: 'var(--session-red)' })
    expect(decls('.session-bar__grey')).toEqual({ background: 'var(--session-grey)' })
  })

  it('dark (the Mac`s data-theme, the phone`s data-scheme): the same idea, colours of its own', () => {
    expect(decls(":root:is([data-theme='dark'], [data-scheme='dark']) .session-bar")).toEqual({ '--session-track': 'rgba(255, 255, 255, 0.1)', '--session-red': 'rgb(122, 78, 72)', '--session-grey': 'rgb(110, 110, 110)' })
  })

  it('Reduce motion: no transition', () => {
    const reduced = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?\})\s*\}/.exec(css)![1]!
    expect(decls('.session-bar__red, .session-bar__grey', reduced)).toEqual({ transition: 'none' })
  })

  it('option B is gone: no step, slide or part rules in the Mac`s or the phone`s CSS', () => {
    const mac = read('cardScreens.css')
    const phone = read('../../../mobile/src/review/review.css')
    for (const sheet of [mac, phone]) expect(sheet).not.toMatch(/progress-part|review__step|data-slide|--moved|review-step-slide/)
  })

  it('YAZ-5680 check 4: the Mac`s "Added card to reviews" note sits above the key row at the bottom (16 px band + the row), never over it; it stays on the finish screen, as Mochi`s (finding 12)', () => {
    const mac = read('cardScreens.css')
    const note = decls('.card-inbox > .learned-note', mac)
    expect(note.position).toBe('fixed')
    expect(parseFloat(note.bottom ?? '0')).toBeGreaterThanOrEqual(56)
  })
})
