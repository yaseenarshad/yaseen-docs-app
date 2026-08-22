import type {
  BridgeErrorCode,
  AssetResponse,
  BridgeError,
  CreateDirResponse,
  CreateFileRequest,
  CreateFileResponse,
  FileResponse,
  FileWriteRequest,
  FileWriteResponse,
  IndexResponse,
  PickFolderResponse,
  RegistryPropertyDef,
  RegistryResponse,
  RegistryScope,
  RegistryTypeDef,
  RenameFileRequest,
  RenameFileResponse,
  TreeResponse,
} from '@shared/types'

/** Typed failure from the main process (see docs/CONTRACTS.md "Bridge API"). */
export class BridgeRequestError extends Error {
  constructor(
    readonly code: BridgeErrorCode | 'CONFLICT',
    message: string,
    /** Current on-disk mtime, only present on CONFLICT. */
    readonly mtime?: number,
    /** The offending path, when the main process attributed the failure to one. */
    readonly path?: string,
  ) {
    super(message)
    this.name = 'BridgeRequestError'
  }
}

function isBridgeError(err: unknown): err is BridgeError {
  return typeof err === 'object' && err !== null && typeof (err as BridgeError).code === 'string' && typeof (err as BridgeError).message === 'string'
}

/** The bridge rejects with a plain `BridgeError` object (no prototype survives IPC); give it a class. */
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (isBridgeError(err)) throw new BridgeRequestError(err.code, err.message, err.mtime, err.path)
    throw new BridgeRequestError('IO_ERROR', err instanceof Error ? err.message : String(err))
  }
}

/** The fs half of `window.yaseenDocs`, with rejections wrapped in `BridgeRequestError`. */
export const api = {
  tree: (root: string) => call<TreeResponse>(() => window.yaseenDocs.tree(root)),
  readFile: (path: string) => call<FileResponse>(() => window.yaseenDocs.readFile(path)),
  writeFile: (body: FileWriteRequest) => call<FileWriteResponse>(() => window.yaseenDocs.writeFile(body)),
  createDir: (path: string) => call<CreateDirResponse>(() => window.yaseenDocs.createDir(path)),
  createFile: (req: string | CreateFileRequest) => call<CreateFileResponse>(() => window.yaseenDocs.createFile(req)),
  /** In-app FILE rename, same dir, kind unchanged; never overwrites (Links E1, GRO-2194). */
  rename: (req: RenameFileRequest) => call<RenameFileResponse>(() => window.yaseenDocs.file.rename(req)),
  /** Bases property index for `root` (GRO-2129). */
  index: (root: string) => call<IndexResponse>(() => window.yaseenDocs.index(root)),
  /** Local image under `root` for a cards cover (GRO-2139); `ref` = wikilink target or path. */
  readAsset: (root: string, ref: string) => call<AssetResponse>(() => window.yaseenDocs.readAsset(root, ref)),
  /** Native open-directory dialog parented to this window; resolves when the user picks or cancels. */
  pickFolder: () => call<PickFolderResponse>(() => window.yaseenDocs.pickFolder()),
  /** Type & property registry over `.yaseendocs/types.json` (Bible A, GRO-2201); consumed via `useRegistry`. */
  registry: {
    get: (root: string) => call<RegistryResponse>(() => window.yaseenDocs.registry.get(root)),
    setType: (root: string, name: string, def: Partial<RegistryTypeDef>) => call<void>(() => window.yaseenDocs.registry.setType(root, name, def)),
    removeType: (root: string, name: string) => call<void>(() => window.yaseenDocs.registry.removeType(root, name)),
    setProperty: (root: string, scope: RegistryScope, name: string, def: RegistryPropertyDef) => call<void>(() => window.yaseenDocs.registry.setProperty(root, scope, name, def)),
    removeProperty: (root: string, scope: RegistryScope, name: string) => call<void>(() => window.yaseenDocs.registry.removeProperty(root, scope, name)),
    onChange: (listener: (registry: RegistryResponse) => void) => window.yaseenDocs.registry.onChange(listener),
  },
}
