import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { EDIT_GAP_MS } from '@shared/types'
import { git, resolveGit } from '../git/exec'
import { syncPass } from '../git/sync'
import { createStore, type Store } from '../store'
import { _evictAll, flushIndexCache, getIndex, initIndexCache, onColdStartDiff } from '../vaultIndex'
import {
  COLD_START_MAX_FILES,
  _resetExternalEditsForTest,
  handleColdStartDiff,
  handleExternalWatchEvent,
  isExternalGitMutation,
  isSuppressedExternalEdit,
  isTrackableVaultFile,
  isWorkingTreeMutatingReflog,
  parseReflogLines,
  registerExternalEdits,
  suppressExternalEdit,
  suppressExternalRoot,
  withSuppressedEdit,
  withSuppressedRoot,
} from './externalEdits'
import { sleep } from './testFixture'

const T = 1_700_000_000_000
const dirsToClean: string[] = []

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix))
  dirsToClean.push(dir)
  return dir
}

async function makeTestStore(root: string): Promise<{ store: Store; commits: number[] }> {
  const stateDir = await makeTempDir('yd-ext-edits-store-')
  const store = createStore(path.join(stateDir, 'yaseendocs.json'))
  store.upsertWindow({
    id: 'w1',
    root,
    file: null,
    tabs: [],
    sidebarCollapsed: false,
    sidebarLens: 'files',
    bounds: { x: 0, y: 0, width: 800, height: 600 },
  })
  const commits: number[] = []
  store.onChange(() => commits.push(Date.now()))
  return { store, commits }
}

async function runGit(bin: string, cwd: string, args: string[]): Promise<void> {
  const res = await git(bin, cwd, args)
  if (res.code !== 0) throw new Error(`git ${args.join(' ')} failed (${res.code}): ${res.stderr}\n${res.stdout}`)
}

async function initGitRepo(bin: string, dir: string): Promise<void> {
  await runGit(bin, dir, ['init', '-b', 'main'])
  await runGit(bin, dir, ['config', 'user.name', 'Test User'])
  await runGit(bin, dir, ['config', 'user.email', 'test@example.com'])
}

afterEach(async () => {
  onColdStartDiff(undefined)
  _evictAll()
  _resetExternalEditsForTest()
  while (dirsToClean.length > 0) {
    const dir = dirsToClean.pop()!
    await rm(dir, { recursive: true, force: true })
  }
})

