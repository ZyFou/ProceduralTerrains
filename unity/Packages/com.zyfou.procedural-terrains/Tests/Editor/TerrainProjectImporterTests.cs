using System;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;
using UnityEngine.TestTools;
using Zyfou.ProceduralTerrains.Editor;

namespace Zyfou.ProceduralTerrains.EditorTests
{
    internal sealed class TerrainProjectImporterTests
    {
        private const string TestRoot = "Assets/ProceduralTerrainsImporterTests";
        private const int Resolution = 513;
        private const int RawByteLength = Resolution * Resolution * 2;

        [SetUp]
        public void SetUp()
        {
            AssetDatabase.DeleteAsset(TestRoot);
            Directory.CreateDirectory(TestRoot);
            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
        }

        [TearDown]
        public void TearDown()
        {
            AssetDatabase.DeleteAsset(TestRoot);
            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
        }

        [TestCase("procedural")]
        [TestCase("nodes")]
        [TestCase("manual")]
        public void ParsesSupportedProjectModes(string mode)
        {
            var json = CreateDocumentJson(mode, new[] { CreateTile(0, 0, "heightmap.raw") });
            Assert.That(RuntimeTerrainDocumentParser.TryParse(json, out var document, out var generationJson, out var error), Is.True, error);
            Assert.That(RuntimeTerrainDocumentValidator.Validate(document), Has.None.Matches<TerrainImportDiagnostic>(
                diagnostic => diagnostic.Severity == TerrainDiagnosticSeverity.Error));
            Assert.That(generationJson, Does.Contain($"\"kind\":\"{mode}\""));
        }

        [Test]
        public void ImportsTwoTilesAndIgnoresUnknownSchemaOneFields()
        {
            var tiles = new[]
            {
                CreateTile(-1, 0, "tiles/tile_-1_0/heightmap.raw"),
                CreateTile(0, 0, "tiles/tile_0_0/heightmap.raw"),
            };
            WriteRaw(tiles[0].heightfield.path, RawByteLength);
            WriteRaw(tiles[1].heightfield.path, RawByteLength);
            var json = CreateDocumentJson("nodes", tiles);
            json = json.Insert(json.Length - 1, ",\"futureField\":{\"ignored\":true}");
            var documentPath = WriteDocument("project.ptrterrain", json);

            AssetDatabase.ImportAsset(documentPath, ImportAssetOptions.ForceSynchronousImport | ImportAssetOptions.ForceUpdate);
            var asset = AssetDatabase.LoadAssetAtPath<TerrainProjectAsset>(documentPath);

            Assert.That(asset, Is.Not.Null);
            Assert.That(asset.SchemaVersion, Is.EqualTo(1));
            Assert.That(asset.ProjectMode, Is.EqualTo(TerrainProjectMode.Nodes));
            Assert.That(asset.Seed, Is.EqualTo(1337));
            Assert.That(asset.Tiles.Count, Is.EqualTo(2));
            Assert.That(asset.Tiles[0].Cx, Is.EqualTo(-1));
            Assert.That(asset.Tiles[1].Cx, Is.EqualTo(0));
            Assert.That(asset.Tiles.All(tile => tile.Heightfield.Resolution == Resolution), Is.True);
            Assert.That(AssetDatabase.LoadAllAssetsAtPath(documentPath), Has.Length.EqualTo(1));
        }

        [Test]
        public void ImportsSingleTileWithBoundsPathsAndCoordinateConvention()
        {
            var tile = CreateTile(0, 0, "heightmap.raw");
            WriteRaw(tile.heightfield.path, RawByteLength);
            var documentPath = WriteDocument("project.ptrterrain", CreateDocumentJson("procedural", new[] { tile }));

            AssetDatabase.ImportAsset(documentPath, ImportAssetOptions.ForceSynchronousImport | ImportAssetOptions.ForceUpdate);
            var asset = AssetDatabase.LoadAssetAtPath<TerrainProjectAsset>(documentPath);

            Assert.That(asset, Is.Not.Null);
            Assert.That(asset.WorldType, Is.EqualTo(TerrainWorldType.Studio));
            Assert.That(asset.Units, Is.EqualTo("meters"));
            Assert.That(asset.UpAxis, Is.EqualTo("+Y"));
            Assert.That(asset.XAxis, Is.EqualTo("+X"));
            Assert.That(asset.ZAxis, Is.EqualTo("+Z"));
            Assert.That(asset.CoordinateMapping, Is.EqualTo("x,y,z"));
            Assert.That(asset.TilePivot, Is.EqualTo("center"));
            Assert.That(asset.Bounds.MinX, Is.EqualTo(-500));
            Assert.That(asset.Bounds.SizeX, Is.EqualTo(1000));
            Assert.That(asset.Bounds.MaxHeight, Is.EqualTo(560));
            Assert.That(asset.Tiles[0].Heightfield.RelativePath, Is.EqualTo("heightmap.raw"));
            Assert.That(asset.Diagnostics, Is.Empty);
        }

