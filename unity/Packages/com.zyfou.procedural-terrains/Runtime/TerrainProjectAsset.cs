using System;
using System.Collections.Generic;
using UnityEngine;

namespace Zyfou.ProceduralTerrains
{
    public enum TerrainProjectMode
    {
        Unknown = 0,
        Procedural = 1,
        Nodes = 2,
        Manual = 3,
    }

    public enum TerrainWorldType
    {
        Unknown = 0,
        Studio = 1,
    }

    public enum TerrainDiagnosticSeverity
    {
        Info = 0,
        Warning = 1,
        Error = 2,
    }

    [Serializable]
    public sealed class TerrainProjectBounds
    {
        [SerializeField] private float minX;
        [SerializeField] private float minZ;
        [SerializeField] private float sizeX;
        [SerializeField] private float sizeZ;
        [SerializeField] private float minHeight;
        [SerializeField] private float maxHeight;
        [SerializeField] private float seaLevel;

        public float MinX => minX;
        public float MinZ => minZ;
        public float SizeX => sizeX;
        public float SizeZ => sizeZ;
        public float MinHeight => minHeight;
        public float MaxHeight => maxHeight;
        public float SeaLevel => seaLevel;

        internal TerrainProjectBounds(
            float minX,
            float minZ,
            float sizeX,
            float sizeZ,
            float minHeight,
            float maxHeight,
            float seaLevel)
        {
            this.minX = minX;
            this.minZ = minZ;
            this.sizeX = sizeX;
            this.sizeZ = sizeZ;
            this.minHeight = minHeight;
            this.maxHeight = maxHeight;
            this.seaLevel = seaLevel;
        }
    }

    [Serializable]
    public sealed class TerrainHeightfieldDescriptor
    {
        [SerializeField] private string relativePath;
        [SerializeField] private string assetPath;
        [SerializeField] private int resolution;
        [SerializeField] private float minHeight;
        [SerializeField] private float maxHeight;
        [SerializeField] private UnityEngine.Object sourceAsset;

        public string RelativePath => relativePath;
        public string AssetPath => assetPath;
        public int Resolution => resolution;
        public float MinHeight => minHeight;
        public float MaxHeight => maxHeight;
        public UnityEngine.Object SourceAsset => sourceAsset;

        internal TerrainHeightfieldDescriptor(
            string relativePath,
            string assetPath,
            int resolution,
            float minHeight,
            float maxHeight,
            UnityEngine.Object sourceAsset)
        {
            this.relativePath = relativePath;
            this.assetPath = assetPath;
            this.resolution = resolution;
            this.minHeight = minHeight;
            this.maxHeight = maxHeight;
            this.sourceAsset = sourceAsset;
        }
    }

    [Serializable]
    public sealed class TerrainTileDescriptor
    {
        [SerializeField] private int cx;
        [SerializeField] private int cz;
        [SerializeField] private float centerX;
        [SerializeField] private float centerZ;
        [SerializeField] private float size;
        [SerializeField] private TerrainHeightfieldDescriptor heightfield;
        [SerializeField] private string splatRelativePath;
        [SerializeField] private string splatAssetPath;
        [SerializeField] private int splatWidth;
        [SerializeField] private int splatHeight;
        [SerializeField] private UnityEngine.Object splatAsset;

        public int Cx => cx;
        public int Cz => cz;
        public float CenterX => centerX;
        public float CenterZ => centerZ;
        public float Size => size;
        public TerrainHeightfieldDescriptor Heightfield => heightfield;
        public bool HasSplat => !string.IsNullOrEmpty(splatRelativePath);
        public string SplatRelativePath => splatRelativePath;
        public string SplatAssetPath => splatAssetPath;
        public int SplatWidth => splatWidth;
        public int SplatHeight => splatHeight;
        public UnityEngine.Object SplatAsset => splatAsset;

        internal TerrainTileDescriptor(
            int cx,
            int cz,
            float centerX,
            float centerZ,
            float size,
            TerrainHeightfieldDescriptor heightfield,
            string splatRelativePath,
            string splatAssetPath,
            int splatWidth,
            int splatHeight,
            UnityEngine.Object splatAsset)
        {
            this.cx = cx;
            this.cz = cz;
            this.centerX = centerX;
            this.centerZ = centerZ;
            this.size = size;
            this.heightfield = heightfield;
            this.splatRelativePath = splatRelativePath;
            this.splatAssetPath = splatAssetPath;
            this.splatWidth = splatWidth;
            this.splatHeight = splatHeight;
            this.splatAsset = splatAsset;
        }
    }

    [Serializable]
    public sealed class TerrainFeatureSummary
    {
        [SerializeField] private bool heightfield;
        [SerializeField] private bool splat;
        [SerializeField] private bool paint;
        [SerializeField] private bool erosion;
        [SerializeField] private bool splines;
        [SerializeField] private bool importedMaps;
        [SerializeField] private bool surfaces;
        [SerializeField] private bool water;
        [SerializeField] private bool props;

        public bool Heightfield => heightfield;
        public bool Splat => splat;
        public bool Paint => paint;
        public bool Erosion => erosion;
        public bool Splines => splines;
        public bool ImportedMaps => importedMaps;
        public bool Surfaces => surfaces;
        public bool Water => water;
        public bool Props => props;