describe('externalEdits suppression & path filtering (YAZ-6501)', () => {
  it('filters dot-segments, node_modules, atomic tmps, outside paths, and non-openable extensions', () => {
    const root = '/vault'
    expect(isTrackableVaultFile(root, '/vault/Note.md')).toBe(true)
    expect(isTrackableVaultFile(root, '/vault/sub/script.ts')).toBe(true)
    expect(isTrackableVaultFile(root, '/vault/Board.excalidraw')).toBe(true)
    expect(isTrackableVaultFile(root, '/vault/Flow.drawio')).toBe(true)
    expect(isTrackableVaultFile(root, '/vault/Dockerfile')).toBe(true)

    expect(isTrackableVaultFile(root, '/vault/.folder.md')).toBe(false)
    expect(isTrackableVaultFile(root, '/vault/sub/.folder.md')).toBe(false)
    expect(isTrackableVaultFile(root, '/vault/.yaseendocs/ids.json')).toBe(false)
    expect(isTrackableVaultFile(root, '/vault/.trash/old.md')).toBe(false)
    expect(isTrackableVaultFile(root, '/vault/.git/HEAD')).toBe(false)
    expect(isTrackableVaultFile(root, '/vault/node_modules/pkg/README.md')).toBe(false)
    expect(isTrackableVaultFile(root, '/vault/Note.md.tmp-0123456789ab')).toBe(false)
    expect(isTrackableVaultFile(root, '/vault/scratch.tmp')).toBe(false)
    expect(isTrackableVaultFile(root, '/vault/archive.zip')).toBe(false)
    expect(isTrackableVaultFile(root, '/vault/report.docx')).toBe(false)
    expect(isTrackableVaultFile(root, '/other/Note.md')).toBe(false)
    expect(isTrackableVaultFile(root, '/vault')).toBe(false)
  })

  it('tracks path and root suppressions with refcounting and settle tails', async () => {
    const root = '/vault'
    const file = '/vault/a.md'
    expect(isSuppressedExternalEdit(root, file)).toBe(false)

    suppressExternalEdit(file, 500)
    expect(isSuppressedExternalEdit(root, file)).toBe(true)
    expect(isSuppressedExternalEdit(root, file, Date.now() + 1_000)).toBe(false)

    let duringEdit = false
    await withSuppressedEdit(
      file,
      async () => {
        duringEdit = isSuppressedExternalEdit(root, file)
      },
      500,
    )
    expect(duringEdit).toBe(true)
    expect(isSuppressedExternalEdit(root, file)).toBe(true)

    let innerSuppressed = false
    let outerStillSuppressed = false
    await withSuppressedRoot(
      root,
      async () => {
        await withSuppressedRoot(
          root,
          async () => {
            innerSuppressed = isSuppressedExternalEdit(root, '/vault/sub/b.md')
          },
          0,
        )
        outerStillSuppressed = isSuppressedExternalEdit(root, '/vault/sub/b.md', Date.now() + 10_000)
      },
      500,
    )
    expect(innerSuppressed).toBe(true)
    expect(outerStillSuppressed).toBe(true)
    expect(isSuppressedExternalEdit(root, '/vault/sub/b.md')).toBe(true)
    expect(isSuppressedExternalEdit(root, '/vault/sub/b.md', Date.now() + 1_000)).toBe(false)

    suppressExternalRoot('/vault/dir', 500)
    expect(isSuppressedExternalEdit(root, '/vault/dir/nested.md')).toBe(true)
    expect(isSuppressedExternalEdit(root, '/vault/dir-other/nested.md')).toBe(false)
  })

  it('parses git reflog lines and distinguishes local commits from working-tree mutations', () => {
    const sha1 = 'a'.repeat(40)
    const sha2 = 'b'.repeat(40)
    const sample = [
      `${sha1} ${sha2} Yaseen <y@example.com> 1700000100 -0700\tcommit: sync: a.md`,
      `${sha1} ${sha2} Yaseen <y@example.com> 1700000110 -0700\tcommit (amend): fix`,
      `${sha1} ${sha2} Yaseen <y@example.com> 1700000120 -0700\tcommit (initial): init`,
      `${sha1} ${sha2} Yaseen <y@example.com> 1700000130 -0700\tpull: Fast-forward`,
      `${sha1} ${sha2} Yaseen <y@example.com> 1700000140 -0700\treset: moving to @{u}`,
      `${sha1} ${sha2} Yaseen <y@example.com> 1700000150 -0700\trebase (finish): returning to refs/heads/main`,
      `${sha1} ${sha2} Yaseen <y@example.com> 1700000160 -0700\tcheckout: moving from main to feat`,
    ].join('\n')

    const parsed = parseReflogLines(sample)
    expect(parsed).toHaveLength(7)
    expect(parsed[0]).toEqual({ oldSha: sha1, newSha: sha2, at: 1_700_000_100_000, action: 'commit: sync: a.md' })
    expect(parsed.map((e) => isWorkingTreeMutatingReflog(e.action))).toEqual([false, false, false, true, true, true, true])
  })
})

