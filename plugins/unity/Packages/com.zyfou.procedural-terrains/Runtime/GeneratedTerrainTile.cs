using UnityEngine;

namespace Zyfou.ProceduralTerrains
{
    [DisallowMultipleComponent]
    [AddComponentMenu("")]
    public sealed class GeneratedTerrainTile : MonoBehaviour
    {
        [SerializeField] private int tileX;
        [SerializeField] private int tileZ;
        public int TileX => tileX;
        public int TileZ => tileZ;

        internal void Initialize(int x, int z)
        {
            tileX = x;
            tileZ = z;
        }
    }
}
