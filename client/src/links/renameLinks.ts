/**
 * Automatic link updates after an in-app rename (Links E1 GRO-2194 + E1b GRO-2241 —
 * decision E, GRO-2096: Obsidian's default, no prompt). Runs CLIENT-SIDE in the ORIGINATING
 * window, AFTER the rename succeeded, over PRE-rename snapshots (post-rename, the old name
 * no longer resolves, so the referencing set must be computed against the index/tree as
 * they were).
 *
 * Referencing set: records whose `links` or `embeds` resolve to the moved path, through THE
 * shared resolver (`resolverFor`, the one behind views and wikilink decorations). For a
 * FOLDER (`kind: 'dir'`) the
 * moved set is everything under the old prefix. Per file: `fs:read` → rewrite → `fs:write`
 * with `expectedMtime`; a CONFLICT re-reads once and retries, a second conflict skips the
 * file (someone is actively writing it — their unsaved changes win over our link fix; the
 * link shows as unresolved until fixed by hand).
 *
 * Body rewriting (`@shared/linkRewrite`, YAZ-2677) is a string-level scan with the shared regex semantics: only matches whose
 * `linkPageName` resolves to the old path are touched; fenced code blocks and inline code
 * spans are skipped via a LENGTH-PRESERVING mirror of the index's `stripCode` discipline
 * (`maskCode` — same fence/span rules, offsets intact so the splice edits the original
 * bytes). `|alias` and `#heading`/`#^block` suffixes are preserved; the link FORM is too:
 * a bare `[[B]]` becomes the new bare name, a pathed `[[Sub/B]]` the new root-relative path,
 * and an explicit `.md` extension stays explicit. `![[embeds]]` get the same treatment.
 * Frontmatter follows the index's link extraction: whole-value exact `[[…]]` strings only
 * (top-level and inside lists), rewritten through `setFrontmatterProperty` so everything
 * else in the block survives byte-for-byte. A folder's values (`in`, D19) hold the same links by
 * the same rule, each rewritten where it stands (`setFrontmatterIn`).
 *
 * ONE key is walked deeper than that (YAZ-864): `folder_settings`, the single reserved key
 * with app-defined link semantics (Q1, YAZ-815). Its `views[].order` entries and
 * `columns.<name>.target` strings ARE links the index never extracted; they rewrite exactly as a
 * top-level entry does, through the same `resolves` / `newTarget` pair, so their spelling rules
 * cannot drift from anyone else's.
 * The key's own module owns both the key name and the list of link-bearing leaves
 * (`views/folderSettings.ts` `mapFolderSettingsLinks`) — this engine never re-parses it.
 * The referencing-set probe learned the same leaves, because a page whose ONLY reference lives
 * in there has no `links` entry to be found by: one construction, never two truths.
 *
 * E1b's bare-vs-pathed rules, LOCKED (decision E thread):
 *  - FOLDER rename: bare-name links keep resolving (names unchanged) — they stay
 *    BYTE-IDENTICAL; only PATHED targets rewrite, to the new root-relative path.
 *  - Links to the FOLDER ITSELF (YAZ-2290 D10 — a folder is a page, `links/folderLinks.ts`) follow
 *    the FILE rule: bare `[[Projects]]` becomes the new name, a pathed one the new path, and a
 *    bare one stays untouched while the name still reaches the folder (a move). A folder's own
 *    settings file (`folders`) is a referencing file like any note.
 *  - FILE move (and rename): a bare link stays bare only when the bare form still resolves
 *    to the moved file AFTERWARDS — decided through the resolver against a POST-move record
 *    set (the shallowest rule may hand the name to a duplicate); otherwise it escalates to
 *    the pathed form. A kept bare form is never spliced, so padding survives too.
 *  - ALIAS-form links (E2, GRO-2214): `[[CAC]]` pointing at a note through its frontmatter
 *    `aliases` is NEVER rewritten — the alias travels with the file, so it still resolves
 *    afterwards. The referencing-set probe therefore resolves BY NAME ONLY (`makeResolves`).
 *  - ID-form links (YAZ-2293 D5): `[[k3m9x2pq7abc]]` is NEVER rewritten either, for the same
 *    reason — the id travels in the file's own frontmatter.
 *  - TITLE-form links (YAZ-2420 D17): `[[UP-001 - Abdul]]` to the note whose `title:` that is, or
 *    to the folder whose `.folder.md` holds it — the same again. A page with no `title:` is
 *    linked by its name, and that is rewritten.
 *  - A TITLE EDIT (YAZ-2420 D16, `title`) is the one rename a title does not travel through: a
 *    link that spelled the old title is rewritten to the new one, and counted — to the page's id
 *    (YAZ-2478) when a link cannot spell the new title or another page answers to it. Links by
 *    name or by path follow the new file as in any rename; id links stay as written.
 *  - A PATH OF TITLES (YAZ-2478): `[[Candidates/Abdul]]`, the note titled Abdul in the folder
 *    titled Candidates, is rewritten to the note's id, since either title may be the one that changed.
 */
