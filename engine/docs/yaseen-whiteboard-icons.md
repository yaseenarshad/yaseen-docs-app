# Yaseen Whiteboard icon exports

`public/favicon.svg` is the canonical editable source for the production icon family. It uses a 512 × 512 view box, `#6965db` background, white geometry, round line caps, and no filters or embedded raster content.

The Board-frame and Y geometry stay inside the central 80% safe zone. Browser favicons retain the source's transparent outer corners. Apple, Android, and maskable exports are composited over `#6965db`, allowing the platform to apply its own circle, squircle, or rounded-rectangle mask without exposing a transparent edge.

Regenerate with the checked-in Sharp/ImageMagick script:

```sh
node scripts/generate-yaseen-icons.mjs
```

The ICO contains 16, 32, and 48 pixel renders from the same SVG. Always inspect the 16 and 32 pixel outputs at 100% scale after regeneration.
