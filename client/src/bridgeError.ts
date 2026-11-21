/**
 * The bridge's typed failure, with no bridge (YAZ-5161): `api.ts` throws it and gives it out as before. Code that the
 * phone shares (`review/cardRead.ts`'s `isCardGone`) tests for it here, so it never imports the desktop bridge.
 */
import type { BridgeErrorCode } from '@shared/types'

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
