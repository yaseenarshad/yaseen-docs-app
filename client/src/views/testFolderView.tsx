/**
 * What `FolderView.test.tsx` and `FolderView.page.test.tsx` share: a record under `/vault`, the
 * mount, and the DOM helpers. Each file keeps its own mocks and its own snapshot feed.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IndexRecord } from '@shared/types'
import { FolderView, type FolderViewProps } from './FolderView'

export const rec = (path: string, properties: Record<string, unknown> = {}, mtime = 1): IndexRecord => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const rel = path.slice('/vault/'.length)
  return {
    path,
    name,
    basename: name.replace(/\.md$/, ''),
    // A folder's settings file is titled with the folder's own name, as the scan titles it.
    title: name === '.folder.md' ? path.split('/').at(-2)! : name.replace(/\.md$/, ''),
    folder: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '',
    ext: 'md',
    size: 0,
    ctime: 0,
    mtime,
    properties,
    aliases: [],
    tags: [],
    links: [],
    embeds: [],
  }
}

let root: Root | null = null
let container: HTMLElement | null = null

/** Renders the folder view under `/vault`. The caller hands over the first snapshot, then awaits `flush`. */
export function renderFolderView(props: Pick<FolderViewProps, 'path' | 'source' | 'onOpenFile'> & Partial<FolderViewProps>): HTMLElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<FolderView root="/vault" commentsOrder="oldest" onChangeCommentsOrder={() => undefined} {...props} />))
  return container
}

export function unmountFolderView(): void {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
}

/** Lets what is in flight — the settings file's read, a write — answer inside act. */
export async function flush(): Promise<void> {
  await act(async () => void (await new Promise((done) => setTimeout(done))))
}

export function q<T extends Element>(el: ParentNode, sel: string): T {
  const n = el.querySelector<T>(sel)
  if (n === null) throw new Error(`missing ${sel}`)
  return n
}

export const click = (el: Element): void => act(() => (el as HTMLElement).click())

export const press = (el: Element, key: string): void => act(() => void el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))

/** Native prototype setter + bubbling input, so React's value tracker sees the change. */
export function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
