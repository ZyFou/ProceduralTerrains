using System.Linq;
using UnityEditor;
using UnityEngine;

namespace Zyfou.ProceduralTerrains.Editor
{
    [CustomEditor(typeof(TerrainProjectAsset))]
    internal sealed class TerrainProjectAssetInspector : UnityEditor.Editor
    {
        public override void OnInspectorGUI()
        {
            var asset = (TerrainProjectAsset)target;
            EditorGUILayout.LabelField("Runtime Document", EditorStyles.boldLabel);
            using (new EditorGUI.DisabledScope(true))
            {
                EditorGUILayout.IntField("Schema Version", asset.SchemaVersion);
                EditorGUILayout.TextField("Producer", $"{asset.ProducerName} {asset.ProducerAppVersion}");
                EditorGUILayout.IntField("Generator Version", asset.GeneratorVersion);
                EditorGUILayout.EnumPopup("Project Mode", asset.ProjectMode);
                EditorGUILayout.EnumPopup("World Type", asset.WorldType);
                EditorGUILayout.IntField("Seed", asset.Seed);
                EditorGUILayout.TextField("Units", asset.Units);
                EditorGUILayout.TextField("Up Axis", asset.UpAxis);
                EditorGUILayout.TextField("X Axis", asset.XAxis);
                EditorGUILayout.TextField("Z Axis", asset.ZAxis);
                EditorGUILayout.TextField("Coordinate Mapping", asset.CoordinateMapping);
                EditorGUILayout.TextField("Tile Pivot", asset.TilePivot);
            }

            EditorGUILayout.Space();
            DrawBounds(asset.Bounds);
            EditorGUILayout.Space();
            DrawTiles(asset);
            EditorGUILayout.Space();
            DrawFeatures(asset.Features);
            EditorGUILayout.Space();
            DrawDiagnostics(asset);
        }

        private static void DrawBounds(TerrainProjectBounds bounds)
        {
            EditorGUILayout.LabelField("Bounds", EditorStyles.boldLabel);
            if (bounds == null)
            {
                EditorGUILayout.HelpBox("Bounds are unavailable.", MessageType.Error);
                return;
            }
            using (new EditorGUI.DisabledScope(true))
            {
                EditorGUILayout.Vector2Field("Minimum XZ", new Vector2(bounds.MinX, bounds.MinZ));
                EditorGUILayout.Vector2Field("Size XZ", new Vector2(bounds.SizeX, bounds.SizeZ));
                EditorGUILayout.Vector2Field("Height Range", new Vector2(bounds.MinHeight, bounds.MaxHeight));
                EditorGUILayout.FloatField("Sea Level", bounds.SeaLevel);
            }
        }

        private static void DrawTiles(TerrainProjectAsset asset)
        {
            EditorGUILayout.LabelField($"Tiles ({asset.Tiles.Count})", EditorStyles.boldLabel);
            foreach (var tile in asset.Tiles)
            {
                using (new EditorGUILayout.VerticalScope(EditorStyles.helpBox))
                {
                    EditorGUILayout.LabelField($"Tile ({tile.Cx}, {tile.Cz})", EditorStyles.boldLabel);
                    using (new EditorGUI.DisabledScope(true))
                    {
                        EditorGUILayout.Vector2Field("Center XZ", new Vector2(tile.CenterX, tile.CenterZ));
                        EditorGUILayout.FloatField("Size", tile.Size);
                        EditorGUILayout.IntField("Height Resolution", tile.Heightfield.Resolution);
                        EditorGUILayout.TextField("Heightfield", tile.Heightfield.RelativePath);
                        EditorGUILayout.ObjectField("Height Asset", tile.Heightfield.SourceAsset, typeof(Object), false);
                        if (tile.HasSplat)
                        {
                            EditorGUILayout.TextField("Splat", tile.SplatRelativePath);
                            EditorGUILayout.ObjectField("Splat Asset", tile.SplatAsset, typeof(Object), false);
                        }
                    }
                }
            }
        }

        private static void DrawFeatures(TerrainFeatureSummary features)
        {
            EditorGUILayout.LabelField("Features", EditorStyles.boldLabel);
            if (features == null)
            {
                EditorGUILayout.HelpBox("Feature summary is unavailable.", MessageType.Error);
                return;
            }
            var enabled = new[]
            {
                ("Heightfield", features.Heightfield),
                ("Splat", features.Splat),
                ("Paint", features.Paint),
                ("Erosion", features.Erosion),
                ("Splines", features.Splines),
                ("Imported maps", features.ImportedMaps),
                ("Surfaces", features.Surfaces),
                ("Water", features.Water),
                ("Props", features.Props),
            }.Where(feature => feature.Item2).Select(feature => feature.Item1);
            EditorGUILayout.LabelField(string.Join(", ", enabled));
        }

        private static void DrawDiagnostics(TerrainProjectAsset asset)
        {
            EditorGUILayout.LabelField($"Diagnostics ({asset.Diagnostics.Count})", EditorStyles.boldLabel);
            if (asset.Diagnostics.Count == 0)
            {
                EditorGUILayout.HelpBox("Document imported without warnings.", MessageType.Info);
                return;
            }
            DrawDiagnosticGroup(asset, TerrainDiagnosticSeverity.Error, "Errors", MessageType.Error);
            DrawDiagnosticGroup(asset, TerrainDiagnosticSeverity.Warning, "Warnings", MessageType.Warning);
            DrawDiagnosticGroup(asset, TerrainDiagnosticSeverity.Info, "Information", MessageType.Info);
        }

        private static void DrawDiagnosticGroup(
            TerrainProjectAsset asset,
            TerrainDiagnosticSeverity severity,
            string label,
            MessageType messageType)
        {
            var diagnostics = asset.Diagnostics.Where(diagnostic => diagnostic.Severity == severity).ToArray();
            if (diagnostics.Length == 0) return;
            EditorGUILayout.LabelField($"{label} ({diagnostics.Length})", EditorStyles.miniBoldLabel);
            foreach (var diagnostic in diagnostics)
            {
                var message = string.IsNullOrEmpty(diagnostic.Path)
                    ? $"[{diagnostic.Code}] {diagnostic.Message}"
                    : $"[{diagnostic.Code}] {diagnostic.Message}\n{diagnostic.Path}";
                EditorGUILayout.HelpBox(message, messageType);
            }
        }
    }
}
