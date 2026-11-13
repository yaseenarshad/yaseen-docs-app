import type { Value } from '../expr'

/** The Type column's words (YAZ-5047): the value `file.kind` holds, as people say it. */
const TYPE_WORDS: Readonly<Record<string, string>> = { note: 'Page', card: 'Card', folder: 'Folder' }

/** What the Type column's cell shows for `file.kind`'s value: Page, Card or Folder; any other value as it is. */
export const typeWord = (value: Value): string => (typeof value === 'string' ? (TYPE_WORDS[value] ?? value) : '')
