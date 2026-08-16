using System;
using System.IO;
using System.IO.Compression;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;
using Zyfou.ProceduralTerrains.Editor;
using Object = UnityEngine.Object;

namespace Zyfou.ProceduralTerrains.EditorTests
{
    internal sealed class TerrainImportWorkflowTests
    {
        private const string TestRoot = "Assets/ProceduralTerrainsWorkflowTests";
        private const int Resolution = 513;
        private GameObject createdRoot;

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
            if (createdRoot != null) Object.DestroyImmediate(createdRoot);
            AssetDatabase.DeleteAsset(TestRoot);
            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
        }

        [Test]
        public void SceneBuilderCreatesTerrainColliderHeightAndBakedSurfaceAssets()
        {
            var documentFolder = $"{TestRoot}/Terrain";
            Directory.CreateDirectory($"{documentFolder}/textures");
            var raw = CreateRawWithFirstSampleAtMaximum();
            File.WriteAllBytes($"{documentFolder}/heightmap.raw", raw);
            File.WriteAllBytes($"{documentFolder}/textures/terrain_color.png", CreateSolidPng(Color.green));
            File.WriteAllText($"{documentFolder}/project.ptrterrain", CreateDocumentJson("heightmap.raw"));
            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
            AssetDatabase.ImportAsset(
                $"{documentFolder}/project.ptrterrain",
                ImportAssetOptions.ForceSynchronousImport | ImportAssetOptions.ForceUpdate);
            var project = AssetDatabase.LoadAssetAtPath<TerrainProjectAsset>(
                $"{documentFolder}/project.ptrterrain");

            var result = TerrainSceneBuilder.Build(project);
            createdRoot = result.Root;

            Assert.That(result.Terrains, Has.Count.EqualTo(1));
            var terrain = result.Terrains[0];
            Assert.That(terrain.GetComponent<TerrainCollider>(), Is.Not.Null);
            Assert.That(terrain.transform.position, Is.EqualTo(new Vector3(-500f, 0f, -500f)));
            Assert.That(terrain.terrainData.heightmapResolution, Is.EqualTo(Resolution));
            Assert.That(terrain.terrainData.size, Is.EqualTo(new Vector3(1000f, 560f, 1000f)));
            Assert.That(terrain.terrainData.GetHeights(0, 0, 1, 1)[0, 0], Is.EqualTo(1f).Within(0.0001f));
            Assert.That(terrain.materialTemplate, Is.Not.Null);
            Assert.That(terrain.terrainData.terrainLayers, Has.Length.EqualTo(1));
            Assert.That(terrain.terrainData.terrainLayers[0].diffuseTexture, Is.Not.Null);
            Assert.That(result.CreatedAssetPaths, Has.Count.EqualTo(3));
        }

        [Test]
        public void ZipImporterExtractsAValidArchiveBelowAssets()
        {
            var zipPath = Path.Combine(Path.GetTempPath(), $"procedural-terrains-{Guid.NewGuid():N}.zip");
            try
            {
                using (var archive = ZipFile.Open(zipPath, ZipArchiveMode.Create))
                {
                    WriteEntry(archive, "Terrain/project.ptrterrain", CreateDocumentJson("heightmap.raw"));
                    WriteEntry(archive, "Terrain/heightmap.raw", new byte[Resolution * Resolution * 2]);
                    WriteEntry(archive, "Terrain/textures/terrain_color.png", CreateSolidPng(Color.gray));
                }

                var result = TerrainZipImportService.ImportArchive(zipPath, $"{TestRoot}/Imports");

                Assert.That(result.Project, Is.Not.Null);
                Assert.That(result.ProjectAssetPath, Does.StartWith($"{TestRoot}/Imports/"));
                Assert.That(result.ProjectAssetPath, Does.EndWith("/Terrain/project.ptrterrain"));
                Assert.That(result.Project.Tiles.Count, Is.EqualTo(1));
            }
            finally
            {
                if (File.Exists(zipPath)) File.Delete(zipPath);
            }
        }

        [TestCase("../escape.txt")]
        [TestCase("Terrain/Editor/RunOnImport.cs")]
        public void ZipImporterRejectsUnsafeOrExecutableEntriesBeforeExtraction(string unsafePath)
        {
            var zipPath = Path.Combine(Path.GetTempPath(), $"procedural-terrains-unsafe-{Guid.NewGuid():N}.zip");
            try
            {
                using (var archive = ZipFile.Open(zipPath, ZipArchiveMode.Create))
                {
                    WriteEntry(archive, "Terrain/project.ptrterrain", CreateDocumentJson("heightmap.raw"));
                    WriteEntry(archive, unsafePath, "unsafe");
                }

                Assert.Throws<InvalidDataException>(() =>
                    TerrainZipImportService.ImportArchive(zipPath, $"{TestRoot}/Imports"));
            }
            finally
            {
                if (File.Exists(zipPath)) File.Delete(zipPath);
            }
        }

        [Test]
        public void RawDecoderPreservesLittleEndianNegativeZFirstLayout()
        {
            var rawPath = $"{TestRoot}/heightmap.raw";
            var bytes = new byte[Resolution * Resolution * 2];
            bytes[0] = 0x34;
            bytes[1] = 0x12;
            var positiveZLastSampleOffset = bytes.Length - 2;
            bytes[positiveZLastSampleOffset] = 0xCD;
            bytes[positiveZLastSampleOffset + 1] = 0xAB;
            File.WriteAllBytes(rawPath, bytes);

            var heights = TerrainSceneBuilder.DecodeRawHeightfield(rawPath, Resolution);

            Assert.That(heights[0, 0], Is.EqualTo(0x1234 / 65535f).Within(0.000001f));
            Assert.That(heights[Resolution - 1, Resolution - 1], Is.EqualTo(0xABCD / 65535f).Within(0.000001f));
        }

