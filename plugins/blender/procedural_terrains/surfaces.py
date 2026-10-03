"""Editable procedural surface nodes; no external images or assets required."""
import bpy


def procedural_material(name, settings):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material["ptr_generated_preview"] = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    output.location = (1000, 0)
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    shader.location = (760, 0)
    shader.inputs["Roughness"].default_value = .82
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    coordinate = nodes.new("ShaderNodeAttribute")
    coordinate.attribute_name = "ptr_assembly_position"
    coordinate.location = (-800, -450)
    noise = nodes.new("ShaderNodeTexNoise")
    noise.location = (-550, -450)
    noise.inputs["Scale"].default_value = 1 / settings.surface_grain
    noise.inputs["Detail"].default_value = 2
    links.new(coordinate.outputs["Vector"], noise.inputs["Vector"])
    combined = None
    for index, role in enumerate(("sand", "grass", "rock", "snow")):
        attribute = nodes.new("ShaderNodeAttribute")
        attribute.attribute_name = f"ptr_surface_{role}"
        attribute.location = (-800, 300 - index * 200)
        tint = nodes.new("ShaderNodeMixRGB")
        tint.label = role.title() + " Color"
        tint.blend_type = "MULTIPLY"
        tint.inputs[0].default_value = 1
        tint.inputs[1].default_value = (*getattr(settings, role + "_color"), 1)
        tint.location = (-550, 300 - index * 200)
        links.new(attribute.outputs["Fac"], tint.inputs[2])
        if combined is None:
            combined = tint.outputs["Color"]
        else:
            add = nodes.new("ShaderNodeMixRGB")
            add.blend_type = "ADD"
            add.inputs[0].default_value = 1
            add.location = (-250 + index * 150, 200 - index * 100)
            links.new(combined, add.inputs[1])
            links.new(tint.outputs["Color"], add.inputs[2])
            combined = add.outputs["Color"]
    grain = nodes.new("ShaderNodeMapRange")
    grain.location = (-200, -450)
    grain.inputs["To Min"].default_value = .8
    grain.inputs["To Max"].default_value = 1.1
    links.new(noise.outputs["Fac"], grain.inputs["Value"])
    multiply = nodes.new("ShaderNodeMixRGB")
    multiply.blend_type = "MULTIPLY"
    multiply.inputs[0].default_value = 1
    multiply.location = (520, 80)
    links.new(combined, multiply.inputs[1])
    links.new(grain.outputs["Result"], multiply.inputs[2])
    links.new(multiply.outputs["Color"], shader.inputs["Base Color"])
    bump = nodes.new("ShaderNodeBump")
    bump.location = (520, -250)
    bump.inputs["Strength"].default_value = settings.surface_normal_strength
    bump.inputs["Distance"].default_value = settings.surface_grain * .08
    links.new(noise.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], shader.inputs["Normal"])
    return material
