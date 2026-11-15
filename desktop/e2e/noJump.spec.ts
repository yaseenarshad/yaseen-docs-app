/**
 * NOTHING JUMPS ON READ ⇄ EDIT (YAZ-5164 scope probe). Every switch path, in the real app: the text you look at, the
 * title and a card keep their place on screen (top, left, width), every frame, both ways. A probe: it records what moves
 * and by how many px (`NOJUMP_REPORT`), and asserts zero motion. `NJ_PROBE=1` only records (for a table); by default each path fails while anything moves.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { clickMenuItemQuietly, appWindow, buildFixtureVault, copyVault, fileRow, launchApp, layer, seededState } from './helpers'

test.describe.configure({ mode: 'serial' })
test.setTimeout(90_000)

const MARK = (n: number) => `nojump-line-${String(n).padStart(2, '0')} lorem ipsum dolor sit amet, the quick brown fox jumps over the lazy dog`
const CARD = '```card\nnojump-card-question what is the capital of France?\n---\nParis\n```\n<!-- card: WIKI-9, title "Capital of France" -->\n'
const lines = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => MARK(from + i)).join('\n\n')
const PAGE = `---\nstatus: draft\n---\n${lines(1, 30)}\n\n${CARD}\n${lines(31, 60)}\n`
const LOCKED = `---\nstatus: draft\nreadonly: true\n---\n${lines(1, 30)}\n\n${CARD}\n${lines(31, 60)}\n`
const CARD_FILE = `---\nkind: card\n---\n\`\`\`card\nnojump-cardfile-q\n\n${lines(61, 75)}\n---\nAnswer\n\`\`\`\n<!-- card: WIKI-11, title "Long card file" -->\n`

let userData: string
let vaultSrc: string
let vault: string
let app: ElectronApplication
let win: Page
const report: Record<string, unknown> = {}

/** Samples, every frame for `ms`, the box of the visible element whose text starts with `text` and the head/page title. */
async function sample(w: Page, text: string, act: () => Promise<void>, ms = 1500, card = false) {
  await w.evaluate(
    ({ text, ms, card }) => {
      const pick = (): Element | null => {
        const ex = Array.from(document.querySelectorAll('.explore:not([hidden])')).at(-1)
        const all = Array.from((ex ?? document).querySelectorAll(card ? '.card' : 'p, .cm-line, li')).filter((el) => {
          if (card ? !(el.textContent ?? '').includes(text) : !(el.textContent ?? '').trim().startsWith(text)) return false
          if (el.closest('.explore__body--incoming, .tabstack__layer--hidden, [hidden]') !== null) return false
          const r = el.getBoundingClientRect()
          if (r.width === 0 || r.height === 0) return false
          let at: Element | null = el
          while (at !== null) {
            const s = getComputedStyle(at)
            if (s.opacity === '0' || s.visibility === 'hidden') return false
            at = at.parentElement
          }
          return true
        })
        if (card) return all.filter((el) => el.querySelector('.card') === null).at(-1) ?? null
        return all.at(-1) ?? null
      }
      const titleBox = (): DOMRect | null => {
        const ex = Array.from(document.querySelectorAll('.explore:not([hidden])')).at(-1)
        const t = Array.from((ex ?? document).querySelectorAll('.page-title__text, .page-title__input, .explore__title')).filter((el) => el.closest('.explore__body--incoming, .tabstack__layer--hidden, .card') === null && el.getBoundingClientRect().height > 0)
        return t.at(-1)?.getBoundingClientRect() ?? null
      }
      const out: Array<{ t: number; top: number | null; left: number | null; width: number | null; title: number | null; titleKind: string | null }> = []
      const start = performance.now()
      ;(window as unknown as { __nojump: unknown }).__nojump = out
      const tick = () => {
        const el = pick()
        const r = el?.getBoundingClientRect()
        const tEl = Array.from((Array.from(document.querySelectorAll('.explore:not([hidden])')).at(-1) ?? document).querySelectorAll('.page-title__text, .page-title__input, .explore__title')).filter((e) => e.closest('.explore__body--incoming, .tabstack__layer--hidden, .card') === null && e.getBoundingClientRect().height > 0).at(-1)
        out.push({ t: Math.round(performance.now() - start), top: r ? Math.round(r.top) : null, left: r ? Math.round(r.left) : null, width: r ? Math.round(r.width) : null, title: titleBox() ? Math.round(titleBox()!.top) : null, titleKind: tEl?.className.split(' ')[0] ?? null })
        if (performance.now() - start < ms) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    },
    { text, ms, card },
  )
  await w.waitForTimeout(80)
  await act()
  await w.waitForTimeout(ms + 200)
  const frames = (await w.evaluate(() => (window as unknown as { __nojump: unknown }).__nojump)) as Array<{ t: number; top: number | null; left: number | null; width: number | null; title: number | null; titleKind: string | null }>
  const first = frames.find((f) => f.top !== null)!
  const last = Array.from(frames).reverse().find((f) => f.top !== null)!
  const dev = (k: 'top' | 'left' | 'width') => Math.max(...frames.filter((f) => f[k] !== null).map((f) => Math.abs((f[k] as number) - (first[k] as number))))
  const missing = frames.filter((f) => f.top === null).length
  return {
    before: first,
    after: last,
    endShift: { top: (last.top ?? 0) - (first.top ?? 0), left: (last.left ?? 0) - (first.left ?? 0), width: (last.width ?? 0) - (first.width ?? 0) },
    maxShift: { top: dev('top'), left: dev('left'), width: dev('width') },
    titleBefore: frames[0].title,
    titleAfter: frames.at(-1)!.title,
    titleKinds: [frames[0].titleKind, frames.at(-1)!.titleKind],
    framesWithoutTarget: missing,
  }
}

const scroller = (w: Page, sel: string) => w.locator(sel).last()
async function scrollTo(w: Page, _sel: string, text: string, offset = 120): Promise<void> {
  await w.evaluate(
    ({ text, offset }) => {
      const ok = (e: Element) => e.closest('.explore__body--incoming, .tabstack__layer--hidden, [hidden]') === null && e.getBoundingClientRect().height > 0
      const el = Array.from((Array.from(document.querySelectorAll('.explore:not([hidden])')).at(-1) ?? document).querySelectorAll('p')).filter(ok).filter((p) => (p.textContent ?? '').startsWith(text)).at(-1)!
      let sc: Element | null = el.parentElement
      for (; sc; sc = sc.parentElement) { const o = getComputedStyle(sc).overflowY; if ((o === 'auto' || o === 'scroll') && sc.scrollHeight > sc.clientHeight) break }
      sc!.scrollTop += el.getBoundingClientRect().top - sc!.getBoundingClientRect().top - offset
    },
    { text, offset },
  )
  await win.waitForTimeout(300)
}

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'nojump-userdata-'))
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
  await writeFile(path.join(vault, 'Long page.md'), PAGE)
  await writeFile(path.join(vault, 'Locked long page.md'), LOCKED)
  await writeFile(path.join(vault, 'long-card-file-wiki-11.md'), CARD_FILE)
  await writeFile(path.join(vault, 'Embeds.md'), `${lines(76, 80)}\n\n![[WIKI-9]]\n\n${lines(81, 100)}\n`)
  await mkdir(path.join(vault, '.yaseendocs'), { recursive: true })
  await writeFile(path.join(vault, '.yaseendocs', 'review.json'), JSON.stringify({ enabled: true }))
  await writeFile(path.join(vault, '.yaseendocs', 'ids.json'), JSON.stringify({ enabled: true, letters: 'WIKI' }))
})

