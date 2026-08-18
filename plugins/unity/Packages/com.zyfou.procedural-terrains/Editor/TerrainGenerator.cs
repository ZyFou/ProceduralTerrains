using System;
using System.Collections.Generic;
using UnityEngine;

namespace Zyfou.ProceduralTerrains.Editor
{
    internal sealed class GeneratedHeightfield
    {
        internal int Columns { get; }
        internal int Rows { get; }
        internal float[] Heights { get; }
        internal float MaximumHeight { get; }

        internal GeneratedHeightfield(int columns, int rows, float[] heights, float maximumHeight)
        {
            Columns = columns;
            Rows = rows;
            Heights = heights;
            MaximumHeight = maximumHeight;
        }

        internal float Get(int x, int z) => Heights[z * Columns + x];
    }

    internal static class TerrainGenerator
    {
        private struct DerivativeNoise
        {
            internal float Value;
            internal float X;
            internal float Y;
        }

        private struct Climate
        {
            internal float Desert;
            internal float Canyon;
            internal float Wetland;
            internal float Mountains;
        }

        internal static void Validate(TerrainGenerationSettings settings)
        {
            if (settings == null) throw new ArgumentNullException(nameof(settings));
            if (string.IsNullOrWhiteSpace(settings.ProjectName)) throw new ArgumentException("Project name is required.");
            if (settings.Width <= 0f || settings.Depth <= 0f || settings.Height <= 0f)
                throw new ArgumentException("Terrain width, depth, and height must be positive.");
            if (settings.TilesX < 1 || settings.TilesX > 16 || settings.TilesZ < 1 || settings.TilesZ > 16)
                throw new ArgumentException("Tile counts must be between 1 and 16.");
            if (settings.Resolution != 65 && settings.Resolution != 129 && settings.Resolution != 257
                && settings.Resolution != 513 && settings.Resolution != 1025)
                throw new ArgumentException("Terrain resolution must be 65, 129, 257, 513, or 1025.");
            if (settings.SampleCount > TerrainGenerationSettings.MaximumSamples)
                throw new ArgumentException($"Terrain would contain {settings.SampleCount:N0} samples; the limit is {TerrainGenerationSettings.MaximumSamples:N0}.");
            if (settings.Layers == null || settings.Layers.FindAll(layer => layer != null && layer.Enabled).Count == 0)
                throw new ArgumentException("At least one terrain layer must be enabled.");
            if (settings.Layers.Count > TerrainGenerationSettings.MaximumLayers)
                throw new ArgumentException($"Noise Stacks support at most {TerrainGenerationSettings.MaximumLayers} layers.");
            if (settings.NormalizeOutput && settings.OutputMaximum <= settings.OutputMinimum)
                throw new ArgumentException("Output maximum must be greater than output minimum.");
            if (settings.NoiseScale <= 0f || settings.NoiseStrength < 0f || settings.NoiseStrength > 4f)
                throw new ArgumentException("Noise scale must be positive and noise strength must be between 0 and 4.");
            if (settings.TerrainSmoothing < 0f || settings.TerrainSmoothing > 1f
                || settings.Falloff < 0f || settings.Falloff > 1f)
                throw new ArgumentException("Terrain smoothing and edge falloff must be between 0 and 1.");
            if (settings.Octaves < 1 || settings.Octaves > 8 || settings.Persistence <= 0f
                || settings.Lacunarity <= 1f || settings.MoistureScale <= 0f || settings.BiomeScale <= 0f)
                throw new ArgumentException("Global octave, persistence, lacunarity, moisture, or biome settings are outside their supported range.");
            foreach (var layer in settings.Layers)
            {
                if (layer == null) throw new ArgumentException("Noise Stack contains an empty layer.");
                if (layer.Opacity < 0f || layer.Opacity > 1f)
                    throw new ArgumentException($"Layer {layer.Name} opacity must be between 0 and 1.");
                var parameters = layer.Parameters;
                if (parameters == null) throw new ArgumentException($"Layer {layer.Name} has no parameter block.");
                if (layer.Type != TerrainNoiseType.Constant && layer.Type != TerrainNoiseType.Legacy
                    && layer.Type != TerrainNoiseType.Terrace && parameters.Scale <= 0f)
                    throw new ArgumentException($"Layer {layer.Name} scale must be positive.");
                if (parameters.Octaves < 1 || parameters.Octaves > 8)
                    throw new ArgumentException($"Layer {layer.Name} octaves must be between 1 and 8.");
            }
        }