import { isViewOnly } from '@shared/fileKind'
import { folderSettingsLinks } from '@shared/folderSettingsLinks'
import { exactLinkTarget, maskCode, rewriteBodyLinks, rewriteInner, rewriteNoteLinks, type NewTarget, type ResolvesToOld } from '@shared/linkRewrite'
import { titleOf } from '@shared/noteName'
import type { IndexRecord } from '@shared/types'
import { api, BridgeRequestError } from '../api'
import { resolverFor, targetBasename, targetKey } from '../views/engine'
import { flushRenamedPath } from '../lib/renameContinuity'
import { basename, dirname, relTo, stripExt } from '../lib/paths'
import { folderResolver, linkResolver } from './folderLinks'
import { folderRecord, foldersByDir } from './shortcuts'
import { buildViewOnlyCatalogFromEntries, type ViewOnlyCatalog } from './viewOnlyCatalog'

// The rewrite of ONE file's text is in `@shared/linkRewrite` (YAZ-2677): the main process changes
// an ID to a new ID with the same parser. What a rename MOVED is decided here and handed to it.
export { maskCode, rewriteBodyLinks, rewriteInner, rewriteNoteLinks, type NewTarget, type ResolvesToOld }

/**
 * Form preservation for one matched target: bare stays bare (the new basename), pathed
 * stays pathed (the new ROOT-RELATIVE path), and an explicit vault extension stays explicit.
 * `newName` is the new file name WITH extension; `newRel` the new root-relative path WITH it.
 */
export function renamedTarget(target: string, opts: { newName: string; newRel: string }): string {
  const withExt = target.includes('/') ? opts.newRel : opts.newName
  return /\.(md|markdown)$/i.test(target) ? withExt : stripExt(withExt)
}

/** Every target a note links to: index links and embeds, then the nested settings leaves (lazily). */
export function* referenceTargets(record: IndexRecord): Generator<string> {
  yield* record.links
  yield* record.embeds
  for (const link of folderSettingsLinks(record.properties)) {
    const target = exactLinkTarget(link)
    if (target !== null) yield target
  }
}

/** Does this note reference the renamed file AT ALL — index links/embeds, or a nested settings leaf? */
function makeReferences(resolves: ResolvesToOld): (record: IndexRecord) => boolean {
  return (record) => {
    for (const target of referenceTargets(record)) if (resolves(target)) return true
    return false
  }
}

/**
 * The basenames (`basenameKey`) any note's links spell (YAZ-2241). `countLinkReferences` is 0 for a
 * file whose basename is not in the set (`targetBasename`), so a caller counting many renames can skip
 * those without building a resolver for each: 230 renames in one snapshot were one 0.4 s task.
 * (A path of titles, YAZ-2478, spells no basename: a caller that skips by this set does not count it.)
 */
export function linkedBasenames(records: readonly IndexRecord[]): Set<string> {
  const named = new Set<string>()
  for (const record of records) for (const target of referenceTargets(record)) named.add(targetBasename(target))
  return named
}

export interface RenameRewriteSummary {
  /** Files whose links were rewritten on disk. */
  updated: number
  /** Files left alone after a repeated write conflict (or an unreadable/unwritable file). */
  skipped: number
}

/** The ONE passive summary notice — shown only when the rename touched (or spared) anything. */
export function renameNotice({ updated, skipped }: RenameRewriteSummary): string {
  const head = `Updated links in ${updated} note${updated === 1 ? '' : 's'}`
  return skipped > 0 ? `${head}; ${skipped} skipped (unsaved changes)` : head
}