        internal TerrainFeatureSummary(
            bool heightfield,
            bool splat,
            bool paint,
            bool erosion,
            bool splines,
            bool importedMaps,
            bool surfaces,
            bool water,
            bool props)
        {
            this.heightfield = heightfield;
            this.splat = splat;
            this.paint = paint;
            this.erosion = erosion;
            this.splines = splines;
            this.importedMaps = importedMaps;
            this.surfaces = surfaces;
            this.water = water;
            this.props = props;
        }
    }

    [Serializable]
    public sealed class TerrainImportDiagnostic
    {
        [SerializeField] private TerrainDiagnosticSeverity severity;
        [SerializeField] private string code;
        [SerializeField] private string message;
        [SerializeField] private string path;

        public TerrainDiagnosticSeverity Severity => severity;
        public string Code => code;
        public string Message => message;
        public string Path => path;

        internal TerrainImportDiagnostic(
            TerrainDiagnosticSeverity severity,
            string code,
            string message,
            string path = "")
        {
            this.severity = severity;
            this.code = code;
            this.message = message;
            this.path = path ?? string.Empty;
        }
    }

    /// <summary>
    /// Imported, renderer-neutral representation of a Procedural Terrains project.
    /// This foundation asset describes baked fields but deliberately owns no TerrainData.
    /// </summary>
    public sealed class TerrainProjectAsset : ScriptableObject
    {
        [SerializeField] private int schemaVersion;
        [SerializeField] private string producerName;
        [SerializeField] private string producerAppVersion;
        [SerializeField] private int generatorVersion;
        [SerializeField] private TerrainProjectMode projectMode;
        [SerializeField] private TerrainWorldType worldType;
        [SerializeField] private int seed;
        [SerializeField] private string units;
        [SerializeField] private string upAxis;
        [SerializeField] private string xAxis;
        [SerializeField] private string zAxis;
        [SerializeField] private string coordinateMapping;
        [SerializeField] private string tilePivot;
        [SerializeField] private TerrainProjectBounds bounds;
        [SerializeField] private TerrainTileDescriptor[] tiles = Array.Empty<TerrainTileDescriptor>();
        [SerializeField] private TerrainFeatureSummary features;
        [SerializeField] private string[] unsupportedFeatures = Array.Empty<string>();
        [SerializeField, TextArea(3, 12)] private string generationSourceJson;
        [SerializeField] private TerrainImportDiagnostic[] diagnostics = Array.Empty<TerrainImportDiagnostic>();

        public int SchemaVersion => schemaVersion;
        public string ProducerName => producerName;
        public string ProducerAppVersion => producerAppVersion;
        public int GeneratorVersion => generatorVersion;
        public TerrainProjectMode ProjectMode => projectMode;
        public TerrainWorldType WorldType => worldType;
        public int Seed => seed;
        public string Units => units;
        public string UpAxis => upAxis;
        public string XAxis => xAxis;
        public string ZAxis => zAxis;
        public string CoordinateMapping => coordinateMapping;
        public string TilePivot => tilePivot;
        public TerrainProjectBounds Bounds => bounds;
        public IReadOnlyList<TerrainTileDescriptor> Tiles => tiles;
        public TerrainFeatureSummary Features => features;
        public IReadOnlyList<string> UnsupportedFeatures => unsupportedFeatures;
        public string GenerationSourceJson => generationSourceJson;
        public IReadOnlyList<TerrainImportDiagnostic> Diagnostics => diagnostics;

        internal void Initialize(
            int schemaVersion,
            string producerName,
            string producerAppVersion,
            int generatorVersion,
            TerrainProjectMode projectMode,
            TerrainWorldType worldType,
            int seed,
            string units,
            string upAxis,
            string xAxis,
            string zAxis,
            string coordinateMapping,
            string tilePivot,
            TerrainProjectBounds bounds,
            TerrainTileDescriptor[] tiles,
            TerrainFeatureSummary features,
            string[] unsupportedFeatures,
            string generationSourceJson,
            TerrainImportDiagnostic[] diagnostics)
        {
            this.schemaVersion = schemaVersion;
            this.producerName = producerName ?? string.Empty;
            this.producerAppVersion = producerAppVersion ?? string.Empty;
            this.generatorVersion = generatorVersion;
            this.projectMode = projectMode;
            this.worldType = worldType;
            this.seed = seed;
            this.units = units ?? string.Empty;
            this.upAxis = upAxis ?? string.Empty;
            this.xAxis = xAxis ?? string.Empty;
            this.zAxis = zAxis ?? string.Empty;
            this.coordinateMapping = coordinateMapping ?? string.Empty;
            this.tilePivot = tilePivot ?? string.Empty;
            this.bounds = bounds;
            this.tiles = tiles ?? Array.Empty<TerrainTileDescriptor>();
            this.features = features;
            this.unsupportedFeatures = unsupportedFeatures ?? Array.Empty<string>();
            this.generationSourceJson = generationSourceJson ?? string.Empty;
            this.diagnostics = diagnostics ?? Array.Empty<TerrainImportDiagnostic>();
        }
    }
}