        internal static GeneratedHeightfield Generate(
            TerrainGenerationSettings settings,
            Func<float, bool> cancel = null)
        {
            Validate(settings);
            var columns = checked(settings.TilesX * (settings.Resolution - 1) + 1);
            var rows = checked(settings.TilesZ * (settings.Resolution - 1) + 1);
            var count = checked(columns * rows);
            var worldX = new float[count];
            var worldY = new float[count];
            var px = new float[count];
            var py = new float[count];
            var accumulated = new float[count];
            SeedOffsets(settings.Seed, out var seedX, out var seedY);
            var tileWidth = settings.Width / settings.TilesX;
            var tileDepth = settings.Depth / settings.TilesZ;
            var frequency = settings.NoiseScale * .1f / Mathf.Max(tileWidth, tileDepth);
            for (var z = 0; z < rows; z++)
            {
                var wy = -settings.Depth * .5f + settings.Depth * z / (rows - 1f);
                for (var x = 0; x < columns; x++)
                {
                    var index = z * columns + x;
                    var wx = -settings.Width * .5f + settings.Width * x / (columns - 1f);
                    worldX[index] = wx;
                    worldY[index] = wy;
                    px[index] = wx * frequency + seedX;
                    py[index] = wy * frequency + seedY;
                }
            }

            var active = settings.Layers.FindAll(layer => layer != null && layer.Enabled);
            for (var layerIndex = 0; layerIndex < active.Count; layerIndex++)
            {
                if (cancel != null && cancel(layerIndex / (float)Mathf.Max(active.Count + 1, 1)))
                    throw new OperationCanceledException("Terrain generation was cancelled.");
                var layer = active[layerIndex];
                var parameters = layer.Parameters ?? new TerrainNoiseParameters();
                var effective = layer.Strength * layer.Opacity;
                if (layer.Type == TerrainNoiseType.DomainWarp)
                {
                    for (var index = 0; index < count; index++)
                    {
                        var wx = Fbm(px[index] * parameters.Scale + 13.7f, py[index] * parameters.Scale + 41.3f,
                            parameters.Octaves, .5f, 2f, 0f, 0f);
                        var wy = Fbm(px[index] * parameters.Scale + 87.2f, py[index] * parameters.Scale + 9.1f,
                            parameters.Octaves, .5f, 2f, 0f, 0f);
                        px[index] += (wx - .5f) * effective;
                        py[index] += (wy - .5f) * effective;
                    }
                    continue;
                }

                float[] slope = null;
                if (layer.Masks != null && layer.Masks.Exists(mask => mask != null && mask.Enabled && mask.Type == TerrainMaskType.Slope))
                    slope = CalculateSlope(accumulated, columns, rows, settings.Width, settings.Depth, settings.Height);
                var layerSeed = SeedDomainOffset(layer.SeedOffset);
                for (var index = 0; index < count; index++)
                {
                    var mask = EvaluateMask(layer.Masks, accumulated[index], px[index], py[index], slope?[index], settings);
                    if (layer.Type == TerrainNoiseType.Terrace)
                    {
                        var steps = Mathf.Max(1f, parameters.TerraceCount);
                        var t = accumulated[index] * steps;
                        var terraced = (Mathf.Floor(t) + SmoothStep(.5f - parameters.TerraceSmoothness * .5f,
                            .5f + parameters.TerraceSmoothness * .5f, Fract(t))) / steps;
                        accumulated[index] += (terraced - accumulated[index]) * effective * mask;
                        continue;
                    }
                    var lx = px[index] * parameters.Scale + layerSeed;
                    var ly = py[index] * parameters.Scale + layerSeed * 1.7f + 3.1f;
                    var value = EvaluateLayerValue(layer.Type, parameters, settings, worldX[index], worldY[index], lx, ly, accumulated[index]);
                    accumulated[index] = Blend(layer.BlendMode, accumulated[index], value * effective * mask);
                }
            }

            var maximum = 0f;
            for (var index = 0; index < count; index++)
            {
                var value = accumulated[index] * settings.NoiseStrength;
                value = PostProcess(settings, worldX[index], worldY[index], frequency, seedX, seedY, value);
                accumulated[index] = value * settings.Height;
                maximum = Mathf.Max(maximum, accumulated[index]);
            }
            if (cancel != null && cancel(1f)) throw new OperationCanceledException("Terrain generation was cancelled.");
            return new GeneratedHeightfield(columns, rows, accumulated, Mathf.Max(maximum, .0001f));
        }

