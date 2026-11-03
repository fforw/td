"""
Bakes a hand-placed house into one mesh without the faces that cannot be seen from outside.

Build a house in its own collection from linked copies of the templates made by tag_templates.py (Alt+D), snapped to
the tile grid. Walls go inside the footprint with the outside facing out, roofs sit on top of the walls, pieces may
be rotated, mirrored or scaled (e.g. half-width slopes for a narrow wing). Other meshes in the collection are baked
as they are.

Make the house collection active in the outliner and run the script. It writes "<house>_baked" into its own
collection next to the house, and leaves the house itself untouched, so it can be edited and baked again.

Which faces go:
  - joints, ridges and wall tops only where another piece covers them, found by probing a point just beyond the
    face against the other pieces: a wall end next to another wall end, a roof run continuing, a ridge with a
    slope behind it, a wall top under a roof or another wall
  - wall bottoms always
  - inside faces, roof bottoms and attic beams unless the house collection has a custom property "open" set to true
  - roof soffits only with DROP_SOFFIT, as they show from below the eaves
"""

import bmesh
import bpy
from mathutils import Vector

DROP_SOFFIT = False

# set to a directory to also export the baked house as <house>.glb
EXPORT_DIR = None

EXTERIOR, INTERIOR, JOINT_NEG, JOINT_POS, TOP, BOTTOM, RIDGE, SOFFIT = range(8)

# probe points in the template frame (see tag_templates.py), just beyond the face they test
WALL_END_NEG = Vector((-0.45, -0.5, 0.5))
WALL_END_POS = Vector((-0.45, 0.5, 0.5))
WALL_TOP_PROBE = Vector((-0.45, 0, 1.05))
ROOF_JOINT_NEG_PROBE = Vector((-0.25, -0.75, 0.2))
ROOF_JOINT_POS_PROBE = Vector((-0.25, 0.75, 0.2))
ROOF_RIDGE_PROBE = Vector((-0.6, 0, 0.2))

# wall ends closer than this meet, in line or at a corner
WALL_END_DISTANCE = 0.15


def roof_top_z(x):
    """
    Height of the roof surface over the tile, from the ridge at x=-0.5 down to the eave
    """
    return 0.626 - 0.574 * (x + 0.5)


def inside_wall(piece, point):
    p = piece.matrix_world.inverted() @ point
    return -0.5 <= p.x <= -0.4 and abs(p.y) <= 0.5 and 0 <= p.z <= 1


def inside_roof(piece, point):
    p = piece.matrix_world.inverted() @ point
    return -0.5 <= p.x <= 0.5 and abs(p.y) <= 0.5 and 0 <= p.z <= roof_top_z(p.x)


def kind(obj):
    return obj.data.get("tpl_kind") if obj.type == "MESH" else None


def covered(point, pieces, test, skip):
    return any(test(other, point) for other in pieces if other is not skip)


def dropped_tags(piece, walls, roofs, closed):
    M = piece.matrix_world
    drop = set()
    if closed:
        drop |= {INTERIOR}

    if kind(piece) == "wall":
        drop.add(BOTTOM)
        for tag, end in ((JOINT_NEG, WALL_END_NEG), (JOINT_POS, WALL_END_POS)):
            point = M @ end
            for other in walls:
                if other is piece:
                    continue
                ends = (other.matrix_world @ WALL_END_NEG, other.matrix_world @ WALL_END_POS)
                if any((point - e).length < WALL_END_DISTANCE for e in ends):
                    drop.add(tag)
                    break
        top = M @ WALL_TOP_PROBE
        if covered(top, roofs, inside_roof, piece) or covered(top, walls, inside_wall, piece):
            drop.add(TOP)
    else:
        if closed:
            drop.add(BOTTOM)
        if DROP_SOFFIT:
            drop.add(SOFFIT)
        for tag, probe in ((JOINT_NEG, ROOF_JOINT_NEG_PROBE), (JOINT_POS, ROOF_JOINT_POS_PROBE),
                           (RIDGE, ROOF_RIDGE_PROBE)):
            if covered(M @ probe, roofs, inside_roof, piece):
                drop.add(tag)
    return drop


def bake(house, closed):
    objects = [o for o in house.all_objects if o.type == "MESH"]
    walls = [o for o in objects if kind(o) == "wall"]
    roofs = [o for o in objects if kind(o) == "roof"]

    bm = bmesh.new()
    materials = []
    before = after = 0
    for obj in objects:
        part = bmesh.new()
        part.from_mesh(obj.data)
        before += len(part.faces)

        layer = part.faces.layers.int.get("side")
        if layer is not None:
            drop = dropped_tags(obj, walls, roofs, closed)
            bmesh.ops.delete(part, geom=[f for f in part.faces if f[layer] in drop], context="FACES_ONLY")

        M = obj.matrix_world
        bmesh.ops.transform(part, matrix=M, verts=part.verts)
        if M.determinant() < 0:
            bmesh.ops.reverse_faces(part, faces=part.faces)

        # map the part's material slots onto the baked mesh's, carried in a face attribute through the merge
        slots = []
        for material in obj.data.materials:
            if material not in materials:
                materials.append(material)
            slots.append(materials.index(material))
        material_layer = part.faces.layers.int.new("_material")
        for face in part.faces:
            face[material_layer] = slots[face.material_index] if slots else 0

        after += len(part.faces)
        mesh = bpy.data.meshes.new("part")
        part.to_mesh(mesh)
        part.free()
        bm.from_mesh(mesh)
        bpy.data.meshes.remove(mesh)

    material_layer = bm.faces.layers.int["_material"]
    for face in bm.faces:
        face.material_index = face[material_layer]
    bm.faces.layers.int.remove(material_layer)

    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)

    # origin at the middle of the footprint, on the ground
    xs = [v.co.x for v in bm.verts]
    ys = [v.co.y for v in bm.verts]
    zs = [v.co.z for v in bm.verts]
    origin = Vector(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, min(zs)))
    bmesh.ops.translate(bm, vec=-origin, verts=bm.verts)

    name = house.name + "_baked"
    mesh = bpy.data.meshes.get(name) or bpy.data.meshes.new(name)
    # slots first, as clearing them resets the faces' material indices
    mesh.materials.clear()
    for material in materials:
        mesh.materials.append(material)
    bm.to_mesh(mesh)
    bm.free()
    for attribute in ("side", "sideColor"):
        if attribute in mesh.attributes:
            mesh.attributes.remove(mesh.attributes[attribute])

    collection = bpy.data.collections.get(name)
    if collection is None:
        collection = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(collection)
    obj = bpy.data.objects.get(name)
    if obj is None:
        obj = bpy.data.objects.new(name, mesh)
        collection.objects.link(obj)
    obj.data = mesh
    obj.location = origin

    return obj, before, after


def export(obj):
    import os
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    location = obj.location.copy()
    obj.location = (0, 0, 0)
    path = os.path.join(EXPORT_DIR, obj.name.removesuffix("_baked") + ".glb")
    bpy.ops.export_scene.gltf(filepath=path, use_selection=True, export_format="GLB", export_attributes=False)
    obj.location = location
    return path


def main(house=None):
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    # world matrices of freshly placed or moved pieces are only valid after an update
    bpy.context.view_layer.update()
    house = house or bpy.context.view_layer.active_layer_collection.collection
    closed = not house.get("open", False)
    obj, before, after = bake(house, closed)
    report = {"house": house.name, "baked": obj.name, "faces_before": before, "faces_after": after}
    if EXPORT_DIR:
        report["exported"] = export(obj)
    return report


if __name__ == "__main__":
    print(main())
