import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DocumentZoom } from './DocumentZoom'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
let root: Root
let container: HTMLDivElement
let changed: ReturnType<typeof vi.fn>
function mount() {
  changed = vi.fn()
  function Harness() {
    const [value, setValue] = useState(100)
    return <><DocumentZoom value={value} onChange={(next) => { changed(next); setValue(next) }} /><button>Outside</button></>
  }
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root.render(<Harness />))
}
afterEach(() => { act(() => root?.unmount()); container?.remove() })
const input = () => container.querySelector('input')!
function type(text: string) {
  act(() => {
    input().focus()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), text)
    input().dispatchEvent(new Event('input', { bubbles: true }))
  })
}
function key(key: string) { act(() => input().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))) }
function outside() { act(() => container.querySelectorAll('button').item(container.querySelectorAll('button').length - 1).focus()) }
function presets() { act(() => container.querySelector<HTMLButtonElement>('[aria-label="Zoom presets"]')!.click()) }
function choose(value: number) {
  const button = Array.from(container.querySelectorAll<HTMLButtonElement>('.document-zoom__presets button')).find(b => b.textContent?.startsWith(`${value}%`))!
  act(() => button.click())
}

describe('DocumentZoom', () => {
  it.each(['50', '115', '115%', ' 125% ', '200'])('applies %s on Enter and formats the field', (text) => {
    mount(); type(text); key('Enter')
    const value = Number(text.trim().replace('%', ''))
    expect(changed).toHaveBeenLastCalledWith(value)
    expect(input().value).toBe(`${value}%`)
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })
  it.each(['', '49', '201', '999', '100.5', '-50', '1e2', 'abc', '100%%'])('rejects %s without changing applied zoom', (text) => {
    mount(); type(text); key('Enter')
    expect(changed).not.toHaveBeenCalled()
    expect(input().getAttribute('aria-invalid')).toBe('true')
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('50–200%')
    key('Escape')
    expect(input().value).toBe('100%')
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })
  it('waits for confirmation, applies on blur, and Escape cancels a later draft', () => {
    mount(); type('117')
    expect(changed).not.toHaveBeenCalled()
    outside()
    expect(changed).toHaveBeenLastCalledWith(117)
    type('150'); key('Escape'); outside()
    expect(changed).toHaveBeenCalledTimes(1)
    expect(input().value).toBe('117%')
  })
  it('offers the approved presets and replaces a custom value', () => {
    mount(); type('115'); key('Enter'); presets()
    expect(Array.from(container.querySelectorAll('.document-zoom__presets button'), b => b.textContent)).toEqual(['50%', '75%', '90%', '100%', '125%', '150%', '200%'])
    choose(150)
    expect(changed).toHaveBeenLastCalledWith(150)
    expect(input().value).toBe('150%')
    expect(container.querySelector('.document-zoom__presets')).toBeNull()
    expect(document.activeElement).toBe(input())
  })
  it('does not commit a partial draft while moving focus into presets', () => {
    mount(); type('12')
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Zoom presets"]')!.focus())
    presets(); choose(75)
    expect(changed).toHaveBeenCalledExactlyOnceWith(75)
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })
  it('can recover invalid text by choosing a preset and dismisses the menu on outside focus', () => {
    mount(); type('bad'); key('Enter'); presets()
    expect(container.querySelector('[role="alert"]')).toBeNull()
    choose(125); presets(); outside()
    expect(container.querySelector('.document-zoom__presets')).toBeNull()
    expect(input().value).toBe('125%')
  })
})
