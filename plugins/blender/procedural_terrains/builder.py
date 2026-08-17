"""Blender-native scene construction for validated terrain documents."""

from __future__ import annotations

from array import array
from dataclasses import dataclass
import json
from pathlib import Path
import re
from typing import Any

import bpy

from .heightfield import HeightfieldError, loop_uvs, quad_faces, read_raw_heightfield, vertices
from .transforms import ImportTransform, import_transform


@dataclass(frozen=True)
class BuildOptions:
    mesh_resolution: str = "AUTO"
    create_materials: bool = True
    smooth_shading: bool = True
    pack_images: bool = True
    select_imported: bool = True
    dimension_mode: str = "SOURCE"
    target_width: float = 1000.0
    target_depth: float = 1000.0
    vertical_scale: float = 1.0
    placement: str = "ORIGIN"


@dataclass(frozen=True)
class BuildResult:
    collection: Any
    objects: tuple[Any, ...]
    warnings: tuple[str, ...]


def _artifact_path(document_root: Path, relative_path: str) -> Path:
    # The document validator has already rejected absolute/traversal paths.
    return document_root.joinpath(*relative_path.split("/"))


def _validate_artifacts(document: dict[str, Any], root: Path) -> list[str]:
    warnings: list[str] = []
    for tile in document["tiles"]:
        descriptor = tile["heightfield"]
        path = _artifact_path(root, descriptor["path"])
        expected = descriptor["resolution"] * descriptor["resolution"] * 2
        if not path.is_file():
            raise HeightfieldError(f"Required heightfield does not exist: {descriptor['path']}")
        if path.stat().st_size != expected:
            raise HeightfieldError(
                f"Heightfield {descriptor['path']} is {path.stat().st_size} bytes; expected {expected} bytes."
            )
        splat = tile.get("splat")
        if splat and not _artifact_path(root, splat["path"]).is_file():
            warnings.append(
                f"Tile ({tile['cx']}, {tile['cz']}): optional splat map is missing: {splat['path']}"
            )
        tile_root = path.parent
        if not (tile_root / "textures" / "terrain_color.png").is_file():
            warnings.append(
                f"Tile ({tile['cx']}, {tile['cz']}): terrain_color.png is missing; created geometry without a baked color surface."
            )
        elif not (tile_root / "textures" / "terrain_normal.png").is_file():
            warnings.append(
                f"Tile ({tile['cx']}, {tile['cz']}): terrain_normal.png is missing; Blender will use mesh normals."
            )
    for feature in document.get("unsupportedFeatures", []):
        warnings.append(f"Feature '{feature}' is recorded but is not reconstructed by this add-on version.")
    return warnings


def _safe_name(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_. -]+", "_", value).strip(" ._")
    return cleaned or "Terrain"


def _load_image(path: Path, non_color: bool, pack: bool, tracked_images: list[Any]):
    image = bpy.data.images.load(str(path), check_existing=False)
    tracked_images.append(image)
    if non_color:
        try:
            image.colorspace_settings.name = "Non-Color"
        except TypeError:
            pass
    if pack:
        image.pack()
    return image