        internal static float EvaluateStackSample(
            TerrainGenerationSettings settings,
            float worldX,
            float worldY,
            float? seedXOverride = null,
            float? seedYOverride = null)
        {
            Validate(settings);
            SeedOffsets(settings.Seed, out var seedX, out var seedY);
            if (seedXOverride.HasValue) seedX = seedXOverride.Value;
            if (seedYOverride.HasValue) seedY = seedYOverride.Value;
            var frequency = settings.NoiseScale * .1f / Mathf.Max(settings.Width / settings.TilesX, settings.Depth / settings.TilesZ);
            var px = worldX * frequency + seedX;
            var py = worldY * frequency + seedY;
            var accumulated = 0f;
            foreach (var layer in settings.Layers)
            {
                if (layer == null || !layer.Enabled) continue;
                var parameters = layer.Parameters ?? new TerrainNoiseParameters();
                var effective = layer.Strength * layer.Opacity;
                if (layer.Type == TerrainNoiseType.DomainWarp)
                {
                    var wx = Fbm(px * parameters.Scale + 13.7f, py * parameters.Scale + 41.3f, parameters.Octaves, .5f, 2f, 0f, 0f);
                    var wy = Fbm(px * parameters.Scale + 87.2f, py * parameters.Scale + 9.1f, parameters.Octaves, .5f, 2f, 0f, 0f);
                    px += (wx - .5f) * effective;
                    py += (wy - .5f) * effective;
                    continue;
                }
                var mask = EvaluateMask(layer.Masks, accumulated, px, py, null, settings);
                if (layer.Type == TerrainNoiseType.Terrace)
                {
                    var steps = Mathf.Max(1f, parameters.TerraceCount);
                    var t = accumulated * steps;
                    var terraced = (Mathf.Floor(t) + SmoothStep(.5f - parameters.TerraceSmoothness * .5f,
                        .5f + parameters.TerraceSmoothness * .5f, Fract(t))) / steps;
                    accumulated += (terraced - accumulated) * effective * mask;
                    continue;
                }
                var seed = SeedDomainOffset(layer.SeedOffset);
                var value = EvaluateLayerValue(layer.Type, parameters, settings, worldX, worldY,
                    px * parameters.Scale + seed, py * parameters.Scale + seed * 1.7f + 3.1f, accumulated);
                accumulated = Blend(layer.BlendMode, accumulated, value * effective * mask);
            }
            return accumulated * settings.NoiseStrength;
        }

        private static float[] CalculateSlope(float[] source, int columns, int rows, float width, float depth, float height)
        {
            var result = new float[source.Length];
            var dx = width / Mathf.Max(columns - 1, 1);
            var dz = depth / Mathf.Max(rows - 1, 1);
            for (var z = 0; z < rows; z++)
            {
                for (var x = 0; x < columns; x++)
                {
                    var left = source[z * columns + Mathf.Max(0, x - 1)];
                    var right = source[z * columns + Mathf.Min(columns - 1, x + 1)];
                    var down = source[Mathf.Max(0, z - 1) * columns + x];
                    var up = source[Mathf.Min(rows - 1, z + 1) * columns + x];
                    var gx = (right - left) / (dx * (x > 0 && x < columns - 1 ? 2f : 1f));
                    var gz = (up - down) / (dz * (z > 0 && z < rows - 1 ? 2f : 1f));
                    result[z * columns + x] = Mathf.Sqrt(gx * gx + gz * gz) * height;
                }
            }
            return result;
        }

        private static float EvaluateMask(
            IReadOnlyList<TerrainLayerMaskSettings> masks,
            float accumulated,
            float px,
            float py,
            float? slope,
            TerrainGenerationSettings settings)
        {
            var result = 1f;
            if (masks == null) return result;
            foreach (var mask in masks)
            {
                if (mask == null || !mask.Enabled) continue;
                float value;
                switch (mask.Type)
                {
                    case TerrainMaskType.Height:
                        value = SmoothStep(mask.Minimum - mask.Falloff, mask.Minimum + mask.Falloff, accumulated)
                            * SmoothStep(mask.Maximum + mask.Falloff, mask.Maximum - mask.Falloff, accumulated);
                        break;
                    case TerrainMaskType.Noise:
                        value = SmoothStep(mask.Threshold - mask.Softness, mask.Threshold + mask.Softness,
                            ValueNoise(px * mask.Scale + 53.2f, py * mask.Scale + 11.7f));
                        break;
                    case TerrainMaskType.Slope:
                        if (!slope.HasValue) value = 1f;
                        else value = SmoothStep(mask.Minimum - mask.Falloff, mask.Minimum + mask.Falloff, slope.Value)
                            * SmoothStep(mask.Maximum + mask.Falloff, mask.Maximum - mask.Falloff, slope.Value);
                        break;
                    case TerrainMaskType.Biome:
                        var climate = EvaluateClimate(px, py, settings.BiomeScale, settings.MoistureScale,
                            settings.MoistureBias, settings.TemperatureBias);
                        value = mask.Biome == 1 ? climate.Canyon : mask.Biome == 2 ? climate.Wetland
                            : mask.Biome == 3 ? climate.Mountains : climate.Desert;
                        break;
                    default:
                        value = 1f;
                        break;
                }
                result *= mask.Invert ? 1f - value : value;
            }
            return Mathf.Clamp01(result);
        }

