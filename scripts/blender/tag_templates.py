"""
Imports Fantasy Town Kit pieces as house templates whose faces know which side of the building they are on.

Run from Blender's text editor. Each piece becomes one mesh "<piece>_tpl" in the "templates" collection, in a 1x1x1
tile frame around the origin: walls stand on the +X tile edge with the outside facing +X, roof slopes sit one unit up
with the ridge at -X and the eave at +X. So a wall and the roof above it share their tile's center as origin, and
houses can be assembled by snapping origins to the grid and rotating in 90 degree steps. Rerunning updates the
template meshes in place, so linked copies in hand-placed houses pick up the changes.

Every face gets an integer face attribute "side" (see TAGS) that cull_house.py uses to drop faces that cannot be
seen once the pieces are assembled, and a "sideColor" color attribute to inspect the tags in the viewport.

Wall templates with see-through openings (windows, door windows) get a dark backing quad in the middle of the wall,
so the openings do not show the background once the inside of the house is gone.
"""

import os

import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

KIT_DIR = "/home/sven/godot/kenney-assets/3D assets/Fantasy Town Kit/Models/GLTF format/"

PIECES = [
    "wall", "wallWindowShutters", "wallWindowGlass", "wallDoor",
    "wallWood", "wallWoodDoor", "wallWoodWindowShutters", "wallWoodDetailDiagonal", "wallWoodDetailCross",
    "roof", "roofLeft", "roofRight",
    "roofHigh", "roofHighLeft", "roofHighRight",
]

COLLECTION = "templates"

TAGS = ["exterior", "interior", "joint_neg", "joint_pos", "top", "bottom", "ridge", "soffit"]
EXTERIOR, INTERIOR, JOINT_NEG, JOINT_POS, TOP, BOTTOM, RIDGE, SOFFIT = range(len(TAGS))

TAG_COLORS = [
    (0.75, 0.75, 0.75, 1),  # exterior
    (0.1, 0.3, 1, 1),  # interior
    (1, 0.85, 0, 1),  # joint_neg
    (1, 0.5, 0, 1),  # joint_pos
    (0.1, 0.85, 0.2, 1),  # top
    (0.9, 0, 0.9, 1),  # bottom
    (0, 0.9, 0.9, 1),  # ridge
    (0.9, 0.1, 0.1, 1),  # soffit
]

# in the kit, wall panels are slabs between -0.475 and -0.425 with posts out to -0.5 and -0.4; everything behind the
# middle plane is inside the house, including the mirrored window frames and door panels
WALL_MIDDLE = -0.45

# moves the kit's walls from the -X tile edge of the tile outside the house to the +X edge of the tile inside
WALL_SHIFT = 0.9

# the roof sits on top of the walls
ROOF_LIFT = 1.0

# roof profiles in the kit frame: the underside runs from (x=-0.4, z=underside) down to the eave, the top from the
# ridge (x=-0.5, z=top) down; both fall by "slope" per unit. High roofs rise a whole tile, so they can be stacked in
# rows on the grid for wide houses.
ROOF_UNDERSIDE_X = -0.4
ROOF_PROFILES = {
    "roof": {"underside": 0.45, "top": 0.626, "slope": 0.5, "top_slope": 0.574},
    "roofHigh": {"underside": 0.9, "top": 1.141, "slope": 1.0, "top_slope": 1.0},
}

# faces of the wall top and bottom, joints etc. must lie within this distance of their plane
PLANE_EPS = 0.011
AXIS = 0.99

# spacing of the rays that look for see-through openings, and how far the backing quad overlaps them
OPENING_STEP = 0.01
BACKING_PAD = 0.015
BACKING_MATERIAL = "interiorDark"


def base_name(name):
    return name.split(".")[0]


def shared_material(material):
    """
    Returns the scene's material of the same base name, so "stone.001" from a fresh import becomes "stone"
    """
    name = base_name(material.name)
    existing = bpy.data.materials.get(name)
    if existing is None:
        material.name = name
        return material
    return existing


