import { describe, expect, it } from 'vitest'
import { fileLink, isAppLink, LINK_SCHEMES, parseFileLink } from '@shared/links'

// Deep links (E1, GRO-2171; format locked in D7): `yaseendocs://` + percent-encoded absolute
// path, e.g. `yaseendocs:///Users/me/vault/My%20note.md`. Optional `?root=` override.

describe('fileLink', () => {
  it('builds the D7 shape: yaseendocs:// + encoded absolute path (three slashes)', () => {
    expect(fileLink('/Users/me/vault/My note.md')).toBe('yaseendocs:///Users/me/vault/My%20note.md')
  })

  it('percent-encodes # and ? too (encodeURI alone would leave them and truncate the path)', () => {
    expect(fileLink('/v/a#1.md')).toBe('yaseendocs:///v/a%231.md')
    expect(fileLink('/v/what?.md')).toBe('yaseendocs:///v/what%3F.md')
  })
})

describe('parseFileLink round-trips fileLink', () => {
  const roundTrip = (path: string) => parseFileLink(fileLink(path))
  it.each([
    ['spaces', '/Users/me/vault/My note.md'],
    ['unicode', '/v/émojis 🎉.md'],
    ['hash', '/v/notes#drafts/a#1.md'],
    ['question mark', '/v/really?.md'],
    ['percent', '/v/100% done.md'],
    ['ampersand and equals', '/v/a&b=c.md'],
  ])('%s: %s', (_name, path) => {
    expect(roundTrip(path)).toEqual({ path, root: null })
  })
})

describe('parseFileLink', () => {
  it('extracts an optional percent-encoded ?root= override', () => {
    expect(parseFileLink('yaseendocs:///v/sub/a.md?root=%2FUsers%2Fme%2Fv')).toEqual({ path: '/v/sub/a.md', root: '/Users/me/v' })
    expect(parseFileLink('yaseendocs:///v/My%20note.md?root=/my%20vault')).toEqual({ path: '/v/My note.md', root: '/my vault' })
  })

  it('ignores query params other than root', () => {
    expect(parseFileLink('yaseendocs:///v/a.md?x=1')).toEqual({ path: '/v/a.md', root: null })
  })

  it('rejects any other scheme', () => {
    expect(parseFileLink('https:///v/a.md')).toBeNull()
    expect(parseFileLink('file:///v/a.md')).toBeNull()
    expect(parseFileLink('yaseendocsx:///v/a.md')).toBeNull()
    expect(parseFileLink('/v/a.md')).toBeNull()
  })

  it('rejects a relative or empty path', () => {
    expect(parseFileLink('yaseendocs://')).toBeNull()
    expect(parseFileLink('yaseendocs:///')).toEqual({ path: '/', root: null }) // absolute but silly; routeToFile rejects it
    expect(parseFileLink('yaseendocs://rel/a.md')).toBeNull()
  })

  it('treats the double-slash form (no third slash) as malformed, never as a host', () => {
    expect(parseFileLink('yaseendocs://Users/me/vault/a.md')).toBeNull()
  })

  it('rejects malformed percent-encoding instead of throwing', () => {
    expect(parseFileLink('yaseendocs:///v/bad%GG.md')).toBeNull()
    expect(parseFileLink('yaseendocs:///v/a.md?root=%')).toBeNull()
  })

  it('ignores a non-absolute root override', () => {
    expect(parseFileLink('yaseendocs:///v/a.md?root=rel')).toEqual({ path: '/v/a.md', root: null })
    expect(parseFileLink('yaseendocs:///v/a.md?root=')).toEqual({ path: '/v/a.md', root: null })
  })
})

// Yaseen Draw's links (YAZ-3028 D7): the same format under `yaseendraw://` (Draw's shared/links.ts
// @ aea9295), so a link saved before the fold opens the file in Docs.
describe('yaseendraw:// links', () => {
  it('parses the path Draw encoded, with spaces, unicode, # and ?', () => {
    expect(parseFileLink('yaseendraw:///Users/me/vault/Board%20one.excalidraw')).toEqual({ path: '/Users/me/vault/Board one.excalidraw', root: null })
    expect(parseFileLink('yaseendraw:///v/%C3%A9t%C3%A9%20%F0%9F%8E%89.drawio')).toEqual({ path: '/v/été 🎉.drawio', root: null })
    expect(parseFileLink('yaseendraw:///v/a%231%3F.excalidraw')).toEqual({ path: '/v/a#1?.excalidraw', root: null })
  })

  it('reads the ?root= override the same way', () => {
    expect(parseFileLink('yaseendraw:///v/sub/a.excalidraw?root=%2Fv')).toEqual({ path: '/v/sub/a.excalidraw', root: '/v' })
    expect(parseFileLink('yaseendraw:///v/a.excalidraw?root=rel')).toEqual({ path: '/v/a.excalidraw', root: null })
  })

  it('every Docs link, re-spelled with the Draw scheme, parses to the same answer', () => {
    for (const path of ['/Users/me/vault/My note.md', '/v/notes#drafts/a#1.md', '/v/100% done.excalidraw']) {
      expect(parseFileLink(fileLink(path).replace('yaseendocs://', 'yaseendraw://'))).toEqual({ path, root: null })
    }
  })

  it('rejects what the Docs scheme rejects', () => {
    expect(parseFileLink('yaseendraw://')).toBeNull()
    expect(parseFileLink('yaseendraw://Users/me/a.excalidraw')).toBeNull() // double-slash form: never a host
    expect(parseFileLink('yaseendraw:///v/bad%GG.excalidraw')).toBeNull()
    expect(parseFileLink('yaseendrawx:///v/a.excalidraw')).toBeNull()
    expect(parseFileLink('yaseen:///v/a.excalidraw')).toBeNull()
  })

  it("keeps Docs' path rule for Draw's Windows drive form: a POSIX path, not C:\\ (D12)", () => {
    expect(parseFileLink('yaseendraw:///C:/Vault/a.excalidraw')).toEqual({ path: '/C:/Vault/a.excalidraw', root: null })
  })

  it('fileLink still writes yaseendocs:// only', () => {
    expect(fileLink('/v/a.excalidraw')).toBe('yaseendocs:///v/a.excalidraw')
  })
})

describe('isAppLink', () => {
  it('knows both schemes, and nothing else', () => {
    expect(LINK_SCHEMES).toEqual(['yaseendocs', 'yaseendraw'])
    expect(isAppLink('yaseendocs:///v/a.md')).toBe(true)
    expect(isAppLink('yaseendraw:///v/a.excalidraw')).toBe(true)
    expect(isAppLink('--flag')).toBe(false)
    expect(isAppLink('https://example.com')).toBe(false)
    expect(isAppLink('/v/a.md')).toBe(false)
  })
})
