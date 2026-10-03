using System;
using System.IO;
using UnityEditor;
using UnityEngine;

namespace Zyfou.ProceduralTerrains.Editor
{
    internal sealed class ProceduralTerrainsWindow : EditorWindow
    {
        private static readonly string[] Tabs = { "Import", "Create" };
        private int selectedTab;
        private string archivePath = string.Empty;
        private TerrainProjectAsset importedProject;
        private bool createInScene = true;
        private bool createBakedMaterials = true;
        private bool createTerrainLayers = true;
        [SerializeField] private TerrainImportWaterMode importWaterMode = TerrainImportWaterMode.Source;
        [SerializeField] private bool importWaterCustomLevel;
        [SerializeField] private float importWaterLevel = 100f;
        [SerializeField] private Color importWaterColor = new Color(.025f, .22f, .35f);
        [SerializeField] private int qualityIndex = 3;
        private Vector2 scroll;
        private string statusMessage = string.Empty;
        private MessageType statusType = MessageType.None;
        [SerializeField] private TerrainGenerationSettings generationSettings = new TerrainGenerationSettings();
        [SerializeField] private bool showAdvancedGeneration;
        [SerializeField] private int activeGenerationLayer;
        private GeneratedTerrainRoot loadedGeneratedRoot;
        private static readonly int[] GenerationResolutions = { 65, 129, 257, 513, 1025 };
        private static readonly string[] GenerationResolutionLabels =
            { "65 × 65", "129 × 129", "257 × 257", "513 × 513", "1025 × 1025" };

        [MenuItem("Window/Procedural Terrains/Terrain Importer")]
        internal static void ShowWindow()
        {
            var window = GetWindow<ProceduralTerrainsWindow>();
            window.titleContent = new GUIContent("Procedural Terrains");
            window.minSize = new Vector2(430f, 470f);
            window.Show();
        }

        private void OnGUI()
        {
            DrawHeader();
            selectedTab = GUILayout.Toolbar(selectedTab, Tabs, GUILayout.Height(28f));
            EditorGUILayout.Space(8f);
            scroll = EditorGUILayout.BeginScrollView(scroll);
            if (selectedTab == 0) DrawImportTab();
            else DrawCreateTab();
            EditorGUILayout.EndScrollView();
        }

        private static void DrawHeader()
        {
            EditorGUILayout.Space(10f);
            EditorGUILayout.LabelField("Procedural Terrains", new GUIStyle(EditorStyles.boldLabel)
            {
                fontSize = 18,
            });
            EditorGUILayout.LabelField(
                "Create seeded terrain or import a baked package as ready-to-edit Unity Terrain objects.",
                EditorStyles.wordWrappedLabel);
            EditorGUILayout.Space(8f);
        }

        private void DrawImportTab()
        {
            EditorGUILayout.LabelField("Import ZIP", EditorStyles.boldLabel);
            EditorGUILayout.HelpBox(
                "Select the ZIP exported with the Unity Terrain preset. The archive is validated and extracted into a unique folder below Assets/ProceduralTerrains/Imports.",
                MessageType.Info);

            using (new EditorGUILayout.HorizontalScope())
            {
                EditorGUILayout.TextField("Archive", archivePath);
                if (GUILayout.Button("Browse…", GUILayout.Width(84f))) BrowseArchive();
            }

            EditorGUILayout.Space(5f);
            createInScene = EditorGUILayout.ToggleLeft("Create Terrain objects in the current scene", createInScene);
            using (new EditorGUI.DisabledScope(!createInScene))
            {
                createBakedMaterials = EditorGUILayout.ToggleLeft(
                    "Create and assign pipeline-compatible Terrain Material assets",
                    createBakedMaterials);
                createTerrainLayers = EditorGUILayout.ToggleLeft(
                    "Create a baked TerrainLayer from exported textures",
                    createTerrainLayers);
                importWaterMode = (TerrainImportWaterMode)EditorGUILayout.EnumPopup("Water placeholder", importWaterMode);
                importWaterCustomLevel = EditorGUILayout.Toggle("Custom water level", importWaterCustomLevel);
                if (importWaterCustomLevel) importWaterLevel = EditorGUILayout.FloatField("Water level (m)", importWaterLevel);
                importWaterColor = EditorGUILayout.ColorField("Water color", importWaterColor);
            }

            EditorGUILayout.Space(8f);
            using (new EditorGUI.DisabledScope(string.IsNullOrWhiteSpace(archivePath)))
            {
                if (GUILayout.Button(createInScene ? "Import ZIP and Build Scene" : "Import ZIP", GUILayout.Height(34f)))
                {
                    ImportArchive();
                }
            }

            EditorGUILayout.Space(18f);
            EditorGUILayout.LabelField("Already imported", EditorStyles.boldLabel);
            EditorGUILayout.LabelField(
                "You can also rebuild scene objects from any valid project.ptrterrain asset.",
                EditorStyles.wordWrappedMiniLabel);
            importedProject = (TerrainProjectAsset)EditorGUILayout.ObjectField(
                "Project",
                importedProject,
                typeof(TerrainProjectAsset),
                false);
            using (new EditorGUI.DisabledScope(importedProject == null))
            {
                if (GUILayout.Button("Build Terrains in Current Scene", GUILayout.Height(30f)))
                {
                    BuildScene(importedProject);
                }
            }

            if (!string.IsNullOrEmpty(statusMessage))
            {
                EditorGUILayout.Space(12f);
                EditorGUILayout.HelpBox(statusMessage, statusType);
            }

            if (importedProject != null)
            {
                EditorGUILayout.Space(8f);
                DrawProjectSummary(importedProject);
            }
            DrawSelectedWater();
        }

