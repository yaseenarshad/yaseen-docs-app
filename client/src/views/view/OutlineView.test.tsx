/**
 * A folder's OUTLINE view (YAZ-903, YAZ-2290 D5). Mounted through the REAL host (`FolderView` →
 * `ViewsPane`), the same harness the host's own tests use, so the routing — `type: outline` shows
 * the editor — is proven by the editor appearing at all, and every write travels the real door it
 * will travel in the app.
 *
 * `OutlineEditor` itself is STUBBED here (a real Crepe instance in jsdom is slow, and the lock, the
 * seeding and the debounce are pinned next door in `OutlineEditor.test.tsx`): the stub renders the
 * markdown it was handed and hands back the `onChange` a debounced edit would call.
 *
 * Pinned here: the document is `view.outline` and nothing is put into it; one edit is ONE settings
 * write; and it is a PLAIN document — a link line that appears, vanishes or starts resolving
 * writes no note and asks nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import type { IndexRecord } from '@shared/types'
import { resolverFor } from '../engine'
import { createWikilinkResolveSource, type MutableWikilinkResolveSource } from '../../editor/wikilink/wikilinkPlugin'
import { flush, q, rec, renderFolderView, unmountFolderView } from '../testFolderView'
import type { OutlineEditorProps } from './OutlineEditor'

vi.mock('../writeProperty', () => ({ writeProperty: vi.fn() }))
/** The editor, stubbed: what it was seeded with, and the door a debounced edit comes back through. */
const editor = vi.hoisted(() => ({ props: null as OutlineEditorProps | null }))
vi.mock('./OutlineEditor', () => ({
  OutlineEditor: (props: OutlineEditorProps) => {
    editor.props = props
    return (
      <div className="view-outline-editor" tabIndex={0}>
        <pre className="outline-doc">{props.markdown}</pre>
      </div>
    )
  },
}))

import { writeProperty } from '../writeProperty'

const write = vi.mocked(writeProperty)

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

// ---------- the vault ----------

const STAGES = '/vault/stages'
const SETTINGS_FILE = '/vault/stages/.folder.md'

const OUTLINE = { type: 'outline', name: 'Outline' }
const TABLE = { type: 'table', name: 'Table', order: ['file.name'] }
const SETTINGS = { views: [OUTLINE, TABLE] }
const withOutline = (outline: string) => ({ views: [{ ...OUTLINE, outline }, TABLE] })

/** The folder's three notes, and one page elsewhere in the vault. */
const vault = (): IndexRecord[] => [rec('/vault/Other.md'), rec('/vault/stages/Lead Gen.md'), rec('/vault/stages/Nurture.md'), rec('/vault/stages/Sales.md')]

// ---------- harness (FolderView.test.tsx's) ----------

let source: MutableWikilinkResolveSource
const onOpenFile = vi.fn()
const onOpenFileBackground = vi.fn()

function feed(settings: unknown = SETTINGS, records: IndexRecord[] = vault()): void {
  const resolve = resolverFor(records, '/vault')
  act(() => source.update((target) => resolve(target)?.record.path ?? null, records, [rec(SETTINGS_FILE, { folder_page_settings: settings })]))
}

async function mount(settings: unknown = SETTINGS): Promise<HTMLElement> {
  const el = renderFolderView({ path: STAGES, source, onOpenFile, onOpenFileBackground })
  feed(settings)
  await flush()
  return el
}

beforeEach(() => {
  source = createWikilinkResolveSource()
  editor.props = null
  write.mockResolvedValue({ mtime: 2 })
})

afterEach(() => {
  unmountFolderView()
  vi.resetAllMocks()
})

// ---------- DOM helpers ----------

const all = <T extends Element>(el: ParentNode, sel: string): T[] => [...el.querySelectorAll<T>(sel)]
const texts = (el: ParentNode, sel: string): string[] => all(el, sel).map((n) => n.textContent ?? '')
/** The document the editor was handed. */
const doc = (el: ParentNode): string => q(el, '.outline-doc').textContent ?? ''
/** One committed edit — what the editor's debounce hands back. */
const edit = (markdown: string): void => act(() => editor.props?.onChange(markdown))

