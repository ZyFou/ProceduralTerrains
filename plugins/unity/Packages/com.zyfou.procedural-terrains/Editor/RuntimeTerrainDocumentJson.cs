using System;
using System.Collections.Generic;
using UnityEngine;

namespace Zyfou.ProceduralTerrains.Editor
{
    [Serializable]
    internal sealed class RuntimeTerrainDocumentJson
    {
        public string format;
        public int schemaVersion;
        public RuntimeProducerJson producer;
        public RuntimeProjectJson project;
        public RuntimeCoordinatesJson coordinates;
        public RuntimeBoundsJson bounds;
        public RuntimeTileJson[] tiles;
        public RuntimeGenerationJson generation;
        public RuntimeFeaturesJson features;
        public string[] unsupportedFeatures;
    }

    [Serializable]
    internal sealed class RuntimeProducerJson
    {
        public string name;
        public string appVersion;
        public int generatorVersion;
    }

    [Serializable]
    internal sealed class RuntimeProjectJson
    {
        public string mode;
        public string world;
        public string tileShape;
        public double seed;
    }

    [Serializable]
    internal sealed class RuntimeCoordinatesJson
    {
        public string units;
        public string upAxis;
        public string xAxis;
        public string zAxis;
        public string unityMapping;
        public string tilePivot;
    }

    [Serializable]
    internal sealed class RuntimeBoundsJson
    {
        public double minX;
        public double minZ;
        public double sizeX;
        public double sizeZ;
        public double minHeight;
        public double maxHeight;
        public double seaLevel;
    }

    [Serializable]
    internal sealed class RuntimeTileJson
    {
        public double cx;
        public double cz;
        public double centerX;
        public double centerZ;
        public double size;
        public RuntimeHeightfieldJson heightfield;
        public RuntimeSplatJson splat;
    }

    [Serializable]
    internal sealed class RuntimeHeightfieldJson
    {
        public string path;
        public int resolution;
        public string encoding;
        public string byteOrder;
        public string sampleLayout;
        public string rowOrder;
        public string columnOrder;
        public double minHeight;
        public double maxHeight;
    }

    [Serializable]
    internal sealed class RuntimeSplatJson
    {
        public string path;
        public int width;
        public int height;
        public string[] channels;
    }

    [Serializable]
    internal sealed class RuntimeGenerationJson
    {
        public int sourceVersion;
        public string authoritative;
        public string kind;
    }

    [Serializable]
    internal sealed class RuntimeFeaturesJson
    {
        public bool heightfield;
        public bool splat;
        public bool paint;
        public bool erosion;
        public bool splines;
        public bool importedMaps;
        public bool surfaces;
        public bool water;
        public bool props;
    }

    internal static class RuntimeTerrainDocumentParser
    {
        internal static bool TryParse(
            string json,
            out RuntimeTerrainDocumentJson document,
            out string generationJson,
            out string error)
        {
            document = null;
            generationJson = string.Empty;
            error = string.Empty;
            if (string.IsNullOrWhiteSpace(json))
            {
                error = "Runtime terrain document is empty.";
                return false;
            }

            try
            {
                document = JsonUtility.FromJson<RuntimeTerrainDocumentJson>(json);
            }
            catch (Exception exception) when (exception is ArgumentException || exception is FormatException)
            {
                error = $"Runtime terrain document contains malformed JSON: {exception.Message}";
                return false;
            }

            if (document == null)
            {
                error = "Runtime terrain document could not be parsed.";
                return false;
            }

            JsonValueSlice.TryExtractTopLevelProperty(json, "generation", out generationJson);
            return true;
        }
    }

    internal static class RuntimeTerrainDocumentValidator
    {
        private static readonly HashSet<int> HeightfieldResolutions = new HashSet<int>
        {
            513, 1025, 2049, 4097,
        };

