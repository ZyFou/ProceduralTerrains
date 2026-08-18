using UnityEngine;

namespace Zyfou.ProceduralTerrains
{
    [DisallowMultipleComponent]
    [AddComponentMenu("")]
    public sealed class GeneratedTerrainRoot : MonoBehaviour
    {
        [SerializeField] private TerrainGenerationRecipe recipe;
        public TerrainGenerationRecipe Recipe => recipe;
        internal void Initialize(TerrainGenerationRecipe value) => recipe = value;
    }
}
