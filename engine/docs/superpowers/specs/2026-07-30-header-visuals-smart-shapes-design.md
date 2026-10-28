# Header, Visual Insertion, and Smart Shapes Design

## Purpose

This project improves the self-hosted Excalidraw experience in three connected areas:

1. Simplify the desktop header and consolidate sharing.
2. Make Image Studio visuals arrive at a useful on-screen size at every zoom level.
3. Add Canva-like Smart Shapes whose meaningful dimensions can be adjusted independently.

The work stays inside the existing Excalidraw, Convex, Cloudflare Worker, and R2 architecture. It does not add multi-user editing or change diagram ownership.

## 1. Header and Sharing

### Desktop layout

The top row will use this order:

1. Main menu button.
2. Diagram title and save status.
3. Compact profile avatar.
4. Centered drawing toolbar.
5. Purple Share button.
6. Sidebar toggle.

The title remains editable in place. The save status remains directly beneath or beside the title, depending on available width. The profile trigger shows only the user's initial, such as `Y`. Opening it reveals the full display name and Sign out action.

The separate cloud Share button, full-name profile pill, and top-level Excalidraw+ promotional button will be removed. This only removes the Excalidraw+ header promotion; unrelated import/export or menu functionality is outside this project's scope.

The existing host UI hooks remain intact. App-specific CSS ordering will place the cloud identity after the main menu without changing the public ordering contract for other Excalidraw consumers.

### Share interaction

The existing purple Share control becomes the single entry point for saved diagram sharing. It will no longer open the upstream collaboration picker for ordinary account-backed diagrams.

Clicking Share opens a compact dialog containing:

- The diagram title.
- A clear `View-only link` label.
- A short explanation that anyone with the link can view the diagram.
- A `Create link` action before sharing is enabled.
- The generated URL and a `Copy link` action after creation.
- Visible `Creating…`, `Link copied`, and error states.

The dialog uses the current Convex `enableSharing` flow. It does not create a second share-token system. Opening the dialog alone does not enable sharing; the user must choose `Create link`. This avoids changing access accidentally.

Live collaboration is not part of this project. The dialog structure may be extended later, but it will not show disabled or speculative collaboration controls now.

### Responsive behavior

On narrower desktop layouts, the title truncates before the toolbar or canvas controls are displaced. The avatar remains icon-only. On phone layouts, the existing compact mobile arrangement is preserved, while the same Share dialog and icon-only profile trigger are used.

## 2. Zoom-Aware Image Studio Insertion

### Desired behavior

An image, illustration, logo, or icon inserted from Image Studio should have a consistent useful size on screen, independent of the current canvas zoom.

The longest rendered side will target 320 CSS pixels. The corresponding scene dimension is:

`target scene size = 320 / current zoom`

Examples:

- At 25% zoom, the longest scene side is 1280 units and appears as 320 pixels.
- At 100% zoom, it is 320 scene units and appears as 320 pixels.
- At 200% zoom, it is 160 scene units and appears as 320 pixels.

Aspect ratio is always preserved. The target is capped so the inserted visual uses no more than 55% of the usable viewport's width or height. The usable viewport excludes measured sidebars and other registered viewport UI.

The inserted element is centered in the usable canvas area, selected immediately, and committed as one undoable insertion. Raster and vector results follow the same sizing rule.

### Implementation boundary

The Image Studio call to `insertImages` will pass an optional viewport-sizing request. Image initialization remains inside Excalidraw so intrinsic dimensions, file registration, selection, and history stay atomic.

Regular paste, drag-and-drop, and image-tool insertion keep their current sizing. Only Image Studio opts into the new screen-relative behavior.

The sizing calculation will be a pure helper with explicit inputs for intrinsic dimensions, zoom, and usable viewport bounds. This makes the behavior deterministic and independently testable.

## 3. Smart Shapes

### Why ordinary SVGs and libraries are insufficient

SVG and ordinary Excalidraw library items store geometry but not semantic constraints. The filled arrows in `excalidraw-library-yasin` are closed eight-point line polygons. They are editable and recolorable, but normal bounding-box resizing scales the arrowhead and shaft together.

Smart Shapes add named parameters and adjustment handles while continuing to render as native Excalidraw elements.

### Element representation

Each Smart Shape is stored as an ordinary closed Excalidraw line polygon. Its `customData` contains versioned Smart Shape metadata:

```ts
{
  yasinSmartShape: {
    version: 1,
    kind: "filled-arrow",
    direction: "right",
    parameters: {
      shaftRatio: 0.5,
      headLengthRatio: 0.4,
      headWidthRatio: 1
    }
  }
}
```

The polygon remains valid if opened by an Excalidraw build that does not understand the metadata. It still saves, shares, exports, recolors, rotates, duplicates, and participates in normal selection because it is not a new core element type.

Generators convert a Smart Shape definition plus parameters into normalized points. Parameter bounds prevent inverted or self-intersecting shapes.

### Editing interaction

When exactly one supported Smart Shape is selected, the canvas renders shape-specific adjustment handles in addition to ordinary transform handles.

For a filled arrow:

- A shaft handle changes shaft thickness without changing total height.
- A head handle changes arrowhead length without changing total length.
- Ordinary side and corner handles continue to change overall length and height.

Dragging an adjustment handle converts the pointer into the element's local coordinate system, clamps the affected parameter, regenerates the polygon, and updates the scene continuously. The completed drag is a single undoable operation.

