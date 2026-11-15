/**
 * THE ENGINE'S FONT FILES (YAZ-5440), as `engine/packages/excalidraw/fonts/<Folder>/index.ts` registers them
 * (`Fonts.init`): the family, the file under `fonts/`, the unicode range (null: all), the weight and the style.
 * Written from those files; `fontFaces.test.ts` fails when the engine's list changes, and prints the new one.
 * Left out: the CJK fallback (Xiaolai, 209 files, 12.7 MB), which the phone draws with the iPhone's own font, and the
 * two local fonts (Helvetica, the emoji font), which have no file.
 */
import type { FontFile } from '../fontFaces'

export const FONT_FILES: readonly FontFile[] = [
  { family: 'Assistant', file: 'Assistant/Assistant-Regular.woff2', range: null, weight: '400', style: 'normal' },
  { family: 'Assistant', file: 'Assistant/Assistant-Medium.woff2', range: null, weight: '500', style: 'normal' },
  { family: 'Assistant', file: 'Assistant/Assistant-SemiBold.woff2', range: null, weight: '600', style: 'normal' },
  { family: 'Assistant', file: 'Assistant/Assistant-Bold.woff2', range: null, weight: '700', style: 'normal' },
  { family: 'Cascadia', file: 'Cascadia/CascadiaCode-Regular.woff2', range: null, weight: '400', style: 'normal' },
  { family: 'Comic Shanns', file: 'ComicShanns/ComicShanns-Regular-279a7b317d12eb88de06167bd672b4b4.woff2', range: 'U+20-7e,U+a1-a6,U+a8,U+ab-ac,U+af-b1,U+b4,U+b8,U+bb-bc,U+bf-cf,U+d1-d7,U+d9-de,U+e0-ef,U+f1-f7,U+f9-ff,U+131,U+152-153,U+2c6,U+2da,U+2dc,U+2013-2014,U+2018-201a,U+201c-201d,U+2020-2022,U+2026,U+2039-203a,U+2044,U+20ac,U+2191,U+2193,U+2212', weight: '400', style: 'normal' },
  { family: 'Comic Shanns', file: 'ComicShanns/ComicShanns-Regular-fcb0fc02dcbee4c9846b3e2508668039.woff2', range: 'U+100-10f,U+112-125,U+128-130,U+134-137,U+139-13c,U+141-148,U+14c-151,U+154-161,U+164-165,U+168-17f,U+1bf,U+1f7,U+218-21b,U+237,U+1e80-1e85,U+1ef2-1ef3,U+a75b', weight: '400', style: 'normal' },
  { family: 'Comic Shanns', file: 'ComicShanns/ComicShanns-Regular-dc6a8806fa96795d7b3be5026f989a17.woff2', range: 'U+2c7,U+2d8-2d9,U+2db,U+2dd,U+315,U+2190,U+2192,U+2200,U+2203-2204,U+2264-2265,U+f6c3', weight: '400', style: 'normal' },
  { family: 'Comic Shanns', file: 'ComicShanns/ComicShanns-Regular-6e066e8de2ac57ea9283adb9c24d7f0c.woff2', range: 'U+3bb', weight: '400', style: 'normal' },
  { family: 'Excalifont', file: 'Excalifont/Excalifont-Regular-a88b72a24fb54c9f94e3b5fdaa7481c9.woff2', range: 'U+20-7e,U+a0-a3,U+a5-a6,U+a8-ab,U+ad-b1,U+b4,U+b6-b8,U+ba-ff,U+131,U+152-153,U+2bc,U+2c6,U+2da,U+2dc,U+304,U+308,U+2013-2014,U+2018-201a,U+201c-201e,U+2020,U+2022,U+2024-2026,U+2030,U+2039-203a,U+20ac,U+2122,U+2212', weight: '400', style: 'normal' },
  { family: 'Excalifont', file: 'Excalifont/Excalifont-Regular-be310b9bcd4f1a43f571c46df7809174.woff2', range: 'U+100-130,U+132-137,U+139-149,U+14c-151,U+154-17e,U+192,U+1fc-1ff,U+218-21b,U+237,U+1e80-1e85,U+1ef2-1ef3,U+2113', weight: '400', style: 'normal' },
  { family: 'Excalifont', file: 'Excalifont/Excalifont-Regular-b9dcf9d2e50a1eaf42fc664b50a3fd0d.woff2', range: 'U+400-45f,U+490-491,U+2116', weight: '400', style: 'normal' },
  { family: 'Excalifont', file: 'Excalifont/Excalifont-Regular-41b173a47b57366892116a575a43e2b6.woff2', range: 'U+37e,U+384-38a,U+38c,U+38e-393,U+395-3a1,U+3a3-3a8,U+3aa-3cf,U+3d7', weight: '400', style: 'normal' },
  { family: 'Excalifont', file: 'Excalifont/Excalifont-Regular-3f2c5db56cc93c5a6873b1361d730c16.woff2', range: 'U+2c7,U+2d8-2d9,U+2db,U+2dd,U+302,U+306-307,U+30a-30c,U+326-328,U+212e,U+2211,U+fb01-fb02', weight: '400', style: 'normal' },
  { family: 'Excalifont', file: 'Excalifont/Excalifont-Regular-349fac6ca4700ffec595a7150a0d1e1d.woff2', range: 'U+462-463,U+472-475,U+4d8-4d9,U+4e2-4e3,U+4e6-4e9,U+4ee-4ef', weight: '400', style: 'normal' },
  { family: 'Excalifont', file: 'Excalifont/Excalifont-Regular-623ccf21b21ef6b3a0d87738f77eb071.woff2', range: 'U+300-301,U+303', weight: '400', style: 'normal' },
  { family: 'IBM Plex Mono', file: 'IBMPlexMono/IBMPlexMono-Regular.woff2', range: null, weight: '400', style: 'normal' },
  { family: 'IBM Plex Mono', file: 'IBMPlexMono/IBMPlexMono-Bold.woff2', range: null, weight: '700', style: 'normal' },
  { family: 'Inter', file: 'Inter/Inter-Regular.woff2', range: null, weight: '400', style: 'normal' },
  { family: 'Inter', file: 'Inter/Inter-Bold.woff2', range: null, weight: '700', style: 'normal' },
  { family: 'Liberation Sans', file: 'Liberation/LiberationSans-Regular.woff2', range: null, weight: '400', style: 'normal' },
  { family: 'Liberation Sans', file: 'Liberation/LiberationSans-Bold.woff2', range: null, weight: '700', style: 'normal' },
  { family: 'Liberation Serif', file: 'LiberationSerif/LiberationSerif-Regular.woff2', range: null, weight: '400', style: 'normal' },
  { family: 'Liberation Serif', file: 'LiberationSerif/LiberationSerif-Bold.woff2', range: null, weight: '700', style: 'normal' },
  { family: 'Lilita One', file: 'Lilita/Lilita-Regular-i7dPIFZ9Zz-WBtRtedDbYE98RXi4EwSsbg.woff2', range: 'U+0100-02AF, U+0304, U+0308, U+0329, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF', weight: '400', style: 'normal' },
  { family: 'Lilita One', file: 'Lilita/Lilita-Regular-i7dPIFZ9Zz-WBtRtedDbYEF8RXi4EwQ.woff2', range: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD', weight: '400', style: 'normal' },
  { family: 'Nunito', file: 'Nunito/Nunito-Regular-XRXI3I6Li01BKofiOc5wtlZ2di8HDIkhdTk3j6zbXWjgevT5.woff2', range: 'U+0460-052F, U+1C80-1C88, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F', weight: '500', style: 'normal' },
  { family: 'Nunito', file: 'Nunito/Nunito-Regular-XRXI3I6Li01BKofiOc5wtlZ2di8HDIkhdTA3j6zbXWjgevT5.woff2', range: 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116', weight: '500', style: 'normal' },
  { family: 'Nunito', file: 'Nunito/Nunito-Regular-XRXI3I6Li01BKofiOc5wtlZ2di8HDIkhdTs3j6zbXWjgevT5.woff2', range: 'U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB', weight: '500', style: 'normal' },
  { family: 'Nunito', file: 'Nunito/Nunito-Regular-XRXI3I6Li01BKofiOc5wtlZ2di8HDIkhdTo3j6zbXWjgevT5.woff2', range: 'U+0100-02AF, U+0304, U+0308, U+0329, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF', weight: '500', style: 'normal' },
  { family: 'Nunito', file: 'Nunito/Nunito-Regular-XRXI3I6Li01BKofiOc5wtlZ2di8HDIkhdTQ3j6zbXWjgeg.woff2', range: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD', weight: '500', style: 'normal' },
  { family: 'Roboto', file: 'Roboto/Roboto-Regular.woff2', range: null, weight: '400', style: 'normal' },
  { family: 'Roboto', file: 'Roboto/Roboto-Bold.woff2', range: null, weight: '700', style: 'normal' },
  { family: 'Virgil', file: 'Virgil/Virgil-Regular.woff2', range: null, weight: '400', style: 'normal' },
]
