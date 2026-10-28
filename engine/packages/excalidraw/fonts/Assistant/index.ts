import Bold from "./Assistant-Bold.woff2";
import Medium from "./Assistant-Medium.woff2";
import Regular from "./Assistant-Regular.woff2";
import SemiBold from "./Assistant-SemiBold.woff2";

import type { ExcalidrawFontFaceDescriptor } from "../Fonts";

export const AssistantFontFaces: ExcalidrawFontFaceDescriptor[] = [
  {
    uri: Regular,
    descriptors: { weight: "400" },
  },
  {
    uri: Medium,
    descriptors: { weight: "500" },
  },
  {
    uri: SemiBold,
    descriptors: { weight: "600" },
  },
  {
    uri: Bold,
    descriptors: { weight: "700" },
  },
];