Rotation, zoom, and flipped scale are included in the coordinate conversion. Adjustment handles are only interactive in edit mode and are hidden for locked elements, multi-selection, view-only diagrams, and unsupported legacy polygons.

The element properties UI will also expose numeric or slider controls for the same parameters. This provides an accessible fallback and precise adjustment without requiring pointer dragging.

### Initial catalog

The first Smart Shapes catalog will contain:

- Filled arrows: right, left, up, and down.
- Chevrons: right, left, up, and down.
- Curly braces: left and right.
- Square brackets: left and right.
- Parentheses: left and right.
- Callouts: rectangular speech bubble and rounded speech bubble.

The existing `excalidraw-library-yasin` geometry is the seed reference for arrows, braces, brackets, and parentheses. Definitions are copied into the application as typed generators; the deployed app does not depend on the separate repository at runtime.

The catalog appears under the existing Shapes section in Image Studio. Smart Shapes use the existing account-global Favorites and Recent flows. They insert as native editable elements rather than image files and do not use R2.

### Catalog expansion

There is no universal SVG catalog that includes Canva-style adjustment semantics. The public Excalidraw library catalog remains useful for ordinary editable assets, but those items are not automatically Smart Shapes.

Future Smart Shape definitions can be inspired by DrawingML preset geometry, which describes shape parameters and adjustment handles. This project will not implement a full DrawingML parser. It establishes a small typed registry so additional hand-selected definitions can be added safely without changing the editing engine.

## Architecture

The implementation will introduce these bounded units:

- `CloudHeaderIdentity`: title/status and compact profile placement.
- `CloudShareDialog`: view-only link creation, display, copy feedback, and errors.
- `resolveViewportInsertionSize`: pure zoom-aware media sizing.
- `SmartShapeDefinition`: typed metadata, parameters, bounds, preview, and point generator.
- `SmartShapeRegistry`: catalog lookup and category metadata.
- `SmartShapeHandles`: rendering, hit-testing, and drag interaction.
- `SmartShapeProperties`: accessible parameter controls for the selected shape.

The existing `CloudStatus`, `CloudAccount`, Image Studio, Excalidraw selection renderer, and pointer interaction code will be adapted around these boundaries instead of accumulating unrelated conditionals in one component.

## Persistence and Compatibility

- Diagram persistence remains the current Convex scene JSON.
- Smart Shape metadata travels inside each element's existing `customData`.
- Share links remain the current Convex view-only links.
- Pasted and uploaded binary images remain in R2.
- Image Studio provider secrets and APIs are unchanged.
- No Convex schema migration is required.
- Existing diagrams and ordinary shapes remain unchanged.

If metadata is missing or invalid, the element behaves as an ordinary polygon. Unknown Smart Shape versions are preserved but do not display adjustment handles.

## Error Handling

- Share creation failures stay inside the dialog and leave it retryable.
- Clipboard failures display the URL and instruct the user to copy manually.
- Media sizing falls back to current intrinsic sizing if dimensions are unavailable.
- Invalid Smart Shape parameters are clamped during restore and editing.
- A failed Smart Shape lookup inserts nothing and reports an Image Studio error instead of creating malformed geometry.

## Testing

### Header and sharing

- Title editing remains functional after moving left.
- Only the avatar initial appears in the closed profile trigger.
- The full name and Sign out action remain in the profile menu.
- The separate cloud Share and Excalidraw+ header controls are absent.
- The purple Share control opens the cloud sharing dialog.
- Link creation, copy success, clipboard failure, and backend failure states are covered.

### Viewport-aware insertion

- The pure sizing helper is tested at 25%, 100%, and 200% zoom.
- Aspect ratio and the 55% viewport cap are tested.
- Sidebar viewport offsets affect centering and maximum size.
- Image Studio insertion produces one selected image and one undo step.
- Normal paste and drag-and-drop retain existing behavior.

### Smart Shapes

- Every generator produces finite, normalized, closed points.
- Parameter bounds prevent self-intersection and negative dimensions.
- Arrow shaft and head adjustments change only their intended geometry.
- Adjustment handles work after zoom and rotation.
- Dragging is captured as one undo step.
- Metadata survives save/restore, duplication, and shared-diagram loading.
- Unknown or invalid metadata degrades to an ordinary polygon.
- Favorites and Recent restore Smart Shape catalog items correctly.

The affected component tests, element interaction tests, typecheck, formatting, production build, and a live smoke test will run before deployment.

## Delivery Order

1. Header placement and compact Share dialog.
2. Zoom-aware Image Studio sizing.
3. Smart Shape registry and initial generators.
4. Smart Shape properties controls.
5. On-canvas adjustment handles.
6. Catalog integration, persistence verification, and production deployment.

Each stage will be committed independently so regressions can be isolated.

## Acceptance Criteria

- The desktop header matches the approved compact arrangement.
- The purple Share button is the only header sharing entry point and opens the view-only sharing dialog.
- Image Studio visuals arrive at a consistent useful on-screen size across zoom levels.
- The initial Smart Shapes can be inserted, recolored, resized, rotated, saved, shared, favorited, and reopened.
- Filled-arrow shaft thickness and arrowhead length can be changed independently using both on-canvas handles and properties controls.
- Existing diagrams, ordinary shapes, image persistence, and view-only links continue to work.
