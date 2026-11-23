import { describe, expect, it } from 'vitest'
import { githubClient, type FetchLike } from '../github/client'
import { githubRemote } from './githubRemote'
import { syncPass } from './pass'
import { BRANCH, REPO, TOKEN, VAULT, cardFileText, syncSetup, type SyncSetup } from './testing'

/**
 * YAZ-5929 checker tests (PR #278): the batched text download keeps the file exactly, sends a safe query, and falls
 * back or waits as decided on YAZ-5928. Fake GitHub only.
 */
const noYield = async () => {}
const pass = (s: SyncSetup) => syncPass({ remote: s.remote, store: s.store, vault: VAULT, yieldToUi: noYield })
const text = async (s: SyncSetup, path: string) => (await s.store.read(VAULT, path))?.content
const cards = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`cards/c-nc-${i}.md`, cardFileText(`Card ${i}`, `NC-${i}`)]))
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

describe('YAZ-5929 (checker): batched text download', () => {
  it('a batched file is stored exactly: non-ASCII, CRLF, a BOM and two files with one text', async () => {
    const files = {
      ...cards(12),
      'arabic.md': '# مرحبا 👋\n\nnaïve café — “quotes”\n',
      'crlf.md': '# Windows\r\nline 2\r\n',
      'bom.md': '﻿# Starts with a BOM\n',
      'same-a.md': 'one text in two files\n',
      'same-b.md': 'one text in two files\n',
    }
    const s = await syncSetup(files)
    await pass(s)
    for (const [path, content] of Object.entries(files)) expect(await text(s, path)).toBe(content)
    // One query; the shared text is asked once. A file whose batched text does not hash to its SHA (the BOM can go
    // in transit) may use the one-file call, but no more than that one.
    expect(s.count('graphql')).toBe(1)
    expect(s.github.graphql.queries).toEqual([Object.keys(files).length - 1])
    expect(s.count('blob')).toBeLessThanOrEqual(1)
  })

  it('the query text holds only hex SHAs: the owner and the name go as GraphQL variables', async () => {
    const s = await syncSetup(cards(1))
    const bodies: { query: string; variables: Record<string, unknown> }[] = []
    const spy: FetchLike = async (url, init) => {
      if (String(url).endsWith('/graphql')) bodies.push(JSON.parse(String(init?.body)))
      return s.github.fetch(url, init)
    }
    const head = await s.remote.head()
    if (head === 'unchanged') throw new Error('no')
    const sha = (await s.remote.tree(head.sha)).get('cards/c-nc-0.md')!
    const odd = githubRemote(githubClient(TOKEN, { fetch: spy }), 'own"er/na}me', BRANCH)
    expect(await odd.blobs([sha])).toEqual([null])
    const own = githubRemote(githubClient(TOKEN, { fetch: spy }), REPO, BRANCH)
    expect(await own.blobs([sha])).toEqual([cardFileText('Card 0', 'NC-0')])
    expect(bodies).toHaveLength(2)
    expect(bodies[0].variables).toEqual({ owner: 'own"er', name: 'na}me' })
    expect(bodies[1].variables).toEqual({ owner: 'yaseen', name: 'vault' })
    for (const { query } of bodies) {
      expect(query).not.toMatch(/own"er|na\}me|yaseen|vault/)
      expect(query).not.toContain(TOKEN)
      // Each string literal in the query is a 40-character hex SHA.
      for (const literal of query.match(/"[^"]*"/g) ?? []) expect(literal).toMatch(/^"[0-9a-f]{40}"$/)
    }
  })

  it('a blob whose encoding GitHub cannot tell (isBinary: null) and a part refused in a partial answer use the one-file call', async () => {
    const s = await syncSetup({ 'a.md': 'A', 'b.md': 'B', 'c.md': 'C' })
    const head = await s.remote.head()
    if (head === 'unchanged') throw new Error('no')
    const tree = await s.remote.tree(head.sha)
    s.github.interrupt = (c) =>
      c.url.endsWith('/graphql')
        ? json(200, {
            data: { repository: { b0: { text: 'A', isBinary: null, isTruncated: false }, b1: null, b2: { text: 'C', isBinary: false, isTruncated: false } } },
            errors: [{ type: 'FORBIDDEN', path: ['repository', 'b1'], message: 'no' }],
          })
        : undefined
    expect(await s.remote.blobs([tree.get('a.md')!, tree.get('b.md')!, tree.get('c.md')!])).toEqual([null, null, 'C'])
  })

  it('a whole-query refusal (a token that may not use GraphQL) falls back: the pass ends with one-file calls and a checkpoint', async () => {
    const files = cards(20)
    const s = await syncSetup(files)
    s.github.interrupt = (c) => (c.url.endsWith('/graphql') ? json(403, { message: 'Resource not accessible by personal access token' }) : undefined)
    const result = await pass(s)
    expect(result.kind).toBe('synced')
    expect(s.count('graphql')).toBe(1)
    expect(s.count('blob')).toBe(20)
    expect(await s.store.checkpoint(VAULT)).not.toBeNull()
    expect(await text(s, 'cards/c-nc-19.md')).toBe(files['cards/c-nc-19.md'])
  })

  it('a GraphQL secondary limit (403 "slow down") waits: it does not fall back to 1 REST call per file, and nothing is lost', async () => {
    const s = await syncSetup(cards(40))
    s.github.interrupt = (c) =>
      c.url.endsWith('/graphql') ? json(403, { message: 'You have exceeded a secondary rate limit. Please wait a few minutes before you try again.' }) : undefined
    await expect(pass(s)).rejects.toMatchObject({ code: 'RATE_LIMITED' })
    expect(s.count('blob')).toBe(0)
    expect(await s.store.checkpoint(VAULT)).toBeNull()
    s.github.interrupt = null
    expect((await pass(s)).kind).toBe('synced')
    expect(await s.store.list(VAULT)).toHaveLength(40)
    expect(s.count('blob')).toBe(0)
  })
})