def import_baked(piece):
    """
    Imports the kit piece and bakes all its parts into one bmesh in the piece's frame. Parts with mirroring
    transforms get their winding reversed so they still face outward. Returns the bmesh and its materials.
    """
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(KIT_DIR, piece + ".glb"))
    imported = [o for o in bpy.data.objects if o not in before]
    root = next(o for o in imported if o.parent is None)
    root.location = (0, 0, 0)
    bpy.context.view_layer.update()

    bm = bmesh.new()
    materials = []
    for obj in imported:
        if obj.type != "MESH":
            continue
        matrix = root.matrix_world.inverted() @ obj.matrix_world
        part_mesh = obj.data.copy()
        part_mesh.transform(matrix)
        part = bmesh.new()
        part.from_mesh(part_mesh)
        if matrix.determinant() < 0:
            bmesh.ops.reverse_faces(part, faces=part.faces)

        # the merged material index travels in a face attribute, the part meshes do not have enough slots for it
        part_materials = [shared_material(m) for m in obj.data.materials]
        material_layer = part.faces.layers.int.new("_material")
        for face in part.faces:
            material = part_materials[face.material_index]
            if material not in materials:
                materials.append(material)
            face[material_layer] = materials.index(material)

        part.to_mesh(part_mesh)
        part.free()
        bm.from_mesh(part_mesh)
        bpy.data.meshes.remove(part_mesh)

    material_layer = bm.faces.layers.int["_material"]
    for face in bm.faces:
        face.material_index = face[material_layer]
    bm.faces.layers.int.remove(material_layer)

    for obj in imported:
        data = obj.data
        bpy.data.objects.remove(obj)
        if data is not None and data.users == 0:
            bpy.data.meshes.remove(data)

    return bm, materials


def wall_side(face):
    n = face.normal
    c = face.calc_center_median()
    if n.y < -AXIS and c.y < -0.45:
        return JOINT_NEG
    if n.y > AXIS and c.y > 0.45:
        return JOINT_POS
    if n.z > AXIS and abs(c.z - 1) < PLANE_EPS:
        return TOP
    if n.z < -AXIS and abs(c.z) < PLANE_EPS:
        return BOTTOM
    if all(v.co.x <= WALL_MIDDLE + 1e-4 for v in face.verts):
        return INTERIOR
    return EXTERIOR


def roof_profile(piece):
    return ROOF_PROFILES["roofHigh" if piece.startswith("roofHigh") else "roof"]


def roof_underside_z(profile, x):
    return profile["underside"] - profile["slope"] * (x - ROOF_UNDERSIDE_X)


def roof_side(face, profile):
    n = face.normal
    c = face.calc_center_median()
    xs = [v.co.x for v in face.verts]
    if n.x < -AXIS and max(xs) <= -0.49:
        return RIDGE
    if n.y < -AXIS and c.y < -0.45:
        return JOINT_NEG
    if n.y > AXIS and c.y > 0.45:
        return JOINT_POS
    if n.z < -AXIS and max(v.co.z for v in face.verts) <= 0.001:
        return BOTTOM
    if n.z < -0.3:
        # undersides reaching past the wall line can be seen from below the eave
        return SOFFIT if max(xs) > 0.45 else INTERIOR
    if all(v.co.x <= 0.45 and abs(v.co.y) <= 0.48 and v.co.z <= roof_underside_z(profile, v.co.x) + 0.01
           for v in face.verts):
        return INTERIOR
    return EXTERIOR


def find_openings(bm):
    """
    Shoots rays through the wall along X and returns the bounding box (y0, y1, z0, z1) of all rays that pass,
    or None for walls without openings
    """
    bm.verts.ensure_lookup_table()
    bvh = BVHTree.FromBMesh(bm)
    steps = int(0.5 / OPENING_STEP)
    hits = []
    for iy in range(-steps + 2, steps - 1):
        for iz in range(2, 2 * steps - 1):
            y, z = iy * OPENING_STEP, iz * OPENING_STEP
            if bvh.ray_cast(Vector((1, y, z)), Vector((-1, 0, 0)))[0] is None:
                hits.append((y, z))
    if not hits:
        return None
    ys = [h[0] for h in hits]
    zs = [h[1] for h in hits]
    return min(ys), max(ys), min(zs), max(zs)