        private static float EvaluateLayerValue(
            TerrainNoiseType type,
            TerrainNoiseParameters p,
            TerrainGenerationSettings settings,
            float worldX,
            float worldY,
            float x,
            float y,
            float accumulated)
        {
            switch (type)
            {
                case TerrainNoiseType.Legacy: return Legacy(settings, worldX, worldY);
                case TerrainNoiseType.Fbm: return Fbm(x, y, p.Octaves, p.Persistence, p.Lacunarity, p.Erosion, p.Warp);
                case TerrainNoiseType.Ridged: return Ridged(x, y, p.Octaves, p.Persistence, p.Lacunarity, p.Sharpness, p.Erosion, p.Warp);
                case TerrainNoiseType.Billow: return Billow(x, y, p.Octaves, p.Persistence, p.Lacunarity, p.Erosion, p.Warp);
                case TerrainNoiseType.Value: return ValueNoise(x, y);
                case TerrainNoiseType.White:
                    var block = Hash12(Mathf.Floor(x) + .5f, Mathf.Floor(y) + .5f);
                    return Mathf.Lerp(block, ValueNoise(x, y), p.Smoothing);
                case TerrainNoiseType.Constant: return p.Value;
                case TerrainNoiseType.Voronoi: return Voronoi(x, y, p.Jitter, p.DistanceMode, p.OutputMode);
                case TerrainNoiseType.Crater: return Crater(x, y, p.Density, p.Depth, p.Rim, p.RimWidth);
                case TerrainNoiseType.Dune: return Dune(x, y, p);
                case TerrainNoiseType.Flow: return Flow(x, y, p);
                default: return accumulated;
            }
        }

        private static float PostProcess(
            TerrainGenerationSettings s,
            float worldX,
            float worldY,
            float frequency,
            float seedX,
            float seedY,
            float height)
        {
            var smoothing = Mathf.Clamp01(s.TerrainSmoothing);
            if (smoothing > .0001f)
            {
                var normalized = Mathf.Clamp01(height / 1.35f);
                var peak = Mathf.Max(normalized - .42f, 0f);
                var peakMask = SmoothStep(.42f, .72f, normalized);
                var compressed = .42f + peak / (1f + smoothing * 3.2f * peak / .58f);
                height = Mathf.Lerp(height, compressed * 1.35f, peakMask * smoothing);
            }
            if (s.Falloff > 0f)
            {
                var ex = Mathf.Abs(worldX) / (s.Width * .5f);
                var ey = Mathf.Abs(worldY) / (s.Depth * .5f);
                float rim;
                if (s.TilesX > 1 || s.TilesZ > 1)
                {
                    var distanceX = s.Width * .5f - Mathf.Abs(worldX);
                    var distanceY = s.Depth * .5f - Mathf.Abs(worldY);
                    rim = SmoothStep(0f, s.Falloff * (s.Width / s.TilesX), distanceX)
                        * SmoothStep(0f, s.Falloff * (s.Depth / s.TilesZ), distanceY);
                }
                else
                {
                    var edge = Mathf.Max(ex, ey) * .5f + Mathf.Sqrt(ex * ex + ey * ey) * .7071f * .5f;
                    rim = SmoothStep(0f, 1f, Mathf.Clamp01((1f - edge) / s.Falloff));
                }
                if (s.EdgeProfile == TerrainEdgeProfile.Mountains)
                {
                    var px = worldX * frequency + seedX + 173.7f;
                    var py = worldY * frequency + seedY + 419.2f;
                    var mountains = Mathf.Pow(Ridged(px * 2.35f, py * 2.35f, s.Octaves, s.Persistence, s.Lacunarity, 2f, 0f, 0f), 1.25f);
                    var breakup = ValueNoise(px * 5.1f + 61.4f, py * 5.1f + 27.8f);
                    height += (mountains * .55f + breakup * .12f) * (1f - rim) * s.NoiseStrength * s.Falloff;
                }
                else height *= rim;
            }
            if (s.NormalizeOutput)
            {
                var value = (height - s.OutputMinimum) / Mathf.Max(s.OutputMaximum - s.OutputMinimum, .0001f);
                height = value <= 0f ? 0f : value <= 1f ? value
                    : Mathf.Min(1.35f, 1f + .35f * (1f - Mathf.Exp(-(value - 1f) / .35f)));
            }
            else height = Mathf.Clamp(height, 0f, 1.35f);
            return height;
        }

