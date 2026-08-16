using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using UnityEditor;
using UnityEngine;

namespace Zyfou.ProceduralTerrains.Editor
{
    internal sealed class TerrainZipImportResult
    {
        internal string ImportFolderAssetPath { get; }
        internal string ProjectAssetPath { get; }
        internal TerrainProjectAsset Project { get; }

        internal TerrainZipImportResult(
            string importFolderAssetPath,
            string projectAssetPath,
            TerrainProjectAsset project)
        {
            ImportFolderAssetPath = importFolderAssetPath;
            ProjectAssetPath = projectAssetPath;
            Project = project;
        }
    }

    internal static class TerrainZipImportService
    {
        internal const string DefaultImportRoot = "Assets/ProceduralTerrains/Imports";
        private const int MaximumEntryCount = 4096;
        private const long MaximumExpandedBytes = 8L * 1024L * 1024L * 1024L;
        private static readonly HashSet<string> AllowedFileExtensions = new HashSet<string>(
            new[] { ".ptrterrain", ".raw", ".png", ".glb", ".gltf", ".bin", ".obj", ".mtl", ".json", ".txt" },
            StringComparer.OrdinalIgnoreCase);

        internal static TerrainZipImportResult ImportArchive(
            string archivePath,
            string destinationRootAssetPath = DefaultImportRoot)
        {
            if (string.IsNullOrWhiteSpace(archivePath)
                || !File.Exists(archivePath)
                || !string.Equals(Path.GetExtension(archivePath), ".zip", StringComparison.OrdinalIgnoreCase))
            {
                throw new FileNotFoundException("Select a Procedural Terrains ZIP export.", archivePath);
            }

            destinationRootAssetPath = NormalizeAssetsFolder(destinationRootAssetPath);
            EnsureAssetFolder(destinationRootAssetPath);
            var archiveName = SanitizeFolderName(Path.GetFileNameWithoutExtension(archivePath));
            var destinationAssetPath = AssetDatabase.GenerateUniqueAssetPath(
                $"{destinationRootAssetPath}/{archiveName}");
            var destinationFullPath = AssetPathToFullPath(destinationAssetPath);
            var createdDestination = false;

            try
            {
                using (var stream = File.OpenRead(archivePath))
                using (var archive = new ZipArchive(stream, ZipArchiveMode.Read, false))
                {
                    var entries = ValidateEntries(archive, destinationFullPath);
                    Directory.CreateDirectory(destinationFullPath);
                    createdDestination = true;
                    foreach (var entry in entries)
                    {
                        var outputPath = ResolveEntryPath(destinationFullPath, entry.FullName);
                        if (entry.FullName.EndsWith("/", StringComparison.Ordinal))
                        {
                            Directory.CreateDirectory(outputPath);
                            continue;
                        }

                        Directory.CreateDirectory(Path.GetDirectoryName(outputPath) ?? destinationFullPath);
                        using (var input = entry.Open())
                        using (var output = new FileStream(outputPath, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                        {
                            input.CopyTo(output);
                        }
                    }

                    var projectEntry = entries.Single(entry =>
                        string.Equals(Path.GetFileName(entry.FullName), "project.ptrterrain", StringComparison.OrdinalIgnoreCase));
                    var relativeProjectPath = projectEntry.FullName.TrimEnd('/');
                    var projectAssetPath = $"{destinationAssetPath}/{relativeProjectPath}".Replace('\\', '/');

                    AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
                    AssetDatabase.ImportAsset(
                        projectAssetPath,
                        ImportAssetOptions.ForceSynchronousImport | ImportAssetOptions.ForceUpdate);
                    var project = AssetDatabase.LoadAssetAtPath<TerrainProjectAsset>(projectAssetPath);
                    if (project == null)
                    {
                        throw new InvalidDataException(
                            "The ZIP was extracted, but project.ptrterrain did not import. Check the Unity Console for validation errors.");
                    }

                    return new TerrainZipImportResult(destinationAssetPath, projectAssetPath, project);
                }
            }
            catch
            {
                if (createdDestination && IsInsideAssets(destinationFullPath))
                {
                    FileUtil.DeleteFileOrDirectory(destinationFullPath);
                    FileUtil.DeleteFileOrDirectory($"{destinationFullPath}.meta");
                    AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
                }
                throw;
            }
        }

        private static List<ZipArchiveEntry> ValidateEntries(ZipArchive archive, string destinationFullPath)
        {
            if (archive.Entries.Count == 0 || archive.Entries.Count > MaximumEntryCount)
            {
                throw new InvalidDataException(
                    $"The ZIP must contain between 1 and {MaximumEntryCount} entries.");
            }

            var entries = archive.Entries.ToList();
            var paths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            long expandedBytes = 0;
            var projectCount = 0;
            foreach (var entry in entries)
            {
                var normalized = ValidateRelativeEntryPath(entry.FullName);
                ResolveEntryPath(destinationFullPath, normalized);
                if (!paths.Add(normalized.TrimEnd('/')))
                {
                    throw new InvalidDataException($"The ZIP contains a duplicate path: {entry.FullName}");
                }
                if (!entry.FullName.EndsWith("/", StringComparison.Ordinal))
                {
                    var extension = Path.GetExtension(normalized);
                    if (!AllowedFileExtensions.Contains(extension))
                    {
                        throw new InvalidDataException(
                            $"The ZIP contains a file type that terrain exports do not use: {entry.FullName}");
                    }
                    expandedBytes = checked(expandedBytes + entry.Length);
                    if (expandedBytes > MaximumExpandedBytes)
                    {
                        throw new InvalidDataException("The expanded ZIP exceeds the 8 GB import limit.");
                    }
                }
                if (string.Equals(Path.GetFileName(entry.FullName), "project.ptrterrain", StringComparison.OrdinalIgnoreCase))
                {
                    projectCount++;
                }
            }

            if (projectCount != 1)
            {
                throw new InvalidDataException("The ZIP must contain exactly one project.ptrterrain document.");
            }
            return entries;
        }

        private static string ValidateRelativeEntryPath(string path)
        {
            if (string.IsNullOrWhiteSpace(path) || path.IndexOf('\\') >= 0
                || path.StartsWith("/", StringComparison.Ordinal) || path.IndexOf(':') >= 0)
            {
                throw new InvalidDataException($"The ZIP contains an unsafe path: {path}");
            }
            var trailingSlash = path.EndsWith("/", StringComparison.Ordinal);
            var segments = path.Split('/');
            var segmentCount = trailingSlash ? segments.Length - 1 : segments.Length;
            if (segmentCount == 0)
            {
                throw new InvalidDataException($"The ZIP contains an unsafe path: {path}");
            }
            for (var index = 0; index < segmentCount; index++)
            {
                var segment = segments[index];
                if (string.IsNullOrEmpty(segment) || segment == "." || segment == "..")
                {
                    throw new InvalidDataException($"The ZIP contains an unsafe path: {path}");
                }
            }
            return path;
        }

        private static string ResolveEntryPath(string destinationFullPath, string relativePath)
        {
            var normalized = ValidateRelativeEntryPath(relativePath);
            var candidate = Path.GetFullPath(Path.Combine(
                destinationFullPath,
                normalized.Replace('/', Path.DirectorySeparatorChar)));
            var boundary = destinationFullPath.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
                + Path.DirectorySeparatorChar;
            if (!candidate.StartsWith(boundary, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidDataException($"The ZIP path escapes its import folder: {relativePath}");
            }
            return candidate;
        }

        private static string NormalizeAssetsFolder(string assetPath)
        {
            var normalized = (assetPath ?? string.Empty).Replace('\\', '/').TrimEnd('/');
            if (!normalized.StartsWith("Assets/", StringComparison.Ordinal)
                || normalized.IndexOf(':') >= 0
                || normalized.Split('/').Any(segment => string.IsNullOrEmpty(segment) || segment == "." || segment == ".."))
            {
                throw new ArgumentException("The import destination must be a folder below Assets.", nameof(assetPath));
            }
            return normalized;
        }

        private static void EnsureAssetFolder(string assetPath)
        {
            var segments = assetPath.Split('/');
            var current = segments[0];
            for (var index = 1; index < segments.Length; index++)
            {
                var next = $"{current}/{segments[index]}";
                if (!AssetDatabase.IsValidFolder(next))
                {
                    AssetDatabase.CreateFolder(current, segments[index]);
                }
                current = next;
            }
        }

        private static string SanitizeFolderName(string value)
        {
            var invalid = Path.GetInvalidFileNameChars();
            var sanitized = new string((value ?? string.Empty)
                .Select(character => invalid.Contains(character) ? '_' : character)
                .ToArray()).Trim();
            return string.IsNullOrEmpty(sanitized) ? "TerrainImport" : sanitized;
        }

        internal static string AssetPathToFullPath(string assetPath)
        {
            var projectRoot = Directory.GetParent(Application.dataPath)?.FullName
                ?? throw new InvalidOperationException("Unity project root could not be resolved.");
            return Path.GetFullPath(Path.Combine(projectRoot, assetPath.Replace('/', Path.DirectorySeparatorChar)));
        }

        private static bool IsInsideAssets(string fullPath)
        {
            var assetsRoot = Path.GetFullPath(Application.dataPath)
                .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
                + Path.DirectorySeparatorChar;
            var candidate = Path.GetFullPath(fullPath);
            return candidate.StartsWith(assetsRoot, StringComparison.OrdinalIgnoreCase);
        }
    }
}
