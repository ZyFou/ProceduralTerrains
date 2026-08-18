using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using Object = UnityEngine.Object;

namespace Zyfou.ProceduralTerrains.Editor
{
    internal sealed class TerrainGenerationBuildResult
    {
        internal GameObject Root { get; }
        internal TerrainGenerationRecipe Recipe { get; }
        internal IReadOnlyList<Terrain> Terrains { get; }
        internal IReadOnlyList<string> CreatedAssetPaths { get; }

        internal TerrainGenerationBuildResult(
            GameObject root,
            TerrainGenerationRecipe recipe,
            IReadOnlyList<Terrain> terrains,
            IReadOnlyList<string> createdAssetPaths)
        {
            Root = root;
            Recipe = recipe;
            Terrains = terrains;
            CreatedAssetPaths = createdAssetPaths;
        }
    }

    internal static class TerrainGenerationSceneBuilder
    {
        internal static TerrainGenerationBuildResult Build(
            TerrainGenerationSettings settings,
            GeneratedTerrainRoot existingRoot = null,
            Func<float, bool> cancel = null)
        {
            TerrainGenerator.Validate(settings);
            var generated = TerrainGenerator.Generate(settings, cancel);
            var createdAssets = new List<string>();
            var oldAssetsToDelete = new HashSet<string>();
            var originalTerrainData = new Dictionary<Terrain, TerrainData>();
            var createdTileObjects = new List<GameObject>();
            Dictionary<GeneratedTerrainTile, (string Name, Vector3 LocalPosition)> originalTileStates = null;
            var createdRoot = existingRoot == null;
            var rootObject = existingRoot != null ? existingRoot.gameObject : null;
            var recipe = existingRoot != null ? existingRoot.Recipe : null;
            var originalRecipeSettings = recipe != null ? recipe.Settings.Clone() : null;
            var originalRootName = rootObject != null ? rootObject.name : null;
            var originalRootPosition = rootObject != null ? rootObject.transform.position : Vector3.zero;
            var folder = recipe != null ? Path.GetDirectoryName(AssetDatabase.GetAssetPath(recipe))?.Replace('\\', '/') : null;
            var createdFolder = false;

            if (string.IsNullOrEmpty(folder))
            {
                folder = CreateUniqueAssetFolder("Assets/ProceduralTerrains/Generated", SafeName(settings.ProjectName));
                createdFolder = true;
            }

            try
            {
                if (recipe == null)
                {
                    recipe = ScriptableObject.CreateInstance<TerrainGenerationRecipe>();
                    recipe.name = $"{SafeName(settings.ProjectName)} Recipe";
                    var recipePath = AssetDatabase.GenerateUniqueAssetPath($"{folder}/{SafeName(settings.ProjectName)}_Recipe.asset");
                    AssetDatabase.CreateAsset(recipe, recipePath);
                    createdAssets.Add(recipePath);
                }

                if (rootObject == null)
                {
                    rootObject = new GameObject($"Procedural Terrain - {settings.ProjectName}");
                    Undo.RegisterCreatedObjectUndo(rootObject, "Generate Procedural Terrain");
                    existingRoot = rootObject.AddComponent<GeneratedTerrainRoot>();
                }
                Undo.RecordObject(rootObject.transform, "Position Procedural Terrain");
                rootObject.name = $"Procedural Terrain - {settings.ProjectName}";
                rootObject.transform.position = ResolvePlacement(settings.Placement);
                existingRoot.Initialize(recipe);
                EditorUtility.SetDirty(existingRoot);

                var existingTiles = rootObject.GetComponentsInChildren<GeneratedTerrainTile>(true)
                    .ToDictionary(tile => CoordinateKey(tile.TileX, tile.TileZ), tile => tile);
                originalTileStates = existingTiles.Values.ToDictionary(
                    tile => tile,
                    tile => (Name: tile.name, LocalPosition: tile.transform.localPosition));
                var terrains = new List<Terrain>();
                var terrainByCoordinate = new Dictionary<string, Terrain>();
                var tileWidth = settings.Width / settings.TilesX;
                var tileDepth = settings.Depth / settings.TilesZ;
                for (var tileZ = 0; tileZ < settings.TilesZ; tileZ++)
                {
                    for (var tileX = 0; tileX < settings.TilesX; tileX++)
                    {
                        var key = CoordinateKey(tileX, tileZ);
                        existingTiles.TryGetValue(key, out var tileMarker);
                        existingTiles.Remove(key);
                        var tileStem = $"Generated_Terrain_{tileX}_{tileZ}";
                        var terrainData = CreateTerrainData(generated, settings, tileX, tileZ, tileWidth, tileDepth);
                        var dataPath = AssetDatabase.GenerateUniqueAssetPath($"{folder}/{tileStem}.asset");
                        AssetDatabase.CreateAsset(terrainData, dataPath);
                        createdAssets.Add(dataPath);

                        if (settings.CreatePreviewMaterial)
                        {
                            var previewTexture = CreatePreviewTexture(generated, settings, tileX, tileZ);
                            var texturePath = AssetDatabase.GenerateUniqueAssetPath($"{folder}/{tileStem}_Preview.asset");
                            AssetDatabase.CreateAsset(previewTexture, texturePath);
                            createdAssets.Add(texturePath);
                            var layer = new TerrainLayer
                            {
                                name = $"{tileStem}_Preview",
                                diffuseTexture = previewTexture,
                                metallic = 0f,
                                smoothness = .18f,
                                tileSize = new Vector2(tileWidth, tileDepth),
                            };
                            var layerPath = AssetDatabase.GenerateUniqueAssetPath($"{folder}/{tileStem}_Preview.terrainlayer");
                            AssetDatabase.CreateAsset(layer, layerPath);
                            createdAssets.Add(layerPath);
                            terrainData.terrainLayers = new[] { layer };
                        }

                        Terrain terrain;
                        if (tileMarker == null)
                        {
                            var tileObject = Terrain.CreateTerrainGameObject(terrainData);
                            Undo.RegisterCreatedObjectUndo(tileObject, "Generate Procedural Terrain Tile");
                            tileObject.transform.SetParent(rootObject.transform, false);
                            createdTileObjects.Add(tileObject);
                            tileMarker = tileObject.AddComponent<GeneratedTerrainTile>();
                            terrain = tileObject.GetComponent<Terrain>();
                        }
                        else
                        {
                            terrain = tileMarker.GetComponent<Terrain>();
                            if (terrain == null) throw new InvalidOperationException($"Generated tile {tileMarker.name} has no Terrain component.");
                            originalTerrainData[terrain] = terrain.terrainData;
                            CollectTerrainAssets(terrain.terrainData, folder, oldAssetsToDelete);
                            Undo.RecordObject(terrain, "Regenerate Procedural Terrain Tile");
                            terrain.terrainData = terrainData;
                            var collider = tileMarker.GetComponent<TerrainCollider>();
                            if (collider != null)
                            {
                                Undo.RecordObject(collider, "Regenerate Procedural Terrain Collider");
                                collider.terrainData = terrainData;
                            }
                        }
                        tileMarker.name = tileStem;
                        tileMarker.Initialize(tileX, tileZ);
                        EditorUtility.SetDirty(tileMarker);
                        tileMarker.transform.localPosition = new Vector3(
                            -settings.Width * .5f + tileX * tileWidth,
                            0f,
                            settings.Depth * .5f - (tileZ + 1) * tileDepth);
                        tileMarker.transform.localRotation = Quaternion.identity;
                        tileMarker.transform.localScale = Vector3.one;
                        terrain.drawInstanced = true;
                        terrain.allowAutoConnect = false;
                        terrain.Flush();
                        terrains.Add(terrain);
                        terrainByCoordinate[key] = terrain;
                    }
                }

                foreach (var stale in existingTiles.Values)
                    if (stale.TryGetComponent<Terrain>(out var staleTerrain))
                        CollectTerrainAssets(staleTerrain.terrainData, folder, oldAssetsToDelete);

                foreach (var pair in terrainByCoordinate)
                {
                    var marker = pair.Value.GetComponent<GeneratedTerrainTile>();
                    pair.Value.SetNeighbors(
                        Find(terrainByCoordinate, marker.TileX - 1, marker.TileZ),
                        Find(terrainByCoordinate, marker.TileX, marker.TileZ - 1),
                        Find(terrainByCoordinate, marker.TileX + 1, marker.TileZ),
                        Find(terrainByCoordinate, marker.TileX, marker.TileZ + 1));
                }

                recipe.Initialize(settings);
                EditorUtility.SetDirty(recipe);
                AssetDatabase.SaveAssets();
                foreach (var stale in existingTiles.Values) Undo.DestroyObjectImmediate(stale.gameObject);
                foreach (var oldPath in oldAssetsToDelete)
                {
                    if (!createdAssets.Contains(oldPath)) AssetDatabase.DeleteAsset(oldPath);
                }
                EditorSceneManager.MarkSceneDirty(SceneManager.GetActiveScene());
                Selection.activeGameObject = rootObject;
                SceneView.lastActiveSceneView?.FrameSelected();
                return new TerrainGenerationBuildResult(rootObject, recipe, terrains, createdAssets);
            }
            catch
            {
                if (createdRoot && rootObject != null) Object.DestroyImmediate(rootObject);
                else
                {
                    foreach (var pair in originalTerrainData)
                    {
                        if (pair.Key == null) continue;
                        pair.Key.terrainData = pair.Value;
                        var collider = pair.Key.GetComponent<TerrainCollider>();
                        if (collider != null) collider.terrainData = pair.Value;
                    }
                    foreach (var tileObject in createdTileObjects)
                        if (tileObject != null) Object.DestroyImmediate(tileObject);
                    if (rootObject != null)
                    {
                        rootObject.name = originalRootName;
                        rootObject.transform.position = originalRootPosition;
                    }
                    if (originalTileStates != null)
                    {
                        foreach (var pair in originalTileStates)
                        {
                            if (pair.Key == null) continue;
                            pair.Key.name = pair.Value.Name;
                            pair.Key.transform.localPosition = pair.Value.LocalPosition;
                        }
                    }
                    if (recipe != null && originalRecipeSettings != null)
                    {
                        recipe.Initialize(originalRecipeSettings);
                        EditorUtility.SetDirty(recipe);
                    }
                }
                foreach (var path in createdAssets.AsEnumerable().Reverse()) AssetDatabase.DeleteAsset(path);
                if (createdFolder && AssetDatabase.IsValidFolder(folder)) AssetDatabase.DeleteAsset(folder);
                throw;
            }
        }