        private void DrawCreateTab()
        {
            EditorGUILayout.LabelField("Create in Unity", EditorStyles.boldLabel);
            EditorGUILayout.HelpBox(
                "Generate native Unity TerrainData with the same deterministic presets and Noise Stack used by the Blender extension.",
                MessageType.Info);

            using (new EditorGUILayout.VerticalScope(EditorStyles.helpBox))
            {
                EditorGUILayout.LabelField("Quick setup", EditorStyles.boldLabel);
                generationSettings.ProjectName = EditorGUILayout.TextField("Project name", generationSettings.ProjectName);
                using (new EditorGUILayout.HorizontalScope())
                {
                    generationSettings.Preset = (TerrainGenerationPreset)EditorGUILayout.EnumPopup("Terrain preset", generationSettings.Preset);
                    if (GUILayout.Button("Apply", GUILayout.Width(60f)))
                        generationSettings = TerrainGenerationPresets.ApplyTerrainPreset(generationSettings, generationSettings.Preset);
                }
                generationSettings.Seed = EditorGUILayout.IntField("Seed", generationSettings.Seed);
                generationSettings.Width = Mathf.Max(.001f, EditorGUILayout.FloatField("Width (m)", generationSettings.Width));
                generationSettings.Depth = Mathf.Max(.001f, EditorGUILayout.FloatField("Depth (m)", generationSettings.Depth));
                generationSettings.Height = Mathf.Max(.001f, EditorGUILayout.FloatField("Height scale (m)", generationSettings.Height));
                using (new EditorGUILayout.HorizontalScope())
                {
                    generationSettings.TilesX = EditorGUILayout.IntSlider("Tiles X", generationSettings.TilesX, 1, 16);
                    generationSettings.TilesZ = EditorGUILayout.IntSlider("Tiles Z", generationSettings.TilesZ, 1, 16);
                }
                EditorGUI.BeginChangeCheck();
                qualityIndex = EditorGUILayout.Popup("Quality", qualityIndex, new[] { "Custom", "Draft (129)", "Standard (257)", "High (513)", "Very High (1025)" });
                if (EditorGUI.EndChangeCheck() && qualityIndex > 0) generationSettings.Resolution = GenerationResolutions[qualityIndex];
                if (qualityIndex == 0)
                {
                    var resolutionIndex = Array.IndexOf(GenerationResolutions, generationSettings.Resolution);
                    generationSettings.Resolution = GenerationResolutions[Mathf.Max(0,
                        EditorGUILayout.Popup("Resolution", Mathf.Max(0, resolutionIndex), GenerationResolutionLabels))];
                }
                generationSettings.Placement = (TerrainGenerationPlacement)EditorGUILayout.EnumPopup("Placement", generationSettings.Placement);
                generationSettings.CreatePreviewMaterial = EditorGUILayout.ToggleLeft(
                    "Create surface TerrainLayers", generationSettings.CreatePreviewMaterial);
                EditorGUILayout.LabelField($"Estimated samples: {generationSettings.SampleCount:N0}", EditorStyles.miniLabel);
                EditorGUILayout.LabelField($"Sample spacing: {generationSettings.Width / (generationSettings.TilesX * (generationSettings.Resolution - 1)):0.##} × {generationSettings.Depth / (generationSettings.TilesZ * (generationSettings.Resolution - 1)):0.##} m", EditorStyles.miniLabel);
                if (generationSettings.SampleCount > TerrainGenerationSettings.MaximumSamples)
                    EditorGUILayout.HelpBox("This exceeds the 16 million sample limit.", MessageType.Error);
                else if (generationSettings.SampleCount > 1_000_000)
                    EditorGUILayout.HelpBox("High-density generation can take substantial time and memory.", MessageType.Warning);
            }

            DrawGenerationEnhancements();
            DrawSelectedWater();
            using (new EditorGUILayout.HorizontalScope())
            {
                using (new EditorGUI.DisabledScope(generationSettings.SampleCount > TerrainGenerationSettings.MaximumSamples))
                {
                    if (GUILayout.Button("Generate Terrain", GUILayout.Height(34f))) GenerateTerrain(false);
                }
                if (GUILayout.Button("Load Selected", GUILayout.Height(34f))) LoadSelectedGeneration();
            }
            using (new EditorGUI.DisabledScope(generationSettings.SampleCount > TerrainGenerationSettings.MaximumSamples))
            {
                if (GUILayout.Button("Regenerate Selected", GUILayout.Height(30f))) GenerateTerrain(true);
            }

            showAdvancedGeneration = EditorGUILayout.Foldout(showAdvancedGeneration, "Advanced Noise Stack", true);
            if (showAdvancedGeneration) DrawAdvancedGeneration();

            if (!string.IsNullOrEmpty(statusMessage))
            {
                EditorGUILayout.Space(10f);
                EditorGUILayout.HelpBox(statusMessage, statusType);
            }
        }

