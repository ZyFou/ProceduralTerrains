using System;
using System.Collections.Generic;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;
using UnityEngine.SceneManagement;
using Object = UnityEngine.Object;

namespace Zyfou.ProceduralTerrains.EditorTests
{
    public sealed class TerrainGenerationTests
    {
        private const string GeneratedRoot = "Assets/ProceduralTerrains/Generated";

        [SetUp]
        public void SetUp()
        {
            SceneManager.SetActiveScene(SceneManager.CreateScene($"TerrainGenerationTests-{Guid.NewGuid():N}"));
            AssetDatabase.DeleteAsset(GeneratedRoot);
        }

        [TearDown]
        public void TearDown()
        {
            foreach (var root in Object.FindObjectsByType<GeneratedTerrainRoot>(FindObjectsSortMode.None))
                Object.DestroyImmediate(root.gameObject);
            AssetDatabase.DeleteAsset(GeneratedRoot);
        }

        [Test]
        public void LayerSamplesMatchBlenderCpuGoldenValues()
        {
            var expected = new Dictionary<TerrainNoiseType, float>
            {
                { TerrainNoiseType.Fbm, .22749674f },
                { TerrainNoiseType.Ridged, .08544321f },
                { TerrainNoiseType.Billow, .22047254f },
                { TerrainNoiseType.Value, .21914806f },
                { TerrainNoiseType.White, .002287245f },
                { TerrainNoiseType.Constant, .1f },
                { TerrainNoiseType.Voronoi, .11024905f },
                { TerrainNoiseType.Crater, 0f },
                { TerrainNoiseType.Dune, .30193967f },
                { TerrainNoiseType.Flow, -.000009067f },
            };
            foreach (var pair in expected)
            {
                var settings = BaseSettings();
                settings.Layers = new List<TerrainNoiseLayerSettings>
                    { TerrainGenerationPresets.CreateLayer(pair.Key) };
                var actual = TerrainGenerator.EvaluateStackSample(settings, 12.5f, -7.25f, 0f, 0f);
                Assert.That(actual, Is.EqualTo(pair.Value).Within(.001f), pair.Key.ToString());
            }
        }

        [Test]
        public void EveryLayerTypeProducesFiniteHeights()
        {
            foreach (TerrainNoiseType type in Enum.GetValues(typeof(TerrainNoiseType)))
            {
                var settings = BaseSettings();
                settings.Width = 100f;
                settings.Depth = 80f;
                settings.Height = 50f;
                settings.Layers = type == TerrainNoiseType.DomainWarp || type == TerrainNoiseType.Terrace
                    ? new List<TerrainNoiseLayerSettings>
                    {
                        TerrainGenerationPresets.CreateLayer(TerrainNoiseType.Fbm),
                        TerrainGenerationPresets.CreateLayer(type),
                    }
                    : new List<TerrainNoiseLayerSettings> { TerrainGenerationPresets.CreateLayer(type) };
                var result = TerrainGenerator.Generate(settings);
                Assert.That(Array.TrueForAll(result.Heights, value => !float.IsNaN(value) && !float.IsInfinity(value)), Is.True, type.ToString());
            }
        }

        [Test]
        public void SeedsAreDeterministicAndAdjacentTileEdgesMatchExactly()
        {
            var settings = BaseSettings();
            settings.Width = 200f;
            settings.Depth = 100f;
            settings.TilesX = 2;
            settings = TerrainGenerationPresets.ApplyStackPreset(settings, TerrainStackPreset.AlpineRanges);
            var first = TerrainGenerator.Generate(settings);
            var second = TerrainGenerator.Generate(settings.Clone());
            CollectionAssert.AreEqual(first.Heights, second.Heights);
            var seam = settings.Resolution - 1;
            Assert.That(first.Get(seam, 0), Is.EqualTo(second.Get(seam, 0)));
            var changed = settings.Clone();
            changed.Seed++;
            CollectionAssert.AreNotEqual(first.Heights, TerrainGenerator.Generate(changed).Heights);
        }

        [Test]
        public void BuilderCreatesNativeTilesAndRegenerationPreservesUnrelatedChildren()
        {
            var settings = BaseSettings();
            settings.ProjectName = "Builder Test";
            settings.TilesX = 2;
            settings.CreatePreviewMaterial = true;
            var result = TerrainGenerationSceneBuilder.Build(settings);
            Assert.That(result.Terrains.Count, Is.EqualTo(2));
            Assert.That(result.Root.GetComponent<GeneratedTerrainRoot>().Recipe, Is.Not.Null);
            Assert.That(result.Terrains[0].GetComponent<TerrainCollider>(), Is.Not.Null);
            Assert.That(result.Terrains[0].terrainData.terrainLayers.Length, Is.EqualTo(1));
            Assert.That(result.Terrains[0].rightNeighbor, Is.EqualTo(result.Terrains[1]));
            Assert.That(result.Terrains[1].leftNeighbor, Is.EqualTo(result.Terrains[0]));
            var leftEdge = result.Terrains[0].terrainData.GetHeights(settings.Resolution - 1, 0, 1, settings.Resolution);
            var rightEdge = result.Terrains[1].terrainData.GetHeights(0, 0, 1, settings.Resolution);
            for (var row = 0; row < settings.Resolution; row++)
                Assert.That(leftEdge[row, 0], Is.EqualTo(rightEdge[row, 0]));

            var unrelated = new GameObject("Keep Me");
            unrelated.transform.SetParent(result.Root.transform);
            var changed = settings.Clone();
            changed.TilesX = 1;
            changed.Resolution = 129;
            var regenerated = TerrainGenerationSceneBuilder.Build(
                changed,
                result.Root.GetComponent<GeneratedTerrainRoot>());
            Assert.That(regenerated.Root, Is.SameAs(result.Root));
            Assert.That(regenerated.Terrains.Count, Is.EqualTo(1));
            Assert.That(regenerated.Terrains[0].terrainData.heightmapResolution, Is.EqualTo(129));
            Assert.That(unrelated, Is.Not.Null);
            Assert.That(unrelated.transform.parent, Is.EqualTo(result.Root.transform));
        }

        [Test]
        public void CancellationDoesNotCreateSceneOrAssetOutput()
        {
            var settings = BaseSettings();
            Assert.Throws<OperationCanceledException>(() =>
                TerrainGenerationSceneBuilder.Build(settings, null, _ => true));
            Assert.That(Object.FindObjectsByType<GeneratedTerrainRoot>(FindObjectsSortMode.None), Is.Empty);
            Assert.That(AssetDatabase.IsValidFolder(GeneratedRoot), Is.False);
        }

        private static TerrainGenerationSettings BaseSettings()
        {
            return new TerrainGenerationSettings
            {
                ProjectName = "Test Terrain",
                Width = 1000f,
                Depth = 1000f,
                Height = 1f,
                Resolution = 65,
                Falloff = 0f,
                NoiseScale = 100f,
                CreatePreviewMaterial = false,
                Layers = new List<TerrainNoiseLayerSettings>
                    { TerrainGenerationPresets.CreateLayer(TerrainNoiseType.Fbm) },
            };
        }
    }
}
