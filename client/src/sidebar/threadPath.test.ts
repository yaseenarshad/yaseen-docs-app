import { describe, expect, it } from 'vitest'
import { threadPath } from './threadPath'

/** A folder row in an li, its group under it, as Tree.tsx draws an open folder. */
const folder = (name: string, open: boolean, inner = '') =>
  `<li aria-expanded="${open}"><button class="tree__row tree__row--sticky" data-name="${name}"></button><ul role="group">${inner}</ul></li>`

describe('threadPath (YAZ-4474)', () => {
  it('marks the open folder rows that hold the row under the mouse, one per level; a move away clears what left the path', () => {
    const body = document.createElement('div')
    body.innerHTML = `<ul role="tree">${folder('Work', true, folder('Clients', true, '<li><button class="tree__row" data-name="Acme"></button></li>') + folder('Shut', false))}<li><button class="tree__row" data-name="Top"></button></li></ul>`
    document.body.append(body)
    const row = (name: string) => body.querySelector<HTMLElement>(`[data-name="${name}"]`)!
    const onPath = () => [...body.querySelectorAll('[data-on-path]')].map((el) => (el as HTMLElement).dataset.name)
    const stop = threadPath(body)
    row('Acme').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    expect(onPath()).toEqual(['Work', 'Clients'])
    // A closed folder is no step of the path; its row on its own is the path of its parent.
    row('Shut').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    expect(onPath()).toEqual(['Work'])
    row('Top').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    expect(onPath()).toEqual([])
    row('Acme').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    body.dispatchEvent(new MouseEvent('mouseleave'))
    expect(onPath()).toEqual([])
    row('Acme').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    stop()
    expect(onPath()).toEqual([])
    row('Acme').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    expect(onPath()).toEqual([])
    body.remove()
  })
})
