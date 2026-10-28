import { type ExcalidrawFontFaceDescriptor } from "../Fonts";

import { PROFESSIONAL_FONT_UNICODE_RANGE } from "../professionalFontRange";

import LiberationSansBold from "./LiberationSans-Bold.woff2";
import LiberationSansRegular from "./LiberationSans-Regular.woff2";

export const LiberationFontFaces: ExcalidrawFontFaceDescriptor[] = [
  {
    uri: LiberationSansRegular,
    descriptors: {
      weight: "400",
      unicodeRange: PROFESSIONAL_FONT_UNICODE_RANGE,
    },
  },
  {
    uri: LiberationSansBold,
    descriptors: {
      weight: "700",
      unicodeRange: PROFESSIONAL_FONT_UNICODE_RANGE,
    },
  },
];
