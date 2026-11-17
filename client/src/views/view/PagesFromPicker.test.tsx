/**
 * "Pages from [📁 Any folder ⌄]" (YAZ-4795 demo): a link column links to pages; its target only narrows them to one
 * folder's. A folder picker with search (no `[[…]]` to type) that still saves `target: "[[<folder id>]]"`. It is the
 * same control in Edit column and in Add column (`PropertyDefinitionEditor`, under a folder page's `LinkFoldersContext`);
 * with no folder page around, Add column keeps the old text box.
 */
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IndexRecord, PropertyDecl } from '@shared/types'
import { TEST_RECORDS } from '../testRecords'
import { LinkFoldersContext, PagesFromPicker, type LinkFolders } from './PagesFromPicker'
import { PropertyDefinitionEditor } from './PropertyDefinitionEditor'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const folder = (dir: string, title: string, id?: string): IndexRecord =>
  ({ ...TEST_RECORDS[0], path: `/vault/${dir}/.folder.md`, folder: dir, title, basename: '.folder', ...(id !== undefined && { id }) }) as IndexRecord
const FOLDERS = [folder('Recipes/Desserts', 'Desserts', 'DEMO-1043'), folder('Recipes', 'Recipes', 'DEMO-1048'), folder('Tools', 'Tools')]
/** `[[DEMO-1043]]`, `[[Desserts]]` → the folder file; anything else reaches nothing. */
const resolveLink: LinkFolders['resolveLink'] = (target: string) => {
  const hit = FOLDERS.find((f) => f.id === target || f.title === target)
  return hit === undefined ? null : hit.path
}
const SOURCE: LinkFolders = { folders: FOLDERS, resolveLink }

let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})
function render(node: React.ReactNode) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root!.render(node))
}
const trigger = () => host!.querySelector<HTMLButtonElement>('.type-picker__trigger')!
const options = () => [...host!.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
const optionText = () => options().map((o) => `${o.querySelector('.type-picker__name')!.textContent} (${o.querySelector('.type-picker__about')!.textContent})${o.getAttribute('aria-checked') === 'true' ? ' ✓' : ''}`)
function picker(target: string | undefined) {
  const onPick = vi.fn()
  render(<PagesFromPicker target={target} label="Pairs with" source={SOURCE} onPick={onPick} />)
  return onPick
}

describe('YAZ-4795 demo: PagesFromPicker', () => {
  it('YAZ-4795 demo: no target reads "Any folder"; the list is Any folder, then every folder by path, each with its path under it', () => {
    picker(undefined)
    expect(trigger().textContent).toContain('Any folder')
    act(() => trigger().click())
    expect(optionText()).toEqual(['Any folder (Link to any page in the vault) ✓', 'Recipes (Recipes)', 'Desserts (Recipes/Desserts)', 'Tools (Tools)'])
  })

  it("YAZ-4795 demo: a pick saves the folder by its id when it has one, else by its title", () => {
    const onPick = picker(undefined)
    act(() => trigger().click())
    act(() => options()[2].click())
    expect(onPick).toHaveBeenLastCalledWith('[[DEMO-1043]]')
    act(() => trigger().click())
    act(() => options()[3].click())
    expect(onPick).toHaveBeenLastCalledWith('[[Tools]]')
  })

  it('YAZ-4795 demo: a saved target by id or by title shows its folder, checked', () => {
    picker('[[DEMO-1043]]')
    expect(trigger().textContent).toContain('Desserts')
    act(() => root!.unmount())
    host!.remove()
    picker('[[Desserts]]')
    expect(trigger().textContent).toContain('Desserts')
    act(() => trigger().click())
    expect(optionText()).toContain('Desserts (Recipes/Desserts) ✓')
  })

  it('YAZ-4795 demo: Any folder clears the target (undefined); picking the current one writes nothing', () => {
    const onPick = picker('[[DEMO-1043]]')
    act(() => trigger().click())
    act(() => options()[2].click())
    expect(onPick).not.toHaveBeenCalled()
    act(() => trigger().click())
    act(() => options()[0].click())
    expect(onPick).toHaveBeenCalledExactlyOnceWith(undefined)
  })

  it('YAZ-4795 demo: a target that reaches no folder shows its text', () => {
    picker('[[Gone]]')
    expect(trigger().textContent).toContain('Gone')
  })

  it('YAZ-4795 demo: search keeps the matches, by name or path; Enter picks the first', () => {
    const onPick = picker(undefined)
    act(() => trigger().click())
    const search = host!.querySelector<HTMLInputElement>('input[type="search"]')!
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    act(() => {
      set.call(search, 'dess')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(optionText()).toEqual(['Desserts (Recipes/Desserts)'])
    act(() => void search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })))
    expect(onPick).toHaveBeenCalledExactlyOnceWith('[[DEMO-1043]]')
  })
})

describe('YAZ-4795 demo: Add column has the same picker on a folder page', () => {
  function editor(withFolders: boolean) {
    const change = vi.fn()
    function Harness() {
      const [value, setValue] = useState<PropertyDecl>({ kind: 'link' })
      const editorEl = (
        <PropertyDefinitionEditor
          value={value}
          onChange={(next) => {
            change(next)
            setValue(next)
          }}
        />
      )
      return withFolders ? <LinkFoldersContext.Provider value={SOURCE}>{editorEl}</LinkFoldersContext.Provider> : editorEl
    }
    render(<Harness />)
    return change
  }

  it('YAZ-4795 demo: a Link column on a folder page shows "Pages from" with the folder picker; a pick sets target', () => {
    const change = editor(true)
    expect(host!.querySelector('.property-def__target')!.textContent).toContain('Pages from')
    expect(host!.querySelector('input[aria-label="Link target"]')).toBeNull()
    act(() => trigger().click())
    act(() => options()[1].click())
    expect(change).toHaveBeenLastCalledWith({ kind: 'link', target: '[[DEMO-1048]]' })
    act(() => trigger().click())
    act(() => options()[0].click())
    expect(change).toHaveBeenLastCalledWith({ kind: 'link' })
  })

  it('YAZ-4795 demo: with no folder page around, the old Link to text box stays', () => {
    editor(false)
    expect(host!.querySelector('input[aria-label="Link target"]')).not.toBeNull()
    expect(host!.querySelector('.type-picker__trigger')).toBeNull()
  })
})