function click(el: Element): void {
  act(() => void el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
}

// ---------- routing ----------

describe('the outline is one of a folder’s skins', () => {
  it('a `type: outline` view renders the EDITOR, not the placeholder rows', async () => {
    const el = await mount()
    expect(el.querySelector('.view-outline')).not.toBeNull()
    expect(el.querySelector('.outline-doc')).not.toBeNull()
    expect(el.querySelector('.view-row__link')).toBeNull() // the old unknown-view placeholder
    expect(texts(el, '.view-tab__btn')).toEqual(['Outline', 'Table']) // the settings' own views, verbatim
  })

  it('the Properties menu, search and "Sync from folder" are not offered while it shows — a document has no columns and no rows', async () => {
    const el = await mount()
    expect(el.querySelector('[aria-label="Properties"]')).toBeNull()
    expect(el.querySelector('[aria-label="Search"]')).toBeNull()
    expect(el.querySelector('[aria-label="Sync from folder"]')).toBeNull()
    const tab = all<HTMLElement>(el, '.view-tab__btn').find((b) => b.textContent === 'Table')!
    click(tab)
    expect(el.querySelector('[aria-label="Properties"]')).not.toBeNull() // the table keeps both
    expect(el.querySelector('[aria-label="Search"]')).not.toBeNull()
  })

  it('the editor is handed the window’s link feed, and a nav whose identity survives a re-render', async () => {
    const el = await mount()
    const first = editor.props
    expect(el.querySelector('.ProseMirror')).toBeNull() // the stub stands in the real editor's place
    feed(SETTINGS, [...vault(), rec('/vault/Late.md')])
    // A new snapshot re-renders the view; a NEW nav object would remount the editor and eat the caret.
    expect(editor.props?.nav).toBe(first?.nav)
    expect(editor.props?.nav?.openCurrent).toBe(onOpenFile)
    expect(editor.props?.nav?.openBackground).toBe(onOpenFileBackground)
    expect(editor.props?.wikilinks).toBe(source)
  })
})

// ---------- the document (🔒 D2) ----------

describe('the document comes from the settings, and only from there', () => {
  it('a stored `outline` is the document, verbatim', async () => {
    const stored = '- [[Sales]]\n    - a note about it\n- free text'
    expect(doc(await mount(withOutline(stored)))).toBe(stored)
    expect(write).not.toHaveBeenCalled()
  })

  it('no `outline` is an EMPTY document: the folder’s notes are not written into it', async () => {
    const el = await mount()
    await flush()
    expect(doc(el)).toBe('')
    feed(SETTINGS, [...vault(), rec('/vault/stages/Expansion.md')]) // a note arriving adds no line either
    await flush()
    expect(doc(el)).toBe('')
    expect(write).not.toHaveBeenCalled()
  })
})

// ---------- the disk moving under the open folder (YAZ-1356) ----------

describe('a document changed OUTSIDE the app reaches the editor', () => {
  const stored = '- [[Sales]]\n- [[Lead Gen]]'

  it('a new `outline` that is not the last committed document is handed to the editor', async () => {
    const el = await mount(withOutline(stored))
    feed(withOutline(`${stored}\n- typed by an AI`))
    expect(doc(el)).toBe(`${stored}\n- typed by an AI`)
    expect(write).not.toHaveBeenCalled() // looking at the disk writes nothing
  })

  it('the index echoing the document this component just committed changes nothing', async () => {
    const el = await mount(withOutline(stored))
    edit(`${stored}\n- mine`)
    await flush()
    expect(write).toHaveBeenCalledTimes(1)
    feed(withOutline(`${stored}\n- mine`))
    expect(doc(el)).toBe(`${stored}\n- mine`)
    expect(write).toHaveBeenCalledTimes(1)
  })
})

// ---------- the commit ----------

describe('an edit stores the document', () => {
  it('it lands on the FIRST outline view — ONE settings write, on the folder’s own file', async () => {
    const el = await mount()
    edit('- [[Sales]]\n- [[Lead Gen]]')
    await flush()
    expect(write).toHaveBeenCalledExactlyOnceWith(SETTINGS_FILE, 'folder_page_settings', {
      views: [{ type: 'outline', name: 'Outline', outline: '- [[Sales]]\n- [[Lead Gen]]' }, TABLE],
    })
    expect(el.querySelector('.views-pane__error')).toBeNull()
  })

  it('a link is just a link (D5): a link line appearing, vanishing or starting to resolve writes no note and asks nothing', async () => {
    await mount(withOutline('- [[Sales]]\n- [[Not yet]]'))
    edit('- [[Other]]\n- [[Not yet]]') // Other appears, Sales vanishes
    await flush()
    feed(withOutline('- [[Other]]\n- [[Not yet]]'), [...vault(), rec('/vault/Not yet.md')]) // the dangling line now resolves
    await flush()
    expect(write.mock.calls.map(([path]) => path)).toEqual([SETTINGS_FILE]) // the document, and nothing else
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  })
})

describe('the seed-loss banner (YAZ-974): the editor reports, the view warns', () => {
  it('shows the read-only explanation when the editor reports a lossy seed', async () => {
    const el = await mount()
    expect(editor.props?.onSeedLoss).toBeTypeOf('function')
    act(() => editor.props?.onSeedLoss?.())
    const alert = el.querySelector('.views-pane__error')
    expect(alert?.textContent ?? '').toMatch(/read-only/i)
    expect(alert?.textContent ?? '').toMatch(/file/i)
  })
})
