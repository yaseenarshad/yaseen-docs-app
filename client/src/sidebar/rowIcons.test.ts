import { describe, expect, it, vi } from 'vitest'
import { globRegExp, type IconRule } from '@shared/vaultIcons'
import { buildRowIcons, iconsChangedBelow, oneRule, rowIcon, ruleFor, withRule } from './rowIcons'
import { suggestIcons } from './iconSuggestions'

/** Which icon a row shows (YAZ-3440 D8, D9): its pick, then the first matching name rule of the settings, then Material's match, then the default. */
const V = '/v'
const icons = (paths: Record<string, string> = {}, rules: IconRule[] = [], folderNames = true) => buildRowIcons({ [V]: { paths } }, [V], rules, folderNames)

describe('the matching order (YAZ-3440 D8, D9)', () => {
  it("(1) a row's own pick wins over every rule and over Material", () => {
    const i = icons({ '/v/a.test.ts': 'lua' }, [{ match: '*.ts', kind: 'file', icon: 'python' }])
    expect(rowIcon(i, '/v/a.test.ts', 'a.test.ts', 'file')).toEqual({ id: 'lua', custom: true })
  })

  it("(2) then the FIRST rule whose glob matches the name and whose kind is the row's, in any case, in every vault", () => {
    const rules: IconRule[] = [{ match: '*.ts', kind: 'folder', icon: 'folder-src' }, { match: '*.TS', kind: 'file', icon: 'python' }, { match: '*', kind: 'file', icon: 'json' }]
    const i = buildRowIcons({ '/v': { paths: {} }, '/w': { paths: {} } }, ['/v', '/w'], rules, true)
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

describe('Folder icons "Plain" (YAZ-3554 D1, D4)', () => {
  it("every folder shows Material's default folder, open or closed, in the vaults and outside them; a pick and a rule still win; a file keeps its match", () => {
    const i = icons({ '/v/trips': 'folder-images' }, [{ match: 'Assets', kind: 'folder', icon: 'folder-resource' }], false)
    expect(rowIcon(i, '/v/src', 'src', 'folder')).toEqual({ id: 'folder', custom: false })
    expect(rowIcon(i, '/v/app', 'app', 'folder', true)).toEqual({ id: 'folder-open', custom: false })
    expect(rowIcon(i, '/v/trips', 'trips', 'folder')).toEqual({ id: 'folder-images', custom: true })
    expect(rowIcon(i, '/v/assets', 'assets', 'folder', true)).toEqual({ id: 'folder-resource-open', custom: true })
    expect(rowIcon(i, '/v/a.test.ts', 'a.test.ts', 'file')).toEqual({ id: 'test-ts', custom: false })
    // Outside the window's vaults (D11): no pick and no rule, and still Plain.
    expect(rowIcon(i, '/out/trips', 'trips', 'folder', false, false)).toEqual({ id: 'folder', custom: false })
    expect(rowIcon(icons(), '/out/src', 'src', 'folder', false, false)).toEqual({ id: 'folder-src', custom: false })
  })

  it('a change of the choice is a new object that every level draws again; the same choice is the same object', () => {
    const named = icons()
    const plain = buildRowIcons({ [V]: { paths: {} } }, [V], [], false, named)
    expect(plain).not.toBe(named)
    expect(plain.paths).toBe(named.paths)
    expect(iconsChangedBelow(named, plain, () => false)).toBe(true)
    expect(buildRowIcons({ [V]: { paths: {} } }, [V], [], false, plain)).toBe(plain)
  })
})

describe('what re-renders (YAZ-3440 D8)', () => {
  it('the same picks and rules give the same object; a new pick keeps the rules, so only the levels that draw its row re-render', () => {
    const rules: IconRule[] = [{ match: '*.py', kind: 'file', icon: 'lua' }]
    const a = icons({ '/v/x.md': 'lua' }, rules)
    expect(buildRowIcons({ [V]: { paths: { '/v/x.md': 'lua' } } }, [V], [...rules], true, a)).toBe(a)
    const b = buildRowIcons({ [V]: { paths: { '/v/x.md': 'lua', '/v/d/y.md': 'json' } } }, [V], rules, true, a)
    expect(b.rules).toBe(a.rules)
    const drawnUnder = (dir: string) => (p: string) => p.startsWith(`${dir}/`)
    expect(iconsChangedBelow(a, b, drawnUnder('/v/d'))).toBe(true)
    expect(iconsChangedBelow(a, b, drawnUnder('/v/e'))).toBe(false)
    // A rule changed: every level.
    const c = buildRowIcons({ [V]: { paths: { '/v/x.md': 'lua', '/v/d/y.md': 'json' } } }, [V], [], true, b)
    expect(iconsChangedBelow(b, c, drawnUnder('/v/e'))).toBe(true)
  })
})

describe("the row menu's two scopes (D8, D9)", () => {
  it('the rule for a row: its extension, else its name; a folder by its name', () => {
    expect(ruleFor('mixed 24.GIF', 'file')).toEqual({ match: '*.gif', kind: 'file', label: 'all .gif files' })
    expect(ruleFor('a.test.ts', 'file')).toEqual({ match: '*.ts', kind: 'file', label: 'all .ts files' })
    expect(ruleFor('Makefile', 'file')).toEqual({ match: 'Makefile', kind: 'file', label: 'all files named Makefile' })
    expect(ruleFor('.gitignore', 'file')).toEqual({ match: '.gitignore', kind: 'file', label: 'all files named .gitignore' })
    expect(ruleFor('src', 'folder')).toEqual({ match: 'src', kind: 'folder', label: 'all folders named src' })
  })

  it("a name's own glob characters are escaped: the rule matches that name, and no other", () => {
    const braces = ruleFor('{a,b}', 'folder')
    expect(braces).toEqual({ match: '\\{a\\,b\\}', kind: 'folder', label: 'all folders named {a,b}' })
    expect(globRegExp(braces.match).test('{a,b}')).toBe(true)
    expect(globRegExp(braces.match).test('a')).toBe(false)
    const star = ruleFor('a*', 'file')
    expect(star.match).toBe('a\\*')
    expect(globRegExp(star.match).test('a*')).toBe(true)
    expect(globRegExp(star.match).test('abc')).toBe(false)
    expect(globRegExp(ruleFor('what?', 'file').match).test('whats')).toBe(false)
    expect(globRegExp(ruleFor('back\\slash', 'file').match).test('back\\slash')).toBe(true)
    // An extension is escaped too, and a glob the user typed keeps its meaning.
    expect(ruleFor('x.{b}', 'file').match).toBe('*.\\{b\\}')
    expect(globRegExp('*.{png,gif}').test('a.gif')).toBe(true)
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

describe("Material's tables load lazily (YAZ-3470)", () => {
  it('before they land a row has the default icon and a pick waits; their landing is one change for every level, then none', async () => {
    vi.resetModules()
    const fresh = await import('./rowIcons')
    const material = await import('./materialIcons')
    expect(material.materialIconsLoaded()).toBe(false)
    const before = fresh.buildRowIcons({ [V]: { paths: { '/v/a.ts': 'lua' } } }, [V], [{ match: '*.md', kind: 'file', icon: 'python' }], true)
    expect(before.material).toBe(false)
    expect(fresh.rowIcon(before, '/v/a.ts', 'a.ts', 'file')).toEqual({ id: 'file', custom: false })
    expect(fresh.rowIcon(before, '/v/b.md', 'b.md', 'file')).toEqual({ id: 'file', custom: false })
    expect(fresh.rowIcon(before, '/v/src', 'src', 'folder', true)).toEqual({ id: 'folder', custom: false })
    expect(material.iconUrl('file')).toBe('/material-icons/file.svg')

    await material.loadMaterialIcons()
    const after = fresh.buildRowIcons({ [V]: { paths: { '/v/a.ts': 'lua' } } }, [V], [{ match: '*.md', kind: 'file', icon: 'python' }], true, before)
    expect(after).not.toBe(before)
    expect(after.material).toBe(true)
    expect(fresh.iconsChangedBelow(before, after, () => false)).toBe(true)
    expect(fresh.rowIcon(after, '/v/a.ts', 'a.ts', 'file')).toEqual({ id: 'lua', custom: true })
    expect(fresh.rowIcon(after, '/v/b.md', 'b.md', 'file')).toEqual({ id: 'python', custom: true })
    expect(fresh.rowIcon(after, '/v/src', 'src', 'folder', true)).toEqual({ id: 'folder-src-open', custom: false })
    // Built again with nothing new: the same object, so no level renders.
    const again = fresh.buildRowIcons({ [V]: { paths: { '/v/a.ts': 'lua' } } }, [V], [{ match: '*.md', kind: 'file', icon: 'python' }], true, after)
    expect(again).toBe(after)
    expect(fresh.iconsChangedBelow(after, again, () => true)).toBe(false)
  })
})
