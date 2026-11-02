interface Window {
  ClipboardItem: any;
  __EXCALIDRAW_SHA__: string | undefined;
  EXCALIDRAW_ASSET_PATH: string | string[] | undefined;
  EXCALIDRAW_THROTTLE_RENDER: boolean | undefined;
  DEBUG_FRACTIONAL_INDICES: boolean | undefined;
  EXCALIDRAW_EXPORT_SOURCE: string;
  gtag: Function;
  sa_event: Function;
  fathom: { trackEvent: Function };
}

interface CanvasRenderingContext2D {
  // https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/roundRect
  roundRect?: (
    x: number,
    y: number,
    width: number,
    height: number,
    radii:
      | number // [all-corners]
      | [number] // [all-corners]
      | [number, number] // [top-left-and-bottom-right, top-right-and-bottom-left]
      | [number, number, number] // [top-left, top-right-and-bottom-left, bottom-right]
      | [number, number, number, number], // [top-left, top-right, bottom-right, bottom-left]
  ) => void;
}

interface Clipboard extends EventTarget {
  write(data: any[]): Promise<void>;
}

// PNG encoding/decoding
// -----------------------------------------------------------------------------
type TEXtChunk = { name: "tEXt"; data: Uint8Array };

declare module "png-chunk-text" {
  function encode(
    name: string,
    value: string,
  ): { name: "tEXt"; data: Uint8Array };
  function decode(data: Uint8Array): { keyword: string; text: string };
}
declare module "png-chunks-encode" {
  function encode(chunks: TEXtChunk[]): Uint8Array<ArrayBuffer>;
  export = encode;
}
declare module "png-chunks-extract" {
  function extract(buffer: Uint8Array): TEXtChunk[];
  export = extract;
}
// -----------------------------------------------------------------------------

interface Blob {
  handle?: FileSystemFileHandle;
  name?: string;
}

declare module "*.scss";

// --------------------------------------------------------------------------—
// ensure Uint8Array isn't assignable to ArrayBuffer
// (due to TS structural typing)
// https://github.com/microsoft/TypeScript/issues/31311#issuecomment-490690695
interface ArrayBuffer {
  _brand?: "ArrayBuffer";
}
interface Uint8Array {
  _brand?: "Uint8Array";
}
// --------------------------------------------------------------------------—

// https://github.com/nodeca/image-blob-reduce/issues/23#issuecomment-783271848
declare module "image-blob-reduce" {
  import type { PicaResizeOptions, Pica } from "pica";
  namespace ImageBlobReduce {
    interface ImageBlobReduce {
      toBlob(file: File, options: ImageBlobReduceOptions): Promise<Blob>;
      _create_blob(
        this: { pica: Pica },
        env: {
          out_canvas: HTMLCanvasElement;
          out_blob: Blob;
        },
      ): Promise<any>;
    }

    interface ImageBlobReduceStatic {
      new (options?: any): ImageBlobReduce;

      (options?: any): ImageBlobReduce;
    }

    interface ImageBlobReduceOptions extends PicaResizeOptions {
      max: number;
    }
  }
  const reduce: ImageBlobReduce.ImageBlobReduceStatic;
  export = reduce;
}

// YAZ-3944 D3: a file and all it imports, bundled into one script (`scripts/buildPackage.js`)
declare module "*?worker-source" {
  const source: string;
  export default source;
}

// YAZ-3944 D3: the GIF encoder of the shrink (the parts it uses)
declare module "gifenc/dist/gifenc.esm.js" {
  type Format = "rgb565" | "rgb444" | "rgba4444";
  type Palette = number[][];
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: { format?: Format; oneBitAlpha?: boolean | number },
  ): Palette;
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: Palette,
    format?: Format,
  ): Uint8Array;
  export function GIFEncoder(): {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      options?: {
        palette?: Palette;
        delay?: number;
        repeat?: number;
        transparent?: boolean;
        transparentIndex?: number;
        dispose?: number;
      },
    ): void;
    finish(): void;
    bytes(): Uint8Array<ArrayBuffer>;
  };
}

interface CustomMatchers {
  toBeNonNaNNumber(): void;
  toCloselyEqualPoints(
    points: readonly [number, number][],
    precision?: number,
  ): void;
}

declare namespace jest {
  interface Expect extends CustomMatchers {}
  interface Matchers extends CustomMatchers {}
}
