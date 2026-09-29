/**
 * The comment stream (YAZ-1472) end-to-end: the block under a note, driven in the REAL app, with
 * the note's own frontmatter as the only storage (🔒 D1/D2 — one reserved `comments` key).
 *
 * What only the real app can prove: every gesture is ONE `transformFile` write on the fresh bytes
 * (D8) and the block then adopts what landed, through the watcher echo, without disturbing the open
 * editor. So each step reads the file on disk: the numbers (`n`, D15), the flat `reply_to` thread,
 * the body left untouched, and the key gone once the last comment goes (D7).
 *
 * Serial (the suite's idiom): each step continues the last.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseFrontmatter, splitFrontmatter } from '../../shared/frontmatter'
import type { PageComment } from '../../shared/comments'
import { appWindow, editorOf, launchApp, seededState, sheet, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

const NOTE = 'Commented.md'
const BODY = '# Commented\n\ncomments-e2e-body\n'

let userData: string
let vault: string
let notePath: string
let app: ElectronApplication
let win: Page

const block = (w: Page) => w.locator('.comments')
const header = (w: Page) => block(w).locator('.comments__header')
const thread = (w: Page, mark: string) => block(w).locator('.comments__thread').filter({ has: w.locator('.comments__mark', { hasText: mark }) })
const itemByMark = (w: Page, mark: string) => block(w).locator('.comments__item').filter({ has: w.locator(`.comments__mark:text-is("${mark}")`) })
const composer = (w: Page, placeholder: string) => block(w).locator(`.comments__composer:has(textarea[aria-label="${placeholder}"])`)

/** The `comments` list on disk, and the body beside it. */
async function onDisk(): Promise<{ comments: PageComment[] | undefined; body: string }> {
  const { frontmatter, body } = splitFrontmatter(await readFile(notePath, 'utf8'))
  return { comments: parseFrontmatter(frontmatter).properties.comments as PageComment[] | undefined, body }
}

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'comments-userdata-'))
  vault = await mkdtemp(path.join(tmpdir(), 'comments-vault-'))
  notePath = path.join(vault, NOTE)
  await writeFile(notePath, BODY)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — a page with no comments starts collapsed; a titled comment lands as #1 in the frontmatter', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, notePath) })
  win = await appWindow(app, 'w1')
  await expect(editorOf(win)).toContainText('comments-e2e-body')
  await expect(header(win)).toHaveAttribute('aria-expanded', 'false')
  await header(win).click()

  const box = composer(win, 'Leave a comment…')
  await box.locator('textarea').fill('line one\nline two')
  await box.locator('input[aria-label="Title (optional)"]').fill('Plan')
  await box.locator('button', { hasText: /^Comment$/ }).click()

  await expect(header(win)).toContainText('Comments (1)')
  await expect(itemByMark(win, '#1').locator('.comments__summary')).toHaveText('Plan')
  await expect.poll(async () => (await onDisk()).comments?.length).toBe(1)
  const { comments, body } = await onDisk()
  expect(comments?.[0]).toMatchObject({ n: 1, title: 'Plan', body: 'line one\nline two' })
  expect(comments?.[0].by).toBeUndefined() // 🔒 D3: the app never writes `by` for the person at the keyboard
  expect(body).toBe(BODY) // the note's text is never touched
  await shoot(win, 'comments-01-first')
})

test('step 2 — a second comment is #2; a reply to it is #2.1, filed flat with `reply_to`', async () => {
  const box = composer(win, 'Leave a comment…')
  await box.locator('textarea').fill('second thought')
  await box.locator('textarea').press('Meta+Enter')
  await expect(header(win)).toContainText('Comments (2)')

  // A lone comment offers Reply on its own row; its composer opens focused.
  await itemByMark(win, '#2').hover()
  await itemByMark(win, '#2').locator('.comments__action', { hasText: 'Reply' }).click()
  const reply = composer(win, 'Reply…')
  await expect(reply.locator('textarea')).toBeFocused()
  await reply.locator('textarea').fill('a reply')
  await reply.locator('textarea').press('Meta+Enter')

  await expect(header(win)).toContainText('Comments (3)')
  await expect(itemByMark(win, '#2.1')).toContainText('a reply')
  await expect(thread(win, '#2').locator('.comments__replies-toggle')).toHaveText('1 reply')
  await expect.poll(async () => (await onDisk()).comments?.length).toBe(3)
  const { comments } = await onDisk()
  const second = comments?.find((c) => c.n === 2 && c.reply_to === undefined)
  expect(comments?.find((c) => c.reply_to !== undefined)).toMatchObject({ n: 1, reply_to: second?.id, body: 'a reply' })
  await shoot(win, 'comments-02-thread')
})

test('step 3 — a titled comment folds its body; fold-all folds everything and flips to Expand all', async () => {
  const first = itemByMark(win, '#1')
  await expect(first.locator('.comments__body')).toContainText('line two')
  await first.locator('.comments__fold[aria-label="Collapse comment"]').click()
  await expect(first.locator('.comments__body')).toHaveCount(0)
  await expect(first.locator('.comments__fold')).toHaveAttribute('aria-label', 'Expand comment')

  await block(win).locator('.comments__tool', { hasText: 'Collapse all' }).click()
  await expect(thread(win, '#2').locator('.comments__replies-toggle')).toHaveAttribute('aria-expanded', 'false')
  await expect(itemByMark(win, '#2.1')).toHaveCount(0)
  await block(win).locator('.comments__tool', { hasText: 'Expand all' }).click()
  await expect(itemByMark(win, '#2.1')).toBeVisible()
  await expect(first.locator('.comments__body')).toContainText('line two')
})

test('step 4 — Delete asks first; a parent takes its reply; the last delete removes the key and leaves the body as written', async () => {
  await itemByMark(win, '#2').hover()
  await itemByMark(win, '#2').locator('.comments__action--danger').click()
  await expect(sheet(win)).toHaveText(/Delete comment #2 and its reply\? This cannot be undone\./)
  await sheet(win).locator('.confirm__btn--danger').click()
  await expect(header(win)).toContainText('Comments (1)')
  await expect.poll(async () => (await onDisk()).comments?.map((c) => c.n)).toEqual([1])

  await itemByMark(win, '#1').hover()
  await itemByMark(win, '#1').locator('.comments__action--danger').click()
  await expect(sheet(win)).toHaveText(/Delete comment #1\? This cannot be undone\./)
  await sheet(win).locator('.confirm__btn--danger').click()
  await expect(header(win).locator('.comments__count')).toHaveCount(0)
  // 🔒 D7: the key goes, never a `comments: []` (the emptied block stays, GRO-2216); the body is as written.
  await expect.poll(async () => /^comments:/m.test(splitFrontmatter(await readFile(notePath, 'utf8')).frontmatter)).toBe(false)
  expect((await onDisk()).body).toBe(BODY)
  await shoot(win, 'comments-03-all-deleted')
})
