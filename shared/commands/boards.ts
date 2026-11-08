import { array, boolean, embeddedFiles, integer, largeText, literal, nullable, number, object, oneOf, pageInput, pageSchema, recorded, resourceInput, result, saved, string, targetInput,
    type CommandDefinition, type CommandSchema } from './schema'

const boardTarget = { ...resourceInput, ...targetInput }
const boardFile = { path: string(), mtime: number, size: integer }
/** A board option write: the file's new mtime and size. Read the board again for its revision. */
const boardWritten = object({ ...boardFile, diskSaved: boolean, rendererMerged: boolean }, ['path', 'mtime', 'size', 'diskSaved'])
const boardSaved = object({ ...boardFile, revision: string(), persisted: array(string()), inside: boolean, movedOut: boolean, id: string(), diskSaved: boolean, ...recorded, rendererMerged: boolean },
    ['path', 'mtime', 'size', 'revision', 'diskSaved', 'rendererMerged'])
const boardRead = (kind: string) => kind === 'drawing'
  ? object({ ...boardFile, revision: string(), source: oneOf('disk'), json: largeText, stored: array(string()), files: embeddedFiles },
      ['path', 'mtime', 'size', 'revision', 'source', 'json', 'files', 'stored'])
  : object({ ...boardFile, revision: string(), source: oneOf('disk'), xml: largeText }, ['path', 'mtime', 'size', 'revision', 'source', 'xml'])
const exportSettings = {
  background: { ...boolean, description: 'Export the canvas background. Default: the export box’s current setting.' },
  darkMode: { ...boolean, description: 'Export in dark mode. Default: the export box’s current setting.' },
  scale: { type: 'integer', enum: [1, 2, 3], description: 'PNG/SVG scale. Not for PDF.' } as CommandSchema,
  embedScene: { ...boolean, description: 'Embed the scene in the PNG/SVG. Not for PDF.' },
  selectionOnly: { ...boolean, description: 'Export only the selection. Default: true when something is selected, as in the export box.' },
}
const noLiveEdits = 'no unsaved live edits of the file'
/** A drawing option of the board’s settings, under its revision. */
const drawingOption = (name: string, description: string, fields: Record<string, CommandSchema>): CommandDefinition =>
  ({ name: `drawing.${name}`, description: `${description} Refused while an open editor holds unsaved edits of this file.`, effect: 'write', input: object({ ...boardTarget, revision: string(), ...fields }, ['revision', ...Object.keys(fields).filter(key => key !== 'folder')]), output: boardWritten, requires: ['explicit drawing and saved revision', noLiveEdits] })

const boardKind = (kind: 'drawing' | 'diagram'): CommandDefinition[] => {
  const file = kind === 'drawing' ? '.excalidraw' : '.drawio'
  return [
    { name: `${kind}.read`, description: `Read a saved ${kind} and its revision. A file over the connection limit is refused before it is read; use ${kind}.export for it.`, effect: 'read',
        input: object(boardTarget), output: boardRead(kind), requires: ['explicit vault scope and target'] },
    { name: `${kind}.create`, description: `Create an empty ${kind} file at a new path. An existing file is never replaced.`, effect: 'write',
        input: object({ ...resourceInput, path: string() }, ['path']), output: object({ path: string(), mtime: number, size: integer, diskSaved: boolean }, ['path', 'mtime', 'size', 'diskSaved']),
        requires: ['explicit vault scope and new path'] },
    { name: `${kind}.save`,
        description: `Replace a saved ${kind} with the body (or sourceFile), if the file still has the revision you read. Refused while an open editor holds unsaved edits of this file. Embedded pictures follow the app’s picture rules.`,
        effect: 'write', input: object({ ...boardTarget, revision: string(), sourceFile: string() }, ['revision']), output: boardSaved, content: 'text',
        requires: ['explicit vault scope and target', 'saved revision', 'body or source file', noLiveEdits] },
    { name: `${kind}.setReadOnly`,
        description: `Turn the ${kind}’s Read only switch on or off, if the file still has the revision you read. The switch is for people; agent writes work either way. Refused while an open editor holds unsaved edits of this file.`,
        effect: 'write', input: object({ ...boardTarget, revision: string(), on: boolean }, ['revision', 'on']), output: boardWritten, requires: ['explicit board and saved revision', noLiveEdits] },
    { name: `${kind}.export`,
        description: `Copy the saved ${kind} to a new standalone ${file} file, pictures embedded. An existing file is never replaced. This is not the app’s standard-font copy and not an image; use ${kind}.exportImage for ${kind === 'drawing' ? 'PNG, SVG, or PDF' : 'PNG or SVG'}.`,
        effect: 'write', input: object({ ...boardTarget, outputFile: string() }, ['outputFile']),
        output: object({ path: string(), outputFile: string(), revision: string(), size: integer, source: oneOf('disk'), diskSaved: boolean }, ['path', 'outputFile', 'revision', 'size', 'source', 'diskSaved']),
        requires: ['explicit vault scope and target', 'new output file'] },
    { name: `${kind}.exportImage`, description: kind === 'drawing'
      ? 'Export a live drawing tab as PNG, SVG, or PDF with the export box’s own renderer and PDF printer, with no dialog. Unsaved canvas edits are included; the board file is not touched. Writes a new file only; the extension must match the format.'
      : 'Export a live diagram tab as PNG or SVG with File › Export Image…’s renderer, with no dialog. Unsaved edits are included; the board file is not touched. Writes a new file only. The app has no diagram PDF.', effect: 'write',
      input: object({ window: string(), tab: string(), format: oneOf(...(kind === 'drawing' ? ['png', 'svg', 'pdf'] : ['png', 'svg'])), outputFile: string('Absolute path of a new file.'), ...(kind === 'drawing' ? exportSettings : {}) },
          ['window', 'tab', 'format', 'outputFile']),
      output: object({ window: string(), tab: string(), path: string(), format: string(), outputFile: string(), size: integer, dirty: boolean, source: oneOf('live'), diskSaved: boolean },
          ['window', 'tab', 'path', 'format', 'outputFile', 'size', 'dirty', 'source', 'diskSaved']), requires: [`explicit live window and ready ${kind} tab`, 'new output file'] },
  ]
}

