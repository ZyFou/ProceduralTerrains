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
    internal sealed class TerrainSceneBuildOptions
    {
        internal bool CreateBakedMaterials { get; set; } = true;
        internal bool CreateTerrainLayers { get; set; } = true;
        internal bool ConnectNeighbors { get; set; } = true;
    }

    internal sealed class TerrainSceneBuildResult
    {
        internal GameObject Root { get; }
        internal IReadOnlyList<Terrain> Terrains { get; }
        internal IReadOnlyList<string> CreatedAssetPaths { get; }
        internal IReadOnlyList<string> Warnings { get; }

        internal TerrainSceneBuildResult(
            GameObject root,
            IReadOnlyList<Terrain> terrains,
            IReadOnlyList<string> createdAssetPaths,
            IReadOnlyList<string> warnings)
        {
            Root = root;
            Terrains = terrains;
            CreatedAssetPaths = createdAssetPaths;
            Warnings = warnings;
        }
    }

    internal static class TerrainSceneBuilder
    {
        internal static TerrainSceneBuildResult Build(
            TerrainProjectAsset project,
            TerrainSceneBuildOptions options = null)
        {
            if (project == null) throw new ArgumentNullException(nameof(project));
            if (project.Tiles == null || project.Tiles.Count == 0)
            {
                throw new InvalidOperationException("The imported project contains no terrain tiles.");
            }

            options ??= new TerrainSceneBuildOptions();
            var projectAssetPath = AssetDatabase.GetAssetPath(project);
            if (string.IsNullOrEmpty(projectAssetPath) || !projectAssetPath.StartsWith("Assets/", StringComparison.Ordinal))
            {
                throw new InvalidOperationException("TerrainProjectAsset must be stored below the project's Assets folder.");
            }

            ValidateHeightfieldFiles(project);
            var projectFolder = Path.GetDirectoryName(projectAssetPath)?.Replace('\\', '/') ?? "Assets";
            var generatedFolder = CreateUniqueAssetFolder(projectFolder, $"Generated_{project.name}");
            var createdAssets = new List<string>();
            var warnings = new List<string>();
            var terrains = new List<Terrain>();
            var terrainByCoordinate = new Dictionary<string, Terrain>();
            var root = new GameObject($"Procedural Terrain - {project.name}");
            Undo.RegisterCreatedObjectUndo(root, "Create Procedural Terrains");

            try
            {
                foreach (var tile in project.Tiles)
                {
                    var terrainData = CreateTerrainData(tile);
                    var tileStem = $"Terrain_{tile.Cx}_{tile.Cz}";
                    var terrainDataPath = AssetDatabase.GenerateUniqueAssetPath(
                        $"{generatedFolder}/{tileStem}.asset");
                    AssetDatabase.CreateAsset(terrainData, terrainDataPath);
                    createdAssets.Add(terrainDataPath);

                    TerrainLayer layer = null;
                    Material material = null;
                    if (options.CreateTerrainLayers || options.CreateBakedMaterials)
                    {
                        var textures = LoadBakedTextures(tile, warnings);
                        if (textures.Color != null)
                        {
                            if (options.CreateTerrainLayers)
                            {
                                layer = CreateTerrainLayer(tile, textures.Color, textures.Normal);
                                var layerPath = AssetDatabase.GenerateUniqueAssetPath(
                                    $"{generatedFolder}/{tileStem}_Baked.terrainlayer");
                                AssetDatabase.CreateAsset(layer, layerPath);
                                createdAssets.Add(layerPath);
                                terrainData.terrainLayers = new[] { layer };
                            }
                            if (options.CreateBakedMaterials)
                            {
                                material = CreateTerrainMaterial(tileStem);
                                if (material != null)
                                {
                                    var materialPath = AssetDatabase.GenerateUniqueAssetPath(
                                        $"{generatedFolder}/{tileStem}_Baked.mat");
                                    AssetDatabase.CreateAsset(material, materialPath);
                                    createdAssets.Add(materialPath);
                                }
                                else
                                {
                                    warnings.Add($"Tile ({tile.Cx}, {tile.Cz}): no compatible Terrain Lit shader was found; Unity's default Terrain material will render the TerrainLayer.");
                                }
                            }
                        }
                        else
                        {
                            warnings.Add($"Tile ({tile.Cx}, {tile.Cz}): textures/terrain_color.png is missing; created geometry without a baked surface.");
                        }
                    }

                    EditorUtility.SetDirty(terrainData);
                    var terrainObject = Terrain.CreateTerrainGameObject(terrainData);
                    Undo.RegisterCreatedObjectUndo(terrainObject, "Create Procedural Terrain Tile");
                    terrainObject.name = tileStem;
                    terrainObject.transform.SetParent(root.transform, false);
                    terrainObject.transform.position = new Vector3(
                        tile.CenterX - tile.Size * 0.5f,
                        tile.Heightfield.MinHeight,
                        tile.CenterZ - tile.Size * 0.5f);
                    var terrain = terrainObject.GetComponent<Terrain>();
                    terrain.drawInstanced = true;
                    terrain.allowAutoConnect = false;
                    if (material != null) terrain.materialTemplate = material;
                    terrain.Flush();
                    terrains.Add(terrain);
                    terrainByCoordinate.Add(CoordinateKey(tile.Cx, tile.Cz), terrain);
                }

                if (options.ConnectNeighbors)
                {
                    foreach (var tile in project.Tiles)
                    {
                        var terrain = terrainByCoordinate[CoordinateKey(tile.Cx, tile.Cz)];
                        terrain.SetNeighbors(
                            FindTerrain(terrainByCoordinate, tile.Cx - 1, tile.Cz),
                            FindTerrain(terrainByCoordinate, tile.Cx, tile.Cz + 1),
                            FindTerrain(terrainByCoordinate, tile.Cx + 1, tile.Cz),
                            FindTerrain(terrainByCoordinate, tile.Cx, tile.Cz - 1));
                    }
                }

                AssetDatabase.SaveAssets();
                EditorSceneManager.MarkSceneDirty(SceneManager.GetActiveScene());
                Selection.activeGameObject = root;
                if (SceneView.lastActiveSceneView != null) SceneView.lastActiveSceneView.FrameSelected();
                return new TerrainSceneBuildResult(root, terrains, createdAssets, warnings);
            }
            catch
            {
                if (root != null) Object.DestroyImmediate(root);
                foreach (var assetPath in createdAssets.AsEnumerable().Reverse())
                {
                    AssetDatabase.DeleteAsset(assetPath);
                }
                if (AssetDatabase.IsValidFolder(generatedFolder)) AssetDatabase.DeleteAsset(generatedFolder);
                throw;
            }
        }

        internal static float[,] DecodeRawHeightfield(string assetPath, int resolution)
        {
            var fullPath = TerrainZipImportService.AssetPathToFullPath(assetPath);
            var bytes = File.ReadAllBytes(fullPath);
            var expectedBytes = checked(resolution * resolution * 2);
            if (bytes.Length != expectedBytes)
            {
                throw new InvalidDataException(
                    $"RAW heightfield {assetPath} is {bytes.Length} bytes; expected {expectedBytes}.");
            }

            var heights = new float[resolution, resolution];
            for (var z = 0; z < resolution; z++)
            {
                for (var x = 0; x < resolution; x++)
                {
                    var offset = (z * resolution + x) * 2;
                    var sample = bytes[offset] | bytes[offset + 1] << 8;
                    heights[z, x] = sample / 65535f;
                }
            }
            return heights;
        }

        private static TerrainData CreateTerrainData(TerrainTileDescriptor tile)
        {
            var heightfield = tile.Heightfield;
            var terrainData = new TerrainData
            {
                name = $"Terrain_{tile.Cx}_{tile.Cz}",
                heightmapResolution = heightfield.Resolution,
                size = new Vector3(
                    tile.Size,
                    heightfield.MaxHeight - heightfield.MinHeight,
                    tile.Size),
            };
            terrainData.SetHeights(0, 0, DecodeRawHeightfield(
                heightfield.AssetPath,
                heightfield.Resolution));
            return terrainData;
        }

        private static void ValidateHeightfieldFiles(TerrainProjectAsset project)
        {
            foreach (var tile in project.Tiles)
            {
                if (tile?.Heightfield == null || string.IsNullOrEmpty(tile.Heightfield.AssetPath))
                {
                    throw new InvalidDataException($"Tile ({tile?.Cx}, {tile?.Cz}) has no heightfield path.");
                }
                var fullPath = TerrainZipImportService.AssetPathToFullPath(tile.Heightfield.AssetPath);
                if (!File.Exists(fullPath))
                {
                    throw new FileNotFoundException(
                        $"Tile ({tile.Cx}, {tile.Cz}) heightfield is missing.",
                        fullPath);
                }
            }
        }

        private static (Texture2D Color, Texture2D Normal) LoadBakedTextures(
            TerrainTileDescriptor tile,
            ICollection<string> warnings)
        {
            var tileFolder = Path.GetDirectoryName(tile.Heightfield.AssetPath)?.Replace('\\', '/');
            if (string.IsNullOrEmpty(tileFolder)) return (null, null);
            var colorPath = $"{tileFolder}/textures/terrain_color.png";
            var normalPath = $"{tileFolder}/textures/terrain_normal.png";
            ConfigureTexture(colorPath, false);
            ConfigureTexture(normalPath, true);
            var color = AssetDatabase.LoadAssetAtPath<Texture2D>(colorPath);
            var normal = AssetDatabase.LoadAssetAtPath<Texture2D>(normalPath);
            if (color != null && normal == null)
            {
                warnings.Add($"Tile ({tile.Cx}, {tile.Cz}): terrain_normal.png is missing; Unity will use heightfield normals.");
            }
            return (color, normal);
        }

        private static void ConfigureTexture(string assetPath, bool normalMap)
        {
            if (!File.Exists(TerrainZipImportService.AssetPathToFullPath(assetPath))) return;
            if (!(AssetImporter.GetAtPath(assetPath) is TextureImporter importer)) return;
            var changed = importer.wrapMode != TextureWrapMode.Clamp
                || importer.mipmapEnabled == false
                || importer.textureType != (normalMap ? TextureImporterType.NormalMap : TextureImporterType.Default)
                || importer.sRGBTexture == normalMap;
            if (!changed) return;
            importer.wrapMode = TextureWrapMode.Clamp;
            importer.mipmapEnabled = true;
            importer.textureType = normalMap ? TextureImporterType.NormalMap : TextureImporterType.Default;
            importer.sRGBTexture = !normalMap;
            importer.SaveAndReimport();
        }

        private static TerrainLayer CreateTerrainLayer(
            TerrainTileDescriptor tile,
            Texture2D color,
            Texture2D normal)
        {
            return new TerrainLayer
            {
                name = $"Terrain_{tile.Cx}_{tile.Cz}_Baked",
                diffuseTexture = color,
                normalMapTexture = normal,
                normalScale = 1f,
                metallic = 0f,
                smoothness = 0.2f,
                tileSize = new Vector2(tile.Size, tile.Size),
                tileOffset = Vector2.zero,
            };
        }

        private static Material CreateTerrainMaterial(string name)
        {
            var shader = FindTerrainShader();
            if (shader == null) return null;
            return new Material(shader)
            {
                name = $"{name}_Terrain",
                enableInstancing = true,
            };
        }

        private static Shader FindTerrainShader()
        {
            var renderPipelineName = UnityEngine.Rendering.GraphicsSettings.currentRenderPipeline?.GetType().Name ?? string.Empty;
            var preferred = renderPipelineName.IndexOf("HDRenderPipeline", StringComparison.OrdinalIgnoreCase) >= 0
                ? new[] { "HDRP/TerrainLit", "Universal Render Pipeline/Terrain/Lit", "Nature/Terrain/Standard" }
                : renderPipelineName.IndexOf("Universal", StringComparison.OrdinalIgnoreCase) >= 0
                    ? new[] { "Universal Render Pipeline/Terrain/Lit", "HDRP/TerrainLit", "Nature/Terrain/Standard" }
                    : new[] { "Nature/Terrain/Standard", "Universal Render Pipeline/Terrain/Lit", "HDRP/TerrainLit" };
            return preferred.Select(Shader.Find).FirstOrDefault(shader => shader != null);
        }

        private static string CreateUniqueAssetFolder(string parent, string name)
        {
            var path = AssetDatabase.GenerateUniqueAssetPath($"{parent}/{name}");
            var parentPath = Path.GetDirectoryName(path)?.Replace('\\', '/') ?? parent;
            var folderName = Path.GetFileName(path);
            AssetDatabase.CreateFolder(parentPath, folderName);
            return path;
        }

        private static string CoordinateKey(int cx, int cz) => $"{cx},{cz}";

        private static Terrain FindTerrain(IReadOnlyDictionary<string, Terrain> terrains, int cx, int cz)
        {
            terrains.TryGetValue(CoordinateKey(cx, cz), out var terrain);
            return terrain;
        }
    }
}