        [Test]
        public void SceneBuilderPositionsAndConnectsAdjacentTiles()
        {
            var leftRawPath = $"{TestRoot}/tile_0_0.raw";
            var rightRawPath = $"{TestRoot}/tile_1_0.raw";
            File.WriteAllBytes(leftRawPath, new byte[Resolution * Resolution * 2]);
            File.WriteAllBytes(rightRawPath, new byte[Resolution * Resolution * 2]);
            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
            var project = ScriptableObject.CreateInstance<TerrainProjectAsset>();
            project.Initialize(
                1,
                "Procedural Terrains",
                "1.5.1",
                1,
                TerrainProjectMode.Procedural,
                TerrainWorldType.Studio,
                1337,
                "meters",
                "+Y",
                "+X",
                "+Z",
                "x,y,z",
                "center",
                new TerrainProjectBounds(-500f, -500f, 2000f, 1000f, 0f, 560f, 100f),
                new[]
                {
                    CreateTileDescriptor(0, 0, leftRawPath),
                    CreateTileDescriptor(1, 0, rightRawPath),
                },
                new TerrainFeatureSummary(true, false, false, false, false, false, false, false, false),
                Array.Empty<string>(),
                string.Empty,
                Array.Empty<TerrainImportDiagnostic>());
            AssetDatabase.CreateAsset(project, $"{TestRoot}/project.asset");

            var result = TerrainSceneBuilder.Build(project, new TerrainSceneBuildOptions
            {
                CreateBakedMaterials = false,
                CreateTerrainLayers = false,
                ConnectNeighbors = true,
            });
            createdRoot = result.Root;
            var left = result.Terrains[0];
            var right = result.Terrains[1];

            Assert.That(left.transform.position, Is.EqualTo(new Vector3(-500f, 0f, -500f)));
            Assert.That(right.transform.position, Is.EqualTo(new Vector3(500f, 0f, -500f)));
            Assert.That(left.rightNeighbor, Is.SameAs(right));
            Assert.That(right.leftNeighbor, Is.SameAs(left));
        }

        private static byte[] CreateRawWithFirstSampleAtMaximum()
        {
            var raw = new byte[Resolution * Resolution * 2];
            raw[0] = 0xFF;
            raw[1] = 0xFF;
            return raw;
        }

        private static TerrainTileDescriptor CreateTileDescriptor(int cx, int cz, string rawPath)
        {
            return new TerrainTileDescriptor(
                cx,
                cz,
                cx * 1000f,
                cz * 1000f,
                1000f,
                new TerrainHeightfieldDescriptor(
                    Path.GetFileName(rawPath),
                    rawPath,
                    Resolution,
                    0f,
                    560f,
                    AssetDatabase.LoadAssetAtPath<Object>(rawPath)),
                null,
                null,
                0,
                0,
                null);
        }

        private static byte[] CreateSolidPng(Color color)
        {
            var texture = new Texture2D(4, 4, TextureFormat.RGBA32, false);
            var colors = new Color[16];
            for (var index = 0; index < colors.Length; index++) colors[index] = color;
            texture.SetPixels(colors);
            texture.Apply();
            var png = texture.EncodeToPNG();
            Object.DestroyImmediate(texture);
            return png;
        }

        private static void WriteEntry(ZipArchive archive, string path, string value)
        {
            WriteEntry(archive, path, System.Text.Encoding.UTF8.GetBytes(value));
        }

        private static void WriteEntry(ZipArchive archive, string path, byte[] value)
        {
            var entry = archive.CreateEntry(path, System.IO.Compression.CompressionLevel.Fastest);
            using (var output = entry.Open()) output.Write(value, 0, value.Length);
        }

        private static string CreateDocumentJson(string heightfieldPath)
        {
            return "{"
                + "\"format\":\"procedural-terrains\","
                + "\"schemaVersion\":1,"
                + "\"producer\":{\"name\":\"Procedural Terrains\",\"appVersion\":\"1.5.1\",\"generatorVersion\":1},"
                + "\"project\":{\"mode\":\"procedural\",\"world\":\"studio\",\"tileShape\":\"square\",\"seed\":1337},"
                + "\"coordinates\":{\"units\":\"meters\",\"upAxis\":\"+Y\",\"xAxis\":\"+X\",\"zAxis\":\"+Z\",\"unityMapping\":\"x,y,z\",\"tilePivot\":\"center\"},"
                + "\"bounds\":{\"minX\":-500,\"minZ\":-500,\"sizeX\":1000,\"sizeZ\":1000,\"minHeight\":0,\"maxHeight\":560,\"seaLevel\":100},"
                + "\"tiles\":[{\"cx\":0,\"cz\":0,\"centerX\":0,\"centerZ\":0,\"size\":1000,"
                + "\"heightfield\":{\"path\":\"" + heightfieldPath + "\",\"resolution\":513,\"encoding\":\"uint16-normalized\",\"byteOrder\":\"little-endian\",\"sampleLayout\":\"vertex-grid-inclusive\",\"rowOrder\":\"negative-z-to-positive-z\",\"columnOrder\":\"negative-x-to-positive-x\",\"minHeight\":0,\"maxHeight\":560}}],"
                + "\"generation\":{\"sourceVersion\":1,\"authoritative\":\"baked\",\"kind\":\"procedural\"},"
                + "\"features\":{\"heightfield\":true,\"splat\":false,\"paint\":false,\"erosion\":false,\"splines\":false,\"importedMaps\":false,\"surfaces\":false,\"water\":false,\"props\":false},"
                + "\"unsupportedFeatures\":[]"
                + "}";
        }
    }
}
