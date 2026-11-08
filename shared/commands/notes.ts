import { documentRequires, savedOutput } from './documents'
import { array, boolean, confirm, documentEdit, documentTarget, integer, largeText, literal, nullable, number, object, oneOf, pageInput, pageSchema, pageWith, result, saved, string,
    type CommandDefinition, type CommandSchema } from './schema'

const linkPage = (items: CommandSchema): CommandSchema => { const page = pageSchema(items); return { ...page, properties: { ...page.properties, root: string(), path: string(), source: oneOf('index') }, required: [...page.required!, 'root', 'path', 'source'] } }
const foundNote = { path: string(), title: string(), id: nullable(string()), created: { ...boolean, description: 'This call created the note.' },
    others: array(string('Another note that matches the same title.')) }
const dailyNote = result({ note: { ...object(foundNote, Object.keys(foundNote)), type: ['object', 'null'], description: 'Null when find meets no daily note.' } })
const dailyInput = object({ root: string(), date: string('today, tomorrow, yesterday, or YYYY-MM-DD') }, ['root'])
const savedText = { path: string(), content: largeText, mtime: number, size: integer, source: literal('disk'), revision: string() }
const reviewEntry = result({ at: string(), rating: string(), text: string('The body fingerprint the review saw.') })
const review = (name: string, description: string, fields: Record<string, CommandSchema>, required: string[]): CommandDefinition =>
  ({ name, description, effect: 'write', input: object({ ...documentEdit, ...fields }, ['revision', ...required]), output: savedOutput, requires: documentRequires })

export const noteCommands: CommandDefinition[] = [
  { name: 'link.resolve', description: 'Find the note, folder, or board that one link text points to in a vault, with the app’s own rules for names and IDs. A link that points nowhere gives null.',
      effect: 'read', input: object({ root: string(), target: string() }, ['root', 'target']),
      output: result({ target: string(), path: nullable(string('The resolved note, folder, or board; null when missing.')), root: string() }), requires: ['explicit vault'] },
  { name: 'link.outgoing',
      description: 'List the links and embeds in a note or folder, from the index. A folder also lists the links in its settings and outline. Nothing is rewritten and no ID is assigned.',
      effect: 'read', input: object({ ...documentTarget, ...pageInput }),
      output: linkPage(object({ target: string(), path: { type: ['string', 'null'] }, embedded: { type: 'boolean' } }, ['target', 'path', 'embedded'])),
      requires: ['explicit vault scope and target'] },
  { name: 'link.incoming',
      description: 'List the notes and folders that link to this page, as its Linked mentions show them: links, embeds, folder outlines, view order and link-column targets. Sorted by path. Nothing is rewritten and no ID is assigned.',
      effect: 'read', input: object({ ...documentTarget, ...pageInput }),
      output: linkPage(object({ kind: oneOf('note', 'folder'), path: string(), settings: string('A folder’s settings record.'), title: string() }, ['kind', 'path', 'title'])),
      requires: ['explicit vault scope and target'] },
  { name: 'daily.find', description: 'Find the daily note of a date (today by default) where the app’s daily-note settings put it. Nothing is created; no note gives null.', effect: 'read',
      input: dailyInput, output: dailyNote, requires: ['explicit vault', 'daily notes enabled'] },
  { name: 'daily.create', description: 'Find or create the daily note of a date (today by default), with the app’s daily-note settings and template. Calls at the same time make one note.',
      effect: 'write', input: dailyInput, output: dailyNote, requires: ['explicit vault', 'daily notes enabled'] },
  { name: 'template.read', description: 'Read a folder’s template (.template.md) and its revision. An absent template reads as absent and is not created.', effect: 'read',
      input: object({ root: string(), folder: string() }, ['root', 'folder']), output: result({ ...savedText, revision: nullable(string()), exists: boolean }, ['content', 'mtime', 'size']),
      requires: ['explicit vault and folder'] },
  { name: 'template.write', description: 'Replace a folder’s template with the body, if it still has the revision you read. Pass revision null to create an absent template.', effect: 'write',
      input: object({ root: string(), folder: string(), revision: { type: ['string', 'null'] } }, ['root', 'folder', 'revision']), output: result({ ...savedText, ...saved, rendererMerged: boolean }),
      content: 'text', contentRequired: true, requires: ['explicit vault and folder', 'saved revision or null for creation'] },
  { name: 'review.queue', description: 'List the notes due for review, most overdue first, from the index.', effect: 'read',
      input: object({ root: string(), folder: string(), ...pageInput }, ['root']),
      output: pageWith(result({ path: string(), title: string(), due: { ...number, description: 'When the note is due, epoch ms.' } }), { root: string() }), requires: ['explicit vault'] },
  { name: 'review.list', description: 'List a note’s saved reviews, with the note’s revision.', effect: 'read', input: object({ ...documentTarget, ...pageInput }),
      output: pageWith(reviewEntry, { path: string(), revision: string() }), requires: ['explicit vault scope and note'] },
  review('review.keep', 'Record a review of the note now, as Keep does in the app, if the note still has the revision you read.', {}, []),
  review('review.remove', 'Remove one saved review of the note, named by its time (at), if the note still has the revision you read.', { at: string() }, ['at']),
  review('review.reset', 'Clear the note’s review history, if the note still has the revision you read. The history cannot come back: confirm: true answers the reset sheet.', { confirm },
      ['confirm']),
  review('review.setEnabled', 'Turn review on or off for the note, if the note still has the revision you read.', { enabled: { type: 'boolean' } }, ['enabled']),
]
