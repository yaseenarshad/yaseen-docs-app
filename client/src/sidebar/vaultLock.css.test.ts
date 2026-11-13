/**
 * The vault's name keeps priority in the sidebar's header (YAZ-4964 round 2, item 6; YAZ-4985), read as text: jsdom
 * lays nothing out. While file changes are allowed, the lock shrinks first, to its short form, and only then is the
 * name cut. A real width is a check by eye.
 */
import { describe, expect, it } from 'vitest'
import appCss from '../app.css?inline'
import { rules } from '../editor/cssRules'

const bodyOf = (selector: string): string => rules(appCss, selector).filter((r) => r.selector === selector).map((r) => r.body).join('\n')
const flat = appCss.replace(/\/\*[\s\S]*?\*\//g, '')

describe('the vault lock in a narrow header', () => {
  it('the allowed lock is a size container that shrinks before the name, down to its short form', () => {
    const lock = bodyOf('.vault-lock.vault-lock--allowed')
    expect(lock).toMatch(/container:\s*vault-lock\s*\/\s*inline-size/)
    const flex = /flex:\s*0\s+(\d+)\s+(calc\([^;]+\));/.exec(lock)
    // It never grows; it shrinks a thousand times faster than the name's button (`flex-shrink` 1).
    expect(Number(flex?.[1])).toBeGreaterThanOrEqual(1000)
    expect(lock).toMatch(/min-width:\s*calc\(/)
    expect(bodyOf('.sidebar__header:has(.vault-lock--allowed) .sidebar__root')).toMatch(/flex:\s*1 1 auto/)
    expect(bodyOf('.sidebar__root')).toMatch(/min-width:\s*0/)
    expect(bodyOf('.sidebar__root-name')).toMatch(/text-overflow:\s*ellipsis/)
    // The short form shows exactly below the full width; above it, the long time and "Lock now".
    const query = new RegExp(`@container vault-lock \\(max-width: calc\\(${flex![2].slice(5, -1).replace(/[()+]/g, '\\$&')} - 1px\\)\\)\\s*\\{([\\s\\S]*?\\})\\s*\\}`).exec(flat)
    expect(query, 'the container query').not.toBeNull()
    expect(query![1]).toMatch(/\.vault-lock \.vault-lock__time--long,\s*\.vault-lock \.read-only-chip__lock\s*\{\s*display:\s*none;/)
    expect(query![1]).toMatch(/\.vault-lock \.vault-lock__time--short\s*\{\s*display:\s*inline;/)
    expect(bodyOf('.vault-lock .vault-lock__time--short')).toMatch(/display:\s*none/)
  })
})
