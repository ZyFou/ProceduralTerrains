# Terrain surface materials

The local pack contains 22 CC0 source textures and nine derived recipes. The prepared 512, 1024 and 2048 pixel maps, mipmaps, height sources, thumbnails, catalog and [attribution](../public/textures/terrain/pbr/ATTRIBUTION.md) live in `public/textures/terrain/pbr`. Builds copy this directory into the web output and the Electron resources. Runtime rendering does not contact Poly Haven or ambientCG.

Run `npm run materials:fetch` to download or resume the official sources into `.cache/materials`. Run `npm run materials:build` to regenerate the prepared pack, and `npm run materials:verify` to check files, hashes and the recipe manifest. `npm run build` verifies the source pack and the web output. `npm run desktop:package` builds the web output and packages it for Windows.

In the editor, select **Local PBR Library**, then choose a preset or assign individual roles. The raw source textures remain available. **Pale dune sand** and **Bright powder snow** are named adaptations of the brown sand and gray snow scans; their albedo multipliers appear in the catalog and credits. The sand and snow biome defaults use these recipes. The palette control applies to the historical custom atlas and is hidden for the PBR library.

The Surface Textures **Scale** control ranges from 0.1× to 5×. It multiplies texture repeat frequency. Material selection follows broad climate, height, shoreline and slope signals; fine procedural color noise does not choose materials. Custom Materials now default to **Original Texture Colors**, including existing projects that lack the new setting. Turn it off only when palette recoloring is wanted. The Local PBR Library always uses the source albedo.

The PBR renderer uses world anchored triplanar coordinates. Detail sampling changes continuously to a fixed macro scale as its projected pixel footprint grows. Explicit texture gradients are taken before material and paint branches. Role blending uses symmetric weights, so switching the dominant role on a slope does not create a color jump. The source height, roughness, normal and AO maps share each patch transform. The imported snow AO is deliberately softened for terrain rendering, and scanned roughness controls the remaining specular response.

Snow now blends continuously over the selected ground materials using its altitude and slope coverage. It does not enter the top-two ground-material ranking, which previously made snow appear abruptly when its weight overtook another material. The same transition applies to the custom texture atlas and the local PBR library; manual snow paint retains its authored coverage.

The three PBR node examples are **PBR Alpine**, **PBR Canyon** and **PBR Jungle / Marsh**. Personal imports persist in IndexedDB and travel in portable `.ptrterrain` exports. Cloud sync refuses projects with local texture dependencies.

For validation, run `node tools/surface-appearance-check.mjs` against a local Vite server on port 6064 to render snow, sand and a sloped rock sample. Run `node tools/surface-browser-check.mjs --quick` to compile the real terrain shader, or omit `--quick` to compile terrain, paint, planet and baking. Results are written under `output/surface-qa`. The automated browser checks use Edge/ANGLE on Windows; Safari and mobile WebGL 2 have not been tested here.
