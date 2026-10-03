using System;
using System.Collections.Generic;
using UnityEngine;

namespace Zyfou.ProceduralTerrains
{
    public enum TerrainGenerationPreset
    {
        Highlands,
        Archipelago,
        Alpine,
        Dunes,
        Rolling,
        Volcanic,
        Canyon,
        Cartoon,
    }

    public enum TerrainStackPreset
    {
        Classic,
        RollingHills,
        SharpMountains,
        CanyonTerraces,
        DesertDunes,
        MoonCraters,
        AlienCellular,
        IslandContinents,
        ErodedValleys,
        GeologicalHybrid,
        AlpineRanges,
        GraniteSpires,
        FoothillRanges,
    }

    public enum TerrainNoiseType
    {
        Legacy,
        Fbm,
        Ridged,
        Billow,
        Value,
        White,
        Constant,
        Voronoi,
        Crater,
        Dune,
        Flow,
        DomainWarp,
        Terrace,
    }

    public enum TerrainBlendMode
    {
        Add,
        Subtract,
        Multiply,
        Divide,
        Max,
        Min,
        Replace,
        Difference,
        Overlay,
        Carve,
        Flatten,
    }

    public enum TerrainMaskType
    {
        Height,
        Noise,
        Slope,
        Biome,
    }

    public enum TerrainEdgeProfile
    {
        Island,
        Mountains,
    }

    public enum TerrainGenerationPlacement
    {
        WorldOrigin,
        SceneViewPivot,
    }

    [Serializable]
    public sealed class TerrainLayerMaskSettings
    {
        public TerrainMaskType Type = TerrainMaskType.Height;
        public bool Enabled = true;
        public bool Invert;
        public float Minimum;
        public float Maximum = 1.35f;
        public float Falloff = 0.06f;
        public float Scale = 1f;
        public float Threshold = 0.5f;
        public float Softness = 0.12f;
        public int Biome;

        public TerrainLayerMaskSettings Clone() => JsonUtility.FromJson<TerrainLayerMaskSettings>(JsonUtility.ToJson(this));
    }

    [Serializable]
    public sealed class TerrainNoiseParameters
    {
        public float Scale = 1f;
        public int Octaves = 5;
        public float Persistence = 0.5f;
        public float Lacunarity = 2f;
        public float Erosion;
        public float Warp;
        public float Sharpness = 2f;
        public int Interpolation = 2;
        public float Smoothing;
        public float Value = 0.1f;
        public float Jitter = 1f;
        public int DistanceMode;
        public int OutputMode = 2;
        public float Density = 0.55f;
        public float Depth = 0.6f;
        public float Rim = 0.3f;
        public float RimWidth = 0.35f;
        public float Direction = 0.7f;
        public float RippleScale = 4f;
        public float RippleStrength = 0.12f;
        public float Width = 0.3f;
        public float Meander = 1.2f;
        public float MeanderScale = 0.6f;
        public int TerraceCount = 12;
        public float TerraceSmoothness = 0.5f;

        public TerrainNoiseParameters Clone() => JsonUtility.FromJson<TerrainNoiseParameters>(JsonUtility.ToJson(this));
    }

    [Serializable]
    public sealed class TerrainNoiseLayerSettings
    {
        public string Name = "Classic Terrain";
        public bool Enabled = true;
        public TerrainNoiseType Type = TerrainNoiseType.Legacy;
        public TerrainBlendMode BlendMode = TerrainBlendMode.Replace;
        public float Strength = 1f;
        [Range(0f, 1f)] public float Opacity = 1f;
        public int SeedOffset;
        public TerrainNoiseParameters Parameters = new TerrainNoiseParameters();
        public List<TerrainLayerMaskSettings> Masks = new List<TerrainLayerMaskSettings>();

        public TerrainNoiseLayerSettings Clone() => JsonUtility.FromJson<TerrainNoiseLayerSettings>(JsonUtility.ToJson(this));
    }

