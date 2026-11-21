/**
 * NOTHING JUMPS ON READ ⇄ EDIT (YAZ-5164 scope probe). Every switch path, in the real app: the text you look at, the
 * title and a card keep their place on screen (top, left, width), every frame, both ways. A probe: it records what moves
 * and by how many px (`NOJUMP_REPORT`), and asserts zero motion. `NJ_PROBE=1` only records (for a table); by default each path fails while anything moves.
 * Each switch by its button and by its key (E, Esc, ⌘↵). In Explore also the title (YAZ-5164 Option A: the page's own
 * title in the page; Q50: the head's title only fades) and the head's height. Then again at 100% app zoom in a narrow
 * window, where the Explore layer is narrow and its head folds.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { clickMenuItemQuietly, appWindow, buildFixtureVault, copyVault, fileRow, launchApp, layer, lensTab, seededState } from './helpers'

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
      const headBox = (): number | null => {
        const head = Array.from(document.querySelectorAll('.explore:not([hidden]) .explore__layer')).at(-1)?.querySelector('.explore__head')
        return head == null ? null : Math.round(head.getBoundingClientRect().height)
      }
      const out: Array<{ t: number; top: number | null; left: number | null; width: number | null; title: number | null; titleKind: string | null; head: number | null }> = []
      const start = performance.now()
      ;(window as unknown as { __nojump: unknown }).__nojump = out
      const tick = () => {
        const el = pick()
        const r = el?.getBoundingClientRect()
        const tEl = Array.from((Array.from(document.querySelectorAll('.explore:not([hidden])')).at(-1) ?? document).querySelectorAll('.page-title__text, .page-title__input, .explore__title')).filter((e) => e.closest('.explore__body--incoming, .tabstack__layer--hidden, .card') === null && e.getBoundingClientRect().height > 0).at(-1)
        out.push({ t: Math.round(performance.now() - start), top: r ? Math.round(r.top) : null, left: r ? Math.round(r.left) : null, width: r ? Math.round(r.width) : null, title: titleBox() ? Math.round(titleBox()!.top) : null, titleKind: tEl?.className.split(' ')[0] ?? null, head: headBox() })
      }
      // Read what each frame PAINTED: a task posted from the frame's rAF runs once its rendering is done (its
      // ResizeObservers included), so a size change put right before the paint is not counted as a frame that moved.
      const painted = new MessageChannel()
      painted.port1.onmessage = () => tick()
      const frame = () => {
        if (performance.now() - start >= ms) return
        painted.port2.postMessage(null)
        requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
    },
    { text, ms, card },
  )
  await w.waitForTimeout(80)
  await act()
  await w.waitForTimeout(ms + 200)
  const frames = (await w.evaluate(() => (window as unknown as { __nojump: unknown }).__nojump)) as Array<{ t: number; top: number | null; left: number | null; width: number | null; title: number | null; titleKind: string | null; head: number | null }>
  const first = frames.find((f) => f.top !== null)!
  const last = Array.from(frames).reverse().find((f) => f.top !== null)!
  // A reading the very next one takes back is a layout between two paints (a swap posted after the paint, put right
  // by the ResizeObserver before the next one): not a frame on screen. A title above the view cannot jump in it.
  const held = (k: 'top' | 'left' | 'width' | 'title' | 'head') => frames.filter((f, i) => f[k] !== null && (i === frames.length - 1 || frames[i + 1][k] === f[k] || i === 0))
  const dev = (k: 'top' | 'left' | 'width' | 'title' | 'head') => {
    const seen = held(k).filter((f) => k !== 'title' || (f.title as number) >= 0)
    return seen.length === 0 ? 0 : Math.max(...seen.map((f) => Math.abs((f[k] as number) - (seen[0][k] as number))))
  }
  const missing = frames.filter((f) => f.top === null).length
  return {
    before: first,
    after: last,
    endShift: { top: (last.top ?? 0) - (first.top ?? 0), left: (last.left ?? 0) - (first.left ?? 0), width: (last.width ?? 0) - (first.width ?? 0) },
    maxShift: { top: dev('top'), left: dev('left'), width: dev('width'), title: dev('title'), head: dev('head') },
    titleBefore: frames[0].title,
    titleAfter: frames.at(-1)!.title,
    titleKinds: [frames[0].titleKind, frames.at(-1)!.titleKind],
    framesWithoutTarget: missing,
    /** Each frame where the line's top changed: when, and to what (for a table of what moved when). */
    trace: frames.filter((f, i) => i > 0 && f.top !== frames[i - 1].top).map((f) => `${f.t}:${f.top}`).join(' '),
  }
}

