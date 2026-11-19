import { describe, expect, it } from 'vitest'
import appCss from '../app.css?inline'
import liftCss from './rowLift.css?inline'

/** Every rule of a sheet outside its at-rules' blocks is enough here: each selector of its list, and its body. */
const rulesOf = (css: string): { selectors: string[]; body: string }[] =>
  [...css.replace(/\/\*.*?\*\//gs, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selectors: selector.split(',').map((s) => s.trim()), body }))

/** A simple selector's weight: [ids, classes + attributes + pseudo-classes, elements and pseudo-elements], as one number to compare. */
const weightOf = (selector: string): number => {
  // `:not(x)` weighs what x weighs; an attribute weighs a class; a pseudo-element weighs an element.
  const plain = selector.replace(/\[[^\]]*\]/g, '.x').replace(/:not\(/g, '(').replace(/::[\w-]+/g, ' e')
  const ids = (plain.match(/#[\w-]+/g) ?? []).length
  const classes = (plain.match(/[.:][\w-]+/g) ?? []).length
  const elements = (plain.match(/(?:^|[\s>+~(])[a-z][\w-]*/gi) ?? []).length
  return ids * 10000 + classes * 100 + elements
}

/**
 * Bug YAZ-5936: a row lifted to the top of a folder must paint over that folder's own sticky row. jsdom paints
 * nothing, so this reads the sheets: the paint order is in the CSS alone.
 */
describe('the lifted row stands over its folder\'s sticky row (YAZ-5936)', () => {
  const app = rulesOf(appCss)
  const lift = rulesOf(liftCss)
  const bodyOf = (rules: typeof app, selector: string) => rules.filter((rule) => rule.selectors.includes(selector)).map((rule) => rule.body).join('\n')
  // The sticky folder row: z 10 at the top level, less one for each level down.
  const stickyZ = Number(/z-index:\s*calc\((\d+) - var\(--tree-depth, 0\)\);/.exec(bodyOf(app, ".tree > li[aria-expanded='true'] > .tree__row--sticky"))?.[1])
  // With the thread lines, each folder's list is its own stacking context at z 3, and it clips what pokes above it.
  const THREAD_GROUP = ".app[data-sidebar-line-style='thread'] .tree[role='group']"
  const thread = bodyOf(app, THREAD_GROUP)

  it('the sheets still have the two rules that put a folder\'s list under its folder row', () => {
    expect(stickyZ).toBe(10)
    expect(thread).toMatch(/z-index:\s*3;/)
    expect(thread).toMatch(/overflow-y:\s*clip;/)
  })

  it('a folder\'s list that holds a lifted row stands over every sticky row and clips nothing, in both line styles', () => {
    const rule = lift.find((r) => r.selectors.some((s) => s.endsWith(".tree[role='group'][data-lift-list]")))
    expect(rule).toBeDefined()
    const selector = rule!.selectors.find((s) => s.endsWith(".tree[role='group'][data-lift-list]"))!
    // It must win over the thread rule, whatever the order of the sheets.
    expect(weightOf(selector)).toBeGreaterThan(weightOf(THREAD_GROUP))
    expect(Number(/z-index:\s*(\d+);/.exec(rule!.body)?.[1])).toBeGreaterThan(stickyZ)
    expect(rule!.body).toMatch(/overflow-y:\s*visible;/)
  })

  it('while the list does not clip, the thread pieces of its rows do not show (each one reaches far above its row)', () => {
    const piece = ".app[data-sidebar-line-style='thread']:not([data-sidebar-lines='off']) .sidebar__body .tree[role='group'] > li:hover::before"
    expect(bodyOf(app, piece)).toMatch(/opacity:\s*1;/)
    const rule = lift.find((r) => r.selectors.some((s) => s.endsWith(".tree[role='group'][data-lift-list] > li::before")))
    expect(rule).toBeDefined()
    const selector = rule!.selectors.find((s) => s.endsWith('> li::before'))!
    expect(rule!.body).toMatch(/opacity:\s*0( !important)?;/)
    if (!/!important/.test(rule!.body)) expect(weightOf(selector)).toBeGreaterThan(weightOf(piece))
  })
})