        private void DrawAdvancedGeneration()
        {
            using (new EditorGUILayout.VerticalScope(EditorStyles.helpBox))
            {
                EditorGUILayout.LabelField("Global shape", EditorStyles.boldLabel);
                generationSettings.NoiseScale = EditorGUILayout.FloatField("Noise scale", generationSettings.NoiseScale);
                generationSettings.NoiseStrength = EditorGUILayout.Slider("Noise strength", generationSettings.NoiseStrength, 0f, 4f);
                generationSettings.TerrainSmoothing = EditorGUILayout.Slider("Terrain smoothing", generationSettings.TerrainSmoothing, 0f, 1f);
                generationSettings.Octaves = EditorGUILayout.IntSlider("Classic octaves", generationSettings.Octaves, 1, 8);
                generationSettings.Persistence = EditorGUILayout.Slider("Persistence", generationSettings.Persistence, .05f, .95f);
                generationSettings.Lacunarity = EditorGUILayout.Slider("Lacunarity", generationSettings.Lacunarity, 1.01f, 4f);
                generationSettings.Ridge = EditorGUILayout.Slider("Classic ridge", generationSettings.Ridge, 0f, 2f);
                generationSettings.Warp = EditorGUILayout.Slider("Classic warp", generationSettings.Warp, 0f, 4f);
                generationSettings.Falloff = EditorGUILayout.Slider("Edge falloff", generationSettings.Falloff, 0f, 1f);
                generationSettings.EdgeProfile = (TerrainEdgeProfile)EditorGUILayout.EnumPopup("Edge profile", generationSettings.EdgeProfile);
                generationSettings.FormationSeaLevel = EditorGUILayout.FloatField("Formation sea level", generationSettings.FormationSeaLevel);
                generationSettings.MoistureScale = EditorGUILayout.Slider("Moisture scale", generationSettings.MoistureScale, .01f, 4f);
                generationSettings.MoistureBias = EditorGUILayout.Slider("Moisture bias", generationSettings.MoistureBias, -1f, 1f);
                generationSettings.BiomeScale = EditorGUILayout.Slider("Biome scale", generationSettings.BiomeScale, .01f, 4f);
                generationSettings.TemperatureBias = EditorGUILayout.Slider("Temperature bias", generationSettings.TemperatureBias, -1f, 1f);
                generationSettings.NormalizeOutput = EditorGUILayout.Toggle("Normalize output", generationSettings.NormalizeOutput);
                if (generationSettings.NormalizeOutput)
                {
                    generationSettings.OutputMinimum = EditorGUILayout.FloatField("Output minimum", generationSettings.OutputMinimum);
                    generationSettings.OutputMaximum = EditorGUILayout.FloatField("Output maximum", generationSettings.OutputMaximum);
                }
            }

            using (new EditorGUILayout.VerticalScope(EditorStyles.helpBox))
            {
                EditorGUILayout.LabelField("Noise Stack", EditorStyles.boldLabel);
                using (new EditorGUILayout.HorizontalScope())
                {
                    generationSettings.StackPreset = (TerrainStackPreset)EditorGUILayout.EnumPopup("Stack preset", generationSettings.StackPreset);
                    if (GUILayout.Button("Apply", GUILayout.Width(60f)))
                    {
                        generationSettings = TerrainGenerationPresets.ApplyStackPreset(generationSettings, generationSettings.StackPreset);
                        activeGenerationLayer = 0;
                    }
                }
                generationSettings.Layers ??= new System.Collections.Generic.List<TerrainNoiseLayerSettings>();
                for (var index = 0; index < generationSettings.Layers.Count; index++)
                {
                    var layer = generationSettings.Layers[index];
                    using (new EditorGUILayout.HorizontalScope(activeGenerationLayer == index ? EditorStyles.helpBox : GUIStyle.none))
                    {
                        layer.Enabled = EditorGUILayout.Toggle(layer.Enabled, GUILayout.Width(18f));
                        if (GUILayout.Button($"{layer.Name}  ·  {layer.Type}", EditorStyles.label)) activeGenerationLayer = index;
                        using (new EditorGUI.DisabledScope(index == 0))
                            if (GUILayout.Button("▲", GUILayout.Width(24f))) { SwapLayers(index, index - 1); break; }
                        using (new EditorGUI.DisabledScope(index == generationSettings.Layers.Count - 1))
                            if (GUILayout.Button("▼", GUILayout.Width(24f))) { SwapLayers(index, index + 1); break; }
                    }
                }
                using (new EditorGUILayout.HorizontalScope())
                {
                    using (new EditorGUI.DisabledScope(generationSettings.Layers.Count >= TerrainGenerationSettings.MaximumLayers))
                    {
                        if (GUILayout.Button("Add"))
                        {
                            generationSettings.Layers.Add(TerrainGenerationPresets.CreateLayer(TerrainNoiseType.Fbm, "FBM Layer"));
                            activeGenerationLayer = generationSettings.Layers.Count - 1;
                        }
                        if (GUILayout.Button("Duplicate") && generationSettings.Layers.Count > 0)
                        {
                            var copy = generationSettings.Layers[Mathf.Clamp(activeGenerationLayer, 0, generationSettings.Layers.Count - 1)].Clone();
                            copy.Name += " Copy";
                            generationSettings.Layers.Add(copy);
                            activeGenerationLayer = generationSettings.Layers.Count - 1;
                        }
                    }
                    using (new EditorGUI.DisabledScope(generationSettings.Layers.Count == 0))
                        if (GUILayout.Button("Remove"))
                        {
                            generationSettings.Layers.RemoveAt(Mathf.Clamp(activeGenerationLayer, 0, generationSettings.Layers.Count - 1));
                            activeGenerationLayer = Mathf.Clamp(activeGenerationLayer, 0, Mathf.Max(0, generationSettings.Layers.Count - 1));
                        }
                }
            }
            if (generationSettings.Layers.Count > 0)
                DrawGenerationLayer(generationSettings.Layers[Mathf.Clamp(activeGenerationLayer, 0, generationSettings.Layers.Count - 1)]);
        }

