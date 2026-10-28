# Storyboard to YaseenDraw scene contract

Version 1 converts one validated storyboard slide into one ordinary top-level Excalidraw frame. It deliberately does not introduce a custom slide element or a full-slide HTML output mode.

## Input

Call `validateStoryboardPresentation(input, templates)` before rendering. A presentation declares a stable `presentationId`, the generator version, and an ordered collection of slides. Every slide supplies editable copy, an exact registered template ID/version, exactly one of the approved render modes, and the matching visual reference.

The approved modes are:

- `image`: the visual reference owns a binary asset ID. The renderer creates a normal image element in the template's visual slot.
- `animation`: the visual reference owns either embedded HTML for small prototypes or an immutable animation asset ID/version pair. The renderer creates an iframe in the visual slot. A preview image is optional.
- `full-native`: the visual reference owns the stable source ID for a native element composition. The renderer creates only normal Excalidraw elements.

The canonical fixture at `fixtures/canonical-storyboard.json` contains one example of every mode.

## Scene metadata

Store the result of `mapSlideToSceneMetadata()` under the `customData.yaseenPresentation` namespace.

The frame metadata owns presentation identity and ordering:

```json
{
  "kind": "slide-frame",
  "schemaVersion": 1,
  "generatorVersion": "canvas-skill@1.0.0",
  "presentationId": "foundations-of-ai",
  "slideId": "slide-image",
  "presentationOrder": 1,
  "templateId": "foundations-editorial",
  "templateVersion": "1.0.0",
  "renderMode": "image"
}
```

Every generated child receives `slide-child` metadata with the same schema version and slide ID. Its semantic role is one of `template-background`, `eyebrow`, `headline`, `body`, `card`, `static-visual`, `animated-visual`, or `native-visual`. Repeating roles such as cards also receive a stable `slotId`.

Use `createPresentationElementId()` for every generated frame and child. Its ID is derived from presentation ID, slide ID, semantic role, and optional slot ID, so regenerating the same storyboard replaces the same logical elements instead of duplicating them.

## Ownership boundary

- Scene JSON owns frame geometry, native copy, element relationships, metadata, template IDs, and asset references.
- Excalidraw binary files / the existing R2 board-asset path own shared SVG plates, static visuals, and preview images.
- Embedded animation HTML remains in scene JSON only for small prototypes and counts against the scene-size limit.
- Hosted animation bundles use the dedicated trusted R2 contract. Cloud scene JSON persists only `customData.animationAsset = { assetId, version }`; short-lived viewer URLs remain in editor memory and are resolved only when Presentation Mode requests the active or adjacent runtime. Local embedded animations keep their bridged HTML for portable `.excalidraw` files.

Validation collects all actionable errors in one `StoryboardContractError`. Each slide error includes its stable slide ID, field path, and reason. Duplicate slide IDs/orders, missing copy or visuals, unknown templates, mode/visual mismatches, unsupported modes, and template text overflow all fail before scene generation starts.