    [Serializable]
    public sealed class TerrainGenerationSettings
    {
        public const int MaximumLayers = 12;
        public const int MaximumSamples = 16_000_000;

        public string ProjectName = "New Terrain";
        public TerrainGenerationPreset Preset = TerrainGenerationPreset.Highlands;
        public TerrainStackPreset StackPreset = TerrainStackPreset.Classic;
        public int Seed = 1337;
        public float Width = 1000f;
        public float Depth = 1000f;
        public float Height = 560f;
        public int TilesX = 1;
        public int TilesZ = 1;
        public int Resolution = 513;
        public TerrainGenerationPlacement Placement = TerrainGenerationPlacement.WorldOrigin;
        public bool CreatePreviewMaterial = true;
        public float NoiseScale = 45f;
        public float NoiseStrength = 1f;
        [Range(0f, 1f)] public float TerrainSmoothing;
        public int Octaves = 7;
        public float Persistence = 0.5f;
        public float Lacunarity = 2.05f;
        public float Ridge = 0.65f;
        public float Warp = 0.9f;
        [Range(0f, 1f)] public float Falloff = 0.2f;
        public TerrainEdgeProfile EdgeProfile = TerrainEdgeProfile.Island;
        public float FormationSeaLevel = 100f;
        public float MoistureScale = 1f;
        public float MoistureBias;
        public float BiomeScale = 1f;
        public float TemperatureBias;
        public bool NormalizeOutput;
        public float OutputMinimum;
        public float OutputMaximum = 1.35f;
        public bool DetailEnabled = true;
        public float DetailAmplitude = 2f;
        public float DetailWavelength = 40f;
        [Range(0f, 1f)] public float DetailSlopeInfluence = .5f;
        public bool ErosionEnabled = true;
        public int ErosionIterations = 30;
        [Range(0f, 1f)] public float ErosionStrength = .4f;
        public float ErosionAngle = 30f;
        public bool ProceduralSurface = true;
        public Color SandColor = new Color(.58f, .44f, .25f);
        public Color GrassColor = new Color(.12f, .22f, .055f);
        public Color RockColor = new Color(.28f, .27f, .25f);
        public Color SnowColor = new Color(.87f, .90f, .94f);
        public float SurfaceGrain = 3f;
        public float SurfaceNormalStrength = .35f;
        public float SnowHeight = .78f;
        public float RockSlope = 40f;
        public float SurfaceTransition = .12f;
        public bool WaterEnabled = true;
        public float WaterLevel = 100f;
        public Color WaterColor = new Color(.025f, .22f, .35f);
        public List<TerrainNoiseLayerSettings> Layers = new List<TerrainNoiseLayerSettings>
        {
            new TerrainNoiseLayerSettings(),
        };

        public long SampleCount => (long)TilesX * TilesZ * Resolution * Resolution;

        public TerrainGenerationSettings Clone() => JsonUtility.FromJson<TerrainGenerationSettings>(JsonUtility.ToJson(this));
    }

    [CreateAssetMenu(menuName = "Procedural Terrains/Generation Recipe", fileName = "TerrainGenerationRecipe")]
    public sealed class TerrainGenerationRecipe : ScriptableObject, ISerializationCallbackReceiver
    {
        [SerializeField] private int generationVersion = 2;
        [SerializeField] private TerrainGenerationSettings settings = new TerrainGenerationSettings();

        public int GenerationVersion => generationVersion;
        public TerrainGenerationSettings Settings => settings;

        internal void Initialize(TerrainGenerationSettings value)
        {
            generationVersion = 2;
            settings = value?.Clone() ?? new TerrainGenerationSettings();
        }

        public void OnBeforeSerialize() { }
        public void OnAfterDeserialize()
        {
            if (generationVersion >= 2) return;
            settings ??= new TerrainGenerationSettings();
            settings.DetailEnabled = false;
            settings.ErosionEnabled = false;
            settings.ProceduralSurface = false;
            settings.WaterEnabled = false;
            generationVersion = 2;
        }
    }

}
