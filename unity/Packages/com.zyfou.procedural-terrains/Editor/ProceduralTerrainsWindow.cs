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
        private Vector2 scroll;
        private string statusMessage = string.Empty;
        private MessageType statusType = MessageType.None;

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
                "Import a baked terrain package and build ready-to-edit Unity Terrain objects.",
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
                    "Create and assign baked Material assets",
                    createBakedMaterials);
                createTerrainLayers = EditorGUILayout.ToggleLeft(
                    "Create a baked TerrainLayer fallback",
                    createTerrainLayers);
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
        }

        private static void DrawCreateTab()
        {
            EditorGUILayout.LabelField("Create in Unity", EditorStyles.boldLabel);
            EditorGUILayout.HelpBox(
                "Coming soon\n\nCreate and edit Procedural Terrains projects directly inside Unity. For now, use the Import tab with a ZIP exported by the Procedural Terrains application.",
                MessageType.Info);
            using (new EditorGUI.DisabledScope(true))
            {
                EditorGUILayout.TextField("Project name", "New Terrain");
                EditorGUILayout.IntField("Seed", 1337);
                EditorGUILayout.Vector2Field("World size", new Vector2(1000f, 1000f));
                GUILayout.Button("Create Terrain (Coming soon)", GUILayout.Height(34f));
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
