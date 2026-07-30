import { PROFESSIONAL_FONT_UNICODE_RANGE } from "../professionalFontRange";

import Bold from "./IBMPlexMono-Bold.woff2";
import Regular from "./IBMPlexMono-Regular.woff2";

import type { ExcalidrawFontFaceDescriptor } from "../Fonts";

export const IBMPlexMonoFontFaces: ExcalidrawFontFaceDescriptor[] = [
  {
    uri: Regular,
    descriptors: {
      weight: "400",
      unicodeRange: PROFESSIONAL_FONT_UNICODE_RANGE,
    },
  },
  {
    uri: Bold,
    descriptors: {
      weight: "700",
      unicodeRange: PROFESSIONAL_FONT_UNICODE_RANGE,
    },
  },
];
