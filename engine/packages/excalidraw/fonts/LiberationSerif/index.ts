import { PROFESSIONAL_FONT_UNICODE_RANGE } from "../professionalFontRange";

import Bold from "./LiberationSerif-Bold.woff2";
import Regular from "./LiberationSerif-Regular.woff2";

import type { ExcalidrawFontFaceDescriptor } from "../Fonts";

export const LiberationSerifFontFaces: ExcalidrawFontFaceDescriptor[] = [
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
