import type { FileClipState } from '@shared/types'
import type { MenuTargets } from './Sidebar'

/**
 * The sidebar context menu's items AS DATA (🔒 D8, YAZ-1674). Every gating rule that used to be a
 * conditional in `ContextMenu`'s JSX is one small function here returning an item or null, so the
 * component keeps only mechanics (overlay, clamp, Escape) and the rules test PURE — no DOM.
 *
 * SEVEN groups, in this order (🔒 D7, amended three times): Open/View · Clipboard · Create ·
 * More create · This row · "Open in ▸" · Delete. The component draws a separator between
 * NON-EMPTY groups only, so a blank-space menu (no row to rename or delete) never ends in a
 * stray rule. The last group is where a row LEAVES — a file is deleted, a shortcut removed, a vault
 * removed from the window (YAZ-2602 D7) — one item of it at most, so it always stands alone.
 * Labels are the bare
 * text — a shortcut hint rides on `hint` and is drawn by CSS from `data-hint`, so `textContent`
 * and the accessible name stay what every test pins.
 *
 * NOTE (🔒 D7): grouping moves "Copy N paths" below the Open group, which loosens 🔒 D5 of
 * YAZ-1337 ("the plural pair leads") — "Open N in new tabs" still leads the whole menu, and the
 * plural copy still leads its own group.
 *
 * D7 amended (YAZ-1674): the OS verbs collapse into ONE "Open in ▸" parent whose flyout is itself
 * groups of leaves — the same renderer, the same separator rule, one level deep — and that parent
 * is its OWN group between the this-row group and Delete. The Open group keeps only a folder's
 * Open, the plural open and Focus and is EMPTY on a single file row, so the clipboard group then leads.
 */
interface MenuItemBase {
  id: string
  label: string
  /** Right-aligned shortcut hint (⌘X …), drawn from `data-hint` by CSS — never part of the label. */
  hint?: string
  danger?: boolean
}

/** A leaf: selecting it runs `onSelect`, then the whole menu closes. */
export interface MenuAction extends MenuItemBase {
  onSelect: () => void
  children?: undefined
  /** Rendered but inert — Paste with an empty clipboard, for discoverability (🔒 D5, YAZ-1674). Only a leaf can be. */
  disabled?: boolean
}

/**
 * A parent ("Open in ▸", D7 amended): it has NO `onSelect` — selecting it only opens its flyout.
 * The children are ONE level of leaves in their own groups, so a separator inside the flyout is
 * simply a second non-empty section; the component skips empty ones exactly as it does at the root.
 */
export interface MenuParent extends MenuItemBase {
  onSelect?: undefined
  children: readonly MenuAction[][]
}

export type MenuItem = MenuAction | MenuParent

export type MenuSection = MenuItem[]

/**
 * Sidebar's pinned `MenuTargets` plus the app-wide clipboard's LIVE state — the one field read at
 * render time rather than at open time, so "Paste N items" follows a copy made in another window
 * while this menu stands (🔒 D1, YAZ-1674).
 */
export type MenuSectionTargets = MenuTargets & { clip: FileClipState }

