"""Blender mesh/material construction for native procedural terrain."""

from __future__ import annotations

from array import array
from dataclasses import dataclass
import json
from typing import Any

import bpy

from .generation import GenerationSettings, TerrainEvaluator
from .heightfield import loop_uvs, quad_faces


@dataclass(frozen=True)
class GenerationResult:
    collection: Any
    objects: tuple[Any, ...]


def _preview_material(name: str):
    material = bpy.data.materials.new(name=name)
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    output.location = (680, 0)
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    shader.location = (420, 0)
    shader.inputs["Roughness"].default_value = .82
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])

    attribute = nodes.new("ShaderNodeAttribute")
    attribute.attribute_name = "ptr_normalized_height"
    attribute.location = (-620, 160)
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.location = (-380, 160)
    colors = (
        (.05, (0.05, 0.09, 0.025, 1)),
        (.22, (0.16, 0.30, 0.055, 1)),
        (.50, (0.26, 0.20, 0.10, 1)),
        (.75, (0.34, 0.34, 0.32, 1)),
        (.94, (0.9, 0.92, 0.94, 1)),
    )
    color_ramp = ramp.color_ramp
    color_ramp.elements.remove(color_ramp.elements[1])
    color_ramp.elements[0].position = colors[0][0]
    color_ramp.elements[0].color = colors[0][1]
    for position, color in colors[1:]:
        element = color_ramp.elements.new(position)
        element.color = color
    links.new(attribute.outputs["Fac"], ramp.inputs["Fac"])

    geometry = nodes.new("ShaderNodeNewGeometry")
    geometry.location = (-360, -160)
    dot = nodes.new("ShaderNodeVectorMath")
    dot.operation = "DOT_PRODUCT"
    dot.location = (-140, -150)
    dot.inputs[1].default_value = (0, 0, 1)
    links.new(geometry.outputs["Normal"], dot.inputs[0])
    slope = nodes.new("ShaderNodeMapRange")
    slope.location = (50, -120)
    slope.inputs[1].default_value = .25
    slope.inputs[2].default_value = .75
    slope.inputs[3].default_value = .45
    slope.inputs[4].default_value = 1.0
    slope.clamp = True
    links.new(dot.outputs["Value"], slope.inputs["Value"])
    multiply = nodes.new("ShaderNodeMixRGB")
    multiply.blend_type = "MULTIPLY"
    multiply.inputs[0].default_value = 1.0
    multiply.location = (210, 100)
    links.new(ramp.outputs["Color"], multiply.inputs[1])
    links.new(slope.outputs["Result"], multiply.inputs[2])
    links.new(multiply.outputs["Color"], shader.inputs["Base Color"])
    material["ptr_generated_preview"] = True
    return material


def _create_tile(collection, material, evaluator: TerrainEvaluator, settings: GenerationSettings,
                 tile_x: int, tile_y: int, target: tuple[float, float, float]):
    grid_x, grid_y, heights = evaluator.tile_grid(tile_x, tile_y)
    resolution = settings.resolution
    tile_width, tile_depth = settings.width / settings.tiles_x, settings.depth / settings.tiles_y
    center_x = -settings.width * .5 + (tile_x + .5) * tile_width
    center_y = -settings.depth * .5 + (tile_y + .5) * tile_depth
    local_x = grid_x - center_x
    local_y = -(grid_y - center_y)
    vertices = list(zip(local_x.ravel().tolist(), local_y.ravel().tolist(), heights.ravel().tolist()))
    name = f"Generated_Terrain_{tile_x}_{tile_y}"
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], list(quad_faces(resolution)))
    mesh.validate(clean_customdata=False)
    mesh.update(calc_edges=True)
    uv_layer = mesh.uv_layers.new(name="Terrain UV")
    uv_values = array("f")
    for uv in loop_uvs(resolution):
        uv_values.extend(uv)
    uv_layer.data.foreach_set("uv", uv_values)
    height_attribute = mesh.attributes.new("ptr_normalized_height", "FLOAT", "POINT")
    normalized = (heights / max(settings.height, .0001)).astype("float32").ravel()
    height_attribute.data.foreach_set("value", normalized)
    if settings.smooth_shading:
        for polygon in mesh.polygons:
            polygon.use_smooth = True
    if material is not None:
        mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj.location = (target[0] + center_x, target[1] - center_y, target[2])
    obj["ptr_generated_tile"] = True
    obj["ptr_tile_x"] = tile_x
    obj["ptr_tile_y"] = tile_y
    obj["ptr_mesh_resolution"] = resolution
    obj["ptr_tile_width_m"] = tile_width
    obj["ptr_tile_depth_m"] = tile_depth
    return obj