def add_backing(bm, box, material_index):
    y0, y1, z0, z1 = box
    y0, y1, z0, z1 = y0 - BACKING_PAD, y1 + BACKING_PAD, z0 - BACKING_PAD, z1 + BACKING_PAD
    x = WALL_MIDDLE
    verts = [bm.verts.new(Vector(p)) for p in ((x, y0, z0), (x, y1, z0), (x, y1, z1), (x, y0, z1))]
    face = bm.faces.new(verts)
    face.normal_update()
    if face.normal.x < 0:
        face.normal_flip()
    face.material_index = material_index
    return face


def backing_material():
    material = bpy.data.materials.get(BACKING_MATERIAL)
    if material is None:
        material = bpy.data.materials.new(BACKING_MATERIAL)
        material.use_nodes = True
        material.use_backface_culling = True
        color = (0.02, 0.018, 0.02, 1)
        material.diffuse_color = color
        bsdf = material.node_tree.nodes["Principled BSDF"]
        bsdf.inputs["Base Color"].default_value = color
        bsdf.inputs["Roughness"].default_value = 1
    return material


def template_collection():
    collection = bpy.data.collections.get(COLLECTION)
    if collection is None:
        collection = bpy.data.collections.new(COLLECTION)
        bpy.context.scene.collection.children.link(collection)
    return collection


def build_template(piece):
    kind = "roof" if piece.startswith("roof") else "wall"
    bm, materials = import_baked(piece)

    tag_layer = bm.faces.layers.int.new("side")
    profile = roof_profile(piece) if kind == "roof" else None
    for face in bm.faces:
        face.normal_update()
        face[tag_layer] = roof_side(face, profile) if profile else wall_side(face)

    opening = find_openings(bm) if kind == "wall" else None
    if opening:
        materials.append(backing_material())
        face = add_backing(bm, opening, len(materials) - 1)
        face[tag_layer] = EXTERIOR

    shift = Vector((WALL_SHIFT, 0, 0)) if kind == "wall" else Vector((0, 0, ROOF_LIFT))
    bmesh.ops.translate(bm, vec=shift, verts=bm.verts)

    name = piece + "_tpl"
    mesh = bpy.data.meshes.get(name)
    if mesh is None:
        mesh = bpy.data.meshes.new(name)
    # reuse the mesh so linked copies follow; slots first, as clearing them resets the faces' material indices
    mesh.materials.clear()
    for material in materials:
        mesh.materials.append(material)
    bm.to_mesh(mesh)
    bm.free()
    mesh["tpl_kind"] = kind
    if profile:
        # cull_house.py tests probes against the roof's top surface
        mesh["tpl_roof_top"] = profile["top"], profile["top_slope"]

    colors = mesh.color_attributes.get("sideColor") or mesh.color_attributes.new("sideColor", "FLOAT_COLOR", "CORNER")
    sides = mesh.attributes["side"].data
    for poly in mesh.polygons:
        color = TAG_COLORS[sides[poly.index].value]
        for loop in poly.loop_indices:
            colors.data[loop].color = color

    obj = bpy.data.objects.get(name)
    if obj is None:
        obj = bpy.data.objects.new(name, mesh)
        template_collection().objects.link(obj)
    obj.data = mesh
    # palette rows below the origin, one for walls and one for roofs
    same_kind = [p for p in PIECES if p.startswith("roof") == (kind == "roof")]
    obj.location = (same_kind.index(piece) * 2, -4 if kind == "wall" else -8, 0)

    counts = {tag: 0 for tag in TAGS}
    for item in sides:
        counts[TAGS[item.value]] += 1
    return {"faces": len(mesh.polygons), "opening": opening is not None, **counts}


def main():
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    report = {piece: build_template(piece) for piece in PIECES}
    for material in list(bpy.data.materials):
        if material.users == 0 and "." in material.name:
            bpy.data.materials.remove(material)
    return report


if __name__ == "__main__":
    for piece, info in main().items():
        print(piece, info)
