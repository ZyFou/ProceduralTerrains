"""A separate, persistent placeholder surface shared by creation and import."""
import json
import math

import bpy


def update_water(collection, enabled, level, color):
    if not math.isfinite(level) or len(color) != 3 or not all(math.isfinite(v) and 0 <= v <= 1 for v in color):
        raise ValueError("Invalid water level or color.")
    collection["ptr_water_enabled"] = enabled
    collection["ptr_water_level"] = level
    collection["ptr_water_color"] = list(color)
    obj = next((o for o in collection.objects if o.get("ptr_generated_water")), None)
    if obj is None:
        mesh = bpy.data.meshes.new("Water Placeholder")
        mesh.from_pydata([(-.5, -.5, 0), (.5, -.5, 0), (.5, .5, 0), (-.5, .5, 0)], [], [(0, 1, 2, 3)])
        obj = bpy.data.objects.new("Water Placeholder", mesh)
        obj["ptr_generated_water"] = True
        collection.objects.link(obj)
        material = bpy.data.materials.new("PT Water Placeholder")
        material["ptr_generated_water"] = True
        material.use_nodes = True
        mesh.materials.append(material)
    placement = json.loads(collection.get("ptr_placement_json", "[0,0,0]"))
    obj.location = (placement[0], placement[1], placement[2] + level)
    obj.scale = (collection["ptr_effective_width_m"], collection["ptr_effective_depth_m"], 1)
    material = obj.data.materials[0]
    material.diffuse_color = (*color, 1)
    shader = next(n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Roughness"].default_value = .25
    obj.hide_viewport = not enabled
    obj.hide_render = not enabled
    obj.hide_set(not enabled)
    if collection.get("ptr_generated"):
        recipe = json.loads(collection["ptr_generation_json"])
        recipe.update(water_enabled=enabled, water_level=level, water_color=list(color))
        collection["ptr_generation_json"] = json.dumps(recipe, separators=(",", ":"), sort_keys=True)
    return obj


def collection_from_context(context):
    if context.active_object:
        return next((c for c in context.active_object.users_collection
                     if c.get("ptr_generated") or c.get("ptr_format") == "procedural-terrains"), None)
    return None
