using System;
using System.Collections.Generic;

namespace Zyfou.ProceduralTerrains.Editor
{
    internal static class TerrainGenerationPresets
    {
        internal static TerrainGenerationSettings ApplyTerrainPreset(
            TerrainGenerationSettings source,
            TerrainGenerationPreset preset)
        {
            var result = source.Clone();
            var defaults = new TerrainGenerationSettings();
            result.Preset = preset;
            result.Height = defaults.Height;
            result.FormationSeaLevel = defaults.FormationSeaLevel;
            result.NoiseScale = defaults.NoiseScale;
            result.NoiseStrength = defaults.NoiseStrength;
            result.TerrainSmoothing = defaults.TerrainSmoothing;
            result.Octaves = defaults.Octaves;
            result.Persistence = defaults.Persistence;
            result.Lacunarity = defaults.Lacunarity;
            result.Ridge = defaults.Ridge;
            result.Warp = defaults.Warp;
            result.Falloff = defaults.Falloff;
            result.MoistureScale = defaults.MoistureScale;
            result.MoistureBias = defaults.MoistureBias;
            result.BiomeScale = defaults.BiomeScale;
            result.TemperatureBias = defaults.TemperatureBias;
            switch (preset)
            {
                case TerrainGenerationPreset.Archipelago:
                    result.Height = 420f; result.FormationSeaLevel = 78f; result.Falloff = .75f;
                    result.Ridge = .45f; result.Warp = 1.4f; result.NoiseScale = 60f;
                    result.MoistureBias = .25f; result.TemperatureBias = .25f;
                    break;
                case TerrainGenerationPreset.Alpine:
                    result.Height = 640f; result.FormationSeaLevel = 24f; result.Ridge = .92f;
                    result.Warp = .6f; result.NoiseScale = 38f; result.Persistence = .52f;
                    result.MoistureBias = -.1f; result.TemperatureBias = -.3f;
                    break;
                case TerrainGenerationPreset.Dunes:
                    result.Height = 180f; result.FormationSeaLevel = 4f; result.Ridge = .12f;
                    result.Warp = 1.8f; result.NoiseScale = 55f; result.Persistence = .42f;
                    result.MoistureBias = -.75f; result.Falloff = .35f; result.TemperatureBias = .6f;
                    break;
                case TerrainGenerationPreset.Rolling:
                    result.Height = 220f; result.FormationSeaLevel = 30f; result.Ridge = .22f;
                    result.Warp = 1.1f; result.NoiseScale = 50f; result.Persistence = .46f;
                    result.MoistureBias = .3f;
                    break;
                case TerrainGenerationPreset.Volcanic:
                    result.Height = 560f; result.FormationSeaLevel = 58f; result.Ridge = .85f;
                    result.Warp = .8f; result.NoiseScale = 30f; result.Falloff = .85f;
                    result.MoistureBias = -.2f;
                    break;
                case TerrainGenerationPreset.Canyon:
                    result.Height = 380f; result.FormationSeaLevel = 12f; result.Ridge = .55f;
                    result.Warp = 2.4f; result.NoiseScale = 42f; result.Persistence = .58f;
                    result.Lacunarity = 2.4f; result.MoistureBias = -.5f; result.Falloff = .3f;
                    result.TemperatureBias = .35f;
                    break;
                case TerrainGenerationPreset.Cartoon:
                    result.Height = 420f; result.FormationSeaLevel = 72f; result.NoiseScale = 72f;
                    result.NoiseStrength = .72f; result.TerrainSmoothing = .28f; result.Octaves = 4;
                    result.Persistence = .36f; result.Lacunarity = 1.85f; result.Ridge = .16f;
                    result.Warp = .28f; result.Falloff = .35f; result.BiomeScale = .7f;
                    result.MoistureScale = .8f;
                    break;
            }
            return result;
        }

        internal static TerrainGenerationSettings ApplyStackPreset(
            TerrainGenerationSettings source,
            TerrainStackPreset preset)
        {
            var result = source.Clone();
            result.StackPreset = preset;
            result.Layers = CreateStack(preset);
            if (preset == TerrainStackPreset.GeologicalHybrid)
            {
                result.Height = 620f; result.NoiseScale = 42f; result.NormalizeOutput = true;
                result.OutputMinimum = .05f; result.OutputMaximum = .92f;
            }
            else if (preset == TerrainStackPreset.AlpineRanges)
            {
                result.NormalizeOutput = true; result.OutputMinimum = 0f; result.OutputMaximum = 1.15f;
            }
            else if (preset == TerrainStackPreset.GraniteSpires)
            {
                result.NormalizeOutput = true; result.OutputMinimum = 0f; result.OutputMaximum = 1.25f;
            }
            else if (preset == TerrainStackPreset.FoothillRanges)
            {
                result.NormalizeOutput = true; result.OutputMinimum = 0f; result.OutputMaximum = 1.05f;
            }
            return result;
        }

