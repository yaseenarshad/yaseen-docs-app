/**
 * The tour's targets and events against the app's code (YAZ-5123). jsdom cannot open the whole app, so the test reads
 * the source: each `target` of each `tryIt` in the script needs a `data-tour` mark on a real control, and each mark in
 * the code is a target of the script. Each event a step waits for is one the bus knows, and a real component fires it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { COURSE } from './script'
import { TARGET_HELP } from './tourHelp'
import { TOUR_EVENTS } from './tourBus'
import { SETTINGS_SECTIONS } from '../settings/registry'

const SRC = resolve(__dirname, '..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(tsx?)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}
const files = sourceFiles(SRC).map((path) => ({ path: relative(SRC, path), text: readFileSync(path, 'utf8') }))

/** Every `data-tour` name the code can put on an element: JSX, `dataset.tour`, a menu row's `tour`, and a `tour` prop. */
function marksInCode(): Map<string, string[]> {
  const marks = new Map<string, string[]>()
  const add = (name: string, file: string) => marks.set(name, [...(marks.get(name) ?? []), file])
  const names = (chunk: string) => [...chunk.matchAll(/['"]([a-z0-9]+(?:-[a-z0-9]+)+)['"]/g)].map((m) => m[1])
  for (const { path, text } of files) {
    if (path.startsWith('course/')) continue
    for (const m of text.matchAll(/data-tour=("[^"]*"|\{[^}]*\})/g)) names(m[1]).forEach((n) => add(n, path))
    for (const m of text.matchAll(/dataset\.tour = (['"][^'"]+['"])/g)) names(m[1]).forEach((n) => add(n, path))
    for (const m of text.matchAll(/\btour: ([^,}\n]+)/g)) names(m[1]).forEach((n) => add(n, path))
    // A component that puts its `tour` prop on its element as `data-tour` (the Inbox's card face, `InboxCardFace`).
    for (const m of text.matchAll(/\stour=("[^"]*")/g)) names(m[1]).forEach((n) => add(n, path))
  }
  // The Settings row "Open the course" is a course file in the startup bundle.
  const settingsRow = files.find((f) => f.path === 'course/courseSettings.tsx')!
  for (const m of settingsRow.text.matchAll(/data-tour=("[^"]*")/g)) names(m[1]).forEach((n) => add(n, settingsRow.path))
  return marks
}

const steps = COURSE.flatMap((ch) => (ch.tryIt ?? []).map((step, i) => ({ chapter: ch.id, n: i + 1, step })))
const targets = new Set(steps.map((s) => s.step.target))

describe("the tour's targets are real controls (YAZ-5123)", () => {
  const marks = marksInCode()

  it('the script has tours, and their target names are kebab case', () => {
    expect(steps.length).toBeGreaterThan(20)
    for (const t of targets) expect(t).toMatch(/^[a-z0-9]+(-[a-z0-9]+)+$/)
  })

  it('each target of the script has a data-tour mark in the code', () => {
    expect([...targets].filter((t) => !marks.has(t))).toEqual([])
  })

  it('each data-tour mark in the code is a target of the script', () => {
    expect([...marks.keys()].filter((m) => !targets.has(m))).toEqual([])
  })

  it('each target has its help: where to look, and where Show me goes', () => {
    expect([...targets].filter((t) => TARGET_HELP[t] === undefined)).toEqual([])
    expect(Object.keys(TARGET_HELP).filter((t) => !targets.has(t))).toEqual([])
  })
})

describe("the tour's events are real moments (YAZ-5123)", () => {
  const events = new Set(steps.flatMap((s) => (s.step.done === 'click' ? [] : [s.step.done.event])))

  it('each event a step waits for is one the bus knows, and each the bus knows is used', () => {
    expect([...events].filter((e) => !(TOUR_EVENTS as readonly string[]).includes(e))).toEqual([])
    expect(TOUR_EVENTS.filter((e) => !events.has(e))).toEqual([])
  })

  it("a real component fires each app event (the coach card's Next is tour-next)", () => {
    const fired = new Set(files.filter((f) => !f.path.startsWith('course/')).flatMap((f) => [...f.text.matchAll(/tourEvent\('([a-z-]+)'/g)].map((m) => m[1])))
    expect(TOUR_EVENTS.filter((e) => e !== 'tour-next' && !fired.has(e))).toEqual([])
  })
})

/**
 * YAZ-5271: the course names only the Settings sections the app has. The demo branch renamed Settings › Review to
 * Settings › Cards (YAZ-5154). The owner approved the new words of `c12-07` and chapter 12's tour step, and `c12-07`
 * has its new take (YAZ-5122), so every line must name a section the app has.
 */
describe('the course names the Settings sections the app has (YAZ-5271)', () => {
  const sections = new Set(SETTINGS_SECTIONS.map((s) => s.title))
  /** Each section a line names: "Settings, under <Name>", "Settings › <Name>", "click <Name>" (the tour's Settings step). */
  const named = (line: string): string[] => [
    ...[...line.matchAll(/Settings(?:,| ›) (?:under )?([A-Z]\w*(?: & [A-Z]\w*)?)/g)].map((m) => m[1]),
    ...(/Settings/.test(line) ? [...line.matchAll(/click ([A-Z]\w*(?: & [A-Z]\w*)?)/g)].map((m) => m[1]) : []),
  ]

  it('the tour`s help lines name real sections', () => {
    const lines = Object.values(TARGET_HELP).flatMap((h) => [h.where, ...(h.stuck === undefined ? [] : [h.stuck.say])])
    expect(lines.flatMap(named).filter((n) => !sections.has(n))).toEqual([])
    expect(lines.filter((l) => /Settings/.test(l)).length).toBeGreaterThan(0)
  })

  it('the clips and the tour`s steps name real sections', () => {
    const clips = COURSE.flatMap((ch) => ch.clips)
    const tour = COURSE.flatMap((ch) => (ch.tryIt ?? []).map((s) => s.say))
    expect([...clips.map((c) => c.text), ...tour].flatMap(named).filter((n) => !sections.has(n))).toEqual([])
    // c12-07 and chapter 12's Settings step name Cards (both checked above, so neither can fall back to "Review").
    expect(named(clips.find((c) => c.id === 'c12-07')!.text)).toEqual(['Cards'])
  })

  it('chapter 12`s drawn Settings lists and lights the section the app has', () => {
    const scene = readFileSync(resolve(__dirname, 'scenes/whereThingsAre.tsx'), 'utf8')
    const nav = JSON.parse(/const NAV = (\[[^\]]*\])/.exec(scene)![1].replace(/'/g, '"')) as string[]
    expect(nav.filter((n) => !sections.has(n))).toEqual([])
    expect(/<p className="later-settings__title">([^<]+)<\/p>/.exec(scene)?.[1]).toBe('Cards')
    expect(/n === '([^']+)' && since\(b, review/.exec(scene)?.[1] ?? /n === '([^']+)'/.exec(scene)?.[1]).toBe('Cards')
  })
})