export interface MenuHandlers {
  /** "Open" on a folder row (YAZ-2290 D3): the folder becomes the current tab, as a double click makes it. */
  onOpen: (path: string) => void
  /** One background tab per path (I3's opener, GRO-2235) — the caller owns the loop's semantics. */
  onOpenInNewTabs: (paths: string[]) => void
  onOpenNewWindow: (path: string) => void
  onOpenVsCode: (path: string) => void
  onOpenDefault: (path: string) => void
  onReveal: (path: string) => void
  /** "Focus on folder" / "Focus on N folders" (YAZ-1605) — the caller spells the label: it knows the count. */
  focusLabel: string
  onFocus: (paths: string[]) => void
  /** Cut / Copy (YAZ-1674): the paths go to main's ONE app-wide clipboard (🔒 D1); the caller reports. */
  onCut: (paths: string[]) => void
  onCopy: (paths: string[]) => void
  /** Paste into the menu's target dir (🔒 D5, YAZ-1674): offered exactly where "New folder" is. */
  onPaste: () => void
  /**
   * The panel's passive notice (YAZ-1337): a clipboard write that never lands says so, the way
   * `PageContextMenu` reports it — a copy that quietly did nothing is the worst kind of no-op.
   */
  onNotice: (message: string) => void
  onNewNote: () => void
  /** "New dated note" (YAZ-2242): a note born with today's `MM_DD- ` seed. Never hidden, same as `onNewNote`. */
  onNewDatedNote: () => void
  onNewFolder: () => void
  /** "New dated folder" (YAZ-1604): a disk folder born with today's `MM_DD- ` seed. Never hidden, same as `onNewFolder`. */
  onNewDatedFolder: () => void
  /** "Add to favorites" / "Remove N from favorites" (YAZ-1766 D3): the paths and the direction the menu read. */
  onToggleFavorite: (paths: string[], isOn: boolean) => void
  /** "Review this folder" (YAZ-2322): the folder's absolute path; the caller starts the session. */
  onReviewFolder: (dir: string) => void
  /** "Turn review off" / "Turn review on" (YAZ-2322): the note and the state to SET. */
  onSetReview: (path: string, on: boolean) => void
  /** "Add note shortcut" on a folder row (YAZ-2290 D2): the caller opens the picker for that folder. */
  onAddShortcut: (dir: string) => void
  /** "Remove shortcut" on a shortcut row (YAZ-2290 E5): the note, and the folder it stops appearing in. */
  onRemoveShortcut: (path: string, dir: string) => void
  onRename: (path: string) => void
  onDelete: (path: string) => void
  /** "Add vault to this window ▸" (YAZ-2602 D2): a known vault's path; the caller checks it and says why it cannot be added. */
  onAddVault: (path: string) => void
  /** Its "Open folder…" (S3): the system picker, and the picked folder is added. */
  onPickVault: () => void
  /** "Remove from this window" on a vault row (YAZ-2602 D7): the vault's root. */
  onRemoveVault: (root: string) => void
}

type Item = (t: MenuSectionTargets, h: MenuHandlers) => MenuItem | null
/** A leaf-only rule — what a flyout may hold. Every leaf is also an `Item`. */
type Leaf = (t: MenuSectionTargets, h: MenuHandlers) => MenuAction | null

/** Why a clipboard write failed, as the notices spell it — shared with the vault menu (YAZ-1798). */
export const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))
/** "1 item" / "3 items" — the one spelling the menu's labels and the Sidebar's notices share. */
export const countItems = (n: number) => (n === 1 ? '1 item' : `${n} items`)

// ---- (1) Open / View: a folder's Open, the plural open and Focus — read-only, and often empty on one row ----

/**
 * "Open" — a FOLDER row (YAZ-2290 D3): the folder itself is a tab, and a click on its row only
 * folds, so this is the one-click door to it. A file row opens on its click and has no such item.
 */
const open: Leaf = (t, h) => {
  const path = t.openPath
  if (path === null) return null
  return { id: 'open', label: 'Open', onSelect: () => h.onOpen(path) }
}

/**
 * "Open N in new tabs" — every row of a 2+ selection (🔒 D5, YAZ-1337), files and folders alike:
 * the folder itself is a tab (YAZ-2290 D3). It LEADS the menu: when a right-click lands inside a
 * selection, what the user is pointing at is the SELECTION. It leaves the selection standing —
 * acting on it is not the same as ending it.
 */
const openInNewTabs: Leaf = (t, h) => {
  const paths = t.openTabPaths
  if (paths === null) return null
  return { id: 'open-tabs', label: `Open ${paths.length} in new tabs`, onSelect: () => h.onOpenInNewTabs(paths) }
}

/**
 * Focus on folder (YAZ-1605): a read-only VIEW verb, so it closes the Open group — it
 * changes what the tree shows, never what is on disk. An EMPTY list hides it too (the caller's
 * "nothing here can be focused" answer).
 */
const focus: Leaf = (t, h) => {
  const paths = t.focusPaths
  if (paths === null || paths.length === 0) return null
  return { id: 'focus', label: h.focusLabel, onSelect: () => h.onFocus(paths) }
}

// ---- (2) Clipboard: the file clipboard (YAZ-1674), then the text clipboard ----

/**
 * Cut / Copy (🔒 D5, YAZ-1674): ONE rule, two verbs — any ROW, file or dir, both lenses; hidden on
 * blank space (there is nothing to clip). Inside a 2+ selection the target is the ORDERED
 * selection and the label counts it; else the one row and the bare verb.
 */