        private void DrawGenerationEnhancements()
        {
            var s = generationSettings;
            using (new EditorGUILayout.VerticalScope(EditorStyles.helpBox))
            {
                s.DetailEnabled = EditorGUILayout.Toggle("Fine detail", s.DetailEnabled);
                using (new EditorGUI.DisabledScope(!s.DetailEnabled))
                {
                    s.DetailAmplitude = Mathf.Max(0f, EditorGUILayout.FloatField("Amplitude (m)", s.DetailAmplitude));
                    s.DetailWavelength = Mathf.Max(.001f, EditorGUILayout.FloatField("Wavelength (m)", s.DetailWavelength));
                    s.DetailSlopeInfluence = EditorGUILayout.Slider("Slope influence", s.DetailSlopeInfluence, 0f, 1f);
                }
                s.ErosionEnabled = EditorGUILayout.Toggle("Thermal erosion", s.ErosionEnabled);
                using (new EditorGUI.DisabledScope(!s.ErosionEnabled))
                {
                    s.ErosionIterations = EditorGUILayout.IntSlider("Iterations", s.ErosionIterations, 0, 200);
                    s.ErosionStrength = EditorGUILayout.Slider("Erosion strength", s.ErosionStrength, 0f, 1f);
                    s.ErosionAngle = EditorGUILayout.Slider("Stability angle (degrees)", s.ErosionAngle, 0f, 85f);
                }
            }
            using (new EditorGUILayout.VerticalScope(EditorStyles.helpBox))
            {
                s.ProceduralSurface = EditorGUILayout.Toggle("Procedural surfaces", s.ProceduralSurface);
                using (new EditorGUI.DisabledScope(!s.ProceduralSurface || !s.CreatePreviewMaterial))
                {
                    s.SandColor = EditorGUILayout.ColorField("Sand", s.SandColor);
                    s.GrassColor = EditorGUILayout.ColorField("Grass", s.GrassColor);
                    s.RockColor = EditorGUILayout.ColorField("Rock", s.RockColor);
                    s.SnowColor = EditorGUILayout.ColorField("Snow", s.SnowColor);
                    s.SurfaceGrain = Mathf.Max(.001f, EditorGUILayout.FloatField("Grain scale (m)", s.SurfaceGrain));
                    s.SurfaceNormalStrength = EditorGUILayout.Slider("Normal strength", s.SurfaceNormalStrength, 0f, 2f);
                    s.SnowHeight = EditorGUILayout.Slider("Snow height (relative)", s.SnowHeight, 0f, 1.35f);
                    s.RockSlope = EditorGUILayout.Slider("Rock slope (degrees)", s.RockSlope, 0f, 85f);
                    s.SurfaceTransition = EditorGUILayout.Slider("Transition softness", s.SurfaceTransition, .001f, 1f);
                }
            }
            using (new EditorGUILayout.VerticalScope(EditorStyles.helpBox))
            {
                s.WaterEnabled = EditorGUILayout.Toggle("Water placeholder", s.WaterEnabled);
                s.WaterLevel = EditorGUILayout.FloatField("Water level (m)", s.WaterLevel);
                s.WaterColor = EditorGUILayout.ColorField("Water color", s.WaterColor);
            }
        }