        internal static TerrainNoiseLayerSettings CreateLayer(TerrainNoiseType type, string name = null)
        {
            var layer = new TerrainNoiseLayerSettings
            {
                Type = type,
                Name = name ?? type.ToString(),
                BlendMode = type == TerrainNoiseType.Legacy || type == TerrainNoiseType.Terrace
                    ? TerrainBlendMode.Replace
                    : type == TerrainNoiseType.Flow ? TerrainBlendMode.Subtract : TerrainBlendMode.Add,
                Strength = DefaultStrength(type),
                Parameters = new TerrainNoiseParameters(),
            };
            switch (type)
            {
                case TerrainNoiseType.White:
                    layer.Parameters.Scale = 8f;
                    break;
                case TerrainNoiseType.Voronoi:
                    layer.Parameters.Scale = 2f;
                    break;
                case TerrainNoiseType.Crater:
                    layer.Parameters.Scale = 1.5f;
                    break;
                case TerrainNoiseType.Dune:
                    layer.Parameters.Scale = 1.2f;
                    layer.Parameters.Sharpness = 1.4f;
                    break;
                case TerrainNoiseType.Flow:
                    layer.Parameters.Direction = 1.2f;
                    break;
                case TerrainNoiseType.DomainWarp:
                    layer.Parameters.Octaves = 4;
                    break;
            }
            return layer;
        }

        private static float DefaultStrength(TerrainNoiseType type)
        {
            switch (type)
            {
                case TerrainNoiseType.Legacy: return 1f;
                case TerrainNoiseType.Fbm: return .4f;
                case TerrainNoiseType.Ridged: return .5f;
                case TerrainNoiseType.Billow: return .4f;
                case TerrainNoiseType.Value: return .3f;
                case TerrainNoiseType.White: return .06f;
                case TerrainNoiseType.Constant: return 1f;
                case TerrainNoiseType.Voronoi: return .4f;
                case TerrainNoiseType.Crater: return .5f;
                case TerrainNoiseType.Dune: return .35f;
                case TerrainNoiseType.Flow: return .5f;
                case TerrainNoiseType.DomainWarp: return 1f;
                case TerrainNoiseType.Terrace: return 1f;
                default: return .4f;
            }
        }

        private static TerrainNoiseLayerSettings L(
            TerrainNoiseType type,
            string name,
            float strength,
            Action<TerrainNoiseParameters> configure = null,
            TerrainBlendMode? blend = null,
            params TerrainLayerMaskSettings[] masks)
        {
            var layer = CreateLayer(type, name);
            layer.Strength = strength;
            if (blend.HasValue) layer.BlendMode = blend.Value;
            configure?.Invoke(layer.Parameters);
            if (masks != null) layer.Masks.AddRange(masks);
            return layer;
        }

        private static TerrainLayerMaskSettings Mask(
            TerrainMaskType type,
            float minimum = 0f,
            float maximum = 1f,
            float falloff = .1f,
            float scale = 1f,
            float threshold = .5f,
            float softness = .12f)
        {
            return new TerrainLayerMaskSettings
            {
                Type = type, Minimum = minimum, Maximum = maximum, Falloff = falloff,
                Scale = scale, Threshold = threshold, Softness = softness,
            };
        }