        private static float Legacy(TerrainGenerationSettings s, float worldX, float worldY)
        {
            SeedOffsets(s.Seed, out var seedX, out var seedY);
            var frequency = s.NoiseScale * .1f / Mathf.Max(s.Width / s.TilesX, s.Depth / s.TilesZ);
            var px = worldX * frequency + seedX;
            var py = worldY * frequency + seedY;
            var climate = EvaluateClimate(px, py, s.BiomeScale, s.MoistureScale, s.MoistureBias, s.TemperatureBias);
            var wx = Fbm(px + 13.7f, py + 41.3f, 4, s.Persistence, s.Lacunarity, 0f, 0f);
            var wy = Fbm(px + 87.2f, py + 9.1f, 4, s.Persistence, s.Lacunarity, 0f, 0f);
            var warp = s.Warp * (1f - climate.Canyon * .5f);
            var qx = px + (wx - .5f) * warp;
            var qy = py + (wy - .5f) * warp;
            var basis = Fbm(qx, qy, s.Octaves, s.Persistence, s.Lacunarity, 0f, 0f);
            var height = basis * (.30f * (1f - climate.Desert * .45f) * (1f - climate.Wetland * .75f)) + .06f;
            var dune = 1f - Mathf.Abs(ValueNoise(qx * 2.2f + qy * .4f + 311.7f, qy * .8f + 89.1f) * 2f - 1f);
            height += dune * dune * .05f * climate.Desert;
            var ridge = Ridged(qx * 1.7f + 31.4f, qy * 1.7f + 27.2f, s.Octaves, s.Persistence, s.Lacunarity, 2f, 0f, 0f);
            var ridgeShape = Mathf.Pow(ridge, 1.35f) * (1f - s.TerrainSmoothing)
                + Mathf.Pow(ridge, .62f) * .58f * s.TerrainSmoothing;
            var chain = SmoothStep(.34f, .66f, Fbm(qx * .35f + 5.1f, qy * .35f + 17.7f, 4, s.Persistence, s.Lacunarity, 0f, 0f));
            var mountains = chain * (.35f + .65f * climate.Mountains) * (1f - climate.Desert * .85f) * (1f - climate.Wetland);
            height += ridgeShape * mountains * s.Ridge * (1.15f * (1f - s.TerrainSmoothing) + .82f * s.TerrainSmoothing);
            var sea = s.FormationSeaLevel / Mathf.Max(s.Height, 1f);
            height = height * (1f - climate.Wetland * .85f) + (sea + .012f + basis * .03f) * climate.Wetland * .85f;
            var t = height * 14f;
            var terrace = (Mathf.Floor(t) + SmoothStep(.2f, .8f, Fract(t))) / 14f;
            return height * (1f - climate.Canyon * .75f) + terrace * climate.Canyon * .75f;
        }

        private static Climate EvaluateClimate(float px, float py, float biomeScale, float moistureScale, float moistureBias, float temperatureBias)
        {
            var bx = px * biomeScale;
            var by = py * biomeScale;
            var cont = ClimateFbm(bx * .085f + 211.3f, by * .085f + 57.9f);
            var temp = Mathf.Clamp01(ClimateFbm(bx * .15f + 71.7f, by * .15f + 313.1f) * 1.5f - .25f + temperatureBias);
            var moist = Mathf.Clamp01(ClimateFbm(bx * .13f * moistureScale + 91.7f, by * .13f * moistureScale + 53.9f) * 1.5f - .25f + moistureBias);
            var erosion = ClimateFbm(bx * .19f + 157.1f, by * .19f + 423.7f);
            var region = ClimateFbm(px * .7f + 631.4f, py * .7f + 199.2f);
            var jitter = (region - .5f) * .16f;
            var hot = SmoothStep(.52f, .74f, temp + jitter);
            var dry = SmoothStep(.55f, .30f, moist - jitter);
            var wet = SmoothStep(.55f, .78f, moist + jitter);
            var low = SmoothStep(.55f, .32f, cont);
            var eroded = SmoothStep(.40f, .70f, erosion + jitter * .5f);
            return new Climate
            {
                Desert = hot * dry * (1f - eroded * .55f),
                Canyon = dry * eroded * SmoothStep(.3f, .55f, cont),
                Wetland = wet * low * (1f - hot * .4f),
                Mountains = SmoothStep(.38f, .62f, cont) * (1f - eroded * .7f),
            };
        }

