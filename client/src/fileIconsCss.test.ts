/**
 * The file and folder icons' CSS contract (YAZ-3440 D4, D5, D8, D9, D11): which rule draws a row's icon for each icon
 * set and style, in the tree and in a `.file-icon` outside it. The rules come from the real sheet; jsdom matches
 * their selectors against rows built as Tree.tsx and FileIcon.tsx build them. jsdom has no paint, so this proves
 * which rule applies, not the look.
 */
import { describe, expect, it } from 'vitest'
import { SIDEBAR_ICON_KINDS } from '@shared/types'
import appCss from './app.css?inline'
import { SIDEBAR_ICON_SWATCHES } from './settings/options'

const css = appCss.replace(/\/\*.*?\*\//gs, '')
/** A selector list split at its top-level commas, so an `:is(a, b)` stays whole. */
function selectorList(list: string): string[] {
  const out: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < list.length; i++) {
    if (list[i] === '(') depth++
    else if (list[i] === ')') depth--
    else if (list[i] === ',' && depth === 0) {
      out.push(list.slice(start, i).trim())
      start = i + 1
    }
  }
  return [...out, list.slice(start).trim()]
}
/** Every flat rule of the sheet: each selector of its list, and its body. */
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selectors: selectorList(selector), body }))
const at = (body: string) => css.indexOf(body)

/** The three ways an icon draws: the Line set's glyph (a mask of `--kind-icon`), Material's image, and the grey silhouette (a mask of `--icon`). */
const LINE = rules.find((rule) => /mask:\s*var\(--kind-icon\)/.test(rule.body))
const IMAGE = rules.find((rule) => /background:\s*var\(--icon\) center/.test(rule.body))
const SILHOUETTE = rules.find((rule) => /background:\s*var\(--fg-muted\);/.test(rule.body) && /mask:\s*var\(--icon\)/.test(rule.body))
/** The Line set's colour for a note: "All colour" alone. */
const NOTE_COLOUR = rules.find((rule) => /--kind-color:\s*var\(--kind-note\)/.test(rule.body))

type App = { set: 'material' | 'line'; files: 'quiet' | 'color' | 'grey' | 'off'; folders?: 'plain' | 'named' | 'off' }
type Row = { folder?: boolean; kind?: string; icon?: string; custom?: boolean }

/** The element that draws the icon: the tree row's label, or the `.file-icon` span itself (D11). */
function build(app: App, row: Row, where: 'tree' | 'outside'): Element {
  const shell = document.createElement('div')
  shell.className = 'app'
  shell.dataset.sidebarIconSet = app.set
  shell.dataset.sidebarFileIcons = app.files
  shell.dataset.sidebarFolderIcons = app.folders ?? 'plain'
  const ul = shell.appendChild(document.createElement('ul'))
  ul.className = 'tree'
  const li = ul.appendChild(document.createElement('li'))
  const el = li.appendChild(document.createElement(where === 'tree' ? 'button' : 'span'))
  el.className = where === 'tree' ? `tree__row tree__row--${row.folder === true ? 'dir' : 'file'}` : `file-icon file-icon--${row.folder === true ? 'dir' : 'file'}`
  if (row.kind !== undefined) el.setAttribute('data-kind', row.kind)
  if (row.icon !== undefined) el.setAttribute('data-icon', row.icon)
  if (row.custom === true) el.setAttribute('data-icon-custom', '')
  if (where === 'outside') return el
  const label = el.appendChild(document.createElement('span'))
  label.className = 'tree__label'
  return label
}

/** Whether a rule's `::before` applies to `el`. */
const draws = (rule: { selectors: string[] } | undefined, el: Element) => rule !== undefined && rule.selectors.some((s) => s.endsWith('::before') && el.matches(s.slice(0, -'::before'.length)))
/** How the icon draws, in both places; the tree and the `.file-icon` must agree (one `:is()` per rule). */
function look(app: App, row: Row): 'line' | 'image' | 'silhouette' | 'none' {
  const [tree, outside] = (['tree', 'outside'] as const).map((where) => {
    const el = build(app, row, where)
    if (draws(SILHOUETTE, el)) return draws(IMAGE, el) || draws(LINE, el) ? 'silhouette' : 'silhouette alone'
    if (draws(IMAGE, el)) return 'image'
    if (draws(LINE, el)) return 'line'
    return 'none'
  })
  expect(outside, 'the .file-icon draws as the tree row does').toBe(tree)
  expect(tree, 'a silhouette is a drawn icon, greyed').not.toBe('silhouette alone')
  return tree as 'line' | 'image' | 'silhouette' | 'none'
}

const README: Row = { kind: 'markdown', icon: 'readme' }
const NOTE: Row = { kind: 'markdown', icon: 'markdown' }
const TS: Row = { kind: 'text', icon: 'typescript' }
const FOLDER: Row = { folder: true, kind: 'folder', icon: 'folder-docs' }

