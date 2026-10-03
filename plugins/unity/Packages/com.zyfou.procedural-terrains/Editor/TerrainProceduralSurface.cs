using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;

namespace Zyfou.ProceduralTerrains.Editor
{
    internal static class TerrainProceduralSurface
    {
        internal static Vector4 Weights(GeneratedHeightfield source, TerrainGenerationSettings s, int x, int z)
        {
            var left = Math.Max(0, x - 1); var right = Math.Min(source.Columns - 1, x + 1);
            var down = Math.Max(0, z - 1); var up = Math.Min(source.Rows - 1, z + 1);
            var gx = (source.Get(right, z) - source.Get(left, z)) / ((right - left) * s.Width / (source.Columns - 1));
            var gz = (source.Get(x, up) - source.Get(x, down)) / ((up - down) * s.Depth / (source.Rows - 1));
            var slope = Mathf.Atan(Mathf.Sqrt(gx * gx + gz * gz)) * Mathf.Rad2Deg;
            var altitude = source.Get(x, z) / s.Height;
            var t = s.SurfaceTransition;
            var rock = Smooth(s.RockSlope - t * 45f, s.RockSlope + t * 45f, slope);
            var snow = Smooth(s.SnowHeight - t, s.SnowHeight + t, altitude) * (1f - rock);
            var sand = (1f - Smooth(s.WaterLevel / s.Height + .025f - t * .25f,
                s.WaterLevel / s.Height + .025f + t * .25f, altitude)) * (1f - rock) * (1f - snow);
            var grass = (1f - rock) * (1f - snow) * (1f - sand);
            var weights = new Vector4(sand, grass, rock, snow);
            return weights / Mathf.Max(weights.x + weights.y + weights.z + weights.w, .000001f);
        }

        private static float Smooth(float a, float b, float value) => Mathf.SmoothStep(0f, 1f, Mathf.InverseLerp(a, b, value));

        internal static void Build(TerrainData data, GeneratedHeightfield source, TerrainGenerationSettings s,
            int tileX, int tileZ, string folder, List<string> assets)
        {
            var colors = new[] { s.SandColor, s.GrassColor, s.RockColor, s.SnowColor };
            var names = new[] { "Sand", "Grass", "Rock", "Snow" };
            var layers = new TerrainLayer[4];
            for (var role = 0; role < 4; role++)
            {
                var stem = $"Surface_{tileX}_{tileZ}_{names[role]}";
                var color = Texture(stem, colors[role], s.SurfaceNormalStrength, false, s.Seed + role * 17);
                var normal = Texture(stem + "_Normal", colors[role], s.SurfaceNormalStrength, true, s.Seed + role * 17);
                Save(color, $"{folder}/{stem}_Color.asset", assets);
                Save(normal, $"{folder}/{stem}_Normal.asset", assets);
                var layer = new TerrainLayer
                {
                    name = stem, diffuseTexture = color, normalMapTexture = normal, normalScale = 1f,
                    metallic = 0f, smoothness = role == 3 ? .28f : .15f,
                    tileSize = Vector2.one * (s.SurfaceGrain * 16f),
                    tileOffset = new Vector2(tileX * s.Width / s.TilesX, (s.TilesZ - tileZ - 1) * s.Depth / s.TilesZ),
                };
                Save(layer, $"{folder}/{stem}.terrainlayer", assets);
                layers[role] = layer;
            }
            data.terrainLayers = layers;
            var resolution = Math.Min(512, s.Resolution - 1);
            data.alphamapResolution = resolution;
            var map = new float[resolution, resolution, 4];
            for (var z = 0; z < resolution; z++)
            for (var x = 0; x < resolution; x++)
            {
                var sx = tileX * (s.Resolution - 1) + x * (s.Resolution - 1f) / (resolution - 1);
                var sz = tileZ * (s.Resolution - 1) + (resolution - 1 - z) * (s.Resolution - 1f) / (resolution - 1);
                var x0 = Mathf.FloorToInt(sx); var z0 = Mathf.FloorToInt(sz);
                var x1 = Math.Min(x0 + 1, source.Columns - 1); var z1 = Math.Min(z0 + 1, source.Rows - 1);
                var weights = Vector4.Lerp(Vector4.Lerp(Weights(source, s, x0, z0), Weights(source, s, x1, z0), sx - x0),
                    Vector4.Lerp(Weights(source, s, x0, z1), Weights(source, s, x1, z1), sx - x0), sz - z0);
                for (var role = 0; role < 4; role++) map[z, x, role] = weights[role];
            }
            data.SetAlphamaps(0, 0, map);
        }

        private static Texture2D Texture(string name, Color tint, float normalStrength, bool normal, int seed)
        {
            const int size = 256;
            var texture = new Texture2D(size, size, TextureFormat.RGBA32, true, normal)
            { name = name, wrapMode = TextureWrapMode.Repeat, filterMode = FilterMode.Trilinear };
            var pixels = new Color[size * size];
            var phase = (seed & 65535) * .013f;
            for (var y = 0; y < size; y++)
            for (var x = 0; x < size; x++)
            {
                var u = x / (float)size * Mathf.PI * 2f; var v = y / (float)size * Mathf.PI * 2f;
                var a = u * 13f + v * 7f + phase; var b = u * 5f - v * 11f + phase * .7f;
                var grain = .5f + .22f * Mathf.Sin(a) + .14f * Mathf.Sin(b) + .1f * Mathf.Sin(u * 3f + v * 2f);
                if (!normal) { pixels[y * size + x] = tint * Mathf.Lerp(.8f, 1.1f, grain); pixels[y * size + x].a = 1f; }
                else
                {
                    var n = new Vector3(-Mathf.Cos(a) * normalStrength * .4f, -Mathf.Cos(b) * normalStrength * .4f, 1f).normalized;
                    // Unity's RG/AG unpack supports this packed normal representation.
                    pixels[y * size + x] = new Color(1f, n.y * .5f + .5f, 1f, n.x * .5f + .5f);
                }
            }
            texture.SetPixels(pixels); texture.Apply(true, false);
            return texture;
        }

        internal static void Save(UnityEngine.Object asset, string requested, List<string> assets)
        {
            var path = AssetDatabase.GenerateUniqueAssetPath(requested);
            AssetDatabase.CreateAsset(asset, path); assets.Add(path);
        }
    }
}
