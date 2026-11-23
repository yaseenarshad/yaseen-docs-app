import { LINK_SCHEMES } from '@shared/links'

interface ProtocolClientOwner {
  isPackaged?: boolean
  setAsDefaultProtocolClient(protocol: string): boolean
}

/**
 * Deep links (E1, GRO-2171): the packaged bundle's `protocols` Info.plist entry is F1's job.
 * Skip registration under `YASEEN_DOCS_E2E=1` (YAZ-2168; YAZ-2131 🔒 D8) and in unpackaged dev
 * launches (`isPackaged === false`, YAZ-6367) so `npm run dev` never hijacks `yaseendocs://`
 * away from `/Applications/Yaseen Docs.app` onto `Electron.app`.
 * Docs also claims Draw's `yaseendraw://` (YAZ-3028 D7): a Draw link opens the file in Docs.
 */
export function claimDeepLinkScheme(app: ProtocolClientOwner, env: NodeJS.ProcessEnv): void {
  if (env.YASEEN_DOCS_E2E === '1' || app.isPackaged === false) return
  for (const scheme of LINK_SCHEMES) app.setAsDefaultProtocolClient(scheme)
}