export const boardCommands: CommandDefinition[] = [
  ...boardKind('drawing'),
  drawingOption('setHoverLinks', 'Turn the drawing’s link previews on hover on or off.', { on: boolean }),
  drawingOption('setHoverOutline', 'Set the drawing’s outline on hover: true, false, or app to follow the app setting.', { value: { type: ['boolean', 'string'], enum: [true, false, 'app'] } }),
  drawingOption('setFoldArrows', 'Set when the drawing shows its fold arrows: app, hover, always, or off.', { value: oneOf('app', 'hover', 'always', 'off') }),
  drawingOption('setPictures', 'Choose whether the drawing keeps new pictures out of the file (out: true), and in which folder. A folder outside the vault must be an allowed picture folder.',
      { out: boolean, folder: string() }),
  ...boardKind('diagram'),
]

const binaryRead = result({ path: string(), mime: string(), data: { ...largeText, description: 'The bytes, base64.' }, size: integer, mtime: number, revision: string(), encoding: literal('base64'), source: literal('disk') },
    ['mime'])
const binaryExport = result({ path: string(), outputFile: string(), size: integer, revision: string(), source: literal('disk'), ...saved })
const sizeCount = result({ bytes: number, count: integer })
const vaultFile = string('Vault-relative path.')
const fileKind = (kind: 'asset' | 'image' | 'pdf', what: string): CommandDefinition[] => [
  { name: `${kind}.read`, description: `Read a saved ${what} as base64, with its revision. A file too large for the connection is refused; use ${kind}.export for it.`, effect: 'read',
      input: object(boardTarget), output: binaryRead, requires: ['explicit vault scope and target'] },
  { name: `${kind}.export`, description: `Copy a saved ${what} to a new file. An existing file is never replaced. The size limit of its file kind applies.`, effect: 'write',
      input: object({ ...boardTarget, outputFile: string() }, ['outputFile']), output: binaryExport, requires: ['explicit vault scope and target'] },
]

export const assetCommands: CommandDefinition[] = [
  ...fileKind('asset', 'board asset (a picture or an embedded drawing)'),
  { name: 'asset.write',
      description: 'Write a board asset: picture bytes or an embedded drawing’s UTF-8 JSON, 10 MiB at most. Replace it with the revision you read, or pass null to create a new one. Refused while an open editor holds unsaved edits of the asset.',
      effect: 'write', input: object({ ...resourceInput, path: string(), revision: { type: ['string', 'null'] } }, ['path', 'revision']),
      output: result({ path: string(), mtime: number, size: integer, revision: string(), ...saved, rendererMerged: boolean }), content: 'binary', contentRequired: true,
      requires: ['explicit vault and asset path', 'saved revision or null for creation'] },
  ...fileKind('image', 'image'),
  ...fileKind('pdf', 'PDF'),
  { name: 'storage.stats',
      description: 'Measure a vault’s disk use: boards, pictures, other files, Git history, and pictures embedded in boards. The large-file list is paged; the totals cover the whole vault.',
      effect: 'read', input: object({ root: string(), ...pageInput }, ['root']),
      output: result({ root: string(), boards: sizeCount, pictures: sizeCount, other: sizeCount, git: nullable(result({ historyBytes: number, headBytes: number, oldVersionsBytes: number })), large: pageSchema(result({ path: vaultFile, bytes: number })), embedded: result({ bytes: number, boards: integer }) }),
      requires: ['explicit vault'] },
  { name: 'storage.shrink',
      description: 'Move pictures embedded in a vault’s boards out to files, as Settings does, and report how many boards shrank. Boards with unsaved live edits are skipped and listed in unsavedSkipped.',
      effect: 'write', input: object({ root: string(), skip: array(string()) }, ['root']),
      output: result({ root: string(), shrunk: integer, skipped: integer, bytesMoved: number, unsavedSkipped: array(result({ window: string(), path: string(), tabs: array(string()), reason: literal('UNSAVED_LIVE_EDITS') })), ...saved, rendererMerged: boolean }),
      requires: ['explicit vault'] },
]
