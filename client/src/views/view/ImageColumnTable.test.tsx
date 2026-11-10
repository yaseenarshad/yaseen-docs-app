/**
 * The Image column in a folder page's table (YAZ-4802 demo), ViewsPane mounted in jsdom: a cell with a picture shows
 * an `<img>` at the column's size and shape, an empty cell shows no text (no cut "Em…"), an Image column never takes
 * the group indent (the next column does), and it can be dragged as narrow as its picture plus the two paddings.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IndexRecord } from '@shared/types'
import { type ParsedViews, parseViews } from '../viewSchema'
import { ViewsPane } from '../ViewsPane'
import { testFolderHost } from '../testFolderHost'
import { TEST_RECORDS } from '../testRecords'
import type { FolderSettings } from '../folderSettings'

vi.mock('../../lib/storage', () => ({ storage: { getViewGroups: () => [], setViewGroups: () => undefined, getSettings: () => undefined, getRoots: () => ['/vault'] } }))
;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const note = (name: string, properties: Record<string, unknown>): IndexRecord =>
  ({ ...TEST_RECORDS[0], path: `/vault/Tools/${name}.md`, name: `${name}.md`, basename: name, title: name, folder: 'Tools', properties }) as IndexRecord
const RECORDS = [
  note('React', { Logo: '[[assets/images/react.png]]', status: 'live' }),
  note('Vercel', { Logo: '[[assets/images/vercel.svg]]', status: 'live' }),
  note('Cloudflare', { status: 'idea' }),
]

let root: Root | null = null
let container: HTMLElement | null = null
let draw: () => void = () => {}

function mount(yaml: string, logo: FolderSettings['columns'][string] = { kind: 'image' }) {
  let parsed = parseViews(yaml)
  const settings: FolderSettings = { columns: { Logo: logo, status: { kind: 'text' } }, views: [], problems: [] }
  const folder = testFolderHost({ settings, vaultRecords: RECORDS })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const onChange = vi.fn((next: ParsedViews) => {
    parsed = next
  })
  draw = () => act(() => root?.render(<ViewsPane parsed={parsed} onChange={onChange} root="/vault" folderPath="/vault/Tools/.folder.md" records={RECORDS} folder={folder} onOpenFile={vi.fn()} />))
  draw()
  return { el: container, def: () => parsed.def }
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

const table = (extra = '') => `views:
  - type: table
    name: T
    order:
      - note.Logo
      - file.name
      - note.status
    sort:
      - property: file.name
        direction: ASC
${extra}`

/** The body cells of column `c`, in row order (the group header rows have no `data-cell`). */
const column = (el: ParentNode, c: number) => [...el.querySelectorAll<HTMLElement>(`.view-table tbody td[data-cell$=":${c}"]`)]
function mouse(target: EventTarget, type: string, clientX: number): void {
  act(() => void target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX })))
  draw()
}

describe('YAZ-4802 demo: an Image cell in the table', () => {
  it('YAZ-4802 demo: a cell with a picture shows an <img> of that vault file; an empty cell shows no text', () => {
    const { el } = mount(table())
    const cells = column(el, 0)
    expect(cells).toHaveLength(3)
    // Sorted A to Z: Cloudflare (no picture), React, Vercel.
    expect(cells[0].querySelector('img')).toBeNull()
    expect(cells[0].querySelector('.image-cell__empty')).not.toBeNull()
    expect(cells[0].textContent).toBe('')
    const react = cells[1].querySelector<HTMLImageElement>('img.image-thumb')
    expect(react).not.toBeNull()
    expect(react!.getAttribute('src')).toContain('assets/images/react.png')
    expect(cells[2].querySelector('img')!.getAttribute('src')).toContain('assets/images/vercel.svg')
  })

  it('YAZ-4802 demo: the picture is drawn at the default 18px, as is', () => {
    const { el } = mount(table())
    const img = column(el, 0)[1].querySelector<HTMLImageElement>('img.image-thumb')!
    expect(img.style.width).toBe('18px')
    expect(img.style.height).toBe('18px')
    expect(img.classList.contains('image-thumb--as-is')).toBe(true)
  })

  it("YAZ-4802 demo: the column's size and shape draw the picture", () => {
    const { el } = mount(table(), { kind: 'image', size: 32, shape: 'circle' })
    const img = column(el, 0)[1].querySelector<HTMLImageElement>('img.image-thumb')!
    expect(img.style.width).toBe('32px')
    expect(img.classList.contains('image-thumb--circle')).toBe(true)
  })
})

describe('YAZ-4802 demo: an Image column never takes the group indent', () => {
  const grouped = table(`    groupBy:
      property: note.status
`)

  it('YAZ-4802 demo: grouped with the Image column first, the next column (Name) carries the indent', () => {
    const { el } = mount(grouped)
    expect(column(el, 0).length).toBeGreaterThan(0)
    expect(column(el, 0).some((td) => td.classList.contains('view-table__indent'))).toBe(false)
    expect(column(el, 1).every((td) => td.classList.contains('view-table__indent'))).toBe(true)
  })

  it('YAZ-4802 demo: with Name first, Name keeps the indent as before', () => {
    const { el } = mount(`views:
  - type: table
    name: T
    order:
      - file.name
      - note.Logo
    groupBy:
      property: note.status
`)
    expect(column(el, 0).every((td) => td.classList.contains('view-table__indent'))).toBe(true)
    expect(column(el, 1).some((td) => td.classList.contains('view-table__indent'))).toBe(false)
  })
})

describe('YAZ-4802 demo: an Image column goes as narrow as its picture', () => {
  it('YAZ-4802 demo: dragged far left, an Image column stops at its picture plus 16 (18 → 34px)', () => {
    const { el, def } = mount(table())
    mouse(el.querySelectorAll('.view-table__resize')[0], 'mousedown', 300)
    mouse(window, 'mousemove', 0)
    mouse(window, 'mouseup', 0)
    expect(def().views[0].columnSize).toEqual({ 'note.Logo': 34 })
  })

  it('YAZ-4802 demo: at size 40 it stops at 56px', () => {
    const { el, def } = mount(table(), { kind: 'image', size: 40 })
    mouse(el.querySelectorAll('.view-table__resize')[0], 'mousedown', 300)
    mouse(window, 'mousemove', 0)
    mouse(window, 'mouseup', 0)
    expect(def().views[0].columnSize).toEqual({ 'note.Logo': 56 })
  })

  it('YAZ-4802 demo: a text column keeps its 60px minimum', () => {
    const { el, def } = mount(table())
    mouse(el.querySelectorAll('.view-table__resize')[2], 'mousedown', 300)
    mouse(window, 'mousemove', 0)
    mouse(window, 'mouseup', 0)
    expect(def().views[0].columnSize).toEqual({ 'note.status': 60 })
  })
})