        private static float ClimateFbm(float x, float y)
        {
            var value = ValueNoise(x, y) * .55f;
            Rotate(ref x, ref y, 2.13f); value += ValueNoise(x, y) * .30f;
            Rotate(ref x, ref y, 2.13f); value += ValueNoise(x, y) * .15f;
            return value;
        }

        private static float Fbm(float x, float y, int octaves, float persistence, float lacunarity, float erosion, float warp)
        {
            var total = 0f; var norm = 0f; var amplitude = .5f; var derivativeX = 0f; var derivativeY = 0f;
            for (var octave = 0; octave < Mathf.Clamp(octaves, 1, 8); octave++)
            {
                if (erosion > 0f || warp > 0f)
                {
                    var noise = DerivativeValueNoise(x + derivativeX * warp, y + derivativeY * warp);
                    var damp = 1f / (1f + Mathf.Max(0f, erosion) * 4f * (derivativeX * derivativeX + derivativeY * derivativeY));
                    total += amplitude * noise.Value * damp; norm += amplitude * damp;
                    derivativeX += noise.X * amplitude; derivativeY += noise.Y * amplitude;
                }
                else { total += amplitude * ValueNoise(x, y); norm += amplitude; }
                amplitude *= persistence; Rotate(ref x, ref y, lacunarity);
            }
            return total / Mathf.Max(norm, .0001f);
        }

        private static float Ridged(float x, float y, int octaves, float persistence, float lacunarity, float sharpness, float erosion, float warp)
        {
            var total = 0f; var norm = 0f; var amplitude = .5f; var carry = 1f; var derivativeX = 0f; var derivativeY = 0f;
            for (var octave = 0; octave < Mathf.Clamp(octaves, 1, 8); octave++)
            {
                var noise = DerivativeValueNoise(x + derivativeX * warp, y + derivativeY * warp);
                var raw = noise.Value * 2f - 1f;
                var ridge = Mathf.Max(1f - Mathf.Abs(raw), 0f);
                var value = Mathf.Pow(ridge, sharpness);
                var damp = 1f / (1f + Mathf.Max(0f, erosion) * 4f * (derivativeX * derivativeX + derivativeY * derivativeY));
                var previousCarry = carry;
                total += amplitude * value * previousCarry * damp; norm += amplitude * damp;
                var sign = raw < 0f ? 1f : -1f;
                var derivativeScale = sign * 2f * sharpness * Mathf.Pow(Mathf.Max(ridge, .0001f), sharpness - 1f) * amplitude * previousCarry;
                derivativeX += noise.X * derivativeScale; derivativeY += noise.Y * derivativeScale;
                carry = Mathf.Clamp01(value * 1.4f); amplitude *= persistence; Rotate(ref x, ref y, lacunarity);
            }
            return total / Mathf.Max(norm, .0001f);
        }

        private static float Billow(float x, float y, int octaves, float persistence, float lacunarity, float erosion, float warp)
        {
            var total = 0f; var norm = 0f; var amplitude = .5f; var derivativeX = 0f; var derivativeY = 0f;
            for (var octave = 0; octave < Mathf.Clamp(octaves, 1, 8); octave++)
            {
                var noise = DerivativeValueNoise(x + derivativeX * warp, y + derivativeY * warp);
                var raw = noise.Value * 2f - 1f;
                var damp = 1f / (1f + Mathf.Max(0f, erosion) * 4f * (derivativeX * derivativeX + derivativeY * derivativeY));
                total += amplitude * Mathf.Abs(raw) * damp; norm += amplitude * damp;
                var sign = raw < 0f ? -1f : 1f;
                derivativeX += sign * 2f * noise.X * amplitude; derivativeY += sign * 2f * noise.Y * amplitude;
                amplitude *= persistence; Rotate(ref x, ref y, lacunarity);
            }
            return total / Mathf.Max(norm, .0001f);
        }