const clipVerb = (id: string, verb: string, hint: string, pick: (h: MenuHandlers) => (paths: string[]) => void): Leaf => (t, h) => {
  const paths = t.clipPaths
  if (paths === null) return null
  return { id, label: paths.length >= 2 ? `${verb} ${paths.length} items` : verb, hint, onSelect: () => pick(h)(paths) }
}
const cut = clipVerb('cut', 'Cut', '⌘X', (h) => h.onCut)
const copy = clipVerb('copy', 'Copy', '⌘C', (h) => h.onCopy)

/**
 * Paste (🔒 D5, YAZ-1674): offered wherever "New folder" is, and
 * DISABLED — not hidden — while the clipboard is empty, so the verb is discoverable before the
 * first Cut or Copy. With something clipped the label counts it: "Paste 1 item", "Paste 3 items".
 * Withheld on a SHORTCUT row with Cut and Copy (YAZ-2290 E5): the row is not a file in this folder.
 * And where there is no folder to paste into: blank space under two or more vaults (YAZ-2602 S10).
 */
const paste: Leaf = (t, h) => {
  if (t.removeShortcut !== null || t.targetDir === null) return null
  const clip = t.clip
  if (clip === null) return { id: 'paste', label: 'Paste', hint: '⌘V', disabled: true, onSelect: () => undefined }
  return { id: 'paste', label: `Paste ${countItems(clip.count)}`, hint: '⌘V', onSelect: h.onPaste }
}

/**
 * "Copy N paths" — the whole selection, files and folders (YAZ-1578), in the panel's own order
 * (🔒 D5, YAZ-1337; ⚡ YAZ-1338 appends the paths whose rows are hidden), newline-joined. Null
 * hides it, which is every menu opened outside a 2+ selection. Its own target, never `copyPath`
 * in a list: that one falls back to the vault root on blank space. The failure is REPORTED
 * (`PageContextMenu`'s idiom): a clipboard the OS refused is silent otherwise.
 */
const copyPaths: Leaf = (t, h) => {
  const paths = t.copyPaths
  if (paths === null) return null
  return {
    id: 'copy-paths',
    label: `Copy ${paths.length} paths`,
    onSelect: () => {
      void navigator.clipboard.writeText(paths.join('\n')).then(
        () => h.onNotice(`Copied ${paths.length} paths`),
        (error: unknown) => h.onNotice(`Can't copy paths: ${errorText(error)}`),
      )
    },
  }
}

/**
 * "Copy path" — the row, or the vault ROOT for blank space (GRO-2273). Every copy confirms
 * through the one notice (YAZ-1341) — this item long predates it, so it also gained the failure
 * report it never had. The hint is ⌘⇧C, App's chord (🔒 D4, YAZ-1338): selection first, open file after.
 */
const copyPath: Leaf = (t, h) => {
  const path = t.copyPath
  if (path === null) return null
  return {
    id: 'copy-path',
    label: 'Copy path',
    hint: '⌘⇧C',
    onSelect: () => {
      void navigator.clipboard.writeText(path).then(
        () => h.onNotice('Copied path'),
        (error: unknown) => h.onNotice(`Can't copy path: ${errorText(error)}`),
      )
    },
  }
}

// ---- (3) Create and (3b) More create: births BESIDE the right-clicked row — both target a DIRECTORY, never the row.
// The everyday pair leads; the dated twins get their own section under it, lined
// up with the pair, so they never crowd it (YAZ-2249 🔒 E1/E2). With no directory to target —
// blank space under two or more vaults (YAZ-2602 S10) — there is nothing to create in. ----

const create = (id: string, label: string, pick: (h: MenuHandlers) => () => void): Leaf => (t, h) => (t.targetDir === null ? null : { id, label, onSelect: pick(h) })

const newNote = create('new-note', 'New note', (h) => h.onNewNote)

const newFolder = create('new-folder', 'New folder', (h) => h.onNewFolder)

const newDatedNote = create('new-dated-note', 'New dated note', (h) => h.onNewDatedNote)

const newDatedFolder = create('new-dated-folder', 'New dated folder', (h) => h.onNewDatedFolder)

// ---- (4) This row: acts ON the right-clicked row, so it sits after the create groups ----

/**
 * "Review this folder" (YAZ-2322): a FOLDER row only, either lens — a review session over the
 * notes due inside it, subfolders included. It leads the group: Rename keeps the bottom.
 */
const reviewFolder: Leaf = (t, h) => {
  const dir = t.reviewDir
  if (dir === null) return null
  return { id: 'review-folder', label: 'Review this folder', onSelect: () => h.onReviewFolder(dir) }
}

