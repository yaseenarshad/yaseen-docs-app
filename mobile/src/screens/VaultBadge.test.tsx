// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { VaultBadge } from './VaultBadge'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement | null = null
let root: Root | null = null

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  host = null
  root = null
})

function mountBadge(node: React.ReactElement): HTMLElement {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(node))
  return host
}

describe('VaultBadge (YAZ-6560)', () => {
  it('renders Option B 2-letter monogram inside soft hue square when no synced icon exists', () => {
    const el = mountBadge(<VaultBadge n={2} name="yaseen-knowledge" />)
    const span = el.querySelector<HTMLElement>('.vault-badge')!
    expect(span.textContent).toBe('YK')
    expect(span.dataset.hue).toBe('amber')
  })

  it('renders synced emoji badge with launcher background color', () => {
    const el = mountBadge(
      <VaultBadge
        n={1}
        name="yaseen-docs-vault"
        icon={{ kind: 'badge', badge: { kind: 'emoji', value: '📅', color: '#007AFF' } }}
      />,
    )
    const span = el.querySelector<HTMLElement>('.vault-badge--custom')!
    expect(span.textContent).toBe('📅')
    expect(span.style.background).toContain('rgb(0, 122, 255)')
  })

  it('renders synced material badge using inline SVG paths with zero icon-bundle weight', () => {
    const el = mountBadge(
      <VaultBadge
        n={1}
        name="Docs"
        icon={{
          kind: 'badge',
          badge: { kind: 'material', value: 'folder-docs', color: '#475569', svgPaths: ['M1 2h12v10H1z'] },
        }}
      />,
    )
    const svg = el.querySelector('svg.vault-badge__svg')!
    expect(svg).not.toBeNull()
    expect(svg.querySelector('path')?.getAttribute('d')).toBe('M1 2h12v10H1z')
  })

  it('renders synced custom PNG image when icon.kind === "image"', () => {
    const src = 'data:image/png;base64,iVBORw0KGgo='
    const el = mountBadge(<VaultBadge n={1} name="trevor-yaseen-docs" icon={{ kind: 'image', src }} />)
    const img = el.querySelector<HTMLImageElement>('img.vault-badge--img')!
    expect(img).not.toBeNull()
    expect(img.src).toBe(src)
  })
})
