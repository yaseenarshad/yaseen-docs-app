/** The AI step's panel (YAZ-5124) over the seam's test double (`memoryHost`), as a scene builder mounts it. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { AgentStepPanel, type AgentStepEvent } from './AgentStepPanel'
import { showOnlyHost } from './courseHost'
import { memoryHost, type MemoryHost } from './scenes/testing'
import { NO_CARDS_YET } from './prompt'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let el: HTMLDivElement
let host: MemoryHost
let events: AgentStepEvent[]

beforeEach(() => {
  el = document.createElement('div')
  document.body.append(el)
  root = createRoot(el)
  host = memoryHost('/vault')
  events = []
})
afterEach(() => {
  act(() => root.unmount())
  el.remove()
})

const button = (label: string): HTMLButtonElement => {
  const found = [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)
  if (found === undefined) throw new Error(`no button ${label}: ${el.textContent}`)
  return found
}
const flush = () => act(() => Promise.resolve())

describe('AgentStepPanel', () => {
  it('walks the step: the example, the prompt and Copy, the cards as they come, Read ticks; one event each', async () => {
    act(() => root.render(<AgentStepPanel host={host} onStep={(e) => events.push(e)} />))
    expect(el.textContent).toContain('Paste something you have digested')
    act(() => button('Use the example').click())
    await flush()
    expect(el.querySelector('pre')?.textContent).toContain('Example text')
    act(() => button('Copy').click())
    await flush()
    expect(el.textContent).toContain('Waiting for cards in Course Cards')
    expect(events).toEqual(['text', 'copied'])

    act(() => host.arrive({ path: '/vault/course-cards/a.md', index: 0, id: 'TST-1', title: 'How bread rises' }, 'Bread rises because {{yeast}} eats sugar.\n---\nThe gas is trapped.'))
    act(() => host.arrive({ path: '/vault/course-cards/b.md', index: 0, id: null, title: 'The poke test' }))
    expect(events).toEqual(['text', 'copied', 'arrived'])
    expect([...el.querySelectorAll('.agent-step__title')].map((t) => t.textContent)).toEqual(['How bread rises', 'The poke test'])

    act(() => button('How bread rises').click())
    await flush()
    expect(el.querySelector('mark')?.textContent).toBe('yeast')
    expect(el.textContent).toContain('✓ Read')
    expect(events).not.toContain('read')
    act(() => button('The poke test').click())
    await flush()
    expect(el.querySelectorAll('.agent-step__read')).toHaveLength(2)
    expect(events).toEqual(['text', 'copied', 'arrived', 'read'])
  })

  it('YAZ-5270: typing in the box tells nothing; a paste tells `text`; an empty box takes it back', () => {
    act(() => root.render(<AgentStepPanel host={host} parts={['text']} onStep={(e) => events.push(e)} />))
    const box = el.querySelector<HTMLTextAreaElement>('#agent-step-text')!
    const change = (value: string) =>
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(box, value)
        box.dispatchEvent(new Event('input', { bubbles: true }))
      })
    change('S')
    change('Sleep')
    expect(events).toEqual([])
    expect(host.agentStep.state().given).toBe(false)
    act(() => void box.dispatchEvent(new Event('paste', { bubbles: true })))
    change('Sleep debt adds up.')
    expect(events).toEqual(['text'])
    expect(host.agentStep.state().given).toBe(true)
    change('')
    expect(host.agentStep.state().given).toBe(false)
  })

  it('YAZ-5202: names the real folder when the course made "Course Cards 2"', async () => {
    act(() => root.render(<AgentStepPanel host={host} onStep={(e) => events.push(e)} />))
    act(() => host.set({ text: 'Some text', prompt: { text: 'Prompt', folder: '/vault/course-cards-2' }, folderTitle: 'Course Cards 2', copiedAt: 1 }))
    expect(el.textContent).toContain('Waiting for cards in Course Cards 2…')
    act(() => host.set({ examples: [{ path: '/vault/course-cards-2/a.md', title: 'A', text: 'A {{b}}', titleHidden: false }] }))
    expect(el.textContent).toContain('Made 1 cards in Course Cards 2.')
  })

  it('shows NO_CARDS_YET when the step has waited 60 seconds, and keeps waiting', async () => {
    act(() => root.render(<AgentStepPanel host={host} parts={['cards']} />))
    act(() => host.set({ copiedAt: 1, quiet: true }))
    expect(el.textContent).toBe(NO_CARDS_YET)
  })

  it('a later clip that mounts the panel again finds the state, and hears of what was done before it', async () => {
    act(() => host.agentStep.useExample())
    await act(() => host.agentStep.copy())
    act(() => root.render(<AgentStepPanel host={host} parts={['cards']} onStep={(e) => events.push(e)} />))
    expect(events).toEqual(['text', 'copied'])
    expect(el.querySelector('textarea')).toBeNull()
  })

  it('"No agent? Skip" shows three example cards; they are made only on "Make these cards"', async () => {
    const make = vi.spyOn(host.agentStep, 'makeExamples')
    act(() => root.render(<AgentStepPanel host={host} parts={['skip']} onStep={(e) => events.push(e)} />))
    act(() => button('No agent? Skip').click())
    expect(el.querySelectorAll('.agent-step__card')).toHaveLength(3)
    expect(make).not.toHaveBeenCalled()
    act(() => button('Make these cards').click())
    await flush()
    expect(make).toHaveBeenCalledTimes(1)
    expect(events).toEqual(['made'])
  })

  it('in a vault where the course only shows, the prompt part says why in one line', async () => {
    const shown = showOnlyHost('/vault', 'This vault is read only, so the course only shows. It makes no files.')
    act(() => shown.agentStep.setText('My pages.'))
    act(() => root.render(<AgentStepPanel host={shown} parts={['prompt']} />))
    expect(el.textContent).toBe('This vault is read only, so the course only shows. It makes no files.')
  })
})
