// Opening a folder that sits inside a vault the app knows (YAZ-4922 🔒 D3, D4): one box asks how to open it.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { defaultFolderState } from '@shared/types'
import { FolderHomeSheet } from './FolderHomeSheet'
import { folderHome } from './folderHome'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

describe('folderHome: the vault a picked folder sits inside', () => {
  const vault = (path: string) => ({ path, name: path.slice(path.lastIndexOf('/') + 1), key: null, open: false, lastUsed: null })
  const known = [vault('/u/Main'), vault('/u/Main/Deep'), vault('/u/Other'), vault('/u/Main/Wiki/Old')]
  const folders = { '/u/Main/Wiki/Old': { ...defaultFolderState(), in: '/u/Main' } }

  it('the deepest vault the app knows that holds the folder; none for a vault inside no other, a folder of nothing, or a known folder of a vault', () => {
    expect(folderHome('/u/Main/Wiki', known, folders)).toBe('/u/Main')
    expect(folderHome('/u/Main/Deep/x', known, folders)).toBe('/u/Main/Deep')
    expect(folderHome('/u/Main', known, folders)).toBeUndefined()
    // A folder opened as its own vault before sits inside another vault all the same: the box asks again (gap 2).
    expect(folderHome('/u/Main/Deep', known, folders)).toBe('/u/Main')
    expect(folderHome('/u/Mainland/x', known, folders)).toBeUndefined()
    expect(folderHome('/elsewhere', known, folders)).toBeUndefined()
    // A folder of a vault is no vault: nothing is "inside" it, and the folder itself opens as it is.
    expect(folderHome('/u/Main/Wiki/Old/sub', known, folders)).toBe('/u/Main')
    expect(folderHome('/u/Main/Wiki/Old', known, folders)).toBeUndefined()
  })
})

describe('FolderHomeSheet (D4): one box, "Open as a folder of <vault>" first', () => {
  let root: Root | null = null
  let el: HTMLElement | null = null
  afterEach(() => {
    act(() => root?.unmount())
    el?.remove()
    root = null
    el = null
  })
  const mount = () => {
    const answer = vi.fn()
    el = document.createElement('div')
    document.body.appendChild(el)
    root = createRoot(el)
    act(() => root?.render(<FolderHomeSheet folder="Wiki" vault="Main" onAnswer={answer} />))
    const buttons = () => [...(el?.querySelectorAll<HTMLButtonElement>('.confirm__btn') ?? [])]
    return { answer, buttons, el }
  }

  it('says where the folder is and asks, with three answers; the folder answer has the focus', () => {
    const { buttons, el: box } = mount()
    expect(box.querySelector('.confirm__text')?.textContent).toBe('This folder is inside Main. Open it as a folder of Main?')
    expect(buttons().map((b) => b.textContent)).toEqual(['Open as its own vault', 'Cancel', 'Open as a folder of Main'])
    expect(document.activeElement).toBe(buttons()[2])
    // The third answer takes the shared class that widens the box for three buttons on one row: without it the
    // left button stood outside the box (the demo vault, on screen).
    expect(buttons()[0].classList.contains('confirm__btn--other')).toBe(true)
  })

  it.each([
    ['Open as a folder of Main', 'folder'],
    ['Open as its own vault', 'vault'],
    ['Cancel', null],
  ])('%s answers %j', (label, said) => {
    const { answer, buttons } = mount()
    act(() => buttons().find((b) => b.textContent === label)?.click())
    expect(answer).toHaveBeenCalledExactlyOnceWith(said)
  })
})