/**
 * The review toggle (YAZ-2322 🔒 D6): ONE state-aware item, both directions, on a NOTE row only —
 * the caller's null target hides it for a folder, blank space and any file the index does not hold.
 */
const toggleReview: Leaf = (t, h) => {
  const path = t.reviewPath
  if (path === null) return null
  const isOn = t.reviewIsOn
  return { id: 'toggle-review', label: isOn ? 'Turn review off' : 'Turn review on', onSelect: () => h.onSetReview(path, !isOn) }
}

/** Rename — a concrete row only, NEVER blank space: main refuses to rename a window's own vault root (E1b, GRO-2241). */
const rename: Leaf = (t, h) => {
  const path = t.renamePath
  if (path === null) return null
  return { id: 'rename', label: 'Rename', onSelect: () => h.onRename(path) }
}

/**
 * The favorite toggle (YAZ-1766 D3): ONE state-aware item on every ROW — file or dir, any lens —
 * never on blank space. Inside a 2+ selection it names the whole ordered selection and counts it
 * ("Add 3 to favorites"); `favoriteIsOn` is true only when EVERY path is already a favorite, so a
 * mixed selection reads as Add and the handler adds the missing ones. Leads the "Open in ▸"
 * group (Yasin, demo 2026-09-21): a place-verb beside the OS place-verbs, one hairline above Delete.
 */
const toggleFavorite: Leaf = (t, h) => {
  const paths = t.favoritePaths
  if (paths === null) return null
  const isOn = t.favoriteIsOn
  const n = paths.length > 1 ? `${paths.length} ` : ''
  return { id: 'toggle-favorite', label: isOn ? `Remove ${n}from favorites` : `Add ${n}to favorites`, onSelect: () => h.onToggleFavorite(paths, isOn) }
}

/**
 * "Add note shortcut" (YAZ-2290 D2) — a FOLDER row outside a plural selection: pick one
 * note that lives elsewhere, and it also appears in this folder. Under the favorite toggle: the
 * other item that shows a note in a second place.
 */
const addShortcut: Leaf = (t, h) => {
  const dir = t.shortcutDir
  if (dir === null) return null
  return { id: 'add-shortcut', label: 'Add note shortcut', onSelect: () => h.onAddShortcut(dir) }
}

// ---- (5) Open in ▸: the OS verbs, one parent in a group of its own (D7 amended) ----

/** "Open in ▸ New window" — FILE rows only (D2, GRO-2168); folders and blank space hide it. */
const openInNewWindow: Leaf = (t, h) => {
  const path = t.newWindowPath
  if (path === null) return null
  return { id: 'open-window', label: 'New window', onSelect: () => h.onOpenNewWindow(path) }
}

/**
 * Open in VS Code (YAZ-963): Reveal's sibling — same target rule (file, folder, or the vault ROOT
 * for blank space), same read-only posture, same passive notice when the row is stale.
 */
const openInVsCode: Leaf = (t, h) => {
  const path = t.openVsCodePath
  if (path === null) return null
  return { id: 'open-vscode', label: 'VS Code', onSelect: () => h.onOpenVsCode(path) }
}

/** Open in ▸ Default app (YAZ-1577): the third OS verb, directly below VS Code — same target rule, same posture. */
const openInDefault: Leaf = (t, h) => {
  const path = t.openDefaultPath
  if (path === null) return null
  return { id: 'open-default', label: 'Default app', onSelect: () => h.onOpenDefault(path) }
}

/**
 * Reveal in Finder (GRO-2274): available on every row type AND on blank space, where it reveals
 * the vault root — the same target Copy path uses. A read-only utility; inside the flyout it sits
 * alone below a separator (D7 amended) — it shows the row rather than opening it.
 */
const revealInFinder: Leaf = (t, h) => {
  const path = t.revealPath
  if (path === null) return null
  return { id: 'reveal', label: 'Reveal in Finder', onSelect: () => h.onReveal(path) }
}

/**
 * "Open in ▸" (D7 amended, YAZ-1674): the OS verbs collapse into one parent so the top level reads
 * as verbs about the ROW; it stands in its OWN group between the this-row items and Delete. The
 * flyout keeps every child's own gate — New window is FILE rows only (D2, GRO-2168); VS Code,
 * Default app and Reveal share the root-on-blank-space rule — and a separator (a second section)
 * sets Reveal apart from the three "open" verbs. No child at all → no parent: an empty flyout is a lie.
 */
