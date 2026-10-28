# Local background-removal runtime

Image background removal runs entirely in the browser. Source image bytes are passed from the editor to a dedicated Web Worker and are never sent to an inference API.

The worker uses `@huggingface/transformers` 3.8.1 with the Apache-2.0 licensed `Ko033/isnet-general-use-onnx` model pinned to revision `5349b617911fd60c619b52f32e2b593517b78df3`. The application-controlled manifest in `background-removal-assets.json` records every model and ONNX runtime artifact by byte size and SHA-256. Runtime network access is restricted to the immutable, revision-keyed same-origin `/api/background-removal-assets/v1-5349b617/` route.

Provisioning is explicit:

```sh
yarn background-removal:assets
yarn background-removal:assets --upload
```

The first command downloads the pinned model files, verifies all model and runtime checksums, and makes no remote changes. The second performs the same verification before uploading the allowlisted artifacts to the app's R2 bucket. The Worker returns `503` for an allowlisted file that has not been provisioned and `404` for every path not present in the manifest.

WebGPU with the fp16 model is preferred. A quantized WASM model is the compatibility fallback. Both paths use the same local processor, produce a full-resolution transparent PNG, and preserve soft alpha edges.
