/**
 * The overrides `tools/packDesktop.mjs` gives electron-builder: the ROOT package.json version, and its short form
 * for what a person sees (YAZ-3209: `2.10.0` shows as `2.10`).
 *
 * They go to electron-builder's `build()` as values, never as `-c.` flags: its command line reads a flag that looks
 * like a number as one, so `-c.mac.bundleShortVersion=2.10` became 2.1, and v2.10's About box and disk image said 2.1.
 */
export function packConfig(version) {
  const short = version.replace(/^(\d+\.\d+)\.0$/, '$1')
  return {
    short,
    config: {
      extraMetadata: { version },
      mac: { bundleShortVersion: short },
      dmg: { artifactName: `\${productName}-${short}-arm64.dmg` },
      nsis: { artifactName: `\${productName}-${short}-win-x64-setup.\${ext}` },
    },
  }
}