def _remove_generated_objects(collection, keep: set[str] | None = None) -> None:
    keep = keep or set()
    for obj in tuple(collection.objects):
        if obj.get("ptr_generated_tile") and obj.name not in keep:
            mesh = obj.data if obj.type == "MESH" else None
            bpy.data.objects.remove(obj, do_unlink=True)
            if mesh is not None and mesh.users == 0:
                bpy.data.meshes.remove(mesh)


def build_generated_terrain(context, settings: GenerationSettings, collection=None) -> GenerationResult:
    settings.validate()
    evaluator = TerrainEvaluator(settings)
    created_collection = collection is None
    if collection is None:
        collection = bpy.data.collections.new("Procedural Terrain - Generated")
        context.scene.collection.children.link(collection)
    target = (0.0, 0.0, 0.0)
    if settings.placement == "CURSOR":
        cursor = context.scene.cursor.location
        target = (float(cursor.x), float(cursor.y), float(cursor.z))
    material = _preview_material(f"PT Generated Preview - {collection.name}") if settings.create_material else None
    existing = {
        (int(obj.get("ptr_tile_x", -1)), int(obj.get("ptr_tile_y", -1))): obj
        for obj in collection.objects if obj.get("ptr_generated_tile")
    }
    created: list[Any] = []
    try:
        context.window_manager.progress_begin(0, settings.tiles_x * settings.tiles_y)
        try:
            for tile_y in range(settings.tiles_y):
                for tile_x in range(settings.tiles_x):
                    created.append(_create_tile(collection, material, evaluator, settings, tile_x, tile_y, target))
                    context.window_manager.progress_update(len(created))
        finally:
            context.window_manager.progress_end()
        final_objects: list[Any] = []
        for new_object in created:
            key = (int(new_object["ptr_tile_x"]), int(new_object["ptr_tile_y"]))
            old_object = existing.pop(key, None)
            if old_object is None:
                final_objects.append(new_object)
                continue
            old_mesh = old_object.data
            old_object.data = new_object.data
            old_object.location = new_object.location
            for property_name in new_object.keys():
                old_object[property_name] = new_object[property_name]
            bpy.data.objects.remove(new_object, do_unlink=True)
            if old_mesh.users == 0:
                bpy.data.meshes.remove(old_mesh)
            final_objects.append(old_object)
        for old_object in existing.values():
            old_mesh = old_object.data if old_object.type == "MESH" else None
            bpy.data.objects.remove(old_object, do_unlink=True)
            if old_mesh is not None and old_mesh.users == 0:
                bpy.data.meshes.remove(old_mesh)
        created = final_objects
        collection["ptr_generated"] = True
        collection["ptr_generation_version"] = 1
        collection["ptr_generation_json"] = settings.to_json()
        collection["ptr_effective_width_m"] = settings.width
        collection["ptr_effective_depth_m"] = settings.depth
        collection["ptr_effective_height_m"] = settings.height
        collection["ptr_vertex_count"] = settings.vertex_count
        collection["ptr_placement_json"] = json.dumps(target, separators=(",", ":"))
        for selected in context.selected_objects:
            selected.select_set(False)
        for obj in created:
            obj.select_set(True)
        if created:
            context.view_layer.objects.active = created[0]
        for old_material in tuple(bpy.data.materials):
            if old_material is not material and old_material.get("ptr_generated_preview") and old_material.users == 0:
                bpy.data.materials.remove(old_material)
        return GenerationResult(collection, tuple(created))
    except Exception:
        for obj in reversed(created):
            mesh = obj.data if obj.type == "MESH" else None
            bpy.data.objects.remove(obj, do_unlink=True)
            if mesh is not None and mesh.users == 0:
                bpy.data.meshes.remove(mesh)
        if material is not None and material.users == 0:
            bpy.data.materials.remove(material)
        if created_collection:
            bpy.data.collections.remove(collection)
        raise


def generated_collection_from_context(context):
    active = context.active_object
    if active is None:
        return None
    for collection in active.users_collection:
        if collection.get("ptr_generated"):
            return collection
    return None
