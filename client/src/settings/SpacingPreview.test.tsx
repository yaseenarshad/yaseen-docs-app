import { readFileSync } from 'node:fs'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { CardSpacingPreview, PageSpacingPreview } from './SpacingPreview'
import { SETTINGS_SECTIONS } from './registry'

let root: Root
let el: HTMLElement
beforeEach(() => {
  el = document.createElement('div')
  document.body.append(el)
  root = createRoot(el)
})
afterEach(() => {
  act(() => root.unmount())
  el.remove()
})

it('YAZ-5050 round 2: the card preview is the card`s own render in the card`s classes — one word shown, one still hidden, a list with a child', () => {
  act(() => root.render(<CardSpacingPreview />))
  const card = el.querySelector('.spacing-preview .card > .card__body > .card__sides > .card__side')!
  expect(card).not.toBeNull()
  expect(card.querySelectorAll(':scope > p')).toHaveLength(3)
  expect(card.querySelector('.card__hidden')?.textContent).toBe('Seine')
  expect(card.querySelector('.card__blank')).not.toBeNull()
  expect(card.querySelector('li li')).not.toBeNull()
  expect(el.querySelector('.spacing-preview')?.getAttribute('aria-hidden')).toBe('true')
})

it('YAZ-5050 round 2: the page preview is a heading and paragraphs in the page editor`s classes', () => {
  act(() => root.render(<PageSpacingPreview />))
  expect(el.querySelectorAll('.spacing-preview .editor-instance .milkdown .ProseMirror > p')).toHaveLength(2)
  expect(el.querySelector('.spacing-preview .editor-instance .milkdown .ProseMirror > h3')).not.toBeNull()
})

it('YAZ-5050 round 2: the previews copy no text style — SpacingPreview.css styles only their box, so the page`s and the card`s own rules and variables draw the text', () => {
  const css = readFileSync(`${__dirname}/SpacingPreview.css`, 'utf8')
  const preview = css.slice(css.indexOf('.spacing-preview {'))
  expect(preview).not.toMatch(/line-height|--edit-|--card-/)
  expect(preview).not.toMatch(/\b(p|li|h3|\.card__side)\s*[{,]/)
})

it('YAZ-5050 round 2: Settings › Review is split into groups by purpose, every row kept; each spacing has its preview right after its rows', () => {
  const review = SETTINGS_SECTIONS.find((s) => s.id === 'review')!
  expect(review.groups.map((g) => g.title ?? null)).toEqual([null, null, null, 'Daily limits', 'Answers', 'Scheduling', 'Card look', null])
  expect(review.groups.map((g) => g.items.map((i) => i.id))).toEqual([
    ['enabled', 'cardSkillInSidebar'],
    ['cardCourse'],
    ['cardTips'],
    ['newPerDay', 'upNextPerDay', 'newOrder'],
    ['buttons', 'pauseAfter', 'timeSoFar'],
    ['retention', 'maxDays', 'fuzz', 'weights'],
    ['shownHiddenWords', 'markNextHidden', 'nextHiddenColour', 'cardSpacing', 'cardLineSpacing', 'cardBlockGap', 'cardBulletIndent', 'cardBulletGap', 'cardBulletSpace', 'cardSpacingPreview'],
    ['howCardsComeBack'],
  ])
  const spacing = SETTINGS_SECTIONS.find((s) => s.id === 'appearance')!.groups.find((g) => g.title === 'Spacing')!
  expect(spacing.items.map((i) => i.id)).toEqual(['lineSpacing', 'blockGap', 'pageSpacingPreview'])
  for (const preview of [spacing.items[2], review.groups[6].items[9]]) expect(preview.bare).toBe(true)
})
