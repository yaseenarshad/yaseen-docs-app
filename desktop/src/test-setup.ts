import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

// The door keeps this Mac's ID in the app data folder (YAZ-2677 R13). A test never touches the real
// one: each test file gets its own, by the override the app itself reads. No project module is
// imported here, so a test's `vi.mock` still reaches every one of them.
process.env.YASEEN_DOCS_USER_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'mdapp-userdata-'))