        private void DrawSelectedWater()
        {
            var selected = Selection.activeGameObject;
            if (selected == null) return;
            var water = selected.GetComponent<TerrainWaterPlaceholder>()
                ?? selected.transform.root.GetComponentInChildren<TerrainWaterPlaceholder>(true);
            if (water == null) return;
            using (new EditorGUILayout.VerticalScope(EditorStyles.helpBox))
            {
                EditorGUILayout.LabelField("Selected assembly water", EditorStyles.boldLabel);
                EditorGUI.BeginChangeCheck();
                var enabled = EditorGUILayout.Toggle("Visible", water.Visible);
                var level = EditorGUILayout.FloatField("Level (m)", water.Level);
                var color = EditorGUILayout.ColorField("Color", water.Color);
                if (EditorGUI.EndChangeCheck())
                {
                    Undo.RecordObject(water, "Edit Water Placeholder");
                    Undo.RecordObject(water.transform, "Edit Water Level");
                    if (water.Recipe != null) Undo.RecordObject(water.Recipe, "Edit Water Settings");
                    var material = water.GetComponent<MeshRenderer>().sharedMaterial;
                    Undo.RecordObject(material, "Edit Water Color");
                    water.Configure(enabled, level, color, water.Recipe);
                    EditorUtility.SetDirty(water); EditorUtility.SetDirty(material);
                    if (water.Recipe != null) EditorUtility.SetDirty(water.Recipe);
                    if (loadedGeneratedRoot != null && water.Recipe == loadedGeneratedRoot.Recipe)
                    { generationSettings.WaterEnabled = enabled; generationSettings.WaterLevel = level; generationSettings.WaterColor = color; }
                }
            }
        }

