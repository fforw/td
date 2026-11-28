/**
 * Exports the meshes of the Blender files in media-src as GLB files to public/media, one file per object, named after the
 * object in kebab case: "Health Potion" becomes health-potion.glb.
 *
 *     pnpm export-models
 *
 * Needs Blender, from BLENDER or else the PATH. Each object gets exported where the origin is, as the game takes the
 * meshes without their place in the Blender scene. Rotation and scale have to be applied in Blender, the script refuses
 * objects with either.
 */
import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dirname, "..")

/**
 * Blender files in media-src, and the folder in public/media their models go to
 */
const BLENDS: Record<string, string> = {
    "potions.blend": "treasure",
    "dagger.blend": "items"
}

/**
 * Runs in Blender with the output folder as the argument after "--". Prints a line per model, or fails with the objects
 * that still have a rotation or a scale.
 */
const EXPORT = `
import bpy, sys, re
out = sys.argv[sys.argv.index("--") + 1]
objects = [o for o in bpy.context.scene.objects if o.type == "MESH" and not o.hide_render]
unapplied = [o.name for o in objects if any(abs(v) > 1e-5 for v in o.rotation_euler) or any(abs(v - 1) > 1e-5 for v in o.scale)]
if unapplied:
    raise SystemExit("Apply rotation and scale of " + ", ".join(unapplied))
for o in objects:
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    o.location = (0, 0, 0)
    path = out + "/" + re.sub(r"[^a-z0-9]+", "-", o.name.lower()).strip("-") + ".glb"
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
        export_texcoords=False, export_cameras=False, export_lights=False, export_animations=False
    )
    print("exported", o.name, "->", path)
`

const blender = process.env.BLENDER ?? "blender"
for (const [blend, folder] of Object.entries(BLENDS))
{
    const out = join(ROOT, "public/media", folder)
    mkdirSync(out, { recursive: true })
    let output: string
    try
    {
        output = execFileSync(blender, ["--background", "--factory-startup", join(ROOT, "media-src", blend), "--python-exit-code", "1", "--python-expr", EXPORT, "--", out], { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] })
    }
    catch (e)
    {
        const { stdout, stderr } = e as { stdout?: string, stderr?: string }
        throw new Error("Blender couldn't export " + blend + ", is it installed or set in BLENDER?\n" + (stdout ?? "") + (stderr ?? ""), { cause: e })
    }
    for (const line of output.split("\n"))
    {
        if (line.startsWith("exported "))
        {
            console.log(blend + ": " + line.slice("exported ".length).replace(ROOT + "/", ""))
        }
    }
}
