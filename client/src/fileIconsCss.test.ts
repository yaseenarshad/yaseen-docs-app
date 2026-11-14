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
/** The Line set's colour for a note: "All colour", or a picked one. */
const NOTE_COLOUR = rules.find((rule) => /--kind-color:\s*var\(--kind-note\)/.test(rule.body))
/** YAZ-5100 round 2: Material's page icon (a sheet with lines, in the note's colour), and a picked colour on Material's icon (its silhouette). */
const PAGE = rules.find((rule) => rule.selectors.some((sel) => sel.includes("[data-icon='markdown']")) && /mask:\s*var\(--kind-icon\)/.test(rule.body))
const PICKED = rules.find((rule) => /background:\s*var\(--kind-color\);/.test(rule.body) && /mask:\s*var\(--icon\)/.test(rule.body))

type App = { set: 'material' | 'line'; files: 'quiet' | 'color' | 'grey' | 'off'; folders?: 'plain' | 'named' | 'off'; colors?: string }
type Row = { folder?: boolean; kind?: string; icon?: string; custom?: boolean }

/** The element that draws the icon: the tree row's label, or the `.file-icon` span itself (D11). */
function build(app: App, row: Row, where: 'tree' | 'outside'): Element {
  const shell = document.createElement('div')
  shell.className = 'app'
  shell.dataset.sidebarIconSet = app.set
  shell.dataset.sidebarFileIcons = app.files
  shell.dataset.sidebarFolderIcons = app.folders ?? 'plain'
  if (app.colors !== undefined) shell.dataset.iconColors = app.colors
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
function look(app: App, row: Row): 'line' | 'image' | 'silhouette' | 'page' | 'picked' | 'none' {
  const [tree, outside] = (['tree', 'outside'] as const).map((where) => {
    const el = build(app, row, where)
    // After the others and heavier: each wins where it applies (YAZ-5100 round 2).
    if (draws(PAGE, el)) return 'page'
    if (draws(PICKED, el)) return draws(IMAGE, el) ? 'picked' : 'picked alone'
    if (draws(SILHOUETTE, el)) return draws(IMAGE, el) || draws(LINE, el) ? 'silhouette' : 'silhouette alone'
    if (draws(IMAGE, el)) return 'image'
    if (draws(LINE, el)) return 'line'
    return 'none'
  })
  expect(outside, 'the .file-icon draws as the tree row does').toBe(tree)
  expect(tree, 'a silhouette is a drawn icon, greyed').not.toBe('silhouette alone')
  expect(tree, 'a picked colour is a drawn icon, coloured').not.toBe('picked alone')
  return tree as 'line' | 'image' | 'silhouette' | 'page' | 'picked' | 'none'
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

  it('Material, "Colour" (`quiet`, the default): a note with a name icon is a grey silhouette (README.md, SKILL.md, todo.md), a plain note the grey page; the other kinds and the folders keep their colours', () => {
    const quiet: App = { set: 'material', files: 'quiet' }
    expect(look(quiet, README)).toBe('silhouette')
    for (const icon of ['skill', 'todo', 'claude', 'changelog', 'agent']) expect(look(quiet, { kind: 'markdown', icon }), icon).toBe('silhouette')
    expect(look(quiet, NOTE)).toBe('page')
    expect(look(quiet, TS)).toBe('image')
    expect(look(quiet, FOLDER)).toBe('image')
    // A note's own pick or a rule (D8, D9) is a deliberate choice: it keeps its colours.
    expect(look(quiet, { ...README, custom: true })).toBe('image')
  })

  it('Material, "All colour" colours notes too; "Grey" greys every file, not the folders; "Off" hides the files and keeps the folders', () => {
    expect(look({ set: 'material', files: 'color' }, README)).toBe('image')
    expect(look({ set: 'material', files: 'color' }, NOTE)).toBe('page')
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

  it('YAZ-5100 round 2: a note with Material\'s default icon is the page (a sheet with lines) in every style but Off; a name icon of its own or a pick keeps Material\'s', () => {
    expect(PAGE && PICKED).toBeTruthy()
    // After the image, its light twin and the silhouette: it wins over each where it applies.
    expect(rules.indexOf(PAGE!)).toBeGreaterThan(rules.indexOf(SILHOUETTE!))
    expect(rules.indexOf(PICKED!)).toBeGreaterThan(rules.indexOf(SILHOUETTE!))
    for (const files of ['quiet', 'color', 'grey'] as const) expect(look({ set: 'material', files }, NOTE), files).toBe('page')
    expect(look({ set: 'material', files: 'off' }, NOTE)).toBe('none')
    expect(look({ set: 'material', files: 'quiet' }, README)).toBe('silhouette')
    expect(look({ set: 'material', files: 'quiet' }, { ...NOTE, custom: true })).toBe('image')
    // The Line set draws the same page, its note glyph.
    expect(look({ set: 'line', files: 'quiet' }, NOTE)).toBe('line')
    const page = rules.find((rule) => rule.selectors.some((sel) => sel.endsWith("[data-kind='markdown']")) && /--kind-icon/.test(rule.body))
    expect(decodeURIComponent(page?.body ?? '')).toContain("<path d='M3.5 2.5a1 1 0 0 1 1-1h5l3 3v9a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1zM9.5 1.5v3h3M5.75 8h4.5M5.75 10.75h4.5'/>")
  })

  it('YAZ-5100 round 2: a picked colour draws Material\'s drawing, diagram and default folder in it; none picked, Grey, Off or an icon of its own keep theirs', () => {
    const DRAWING: Row = { kind: 'drawing', icon: 'excalidraw' }
    const DIAGRAM: Row = { kind: 'diagram', icon: 'drawio' }
    const PLAIN: Row = { folder: true, kind: 'folder', icon: 'folder' }
    const picked: App = { set: 'material', files: 'quiet', colors: 'drawing diagram folder' }
    expect(look(picked, DRAWING)).toBe('picked')
    expect(look(picked, DIAGRAM)).toBe('picked')
    expect(look(picked, PLAIN)).toBe('picked')
    expect(look(picked, { ...PLAIN, icon: 'folder-open' })).toBe('picked')
    expect(look(picked, FOLDER), 'a folder named for its own Material icon').toBe('image')
    expect(look(picked, { ...DRAWING, custom: true })).toBe('image')
    expect(look(picked, TS)).toBe('image')
    expect(look({ ...picked, colors: 'diagram' }, DRAWING)).toBe('image')
    expect(look({ set: 'material', files: 'quiet' }, PLAIN)).toBe('image')
    expect(look({ ...picked, files: 'grey' }, DRAWING)).toBe('silhouette')
    expect(look({ ...picked, files: 'off' }, DRAWING)).toBe('none')
    // The folder's colour is Folder icons': Grey greys the files alone.
    expect(look({ ...picked, files: 'grey' }, PLAIN)).toBe('picked')
    expect(look({ ...picked, folders: 'off' }, PLAIN)).toBe('none')
  })

  it('YAZ-5100 round 2: a picked note colour shows with "Colour" too; Grey keeps the files grey but not the folders, whose colour is `--kind-folder`', () => {
    const noteColour = (app: App) => draws({ selectors: NOTE_COLOUR?.selectors.map((s) => `${s}::before`) ?? [] }, build(app, NOTE, 'tree').closest('.tree__row') as Element)
    expect(noteColour({ set: 'material', files: 'quiet' })).toBe(false)
    expect(noteColour({ set: 'material', files: 'quiet', colors: 'note' })).toBe(true)
    expect(noteColour({ set: 'line', files: 'quiet', colors: 'card note' })).toBe(true)
    const GREY = rules.find((rule) => /--kind-color:\s*var\(--fg-muted\)/.test(rule.body))
    const greys = (row: Row) => draws({ selectors: GREY?.selectors.map((s) => `${s}::before`) ?? [] }, build({ set: 'line', files: 'grey' }, row, 'tree').closest('.tree__row') as Element)
    expect(greys(NOTE)).toBe(true)
    expect(greys({ kind: 'card' })).toBe(true)
    expect(greys(FOLDER)).toBe(false)
    const folderRule = rules.find((rule) => rule.selectors.some((s) => s.endsWith("[data-kind='folder']")) && /--kind-icon/.test(rule.body))
    expect(folderRule?.body).toMatch(/--kind-color:\s*var\(--kind-folder\)/)
  })

  it('YAZ-5100 round 2: the card icon is two stacked cards, one token for every place', () => {
    const root = rules.find((rule) => rule.selectors.includes(':root'))?.body ?? ''
    const card = /--card-link-icon:\s*url\("([^"]+)"\)/.exec(root)?.[1] ?? ''
    expect(decodeURIComponent(card)).toContain("<rect x='1.75' y='5.25' width='10' height='8' rx='1.25'/>")
    expect(decodeURIComponent(card)).toContain("<path d='M4.5 3h8.25a1.25 1.25 0 0 1 1.25 1.25v6.25'/>")
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