export interface UpdateLinksOptions {
  /** Does this vault use IDs? Where it does not (YAZ-2523 🔒 V12) a `title:` line is an ordinary property: every title here is the file's name, and no link travels by one. */
  ids: boolean
  root: string
  oldPath: string
  newPath: string
  /** `dir` for a folder rename/move (E1b, GRO-2241): everything under `oldPath/` moved. Defaults to `file`. */
  kind?: 'file' | 'dir'
  /** The PRE-rename index snapshot (fetched before `fs:rename` — see the module doc). */
  records: readonly IndexRecord[]
  /** The same snapshot's folder settings records (YAZ-2290 D8): rewritten like notes, never resolved to. */
  folders?: readonly IndexRecord[]
  /** The PRE-rename folders (`vaultDirs`): what a link to a folder resolves over (YAZ-2290 D10). */
  dirs?: readonly string[]
  /** Separate PRE-rename text/PDF catalog; these targets never enter `records`. */
  viewOnlyCatalog?: ViewOnlyCatalog | null
  /** The new title, when the rename is a title edit of `oldPath` (YAZ-2420 🔒 D16): a link that spelled the old one follows it. */
  title?: string
}

/**
 * The referencing-set predicate shared by the rewrite and the E1c dry-run count — ONE
 * construction, so both agree on WHICH notes reference the old path.
 *
 * They do NOT always agree on how many get WRITTEN, and the F- audit (GRO-2197) pinned the gap
 * honestly rather than papering over it: `countLinkReferences` counts every note whose links
 * RESOLVE to the old path, while `rewriteInner` writes nothing for a bare link that stays bare
 * (it returns null). In a pure MOVE — which `renameDetector.ts` deliberately admits as a valid
 * hypothesis — every bare link stays bare, so the banner can offer "update N links?" and the
 * summary then read "Updated links in 0 notes". Closing that needs N to become form-aware
 * (share `newTarget`, not just `resolves`), which is a behaviour change, not a finishing-pass
 * fix — deferred with the rest of the E1c queue work.
 */
function makeResolves({ ids, root, oldPath, kind, records, folders = [], dirs = [], viewOnlyCatalog, title }: Pick<UpdateLinksOptions, 'ids' | 'root' | 'oldPath' | 'records' | 'folders' | 'dirs' | 'viewOnlyCatalog' | 'title'> & { kind: 'file' | 'dir' }): {
  resolves: ResolvesToOld
  resolveTargetPath: (t: string) => string | null
  spellsTitle: (t: string) => boolean
  typedId: (t: string) => string | undefined
} {
  // NAME-ONLY resolution (E2, GRO-2214): an alias-form link (`[[CAC]]`) does resolve to the
  // moved file through the shared resolver, but it must stay BYTE-IDENTICAL — the alias lives
  // in that file's own frontmatter and travels with it, so it keeps pointing there. Building
  // the probe without the alias map keeps the dry-run count and the rewrite agreeing on that.
  // An ID-form link (`[[k3m9x2pq7abc]]`, YAZ-2293) is the same story told by the id: it names
  // the note, not its place, so it too must stay byte-identical — the probe resolves no ids.
  const resolver = resolverFor(records, root, { aliases: false, ids: false, folders })
  // A path of titles (YAZ-2478) is the target only the folders answer; it is rewritten to the note's id.
  const typedId = (t: string) => (resolverFor(records, root, { aliases: false, ids: false })(t) === null ? resolver(t)?.record.id : undefined)
  const settings = foldersByDir(folders)
  const spells = (t: string, page: IndexRecord | undefined): page is IndexRecord => page !== undefined && targetKey(t) === page.title.toLowerCase()
  // A link that spells a page's `title:` (YAZ-2420 🔒 D17) is the third of that kind: the title is in
  // the note's own frontmatter, or the folder's `.folder.md`, so the link still reaches it afterwards.
  // A page with no `title:` is titled by its name, and a link spelling that is a name link, rewritten
  // as ever. The one title that does not travel is the one a title edit replaces (`title`, 🔒 D16).
  const travels = (t: string, page: IndexRecord | undefined, path: string): boolean =>
    ids && spells(t, page) && titleOf(page.properties, '') !== '' && !(title !== undefined && path === oldPath)
  const named = (t: string): string | undefined => {
    const hit = resolver(t)?.record
    return hit === undefined || travels(t, hit, hit.path) ? undefined : hit.path
  }
  // A FOLDER holds a name only when no note, path or ALIAS does (YAZ-2290 D10) — asked of the
  // full resolver, so a link an alias answers is never read as the folder's. It is found as every
  // link finds it, by its title too (`folderResolver`), but for its id: no folder ids either.
  const anyNote = resolverFor(records, root)
  const folder = folderResolver(root, dirs, folders, { ids: false })
  const prefix = `${oldPath}/`
  const isMoved = kind === 'dir' ? (p: string) => p === oldPath || p.startsWith(prefix) : (p: string) => p === oldPath
  const targetPaths = new Map<string, string | null>()
  const resolveTargetPath = (t: string): string | null => {
    const hit = targetPaths.get(t)
    if (hit !== undefined) return hit
    const dir = (): string | null => {
      const found = anyNote(t) === null ? folder(t) : null
      return found !== null && travels(t, settings.get(found), found) ? null : found
    }
    // An explicit recognized non-Markdown extension belongs exclusively to the lightweight
    // catalog. It must never acquire a semantic record/resolver fallback on a miss.
    const resolved = isViewOnly(t) ? viewOnlyCatalog?.resolve(t) ?? null : named(t) ?? dir()
    targetPaths.set(t, resolved)
    return resolved
  }
  const resolves: ResolvesToOld = (target) => {
    const hit = resolveTargetPath(target)
    // LOCKED (E1b): across a FOLDER rename, bare-name links keep resolving (names are
    // unchanged) and stay byte-identical — only PATHED targets rewrite in dir mode. The one
    // bare link that names what changed is a link to the folder ITSELF (YAZ-2290 D10).
    if (kind === 'dir' && !target.includes('/')) return hit === oldPath
    return hit !== null && isMoved(hit)
  }
  // Asked of a target that resolved to `oldPath`: the page it reached is the renamed one.
  return { resolves, resolveTargetPath, spellsTitle: (t) => spells(t, kind === 'dir' ? settings.get(oldPath) : resolver(t)?.record), typedId }
}