def _create_material(
    tile: dict[str, Any],
    tile_root: Path,
    pack_images: bool,
    tracked_materials: list[Any],
    tracked_images: list[Any],
):
    color_path = tile_root / "textures" / "terrain_color.png"
    if not color_path.is_file():
        return None
    name = f"PT Terrain {tile['cx']}_{tile['cz']}"
    material = bpy.data.materials.new(name=name)
    tracked_materials.append(material)
    material.use_nodes = True
    material.diffuse_color = (0.32, 0.28, 0.22, 1.0)
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()

    output = nodes.new("ShaderNodeOutputMaterial")
    output.location = (620, 0)
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    shader.location = (300, 0)
    shader.inputs["Roughness"].default_value = 0.8
    shader.inputs["Metallic"].default_value = 0.0
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])

    color_node = nodes.new("ShaderNodeTexImage")
    color_node.name = "Baked Terrain Color"
    color_node.label = "Baked Terrain Color"
    color_node.location = (-320, 90)
    color_node.extension = "EXTEND"
    color_node.image = _load_image(color_path, False, pack_images, tracked_images)
    links.new(color_node.outputs["Color"], shader.inputs["Base Color"])

    normal_path = tile_root / "textures" / "terrain_normal.png"
    if normal_path.is_file():
        normal_texture = nodes.new("ShaderNodeTexImage")
        normal_texture.name = "Baked Terrain Normal"
        normal_texture.label = "Baked Terrain Normal"
        normal_texture.location = (-320, -180)
        normal_texture.extension = "EXTEND"
        normal_texture.image = _load_image(normal_path, True, pack_images, tracked_images)
        normal_map = nodes.new("ShaderNodeNormalMap")
        normal_map.location = (40, -170)
        normal_map.space = "TANGENT"
        links.new(normal_texture.outputs["Color"], normal_map.inputs["Color"])
        links.new(normal_map.outputs["Normal"], shader.inputs["Normal"])
    return material


def _create_mesh_object(
    tile: dict[str, Any],
    root: Path,
    collection,
    options: BuildOptions,
    tracked_meshes: list[Any],
    tracked_objects: list[Any],
    tracked_materials: list[Any],
    tracked_images: list[Any],
    transform: ImportTransform,
):
    descriptor = tile["heightfield"]
    raw_path = _artifact_path(root, descriptor["path"])
    grid = read_raw_heightfield(raw_path, descriptor["resolution"], options.mesh_resolution)
    name = f"Terrain_{tile['cx']}_{tile['cz']}"
    mesh = bpy.data.meshes.new(name)
    tracked_meshes.append(mesh)
    transformed_vertices = (
        (x * transform.scale_x, y * transform.scale_y, z * transform.scale_z)
        for x, y, z in vertices(grid, tile["size"], descriptor["minHeight"], descriptor["maxHeight"])
    )
    mesh.from_pydata(
        list(transformed_vertices),
        [],
        list(quad_faces(grid.resolution)),
    )
    mesh.validate(clean_customdata=False)
    mesh.update(calc_edges=True)

    uv_layer = mesh.uv_layers.new(name="Terrain UV")
    uv_values = array("f")
    for uv in loop_uvs(grid.resolution):
        uv_values.extend(uv)
    uv_layer.data.foreach_set("uv", uv_values)
    if options.smooth_shading:
        for polygon in mesh.polygons:
            polygon.use_smooth = True

    obj = bpy.data.objects.new(name, mesh)
    tracked_objects.append(obj)
    collection.objects.link(obj)
    obj.location = transform.point(
        float(tile["centerX"]), float(tile["centerZ"]), float(descriptor["minHeight"])
    )
    obj["ptr_tile_cx"] = tile["cx"]
    obj["ptr_tile_cz"] = tile["cz"]
    obj["ptr_source_center_x"] = tile["centerX"]
    obj["ptr_source_center_z"] = tile["centerZ"]
    obj["ptr_tile_size_m"] = tile["size"]
    obj["ptr_heightfield_path"] = descriptor["path"]
    obj["ptr_heightfield_resolution"] = descriptor["resolution"]
    obj["ptr_mesh_resolution"] = grid.resolution
    obj["ptr_min_height_m"] = descriptor["minHeight"]
    obj["ptr_max_height_m"] = descriptor["maxHeight"]
    obj["ptr_effective_tile_size_x_m"] = float(tile["size"]) * transform.scale_x
    obj["ptr_effective_tile_size_y_m"] = float(tile["size"]) * transform.scale_y
    obj["ptr_vertical_scale"] = transform.scale_z
    if tile.get("splat"):
        obj["ptr_splat_json"] = json.dumps(tile["splat"], separators=(",", ":"), sort_keys=True)

    if options.create_materials:
        material = _create_material(
            tile, raw_path.parent, options.pack_images, tracked_materials, tracked_images
        )
        if material is not None:
            mesh.materials.append(material)
    return obj