        internal static List<TerrainImportDiagnostic> Validate(RuntimeTerrainDocumentJson document)
        {
            var diagnostics = new List<TerrainImportDiagnostic>();
            void Error(string code, string message, string path = "") =>
                diagnostics.Add(new TerrainImportDiagnostic(TerrainDiagnosticSeverity.Error, code, message, path));

            if (document.format != "procedural-terrains")
            {
                Error("format.unsupported", "Expected format ‘procedural-terrains’.", "format");
            }
            if (document.schemaVersion != 1)
            {
                Error("schema.unsupported", $"Runtime terrain schema {document.schemaVersion} is unsupported; this package supports schema 1.", "schemaVersion");
            }
            if (document.producer == null || string.IsNullOrWhiteSpace(document.producer.name)
                || string.IsNullOrWhiteSpace(document.producer.appVersion)
                || document.producer.generatorVersion < 1)
            {
                Error("producer.invalid", "Producer name, app version, and generator version are required.", "producer");
            }

            if (document.project == null)
            {
                Error("project.missing", "Project metadata is required.", "project");
            }
            else
            {
                if (ParseProjectMode(document.project.mode) == TerrainProjectMode.Unknown)
                {
                    Error("project.mode", "Project mode must be procedural, nodes, or manual.", "project.mode");
                }
                if (document.project.world != "studio")
                {
                    Error("project.world", "Runtime document v1 supports studio worlds only.", "project.world");
                }
                // v1 exports are square-only. tileShape was added as an
                // explicit preflight marker after the original v1 example,
                // so an omitted value retains the schema's square default.
                if (!string.IsNullOrEmpty(document.project.tileShape)
                    && document.project.tileShape != "square")
                {
                    Error("project.tileShape", "Runtime document v1 supports square tile assemblies only.", "project.tileShape");
                }
                if (!IsInteger(document.project.seed) || document.project.seed < int.MinValue || document.project.seed > int.MaxValue)
                {
                    Error("project.seed", "Project seed must be a 32-bit integer.", "project.seed");
                }
            }

            var coordinates = document.coordinates;
            if (coordinates == null || coordinates.units != "meters" || coordinates.upAxis != "+Y"
                || coordinates.xAxis != "+X" || coordinates.zAxis != "+Z"
                || coordinates.unityMapping != "x,y,z" || coordinates.tilePivot != "center")
            {
                Error("coordinates.unsupported", "Coordinates must use meters, +Y up, identity XYZ mapping, and center tile pivots.", "coordinates");
            }

            var bounds = document.bounds;
            if (bounds == null || !IsFinite(bounds.minX) || !IsFinite(bounds.minZ)
                || !IsFinite(bounds.sizeX) || bounds.sizeX <= 0
                || !IsFinite(bounds.sizeZ) || bounds.sizeZ <= 0
                || !IsFinite(bounds.minHeight) || !IsFinite(bounds.maxHeight)
                || bounds.maxHeight <= bounds.minHeight || !IsFinite(bounds.seaLevel))
            {
                Error("bounds.invalid", "Bounds require finite positive horizontal sizes and an increasing height range.", "bounds");
            }

            if (document.tiles == null || document.tiles.Length == 0)
            {
                Error("tiles.missing", "At least one terrain tile is required.", "tiles");
            }
            else
            {
                var seen = new HashSet<string>();
                var previousCx = int.MinValue;
                var previousCz = int.MinValue;
                for (var index = 0; index < document.tiles.Length; index++)
                {
                    var tile = document.tiles[index];
                    var path = $"tiles[{index}]";
                    if (tile == null)
                    {
                        Error("tile.invalid", "Tile entry must be an object.", path);
                        continue;
                    }
                    if (!IsInteger(tile.cx) || !IsInteger(tile.cz)
                        || tile.cx < int.MinValue || tile.cx > int.MaxValue
                        || tile.cz < int.MinValue || tile.cz > int.MaxValue)
                    {
                        Error("tile.coordinate", "Tile coordinates must be 32-bit integers.", path);
                    }
                    else
                    {
                        var cx = (int)tile.cx;
                        var cz = (int)tile.cz;
                        var key = $"{cx},{cz}";
                        if (!seen.Add(key)) Error("tile.duplicate", $"Duplicate tile coordinate {key}.", path);
                        if (index > 0 && (cz < previousCz || (cz == previousCz && cx < previousCx)))
                        {
                            Error("tile.order", "Tiles must be sorted by cz, then cx.", path);
                        }
                        previousCx = cx;
                        previousCz = cz;
                    }
                    if (!IsFinite(tile.centerX) || !IsFinite(tile.centerZ) || !IsFinite(tile.size) || tile.size <= 0)
                    {
                        Error("tile.bounds", "Tile center and positive size are required.", path);
                    }

                    ValidateHeightfield(tile.heightfield, path, Error);
                    ValidateSplat(tile.splat, path, Error);
                }
            }

            var hasGeneration = document.generation != null
                && (document.generation.sourceVersion != 0
                    || !string.IsNullOrEmpty(document.generation.authoritative)
                    || !string.IsNullOrEmpty(document.generation.kind));
            if (hasGeneration
                && (document.generation.sourceVersion != 1
                    || document.generation.authoritative != "baked"
                    || ParseProjectMode(document.generation.kind) == TerrainProjectMode.Unknown))
            {
                Error("generation.invalid", "Generation source must be a version 1 baked-authoritative descriptor.", "generation");
            }
            if (document.features == null)
            {
                Error("features.missing", "Feature summary is required.", "features");
            }
            if (document.unsupportedFeatures == null)
            {
                Error("features.unsupported", "unsupportedFeatures must be an array.", "unsupportedFeatures");
            }

            return diagnostics;
        }