        [Test]
        public void MissingOptionalSplatCreatesWarningButStillImports()
        {
            var tile = CreateTile(0, 0, "heightmap.raw", "splatmaps/biomes.png");
            WriteRaw(tile.heightfield.path, RawByteLength);
            var documentPath = WriteDocument("project.ptrterrain", CreateDocumentJson("procedural", new[] { tile }));
            LogAssert.Expect(LogType.Warning, new Regex("artifact.optionalMissing"));

            AssetDatabase.ImportAsset(documentPath, ImportAssetOptions.ForceSynchronousImport | ImportAssetOptions.ForceUpdate);
            var asset = AssetDatabase.LoadAssetAtPath<TerrainProjectAsset>(documentPath);

            Assert.That(asset, Is.Not.Null);
            Assert.That(asset.Diagnostics, Has.Some.Matches<TerrainImportDiagnostic>(diagnostic => diagnostic.Code == "artifact.optionalMissing"));
        }

        [Test]
        public void TruncatedRawFileFailsWithoutCreatingMainAsset()
        {
            var tile = CreateTile(0, 0, "heightmap.raw");
            WriteRaw(tile.heightfield.path, 16);
            var documentPath = WriteDocument("project.ptrterrain", CreateDocumentJson("procedural", new[] { tile }));
            LogAssert.Expect(LogType.Error, new Regex("heightfield.size"));

            AssetDatabase.ImportAsset(documentPath, ImportAssetOptions.ForceSynchronousImport | ImportAssetOptions.ForceUpdate);

            Assert.That(AssetDatabase.LoadAssetAtPath<TerrainProjectAsset>(documentPath), Is.Null);
        }

        [Test]
        public void MissingRawFileFailsWithoutCreatingMainAsset()
        {
            var tile = CreateTile(0, 0, "heightmap.raw");
            var documentPath = WriteDocument("project.ptrterrain", CreateDocumentJson("procedural", new[] { tile }));
            LogAssert.Expect(LogType.Error, new Regex("artifact.missing"));

            AssetDatabase.ImportAsset(documentPath, ImportAssetOptions.ForceSynchronousImport | ImportAssetOptions.ForceUpdate);

            Assert.That(AssetDatabase.LoadAssetAtPath<TerrainProjectAsset>(documentPath), Is.Null);
        }

        [Test]
        public void MalformedJsonFailsWithoutCreatingMainAsset()
        {
            var documentPath = WriteDocument("project.ptrterrain", "{ definitely-not-json");
            LogAssert.Expect(LogType.Error, new Regex("malformed JSON|could not be parsed"));

            AssetDatabase.ImportAsset(documentPath, ImportAssetOptions.ForceSynchronousImport | ImportAssetOptions.ForceUpdate);

            Assert.That(AssetDatabase.LoadAssetAtPath<TerrainProjectAsset>(documentPath), Is.Null);
        }

        [Test]
        public void NewerSchemaAndUnsafePathsAreRejected()
        {
            var tile = CreateTile(0, 0, "../heightmap.raw");
            var json = CreateDocumentJson("procedural", new[] { tile }, schemaVersion: 2);
            Assert.That(RuntimeTerrainDocumentParser.TryParse(json, out var document, out _, out var error), Is.True, error);
            var diagnostics = RuntimeTerrainDocumentValidator.Validate(document);

            Assert.That(diagnostics, Has.Some.Matches<TerrainImportDiagnostic>(diagnostic => diagnostic.Code == "schema.unsupported"));
            Assert.That(diagnostics, Has.Some.Matches<TerrainImportDiagnostic>(diagnostic => diagnostic.Code == "artifact.path"));
        }

        [Test]
        public void AbsoluteArtifactPathIsRejected()
        {
            var tile = CreateTile(0, 0, "C:/terrain/heightmap.raw");
            var json = CreateDocumentJson("procedural", new[] { tile });
            Assert.That(RuntimeTerrainDocumentParser.TryParse(json, out var document, out _, out var error), Is.True, error);

            Assert.That(RuntimeTerrainDocumentValidator.Validate(document),
                Has.Some.Matches<TerrainImportDiagnostic>(diagnostic => diagnostic.Code == "artifact.path"));
        }

