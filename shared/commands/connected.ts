import { array, boolean, embeddedFiles, exported, integer, largeText, literal, nullable, number, object, oneOf, pageInput, pageSchema, pageWith, result, saved, string, targetInput,
    type CommandDefinition, type CommandSchema } from './schema'

const providerState = { provider: literal('pixabay'), configured: { ...boolean, description: 'Whether a key is stored. The key itself is never returned.' } }
const shareStatus = result({ state: oneOf('off', 'ready'), url: nullable(string()), workersDevUrl: nullable(string()), customDomain: nullable(string()), accountName: nullable(string()), workerName: nullable(string()), bucketName: nullable(string()), readyAt: nullable(number), demo: boolean })
const shareFields = { path: string(), id: string(), url: string(), allowDownload: boolean, sharedAt: number, updatedAt: number,
    sync: result({ state: oneOf('ok', 'uploading', 'failed'), message: string(), failedAt: number }, ['message', 'failedAt']), stale: boolean }
const shareEntry = result(shareFields)
const vaultFile = string('Vault-relative path.')
const syncStatus = result({
  root: string(), state: oneOf('off', 'synced', 'pending', 'syncing', 'attention'), attention: oneOf('no-git', 'no-identity', 'auth', 'conflict', 'error', 'too-large'), message: string(),
  repo: result({ remoteUrl: nullable(string()), branch: nullable(string()) }), enabled: boolean, tooLarge: array(vaultFile),
  merged: array(result({ path: vaultFile, author: string(), clashes: integer, copy: vaultFile }, ['copy'])),
}, ['attention', 'message', 'repo', 'enabled', 'tooLarge', 'merged'])
const boardVersion = result({ ref: string('Pass back to history read, export, or restore.'), author: string(), at: number, merged: boolean, localOnly: boolean })
const board = { root: string(), ...targetInput }
const versionInput = (fields: Record<string, CommandSchema> = {}) => object({ ...board, ref: string(), ...fields }, ['root', 'ref', ...Object.keys(fields)])
const secret = { content: 'secret', contentRequired: true, requires: ['private file or stdin credential'] } as const
const command = (name: string, description: string, effect: CommandDefinition['effect'], input: CommandSchema, output: CommandSchema, requires: readonly string[] = ['running app'],
    extra: Partial<CommandDefinition> = {}): CommandDefinition =>
  ({ name, description, effect, input, output, requires, ...extra })
const sync = (name: string, description: string, effect: CommandDefinition['effect'], fields: Record<string, CommandSchema> = {}) =>
  command(`sync.${name}`, description, effect, object({ root: string(), ...fields }, ['root', ...Object.keys(fields)]), syncStatus, ['explicit vault'])

export const connectedCommands: CommandDefinition[] = [
  command('provider.status', 'Say whether a Pixabay key is stored. The key is never returned.', 'read', object({}), result(providerState)),
  command('provider.set', 'Store the Pixabay key, read from stdin or a private file, then fetch the favorites’ local copies that waited for it.', 'remote', object({}),
      result({ ...providerState, ...saved }), undefined, secret),
  command('provider.clear', 'Remove the stored Pixabay key.', 'write', object({}), result({ ...providerState, ...saved })),
  sync('status', 'Read a vault’s Git sync state, as the sync button shows it.', 'read'),
  sync('now', 'Sync a vault with its Git remote now, as the sync button does, and reply with the state after.', 'remote'),
  sync('setEnabled', 'Turn Git sync for a vault on or off.', 'remote', { enabled: boolean }),
  command('history.list', 'List the saved Git versions of a board, including the local version kept before a merge.', 'read', object({ ...board, ...pageInput }, ['root']),
      pageWith(boardVersion, { path: string() }), ['explicit vault and board']),
  command('history.read', 'Read one Git version of a board, named by its ref from history.list.', 'read', versionInput(),
      result({ path: string(), ref: string(), kind: oneOf('drawing', 'diagram'), json: largeText, files: embeddedFiles, xml: largeText }, ['json', 'files', 'xml']),
      ['explicit vault and board', 'existing version reference']),
  command('history.export', 'Save one Git version of a board to a new JSON file. An existing file is never replaced.', 'write', versionInput({ outputFile: string() }),
      result({ path: string(), ...exported }), ['explicit vault and board', 'existing version reference']),
  command('history.restore', 'Make one Git version the board’s saved content, if the board still has the revision you read. Refused while an open editor holds unsaved edits of the board.', 'write',
      versionInput({ revision: string() }), result({ path: string(), ...saved, rendererMerged: boolean }), ['explicit vault and board', 'existing version reference']),
  command('share.status', 'Read the sharing setup: its state, address, and account. Stored credentials are never returned.', 'read', object({}), shareStatus),
  command('share.accounts', 'List the Cloudflare accounts that a token (from stdin or a private file) can use for sharing.', 'remote', object(pageInput),
      pageSchema(result({ id: string(), name: string() })), undefined, secret),
  command('share.setup', 'Set up sharing on a Cloudflare account, with a token from stdin or a private file, as Settings does.', 'remote', object({ accountId: string() }), shareStatus, undefined,
      secret),
  command('share.list', 'List a vault’s saved shares. It does not contact the server.', 'read', object({ root: string(), ...pageInput }, ['root']),
      pageSchema(result({ ...shareFields, fileExists: boolean })), ['explicit vault']),
  command('share.check', 'Check a vault’s saved shares against the sharing server.', 'remote', object({ root: string(), ...pageInput }, ['root']),
      pageSchema(result({ ...shareFields, fileExists: boolean })), ['explicit vault']),
  command('share.get', 'Read the share of one board, or null when it is not shared.', 'read', object(board, ['root']),
      result({ path: string(), share: { ...shareEntry, type: ['object', 'null'], description: 'Null when the board is not shared.' } }), ['explicit vault and board']),
  command('share.publish', 'Publish a board, or update its share: the body is the standalone board content. Pass shareId only to update an existing share.', 'remote',
      object({ ...board, shareId: string() }, ['root']), shareEntry, ['explicit vault and board', 'standalone board content'], { content: 'text', contentRequired: true }),
  command('share.setPermission', 'Allow or stop downloads of a shared board. A board with no saved share fails with NOT_FOUND.', 'remote',
      object({ ...board, allowDownload: boolean }, ['root', 'allowDownload']), shareEntry, ['explicit vault and board']),
  command('share.stop', 'Stop sharing a board. A board with no saved share fails with NOT_FOUND.', 'remote', object(board, ['root']), result({ path: string(), stopped: literal(true) }),
      ['explicit vault and board']),
  command('share.setDomain', 'Give the share links your own hostname, or remove it with null.', 'remote', object({ hostname: { type: ['string', 'null'], maxLength: 253 } }, ['hostname']), shareStatus,
      ['configured sharing']),
  command('share.disconnect', 'Turn sharing off for a vault, or for the app with root null. deleteEverything chooses whether the server’s copies are deleted too.', 'remote',
      object({ root: { type: ['string', 'null'], maxLength: 4096 }, deleteEverything: boolean }, ['root', 'deleteEverything']), shareStatus, ['explicit scope and deletion choice']),
]
