/**
 * The icon picker's "Suggested" row (YAZ-3440 C, demo round 2): what the row shows now, the icons whose names are
 * of its kind (an image's: image, gif, svg…; a folder's: folder-*), then the common file icons. Pure.
 */
import { isMaterialIcon, materialFileIcon, materialFolderIcon, pickableIcons } from './materialIcons'

/** The picker's size in screen px (it is out of the sidebar zoom): about 10 cells of 44px, plus its padding. */
export const PICKER_W = 480
export const PICKER_MAX_H = 520
/** Cells per row of the grid, for the arrow keys (app.css lays out the same number). */
export const PICKER_COLUMNS = 10

/** The icons a file of no particular kind is likeliest to want. */
const COMMON_FILE = ['file', 'markdown', 'document', 'pdf', 'image', 'json', 'javascript', 'typescript', 'python', 'html', 'css', 'yaml', 'toml', 'console', 'zip', 'table', 'settings', 'database', 'git', 'readme', 'lock', 'video', 'audio', 'word']
const COMMON_FOLDER = ['folder', 'folder-docs', 'folder-src', 'folder-app', 'folder-images', 'folder-resource', 'folder-config', 'folder-test', 'folder-scripts', 'folder-archive', 'folder-public', 'folder-lib', 'folder-utils', 'folder-database', 'folder-template', 'folder-video', 'folder-audio', 'folder-temp', 'folder-shared', 'folder-content']

/** Names that belong together, by the Material icon a file matches: an image's neighbours are gif, svg and the rest. */
const FAMILIES: readonly (readonly string[])[] = [
  ['image', 'gif', 'svg', 'favicon', 'adobe-photoshop', 'adobe-illustrator', 'figma', 'excalidraw', 'drawio'],
  ['markdown', 'readme', 'document', 'changelog', 'license', 'markdoc', 'mdx'],
  ['javascript', 'typescript', 'react', 'react_ts', 'test-js', 'test-ts', 'nodejs', 'json'],
  ['video', 'audio', 'subtitles'],
  ['zip', 'archive'],
  ['table', 'database', 'word', 'powerpoint', 'pdf'],
  ['console', 'powershell', 'settings', 'docker', 'makefile'],
]

/** At most this many suggestions: three rows of the grid. */
const MAX_SUGGESTED = 30

export function suggestIcons(name: string, kind: 'file' | 'folder', shown: string): string[] {
  const out: string[] = []
  const add = (id: string) => {
    if (out.length < MAX_SUGGESTED && isMaterialIcon(id) && !out.includes(id)) out.push(id)
  }
  add(shown)
  if (kind === 'folder') {
    add(materialFolderIcon(name))
    for (const id of COMMON_FOLDER) add(id)
    return out
  }
  const matched = materialFileIcon(name)
  add(matched)
  for (const family of FAMILIES) if (family.includes(matched)) for (const id of family) add(id)
  // Icons named after the extension or the match itself (`gif` → `gif`, `typescript` → `typescript-def`).
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''
  for (const id of pickableIcons()) if ((ext !== '' && id === ext) || (matched !== 'file' && id.startsWith(`${matched}-`))) add(id)
  for (const id of COMMON_FILE) add(id)
  return out
}