test.afterAll(async () => {
  for (const [k, v] of Object.entries(report)) { const r = v as Awaited<ReturnType<typeof sample>>; console.log(`NJ ${k} before=${JSON.stringify(r.before)} end=${JSON.stringify(r.endShift)} max=${JSON.stringify(r.maxShift)} title=${r.titleBefore}->${r.titleAfter} ${r.titleKinds.join('->')} missing=${r.framesWithoutTarget}`) }
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vaultSrc, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

const editBtn = () => win.locator('.explore:not([hidden]) .explore__layer').last().locator('.explore__head .explore__button', { hasText: 'Edit' }).first()
const doneBtn = () => win.locator('.explore:not([hidden]) .explore__layer').last().locator('.explore__head .explore__button', { hasText: 'Done' }).first()
const soft = (name: string, r: Awaited<ReturnType<typeof sample>>) => {
  report[name] = r
}

test('launch', async () => {
  const state = seededState(vault, path.join(vault, 'Locked long page.md'))
  // Yaseen's demo settings (YAZ-5164 23:46): Card width 640, medium pages, Clean cards, app zoom 150, a 1728 px window.
  state.settings = { ...state.settings, cardWidth: 640, contentWidth: 'medium', cardSpacing: 'clean', appZoom: Number(process.env.NJ_ZOOM ?? 150) } as typeof state.settings
  state.windows[0].bounds = { x: 0, y: 0, width: 1728, height: 1083 }
  app = await launchApp({ userData, seedState: state })
  win = await appWindow(app, 'w1')
  await expect(layer(win).locator('p', { hasText: 'nojump-line-01' })).toBeVisible()
})

test('page tab (Read only): unlock and Lock now, at the top and halfway', async () => {
  const chip = layer(win).locator('.read-only-chip__button')
  for (const where of ['top', 'mid'] as const) {
    if (where === 'mid') await scrollTo(win, '.tabstack__layer:not(.tabstack__layer--hidden) .editor-host', MARK(20).slice(0, 18))
    const marker = where === 'top' ? MARK(1).slice(0, 18) : MARK(20).slice(0, 18)
    soft(`pageTab.${where}.unlock`, await sample(win, marker, async () => {
      await chip.click()
      await layer(win).locator('.read-only-chip__allow').first().click()
    }))
    soft(`pageTab.${where}.lock`, await sample(win, marker, async () => {
      await layer(win).locator('.read-only-chip__lock').click()
    }))
  }
})

for (const [name, file, q] of [['cardInPageTab', 'Long page', 'nojump-card-question'], ['embedInPageTab', 'Embeds', 'nojump-card-question'], ['cardFileTab', 'Long card file', 'nojump-cardfile-q']] as const) {
  test(`${name}: Edit card and Done`, async () => {
    await fileRow(win, file).click()
    await expect(layer(win).getByText(q).first()).toBeVisible()
    await win.waitForTimeout(600)
    await win.evaluate((q) => {
      const s = document.querySelector('.tabstack__layer:not(.tabstack__layer--hidden) .editor-host, .tabstack__layer:not(.tabstack__layer--hidden) .card-file') as HTMLElement
      const card = Array.from(document.querySelectorAll('.tabstack__layer:not(.tabstack__layer--hidden) .card')).find((c) => (c.textContent ?? '').includes(q))!
      const sc = (function f(e: Element | null): Element | null { for (let a = e; a; a = a.parentElement) { const o = getComputedStyle(a).overflowY; if ((o === 'auto' || o === 'scroll') && a.scrollHeight > a.clientHeight) return a } return null })(card) ?? s
      sc.scrollTop += card.getBoundingClientRect().top - sc.getBoundingClientRect().top - 150
    }, q)
    await win.waitForTimeout(300)
    soft(`${name}.editCard`, await sample(win, q, () => layer(win).locator('.card__edit').first().click(), 1500, true))
        soft(`${name}.done`, await sample(win, q, () => win.keyboard.press('Escape'), 1500, true))
  })
}

test('explore page: E and Esc, at the top and halfway', async () => {
  await win.keyboard.press('Escape')
  await clickMenuItemQuietly(app, 'menu.file.explore')
  const box = win.locator('.explore:not([hidden]) input[aria-label="Explore the vault"]').last()
  await box.fill('Long page')
  await win.locator('[aria-label^="Explore result Long page"]').first().waitFor()
  await win.keyboard.press('Enter')
  const body = '.explore__layer--page .explore__body'
  await expect(win.locator(body).locator('p', { hasText: 'nojump-line-01' }).first()).toBeVisible()
  await win.waitForTimeout(500)
  for (const where of ['top', 'mid'] as const) {
    if (where === 'mid') await scrollTo(win, body, MARK(20).slice(0, 18))
    const marker = where === 'top' ? MARK(1).slice(0, 18) : MARK(20).slice(0, 18)
    soft(`explorePage.${where}.edit`, await sample(win, marker, () => editBtn().click()))
    await expect(win.locator('.explore__body--edit:not(.explore__body--incoming)')).toHaveCount(1)
    soft(`explorePage.${where}.read`, await sample(win, marker, () => doneBtn().click()))
    await expect(win.locator('.explore__body--edit')).toHaveCount(0)
  }
  // A card in the Explore page: its Edit card while reading, and Done.
  await editBtn().click()
  await win.waitForTimeout(500)
  await scrollTo(win, body, MARK(29).slice(0, 18))
  soft('explorePage.card.editCard', await sample(win, 'nojump-card-question', () => win.locator('.explore:not([hidden]) .explore__body--edit .card__edit').first().click(), 1500, true))
  await expect(win.locator('.explore:not([hidden]) .card--editing')).toHaveCount(1)
  soft('explorePage.card.done', await sample(win, 'nojump-card-question', () => win.locator('.explore:not([hidden]) .card--editing .card__edit').first().click(), 1500, true))
  await doneBtn().click()
  await win.keyboard.press('Escape')
  await win.keyboard.press('Escape')
})

test('explore card file: E and Esc, at the top and halfway', async () => {
  await clickMenuItemQuietly(app, 'menu.file.explore')
  const box = win.locator('.explore:not([hidden]) input[aria-label="Explore the vault"]').last()
  await box.fill('Long card file')
  await win.locator('[aria-label^="Explore result Long card file"]').first().waitFor()
  await win.keyboard.press('Enter')
  await expect(win.locator('.explore__layer', { hasText: 'nojump-line-61' }).last()).toBeVisible()
  await win.waitForTimeout(500)
  for (const where of ['top', 'mid'] as const) {
    if (where === 'mid') await scrollTo(win, '.explore__layer .explore__body', MARK(70).slice(0, 18))
    const marker = where === 'top' ? MARK(61).slice(0, 18) : MARK(70).slice(0, 18)
    soft(`exploreCardFile.${where}.edit`, await sample(win, marker, () => editBtn().click()))
    await expect(win.locator('.explore:not([hidden]) .card--editing')).toHaveCount(1)
    soft(`exploreCardFile.${where}.read`, await sample(win, marker, () => doneBtn().click()))
    await expect(win.locator('.explore:not([hidden]) .card--editing')).toHaveCount(0)
  }
  await win.keyboard.press('Escape')
  await win.keyboard.press('Escape')
})

// Last: every path, both ways, at most 1 px of motion in any frame (the line in view: top, left, width).
test('nothing jumped', () => {
  test.skip(process.env.NJ_PROBE === '1', 'probe: record only')
  for (const [name, r] of Object.entries(report)) expect.soft((r as Awaited<ReturnType<typeof sample>>).maxShift, name).toEqual({ top: 0, left: 0, width: 0 })
})