        internal static GeneratedTerrainRoot FindGeneratedRoot(GameObject selected)
        {
            if (selected == null) return null;
            return selected.GetComponentInParent<GeneratedTerrainRoot>();
        }

        private static TerrainData CreateTerrainData(
            GeneratedHeightfield source,
            TerrainGenerationSettings settings,
            int tileX,
            int tileZ,
            float tileWidth,
            float tileDepth)
        {
            var resolution = settings.Resolution;
            var heights = new float[resolution, resolution];
            var x0 = tileX * (resolution - 1);
            var z0 = tileZ * (resolution - 1);
            for (var unityZ = 0; unityZ < resolution; unityZ++)
            {
                var sourceZ = z0 + resolution - 1 - unityZ;
                for (var x = 0; x < resolution; x++)
                    heights[unityZ, x] = source.Get(x0 + x, sourceZ) / source.MaximumHeight;
            }
            var data = new TerrainData
            {
                name = $"Generated_Terrain_{tileX}_{tileZ}",
                heightmapResolution = resolution,
                size = new Vector3(tileWidth, source.MaximumHeight, tileDepth),
            };
            data.SetHeights(0, 0, heights);
            return data;
        }

        private static Texture2D CreatePreviewTexture(
            GeneratedHeightfield source,
            TerrainGenerationSettings settings,
            int tileX,
            int tileZ)
        {
            var resolution = settings.Resolution;
            var texture = new Texture2D(resolution, resolution, TextureFormat.RGB24, true, false)
            {
                name = $"Generated_Terrain_{tileX}_{tileZ}_Preview",
                wrapMode = TextureWrapMode.Clamp,
                filterMode = FilterMode.Bilinear,
            };
            var pixels = new Color[resolution * resolution];
            var x0 = tileX * (resolution - 1);
            var z0 = tileZ * (resolution - 1);
            var dx = settings.Width / Mathf.Max(source.Columns - 1, 1);
            var dz = settings.Depth / Mathf.Max(source.Rows - 1, 1);
            for (var unityZ = 0; unityZ < resolution; unityZ++)
            {
                var sourceZ = z0 + resolution - 1 - unityZ;
                for (var x = 0; x < resolution; x++)
                {
                    var sourceX = x0 + x;
                    var height = source.Get(sourceX, sourceZ);
                    var left = source.Get(Mathf.Max(0, sourceX - 1), sourceZ);
                    var right = source.Get(Mathf.Min(source.Columns - 1, sourceX + 1), sourceZ);
                    var down = source.Get(sourceX, Mathf.Max(0, sourceZ - 1));
                    var up = source.Get(sourceX, Mathf.Min(source.Rows - 1, sourceZ + 1));
                    var sx = (right - left) / (2f * dx);
                    var sz = (up - down) / (2f * dz);
                    var normalUp = 1f / Mathf.Sqrt(1f + sx * sx + sz * sz);
                    var shade = Mathf.Lerp(.45f, 1f, Mathf.InverseLerp(.25f, .75f, normalUp));
                    var color = PreviewColor(height / Mathf.Max(settings.Height, .0001f));
                    pixels[unityZ * resolution + x] = color * shade;
                }
            }
            texture.SetPixels(pixels);
            texture.Apply(true, false);
            return texture;
        }

