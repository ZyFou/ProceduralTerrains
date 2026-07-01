# Terrain surface textures

Default terrain material packs. Each subfolder is one surface material; `materials.json`
is the manifest the app reads at startup (id, display name, folder, expected map
filenames, default tiling/strength/roughness, biome tags).

Every material has a `base/` folder plus any number of variant folders (`variant_1/`,
`variant_2/`, ...) — created via the **Add Variant** button in Surface > Textures, or
by hand. All folders for a material use the same filenames; only the containing folder
changes. Folders start empty — drop matching image files in and they're picked up
automatically, no code changes needed. Missing maps just fall back (procedural color /
flat normal / no displacement); nothing breaks if a folder is empty.

## Map slots (per material)

| Slot         | Suffix         | Formats               | Notes |
|--------------|----------------|------------------------|-------|
| Diffuse      | `_diffuse`     | jpg / png / webp       | Base color / albedo |
| Displacement | `_displacement`| exr / png / jpg / webp | Height data; EXR preferred for precision |
| Normal DX    | `_normal_dx`   | jpg / png / webp       | DirectX-convention normal map (+Y down) |
| Roughness    | `_roughness`   | jpg / png / webp       | Grayscale roughness |
| AO           | `_ao`          | jpg / png / webp       | Ambient occlusion |

A partial set is fine — e.g. you can drop in only `grass_diffuse.jpg` and keep every
other slot on its default/fallback.

## Folders

- `grass/`, `rock/`, `sand/`, `snow/`, `mud/`, `volcanic/`, `alien/` — one per default
  material. Each contains `base/` (its default look) and, once added, one folder per
  variant.
