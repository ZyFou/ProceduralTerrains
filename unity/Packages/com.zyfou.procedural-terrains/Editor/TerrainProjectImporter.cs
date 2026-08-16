using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.AssetImporters;
using UnityEngine;

namespace Zyfou.ProceduralTerrains.Editor
{
    [ScriptedImporter(1, "ptrterrain", AllowCaching = true)]
    internal sealed class TerrainProjectImporter : ScriptedImporter
    {
        public override void OnImportAsset(AssetImportContext context)
        {
            string json;
            try
            {
                json = File.ReadAllText(context.assetPath);
            }
            catch (Exception exception)
            {
                context.LogImportError($"Unable to read runtime terrain document: {exception.Message}");
                return;
            }

            if (!RuntimeTerrainDocumentParser.TryParse(
                    json,
                    out var document,
                    out var generationJson,
                    out var parseError))
            {
                context.LogImportError(parseError);
                return;
            }

            var diagnostics = RuntimeTerrainDocumentValidator.Validate(document);
            if (RuntimeTerrainDocumentValidator.HasErrors(diagnostics))
            {
                LogDiagnostics(context, diagnostics);
                return;
            }

            var documentDirectory = (Path.GetDirectoryName(context.assetPath) ?? string.Empty).Replace('\\', '/');
            var tiles = new List<TerrainTileDescriptor>(document.tiles.Length);
            foreach (var tile in document.tiles)
            {
                var heightfieldPath = ResolveArtifactPath(documentDirectory, tile.heightfield.path);
                context.DependsOnSourceAsset(heightfieldPath);
                if (!File.Exists(Path.GetFullPath(heightfieldPath)))
                {
                    diagnostics.Add(Error(
                        "artifact.missing",
                        $"Required heightfield does not exist: {tile.heightfield.path}",
                        tile.heightfield.path));
                    continue;
                }

                var expectedBytes = checked((long)tile.heightfield.resolution * tile.heightfield.resolution * 2L);
                var actualBytes = new FileInfo(Path.GetFullPath(heightfieldPath)).Length;
                if (actualBytes != expectedBytes)
                {
                    diagnostics.Add(Error(
                        "heightfield.size",
                        $"Heightfield {tile.heightfield.path} is {actualBytes} bytes; expected {expectedBytes} bytes for a {tile.heightfield.resolution} × {tile.heightfield.resolution} uint16 grid.",
                        tile.heightfield.path));
                    continue;
                }

                var heightfieldAsset = AssetDatabase.LoadAssetAtPath<UnityEngine.Object>(heightfieldPath);
                string splatPath = null;
                UnityEngine.Object splatAsset = null;
                var hasSplat = tile.splat != null && !string.IsNullOrEmpty(tile.splat.path);
                if (hasSplat)
                {
                    splatPath = ResolveArtifactPath(documentDirectory, tile.splat.path);
                    context.DependsOnSourceAsset(splatPath);
                    if (File.Exists(Path.GetFullPath(splatPath)))
                    {
                        splatAsset = AssetDatabase.LoadAssetAtPath<UnityEngine.Object>(splatPath);
                    }
                    else
                    {
                        diagnostics.Add(Warning(
                            "artifact.optionalMissing",
                            $"Optional splat map does not exist: {tile.splat.path}",
                            tile.splat.path));
                    }
                }

                var heightfield = new TerrainHeightfieldDescriptor(
                    tile.heightfield.path,
                    heightfieldPath,
                    tile.heightfield.resolution,
                    (float)tile.heightfield.minHeight,
                    (float)tile.heightfield.maxHeight,
                    heightfieldAsset);
                tiles.Add(new TerrainTileDescriptor(
                    (int)tile.cx,
                    (int)tile.cz,
                    (float)tile.centerX,
                    (float)tile.centerZ,
                    (float)tile.size,
                    heightfield,
                    hasSplat ? tile.splat.path : null,
                    splatPath,
                    hasSplat ? tile.splat.width : 0,
                    hasSplat ? tile.splat.height : 0,
                    splatAsset));
            }

            foreach (var feature in document.unsupportedFeatures ?? Array.Empty<string>())
            {
                diagnostics.Add(Warning(
                    "feature.unsupported",
                    $"Feature ‘{feature}’ is recorded but is not imported by this package version.",
                    "unsupportedFeatures"));
            }

            if (RuntimeTerrainDocumentValidator.HasErrors(diagnostics))
            {
                LogDiagnostics(context, diagnostics);
                return;
            }

            var featuresJson = document.features;
            var features = new TerrainFeatureSummary(
                featuresJson.heightfield,
                featuresJson.splat,
                featuresJson.paint,
                featuresJson.erosion,
                featuresJson.splines,
                featuresJson.importedMaps,
                featuresJson.surfaces,
                featuresJson.water,
                featuresJson.props);
            var boundsJson = document.bounds;
            var bounds = new TerrainProjectBounds(
                (float)boundsJson.minX,
                (float)boundsJson.minZ,
                (float)boundsJson.sizeX,
                (float)boundsJson.sizeZ,
                (float)boundsJson.minHeight,
                (float)boundsJson.maxHeight,
                (float)boundsJson.seaLevel);
            var asset = ScriptableObject.CreateInstance<TerrainProjectAsset>();
            asset.name = Path.GetFileNameWithoutExtension(context.assetPath);
            asset.Initialize(
                document.schemaVersion,
                document.producer.name,
                document.producer.appVersion,
                document.producer.generatorVersion,
                RuntimeTerrainDocumentValidator.ParseProjectMode(document.project.mode),
                TerrainWorldType.Studio,
                (int)document.project.seed,
                document.coordinates.units,
                document.coordinates.upAxis,
                document.coordinates.xAxis,
                document.coordinates.zAxis,
                document.coordinates.unityMapping,
                document.coordinates.tilePivot,
                bounds,
                tiles.ToArray(),
                features,
                document.unsupportedFeatures ?? Array.Empty<string>(),
                generationJson,
                diagnostics.ToArray());

            LogDiagnostics(context, diagnostics);
            context.AddObjectToAsset("TerrainProject", asset);
            context.SetMainObject(asset);
        }

        private static string ResolveArtifactPath(string documentDirectory, string relativePath)
        {
            // Structure validation rejects absolute paths, backslashes, empty
            // segments, and traversal before this method is reached.
            return string.IsNullOrEmpty(documentDirectory)
                ? relativePath
                : $"{documentDirectory}/{relativePath}";
        }

        private static TerrainImportDiagnostic Error(string code, string message, string path) =>
            new TerrainImportDiagnostic(TerrainDiagnosticSeverity.Error, code, message, path);

        private static TerrainImportDiagnostic Warning(string code, string message, string path) =>
            new TerrainImportDiagnostic(TerrainDiagnosticSeverity.Warning, code, message, path);

        private static void LogDiagnostics(AssetImportContext context, IEnumerable<TerrainImportDiagnostic> diagnostics)
        {
            foreach (var diagnostic in diagnostics)
            {
                var message = string.IsNullOrEmpty(diagnostic.Path)
                    ? $"[{diagnostic.Code}] {diagnostic.Message}"
                    : $"[{diagnostic.Code}] {diagnostic.Message} ({diagnostic.Path})";
                switch (diagnostic.Severity)
                {
                    case TerrainDiagnosticSeverity.Error:
                        context.LogImportError(message);
                        break;
                    case TerrainDiagnosticSeverity.Warning:
                        context.LogImportWarning(message);
                        break;
                    default:
                        context.LogImportWarning(message);
                        break;
                }
            }
        }
    }
}
