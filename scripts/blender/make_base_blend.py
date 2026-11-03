"""
Creates the base .blend for assembling houses from the Fantasy Town Kit templates.

    blender -b --factory-startup --python scripts/blender/make_base_blend.py -- <output.blend>

The file contains the tagged templates (see tag_templates.py) as a palette below the origin, an empty "house"
collection to build in, both scripts as text blocks linked to this directory, grid snapping with 90 degree rotation
steps, and viewports showing material colors with backface culling, like three.js does.
"""

import math
import os
import sys

import bpy

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SCRIPTS = ["tag_templates.py", "cull_house.py"]

HOUSE_COLLECTION = "house"


def run_script(name):
    path = os.path.join(SCRIPT_DIR, name)
    scope = {"__name__": name[:-3], "__file__": path}
    exec(compile(open(path).read(), path, "exec"), scope)
    return scope["main"]()


def clear_scene():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj)
    for collection in list(bpy.data.collections):
        bpy.data.collections.remove(collection)
    for blocks in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for block in list(blocks):
            if block.users == 0:
                blocks.remove(block)


def setup_snapping(scene):
    tools = scene.tool_settings
    tools.use_snap = True
    # absolute increments snap moves to the viewport grid like the "Grid" target does, but only increments use the
    # rotation increment; with "Grid", rotations snap points onto the grid and end up at odd angles
    tools.snap_elements_base = {"INCREMENT"}
    tools.use_snap_grid_absolute = True
    tools.use_snap_translate = True
    tools.use_snap_rotate = True
    tools.snap_angle_increment_3d = math.radians(90)


def setup_viewports():
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type != "VIEW_3D":
                continue
            for space in area.spaces:
                if space.type == "VIEW_3D":
                    space.shading.type = "SOLID"
                    space.shading.color_type = "MATERIAL"
                    space.shading.show_backface_culling = True


def link_scripts():
    for name in SCRIPTS:
        text = bpy.data.texts.get(name)
        if text is not None:
            bpy.data.texts.remove(text)
        bpy.data.texts.load(os.path.join(SCRIPT_DIR, name), internal=False)


def main(output):
    clear_scene()
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0

    report = run_script("tag_templates.py")

    house = bpy.data.collections.new(HOUSE_COLLECTION)
    house["open"] = False
    scene.collection.children.link(house)
    bpy.context.view_layer.active_layer_collection = bpy.context.view_layer.layer_collection.children[house.name]

    setup_snapping(scene)
    setup_viewports()
    link_scripts()

    bpy.ops.wm.save_as_mainfile(filepath=output)
    return report


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(args) != 1:
        sys.exit("usage: blender -b --factory-startup --python make_base_blend.py -- <output.blend>")
    for piece, info in main(os.path.abspath(args[0])).items():
        print(piece, info["faces"], "faces")