const scroller = (w: Page, sel: string) => w.locator(sel).last()
async function scrollTo(w: Page, _sel: string, text: string, offset = 120): Promise<void> {
  await w.evaluate(
    ({ text, offset }) => {
      const ok = (e: Element) => e.closest('.explore__body--incoming, .tabstack__layer--hidden, [hidden]') === null && e.getBoundingClientRect().height > 0
      const el = Array.from((Array.from(document.querySelectorAll('.explore:not([hidden])')).at(-1) ?? document).querySelectorAll('p')).filter(ok).filter((p) => (p.textContent ?? '').startsWith(text)).at(-1)!
      // The page's own scroller (a card's text may hold a scroll box of its own).
      let sc: Element | null = el.closest('.card-file, .editor-host')
      if (sc === null) for (sc = el.parentElement; sc; sc = sc.parentElement) { const o = getComputedStyle(sc).overflowY; if ((o === 'auto' || o === 'scroll') && sc.scrollHeight > sc.clientHeight) break }
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
  // Round 2: Yaseen's "Card files on a page" (DEMO-207, in a Read only vault): two card files embedded, a card of its own, a line under them.
  await writeFile(path.join(vault, 'small-card-wiki-12.md'), '---\nkind: card\n---\n```card\nnojump-small-12 the capital is Paris\n---\nParis\n```\n<!-- card: WIKI-12, title "Capital of France" -->\n')
  await writeFile(path.join(vault, 'small-card-wiki-13.md'), '---\nkind: card\n---\n```card\nnojump-small-13 test\n---\nThe capital is Canberra, not Sydney.\n```\n<!-- card: WIKI-13, title "test" -->\n')
  await writeFile(path.join(vault, 'Card embeds.md'), `${lines(101, 102)}\n\n![[WIKI-12]]\n\n![[WIKI-13]]\n\n${lines(103, 104)}\n\n${CARD.replace('WIKI-9', 'WIKI-14').replace('nojump-card-question', 'nojump-own-card')}\n${lines(105, 106)}\n`)
  await writeFile(path.join(vault, 'Embeds.md'), `${lines(76, 80)}\n\n![[WIKI-9]]\n\n${lines(81, 100)}\n`)
  await mkdir(path.join(vault, '.yaseendocs'), { recursive: true })
  await writeFile(path.join(vault, '.yaseendocs', 'review.json'), JSON.stringify({ enabled: true }))
  await writeFile(path.join(vault, '.yaseendocs', 'ids.json'), JSON.stringify({ enabled: true, letters: 'WIKI' }))
})

test.afterAll(async () => {
  for (const [k, v] of Object.entries(report)) { const r = v as Awaited<ReturnType<typeof sample>>; console.log(`NJ ${k} before=${JSON.stringify(r.before)} end=${JSON.stringify(r.endShift)} max=${JSON.stringify(r.maxShift)} title=${r.titleBefore}->${r.titleAfter} ${r.titleKinds.join('->')} missing=${r.framesWithoutTarget} trace=${r.trace}`) }
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vaultSrc, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

const editBtn = () => win.locator('.explore:not([hidden]) .explore__layer').last().locator('.explore__head .explore__button', { hasText: 'Edit' }).first()
const doneBtn = () => win.locator('.explore:not([hidden]) .explore__layer').last().locator('.explore__head .explore__button', { hasText: 'Done' }).first()
const soft = (name: string, r: Awaited<ReturnType<typeof sample>>) => {
  report[name] = r
}

/** Launches the app on the locked page with Yaseen's demo settings (YAZ-5164 23:46), or another app zoom and window. */
async function launch(zoom: number, width: number): Promise<void> {
  const state = seededState(vault, path.join(vault, 'Locked long page.md'))
  state.settings = { ...state.settings, cardWidth: 640, contentWidth: 'medium', cardSpacing: 'clean', appZoom: zoom } as typeof state.settings
  state.windows[0].bounds = { x: 0, y: 0, width, height: 1083 }
  app = await launchApp({ userData, seedState: state })
  win = await appWindow(app, 'w1')
  await expect(layer(win).locator('p', { hasText: 'nojump-line-01' })).toBeVisible()
}

test('launch', async () => {
  // Yaseen's demo settings (YAZ-5164 23:46): Card width 640, medium pages, Clean cards, app zoom 150, a 1728 px window.
  await launch(Number(process.env.NJ_ZOOM ?? 150), 1728)
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

// YAZ-5581: the sidebar lock unlocks the whole vault; Lock now saves the open page, then locks it IN PLACE (no jump).
test('vault lock (sidebar): Unlock for 10 minutes, type, Lock now, halfway down a page tab', async () => {
  const readOnlyFile = path.join(vault, '.yaseendocs', 'read-only.json')
  await writeFile(readOnlyFile, JSON.stringify({ on: true }))
  try {
    await fileRow(win, 'Long page').click()
    await expect(layer(win).locator('p', { hasText: 'nojump-line-01' })).toBeVisible()
    await expect(layer(win).locator('.read-only-chip__button')).toHaveCount(1)
    await scrollTo(win, '.tabstack__layer:not(.tabstack__layer--hidden) .editor-host', MARK(20).slice(0, 18))
    const marker = MARK(20).slice(0, 18)
    soft('vaultLock.unlock', await sample(win, marker, async () => {
      await win.locator('.sidebar__header .vault-lock__button').click()
      await win.locator('.vault-lock__ask .read-only-chip__allow').click()
    }))
    // The one signal is the sidebar's: no chip on the page, and the page edits.
    await expect(win.locator('.vault-lock--allowed')).toHaveCount(1)
    await expect(layer(win).locator('.read-only-chip__button')).toHaveCount(0)
    await layer(win).locator('p', { hasText: marker }).last().click()
    await win.keyboard.press('End')
    await win.keyboard.type(' vault-unlocked-typing')
    // The typing's own scroll settles before the lock is measured.
    await sample(win, marker, async () => undefined)
    soft('vaultLock.lock', await sample(win, marker, async () => {
      // A narrow header shows the short form ("10m") with no Lock now beside it (YAZ-4964): the box always has it.
      await win.locator('.sidebar__header .vault-lock__button').click()
      await win.locator('.vault-lock__ask button', { hasText: 'Lock now' }).click()
    }))
    await expect(layer(win).locator('.read-only-chip__button')).toHaveCount(1)
    expect(await readFile(path.join(vault, 'Long page.md'), 'utf8')).toContain('vault-unlocked-typing')
    const shift = report['vaultLock.lock'] as Awaited<ReturnType<typeof sample>>
    expect(Math.abs(shift.endShift.top)).toBeLessThanOrEqual(2)
  } finally {
    await rm(readOnlyFile, { force: true })
    await win.waitForTimeout(800)
  }
})

/** Scrolls the visible tab so the card with `q` stands 150 px under the top. */
async function cardInView(q: string): Promise<void> {
  await win.evaluate((q) => {
    const s = document.querySelector('.tabstack__layer:not(.tabstack__layer--hidden) .editor-host, .tabstack__layer:not(.tabstack__layer--hidden) .card-file') as HTMLElement
    const card = Array.from(document.querySelectorAll('.tabstack__layer:not(.tabstack__layer--hidden) .card')).find((c) => (c.textContent ?? '').includes(q))!
    const sc = (function f(e: Element | null): Element | null { for (let a = e; a; a = a.parentElement) { const o = getComputedStyle(a).overflowY; if ((o === 'auto' || o === 'scroll') && a.scrollHeight > a.clientHeight) return a } return null })(card) ?? s
    sc.scrollTop += card.getBoundingClientRect().top - sc.getBoundingClientRect().top - 150
  }, q)
  await win.waitForTimeout(300)
}

for (const [name, file, q] of [['cardInPageTab', 'Long page', 'nojump-card-question'], ['embedInPageTab', 'Embeds', 'nojump-card-question'], ['cardFileTab', 'Long card file', 'nojump-cardfile-q']] as const) {
  test(`${name}: Edit card and Done`, async () => {
    await fileRow(win, file).click()
    await expect(layer(win).getByText(q).first()).toBeVisible()
    await win.waitForTimeout(600)
    await cardInView(q)
    soft(`${name}.editCard`, await sample(win, q, () => layer(win).locator('.card__edit').first().click(), 1500, true))
    soft(`${name}.done`, await sample(win, q, () => win.keyboard.press('Escape'), 1500, true))
    if (name !== 'cardFileTab') return
    // By key (the tab's E, and ⌘↵ as Done): the card file tab's body has the keyboard after Done.
    soft(`${name}.keyE`, await sample(win, q, () => win.keyboard.press('e'), 1500, true))
    await expect(layer(win).locator('.card--editing')).toHaveCount(1)
    soft(`${name}.keyCmdEnter`, await sample(win, q, () => win.keyboard.press('Meta+Enter'), 1500, true))
    await expect(layer(win).locator('.card--editing')).toHaveCount(0)
  })
}

const head = () => win.locator('.explore:not([hidden]) .explore__layer').last().locator('.explore__head')
const editing = () => win.locator('.explore:not([hidden]) .explore__layer').last().locator('.explore__body--edit:not(.explore__body--incoming)')
const cardEditing = () => win.locator('.explore:not([hidden]) .card--editing')

/** Opens `name` in Explore from its search: a page layer, reading. */
async function openInExplore(name: string, first: string): Promise<void> {
  await clickMenuItemQuietly(app, 'menu.file.explore')
  const box = win.locator('.explore:not([hidden]) input[aria-label="Explore the vault"]').last()
  await box.fill(name)
  await win.locator(`[aria-label^="Explore result ${name}"]`).first().waitFor()
  await win.keyboard.press('Enter')
  await expect(win.locator('.explore__layer', { hasText: first }).last()).toBeVisible()
  await win.waitForTimeout(500)
}

/** Explore page: Edit and Done, by the buttons at the top and halfway, then E, Esc, E and ⌘↵ halfway; a card's Edit card. */
async function explorePagePaths(pre: string): Promise<void> {
  await openInExplore('Long page', 'nojump-line-01')
  const body = '.explore__layer--page .explore__body'
  for (const where of ['top', 'mid'] as const) {
    if (where === 'mid') await scrollTo(win, body, MARK(20).slice(0, 18))
    const marker = where === 'top' ? MARK(1).slice(0, 18) : MARK(20).slice(0, 18)
    soft(`${pre}explorePage.${where}.edit`, await sample(win, marker, () => editBtn().click()))
    await expect(editing()).toHaveCount(1)
    soft(`${pre}explorePage.${where}.read`, await sample(win, marker, () => doneBtn().click()))
    await expect(win.locator('.explore__body--edit')).toHaveCount(0)
  }
  const marker = MARK(20).slice(0, 18)
  soft(`${pre}explorePage.mid.keyE`, await sample(win, marker, () => win.keyboard.press('e')))
  await expect(editing()).toHaveCount(1)
  soft(`${pre}explorePage.mid.keyEsc`, await sample(win, marker, () => win.keyboard.press('Escape')))
  await expect(win.locator('.explore__body--edit')).toHaveCount(0)
  await win.keyboard.press('e')
  await expect(editing()).toHaveCount(1)
  await win.waitForTimeout(300)
  soft(`${pre}explorePage.mid.keyCmdEnter`, await sample(win, marker, () => win.keyboard.press('Meta+Enter')))
  await expect(win.locator('.explore__body--edit')).toHaveCount(0)
  // A card in the Explore page: its Edit card while editing, and Done.
  await editBtn().click()
  await win.waitForTimeout(500)
  await scrollTo(win, body, MARK(29).slice(0, 18))
  soft(`${pre}explorePage.card.editCard`, await sample(win, 'nojump-card-question', () => win.locator('.explore:not([hidden]) .explore__body--edit .card__edit').first().click(), 1500, true))
  await expect(cardEditing()).toHaveCount(1)
  soft(`${pre}explorePage.card.done`, await sample(win, 'nojump-card-question', () => win.locator('.explore:not([hidden]) .card--editing .card__edit').first().click(), 1500, true))
  await doneBtn().click()
  await win.keyboard.press('Escape')
  await win.keyboard.press('Escape')
}

/** Explore card file: Edit and Done by the buttons at the top and halfway, then E, Esc, E and ⌘↵ halfway. */
async function exploreCardFilePaths(pre: string): Promise<void> {
  await openInExplore('Long card file', 'nojump-line-61')
  for (const where of ['top', 'mid'] as const) {
    if (where === 'mid') await scrollTo(win, '.explore__layer .explore__body', MARK(70).slice(0, 18))
    const marker = where === 'top' ? MARK(61).slice(0, 18) : MARK(70).slice(0, 18)
    soft(`${pre}exploreCardFile.${where}.edit`, await sample(win, marker, () => editBtn().click()))
    await expect(cardEditing()).toHaveCount(1)
    soft(`${pre}exploreCardFile.${where}.read`, await sample(win, marker, () => doneBtn().click()))
    await expect(cardEditing()).toHaveCount(0)
  }
  const marker = MARK(70).slice(0, 18)
  soft(`${pre}exploreCardFile.mid.keyE`, await sample(win, marker, () => win.keyboard.press('e')))
  await expect(cardEditing()).toHaveCount(1)
  await expect(doneBtn()).toBeVisible()
  soft(`${pre}exploreCardFile.mid.keyEsc`, await sample(win, marker, () => win.keyboard.press('Escape')))
  await expect(cardEditing()).toHaveCount(0)
  await expect(editBtn()).toBeVisible()
  await win.keyboard.press('e')
  await expect(cardEditing()).toHaveCount(1)
  await win.waitForTimeout(300)
  soft(`${pre}exploreCardFile.mid.keyCmdEnter`, await sample(win, marker, () => win.keyboard.press('Meta+Enter')))
  await expect(cardEditing()).toHaveCount(0)
  await expect(editBtn()).toBeVisible()
  await win.keyboard.press('Escape')
  await win.keyboard.press('Escape')
}

test('explore page: Edit and Done, E, Esc and ⌘↵, at the top and halfway', async () => {
  await win.keyboard.press('Escape')
  await explorePagePaths('')
})

test('explore card file: Edit and Done, E, Esc and ⌘↵, at the top and halfway', async () => {
  await exploreCardFilePaths('')
})

/**
 * ROUND 2 (YAZ-5164, Yaseen: "at the bottom I add a test … as soon as I hit done, it jumps up a bit"; "after I hit
 * command enter … I can't scroll up as easy, there's like a hang on the scroll up"). New text typed into a page or a
 * card, at the bottom, the top or halfway, then Done by its button, Esc or ⌘↵: the line typed stays at its px. Then a
 * wheel up right after: the scroller moves by it at once and does not come back.
 */
const scrollerOfLine = (w: Page, text: string) =>
  w.evaluate((text) => {
    const ok = (e: Element) => e.closest('.explore__body--incoming, .tabstack__layer--hidden, [hidden], .card-pane__incoming') === null && e.getBoundingClientRect().height > 0
    const root = Array.from(document.querySelectorAll('.explore:not([hidden])')).at(-1) ?? document.querySelector('.tabstack__layer:not(.tabstack__layer--hidden)')!
    const el = Array.from(root.querySelectorAll('p')).filter(ok).filter((p) => (p.textContent ?? '').startsWith(text)).at(-1)!
    for (let sc = el.parentElement; sc; sc = sc.parentElement) {
      const o = getComputedStyle(sc).overflowY
      if ((o === 'auto' || o === 'scroll') && sc.scrollHeight > sc.clientHeight) {
        sc.setAttribute('data-nj-scroller', '')
        return true
      }
    }
    return false
  }, text)

/** Scrolls the page in view to its very bottom. */
async function scrollToBottom(w: Page, last: string): Promise<void> {
  await w.evaluate(() => document.querySelectorAll('[data-nj-scroller]').forEach((e) => e.removeAttribute('data-nj-scroller')))
  await scrollerOfLine(w, last)
  await w.evaluate(() => {
    const sc = document.querySelector('[data-nj-scroller]')!
    sc.scrollTop = sc.scrollHeight
  })
  await w.waitForTimeout(300)
}

/** In the editor on show: a click at the end of the line starting `after`, then a new line with `typed`. */
async function typeAfter(w: Page, after: string, typed: string, inTab = false): Promise<void> {
  const where = inTab ? layer(w) : w.locator('.explore:not([hidden]) .explore__layer').last()
  const line = where.locator('.ProseMirror[contenteditable="true"] p', { hasText: after }).last()
  await line.click()
  await w.keyboard.press('Meta+ArrowRight')
  await w.keyboard.press('Enter')
  await w.keyboard.type(typed, { delay: 5 })
  await w.waitForTimeout(400)
}

/** Wheels up over the scroller in view and reads its scrollTop every frame for `ms`: how far it went at once, and back. */
async function wheelUp(w: Page, by = 300, ms = 1500) {
  const box = (await w.locator('[data-nj-scroller]').last().boundingBox())!
  await w.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await w.evaluate((ms) => {
    const sc = document.querySelector('[data-nj-scroller]')!
    const out: number[] = []
    ;(window as unknown as { __njWheel: number[] }).__njWheel = out
    const start = performance.now()
    const tick = () => {
      out.push(sc.scrollTop)
      if (performance.now() - start < ms) requestAnimationFrame(tick)
    }
    tick()
  }, ms)
  await w.mouse.wheel(0, -by)
  await w.waitForTimeout(ms + 200)
  const tops = (await w.evaluate(() => (window as unknown as { __njWheel: number[] }).__njWheel)) as number[]
  const from = tops[0]
  const least = Math.min(...tops)
  return { from, moved: from - least, end: tops.at(-1)!, back: tops.at(-1)! - least }
}

const wheels: Record<string, Awaited<ReturnType<typeof wheelUp>>> = {}

/** An Explore layer: Edit by E, a new line typed after `after`, then Done by `how`; the typed line keeps its px. */
async function typeThenDone(pre: string, kind: 'page' | 'cardFile', name: string, first: string, after: string, last: string, where: 'bottom' | 'mid' | 'top'): Promise<void> {
  await openInExplore(name, first)
  for (const how of ['button', 'Escape', 'Meta+Enter'] as const) {
    if (where === 'bottom') await scrollToBottom(win, last)
    else await scrollTo(win, '', after.slice(0, 18), where === 'top' ? 400 : 200)
    await win.keyboard.press('e')
    // Read only: E asks "Allow edits?" first; Done then locks again.
    const allow = win.locator('.explore:not([hidden]) .read-only-chip__allow').first()
    if (await allow.waitFor({ timeout: 1000 }).then(() => true, () => false)) await allow.click()
    if (kind === 'page') await expect(editing()).toHaveCount(1)
    else await expect(cardEditing()).toHaveCount(1)
    await win.waitForTimeout(400)
    const typed = `nojump-typed-${where}-${how === 'Meta+Enter' ? 'cmdenter' : how.toLowerCase()} just testing`
    await typeAfter(win, after, typed)
    if (where === 'bottom') {
      await win.evaluate(() => document.querySelectorAll('[data-nj-scroller]').forEach((e) => e.removeAttribute('data-nj-scroller')))
      await scrollerOfLine(win, typed.slice(0, 20))
      await win.evaluate(() => {
        const sc = document.querySelector('[data-nj-scroller]')!
        sc.scrollTop = sc.scrollHeight
      })
      await win.waitForTimeout(300)
    }
    const key = `${pre}${kind}.typed.${where}.${how}`
    soft(key, await sample(win, typed.slice(0, 24), () => (how === 'button' ? doneBtn().click() : win.keyboard.press(how))))
    if (kind === 'page') await expect(win.locator('.explore__body--edit')).toHaveCount(0)
    else await expect(cardEditing()).toHaveCount(0)
    await win.evaluate(() => document.querySelectorAll('[data-nj-scroller]').forEach((e) => e.removeAttribute('data-nj-scroller')))
    await scrollerOfLine(win, typed.slice(0, 20))
    wheels[key] = await wheelUp(win)
    after = typed
  }
  await win.keyboard.press('Escape')
  await win.keyboard.press('Escape')
}

// Each a test of its own: three ways out (Done, Esc, ⌘↵) per case.
const READ_ONLY_VAULT = () => path.join(vault, '.yaseendocs', 'read-only.json')
for (const [pre, where, name, first, after, last] of [
  // Yaseen's: a Read only vault (E asks "Allow edits?", Done locks again), card files embedded, typing at the bottom.
  ['readOnlyVault.', 'bottom', 'Card embeds', 'nojump-line-101', 106, 106],
  ['readOnlyVault.', 'top', 'Card embeds', 'nojump-line-101', 101, 106],
  ['', 'bottom', 'Embeds', 'nojump-line-76', 100, 100],
  ['', 'top', 'Long page', 'nojump-line-01', 2, 60],
  ['', 'mid', 'Long page', 'nojump-line-01', 40, 60],
] as const) {
  test(`round 2: explore page ${name}${pre === '' ? '' : ' (Read only vault)'}, a new line typed at the ${where}, then Done, Esc or ⌘↵`, async () => {
    if (pre !== '') {
      await writeFile(READ_ONLY_VAULT(), JSON.stringify({ on: true }))
      await win.waitForTimeout(800)
    }
    await typeThenDone(pre, 'page', name, first, MARK(after).slice(0, 18), MARK(last).slice(0, 18), where)
    if (pre !== '') {
      await rm(READ_ONLY_VAULT())
      await win.waitForTimeout(800)
    }
  })
}

for (const [where, after] of [['bottom', 75], ['mid', 68]] as const) {
  test(`round 2: explore card file, a new line typed at the ${where}, then Done, Esc or ⌘↵`, async () => {
    await typeThenDone('', 'cardFile', 'Long card file', 'nojump-line-61', MARK(after).slice(0, 18), MARK(75).slice(0, 18), where)
  })
}

test('round 2: card file tab, a new line typed at the bottom, then Done by Esc and ⌘↵', async () => {
  await expect(win.locator('.explore:not([hidden])')).toHaveCount(0)
  // The Escapes that closed Explore can fold the sidebar away: open it for the file row.
  const show = win.locator('.tabbar-nav__btn[aria-label="Show sidebar"]')
  if ((await show.count()) > 0) await show.click()
  await lensTab(win, 'Files').click()
  await fileRow(win, 'Long card file').click()
  await expect(layer(win).getByText('nojump-cardfile-q').first()).toBeVisible()
  await win.waitForTimeout(600)
  for (const how of ['Escape', 'Meta+Enter'] as const) {
    await scrollToBottom(win, MARK(75).slice(0, 18))
    // Edit card's button stands at the card's top, out of view down here: its click, as E would.
    await layer(win).locator('.card__edit').first().dispatchEvent('click')
    await expect(layer(win).locator('.card--editing')).toHaveCount(1)
    await win.waitForTimeout(400)
    const typed = `nojump-tab-${how === 'Escape' ? 'esc' : 'cmdenter'} just testing`
    await typeAfter(win, MARK(75).slice(0, 18), typed, true)
    const key = `cardFileTab.typed.bottom.${how}`
    soft(key, await sample(win, typed.slice(0, 20), () => win.keyboard.press(how)))
    await expect(layer(win).locator('.card--editing')).toHaveCount(0)
    await win.evaluate(() => document.querySelectorAll('[data-nj-scroller]').forEach((e) => e.removeAttribute('data-nj-scroller')))
    await scrollerOfLine(win, typed.slice(0, 20))
    wheels[key] = await wheelUp(win)
  }
})

// A wheel right after a switch: the scroller follows it at once (most of the 300 px within the time) and nothing pulls it back.
test('round 2: a wheel up after Done scrolls at once, nothing pulls it back', () => {
  for (const [k, v] of Object.entries(wheels)) console.log(`NJW ${k} ${JSON.stringify(v)}`)
  test.skip(process.env.NJ_PROBE === '1', 'probe: record only')
  for (const [name, r] of Object.entries(wheels)) {
    // 300 wheel px at 150% app zoom are 200 page px; at the top there is nothing to scroll up to.
    expect.soft(r.moved, `${name} moved`).toBeGreaterThanOrEqual(Math.min(r.from, 150))
    expect.soft(r.back, `${name} pulled back`).toBe(0)
  }
})

// Q50: the head's title shows only once the page's own title (a card file's band) is out of view; the head keeps its height.
for (const [what, name, first, mid] of [['page', 'Long page', 'nojump-line-01', 20], ['card file', 'Long card file', 'nojump-line-61', 70]] as const) {
  test(`explore head on a ${what}: one height, its title shows only once the page's title scrolls away`, async () => {
    await openInExplore(name, first)
    const height = await head().evaluate((el) => el.getBoundingClientRect().height)
    const title = head().locator('.explore__title')
    await expect(head()).not.toHaveAttribute('data-title-shown')
    await expect(title).toHaveCSS('opacity', '0')
    await scrollTo(win, '', MARK(mid).slice(0, 18))
    await expect(head()).toHaveAttribute('data-title-shown')
    await expect(title).toHaveCSS('opacity', '1')
    expect(await head().evaluate((el) => el.getBoundingClientRect().height)).toBe(height)
    // In edit too: the title stays shown halfway, and hides at the top.
    await editBtn().click()
    await expect(head()).toHaveAttribute('data-title-shown')
    expect(await head().evaluate((el) => el.getBoundingClientRect().height)).toBe(height)
    await scrollTo(win, '', MARK(first === 'nojump-line-01' ? 1 : 61).slice(0, 18), 400)
    await expect(head()).not.toHaveAttribute('data-title-shown')
    await expect(title).toHaveCSS('opacity', '0')
    await doneBtn().click()
    expect(await head().evaluate((el) => el.getBoundingClientRect().height)).toBe(height)
    await win.keyboard.press('Escape')
    await win.keyboard.press('Escape')
  })
}

// The rule at other sizes: 100% app zoom, and a narrow window, where the Explore layer is narrow and its head folds.
test('relaunch: 100% app zoom, a narrow window', async () => {
  await app.close()
  await launch(100, 820)
})

test('narrow, 100%: explore page', async () => {
  await explorePagePaths('narrow100.')
})

test('narrow, 100%: explore card file', async () => {
  await exploreCardFilePaths('narrow100.')
})

// Last: every path, both ways, no motion in any frame: the line in view (top, left, width), the title, the Explore head.
test('nothing jumped', () => {
  test.skip(process.env.NJ_PROBE === '1', 'probe: record only')
  for (const [name, r] of Object.entries(report)) expect.soft((r as Awaited<ReturnType<typeof sample>>).maxShift, name).toEqual({ top: 0, left: 0, width: 0, title: 0, head: 0 })
})