        [Test]
        public void OmittedTileShapeUsesTheSchemaOneSquareDefault()
        {
            var tile = CreateTile(0, 0, "heightmap.raw");
            var json = CreateDocumentJson("procedural", new[] { tile });
            Assert.That(RuntimeTerrainDocumentParser.TryParse(json, out var document, out _, out var error), Is.True, error);
            document.project.tileShape = null;

            Assert.That(RuntimeTerrainDocumentValidator.Validate(document),
                Has.None.Matches<TerrainImportDiagnostic>(diagnostic => diagnostic.Code == "project.tileShape"));
        }

        [Test]
        public void RawDependencyChangesDocumentDependencyHashWithoutOrphans()
        {
            var tile = CreateTile(0, 0, "heightmap.raw");
            var rawPath = WriteRaw(tile.heightfield.path, RawByteLength);
            var documentPath = WriteDocument("project.ptrterrain", CreateDocumentJson("manual", new[] { tile }));
            AssetDatabase.ImportAsset(documentPath, ImportAssetOptions.ForceSynchronousImport | ImportAssetOptions.ForceUpdate);
            var before = AssetDatabase.GetAssetDependencyHash(documentPath);

            using (var stream = new FileStream(rawPath, FileMode.Open, FileAccess.Write, FileShare.Read))
            {
                stream.WriteByte(127);
            }
            AssetDatabase.ImportAsset(rawPath, ImportAssetOptions.ForceSynchronousImport | ImportAssetOptions.ForceUpdate);
            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
            var after = AssetDatabase.GetAssetDependencyHash(documentPath);

            Assert.That(after, Is.Not.EqualTo(before));
            Assert.That(AssetDatabase.LoadAssetAtPath<TerrainProjectAsset>(documentPath), Is.Not.Null);
            Assert.That(AssetDatabase.LoadAllAssetsAtPath(documentPath), Has.Length.EqualTo(1));
        }

        private static RuntimeTileJson CreateTile(int cx, int cz, string heightPath, string splatPath = null)
        {
            return new RuntimeTileJson
            {
                cx = cx,
                cz = cz,
                centerX = cx * 1000,
                centerZ = cz * 1000,
                size = 1000,
                heightfield = new RuntimeHeightfieldJson
                {
                    path = heightPath,
                    resolution = Resolution,
                    encoding = "uint16-normalized",
                    byteOrder = "little-endian",
                    sampleLayout = "vertex-grid-inclusive",
                    rowOrder = "negative-z-to-positive-z",
                    columnOrder = "negative-x-to-positive-x",
                    minHeight = 0,
                    maxHeight = 560,
                },
                splat = splatPath == null ? null : new RuntimeSplatJson
                {
                    path = splatPath,
                    width = 2048,
                    height = 2048,
                    channels = new[] { "desert", "canyon", "wetland", "mountains" },
                },
            };
        }

        private static string CreateDocumentJson(string mode, RuntimeTileJson[] tiles, int schemaVersion = 1)
        {
            var minCx = tiles.Min(tile => tile.cx);
            var maxCx = tiles.Max(tile => tile.cx);
            var minCz = tiles.Min(tile => tile.cz);
            var maxCz = tiles.Max(tile => tile.cz);
            return JsonUtility.ToJson(new RuntimeTerrainDocumentJson
            {
                format = "procedural-terrains",
                schemaVersion = schemaVersion,
                producer = new RuntimeProducerJson { name = "Procedural Terrains", appVersion = "1.5.1", generatorVersion = 1 },
                project = new RuntimeProjectJson { mode = mode, world = "studio", tileShape = "square", seed = 1337 },
                coordinates = new RuntimeCoordinatesJson
                {
                    units = "meters", upAxis = "+Y", xAxis = "+X", zAxis = "+Z",
                    unityMapping = "x,y,z", tilePivot = "center",
                },
                bounds = new RuntimeBoundsJson
                {
                    minX = (minCx - 0.5) * 1000,
                    minZ = (minCz - 0.5) * 1000,
                    sizeX = (maxCx - minCx + 1) * 1000,
                    sizeZ = (maxCz - minCz + 1) * 1000,
                    minHeight = 0,
                    maxHeight = 560,
                    seaLevel = 100,
                },
                tiles = tiles,
                generation = new RuntimeGenerationJson { sourceVersion = 1, authoritative = "baked", kind = mode },
                features = new RuntimeFeaturesJson { heightfield = true, splat = tiles.Any(tile => tile.splat != null) },
                unsupportedFeatures = Array.Empty<string>(),
            });
        }

        private static string WriteRaw(string relativePath, int byteLength)
        {
            var path = $"{TestRoot}/{relativePath}";
            Directory.CreateDirectory(Path.GetDirectoryName(path) ?? TestRoot);
            File.WriteAllBytes(path, new byte[byteLength]);
            return path;
        }

        private static string WriteDocument(string filename, string json)
        {
            var path = $"{TestRoot}/{filename}";
            File.WriteAllText(path, json);
            return path;
        }
    }
}