        private static void ValidateHeightfield(
            RuntimeHeightfieldJson heightfield,
            string tilePath,
            Action<string, string, string> error)
        {
            var path = $"{tilePath}.heightfield";
            if (heightfield == null)
            {
                error("heightfield.missing", "Every tile requires a heightfield.", path);
                return;
            }
            if (!IsSafeArtifactPath(heightfield.path))
            {
                error("artifact.path", "Heightfield path must be a safe forward-slash relative path.", $"{path}.path");
            }
            if (!HeightfieldResolutions.Contains(heightfield.resolution))
            {
                error("heightfield.resolution", "Heightfield resolution must be 513, 1025, 2049, or 4097.", $"{path}.resolution");
            }
            if (heightfield.encoding != "uint16-normalized"
                || heightfield.byteOrder != "little-endian"
                || heightfield.sampleLayout != "vertex-grid-inclusive"
                || heightfield.rowOrder != "negative-z-to-positive-z"
                || heightfield.columnOrder != "negative-x-to-positive-x")
            {
                error("heightfield.encoding", "Heightfield encoding or sample orientation is unsupported.", path);
            }
            if (!IsFinite(heightfield.minHeight) || !IsFinite(heightfield.maxHeight)
                || heightfield.maxHeight <= heightfield.minHeight)
            {
                error("heightfield.range", "Heightfield requires an increasing finite height range.", path);
            }
        }

        private static void ValidateSplat(
            RuntimeSplatJson splat,
            string tilePath,
            Action<string, string, string> error)
        {
            // JsonUtility may materialize an omitted optional nested object as
            // an empty instance. An empty descriptor is equivalent to absent;
            // any partially populated descriptor remains a validation error.
            if (splat == null || (string.IsNullOrEmpty(splat.path)
                && splat.width == 0 && splat.height == 0
                && (splat.channels == null || splat.channels.Length == 0))) return;
            var path = $"{tilePath}.splat";
            if (!IsSafeArtifactPath(splat.path))
            {
                error("artifact.path", "Splat path must be a safe forward-slash relative path.", $"{path}.path");
            }
            if (splat.width <= 0 || splat.height <= 0)
            {
                error("splat.resolution", "Splat dimensions must be positive integers.", path);
            }
            var channels = splat.channels;
            if (channels == null || channels.Length != 4
                || channels[0] != "desert" || channels[1] != "canyon"
                || channels[2] != "wetland" || channels[3] != "mountains")
            {
                error("splat.channels", "Splat channels must be desert, canyon, wetland, and mountains in RGBA order.", $"{path}.channels");
            }
        }

