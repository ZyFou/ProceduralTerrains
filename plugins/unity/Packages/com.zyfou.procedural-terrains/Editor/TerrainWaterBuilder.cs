using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace Zyfou.ProceduralTerrains.Editor
{
    internal enum TerrainImportWaterMode { Source, Enabled, Disabled }

    internal static class TerrainWaterBuilder
    {
        internal static TerrainWaterPlaceholder Build(GameObject root, float width, float depth, Vector2 center,
            bool enabled, float level, Color color, string folder, List<string> assets, TerrainGenerationRecipe recipe = null)
        {
            if (float.IsNaN(level) || float.IsInfinity(level)) throw new ArgumentException("Water level must be finite.");
            var water = root.GetComponentInChildren<TerrainWaterPlaceholder>(true);
            if (water == null)
            {
                var obj = GameObject.CreatePrimitive(PrimitiveType.Plane);
                UnityEngine.Object.DestroyImmediate(obj.GetComponent<Collider>());
                obj.name = "Water Placeholder";
                obj.transform.SetParent(root.transform, false);
                water = obj.AddComponent<TerrainWaterPlaceholder>();
                Undo.RegisterCreatedObjectUndo(obj, "Create Water Placeholder");
            }
            var renderer = water.GetComponent<MeshRenderer>();
            var material = renderer.sharedMaterial;
            if (material == null || !AssetDatabase.GetAssetPath(material).StartsWith(folder + "/", StringComparison.Ordinal))
            {
                var pipeline = GraphicsSettings.currentRenderPipeline?.GetType().Name ?? "";
                var shaderName = pipeline.Contains("HDRenderPipeline") ? "HDRP/Lit" : pipeline.Contains("Universal") ? "Universal Render Pipeline/Lit" : "Standard";
                var shader = Shader.Find(shaderName) ?? Shader.Find("Unlit/Color");
                if (shader == null) throw new InvalidOperationException("No placeholder water shader is available.");
                material = new Material(shader) { name = "Water Placeholder" };
                TerrainProceduralSurface.Save(material, $"{folder}/WaterPlaceholder.mat", assets);
                renderer.sharedMaterial = material;
            }
            Undo.RecordObject(water, "Update Water Placeholder");
            Undo.RecordObject(water.transform, "Update Water Placeholder");
            Undo.RecordObject(material, "Update Water Placeholder");
            water.transform.localPosition = new Vector3(center.x, level, center.y);
            water.transform.localScale = new Vector3(width / 10f, 1f, depth / 10f);
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            water.Configure(enabled, level, color, recipe);
            EditorUtility.SetDirty(water); EditorUtility.SetDirty(material);
            return water;
        }
    }

    [CustomEditor(typeof(TerrainWaterPlaceholder))]
    internal sealed class TerrainWaterPlaceholderInspector : UnityEditor.Editor
    {
        public override void OnInspectorGUI()
        {
            serializedObject.Update();
            EditorGUI.BeginChangeCheck();
            EditorGUILayout.PropertyField(serializedObject.FindProperty("visible"));
            EditorGUILayout.PropertyField(serializedObject.FindProperty("level"));
            EditorGUILayout.PropertyField(serializedObject.FindProperty("color"));
            var changed = EditorGUI.EndChangeCheck();
            var water = (TerrainWaterPlaceholder)target;
            if (changed)
            {
                if (water.Recipe != null) Undo.RecordObject(water.Recipe, "Edit Water Settings");
                var material = water.GetComponent<MeshRenderer>()?.sharedMaterial;
                if (material != null) Undo.RecordObject(material, "Edit Water Color");
                Undo.RecordObject(water.transform, "Edit Water Level");
                serializedObject.ApplyModifiedProperties(); water.Apply(); water.SyncRecipe();
                if (water.Recipe != null) EditorUtility.SetDirty(water.Recipe);
                if (material != null) EditorUtility.SetDirty(material);
            }
            EditorGUILayout.HelpBox("Flat placeholder water. Visibility and level update immediately without regenerating terrain.", MessageType.Info);
        }
    }
}