        private static Color PreviewColor(float height)
        {
            var positions = new[] { .05f, .22f, .50f, .75f, .94f };
            var colors = new[]
            {
                new Color(.05f, .09f, .025f), new Color(.16f, .30f, .055f),
                new Color(.26f, .20f, .10f), new Color(.34f, .34f, .32f),
                new Color(.90f, .92f, .94f),
            };
            if (height <= positions[0]) return colors[0];
            for (var i = 1; i < positions.Length; i++)
            {
                if (height <= positions[i])
                    return Color.Lerp(colors[i - 1], colors[i], Mathf.InverseLerp(positions[i - 1], positions[i], height));
            }
            return colors[colors.Length - 1];
        }

        private static void CollectTerrainAssets(TerrainData data, string folder, ISet<string> paths)
        {
            if (data == null) return;
            AddIfGenerated(AssetDatabase.GetAssetPath(data), folder, paths);
            foreach (var layer in data.terrainLayers ?? Array.Empty<TerrainLayer>())
            {
                if (layer == null) continue;
                AddIfGenerated(AssetDatabase.GetAssetPath(layer.diffuseTexture), folder, paths);
                AddIfGenerated(AssetDatabase.GetAssetPath(layer), folder, paths);
            }
        }

        private static void AddIfGenerated(string path, string folder, ISet<string> paths)
        {
            if (!string.IsNullOrEmpty(path) && path.StartsWith(folder + "/", StringComparison.Ordinal)) paths.Add(path);
        }

