import { anyValue, array, boolean, confirm, documentEdit, documentTarget, integer, largeText, number, object, oneOf, pageInput, pageWith, recorded, resourceInput, result, string,
    type CommandDefinition } from './schema'

/** A note write: the file's new state. */
export const savedOutput = object({ path: string(), mtime: number, size: integer, revision: string(), diskSaved: boolean, ...recorded, rendererMerged: boolean, changed: boolean, comment: string() },
    ['path', 'mtime', 'size', 'revision', 'diskSaved', 'rendererMerged', 'changed'])
export const documentRequires = ['running app', 'explicit vault scope and one target', 'saved base revision']
const write = (name: string, description: string, input: CommandDefinition['input'], extra: Partial<CommandDefinition> = {}): CommandDefinition =>
  ({ name, description, effect: 'write', input, output: savedOutput, requires: documentRequires, ...extra })
const comment = object({ id: string(), n: integer, at: string(), title: string(), body: largeText, reply_to: string('The top-level parent’s ID.'), edited: string(), by: string('Who left it; absent for a person at the keyboard.') },
    ['id', 'at', 'body'])

export const documentCommands: CommandDefinition[] = [
  { name: 'file.read', description: 'Read a note’s saved text and its revision. It reads the file on disk, not an open editor’s unsaved buffer (use document.live for that).', effect: 'read',
      input: object(documentTarget),
      output: object({ path: string(), content: { type: 'string', maxLength: 10 * 1024 * 1024 }, mtime: number, size: integer, source: oneOf('disk'), revision: string() }, ['path', 'content', 'mtime', 'size', 'source', 'revision']),
      requires: ['running app', 'explicit vault scope and one target'] },
  write('file.write', 'Replace a note’s saved text with the body, if the file still has the revision you read. Open editors take the change as an outside edit.', object(documentEdit, ['revision']),
      { content: 'text', contentRequired: true }),
  write('file.append', 'Add the body to the end of a note’s saved text, if the file still has the revision you read. Open editors take the change as an outside edit.',
      object(documentEdit, ['revision']), { content: 'text', contentRequired: true }),
  write('property.set', 'Set one frontmatter property, named by its key path. Other properties and their formatting stay as they are.',
      object({ ...documentEdit, keys: array(string()), value: anyValue }, ['revision', 'keys', 'value'])),
  write('property.remove', 'Remove one frontmatter property, named by its key path.', object({ ...documentEdit, keys: array(string()) }, ['revision', 'keys'])),
  { name: 'comment.list', description: 'List a note’s comments, each with its ID and who left it, plus the note’s saved revision.', effect: 'read', input: object({ ...documentTarget, ...pageInput }),
      output: pageWith({ ...comment, additionalProperties: true, description: 'A comment as the note stores it. Extra keys in the file are kept.' }, { path: string(), revision: string() }),
      requires: ['running app', 'explicit vault scope and one target'] },
  write('comment.add', 'Add a comment to a note, or a reply to a top-level comment, signed by the agent. The body is the comment text.',
      object({ ...documentEdit, replyTo: string(), title: string(), by: string() }, ['revision']), { content: 'text', contentRequired: true }),
  write('comment.update', 'Change the text or title of a comment that an agent left. A person’s comment cannot be changed.',
      object({ ...documentEdit, comment: string(), title: string() }, ['revision', 'comment']), { content: 'text', contentRequired: true }),
  write('comment.remove', 'Delete a comment that an agent left, with its replies. A person’s comment cannot be deleted. confirm: true answers the delete sheet.',
      object({ ...documentEdit, comment: string(), confirm }, ['revision', 'comment', 'confirm'])),
  { name: 'note.create',
      description: 'Find the note with this title in the folder, or create it from the folder’s template and ID rules. A body, when given, replaces the template’s body of a new note.',
      effect: 'write', input: object({ ...resourceInput, folder: string(), title: string() }, ['folder', 'title']),
      output: object({ path: string(), title: string(), id: { type: ['string', 'null'] }, created: boolean, others: array(string()) }, ['path', 'title', 'id', 'created', 'others']), content: 'text',
      requires: ['running app', 'explicit vault scope and folder'] },
]