        private static float Voronoi(float x, float y, float jitter, int distanceMode, int outputMode)
        {
            var ix = Mathf.Floor(x); var iy = Mathf.Floor(y); var fx = x - ix; var fy = y - iy;
            var f1 = 8f; var f2 = 8f; var cell = 0f;
            for (var oy = -1; oy <= 1; oy++) for (var ox = -1; ox <= 1; ox++)
            {
                var rx = ox + Hash12(ix + ox, iy + oy) * jitter - fx;
                var ry = oy + Hash12(ix + ox + 41.3f, iy + oy + 13.7f) * jitter - fy;
                var distance = distanceMode == 0 ? rx * rx + ry * ry
                    : distanceMode == 1 ? Mathf.Abs(rx) + Mathf.Abs(ry) : Mathf.Max(Mathf.Abs(rx), Mathf.Abs(ry));
                if (distance < f1) { f2 = f1; f1 = distance; cell = Hash12(ix + ox + 7.1f, iy + oy + 91.7f); }
                else if (distance < f2) f2 = distance;
            }
            var d1 = distanceMode == 0 ? Mathf.Sqrt(f1) : f1;
            var d2 = distanceMode == 0 ? Mathf.Sqrt(f2) : f2;
            if (outputMode == 0) return Mathf.Clamp01(cell);
            if (outputMode == 1) return Mathf.Clamp01(d1);
            if (outputMode == 2) return Mathf.Clamp01(d2 - d1);
            return Mathf.Clamp01(1f - (d2 - d1) * 3f);
        }

        private static float Crater(float x, float y, float density, float depth, float rim, float rimWidth)
        {
            var ix = Mathf.Floor(x); var iy = Mathf.Floor(y); var fx = x - ix; var fy = y - iy;
            var best = 8f; var random = 0f;
            for (var oy = -1; oy <= 1; oy++) for (var ox = -1; ox <= 1; ox++)
            {
                var dx = ox + Hash12(ix + ox, iy + oy) - fx;
                var dy = oy + Hash12(ix + ox + 23.7f, iy + oy + 5.9f) - fy;
                var distance = Mathf.Sqrt(dx * dx + dy * dy);
                if (distance < best) { best = distance; random = Hash12(ix + ox + 61.1f, iy + oy + 7.3f); }
            }
            var radius = .18f + .28f * Hash12(ix + random * 17f, iy + random * 17f);
            var t = best / Mathf.Max(radius, .02f);
            var bowl = -depth * (1f - SmoothStep(0f, 1f, t));
            var rimValue = rim * Mathf.Exp(-Mathf.Pow((t - 1f) / Mathf.Max(rimWidth, .02f), 2f));
            return random > density ? 0f : bowl + rimValue;
        }

        private static float Dune(float x, float y, TerrainNoiseParameters p)
        {
            var dx = Mathf.Cos(p.Direction); var dy = Mathf.Sin(p.Direction);
            var across = x * -dy + y * dx; var along = x * dx + y * dy;
            var warp = (ValueNoise(x * .5f, y * .5f) - .5f) * 2f;
            var dunes = Mathf.Pow(Mathf.Clamp01(1f - Mathf.Abs(Mathf.Sin(across + warp))), Mathf.Max(p.Sharpness, .1f));
            var ripples = (ValueNoise(across * p.RippleScale, along * .3f) - .5f) * p.RippleStrength;
            return Mathf.Clamp01(dunes + ripples);
        }

        private static float Flow(float x, float y, TerrainNoiseParameters p)
        {
            var dx = Mathf.Cos(p.Direction); var dy = Mathf.Sin(p.Direction);
            var along = x * dx + y * dy; var across = x * -dy + y * dx;
            across += (ValueNoise(along * p.MeanderScale, 13.1f) - .5f) * p.Meander;
            return Mathf.Clamp01(Mathf.Exp(-Mathf.Pow(across / Mathf.Max(p.Width, .02f), 2f)));
        }

