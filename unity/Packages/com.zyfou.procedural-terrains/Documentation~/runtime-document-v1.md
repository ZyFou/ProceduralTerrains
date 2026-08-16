# Runtime terrain document v1

`.ptrterrain` files contain UTF-8 JSON. Schema v1 represents one or more
square, baked studio heightfield tiles. Paths are relative to the document and
must use forward slashes without absolute roots, URI schemes, `.` segments, or
`..` segments.

## Coordinates

- Units are meters.
- X maps to Unity X, height maps to Unity Y, and Z maps to Unity Z.
- Tile coordinates identify center pivots: `(cx * size, cz * size)`.
- RAW row zero is the tile's negative-Z edge; column zero is its negative-X
  edge.

## Heightfields

Every tile has one square, inclusive vertex grid with a resolution of 513,
1025, 2049, or 4097. Samples are normalized unsigned 16-bit little-endian
values. Convert a sample to meters with:

```text
height = minHeight + (sample / 65535) * (maxHeight - minHeight)
```

The first and last samples lie exactly on the tile bounds, so neighboring
tiles contain identical samples along a shared edge.

## Compatibility

- `format` is always `procedural-terrains`.
- `schemaVersion` is `1`; newer versions fail explicitly.
- Unknown fields within schema v1 are ignored.
- `generation` is optional and baked artifacts remain authoritative.
- `features` and `unsupportedFeatures` describe authored data that this alpha
  importer records but does not instantiate.