        private static List<TerrainNoiseLayerSettings> CreateStack(TerrainStackPreset preset)
        {
            switch (preset)
            {
                case TerrainStackPreset.RollingHills:
                    return new List<TerrainNoiseLayerSettings>
                    {
                        L(TerrainNoiseType.Fbm, "Base", .5f, p => { p.Scale = 1f; p.Octaves = 4; }),
                        L(TerrainNoiseType.Billow, "Soft Hills", .25f, p => { p.Scale = 2.2f; p.Octaves = 3; }),
                        L(TerrainNoiseType.Fbm, "Detail", .06f, p => { p.Scale = 6f; p.Octaves = 3; }),
                    };
                case TerrainStackPreset.SharpMountains:
                    return new List<TerrainNoiseLayerSettings>
                    {
                        L(TerrainNoiseType.Fbm, "Continents", .45f, p => { p.Scale = .6f; p.Octaves = 4; }),
                        L(TerrainNoiseType.DomainWarp, "Breakup Warp", .6f, p => p.Scale = 1.2f),
                        L(TerrainNoiseType.Ridged, "Mountain Ridges", .9f, p => { p.Scale = 2.4f; p.Octaves = 5; p.Sharpness = 2.5f; }),
                        L(TerrainNoiseType.Fbm, "Small Details", .05f, p => { p.Scale = 8f; p.Octaves = 3; }),
                    };
                case TerrainStackPreset.CanyonTerraces:
                    return new List<TerrainNoiseLayerSettings>
                    {
                        L(TerrainNoiseType.Fbm, "Base", .5f, p => { p.Scale = .8f; p.Octaves = 4; }),
                        L(TerrainNoiseType.Ridged, "Mesa Edges", .35f, p => { p.Scale = 2f; p.Octaves = 4; p.Sharpness = 3f; }),
                        L(TerrainNoiseType.Terrace, "Strata", .9f, p => { p.TerraceCount = 14; p.TerraceSmoothness = .35f; }, TerrainBlendMode.Replace),
                    };
                case TerrainStackPreset.DesertDunes:
                    return new List<TerrainNoiseLayerSettings>
                    {
                        L(TerrainNoiseType.Fbm, "Base", .3f, p => { p.Scale = .6f; p.Octaves = 3; }),
                        L(TerrainNoiseType.Dune, "Dunes", .35f, p => p.Scale = 1.4f),
                        L(TerrainNoiseType.White, "Grain", .02f, p => p.Scale = 10f),
                    };
                case TerrainStackPreset.MoonCraters:
                    return new List<TerrainNoiseLayerSettings>
                    {
                        L(TerrainNoiseType.Fbm, "Regolith", .25f, p => { p.Scale = 1.2f; p.Octaves = 4; }),
                        L(TerrainNoiseType.Crater, "Large Craters", .7f, p => { p.Scale = 1f; p.Density = .5f; p.Depth = .7f; p.Rim = .35f; }),
                        L(TerrainNoiseType.Crater, "Small Craters", .35f, p => { p.Scale = 3.5f; p.Density = .4f; p.Depth = .4f; p.Rim = .2f; }),
                    };
                case TerrainStackPreset.AlienCellular:
                    return new List<TerrainNoiseLayerSettings>
                    {
                        L(TerrainNoiseType.Fbm, "Base", .3f, p => { p.Scale = .8f; p.Octaves = 3; }),
                        L(TerrainNoiseType.Voronoi, "Plates", .5f, p => { p.Scale = 1.8f; p.OutputMode = 3; }),
                        L(TerrainNoiseType.DomainWarp, "Twist", .8f, p => p.Scale = 1.5f),
                    };
                case TerrainStackPreset.IslandContinents:
                    return new List<TerrainNoiseLayerSettings>
                    {
                        L(TerrainNoiseType.Fbm, "Continents", .7f, p => { p.Scale = .4f; p.Octaves = 5; }),
                        L(TerrainNoiseType.Billow, "Coastal Hills", .15f, p => { p.Scale = 2f; p.Octaves = 3; }),
                        L(TerrainNoiseType.Fbm, "Detail", .05f, p => { p.Scale = 7f; p.Octaves = 3; }),
                    };
                case TerrainStackPreset.ErodedValleys:
                    return new List<TerrainNoiseLayerSettings>
                    {
                        L(TerrainNoiseType.Ridged, "Highlands", .7f, p => { p.Scale = 1.4f; p.Octaves = 5; p.Sharpness = 1.8f; }),
                        L(TerrainNoiseType.Flow, "River Carving", .4f, p => p.Scale = .8f, TerrainBlendMode.Subtract),
                        L(TerrainNoiseType.Fbm, "Detail", .06f, p => { p.Scale = 8f; p.Octaves = 3; }),
                    };
                case TerrainStackPreset.GeologicalHybrid:
                    return new List<TerrainNoiseLayerSettings>
                    {
                        L(TerrainNoiseType.DomainWarp, "Geological Warp", .62f, p => { p.Scale = .58f; p.Octaves = 4; }),
                        L(TerrainNoiseType.Fbm, "Terraced Massif", .68f, p => { p.Scale=.55f; p.Octaves=6; p.Persistence=.51f; p.Lacunarity=2.03f; p.Erosion=.12f; p.Warp=.18f; }),
                        L(TerrainNoiseType.Terrace, "Weathered Terraces", .68f, p => { p.TerraceCount=7; p.TerraceSmoothness=.34f; }, TerrainBlendMode.Replace),
                        L(TerrainNoiseType.Fbm, "Derivative Weathering", .2f, p => { p.Scale=.72f; p.Octaves=6; p.Persistence=.51f; p.Lacunarity=2.03f; p.Erosion=.62f; p.Warp=.25f; }),
                        L(TerrainNoiseType.Ridged, "Rock Ridges", .12f, p => { p.Scale=1.7f; p.Octaves=6; p.Persistence=.51f; p.Lacunarity=2.03f; p.Sharpness=2.25f; p.Erosion=.28f; p.Warp=.2f; }),
                        L(TerrainNoiseType.Fbm, "Fine Geological Detail", .05f, p => { p.Scale=2.9f; p.Octaves=4; p.Persistence=.48f; p.Lacunarity=2.08f; p.Erosion=.16f; }),
                    };
                case TerrainStackPreset.AlpineRanges:
                    return new List<TerrainNoiseLayerSettings>
                    {
                        L(TerrainNoiseType.Fbm, "Massif Base", .42f, p => { p.Scale=.55f; p.Octaves=4; p.Erosion=.25f; p.Warp=.45f; }),
                        L(TerrainNoiseType.DomainWarp, "Range Bend", .7f, p => { p.Scale=.9f; p.Octaves=3; }),
                        L(TerrainNoiseType.Ridged, "Eroded Ridges", .85f, p => { p.Scale=2f; p.Octaves=6; p.Sharpness=2.2f; p.Erosion=.55f; p.Warp=.4f; }),
                        L(TerrainNoiseType.Fbm, "Scree Detail", .07f, p => { p.Scale=7f; p.Octaves=3; p.Erosion=.2f; }, null, Mask(TerrainMaskType.Slope, .18f, 1f, .12f)),
                    };
                case TerrainStackPreset.GraniteSpires:
                    return new List<TerrainNoiseLayerSettings>
                    {
                        L(TerrainNoiseType.Fbm, "Valley Floor", .28f, p => { p.Scale=.7f; p.Octaves=4; p.Persistence=.48f; p.Erosion=.3f; p.Warp=.3f; }),
                        L(TerrainNoiseType.Ridged, "Spire Clusters", 1.05f, p => { p.Scale=2.6f; p.Octaves=6; p.Sharpness=3.4f; p.Erosion=.3f; p.Warp=.65f; }, null, Mask(TerrainMaskType.Noise, scale:.5f, threshold:.58f, softness:.14f)),
                        L(TerrainNoiseType.Fbm, "Talus & Scree", .09f, p => { p.Scale=6f; p.Octaves=3; p.Erosion=.15f; }, null, Mask(TerrainMaskType.Slope, .22f, 1f, .1f)),
                    };
                case TerrainStackPreset.FoothillRanges:
                    return new List<TerrainNoiseLayerSettings>
                    {
                        L(TerrainNoiseType.Fbm, "Rolling Base", .45f, p => { p.Scale=1.1f; p.Octaves=5; p.Persistence=.47f; p.Erosion=.35f; p.Warp=.35f; }),
                        L(TerrainNoiseType.DomainWarp, "Flow Warp", .5f, p => { p.Scale=1.1f; p.Octaves=3; }),
                        L(TerrainNoiseType.Ridged, "Mountain Belts", .55f, p => { p.Scale=1.6f; p.Octaves=5; p.Sharpness=1.9f; p.Erosion=.5f; p.Warp=.3f; }, null, Mask(TerrainMaskType.Noise, scale:.35f, threshold:.55f, softness:.2f)),
                        L(TerrainNoiseType.Fbm, "Soft Detail", .05f, p => { p.Scale=8f; p.Octaves=3; p.Erosion=.1f; }),
                    };
                default:
                    return new List<TerrainNoiseLayerSettings> { CreateLayer(TerrainNoiseType.Legacy, "Classic Terrain") };
            }
        }
    }
}