        internal static bool HasErrors(IEnumerable<TerrainImportDiagnostic> diagnostics)
        {
            foreach (var diagnostic in diagnostics)
            {
                if (diagnostic.Severity == TerrainDiagnosticSeverity.Error) return true;
            }
            return false;
        }

        internal static TerrainProjectMode ParseProjectMode(string mode)
        {
            switch (mode)
            {
                case "procedural": return TerrainProjectMode.Procedural;
                case "nodes": return TerrainProjectMode.Nodes;
                case "manual": return TerrainProjectMode.Manual;
                default: return TerrainProjectMode.Unknown;
            }
        }

        internal static bool IsSafeArtifactPath(string path)
        {
            if (string.IsNullOrEmpty(path) || path.IndexOf('\\') >= 0 || path.StartsWith("/", StringComparison.Ordinal)) return false;
            if (path.IndexOf(':') >= 0) return false;
            var segments = path.Split('/');
            foreach (var segment in segments)
            {
                if (string.IsNullOrEmpty(segment) || segment == "." || segment == "..") return false;
            }
            return true;
        }

        private static bool IsInteger(double value) => IsFinite(value) && Math.Truncate(value) == value;
        private static bool IsFinite(double value) => !double.IsNaN(value) && !double.IsInfinity(value);
    }

    internal static class JsonValueSlice
    {
        internal static bool TryExtractTopLevelProperty(string json, string propertyName, out string value)
        {
            value = string.Empty;
            var index = 0;
            SkipWhitespace(json, ref index);
            if (index >= json.Length || json[index++] != '{') return false;

            while (index < json.Length)
            {
                SkipWhitespace(json, ref index);
                if (index < json.Length && json[index] == '}') return false;
                if (!TryReadString(json, ref index, out var key)) return false;
                SkipWhitespace(json, ref index);
                if (index >= json.Length || json[index++] != ':') return false;
                SkipWhitespace(json, ref index);
                var start = index;
                if (!TrySkipValue(json, ref index)) return false;
                if (key == propertyName)
                {
                    value = json.Substring(start, index - start);
                    return true;
                }
                SkipWhitespace(json, ref index);
                if (index < json.Length && json[index] == ',')
                {
                    index++;
                    continue;
                }
                return false;
            }
            return false;
        }

        private static bool TryReadString(string json, ref int index, out string value)
        {
            value = string.Empty;
            if (index >= json.Length || json[index++] != '"') return false;
            var start = index;
            var escaped = false;
            while (index < json.Length)
            {
                var character = json[index++];
                if (escaped)
                {
                    escaped = false;
                    continue;
                }
                if (character == '\\')
                {
                    escaped = true;
                    continue;
                }
                if (character != '"') continue;
                value = json.Substring(start, index - start - 1);
                return true;
            }
            return false;
        }

        private static bool TrySkipValue(string json, ref int index)
        {
            if (index >= json.Length) return false;
            if (json[index] == '"') return TryReadString(json, ref index, out _);
            if (json[index] == '{' || json[index] == '[')
            {
                var opening = json[index++];
                var closing = opening == '{' ? '}' : ']';
                var depth = 1;
                var inString = false;
                var escaped = false;
                while (index < json.Length && depth > 0)
                {
                    var character = json[index++];
                    if (inString)
                    {
                        if (escaped) escaped = false;
                        else if (character == '\\') escaped = true;
                        else if (character == '"') inString = false;
                        continue;
                    }
                    if (character == '"') inString = true;
                    else if (character == opening) depth++;
                    else if (character == closing) depth--;
                }
                return depth == 0;
            }
            while (index < json.Length && json[index] != ',' && json[index] != '}') index++;
            return index > 0;
        }

        private static void SkipWhitespace(string json, ref int index)
        {
            while (index < json.Length && char.IsWhiteSpace(json[index])) index++;
        }
    }
}
