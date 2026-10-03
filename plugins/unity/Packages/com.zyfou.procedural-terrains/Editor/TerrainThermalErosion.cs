using System;
using UnityEngine;

namespace Zyfou.ProceduralTerrains.Editor
{
    internal static class TerrainThermalErosion
    {
        internal static void Apply(float[] heights, int columns, int rows, float dx, float dz,
            int iterations, float strength, float angle, Func<float, bool> cancel = null)
        {
            var delta = new float[heights.Length];
            var talus = Mathf.Tan(angle * Mathf.Deg2Rad);
            for (var pass = 0; pass < iterations; pass++)
            {
                if (cancel != null && cancel(pass / (float)Math.Max(1, iterations)))
                    throw new OperationCanceledException("Thermal erosion was cancelled.");
                Array.Clear(delta, 0, delta.Length);
                for (var z = 1; z < rows - 1; z++)
                for (var x = 1; x < columns - 1; x++)
                {
                    var i = z * columns + x;
                    var target = -1;
                    var excess = 0f;
                    Consider(i - 1, x > 1, dx, heights, i, talus, ref target, ref excess);
                    Consider(i + 1, x < columns - 2, dx, heights, i, talus, ref target, ref excess);
                    Consider(i - columns, z > 1, dz, heights, i, talus, ref target, ref excess);
                    Consider(i + columns, z < rows - 2, dz, heights, i, talus, ref target, ref excess);
                    if (target < 0) continue;
                    var amount = excess * strength * .125f;
                    delta[i] -= amount;
                    delta[target] += amount;
                }
                for (var i = 0; i < heights.Length; i++) heights[i] += delta[i];
            }
        }

        private static void Consider(int neighbor, bool allowed, float distance, float[] heights,
            int index, float talus, ref int target, ref float excess)
        {
            if (!allowed) return;
            var value = heights[index] - heights[neighbor] - talus * distance;
            if (value > excess) { excess = value; target = neighbor; }
        }
    }
}