describe('handleExternalWatchEvent (YAZ-6501)', () => {
  it('logs live external change and fresh add, ignores non-openable, dot-files, old adds, suppressed paths, and in-app echo', async () => {
    const root = await makeTempDir('yd-ext-watch-')
    const { store, commits } = await makeTestStore(root)

    // External change on .md logs at Math.min(ev.mtime, now)
    expect(await handleExternalWatchEvent(store, root, { type: 'change', path: path.join(root, 'AI.md'), mtime: T - 100 }, { now: T })).toBe(true)
    expect(store.get().folders[root].edits[path.join(root, 'AI.md')]).toBe(T - 100)
    expect(commits).toHaveLength(1)

    // Fresh external add (mtime within 60s) logs
    expect(await handleExternalWatchEvent(store, root, { type: 'add', path: path.join(root, 'Fresh.md'), mtime: T - 500 }, { now: T })).toBe(true)
    expect(store.get().folders[root].edits[path.join(root, 'Fresh.md')]).toBe(T - 500)
    expect(commits).toHaveLength(2)

    // Future mtime clamps to now
    expect(await handleExternalWatchEvent(store, root, { type: 'change', path: path.join(root, 'Future.md'), mtime: T + 60_000 }, { now: T })).toBe(true)
    expect(store.get().folders[root].edits[path.join(root, 'Future.md')]).toBe(T)
    expect(commits).toHaveLength(3)

    // Old file add (moved/copied untouched file with mtime > 60s ago) does NOT jump to Today
    expect(await handleExternalWatchEvent(store, root, { type: 'add', path: path.join(root, 'OldMove.md'), mtime: T - EDIT_GAP_MS - 1 }, { now: T })).toBe(false)
    expect(store.get().folders[root].edits[path.join(root, 'OldMove.md')]).toBeUndefined()

    // Dot-files and non-openable files are ignored
    expect(await handleExternalWatchEvent(store, root, { type: 'change', path: path.join(root, '.folder.md'), mtime: T }, { now: T })).toBe(false)
    expect(await handleExternalWatchEvent(store, root, { type: 'change', path: path.join(root, '.yaseendocs', 'ids.json'), mtime: T }, { now: T })).toBe(false)
    expect(await handleExternalWatchEvent(store, root, { type: 'change', path: path.join(root, '.trash', 'gone.md'), mtime: T }, { now: T })).toBe(false)
    expect(await handleExternalWatchEvent(store, root, { type: 'change', path: path.join(root, 'notes.tmp'), mtime: T }, { now: T })).toBe(false)
    expect(await handleExternalWatchEvent(store, root, { type: 'change', path: path.join(root, 'blob.bin'), mtime: T }, { now: T })).toBe(false)
    expect(await handleExternalWatchEvent(store, root, { type: 'unlink', path: path.join(root, 'AI.md') }, { now: T })).toBe(false)

    // Suppressed path (quiet write / system write) does NOT log
    const quietFile = path.join(root, 'Quiet.md')
    suppressExternalEdit(quietFile, 5_000)
    expect(await handleExternalWatchEvent(store, root, { type: 'change', path: quietFile, mtime: Date.now() })).toBe(false)
    expect(store.get().folders[root].edits[quietFile]).toBeUndefined()

    // Normal in-app save at T followed by watcher echo with disk mtime 5ms earlier is a complete no-op (zero extra commits)
    const inApp = path.join(root, 'InApp.md')
    store.addEdit([root], inApp, T)
    const commitsAfterSave = commits.length
    expect(await handleExternalWatchEvent(store, root, { type: 'change', path: inApp, mtime: T - 5 }, { now: T + 100 })).toBe(false)
    expect(await handleExternalWatchEvent(store, root, { type: 'change', path: inApp, mtime: T + 50 }, { now: T + 100 })).toBe(false)
    expect(commits).toHaveLength(commitsAfterSave)
    expect(store.get().folders[root].edits[inApp]).toBe(T)

    // External edit after EDIT_GAP_MS updates timestamp
    expect(await handleExternalWatchEvent(store, root, { type: 'change', path: inApp, mtime: T + EDIT_GAP_MS }, { now: T + EDIT_GAP_MS + 50 })).toBe(true)
    expect(store.get().folders[root].edits[inApp]).toBe(T + EDIT_GAP_MS)
  })

  it('captures live AI edits on disk via registerExternalEdits while skipping suppressed writes', async () => {
    const root = await makeTempDir('yd-ext-live-')
    const { store } = await makeTestStore(root)
    registerExternalEdits(store)
    await sleep(150)

    const aiFile = path.join(root, 'AgentNote.md')
    await writeFile(aiFile, '# Written by AI\n')

    const suppressedFile = path.join(root, 'SystemSweep.md')
    await withSuppressedEdit(suppressedFile, () => writeFile(suppressedFile, '# Suppressed\n'), 3_000)

    const deadline = Date.now() + 5_000
    while (Date.now() < deadline && store.get().folders[root]?.edits[aiFile] === undefined) {
      await sleep(50)
    }

    expect(typeof store.get().folders[root]?.edits[aiFile]).toBe('number')
    expect(store.get().folders[root]?.edits[suppressedFile]).toBeUndefined()
    store.removeWindow('w1')
  })
})

