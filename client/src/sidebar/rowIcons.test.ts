import { describe, expect, it } from 'vitest'
import { globRegExp, type IconRule } from '@shared/vaultIcons'
import { buildRowIcons, iconsChangedBelow, oneRule, rowIcon, ruleFor, withRule } from './rowIcons'
import { suggestIcons } from './iconSuggestions'

/** Which icon a row shows (YAZ-3440 B): its pick, then the first matching name rule of the settings, then Material's match, then the default. */
const V = '/v'
const icons = (paths: Record<string, string> = {}, rules: IconRule[] = []) => buildRowIcons({ [V]: { paths } }, [V], rules)

describe('the matching order (YAZ-3440 B)', () => {
  it("(1) a row's own pick wins over every rule and over Material", () => {
    const i = icons({ '/v/a.test.ts': 'lua' }, [{ match: '*.ts', kind: 'file', icon: 'python' }])
    expect(rowIcon(i, '/v/a.test.ts', 'a.test.ts', 'file')).toEqual({ id: 'lua', custom: true })
  })

  it("(2) then the FIRST rule whose glob matches the name and whose kind is the row's, in any case, in every vault", () => {
    const rules: IconRule[] = [{ match: '*.ts', kind: 'folder', icon: 'folder-src' }, { match: '*.TS', kind: 'file', icon: 'python' }, { match: '*', kind: 'file', icon: 'json' }]
    const i = buildRowIcons({ '/v': { paths: {} }, '/w': { paths: {} } }, ['/v', '/w'], rules)
    expect(rowIcon(i, '/v/x/a.ts', 'a.ts', 'file')).toEqual({ id: 'python', custom: true })
    expect(rowIcon(i, '/w/a.ts', 'a.ts', 'file')).toEqual({ id: 'python', custom: true })
    expect(rowIcon(i, '/v/b.md', 'b.md', 'file')).toEqual({ id: 'json', custom: true })
    expect(rowIcon(i, '/v/c.ts', 'c.ts', 'folder')).toEqual({ id: 'folder-src', custom: true })
  })

  it("(3) then Material's match, (4) then its default; a folder open shows the open twin, its pick's too", () => {
    const i = icons({ '/v/Mine': 'folder-docs' })
    expect(rowIcon(i, '/v/a.test.ts', 'a.test.ts', 'file')).toEqual({ id: 'test-ts', custom: false })
    expect(rowIcon(i, '/v/notes', 'notes', 'file')).toEqual({ id: 'file', custom: false })
    expect(rowIcon(i, '/v/src', 'src', 'folder', true)).toEqual({ id: 'folder-src-open', custom: false })
    expect(rowIcon(i, '/v/Mine', 'Mine', 'folder', true)).toEqual({ id: 'folder-docs-open', custom: true })
    expect(rowIcon(undefined, '/v/a.py', 'a.py', 'file')).toEqual({ id: 'python', custom: false })
  })

  it('an id Material does not ship reads as no pick and no rule', () => {
    const i = icons({ '/v/a.py': 'no-such-icon' }, [{ match: '*.py', kind: 'file', icon: 'nor-this' }])
    expect(rowIcon(i, '/v/a.py', 'a.py', 'file')).toEqual({ id: 'python', custom: false })
  })

  it('globs: `*` any run, `?` one character, `{a,b}` either, the rest literal', () => {
    expect(globRegExp('*.test.{ts,tsx}').test('a.test.tsx')).toBe(true)
    expect(globRegExp('*.test.{ts,tsx}').test('a.testxts')).toBe(false)
    expect(globRegExp('v?').test('v1')).toBe(true)
    expect(globRegExp('v?').test('v12')).toBe(false)
    expect(globRegExp('(draft)+*').test('(draft)+ x')).toBe(true)
  })
})

describe('what re-renders (YAZ-3440 C)', () => {
  it('the same picks and rules give the same object; a new pick keeps the rules, so only the levels that draw its row re-render', () => {
    const rules: IconRule[] = [{ match: '*.py', kind: 'file', icon: 'lua' }]
    const a = icons({ '/v/x.md': 'lua' }, rules)
    expect(buildRowIcons({ [V]: { paths: { '/v/x.md': 'lua' } } }, [V], [...rules], a)).toBe(a)
    const b = buildRowIcons({ [V]: { paths: { '/v/x.md': 'lua', '/v/d/y.md': 'json' } } }, [V], rules, a)
    expect(b.rules).toBe(a.rules)
    const drawnUnder = (dir: string) => (p: string) => p.startsWith(`${dir}/`)
    expect(iconsChangedBelow(a, b, drawnUnder('/v/d'))).toBe(true)
    expect(iconsChangedBelow(a, b, drawnUnder('/v/e'))).toBe(false)
    // A rule changed: every level.
    const c = buildRowIcons({ [V]: { paths: { '/v/x.md': 'lua', '/v/d/y.md': 'json' } } }, [V], [], b)
    expect(iconsChangedBelow(b, c, drawnUnder('/v/e'))).toBe(true)
  })
})

describe("the row menu's two scopes (demo round 2)", () => {
  it('the rule for a row: its extension, else its name; a folder by its name', () => {
    expect(ruleFor('mixed 24.GIF', 'file')).toEqual({ match: '*.gif', kind: 'file', label: 'all .gif files' })
    expect(ruleFor('a.test.ts', 'file')).toEqual({ match: '*.ts', kind: 'file', label: 'all .ts files' })
    expect(ruleFor('Makefile', 'file')).toEqual({ match: 'Makefile', kind: 'file', label: 'all files named Makefile' })
    expect(ruleFor('.gitignore', 'file')).toEqual({ match: '.gitignore', kind: 'file', label: 'all files named .gitignore' })
    expect(ruleFor('src', 'folder')).toEqual({ match: 'src', kind: 'folder', label: 'all folders named src' })
  })

  it('a selection has a rule only when every row wants the same one', () => {
    expect(oneRule([ruleFor('a.gif', 'file'), ruleFor('B.GIF', 'file')])?.match).toBe('*.gif')
    expect(oneRule([ruleFor('a.gif', 'file'), ruleFor('b.png', 'file')])).toBeNull()
    expect(oneRule([ruleFor('src', 'file'), ruleFor('src', 'folder')])).toBeNull()
  })

  it('one rule per pattern: a second pick replaces it in place, in any case; Reset removes it and only it', () => {
    const rules: IconRule[] = [{ match: '*.gif', kind: 'file', icon: 'image' }, { match: 'src', kind: 'folder', icon: 'folder-src' }]
    expect(withRule(rules, '*.GIF', 'file', 'video')).toEqual([{ match: '*.gif', kind: 'file', icon: 'video' }, rules[1]])
    expect(withRule(rules, '*.png', 'file', 'image')).toEqual([...rules, { match: '*.png', kind: 'file', icon: 'image' }])
    expect(withRule(rules, '*.gif', 'file', null)).toEqual([rules[1]])
    expect(withRule(rules, 'src', 'file', null)).toEqual(rules)
  })

  it("suggestions lead with the row's icon and its kind's, then the common ones; a folder's are folders", () => {
    const gif = suggestIcons('mixed 24.gif', 'file', 'image')
    expect(gif[0]).toBe('image')
    expect(gif).toEqual(expect.arrayContaining(['svg', 'favicon', 'markdown', 'pdf']))
    expect(new Set(gif).size).toBe(gif.length)
    const folder = suggestIcons('docs', 'folder', 'folder-docs')
    expect(folder[0]).toBe('folder-docs')
    expect(folder.every((id) => id.startsWith('folder'))).toBe(true)
  })
})