        private static Vector3 ResolvePlacement(TerrainGenerationPlacement placement)
        {
            return placement == TerrainGenerationPlacement.SceneViewPivot && SceneView.lastActiveSceneView != null
                ? SceneView.lastActiveSceneView.pivot
                : Vector3.zero;
        }

        private static string SafeName(string value)
        {
            var invalid = Path.GetInvalidFileNameChars();
            var cleaned = new string((value ?? "Terrain").Select(character => invalid.Contains(character) ? '_' : character).ToArray()).Trim();
            return string.IsNullOrEmpty(cleaned) ? "Terrain" : cleaned;
        }

        private static string CreateUniqueAssetFolder(string root, string name)
        {
            EnsureFolder(root);
            var path = AssetDatabase.GenerateUniqueAssetPath($"{root}/{name}");
            AssetDatabase.CreateFolder(root, Path.GetFileName(path));
            return path;
        }

        private static void EnsureFolder(string path)
        {
            var parts = path.Split('/');
            var current = parts[0];
            for (var index = 1; index < parts.Length; index++)
            {
                var next = $"{current}/{parts[index]}";
                if (!AssetDatabase.IsValidFolder(next)) AssetDatabase.CreateFolder(current, parts[index]);
                current = next;
            }
        }

        private static Terrain Find(IReadOnlyDictionary<string, Terrain> terrains, int x, int z)
        {
            terrains.TryGetValue(CoordinateKey(x, z), out var terrain);
            return terrain;
        }

        private static string CoordinateKey(int x, int z) => $"{x},{z}";
    }
}