describe('external git pull / reset / rebase / commit filtering (real git repos, YAZ-6501)', () => {
  it('never suppresses after local commit, suppresses active index.lock, and filters git reset --hard @{u} & git pull while keeping unrelated AI edits', async () => {
    const bin = await resolveGit()
    if (bin === null) return

    const bare = await makeTempDir('yd-git-bare-')
    const repoA = await makeTempDir('yd-git-a-')
    const repoB = await makeTempDir('yd-git-b-')

    await runGit(bin, bare, ['init', '--bare', '-b', 'main'])
    await initGitRepo(bin, repoA)
    await runGit(bin, repoA, ['remote', 'add', 'origin', bare])
    await writeFile(path.join(repoA, 'Shared.md'), 'v1\n')
    await writeFile(path.join(repoA, 'LocalAI.md'), 'ai v1\n')
    await runGit(bin, repoA, ['add', '-A'])
    await runGit(bin, repoA, ['commit', '-m', 'init'])
    await runGit(bin, repoA, ['push', '-u', 'origin', 'main'])

    // Clone to repoB and make a remote change + brand-new file
    await runGit(bin, repoB, ['clone', bare, '.'])
    await runGit(bin, repoB, ['config', 'user.name', 'Other Mac'])
    await runGit(bin, repoB, ['config', 'user.email', 'other@example.com'])
    await writeFile(path.join(repoB, 'Shared.md'), 'v2 from remote\n')
    await writeFile(path.join(repoB, 'RemoteNew.md'), 'new from remote\n')
    await runGit(bin, repoB, ['add', '-A'])
    await runGit(bin, repoB, ['commit', '-m', 'remote edit'])
    await runGit(bin, repoB, ['push', 'origin', 'main'])

    const { store } = await makeTestStore(repoA)

    // 1. Local `commit: sync (...)` NEVER suppresses AI edits
    const aiPath = path.join(repoA, 'LocalAI.md')
    await writeFile(aiPath, 'ai v2\n')
    await runGit(bin, repoA, ['add', 'LocalAI.md'])
    await runGit(bin, repoA, ['commit', '-m', 'sync (LocalAI.md)'])
    const aiStat = await stat(aiPath)
    expect(await isExternalGitMutation(repoA, aiPath, aiStat.mtimeMs, Date.now())).toBe(false)
    expect(await handleExternalWatchEvent(store, repoA, { type: 'change', path: aiPath, mtime: aiStat.mtimeMs })).toBe(true)
    expect(store.get().folders[repoA].edits[aiPath]).toBeDefined()

    // 2. Active `.git/index.lock` suppresses watcher events
    const lockPath = path.join(repoA, '.git', 'index.lock')
    await writeFile(lockPath, '')
    expect(await isExternalGitMutation(repoA, path.join(repoA, 'Other.md'), Date.now(), Date.now())).toBe(true)
    await rm(lockPath)

    // 3. External `git reset --hard @{u}` (GitHub AutoSync pattern): suppresses reset-touched files, NOT unrelated AI file
    await runGit(bin, repoA, ['fetch', 'origin'])
    await runGit(bin, repoA, ['reset', '--hard', '@{u}'])
    const sharedPath = path.join(repoA, 'Shared.md')
    const remoteNewPath = path.join(repoA, 'RemoteNew.md')
    const sharedStat = await stat(sharedPath)
    const remoteNewStat = await stat(remoteNewPath)
    expect(await handleExternalWatchEvent(store, repoA, { type: 'change', path: sharedPath, mtime: sharedStat.mtimeMs })).toBe(false)
    expect(await handleExternalWatchEvent(store, repoA, { type: 'add', path: remoteNewPath, mtime: remoteNewStat.mtimeMs })).toBe(false)
    expect(store.get().folders[repoA].edits[sharedPath]).toBeUndefined()
    expect(store.get().folders[repoA].edits[remoteNewPath]).toBeUndefined()

    // Unrelated AI file created right after reset IS logged
    const unrelatedPath = path.join(repoA, 'UnrelatedAI.md')
    await writeFile(unrelatedPath, 'fresh AI note\n')
    const unrelatedStat = await stat(unrelatedPath)
    expect(await handleExternalWatchEvent(store, repoA, { type: 'add', path: unrelatedPath, mtime: unrelatedStat.mtimeMs })).toBe(true)
    expect(store.get().folders[repoA].edits[unrelatedPath]).toBeDefined()

    // 4. External `git pull` (fast-forward) suppresses pulled file
    await writeFile(path.join(repoB, 'Pulled.md'), 'pulled v1\n')
    await runGit(bin, repoB, ['add', 'Pulled.md'])
    await runGit(bin, repoB, ['commit', '-m', 'remote pulled'])
    await runGit(bin, repoB, ['push', 'origin', 'main'])
    await runGit(bin, repoA, ['pull', '--ff-only'])
    const pulledPath = path.join(repoA, 'Pulled.md')
    const pulledStat = await stat(pulledPath)
    expect(await handleExternalWatchEvent(store, repoA, { type: 'add', path: pulledPath, mtime: pulledStat.mtimeMs })).toBe(false)
    expect(store.get().folders[repoA].edits[pulledPath]).toBeUndefined()

    // 5. Fallback when git binary is unavailable suppresses within 3s window (reset diff cache first)
    _resetExternalEditsForTest()
    expect(await isExternalGitMutation(repoA, unrelatedPath, pulledStat.mtimeMs, Date.now(), { gitCandidates: [] })).toBe(true)
    expect(await isExternalGitMutation(repoA, unrelatedPath, pulledStat.mtimeMs - 20_000, Date.now() + 20_000, { gitCandidates: [] })).toBe(false)
  })

  it('filters external git rebase (pairing rebase start/finish) and suppresses built-in syncPass rebase', async () => {
    const bin = await resolveGit()
    if (bin === null) return

    const bare = await makeTempDir('yd-rebase-bare-')
    const repoA = await makeTempDir('yd-rebase-a-')
    const repoB = await makeTempDir('yd-rebase-b-')

    await runGit(bin, bare, ['init', '--bare', '-b', 'main'])
    await initGitRepo(bin, repoA)
    await runGit(bin, repoA, ['remote', 'add', 'origin', bare])
    await writeFile(path.join(repoA, 'Base.md'), 'base\n')
    await runGit(bin, repoA, ['add', '-A'])
    await runGit(bin, repoA, ['commit', '-m', 'init'])
    await runGit(bin, repoA, ['push', '-u', 'origin', 'main'])

    await runGit(bin, repoB, ['clone', bare, '.'])
    await runGit(bin, repoB, ['config', 'user.name', 'Other Mac'])
    await runGit(bin, repoB, ['config', 'user.email', 'other@example.com'])
    await writeFile(path.join(repoB, 'RemoteRebase.md'), 'from B\n')
    await runGit(bin, repoB, ['add', '-A'])
    await runGit(bin, repoB, ['commit', '-m', 'remote commit'])
    await runGit(bin, repoB, ['push', 'origin', 'main'])

    // Diverge repoA locally then rebase onto origin/main
    await writeFile(path.join(repoA, 'LocalDiv.md'), 'from A\n')
    await runGit(bin, repoA, ['add', '-A'])
    await runGit(bin, repoA, ['commit', '-m', 'local commit'])
    await runGit(bin, repoA, ['fetch', 'origin'])
    await runGit(bin, repoA, ['rebase', 'origin/main'])

    const remoteRebasePath = path.join(repoA, 'RemoteRebase.md')
    const st = await stat(remoteRebasePath)
    expect(await isExternalGitMutation(repoA, remoteRebasePath, st.mtimeMs, Date.now())).toBe(true)

    // Built-in syncPass rebase leaves root suppressed for the 2s settle tail
    await writeFile(path.join(repoB, 'SyncPulled.md'), 'from B 2\n')
    await runGit(bin, repoB, ['add', '-A'])
    await runGit(bin, repoB, ['commit', '-m', 'remote commit 2'])
    await runGit(bin, repoB, ['push', 'origin', 'main'])
    const status = await syncPass(repoA)
    expect(status.state).toBe('synced')
    expect(isSuppressedExternalEdit(repoA, path.join(repoA, 'SyncPulled.md'))).toBe(true)
  })
})

