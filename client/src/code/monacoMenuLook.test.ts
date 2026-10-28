/** Monaco's right-click menu gets the app's spacing (YAZ-3478): one style in each menu host's shadow root. */
import { afterEach, describe, expect, it } from 'vitest'
import { MENU_LOOK_CSS, attachMenuLook } from './monacoMenuLook'

const flush = () => new Promise((resolve) => setTimeout(resolve))

/** A host as Monaco adds it: `.shadow-root-host`, an open shadow root with Monaco's own style first. */
function addHost(mount: HTMLElement): ShadowRoot {
  const host = document.createElement('div')
  host.className = 'shadow-root-host'
  const root = host.attachShadow({ mode: 'open' })
  root.appendChild(document.createElement('style'))
  mount.appendChild(host)
  return root
}

const looks = (root: ShadowRoot) => [...root.querySelectorAll('style')].filter((s) => s.textContent === MENU_LOOK_CSS)

let mount: HTMLElement
afterEach(() => mount.remove())

describe('attachMenuLook', () => {
  it('a host that arrives later gets the style once, after Monaco’s own', async () => {
    mount = document.body.appendChild(document.createElement('div'))
    const look = attachMenuLook(mount)
    const root = addHost(mount)
    await flush()
    expect(looks(root)).toHaveLength(1)
    expect(root.lastElementChild?.textContent).toBe(MENU_LOOK_CSS)
    mount.appendChild(document.createElement('div'))
    await flush()
    expect(looks(root)).toHaveLength(1)
    look.dispose()
  })

  it('a host already there gets it at once; another child or a closed shadow root is left alone; after dispose nothing changes', async () => {
    mount = document.body.appendChild(document.createElement('div'))
    const first = addHost(mount)
    const other = document.createElement('div')
    other.attachShadow({ mode: 'open' })
    mount.appendChild(other)
    const look = attachMenuLook(mount)
    expect(looks(first)).toHaveLength(1)
    expect(other.shadowRoot?.childElementCount).toBe(0)
    look.dispose()
    const late = addHost(mount)
    await flush()
    expect(looks(late)).toHaveLength(0)
  })

  it('a row is the app row: its padding token around one line at the normal line height, never a fixed height (YAZ-3503)', () => {
    expect(MENU_LOOK_CSS).toMatch(/\.action-menu-item \{[^}]*height: auto;/)
    expect(MENU_LOOK_CSS).toMatch(/\.action-label:not\(\.separator\) \{[^}]*padding: var\(--menu-row-padding, 6px 10px\);[^}]*line-height: normal;/)
    expect(MENU_LOOK_CSS).not.toMatch(/height: \d+px/)
  })

  it('every rule has one class more than Monaco’s, so it wins in any order', () => {
    for (const rule of MENU_LOOK_CSS.split('}').filter((r) => r.includes('{'))) expect(rule.trim()).toMatch(/^\.context-view \.monaco-menu\.monaco-menu/)
  })
})