describe('file and folder icons CSS contract (YAZ-3440 D4, D5)', () => {
  it('finds the three ways an icon draws, and the silhouette comes after the image and its light twin', () => {
    expect(LINE && IMAGE && SILHOUETTE && NOTE_COLOUR).toBeTruthy()
    const light = rules.find((rule) => /background-image:\s*var\(--icon-light, var\(--icon\)\)/.test(rule.body))
    expect(light).toBeDefined()
    expect(at(SILHOUETTE?.body ?? '')).toBeGreaterThan(at(light?.body ?? ''))
    expect(at(SILHOUETTE?.body ?? '')).toBeGreaterThan(at(IMAGE?.body ?? ''))
  })

  it('Material, "Colour" (`quiet`, the default): every note is a grey silhouette, README.md, SKILL.md and todo.md too; the other kinds and the folders keep their colours', () => {
    const quiet: App = { set: 'material', files: 'quiet' }
    expect(look(quiet, README)).toBe('silhouette')
    for (const icon of ['skill', 'todo', 'claude', 'changelog', 'agent']) expect(look(quiet, { kind: 'markdown', icon }), icon).toBe('silhouette')
    expect(look(quiet, NOTE)).toBe('silhouette')
    expect(look(quiet, TS)).toBe('image')
    expect(look(quiet, FOLDER)).toBe('image')
    // A note's own pick or a rule (D8, D9) is a deliberate choice: it keeps its colours.
    expect(look(quiet, { ...README, custom: true })).toBe('image')
  })

  it('Material, "All colour" colours notes too; "Grey" greys every file, not the folders; "Off" hides the files and keeps the folders', () => {
    expect(look({ set: 'material', files: 'color' }, README)).toBe('image')
    expect(look({ set: 'material', files: 'color' }, NOTE)).toBe('image')
    const grey: App = { set: 'material', files: 'grey' }
    expect(look(grey, TS)).toBe('silhouette')
    expect(look(grey, README)).toBe('silhouette')
    expect(look(grey, { ...TS, custom: true })).toBe('silhouette')
    expect(look(grey, FOLDER)).toBe('image')
    const off: App = { set: 'material', files: 'off' }
    expect(look(off, TS)).toBe('none')
    expect(look(off, { ...TS, custom: true })).toBe('none')
    expect(look(off, FOLDER)).toBe('image')
  })

  it("a board's extension (YAZ-3536 D4) is hidden while file icons show, and shows with File icons Off", () => {
    const shown = (files: App['files'], className = 'name-ending') => {
      const shell = document.createElement('div')
      shell.className = 'app'
      shell.dataset.sidebarFileIcons = files
      const ending = shell.appendChild(document.createElement('span'))
      ending.className = className
      // The last matching rule wins: the Off rule has the higher weight and comes after.
      const display = rules.filter((rule) => rule.selectors.some((s) => s.includes('.name-ending') && ending.matches(s))).map((rule) => /display:\s*(\w+)/.exec(rule.body)?.[1])
      return display.at(-1)
    }
    for (const files of ['quiet', 'color', 'grey'] as const) expect(shown(files), files).toBe('none')
    expect(shown('off')).toBe('inline')
    // A row that never has an icon (a Sessions row) shows it whatever the setting.
    for (const files of ['quiet', 'off'] as const) expect(shown(files, 'name-ending name-ending--always'), files).toBe('inline')
  })

  it('Folder icons Off (D5) hides the folders alone, a custom one too; the files keep theirs', () => {
    const app: App = { set: 'material', files: 'quiet', folders: 'off' }
    expect(look(app, FOLDER)).toBe('none')
    expect(look(app, { ...FOLDER, custom: true })).toBe('none')
    expect(look(app, TS)).toBe('image')
    expect(look({ set: 'line', files: 'quiet', folders: 'off' }, FOLDER)).toBe('none')
  })

  it("the Line set draws each kind's glyph; a pick or a rule shows its Material icon there too; only \"All colour\" colours a note", () => {
    const line: App = { set: 'line', files: 'quiet' }
    expect(look(line, TS)).toBe('line')
    expect(look(line, README)).toBe('line')
    expect(look(line, FOLDER)).toBe('line')
    expect(look(line, { ...TS, custom: true })).toBe('image')
    expect(look({ set: 'line', files: 'off' }, TS)).toBe('none')
    const colours = (files: App['files']) => draws({ selectors: NOTE_COLOUR?.selectors.map((s) => `${s}::before`) ?? [] }, build({ set: 'line', files }, NOTE, 'tree').closest('.tree__row') as Element)
    expect(colours('color')).toBe(true)
    expect(colours('quiet')).toBe(false)
  })

  it('a vault row, which has no `data-kind` and no `data-icon`, draws no icon in any set', () => {
    for (const set of ['material', 'line'] as const) expect(look({ set, files: 'color' }, { folder: true })).toBe('none')
  })

  it("the colour rows' built-in swatches (settings/options.ts, for a page with no sheet) are app.css's light colours", () => {
    const root = rules.find((rule) => rule.selectors.includes(':root'))?.body ?? ''
    const token = (name: string): string => {
      const value = new RegExp(`${name}:\\s*([^;]+);`).exec(root)?.[1].trim() ?? ''
      const ref = /^var\((--[\w-]+)\)$/.exec(value)
      return ref === null ? value : token(ref[1])
    }
    for (const kind of SIDEBAR_ICON_KINDS) expect(SIDEBAR_ICON_SWATCHES[kind], kind).toBe(token(`--kind-${kind}`))
  })
})