        private void DrawGenerationLayer(TerrainNoiseLayerSettings layer)
        {
            using (new EditorGUILayout.VerticalScope(EditorStyles.helpBox))
            {
                EditorGUILayout.LabelField("Selected layer", EditorStyles.boldLabel);
                layer.Name = EditorGUILayout.TextField("Name", layer.Name);
                var previousType = layer.Type;
                layer.Type = (TerrainNoiseType)EditorGUILayout.EnumPopup("Type", layer.Type);
                if (layer.Type != previousType)
                {
                    var replacement = TerrainGenerationPresets.CreateLayer(layer.Type, layer.Name);
                    layer.BlendMode = replacement.BlendMode;
                    layer.Strength = replacement.Strength;
                    layer.Parameters = replacement.Parameters;
                }
                layer.BlendMode = (TerrainBlendMode)EditorGUILayout.EnumPopup("Blend", layer.BlendMode);
                layer.Strength = EditorGUILayout.Slider("Strength", layer.Strength, -4f, 4f);
                layer.Opacity = EditorGUILayout.Slider("Opacity", layer.Opacity, 0f, 1f);
                layer.SeedOffset = EditorGUILayout.IntField("Seed offset", layer.SeedOffset);
                DrawLayerParameters(layer.Type, layer.Parameters ??= new TerrainNoiseParameters());
                EditorGUILayout.Space(4f);
                EditorGUILayout.LabelField("Layer masks", EditorStyles.boldLabel);
                layer.Masks ??= new System.Collections.Generic.List<TerrainLayerMaskSettings>();
                for (var index = 0; index < layer.Masks.Count; index++)
                {
                    using (new EditorGUILayout.VerticalScope(EditorStyles.helpBox))
                    {
                        var mask = layer.Masks[index];
                        using (new EditorGUILayout.HorizontalScope())
                        {
                            mask.Enabled = EditorGUILayout.Toggle(mask.Enabled, GUILayout.Width(18f));
                            mask.Type = (TerrainMaskType)EditorGUILayout.EnumPopup(mask.Type);
                            mask.Invert = EditorGUILayout.ToggleLeft("Invert", mask.Invert, GUILayout.Width(60f));
                            if (GUILayout.Button("×", GUILayout.Width(24f))) { layer.Masks.RemoveAt(index); break; }
                        }
                        DrawMaskParameters(mask);
                    }
                }
                if (GUILayout.Button("Add mask")) layer.Masks.Add(new TerrainLayerMaskSettings());
            }
        }

        private static void DrawLayerParameters(TerrainNoiseType type, TerrainNoiseParameters p)
        {
            if (type == TerrainNoiseType.Fbm || type == TerrainNoiseType.Ridged || type == TerrainNoiseType.Billow)
            {
                p.Scale = EditorGUILayout.Slider("Scale", p.Scale, .01f, 100f);
                p.Octaves = EditorGUILayout.IntSlider("Octaves", p.Octaves, 1, 8);
                p.Persistence = EditorGUILayout.Slider("Persistence", p.Persistence, .05f, .95f);
                p.Lacunarity = EditorGUILayout.Slider("Lacunarity", p.Lacunarity, 1.01f, 4f);
                p.Erosion = EditorGUILayout.Slider("Erosion", p.Erosion, 0f, 1f);
                p.Warp = EditorGUILayout.Slider("Self warp", p.Warp, 0f, 1.5f);
                if (type == TerrainNoiseType.Ridged) p.Sharpness = EditorGUILayout.Slider("Sharpness", p.Sharpness, .1f, 8f);
            }
            else if (type == TerrainNoiseType.Value) { p.Scale = EditorGUILayout.Slider("Scale", p.Scale, .01f, 100f); p.Interpolation = EditorGUILayout.IntSlider("Interpolation", p.Interpolation, 0, 2); }
            else if (type == TerrainNoiseType.White) { p.Scale = EditorGUILayout.Slider("Scale", p.Scale, .01f, 100f); p.Smoothing = EditorGUILayout.Slider("Smoothing", p.Smoothing, 0f, 1f); }
            else if (type == TerrainNoiseType.Constant) p.Value = EditorGUILayout.Slider("Value", p.Value, -2f, 2f);
            else if (type == TerrainNoiseType.Voronoi) { p.Scale = EditorGUILayout.Slider("Scale", p.Scale, .01f, 100f); p.Jitter = EditorGUILayout.Slider("Jitter", p.Jitter, 0f, 1f); p.DistanceMode = EditorGUILayout.IntSlider("Distance mode", p.DistanceMode, 0, 2); p.OutputMode = EditorGUILayout.IntSlider("Output mode", p.OutputMode, 0, 3); }
            else if (type == TerrainNoiseType.Crater) { p.Scale = EditorGUILayout.Slider("Scale", p.Scale, .01f, 100f); p.Density = EditorGUILayout.Slider("Density", p.Density, 0f, 1f); p.Depth = EditorGUILayout.Slider("Depth", p.Depth, 0f, 1.5f); p.Rim = EditorGUILayout.Slider("Rim height", p.Rim, 0f, 1f); p.RimWidth = EditorGUILayout.Slider("Rim width", p.RimWidth, .02f, 1f); }
            else if (type == TerrainNoiseType.Dune) { p.Scale = EditorGUILayout.Slider("Scale", p.Scale, .01f, 100f); p.Direction = EditorGUILayout.Slider("Direction", p.Direction, 0f, Mathf.PI * 2f); p.Sharpness = EditorGUILayout.Slider("Sharpness", p.Sharpness, .1f, 8f); p.RippleScale = EditorGUILayout.Slider("Ripple scale", p.RippleScale, .5f, 12f); p.RippleStrength = EditorGUILayout.Slider("Ripple strength", p.RippleStrength, 0f, .6f); }
            else if (type == TerrainNoiseType.Flow) { p.Scale = EditorGUILayout.Slider("Scale", p.Scale, .01f, 100f); p.Direction = EditorGUILayout.Slider("Direction", p.Direction, 0f, Mathf.PI * 2f); p.Width = EditorGUILayout.Slider("Channel width", p.Width, .02f, 1.5f); p.Meander = EditorGUILayout.Slider("Meander", p.Meander, 0f, 4f); p.MeanderScale = EditorGUILayout.Slider("Meander scale", p.MeanderScale, .05f, 3f); }
            else if (type == TerrainNoiseType.DomainWarp) { p.Scale = EditorGUILayout.Slider("Scale", p.Scale, .01f, 100f); p.Octaves = EditorGUILayout.IntSlider("Octaves", p.Octaves, 1, 8); }
            else if (type == TerrainNoiseType.Terrace) { p.TerraceCount = EditorGUILayout.IntSlider("Terrace count", p.TerraceCount, 2, 40); p.TerraceSmoothness = EditorGUILayout.Slider("Smoothness", p.TerraceSmoothness, .02f, 1f); }
        }