/**
 * DRY-RUN (E1c, GRO-2242): how many notes the rewrite WOULD touch — the exact referencing-set
 * filter `updateLinksAfterRename` runs (records whose `links`/`embeds` resolve to the moved
 * path through the same shared-resolver `resolves`), with no reads and no writes. This is the
 * banner's N; N === 0 → no banner, nothing happens at all (the locked ruling). For an external
 * rename pass a PRE-rename snapshot (`preRenameRecords` synthesises one).
 */
export function countLinkReferences({ ids, root, oldPath, kind = 'file', records, folders = [], dirs, viewOnlyCatalog, title }: Omit<UpdateLinksOptions, 'newPath'>): number {
  const { resolves } = makeResolves({ ids, root, oldPath, kind, records, folders, dirs, viewOnlyCatalog, title })
  return [...records, ...folders].filter(makeReferences(resolves)).length
}

/** Rewrite every referencing note on disk; see the module doc for the whole discipline. */
export async function updateLinksAfterRename({ ids, root, oldPath, newPath, kind = 'file', records, folders = [], dirs = [], viewOnlyCatalog, title }: UpdateLinksOptions): Promise<RenameRewriteSummary> {
  const prefix = `${oldPath}/`
  const mapMoved = kind === 'dir' ? (p: string) => (p === oldPath || p.startsWith(prefix) ? newPath + p.slice(oldPath.length) : p) : (p: string) => (p === oldPath ? newPath : p)
  const { resolves, resolveTargetPath, spellsTitle, typedId } = makeResolves({ ids, root, oldPath, kind, records, folders, dirs, viewOnlyCatalog, title })
  // File mode: whether a bare form still wins AFTER the move is decided by RESOLUTION, not
  // text — the post-move record set (the moved record re-pathed) answers it (shallowest rule).
  const newName = basename(newPath)
  const newRel = relTo(root, newPath)
  const postRecords =
    kind === 'file'
      ? records.map((r) =>
          r.path === oldPath
            ? { ...r, path: newPath, name: newName, basename: stripExt(newName), title: title ?? titleOf(ids ? r.properties : {}, stripExt(newName)), folder: newRel.includes('/') ? newRel.slice(0, newRel.lastIndexOf('/')) : '' }
            : r,
        )
      : records
  const postResolver = resolverFor(postRecords, root)
  // The folders the same way: is a path a folder, and who holds a bare name or a title once they have moved.
  const folderPaths = new Set(dirs)
  const postFolders =
    kind === 'dir'
      ? folders.map((f) => {
          const path = mapMoved(f.path)
          const own = dirname(f.path) === oldPath
          return path === f.path && !own ? f : { ...f, path, folder: relTo(root, dirname(path)), title: own ? title ?? titleOf(ids ? f.properties : {}, newName) : f.title }
        })
      : folders
  const postLink = linkResolver(postRecords, root, dirs.map(mapMoved), postFolders)
  const postViewOnlyCatalog = viewOnlyCatalog === null || viewOnlyCatalog === undefined
    ? null
    : buildViewOnlyCatalogFromEntries(root, viewOnlyCatalog.entries.map((entry) => {
        const path = mapMoved(entry.path)
        return path === entry.path ? entry : { ...entry, path, name: basename(path) }
      }))
  const id = (kind === 'dir' ? folderRecord(folders, oldPath) : records.find((r) => r.path === oldPath))?.id
  const newTarget: NewTarget = (target) => {
    const hit = resolveTargetPath(target) as string // non-null: `resolves` vetted this target
    const moved = mapMoved(hit)
    // A title edit (YAZ-2420 🔒 D16): a link that spelled the old title spells the new one, when
    // a link can spell it and it reaches the page; else the link goes by the page's id (YAZ-2478),
    // and by name, as below, only when it has none.
    if (title !== undefined && hit === oldPath && spellsTitle(target)) {
      if (exactLinkTarget(`[[${title}]]`) === title && postLink(title) === moved) return title
      if (id !== undefined) return id
    }
    const movedName = basename(moved)
    const movedRel = relTo(root, moved)
    // A folder (YAZ-2290 D10) has no extension to keep: pathed stays pathed, and bare stays bare
    // only while the name still reaches it — else it escalates to the path, as a file's does.
    if (folderPaths.has(hit)) return !target.includes('/') && postLink(movedName) === moved ? movedName : movedRel
    if (isViewOnly(target)) {
      // Keep the old form discipline: pathed remains pathed; bare remains bare only while the
      // post-move catalog still awards that basename to this file, otherwise disambiguate.
      if (target.includes('/')) return movedRel
      return postViewOnlyCatalog?.resolve(movedName) === moved ? movedName : movedRel
    }
    const typed = typedId(target)
    if (typed !== undefined) return typed
    if (!target.includes('/')) {
      // Bare form (file mode only — dir mode filtered bare targets out above): keep it only
      // when the bare name still resolves to the moved file post-move; otherwise escalate
      // to the pathed form.
      const stillBare = postResolver(stripExt(movedName))?.record.path === moved
      if (!stillBare) return /\.(md|markdown)$/i.test(target) ? movedRel : stripExt(movedRel)
    }
    return renamedTarget(target, { newName: movedName, newRel: movedRel })
  }
  const references = makeReferences(resolves)
  const summary: RenameRewriteSummary = { updated: 0, skipped: 0 }
  for (const record of [...records, ...folders]) {
    if (!references(record)) continue
    // A self-link travels with the file: a moved note is read/written at its NEW path
    // (for a dir, every record under the old prefix relocated).
    const filePath = mapMoved(record.path)
    try {
      // An own-window dirty editor of the referencing note flushes FIRST, so the read below
      // sees its buffer and our write does not race it (the editor then auto-reloads clean).
      await flushRenamedPath(filePath)
      let file = await api.readFile(filePath)
      for (let attempt = 0; ; attempt++) {
        const next = rewriteNoteLinks(file.content, resolves, newTarget)
        if (next === null) break
        try {
          await api.writeFile({ path: filePath, content: next, expectedMtime: file.mtime })
          summary.updated++
          break
        } catch (err) {
          if (!(err instanceof BridgeRequestError) || err.code !== 'CONFLICT' || attempt > 0) throw err
          file = await api.readFile(filePath) // raced another writer: re-read once, retry
        }
      }
    } catch {
      summary.skipped++
    }
  }
  return summary
}
