import { createWikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { linkResolver, vaultDirs } from '../links/folderLinks'
import type { FolderHost } from './ViewsPane'
import { TEST_RECORDS } from './testRecords'

/**
 * The `FolderHost` bundle every `ViewsPane` mount needs since YAZ-846 made it REQUIRED — the
 * folder view is the only mount there is, so a test that renders views renders a folder's
 * views. Defaults: NO column declarations (so typing falls to the lower rungs a test is
 * exercising), `TEST_RECORDS` as the whole vault, and a `create` that fails loudly if a test
 * presses New without saying what should happen.
 *
 * It lives here rather than beside `TEST_RECORDS` on purpose: `testRecords.ts` is deep-equalled by
 * the MAIN-process index test (`desktop/src/main/vaultIndex/live.test.ts`), and desktop's tsconfig
 * has no `jsx` — a `.tsx` import from that file breaks a typecheck two workspaces away.
 */
export function testFolderHost(over: Partial<FolderHost> = {}): FolderHost {
  return {
    settings: { columns: {}, views: [], problems: [] },
    vaultRecords: TEST_RECORDS,
    vaultFolders: [],
    resolveLink: (target) => linkResolver(over.vaultRecords ?? TEST_RECORDS, '/vault', vaultDirs('/vault'), over.vaultFolders ?? [])(target),
    create: () => Promise.reject(new Error('this test did not expect a create')),
    setColumn: () => Promise.reject(new Error('this test did not expect a column definition write')),
    setColumns: () => {
      throw new Error('this test did not expect a column write')
    },
    deleteColumn: () => Promise.reject(new Error('this test did not expect a column delete')),
    wikilinks: createWikilinkResolveSource(),
    ...over,
  }
}