        private static void DrawMaskParameters(TerrainLayerMaskSettings mask)
        {
            if (mask.Type == TerrainMaskType.Height || mask.Type == TerrainMaskType.Slope)
            {
                mask.Minimum = EditorGUILayout.FloatField("Minimum", mask.Minimum);
                mask.Maximum = EditorGUILayout.FloatField("Maximum", mask.Maximum);
                mask.Falloff = Mathf.Max(0f, EditorGUILayout.FloatField("Falloff", mask.Falloff));
            }
            else if (mask.Type == TerrainMaskType.Noise)
            {
                mask.Scale = Mathf.Max(.01f, EditorGUILayout.FloatField("Scale", mask.Scale));
                mask.Threshold = EditorGUILayout.Slider("Threshold", mask.Threshold, 0f, 1f);
                mask.Softness = EditorGUILayout.Slider("Softness", mask.Softness, 0f, 1f);
            }
            else mask.Biome = EditorGUILayout.Popup("Biome", Mathf.Clamp(mask.Biome, 0, 3), new[] { "Desert", "Canyon", "Wetland", "Mountains" });
        }

        private void SwapLayers(int first, int second)
        {
            var value = generationSettings.Layers[first];
            generationSettings.Layers[first] = generationSettings.Layers[second];
            generationSettings.Layers[second] = value;
            activeGenerationLayer = second;
        }

        private void LoadSelectedGeneration()
        {
            loadedGeneratedRoot = TerrainGenerationSceneBuilder.FindGeneratedRoot(Selection.activeGameObject);
            if (loadedGeneratedRoot == null || loadedGeneratedRoot.Recipe == null)
            {
                statusType = MessageType.Error;
                statusMessage = "Select a generated terrain root or tile first.";
                return;
            }
            generationSettings = loadedGeneratedRoot.Recipe.Settings.Clone();
            qualityIndex = 0;
            activeGenerationLayer = 0;
            statusType = MessageType.Info;
            statusMessage = $"Loaded settings from {loadedGeneratedRoot.name}.";
        }

        private void GenerateTerrain(bool regenerate)
        {
            try
            {
                var target = regenerate
                    ? TerrainGenerationSceneBuilder.FindGeneratedRoot(Selection.activeGameObject) ?? loadedGeneratedRoot
                    : null;
                if (regenerate && target == null) throw new InvalidOperationException("Select a generated terrain root or tile first.");
                var result = TerrainGenerationSceneBuilder.Build(generationSettings, target, progress =>
                    EditorUtility.DisplayCancelableProgressBar("Procedural Terrains", "Generating native terrain…", progress));
                loadedGeneratedRoot = result.Root.GetComponent<GeneratedTerrainRoot>();
                statusType = MessageType.Info;
                statusMessage = $"Generated {result.Terrains.Count} terrain tile(s) in {result.Root.name}.";
            }
            catch (OperationCanceledException exception)
            {
                statusType = MessageType.Warning;
                statusMessage = exception.Message;
            }
            catch (Exception exception)
            {
                statusType = MessageType.Error;
                statusMessage = exception.Message;
                Debug.LogError($"[Procedural Terrains] Generation failed: {exception}");
            }
            finally
            {
                EditorUtility.ClearProgressBar();
                Repaint();
            }
        }