        private static float Blend(TerrainBlendMode mode, float accumulated, float value)
        {
            switch (mode)
            {
                case TerrainBlendMode.Subtract: return accumulated - value;
                case TerrainBlendMode.Multiply: return accumulated * (1f + value);
                case TerrainBlendMode.Divide:
                    var divisor = Mathf.Abs(value) < .001f ? (value + .000001f < 0f ? -.001f : .001f) : value;
                    return accumulated / divisor;
                case TerrainBlendMode.Max: return Mathf.Max(accumulated, value);
                case TerrainBlendMode.Min: return Mathf.Min(accumulated, value);
                case TerrainBlendMode.Replace: return value;
                case TerrainBlendMode.Difference: return Mathf.Abs(accumulated - value);
                case TerrainBlendMode.Overlay: return accumulated < .5f ? 2f * accumulated * value : 1f - 2f * (1f - accumulated) * (1f - value);
                case TerrainBlendMode.Carve: return accumulated - Mathf.Max(value, 0f);
                case TerrainBlendMode.Flatten: return accumulated + (value - accumulated) * Mathf.Min(Mathf.Abs(value), 1f);
                default: return accumulated + value;
            }
        }

        private static float ValueNoise(float x, float y)
        {
            var ix = Mathf.Floor(x); var iy = Mathf.Floor(y); var fx = x - ix; var fy = y - iy;
            var ux = fx * fx * fx * (fx * (fx * 6f - 15f) + 10f);
            var uy = fy * fy * fy * (fy * (fy * 6f - 15f) + 10f);
            var a = Hash12(ix, iy); var b = Hash12(ix + 1f, iy); var c = Hash12(ix, iy + 1f); var d = Hash12(ix + 1f, iy + 1f);
            var top = a + (b - a) * ux; var bottom = c + (d - c) * ux;
            return top + (bottom - top) * uy;
        }

        private static DerivativeNoise DerivativeValueNoise(float x, float y)
        {
            var ix = Mathf.Floor(x); var iy = Mathf.Floor(y); var fx = x - ix; var fy = y - iy;
            var ux = fx * fx * fx * (fx * (fx * 6f - 15f) + 10f);
            var uy = fy * fy * fy * (fy * (fy * 6f - 15f) + 10f);
            var dux = 30f * fx * fx * (fx - 1f) * (fx - 1f);
            var duy = 30f * fy * fy * (fy - 1f) * (fy - 1f);
            var a = Hash12(ix, iy); var b = Hash12(ix + 1f, iy); var c = Hash12(ix, iy + 1f); var d = Hash12(ix + 1f, iy + 1f);
            var top = a + (b - a) * ux; var bottom = c + (d - c) * ux;
            return new DerivativeNoise
            {
                Value = top + (bottom - top) * uy,
                X = ((b - a) + ((d - c) - (b - a)) * uy) * dux,
                Y = (bottom - top) * duy,
            };
        }

        private static float Hash12(float x, float y)
        {
            var p3x = Fract(x * .1031f); var p3y = Fract(y * .1031f); var p3z = p3x;
            var d = p3x * (p3y + 33.33f) + p3y * (p3z + 33.33f) + p3z * (p3x + 33.33f);
            p3x += d; p3y += d; p3z += d;
            return Fract((p3x + p3y) * p3z);
        }

        private static void Rotate(ref float x, ref float y, float lacunarity)
        {
            var nextX = (.8f * x + .6f * y) * lacunarity;
            var nextY = (-.6f * x + .8f * y) * lacunarity;
            x = nextX; y = nextY;
        }

        private static float SmoothStep(float edge0, float edge1, float value)
        {
            var denominator = edge1 - edge0;
            if (Mathf.Abs(denominator) < 1e-12f) return value < edge0 ? 0f : 1f;
            var t = Mathf.Clamp01((value - edge0) / denominator);
            return t * t * (3f - 2f * t);
        }

        private static float Fract(float value) => value - Mathf.Floor(value);

        private static float SeedDomainOffset(int seed)
        {
            if (seed == 0) return 0f;
            unchecked
            {
                var hashed = (uint)seed;
                hashed = (hashed ^ hashed >> 16) * 0x7FEB352Du;
                hashed = (hashed ^ hashed >> 15) * 0x846CA68Bu;
                hashed ^= hashed >> 16;
                return (float)(hashed / 4294967296.0 * 2048.0 - 1024.0);
            }
        }

        private static void SeedOffsets(int seed, out float x, out float y)
        {
            unchecked
            {
                var state = (uint)seed;
                x = NextOffset(ref state);
                y = NextOffset(ref state);
            }
        }

        private static float NextOffset(ref uint state)
        {
            unchecked
            {
                state += 0x6D2B79F5u;
                var t = (state ^ state >> 15) * (1u | state);
                t += (t ^ t >> 7) * (61u | t);
                t ^= t >> 14;
                return (float)(t / 4294967296.0 * 2048.0 - 1024.0);
            }
        }
    }
}
