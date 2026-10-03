"""Render isolated 513-grid QA scenes with Blender --background --factory-startup."""
import json
import math
import sys
import time
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from plugins.blender.procedural_terrains.generation import GenerationSettings, apply_terrain_preset
from plugins.blender.procedural_terrains.generation_builder import build_generated_terrain

output = ROOT / ".cache/plugin-qa/previews"
output.mkdir(parents=True, exist_ok=True)
scene = bpy.context.scene
# This runner is for a dedicated --factory-startup process only.
for obj in tuple(scene.objects):
    bpy.data.objects.remove(obj, do_unlink=True)
scene.render.engine = "CYCLES"
scene.cycles.samples = 24
scene.cycles.use_denoising = True
scene.render.resolution_x = 960
scene.render.resolution_y = 720
scene.render.resolution_percentage = 100
scene.world.use_nodes = True
world = next(n for n in scene.world.node_tree.nodes if n.type == "BACKGROUND")
world.inputs["Color"].default_value = (.25, .32, .42, 1)
world.inputs["Strength"].default_value = .8
camera_data = bpy.data.cameras.new("QA Camera")
camera = bpy.data.objects.new("QA Camera", camera_data)
scene.collection.objects.link(camera)
scene.camera = camera
camera_data.type = "ORTHO"
camera_data.clip_end = 10000
camera_data.ortho_scale = 1600
light_data = bpy.data.lights.new("QA Sun", "SUN")
light_data.energy = 3
light_data.angle = math.radians(12)
light = bpy.data.objects.new("QA Sun", light_data)
scene.collection.objects.link(light)
light.rotation_euler = (.4, -.6, -.5)
report = []
for preset in ("alpine", "dunes", "archipelago"):
    started = time.perf_counter()
    recipe = apply_terrain_preset(GenerationSettings(), preset)
    result = build_generated_terrain(bpy.context, recipe)
    camera.location = (1100, -1350, 1250)
    focus = Vector((0, 0, recipe.height * .25))
    camera.rotation_euler = (focus - camera.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = str(output / (preset + ".png"))
    bpy.ops.render.render(write_still=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(output / (preset + ".blend")))
    report.append({"preset": preset, "resolution": recipe.resolution, "vertices": recipe.vertex_count,
                   "seconds": round(time.perf_counter() - started, 2)})
    for obj in tuple(result.collection.objects):
        mesh = obj.data
        materials = tuple(mesh.materials)
        bpy.data.objects.remove(obj, do_unlink=True)
        if mesh.users == 0: bpy.data.meshes.remove(mesh)
        for material in materials:
            if material.users == 0: bpy.data.materials.remove(material)
    bpy.data.collections.remove(result.collection)
(output / "report.json").write_text(json.dumps(report, indent=2))
print(json.dumps(report))
