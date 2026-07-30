# Professional font asset provenance

The application self-hosts only the Regular (`400`) and Bold (`700`) faces approved for the professional font picker. Each asset is a static WOFF2 subset covering Latin, Latin Extended, punctuation, currency, arrows, mathematical operators, geometric symbols, and common symbols.

The exact subset range is registered in `professionalFontRange.ts`. Unsupported glyphs continue through Excalidraw's existing generic and emoji fallback chain.

## Sources

| Family | Source | Version / revision | License |
| --- | --- | --- | --- |
| Inter | [rsms/inter](https://github.com/rsms/inter/releases/tag/v4.1) | v4.1 | SIL OFL 1.1 |
| Roboto | [googlefonts/roboto-3-classic](https://github.com/googlefonts/roboto-3-classic/releases/tag/v3.016) | v3.016 | SIL OFL 1.1 |
| Liberation Sans / Serif | [liberationfonts/liberation-fonts](https://github.com/liberationfonts/liberation-fonts/releases/tag/2.1.5) | 2.1.5 | SIL OFL 1.1 |
| IBM Plex Mono | [IBM/plex](https://github.com/IBM/plex/tree/bf260093582f04622aacc1e9f9ca604d7ccd0c42/packages/plex-mono) | `bf260093582f04622aacc1e9f9ca604d7ccd0c42` | SIL OFL 1.1 |

The full upstream license text is stored beside each family's WOFF2 assets. Liberation Sans and Liberation Serif share the same upstream license.

## Reproducible transformation

The static upstream TTFs were subset with FontTools `4.59.1` and Brotli using:

```text
pyftsubset INPUT.ttf
  --flavor=woff2
  --unicodes=U+0000-024F,U+1E00-1EFF,U+2000-206F,U+2070-209F,U+20A0-20CF,U+2100-214F,U+2190-21FF,U+2200-22FF,U+25A0-25FF,U+2600-26FF,U+FEFF,U+FFFD
  --layout-features=*
  --glyph-names
  --symbol-cmap
  --legacy-cmap
  --notdef-glyph
  --recommended-glyphs
  --name-IDs=*
  --name-legacy
  --name-languages=*
```

The ten WOFF2 files total **520,080 bytes**.

## Output checksums

```text
fb8520a0805a97689955b78a96538b4723fedc60b171912e34c8e24ca4416266  IBMPlexMono-Bold.woff2
87edcd1786672cf9c567134d24b071e3d67d2a31e88c9d72eafd4af45ad808c0  IBMPlexMono-Regular.woff2
0648742c8816102938c3fef0838cbbc7bb43118026d1b995f9ab983ed0e8d7aa  Inter-Bold.woff2
bed9fc1f5be79e477bd9a458f74395e3dbad0cc8d78a93ae7564fa794e9341ca  Inter-Regular.woff2
dc090d827782d5fb5b85d92837396148b0674f3c0f5ff330aeb02915ad6808a4  LiberationSans-Bold.woff2
decfc595b6e9423d5ce5a15e0582c22f42997710bf8168ba54a877017e420437  LiberationSans-Regular.woff2
407789f2cc521ea4a22e888c11c711bba1774dfd75c44bb3ac65fe327119dd4d  LiberationSerif-Bold.woff2
550a31647a1d08d4e7a710bfede4690881761db38cd78aed75d92f6af35686c3  LiberationSerif-Regular.woff2
50ca6d1c42435f4cd9e30cf26e73f71f865dce8e34fe95c9484f2e7097b650ef  Roboto-Bold.woff2
8ea9dbe14f67012fca8c9394f8cc353c1877723757de8fa69fe94c5b42d3b333  Roboto-Regular.woff2
```
