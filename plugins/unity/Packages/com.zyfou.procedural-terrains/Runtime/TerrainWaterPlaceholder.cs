using UnityEngine;

namespace Zyfou.ProceduralTerrains
{
    [ExecuteAlways, DisallowMultipleComponent]
    public sealed class TerrainWaterPlaceholder : MonoBehaviour
    {
        [SerializeField] private bool visible = true;
        [SerializeField] private float level = 100f;
        [SerializeField] private Color color = new Color(.025f, .22f, .35f);
        [SerializeField] private TerrainGenerationRecipe recipe;
        public bool Visible => visible;
        public float Level => level;
        public Color Color => color;
        public TerrainGenerationRecipe Recipe => recipe;

        public void Configure(bool enabled, float height, Color tint, TerrainGenerationRecipe source = null)
        {
            visible = enabled; level = height; color = tint; recipe = source;
            Apply();
            SyncRecipe();
        }

        private void OnEnable() => Apply();
        private void OnValidate() => Apply();
        public void Apply()
        {
            var position = transform.localPosition;
            position.y = level;
            transform.localPosition = position;
            var renderer = GetComponent<MeshRenderer>();
            if (renderer != null)
            {
                renderer.enabled = visible;
                if (renderer.sharedMaterial != null)
                {
                    // Per-assembly material, persisted as an asset by the editor builder.
                    renderer.sharedMaterial.color = color;
                    if (renderer.sharedMaterial.HasProperty("_BaseColor")) renderer.sharedMaterial.SetColor("_BaseColor", color);
                }
            }
        }

        internal void SyncRecipe()
        {
            if (recipe != null)
            {
                recipe.Settings.WaterEnabled = visible;
                recipe.Settings.WaterLevel = level;
                recipe.Settings.WaterColor = color;
            }
        }
    }
}