        private void BrowseArchive()
        {
            var initialDirectory = string.IsNullOrEmpty(archivePath)
                ? Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)
                : Path.GetDirectoryName(archivePath);
            var selected = EditorUtility.OpenFilePanel(
                "Import Procedural Terrains ZIP",
                initialDirectory,
                "zip");
            if (!string.IsNullOrEmpty(selected)) archivePath = selected;
        }

        private void ImportArchive()
        {
            try
            {
                EditorUtility.DisplayProgressBar("Procedural Terrains", "Validating and extracting ZIP…", 0.2f);
                var result = TerrainZipImportService.ImportArchive(archivePath);
                importedProject = result.Project;
                Selection.activeObject = importedProject;
                EditorGUIUtility.PingObject(importedProject);
                if (createInScene)
                {
                    EditorUtility.DisplayProgressBar("Procedural Terrains", "Creating terrain objects…", 0.65f);
                    var sceneResult = TerrainSceneBuilder.Build(importedProject, BuildOptions());
                    SetBuildStatus(sceneResult, $"Imported {importedProject.Tiles.Count} tile(s) from {Path.GetFileName(archivePath)}.");
                }
                else
                {
                    statusType = MessageType.Info;
                    statusMessage = $"Imported project.ptrterrain to {result.ImportFolderAssetPath}.";
                }
            }
            catch (Exception exception)
            {
                statusType = MessageType.Error;
                statusMessage = exception.Message;
                Debug.LogError($"[Procedural Terrains] Import failed: {exception}");
            }
            finally
            {
                EditorUtility.ClearProgressBar();
                Repaint();
            }
        }

        private void BuildScene(TerrainProjectAsset project)
        {
            try
            {
                EditorUtility.DisplayProgressBar("Procedural Terrains", "Creating terrain objects…", 0.5f);
                var result = TerrainSceneBuilder.Build(project, BuildOptions());
                SetBuildStatus(result, $"Created {result.Terrains.Count} terrain tile(s) in the current scene.");
            }
            catch (Exception exception)
            {
                statusType = MessageType.Error;
                statusMessage = exception.Message;
                Debug.LogError($"[Procedural Terrains] Scene build failed: {exception}");
            }
            finally
            {
                EditorUtility.ClearProgressBar();
                Repaint();
            }
        }

        private TerrainSceneBuildOptions BuildOptions()
        {
            return new TerrainSceneBuildOptions
            {
                CreateBakedMaterials = createBakedMaterials,
                CreateTerrainLayers = createTerrainLayers,
                ConnectNeighbors = true,
                WaterMode = importWaterMode,
                WaterCustomLevel = importWaterCustomLevel,
                WaterLevel = importWaterLevel,
                WaterColor = importWaterColor,
            };
        }

        private void SetBuildStatus(TerrainSceneBuildResult result, string success)
        {
            if (result.Warnings.Count == 0)
            {
                statusType = MessageType.Info;
                statusMessage = success;
                return;
            }
            statusType = MessageType.Warning;
            statusMessage = $"{success}\n\n{string.Join("\n", result.Warnings)}";
        }

        private static void DrawProjectSummary(TerrainProjectAsset project)
        {
            using (new EditorGUILayout.VerticalScope(EditorStyles.helpBox))
            {
                EditorGUILayout.LabelField("Imported project", EditorStyles.boldLabel);
                EditorGUILayout.LabelField("Mode", project.ProjectMode.ToString());
                EditorGUILayout.LabelField("Seed", project.Seed.ToString());
                EditorGUILayout.LabelField("Tiles", project.Tiles.Count.ToString());
                if (project.Bounds != null)
                {
                    EditorGUILayout.LabelField(
                        "World size",
                        $"{project.Bounds.SizeX:0.##} × {project.Bounds.SizeZ:0.##} m");
                    EditorGUILayout.LabelField(
                        "Height range",
                        $"{project.Bounds.MinHeight:0.##} – {project.Bounds.MaxHeight:0.##} m");
                }
            }
        }
    }
}
