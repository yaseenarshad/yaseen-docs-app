export interface ProtocolClientOwner {
  setAsDefaultProtocolClient(protocol: string): boolean
}

/**
 * Deep links (E1, GRO-2171): the packaged bundle's `protocols` Info.plist entry is F1's job.
 * The e2e harness sets `YASEEN_DOCS_E2E=1` so a test run never re-points the machine's
 * `yaseendocs://` handler at the dev Electron binary (YAZ-2168).
 */
export function claimDeepLinkScheme(app: ProtocolClientOwner, env: NodeJS.ProcessEnv): void {
  if (env.YASEEN_DOCS_E2E === '1') return
  app.setAsDefaultProtocolClient('yaseendocs')
}