def _set_collection_metadata(
    collection, document: dict[str, Any], source_path: str, transform: ImportTransform
) -> None:
    producer = document["producer"]
    project = document["project"]
    collection["ptr_format"] = document["format"]
    collection["ptr_schema_version"] = document["schemaVersion"]
    collection["ptr_producer"] = producer["name"]
    collection["ptr_app_version"] = producer["appVersion"]
    collection["ptr_generator_version"] = producer["generatorVersion"]
    collection["ptr_project_mode"] = project["mode"]
    collection["ptr_seed"] = project["seed"]
    collection["ptr_source_path"] = source_path
    collection["ptr_coordinates"] = "source (X,Y,Z) -> Blender (X,-Z,Y)"
    collection["ptr_effective_width_m"] = transform.effective_width
    collection["ptr_effective_depth_m"] = transform.effective_depth
    collection["ptr_effective_height_m"] = transform.effective_height
    collection["ptr_scale_x"] = transform.scale_x
    collection["ptr_scale_y"] = transform.scale_y
    collection["ptr_scale_z"] = transform.scale_z
    collection["ptr_placement_json"] = json.dumps(
        [transform.target_x, transform.target_y, transform.target_z], separators=(",", ":")
    )
    collection["ptr_bounds_json"] = json.dumps(document["bounds"], separators=(",", ":"), sort_keys=True)
    collection["ptr_features_json"] = json.dumps(document["features"], separators=(",", ":"), sort_keys=True)
    collection["ptr_unsupported_features_json"] = json.dumps(document.get("unsupportedFeatures", []))
    if document.get("generation") is not None:
        collection["ptr_generation_json"] = json.dumps(document["generation"], separators=(",", ":"), sort_keys=True)


def _cleanup(collection, objects, meshes, materials, images) -> None:
    for obj in reversed(objects):
        if obj.name in bpy.data.objects:
            bpy.data.objects.remove(obj, do_unlink=True)
    if collection is not None and collection.name in bpy.data.collections:
        bpy.data.collections.remove(collection)
    for mesh in reversed(meshes):
        if mesh.name in bpy.data.meshes and mesh.users == 0:
            bpy.data.meshes.remove(mesh)
    for material in reversed(materials):
        if material.name in bpy.data.materials and material.users == 0:
            bpy.data.materials.remove(material)
    for image in reversed(images):
        if image.name in bpy.data.images and image.users == 0:
            bpy.data.images.remove(image)


def build_project(
    context,
    document: dict[str, Any],
    document_root: Path,
    source_path: str,
    options: BuildOptions,
) -> BuildResult:
    warnings = _validate_artifacts(document, document_root)
    target = (0.0, 0.0, 0.0)
    if options.placement == "CURSOR":
        cursor = context.scene.cursor.location
        target = (float(cursor.x), float(cursor.y), float(cursor.z))
    transform = import_transform(
        document,
        options.dimension_mode,
        options.target_width,
        options.target_depth,
        options.vertical_scale,
        target,
    )
    collection = None
    objects: list[Any] = []
    meshes: list[Any] = []
    materials: list[Any] = []
    images: list[Any] = []
    try:
        project_name = _safe_name(Path(source_path).stem)
        collection = bpy.data.collections.new(f"Procedural Terrain - {project_name}")
        context.scene.collection.children.link(collection)
        _set_collection_metadata(collection, document, source_path, transform)
        window_manager = context.window_manager
        window_manager.progress_begin(0, len(document["tiles"]))
        try:
            for index, tile in enumerate(document["tiles"]):
                _create_mesh_object(
                    tile,
                    document_root,
                    collection,
                    options,
                    meshes,
                    objects,
                    materials,
                    images,
                    transform,
                )
                window_manager.progress_update(index + 1)
        finally:
            window_manager.progress_end()
        if options.select_imported:
            for selected in context.selected_objects:
                selected.select_set(False)
            for obj in objects:
                obj.select_set(True)
            if objects:
                context.view_layer.objects.active = objects[0]
        return BuildResult(collection, tuple(objects), tuple(warnings))
    except Exception:
        _cleanup(collection, objects, meshes, materials, images)
        raise
