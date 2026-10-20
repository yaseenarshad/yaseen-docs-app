import { LINK_SCHEMES } from '@shared/links'

interface ProtocolClientOwner {
  setAsDefaultProtocolClient(protocol: string): boolean
}

/**
 * Deep links (E1, GRO-2171): the packaged bundle's `protocols` Info.plist entry is F1's job.
 * The e2e harness sets `YASEEN_DOCS_E2E=1` so a test run never re-points the machine's
 * `yaseendocs://` handler at the dev Electron binary (YAZ-2168; YAZ-2131 🔒 D8).
 * Docs also claims Draw's `yaseendraw://` (YAZ-3028 D7): a Draw link opens the file in Docs.
 */
export function claimDeepLinkScheme(app: ProtocolClientOwner, env: NodeJS.ProcessEnv): void {
  if (env.YASEEN_DOCS_E2E === '1') return
  for (const scheme of LINK_SCHEMES) app.setAsDefaultProtocolClient(scheme)
}