const openIn: Item = (t, h) => {
  const children = [build([openInNewWindow, openInVsCode, openInDefault], t, h), build([revealInFinder], t, h)]
  if (children.every((section) => section.length === 0)) return null
  return { id: 'open-in', label: 'Open in', children }
}

// ---- (6) Delete: LAST, alone (GRO-2272 `C1a-`, LOCKED) ----

/**
 * Rename and Delete render LAST (GRO-2272 `C1a-`, LOCKED): VS Code's Explorer puts both at the
 * bottom, and destructive-last is safer on its own merits — Delete used to sit directly under
 * Rename, which is the misclick pair that matters most; 🔒 D7 now puts a whole group ("Open in ▸")
 * and two separators between them.
 * Delete opens the confirm sheet; it must NEVER delete directly. Null on blank space: no target,
 * and main refuses the vault root anyway.
 */
const del: Leaf = (t, h) => {
  const path = t.deletePath
  if (path === null) return null
  return { id: 'delete', label: 'Delete', danger: true, onSelect: () => h.onDelete(path) }
}

/**
 * "Remove shortcut" (YAZ-2290 E5) stands where Delete would on a SHORTCUT row: the note stops
 * appearing in this folder and stays where it lives — the only place it can be deleted from. Not
 * `danger`, and no confirm: nothing is destroyed.
 */
const removeShortcut: Leaf = (t, h) => {
  const row = t.removeShortcut
  if (row === null) return null
  return { id: 'remove-shortcut', label: 'Remove shortcut', onSelect: () => h.onRemoveShortcut(row.path, row.dir) }
}

/**
 * "Remove from this window" (YAZ-2602 D7) stands where Delete would on a VAULT row: the vault
 * leaves the window with its tabs, and nothing on disk changes — so not `danger`, and no confirm.
 * A window with one vault has no vault row, and so no such item (S51).
 */
const removeVault: Leaf = (t, h) => {
  const root = t.removeVault
  if (root === null) return null
  return { id: 'remove-vault', label: 'Remove from this window', onSelect: () => h.onRemoveVault(root) }
}

/**
 * "Add vault to this window ▸" (YAZ-2602 D2): blank space only, where it closes the menu — under
 * "Open in ▸", the root's other parent, and alone once blank space is no one vault's (S10). The
 * flyout lists the known vaults that are not in this window, in the caller's order, then "Open
 * folder…" in its own section — so with no vault to list the parent still has a child.
 */
const addVault: Item = (t, h) => {
  const vaults = t.addVaults
  if (vaults === null) return null
  return {
    id: 'add-vault',
    label: 'Add vault to this window',
    children: [
      vaults.map((vault) => ({ id: `add-vault-${vault.path}`, label: vault.name, onSelect: () => h.onAddVault(vault.path) })),
      [{ id: 'add-vault-pick', label: 'Open folder…', onSelect: h.onPickVault }],
    ],
  }
}

const OPEN_GROUP: readonly Item[] = [open, openInNewTabs, focus]
const CLIPBOARD_GROUP: readonly Item[] = [cut, copy, paste, copyPaths, copyPath]
const CREATE_GROUP: readonly Item[] = [newNote, newFolder]
const CREATE_MORE_GROUP: readonly Item[] = [newDatedNote, newDatedFolder]
const ROW_GROUP: readonly Item[] = [reviewFolder, toggleReview, rename]
const OPEN_IN_GROUP: readonly Item[] = [toggleFavorite, addShortcut, openIn, addVault]
const DELETE_GROUP: readonly Item[] = [del, removeShortcut, removeVault]

/** Runs a group's rules and keeps the items they offered — the root's groups and a flyout's leaves alike. */
const build = <T extends MenuItem>(group: readonly ((t: MenuSectionTargets, h: MenuHandlers) => T | null)[], t: MenuSectionTargets, h: MenuHandlers): T[] =>
  group.map((rule) => rule(t, h)).filter((item): item is T => item !== null)

/** The seven groups of 🔒 D7 (as amended), in order, every null item dropped. An empty group is the component's to skip. */
export function buildMenuSections(targets: MenuSectionTargets, handlers: MenuHandlers): MenuSection[] {
  return [OPEN_GROUP, CLIPBOARD_GROUP, CREATE_GROUP, CREATE_MORE_GROUP, ROW_GROUP, OPEN_IN_GROUP, DELETE_GROUP].map((group) => build(group, targets, handlers))
}
