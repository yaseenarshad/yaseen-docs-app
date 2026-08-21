import type {
  ApiErrorCode,
  BridgeError,
  CreateDirResponse,
  CreateFileResponse,
  FileResponse,
  FileWriteRequest,
  FileWriteResponse,
  IndexResponse,
  PickFolderResponse,
  TreeResponse,
} from '@shared/types'

/** Typed failure from the main process (see docs/CONTRACTS.md "Bridge API"). */
export class ApiRequestError extends Error {
  constructor(
    readonly code: ApiErrorCode | 'CONFLICT',
    message: string,
    /** Current on-disk mtime, only present on CONFLICT. */
    readonly mtime?: number,
    /** The offending path, when the main process attributed the failure to one. */
    readonly path?: string,
  ) {
    super(message)
    this.name = 'ApiRequestError'
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
    if (isBridgeError(err)) throw new ApiRequestError(err.code, err.message, err.mtime, err.path)
    throw new ApiRequestError('IO_ERROR', err instanceof Error ? err.message : String(err))
  }
}

/** The fs half of `window.yaseenDocs`, with rejections wrapped in `ApiRequestError`. */
export const api = {
  tree: (root: string) => call<TreeResponse>(() => window.yaseenDocs.tree(root)),
  readFile: (path: string) => call<FileResponse>(() => window.yaseenDocs.readFile(path)),
  writeFile: (body: FileWriteRequest) => call<FileWriteResponse>(() => window.yaseenDocs.writeFile(body)),
  createDir: (path: string) => call<CreateDirResponse>(() => window.yaseenDocs.createDir(path)),
  createFile: (path: string) => call<CreateFileResponse>(() => window.yaseenDocs.createFile(path)),
  /** Bases property index for `root` (GRO-2129). */
  index: (root: string) => call<IndexResponse>(() => window.yaseenDocs.index(root)),
  /** Native open-directory dialog parented to this window; resolves when the user picks or cancels. */
  pickFolder: () => call<PickFolderResponse>(() => window.yaseenDocs.pickFolder()),
}
