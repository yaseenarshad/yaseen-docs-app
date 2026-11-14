// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * YAZ-5289: the landing page (`landing.ts`) in a page, for each kind of link. The code is read from the fragment ONLY
 * (the part that no browser sends to a server). A code in the query (`?c=`) is not read. The code is drawn as text.
 */
const ID = 'aa5a315d61ae9438b18d'
const body = readFileSync(join(import.meta.dirname, '../../friend.html'), 'utf8').replace(/^[\s\S]*<body>|<\/body>[\s\S]*$/g, '')

async function open(path: string) {
  history.replaceState(null, '', path)
  document.body.innerHTML = body
  vi.resetModules()
  await import('./landing')
  const shown = (id: string) => !document.getElementById(id)!.hasAttribute('hidden')
  return {
    code: (document.getElementById('code') as HTMLInputElement).value,
    hasCode: shown('has-code'),
    noCode: shown('no-code'),
    title: document.querySelector('h1')!.textContent,
  }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('the landing page reads the code from the fragment only', () => {
  it('/friend#<code>: the code shows', async () => {
    const p = await open(`/friend#${ID}`)
    expect(p).toMatchObject({ code: ID, hasCode: true, noCode: false })
  })

  it('the code only in the query (sent to the server): "This link has no friend code."', async () => {
    const p = await open(`/friend?c=${ID}`)
    expect(p).toMatchObject({ code: '', hasCode: false, noCode: true })
    expect(document.getElementById('no-code')!.textContent).toContain('This link has no friend code.')
  })

  it('/group#<id> and /join#<group>-<pointer>: the code shows, with words for each kind', async () => {
    const g = await open(`/group#${ID}`)
    expect(g).toMatchObject({ code: ID, hasCode: true })
    expect(g.title).toContain('group')
    const j = await open(`/join#${ID}-${ID}`)
    expect(j.hasCode).toBe(true)
    expect(j.code).toBe(`${location.origin}/join#${ID}-${ID}`)
    expect(j.title).toContain('join')
  })

  it('a code with markup is never drawn as HTML', async () => {
    const p = await open('/friend#<img src=x onerror=alert(1)>')
    expect(p.noCode).toBe(true)
    expect(document.querySelector('img[src=x]')).toBeNull()
  })
})
