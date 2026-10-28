import { PROFESSIONAL_FONT_UNICODE_RANGE } from "../professionalFontRange";

import Bold from "./Roboto-Bold.woff2";
import Regular from "./Roboto-Regular.woff2";

import type { ExcalidrawFontFaceDescriptor } from "../Fonts";

export const RobotoFontFaces: ExcalidrawFontFaceDescriptor[] = [
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