describe('handleColdStartDiff (YAZ-6501)', () => {
  it('logs changed and newly added files at real disk mtime in one commit, skips renames, dot-files, non-hit, older mtimes, and >50 bulk bursts', async () => {
    const root = await makeTempDir('yd-cold-')
    const { store, commits } = await makeTestStore(root)

    const changedFile = path.join(root, 'EditedWhileClosed.md')
    const addedFile = path.join(root, 'CreatedWhileClosed.md')
    const renamedNew = path.join(root, 'RenamedAfter.md')
    const existingNewer = path.join(root, 'AlreadyNewer.md')
    const dotFile = path.join(root, '.folder.md')

    await writeFile(changedFile, '# edited\n')
    await writeFile(addedFile, '# added\n')
    await writeFile(renamedNew, '# renamed\n')
    await writeFile(existingNewer, '# newer\n')
    await writeFile(dotFile, '---\nid: YAZ-1\n---\n')

    const mChanged = T - 120_000
    const mAdded = T - 90_000
    const mRenamed = T - 300_000
    const mOlder = T - 200_000
    await utimes(changedFile, mChanged / 1000, mChanged / 1000)
    await utimes(addedFile, mAdded / 1000, mAdded / 1000)
    await utimes(renamedNew, mRenamed / 1000, mRenamed / 1000)
    await utimes(existingNewer, mOlder / 1000, mOlder / 1000)

    const renamedStat = await stat(renamedNew)
    const addedStat = await stat(addedFile)

    // Existing entry with a NEWER timestamp must never be downgraded
    store.addEdit([root], existingNewer, T - 10_000)
    commits.length = 0

    // Non-hit status is ignored
    expect(
      await handleColdStartDiff(store, {
        root,
        scannedAt: T,
        cacheStatus: 'miss',
        added: [{ path: addedFile, size: addedStat.size, mtime: addedStat.mtimeMs }],
        removed: [],
        changed: [changedFile],
      }),
    ).toBe(0)
    expect(commits).toHaveLength(0)

    // Hit logs changed + non-rename added in ONE commit, skipping rename, dot-file, and non-openable
    const count = await handleColdStartDiff(
      store,
      {
        root,
        scannedAt: T,
        cacheStatus: 'hit',
        added: [
          { path: addedFile, size: addedStat.size, mtime: addedStat.mtimeMs },
          { path: renamedNew, size: renamedStat.size, mtime: renamedStat.mtimeMs },
          { path: path.join(root, 'junk.tmp'), size: 5, mtime: mAdded },
        ],
        removed: [{ path: path.join(root, 'RenamedBefore.md'), size: renamedStat.size, mtime: renamedStat.mtimeMs }],
        changed: [changedFile, existingNewer, dotFile],
      },
      { now: T },
    )
    expect(count).toBe(3)
    expect(commits).toHaveLength(1)
    expect(store.get().folders[root].edits[changedFile]).toBeCloseTo(mChanged, -1)
    expect(store.get().folders[root].edits[addedFile]).toBeCloseTo(mAdded, -1)
    expect(store.get().folders[root].edits[renamedNew]).toBeUndefined()
    expect(store.get().folders[root].edits[dotFile]).toBeUndefined()
    expect(store.get().folders[root].edits[existingNewer]).toBe(T - 10_000)

    // Re-running with the same diff commits nothing (idempotent)
    await handleColdStartDiff(
      store,
      {
        root,
        scannedAt: T,
        cacheStatus: 'hit',
        added: [{ path: addedFile, size: addedStat.size, mtime: addedStat.mtimeMs }],
        removed: [],
        changed: [changedFile],
      },
      { now: T },
    )
    expect(commits).toHaveLength(1)

    // Bulk burst > 50 files is skipped to protect Recents
    const bulkAdded = Array.from({ length: COLD_START_MAX_FILES + 1 }, (_, i) => ({
      path: path.join(root, `Bulk-${i}.md`),
      size: 10,
      mtime: T - 5_000,
    }))
    expect(
      await handleColdStartDiff(
        store,
        { root, scannedAt: T, cacheStatus: 'hit', added: bulkAdded, removed: [], changed: [] },
        { now: T },
      ),
    ).toBe(0)
    expect(commits).toHaveLength(1)
  })

  it('excludes cold-start files pulled by git while keeping AI-edited files, and fires via vaultIndex onColdStartDiff', async () => {
    const bin = await resolveGit()
    if (bin === null) return

    const bare = await makeTempDir('yd-cold-bare-')
    const repoA = await makeTempDir('yd-cold-a-')
    const repoB = await makeTempDir('yd-cold-b-')
    const cacheDir = await makeTempDir('yd-cold-cache-')
    initIndexCache(cacheDir)

    await runGit(bin, bare, ['init', '--bare', '-b', 'main'])
    await initGitRepo(bin, repoA)
    await runGit(bin, repoA, ['remote', 'add', 'origin', bare])
    await writeFile(path.join(repoA, 'PulledWhileClosed.md'), 'v1\n')
    await writeFile(path.join(repoA, 'AiWhileClosed.md'), 'v1\n')
    await runGit(bin, repoA, ['add', '-A'])
    await runGit(bin, repoA, ['commit', '-m', 'init'])
    await runGit(bin, repoA, ['push', '-u', 'origin', 'main'])

    // Build initial index cache (app open before closing)
    await getIndex(repoA)
    await flushIndexCache()
    _evictAll()

    // While closed: remote commits PulledWhileClosed.md, repoA pulls it, and AI edits AiWhileClosed.md
    await runGit(bin, repoB, ['clone', bare, '.'])
    await runGit(bin, repoB, ['config', 'user.name', 'Other Mac'])
    await runGit(bin, repoB, ['config', 'user.email', 'other@example.com'])
    await writeFile(path.join(repoB, 'PulledWhileClosed.md'), 'v2 from remote\n')
    await runGit(bin, repoB, ['add', '-A'])
    await runGit(bin, repoB, ['commit', '-m', 'remote update'])
    await runGit(bin, repoB, ['push', 'origin', 'main'])

    await runGit(bin, repoA, ['pull', '--ff-only'])
    await writeFile(path.join(repoA, 'AiWhileClosed.md'), 'v2 from AI agent\n')

    const { store } = await makeTestStore(repoA)
    let coldDone: Promise<number> | undefined
    onColdStartDiff((diff) => {
      coldDone = handleColdStartDiff(store, diff)
    })

    // Cold-start getIndex reconciles against persisted cache and invokes onColdStartDiff
    await getIndex(repoA)
    expect(coldDone).toBeDefined()
    expect(await coldDone).toBe(1)

    expect(store.get().folders[repoA].edits[path.join(repoA, 'AiWhileClosed.md')]).toBeDefined()
    expect(store.get().folders[repoA].edits[path.join(repoA, 'PulledWhileClosed.md')]).toBeUndefined()
  })

  it('YAZ-6510: skips cold-start diffs for non-open vaults (e.g. internal cardSkillVault) and avoids nested-vault duplication', async () => {
    const parent = await makeTempDir('yd-cold-parent-')
    const nested = path.join(parent, 'nested')
    const internal = await makeTempDir('yd-cold-internal-')
    await mkdir(nested, { recursive: true })
    const parentNote = path.join(parent, 'Parent.md')
    const nestedNote = path.join(nested, 'Nested.md')
    const internalNote = path.join(internal, 'Skill.md')
    await writeFile(parentNote, 'p\n')
    await writeFile(nestedNote, 'n\n')
    await writeFile(internalNote, 'i\n')
    const { store } = await makeTestStore(parent)
    const now = Date.now()
    // Open both parent and nested vaults in the window; internal is NOT an open vault.
    store.upsertWindow({
      id: 'w1',
      root: parent,
      roots: [parent, nested],
      file: null,
      tabs: [],
      sidebarCollapsed: false,
      sidebarLens: 'files',
      bounds: { x: 0, y: 0, width: 1000, height: 700 },
    })

    // Non-open internal vault diff is ignored completely.
    expect(await handleColdStartDiff(store, { root: internal, scannedAt: now, cacheStatus: 'hit', added: [{ path: internalNote, size: 2, mtime: now }], removed: [], changed: [] }, { now })).toBe(0)
    expect(store.get().folders[internal]).toBeUndefined()

    // Parent vault diff ignores files owned by the more specific open nested vault.
    expect(
      await handleColdStartDiff(
        store,
        {
          root: parent,
          scannedAt: now,
          cacheStatus: 'hit',
          added: [
            { path: parentNote, size: 2, mtime: now },
            { path: nestedNote, size: 2, mtime: now },
          ],
          removed: [],
          changed: [],
        },
        { now },
      ),
    ).toBe(1)
    expect(store.get().folders[parent]?.edits[parentNote]).toBe(now)
    expect(store.get().folders[parent]?.edits[nestedNote]).toBeUndefined()
  })
})
