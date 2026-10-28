import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { iconUrl, iconVars, isMaterialIcon, materialFileIcon, materialFolderIcon, openIcon, pickableIcons } from './materialIcons'

const PUBLIC = resolve(__dirname, '../../public')

describe("Material Icon Theme's matching (YAZ-3440 D4)", () => {
  it('an exact file name wins over its extension, in any case', () => {
    expect(materialFileIcon('README.md')).toBe('readme')
    expect(materialFileIcon('readme')).toBe('readme')
    expect(materialFileIcon('Makefile')).toBe('makefile')
    expect(materialFileIcon('.gitignore')).toBe('git')
    expect(materialFileIcon('package.json')).toBe('nodejs')
    expect(materialFileIcon('other.json')).toBe('json')
  })

  it('then the longest extension: `test.ts` before `ts`; a dot file has the extension after its dot', () => {
    expect(materialFileIcon('a.test.ts')).toBe('test-ts')
    expect(materialFileIcon('a.ts')).toBe('typescript')
    expect(materialFileIcon('A.TS')).toBe('typescript')
    expect(materialFileIcon('.env')).toBe('tune')
  })

  it('then the default file', () => {
    expect(materialFileIcon('notes')).toBe('file')
    expect(materialFileIcon('a.nosuchextension')).toBe('file')
  })

  it('each kind of the demo vault has its own icon, and the code kinds of YAZ-3438 too', () => {
    const kinds: Record<string, string> = {
      'a.md': 'markdown', 'a.markdown': 'markdown', 'a.txt': 'document', 'a.json': 'json', 'a.py': 'python', 'a.toml': 'toml', 'a.sh': 'console',
      'a.pdf': 'pdf', 'a.png': 'image', 'a.jpg': 'image', 'a.gif': 'image', 'a.svg': 'svg', 'a.excalidraw': 'excalidraw', 'a.drawio': 'drawio', 'a.zip': 'zip',
      'a.lua': 'lua', 'a.r': 'r', 'a.dart': 'dart', 'a.scala': 'scala', 'a.hs': 'haskell', 'a.clj': 'clojure', 'a.proto': 'proto', 'a.diff': 'diff', 'a.patch': 'git',
      'a.gradle': 'gradle', 'a.groovy': 'groovy', 'a.ml': 'ocaml', 'a.erl': 'erlang', 'a.jl': 'julia', 'a.cmake': 'cmake', 'a.fs': 'fsharp', 'a.elm': 'elm',
    }
    for (const [name, icon] of Object.entries(kinds)) expect(materialFileIcon(name), name).toBe(icon)
  })

  it('folders by name in any case, with Material\'s prefixes, else the default; open is the `-open` twin', () => {
    expect(materialFolderIcon('docs')).toBe('folder-docs')
    expect(materialFolderIcon('SRC')).toBe('folder-src')
    expect(materialFolderIcon('.github')).toBe('folder-github')
    expect(materialFolderIcon('.venv')).toBe('folder-environment')
    expect(materialFolderIcon('__tests__')).toBe('folder-test')
    expect(materialFolderIcon('My notes 2026')).toBe('folder')
    expect(openIcon('folder-docs')).toBe('folder-docs-open')
    expect(openIcon('folder')).toBe('folder-open')
  })

  it('every icon the matching can name is a vendored file, and the picker lists no open or light twin', () => {
    for (const id of ['file', 'folder', 'folder-open', 'readme', 'test-ts', 'folder-docs-open', 'toml']) {
      expect(isMaterialIcon(id), id).toBe(true)
      expect(existsSync(resolve(PUBLIC, iconUrl(id).slice(1))), id).toBe(true)
    }
    expect(iconVars('toml')).toEqual({ '--icon': 'url(/material-icons/toml.svg)', '--icon-light': 'url(/material-icons/toml_light.svg)' })
    expect(iconVars('python')).toEqual({ '--icon': 'url(/material-icons/python.svg)' })
    const pickable = pickableIcons()
    expect(pickable).toContain('folder-docs')
    expect(pickable).not.toContain('folder-docs-open')
    expect(pickable).not.toContain('toml_light')
    expect(isMaterialIcon('no-such-icon')).toBe(false)
  })
})
